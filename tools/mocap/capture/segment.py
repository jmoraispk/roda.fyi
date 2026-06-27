from run_tests import register
import numpy as np
import geom

JI = {j: i for i, j in enumerate(geom.JOINTS3D)}


def _body_len(W):
    sho = (W[:, JI["shoulderL"]] + W[:, JI["shoulderR"]]) / 2
    hip = (W[:, JI["hipL"]] + W[:, JI["hipR"]]) / 2
    d = np.linalg.norm(sho - hip, axis=1)
    return float(np.nanmedian(d)) or 1.0


def energy(W, fps):
    """Body-length-normalized mean joint speed per frame, lightly smoothed."""
    bl = _body_len(W)
    vel = np.linalg.norm(np.diff(W, axis=0), axis=2)  # [F-1, J]
    e = np.nanmean(vel, axis=1) * fps / bl
    e = np.concatenate([e[:1], e])  # align length to F
    k = max(1, int(round(fps * 0.12)))  # ~120ms moving average
    if k > 1:
        ker = np.ones(k) / k
        e = np.convolve(e, ker, mode="same")
    return e


def find_active_spans(E, fps, min_active_s=0.5, min_rest_s=0.25, rest_pct=35.0, pad=2):
    thr = np.percentile(E, rest_pct)
    active = E > thr
    spans, i, F = [], 0, len(E)
    runs = []
    while i < F:
        j = i
        while j < F and active[j] == active[i]:
            j += 1
        runs.append((active[i], i, j))  # (is_active, start, end)
        i = j
    min_a, min_r = int(min_active_s * fps), int(min_rest_s * fps)
    for idx, (is_act, s, e) in enumerate(runs):
        if not is_act or (e - s) < min_a:
            continue
        prev_rest = idx > 0 and not runs[idx - 1][0] and (runs[idx - 1][2] - runs[idx - 1][1]) >= min_r
        next_rest = idx < len(runs) - 1 and not runs[idx + 1][0] and (runs[idx + 1][2] - runs[idx + 1][1]) >= min_r
        if prev_rest and next_rest:
            spans.append((max(0, s - pad), min(F, e + pad)))
    return spans


def classify_stance(pose):
    p = np.asarray(pose, float)
    bl = np.linalg.norm((p[JI["shoulderL"]] + p[JI["shoulderR"]]) / 2 -
                        (p[JI["hipL"]] + p[JI["hipR"]]) / 2) or 1.0
    foot_sep = abs(p[JI["footL"]][0] - p[JI["footR"]][0]) / bl
    hip_y = (p[JI["hipL"]][1] + p[JI["hipR"]][1]) / 2
    foot_y = (p[JI["footL"]][1] + p[JI["footR"]][1]) / 2
    hip_height = (hip_y - foot_y) / bl  # bigger = more upright
    if foot_sep < 0.55 and hip_height > 1.4:
        return "paralela"
    if foot_sep > 0.9:
        return "ginga"
    return "stand"


def classify_facing(span_world, span_img):
    """span_world: [n,J,3] (y-up, z toward viewer). span_img: [n,J(mp or roda),...]
    Uses the mean chest normal across the span."""
    W = np.asarray(span_world, float).mean(axis=0)
    shoL, shoR = W[JI["shoulderL"]], W[JI["shoulderR"]]
    hip = (W[JI["hipL"]] + W[JI["hipR"]]) / 2
    sho = (shoL + shoR) / 2
    across = shoR - shoL                 # points from left to right shoulder
    up = sho - hip
    normal = np.cross(across, up)        # chest normal (points out of the chest)
    n = normal / (np.linalg.norm(normal) + 1e-9)
    # z toward viewer: normal_z > 0 => chest faces camera (front)
    if abs(n[2]) >= abs(n[0]):
        return "front" if n[2] > 0 else "back"
    # left/right: which shoulder is closer to the camera (larger z)
    return "left" if shoL[2] > shoR[2] else "right"


# ---------- tests ----------
def _ortho_pose(yaw_deg=0.0, foot_sep=0.4, hip_h=1.5):
    """Canonical upright pose, rotated by yaw about up.

    `foot_sep` and `hip_h` are expressed in body-length (shoulder->hip) units,
    so they map directly to what `classify_stance` measures:
      computed foot_sep  = |footL.x - footR.x| / bl  == foot_sep
      computed hip_height = (hip_y - foot_y) / bl     == hip_h
    """
    bl = 6.0
    hip_y = 6.0
    sho_y = hip_y + bl                    # = 12
    foot_y = hip_y - hip_h * bl           # legs hang hip_h body-lengths below the hips
    knee_y = (hip_y + foot_y) / 2.0
    fx = foot_sep * bl / 2.0              # half the foot separation
    base = {
        "head": [0, sho_y + 4, 0],
        "shoulderL": [-3, sho_y, 0], "shoulderR": [3, sho_y, 0],
        "elbowL": [-4, sho_y - 4, 0], "handL": [-4, sho_y - 7, 0],
        "elbowR": [4, sho_y - 4, 0], "handR": [4, sho_y - 7, 0],
        "hipL": [-2, hip_y, 0], "hipR": [2, hip_y, 0],
        "kneeL": [-2, knee_y, 0], "footL": [-fx, foot_y, 0],
        "kneeR": [2, knee_y, 0], "footR": [fx, foot_y, 0],
    }
    arr = geom.pose_to_array({**base, "headR": 9})
    return geom.rotate_y(arr, yaw_deg)


@register
def test_energy_low_when_still():
    W = np.tile(_ortho_pose(0)[None], (30, 1, 1))
    assert energy(W, 30).max() < 1e-6


@register
def test_find_active_spans_one_move():
    fps = 30
    still = np.tile(_ortho_pose(0)[None], (fps, 1, 1))         # 1s rest
    # 0.8s of motion: translate every joint linearly
    move = np.tile(_ortho_pose(0)[None], (int(0.8 * fps), 1, 1)).astype(float)
    ramp = np.linspace(0, 30, move.shape[0])[:, None, None]
    move = move + ramp
    W = np.concatenate([still, move, still], axis=0)
    spans = find_active_spans(energy(W, fps), fps)
    assert len(spans) == 1, spans
    s, e = spans[0]
    assert fps - 6 <= s <= fps + 6 and 2 * fps - 6 <= e <= 2 * fps + 12, (s, e)


@register
def test_classify_stance():
    paralela = geom.array_to_pose(_ortho_pose(0, foot_sep=0.3, hip_h=1.6))
    ginga = geom.array_to_pose(_ortho_pose(0, foot_sep=1.4))
    assert classify_stance(geom.pose_to_array(paralela)) == "paralela"
    assert classify_stance(geom.pose_to_array(ginga)) == "ginga"


@register
def test_classify_facing():
    front = geom.rotate_y(_ortho_pose(0), 0)[None]
    back = geom.rotate_y(_ortho_pose(0), 180)[None]
    assert classify_facing(front, None) == "front"
    assert classify_facing(back, None) == "back"
