"""Two-view fusion for single-phone captures: the performer does the move facing the
camera (front take) and again after a 90-degree turn (side take). With the take
time-aligned (see dtw.py):

  front image  u -> x (right),  v -> y (up)
  side image   u -> z (toward front camera, signed by which way the performer faces),  v -> y

Weak perspective (phone a few metres away), one metric scale per take. When a
landmark's 2D confidence is low in one view (typically the far limb in the side
take), that coordinate falls back to the OTHER take's monocular 3D lift, rotated
into the body frame and anchored at the fused pelvis."""
from run_tests import register
import numpy as np
from scipy.signal import savgol_filter
import motion_v2 as mv
from motion_v2 import MP, OBS, OBS_MP
from dtw import fill_nan

EAR_OVER_HEIGHT = 0.88   # ankle->knee->hip->shoulder->ear chain ~= 0.88 x standing height
CONF_LO, CONF_HI = 0.3, 0.6


def body_chain_px(img, pct=90):
    """Pixel length of the ankle->ear chain for this take, from high percentiles of
    each segment's projected length over the whole video (a segment is longest when
    it lies in the image plane). img: [F,33,>=2] pixels; NaN rows allowed."""
    a = np.asarray(img, float)[..., :2]
    ok = np.isfinite(a).all(axis=(1, 2))
    a = a[ok]
    mid = lambda l, r: (a[:, MP[l]] + a[:, MP[r]]) / 2  # noqa: E731
    seg = lambda p, q: np.linalg.norm(p - q, axis=1)     # noqa: E731
    parts = []
    for s in ("left", "right"):
        parts.append((seg(a[:, MP[f"{s}_ankle"]], a[:, MP[f"{s}_knee"]]),
                      seg(a[:, MP[f"{s}_knee"]], a[:, MP[f"{s}_hip"]])))
    shin = np.percentile(np.concatenate([parts[0][0], parts[1][0]]), pct)
    thigh = np.percentile(np.concatenate([parts[0][1], parts[1][1]]), pct)
    torso = np.percentile(seg(mid("left_hip", "right_hip"), mid("left_shoulder", "right_shoulder")), pct)
    neck = np.percentile(seg(mid("left_shoulder", "right_shoulder"), mid("left_ear", "right_ear")), pct)
    return float(shin + thigh + torso + neck)


def metres_per_px(img, height_m):
    return EAR_OVER_HEIGHT * height_m / max(body_chain_px(img), 1e-6)


def resample(a, idx):
    """Linear interpolation of a [n,...] array at fractional indices."""
    a = np.asarray(a, float)
    idx = np.clip(np.asarray(idx, float), 0, len(a) - 1)
    i0 = np.floor(idx).astype(int)
    i1 = np.minimum(i0 + 1, len(a) - 1)
    t = (idx - i0).reshape((-1,) + (1,) * (a.ndim - 1))
    return a[i0] * (1 - t) + a[i1] * t


def _weight(c):
    return np.clip((np.nan_to_num(c) - CONF_LO) / (CONF_HI - CONF_LO), 0.0, 1.0)


def _lift_body(world, side_sign=None):
    """MediaPipe-world lift (x right, y down, z away; hip-centred) -> body frame
    (x = performer's left at start, y up, z = toward front camera), pelvis-relative.
    side_sign=None: front take (camera frame == body frame)."""
    w = mv.mp_to_observed(fill_nan(np.asarray(world, float)[..., :3]))
    x, y, z = w[..., 0], -w[..., 1], -w[..., 2]
    if side_sign is not None:           # side camera: its u axis is body forward
        x, z = -side_sign * z, side_sign * w[..., 0]
    b = np.stack([x, y, z], axis=-1)
    pel = (b[:, OBS["left_hip"]] + b[:, OBS["right_hip"]]) / 2
    return b - pel[:, None]


def _torso(obs3):
    sho = (obs3[:, OBS["left_shoulder"]] + obs3[:, OBS["right_shoulder"]]) / 2
    hip = (obs3[:, OBS["left_hip"]] + obs3[:, OBS["right_hip"]]) / 2
    return float(np.median(np.linalg.norm(sho - hip, axis=1))) or 1.0


