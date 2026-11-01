"""Time alignment of a front rep and a side rep of the same move (separate takes,
so the timing differs). DTW over signals both cameras share:

  * vertical joint heights relative to the pelvis (y is common to both views),
  * pelvis rise/fall from the rep start,
  * 3D joint angles from each view's monocular lift (rotation-invariant).

Left/right pairs are folded into (sum, |difference|) so a left/right label swap in
the side view — common for the far limb — doesn't break the match."""
from run_tests import register
import numpy as np
from motion_v2 import MP

_PAIRS_V = [("left_wrist", "right_wrist"), ("left_elbow", "right_elbow"),
            ("left_knee", "right_knee"), ("left_ankle", "right_ankle")]
_ANGLES = [  # (a, b, c) -> angle at b
    ("left_hip", "left_knee", "left_ankle"), ("right_hip", "right_knee", "right_ankle"),
    ("left_shoulder", "left_elbow", "left_wrist"), ("right_shoulder", "right_elbow", "right_wrist"),
    ("left_shoulder", "left_hip", "left_knee"), ("right_shoulder", "right_hip", "right_knee"),
    ("left_hip", "left_shoulder", "left_elbow"), ("right_hip", "right_shoulder", "right_elbow"),
]


def fill_nan(a):
    """Linear-interpolate NaNs along axis 0 (edge values held)."""
    a = np.asarray(a, float).copy()
    flat = a.reshape(a.shape[0], -1)
    idx = np.arange(a.shape[0])
    for k in range(flat.shape[1]):
        col = flat[:, k]
        m = np.isfinite(col)
        if m.all():
            continue
        col[:] = np.interp(idx, idx[m], col[m]) if m.any() else 0.0
    return flat.reshape(a.shape)


def _angle(a, b, c):
    u, v = a - b, c - b
    cos = (u * v).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1) + 1e-9)
    return np.arccos(np.clip(cos, -1, 1)) / np.pi


def features(img, world):
    """img: [n,33,>=2] pixel (u,v,...), world: [n,33,3] MediaPipe world (or None).
    Returns [n, k] view-invariant features."""
    img = fill_nan(np.asarray(img, float)[..., :2])
    v = img[..., 1]
    pel = (v[:, MP["left_hip"]] + v[:, MP["right_hip"]]) / 2
    sho = (img[:, MP["left_shoulder"]] + img[:, MP["right_shoulder"]]) / 2
    hip = (img[:, MP["left_hip"]] + img[:, MP["right_hip"]]) / 2
    torso = float(np.median(np.linalg.norm(sho - hip, axis=1))) or 1.0
    h = lambda n: (pel - v[:, MP[n]]) / torso  # noqa: E731  (up = positive)
    cols = [h("nose"), (pel[0] - pel) / torso]
    for a, b in _PAIRS_V:
        cols += [h(a) + h(b), np.abs(h(a) - h(b))]
    if world is not None:
        w = fill_nan(np.asarray(world, float)[..., :3])
        for a, b, c in _ANGLES[::2]:
            l = _angle(w[:, MP[a]], w[:, MP[b]], w[:, MP[c]])
            r_a, r_b, r_c = (x.replace("left", "right") for x in (a, b, c))
            r = _angle(w[:, MP[r_a]], w[:, MP[r_b]], w[:, MP[r_c]])
            cols += [0.5 * (l + r), 0.5 * np.abs(l - r)]
    return np.stack(cols, axis=1)


def standardize(*feats):
    """Z-score each column with statistics pooled over all given sequences."""
    allf = np.concatenate(feats, axis=0)
    mu, sd = allf.mean(0), allf.std(0)
    sd[sd < 1e-6] = 1.0
    return [(f - mu) / sd for f in feats]


