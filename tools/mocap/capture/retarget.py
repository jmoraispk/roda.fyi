from run_tests import register
import numpy as np
import geom

MP = {n: i for i, n in enumerate([
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index"])}

_MAP = {
    "head": "nose", "shoulderL": "left_shoulder", "shoulderR": "right_shoulder",
    "elbowL": "left_elbow", "elbowR": "right_elbow",
    "handL": "left_wrist", "handR": "right_wrist",
    "hipL": "left_hip", "hipR": "right_hip",
    "kneeL": "left_knee", "kneeR": "right_knee",
    "footL": "left_ankle", "footR": "right_ankle",
}

_BONE_TREE = [
    ("root", "shoulderL"), ("root", "shoulderR"), ("root", "head"),
    ("shoulderL", "elbowL"), ("elbowL", "handL"),
    ("shoulderR", "elbowR"), ("elbowR", "handR"),
    ("root", "hipL"), ("root", "hipR"),
    ("hipL", "kneeL"), ("kneeL", "footL"),
    ("hipR", "kneeR"), ("kneeR", "footR"),
]
JI = {j: i for i, j in enumerate(geom.JOINTS3D)}


def mp_world_to_roda(world33):
    w = np.asarray(world33, float)
    out = np.zeros((len(geom.JOINTS3D), 3))
    for j, mp_name in _MAP.items():
        p = w[MP[mp_name]].copy()
        # MediaPipe world is right-handed x=right, y=down, +z=away from camera.
        # Roda is right-handed x=right, y=up, +z=toward viewer (matches figure3d's
        # depth sort/tint, classify_facing, and the hand-authored static p3d poses),
        # so flip BOTH y and z. Flipping y alone would leave a left-handed frame
        # whose depth (and front/back facing) renders inverted.
        p[1] = -p[1]
        p[2] = -p[2]
        out[JI[j]] = p
    # Anchor the head ball at the skull centre (mid-point of the ears) rather than
    # the nose tip. The nose sits at the front of the face (+z toward viewer and a
    # little low), so a ball centred there reads as the head "falling forward",
    # badly so when the torso bends. The ear mid-point is centred front-to-back over
    # the neck. Keeps the nose (set above) as a fallback if an ear is missing.
    ears = []
    for e in ("left_ear", "right_ear"):
        pe = w[MP[e]].copy(); pe[1] = -pe[1]; pe[2] = -pe[2]
        ears.append(pe)
    head = (ears[0] + ears[1]) / 2.0
    if np.all(np.isfinite(head)):
        out[JI["head"]] = head
    return out


def fill_smooth_rigidify(track, conf=None, win=7):
    """track: [F,13,3] (may contain NaN). Interp gaps, Savitzky-Golay, fix bone lengths."""
    from scipy.signal import savgol_filter
    a = np.asarray(track, float).copy()
    F = a.shape[0]
    w = min(win, F if F % 2 else F - 1)
    if w % 2 == 0:
        w -= 1
    for j in range(a.shape[1]):
        for ax in range(3):
            col = a[:, j, ax]
            mask = ~np.isnan(col)
            if mask.sum() == 0:
                col[:] = 0.0
            elif mask.sum() < F:
                idx = np.arange(F)
                col[~mask] = np.interp(idx[~mask], idx[mask], col[mask])
            if w >= 3 and mask.sum() >= 3:
                col = savgol_filter(col, w, 2)
            a[:, j, ax] = col
    return _rigidify(a)


def _rigidify(a):
    F = a.shape[0]
    root = (a[:, JI["hipL"]] + a[:, JI["hipR"]]) / 2.0

    def dat(name):
        return root if name == "root" else a[:, JI[name]]

    lengths = {}
    for par, ch in _BONE_TREE:
        d = dat(ch) - dat(par)
        lengths[(par, ch)] = float(np.nanmedian(np.linalg.norm(d, axis=1)))

    out = np.zeros_like(a)
    parent_pos = {"root": root}
    for par, ch in _BONE_TREE:
        vec = dat(ch) - dat(par)
        norm = np.linalg.norm(vec, axis=1, keepdims=True)
        norm[norm < 1e-6] = 1e-6
        unit = vec / norm
        pos = parent_pos[par] + unit * lengths[(par, ch)]
        out[:, JI[ch]] = pos
        parent_pos[ch] = pos
    return out


def normalize_sequence(frames, target_torso=40.0, floor_y=20.0, headR=9):
    """frames: [n,13,3] (y-up, may include root translation) -> list of pose dicts.

    Unlike a fit-to-box normalize, we scale by a STABLE body measure (median
    shoulder->hip length) so the figure keeps a constant size even as it travels,
    then PRESERVE the root translation (the body really does move left/right/up).
    The pelvis path is centered on x=60 (so the mirror axis stays valid) and the
    lowest point of the clip is pinned to `floor_y` (ground contact). Kept y-up to
    match figure3d.js (screenY = H/2 - y). Coords may exceed the 120x160 box for
    traveling moves; figure3d auto-fits/zooms to show the whole path.
    """
    P = np.asarray(frames, float).copy()
    sho = (P[:, JI["shoulderL"]] + P[:, JI["shoulderR"]]) / 2.0
    hip = (P[:, JI["hipL"]] + P[:, JI["hipR"]]) / 2.0
    torso = float(np.median(np.linalg.norm(sho - hip, axis=1)))
    P *= target_torso / max(torso, 1e-3)          # constant body size

    hipmid = (P[:, JI["hipL"]] + P[:, JI["hipR"]]) / 2.0
    P[..., 0] -= float(np.median(hipmid[:, 0])) - 60.0   # center the sway path on x=60
    P[..., 2] -= float(np.median(P[..., 2]))             # center depth
    # Ground EVERY frame: the lowest joint each frame sits on the floor (the support
    # foot in a stance, the hands when inverted in an aú). Pinning only the single
    # global minimum (the old behaviour) let every other frame float above the floor
    # line — the base stance hovered and the aú's hands never met the ground.
    P[..., 1] += floor_y - P[..., 1].min(axis=1, keepdims=True)

    out = []
    for i in range(P.shape[0]):
        pose = {}
        for j, name in enumerate(geom.JOINTS3D):
            x, y, z = P[i, j]
            pose[name] = [round(x, 2), round(y, 2), round(z, 2)]
        pose["headR"] = headR
        out.append(pose)
    return out


@register
def test_mp_mapping_shape_and_yzflip():
    w = np.zeros((33, 3))
    w[MP["nose"]] = [1, 2, 3]
    w[MP["left_ear"]] = [2, 4, 6]
    w[MP["right_ear"]] = [0, 4, 6]
    w[MP["left_ankle"]] = [0, 5, 0]
    roda = mp_world_to_roda(w)
    assert roda.shape == (13, 3)
    # head is anchored at the ear mid-point (raw [1,4,6]), then y,z flipped — NOT the nose
    assert list(roda[JI["head"]]) == [1, -4, -6]
    assert roda[JI["footL"]][1] == -5   # y down -> up, z away -> toward-viewer


@register
def test_rigidify_constant_bone_length():
    rs = np.random.RandomState(5)
    base = rs.rand(13, 3)
    track = np.stack([base + rs.randn(13, 3) * 0.02 for _ in range(15)], 0)
    out = fill_smooth_rigidify(track, win=5)
    fl = np.linalg.norm(out[:, JI["kneeL"]] - out[:, JI["footL"]], axis=1)
    assert fl.std() < 1e-6  # bone length now constant over time


@register
def test_normalize_stable_scale_and_floor():
    rs = np.random.RandomState(6)
    frames = rs.rand(10, 13, 3) * 2 - 1
    poses = normalize_sequence(frames, target_torso=40.0, floor_y=20.0)
    P = np.array([[poses[i][j] for j in geom.JOINTS3D] for i in range(len(poses))])
    JIl = {j: k for k, j in enumerate(geom.JOINTS3D)}
    sho = (P[:, JIl["shoulderL"]] + P[:, JIl["shoulderR"]]) / 2
    hip = (P[:, JIl["hipL"]] + P[:, JIl["hipR"]]) / 2
    torso = np.median(np.linalg.norm(sho - hip, axis=1))
    assert abs(torso - 40.0) < 0.1             # scaled to a constant body size (2dp rounding)
    assert abs(float(np.min(P[..., 1])) - 20.0) < 0.05   # lowest point pinned to floor
    assert "headR" in poses[0]


@register
def test_normalize_preserves_translation():
    # a figure that slides +x over time must still be moving after normalize
    fr = np.zeros((6, 13, 3))
    base = np.linspace(-1, 1, 6)
    for i in range(6):
        fr[i, :, 0] = base[i]                  # whole body translates in x
        fr[i, JI["head"], 1] = 1.0
        fr[i, JI["footL"], 1] = -1.0; fr[i, JI["footR"], 1] = -1.0
        fr[i, JI["shoulderL"], 1] = 0.5; fr[i, JI["shoulderR"], 1] = 0.5
    poses = normalize_sequence(fr)
    px = [(poses[i]["hipL"][0] + poses[i]["hipR"][0]) / 2 for i in range(6)]
    assert max(px) - min(px) > 1.0             # translation survived


@register
def test_normalize_keeps_head_above_feet():
    # y-up input: head clearly above the feet. figure3d.js projects screenY = H/2 - y,
    # so the emitted head y MUST be larger than the foot y (renders upright).
    fr = np.zeros((4, 13, 3))
    fr[:, JI["head"], 1] = 10.0
    fr[:, JI["footL"], 1] = -10.0
    fr[:, JI["footR"], 1] = -10.0
    poses = normalize_sequence(fr)
    assert poses[0]["head"][1] > poses[0]["footL"][1]