def fuse(front, side, warp, side_sign, s_front, s_side, smooth=7):
    """front/side: {"img": [n,33,3] (u px, v px, conf), "world": [n,33,3] or None}
    for the chosen reps; warp[i] = fractional side frame matching front frame i.
    side_sign: +1 if in the side take the performer faces image-right, -1 image-left.
    s_front/s_side: metres per pixel for each take.
    Returns dict(v2=[n,29,3] metric y-up body-frame track (not grounded), proj=..., stats=...)."""
    n = len(front["img"])
    fi = fill_nan(np.asarray(front["img"], float))
    si = resample(fill_nan(np.asarray(side["img"], float)), warp)
    fo, so = mv.mp_to_observed(fi), mv.mp_to_observed(si)          # [n,21,3]
    wf = _weight(mv.mp_to_observed(np.asarray(front["img"], float))[..., 2])
    ws = _weight(mv.mp_to_observed(resample(np.asarray(side["img"], float), warp))[..., 2])

    pel_u = lambda o: (o[0, OBS["left_hip"], 0] + o[0, OBS["right_hip"], 0]) / 2  # noqa: E731
    u0f, u0s = pel_u(fo), pel_u(so)
    xf = (fo[..., 0] - u0f) * s_front
    yf = -fo[..., 1] * s_front
    zs = side_sign * (so[..., 0] - u0s) * s_side
    ys = -so[..., 1] * s_side

    # Both takes see the same heights: refine the side take's scale/offset so its y
    # agrees with the front's (least squares over confidently-seen joint-frames).
    m = (wf > 0.99) & (ws > 0.99)
    a, b = 1.0, 0.0
    if m.sum() >= 10:
        A = np.stack([ys[m], np.ones(m.sum())], axis=1)
        (a, b), *_ = np.linalg.lstsq(A, yf[m], rcond=None)
        a = float(np.clip(a, 0.8, 1.25))
        b = float(np.median(yf[m] - a * ys[m]))
    ys, zs = a * ys + b, a * zs

    # Monocular fallbacks, scaled to the fused metric size and anchored at the pelvis.
    pel_x = (xf[:, OBS["left_hip"]] + xf[:, OBS["right_hip"]]) / 2
    pel_z = (zs[:, OBS["left_hip"]] + zs[:, OBS["right_hip"]]) / 2
    two_d = np.stack([xf, yf, np.zeros_like(xf)], axis=-1)
    torso_m = _torso(two_d)
    have_lift = front.get("world") is not None and side.get("world") is not None
    if have_lift:
        lf = _lift_body(front["world"])
        ls = _lift_body(resample(np.asarray(side["world"], float), warp), side_sign)
        lf *= torso_m / _torso(lf)
        ls *= torso_m / _torso(ls)
        x_fb = pel_x[:, None] + ls[..., 0]
        z_fb = pel_z[:, None] + lf[..., 2]
    else:
        x_fb, z_fb = xf, zs
        wf = np.ones_like(wf); ws = np.ones_like(ws)

    x = wf * xf + (1 - wf) * x_fb
    z = ws * zs + (1 - ws) * z_fb
    wsum = wf + ws
    y = np.where(wsum > 1e-6, (wf * yf + ws * ys) / np.maximum(wsum, 1e-6), 0.5 * (yf + ys))
    obs = np.stack([x, y, z], axis=-1)

    if smooth and n >= 5:
        win = min(smooth, n if n % 2 else n - 1)
        obs = savgol_filter(obs, win, 2, axis=0)
    obs = mv.rigidify_observed(obs)
    v2 = mv.observed_to_v2(obs)

    # Re-project into both takes for QA.
    pu_f = v2[..., 0] / s_front + u0f
    pv_f = -v2[..., 1] / s_front
    pu_s = side_sign * v2[..., 2] / (a * s_side) + u0s
    pv_s = -(v2[..., 1] - b) / (a * s_side)
    err = lambda pu, pv, o, w: float(np.median(np.hypot(          # noqa: E731
        pu[:, [mv.V2[k] for k in mv.OBS_NAMES]] - o[..., 0],
        pv[:, [mv.V2[k] for k in mv.OBS_NAMES]] - o[..., 1])[w > 0.99])) if (w > 0.99).any() else None
    stats = {
        "reproj_px": {"front": err(pu_f, pv_f, fo, wf), "side": err(pu_s, pv_s, so, ws)},
        "fallback": {"x": float(1 - wf.mean()), "z": float(1 - ws.mean())},
        "side_scale_fit": [round(a, 4), round(b, 4)],
    }
    return {"v2": v2, "proj": {"front": np.stack([pu_f, pv_f], -1), "side": np.stack([pu_s, pv_s], -1)},
            "stats": stats}


# ---------- tests ----------
def _rot_y(P, deg):
    t = np.radians(deg)
    c, s = np.cos(t), np.sin(t)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return np.stack([c * x + s * z, y, -s * x + c * z], axis=-1)


def _truth_motion(n):
    """Rigid-limbed synthetic move in the body frame: a half turn with travel, a
    bob, and the left arm swinging up — exercises x, y and z."""
    base = mv._standing_obs(1)[0]
    t = np.linspace(0, 1, n)
    out = np.empty((n, 21, 3))
    sh = base[OBS["left_shoulder"]]
    arm = [OBS[k] for k in ("left_elbow", "left_wrist", "left_hand_tip")]
    for i, ti in enumerate(t):
        p = base.copy()
        ang = np.radians(150 * ti)                         # swing the left arm about x
        c, s = np.cos(ang), np.sin(ang)
        rel = p[arm] - sh
        p[arm] = sh + np.stack([rel[:, 0], c * rel[:, 1] - s * rel[:, 2], s * rel[:, 1] + c * rel[:, 2]], 1)
        p = _rot_y(p, 180 * ti)                            # half turn
        p += [0.6 * ti, 0.15 * np.sin(np.pi * ti), 0.3 * ti]
        out[i] = p
    return out


