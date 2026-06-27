from run_tests import register
import numpy as np


def resample_to_progress(track, n):
    """track: [F,J,3] -> [n,J,3], linear interp over normalized time [0,1]."""
    track = np.asarray(track, float)
    F = track.shape[0]
    if F == n:
        return track.copy()
    src = np.linspace(0.0, 1.0, F)
    dst = np.linspace(0.0, 1.0, n)
    out = np.empty((n,) + track.shape[1:], float)
    for j in range(track.shape[1]):
        for ax in range(track.shape[2]):
            out[:, j, ax] = np.interp(dst, src, track[:, j, ax])
    return out


def average_reps(tracks, n):
    """tracks: list of [F_i,J,3]. Returns (mean[n,J,3], std[n,J])."""
    stack = np.stack([resample_to_progress(t, n) for t in tracks], axis=0)  # [R,n,J,3]
    mean = stack.mean(axis=0)
    std = np.linalg.norm(stack - mean[None], axis=3).mean(axis=0)  # [n,J] mean dist to mean
    return mean, std


@register
def test_resample_endpoints():
    t = np.cumsum(np.ones((10, 2, 3)), axis=0)
    r = resample_to_progress(t, 25)
    assert r.shape == (25, 2, 3)
    assert np.allclose(r[0], t[0]) and np.allclose(r[-1], t[-1])


@register
def test_average_identical():
    t = np.random.RandomState(0).rand(12, 4, 3)
    mean, std = average_reps([t, t, t], n=12)
    assert np.allclose(mean, t, atol=1e-9)
    assert std.max() < 1e-9


@register
def test_average_reduces_spread():
    base = np.random.RandomState(1).rand(20, 5, 3)
    a = base + 0.10
    b = base - 0.10
    mean, std = average_reps([a, b], n=20)
    assert np.allclose(mean, base, atol=1e-9)
    assert std.mean() > 0.05  # captures the inter-rep spread
