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
        p[1] = -p[1]              # MediaPipe world y is down -> up
        out[JI[j]] = p
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


def normalize_sequence(frames, pad_x=14.0, top=18.0, bottom=150.0, headR=9):
    """frames: [n,13,3] -> list of pose dicts fit into the 120x160 (+z) viewBox."""
    P = np.asarray(frames, float)
    hipmid = (P[:, JI["hipL"]] + P[:, JI["hipR"]]) / 2.0
    cx = float(np.median(hipmid[:, 0]))
    P = P.copy(); P[..., 0] -= cx                 # center x on the pelvis path
    P[..., 2] -= float(np.median(P[..., 2]))      # center z

    xs, ys = P[..., 0], P[..., 1]
    half_w = max(np.max(np.abs(xs)), 1e-3)
    miny, maxy = float(np.min(ys)), float(np.max(ys))
    scale = min((120 - 2 * pad_x) / (2 * half_w), (bottom - top) / max(maxy - miny, 1e-3))

    out = []
    for i in range(P.shape[0]):
        pose = {}
        for j, name in enumerate(geom.JOINTS3D):
            x, y, z = P[i, j]
            pose[name] = [round(60.0 + x * scale, 2),
                          round(bottom - (maxy - y) * scale, 2),
                          round(z * scale, 2)]
        pose["headR"] = headR
        out.append(pose)
    return out


@register
def test_mp_mapping_shape_and_yflip():
    w = np.zeros((33, 3))
    w[MP["nose"]] = [1, 2, 3]
    w[MP["left_ankle"]] = [0, 5, 0]
    roda = mp_world_to_roda(w)
    assert roda.shape == (13, 3)
    assert list(roda[JI["head"]]) == [1, -2, 3]   # y flipped
    assert roda[JI["footL"]][1] == -5


@register
def test_rigidify_constant_bone_length():
    rs = np.random.RandomState(5)
    base = rs.rand(13, 3)
    track = np.stack([base + rs.randn(13, 3) * 0.02 for _ in range(15)], 0)
    out = fill_smooth_rigidify(track, win=5)
    fl = np.linalg.norm(out[:, JI["kneeL"]] - out[:, JI["footL"]], axis=1)
    assert fl.std() < 1e-6  # bone length now constant over time


@register
def test_normalize_into_viewbox():
    rs = np.random.RandomState(6)
    frames = rs.rand(10, 13, 3) * 2 - 1
    poses = normalize_sequence(frames)
    xs = [p[j][0] for p in poses for j in geom.JOINTS3D]
    ys = [p[j][1] for p in poses for j in geom.JOINTS3D]
    assert min(xs) >= 0 and max(xs) <= 120
    assert min(ys) >= 0 and max(ys) <= 160
    assert "headR" in poses[0]