def _to_mp33(obs, fill):
    a = np.full(obs.shape[:1] + (33, fill.shape[-1]), 0.0)
    a[:, OBS_MP] = fill
    return a


def _render(obs, cam, s, u0, v0, side_sign=1):
    """Project body-frame obs [n,21,3] into a take's image (pixels) + MediaPipe world."""
    if cam == "front":
        u = obs[..., 0] / s + u0
        wx, wz = obs[..., 0], -obs[..., 2]
    else:
        u = side_sign * obs[..., 2] / s + u0
        wx, wz = side_sign * obs[..., 2], side_sign * obs[..., 0]
    v = v0 - obs[..., 1] / s
    img = _to_mp33(obs, np.stack([u, v, np.ones_like(u)], -1))
    pel = (obs[:, OBS["left_hip"]] + obs[:, OBS["right_hip"]]) / 2
    world = _to_mp33(obs, np.stack([wx - wx.mean(), -(obs[..., 1] - pel[:, None, 1]), wz], -1))
    return img, world


def _fuse_setup(side_sign=1, occlude=False):
    nf, ns = 50, 70
    truth_f = _truth_motion(nf)
    ts = np.linspace(0, 1, ns) ** 1.4                      # side take has different timing
    truth_s = np.stack([_truth_motion(401)[int(round(t * 400))] for t in ts])
    fimg, fworld = _render(truth_f, "front", 0.004, 900, 950)
    simg, sworld = _render(truth_s, "side", 0.005, 400, 800, side_sign)
    if occlude:                                            # far arm hidden in side take
        for k in ("left_elbow", "left_wrist", "left_index"):
            simg[:, MP[k], 0] += 60.0                      # detector guesses badly...
            simg[:, MP[k], 2] = 0.1                        # ...and says so
    warp = np.interp(np.linspace(0, 1, nf), ts, np.arange(ns))
    res = fuse({"img": fimg, "world": fworld}, {"img": simg, "world": sworld}, warp,
               side_sign, 0.004, 0.005, smooth=0)
    est = res["v2"][:, [mv.V2[k] for k in mv.OBS_NAMES]]
    # compare shapes up to a global translation (fusion origin is arbitrary)
    d = (est - truth_f)
    d -= d.reshape(-1, 3).mean(0)
    return np.linalg.norm(d, axis=-1), res


@register
def test_fuse_recovers_truth_side_facing_right():
    err, res = _fuse_setup(+1)
    assert err.mean() < 0.02, err.mean()                   # < 2 cm
    assert res["stats"]["reproj_px"]["front"] < 3


@register
def test_fuse_recovers_truth_side_facing_left():
    err, _ = _fuse_setup(-1)
    assert err.mean() < 0.02, err.mean()


@register
def test_fuse_falls_back_to_lift_for_occluded_joints():
    err, res = _fuse_setup(+1, occlude=True)
    arm = [OBS[k] for k in ("left_elbow", "left_wrist", "left_hand_tip")]
    assert err[:, arm].mean() < 0.03, err[:, arm].mean()   # fallback keeps the far arm
    assert res["stats"]["fallback"]["z"] > 0.05


@register
def test_dtw_then_fuse_end_to_end():
    # Same pipeline as fuse_session.py: features -> DTW warp -> fuse (no known warp).
    import dtw
    nf, ns = 50, 70
    truth_f = _truth_motion(nf)
    ts = np.linspace(0, 1, ns) ** 1.4
    truth_s = np.stack([_truth_motion(401)[int(round(t * 400))] for t in ts])
    fimg, fworld = _render(truth_f, "front", 0.004, 900, 950)
    simg, sworld = _render(truth_s, "side", 0.005, 400, 800, -1)
    cost, warp = dtw.align(dtw.features(fimg, fworld), dtw.features(simg, sworld))
    res = fuse({"img": fimg, "world": fworld}, {"img": simg, "world": sworld}, warp, -1, 0.004, 0.005)
    d = res["v2"][:, [mv.V2[k] for k in mv.OBS_NAMES]] - truth_f
    d -= d.reshape(-1, 3).mean(0)
    assert np.linalg.norm(d, axis=-1).mean() < 0.03, np.linalg.norm(d, axis=-1).mean()


@register
def test_metres_per_px_from_height():
    obs = mv._standing_obs(5)
    img, _ = _render(obs, "front", 0.004, 900, 950)
    # the synthetic figure's ankle->knee->hip->shoulder->ear chain is 1.55 m
    s = metres_per_px(img, 1.55 / EAR_OVER_HEIGHT)
    assert abs(s - 0.004) / 0.004 < 0.02, s