def dtw(A, B, band=0.3):
    """Classic DTW with a Sakoe-Chiba band (as a fraction of the normalised
    diagonal). Returns (cost per path step, path [(i, j), ...])."""
    A, B = np.asarray(A, float), np.asarray(B, float)
    n, m = len(A), len(B)
    C = np.sqrt(((A[:, None, :] - B[None, :, :]) ** 2).sum(-1))
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0
    w = max(int(band * max(n, m)), abs(n - m) + 1)
    for i in range(1, n + 1):
        jc = i * m / n
        lo, hi = max(1, int(jc - w)), min(m, int(jc + w) + 1)
        for j in range(lo, hi + 1):
            D[i, j] = C[i - 1, j - 1] + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    i, j, path = n, m, [(n - 1, m - 1)]
    while i > 1 or j > 1:
        steps = [(D[i - 1, j - 1], i - 1, j - 1), (D[i - 1, j], i - 1, j), (D[i, j - 1], i, j - 1)]
        _, i, j = min(steps, key=lambda s: s[0])
        path.append((i - 1, j - 1))
    path.reverse()
    return float(D[n, m] / len(path)), path


def warp_indices(path, n):
    """For each index i of the first sequence, the (fractional) matched index of
    the second — the mean of its DTW matches, made non-decreasing."""
    acc = np.zeros(n)
    cnt = np.zeros(n)
    for i, j in path:
        acc[i] += j
        cnt[i] += 1
    out = acc / np.maximum(cnt, 1)
    return np.maximum.accumulate(out)


def align(front_feat, side_feat, band=0.3):
    """-> (cost, warp[n_front]) mapping every front frame to a side frame."""
    fa, fb = standardize(front_feat, side_feat)
    cost, path = dtw(fa, fb, band)
    return cost, warp_indices(path, len(front_feat))


def rank_pairs(front_feats, side_feats, band=0.3):
    """All front x side rep pairings, best (lowest DTW cost) first.
    Returns [{front, side, cost, warp}, ...] with list indices into the inputs."""
    out = []
    for i, fa in enumerate(front_feats):
        for j, fb in enumerate(side_feats):
            cost, warp = align(fa, fb, band)
            out.append({"front": i, "side": j, "cost": cost, "warp": warp})
    return sorted(out, key=lambda r: r["cost"])


# ---------- tests ----------
def _signal(t):
    return np.stack([np.sin(2 * np.pi * t), np.cos(3 * np.pi * t), t ** 2], axis=1)


@register
def test_dtw_recovers_known_warp():
    n, m = 60, 90
    tf = np.linspace(0, 1, n)
    ts = np.linspace(0, 1, m) ** 1.6              # side take: slow start, fast finish
    cost, warp = align(_signal(tf), _signal(ts))
    # the side frame showing the same phase as front frame i satisfies ts[j] == tf[i]
    truth = np.interp(tf, ts, np.arange(m))
    assert np.abs(warp - truth).max() < 2.5, np.abs(warp - truth).max()
    assert np.all(np.diff(warp) >= 0) and cost < 0.2


@register
def test_rank_pairs_picks_matching_rep():
    tf = np.linspace(0, 1, 50)
    good = _signal(np.linspace(0, 1, 64))
    other = np.stack([np.cos(5 * np.pi * np.linspace(0, 1, 55)), np.linspace(1, 0, 55),
                      np.sin(np.linspace(0, 1, 55))], axis=1)
    ranked = rank_pairs([_signal(tf)], [other, good])
    assert ranked[0]["side"] == 1 and ranked[0]["cost"] < ranked[1]["cost"]


@register
def test_features_invariant_to_left_right_swap():
    rs = np.random.RandomState(8)
    img = rs.rand(20, 33, 3) * 500
    world = rs.rand(20, 33, 3)
    swap = list(range(33))
    for n, i in MP.items():
        if n.startswith("left_"):
            j = MP[n.replace("left_", "right_")]
            swap[i], swap[j] = j, i
    a = features(img, world)
    b = features(img[:, swap], world[:, swap])
    assert np.allclose(a, b)


@register
def test_fill_nan_interpolates():
    a = np.array([[0.0], [np.nan], [2.0], [np.nan]])
    assert np.allclose(fill_nan(a)[:, 0], [0, 1, 2, 2])
