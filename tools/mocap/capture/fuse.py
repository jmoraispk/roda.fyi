from run_tests import register
import numpy as np
import geom


def to_common_frame(track, facing):
    return geom.rotate_y(track, -geom.FACING_YAW[facing])


def _cov_in_common(theta_deg, sp, sd):
    t = np.radians(-theta_deg)  # rotate camera frame into common frame
    c, s = np.cos(t), np.sin(t)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    D = np.diag([sp * sp, sp * sp, sd * sd])
    return R @ D @ R.T


def fuse_facings(by_facing, sigma_depth=4.0, sigma_plane=1.0):
    """by_facing: {facing: track[n,J,3] in its own camera frame}. Returns [n,J,3]."""
    facings = list(by_facing.keys())
    shapes = {by_facing[f].shape for f in facings}
    assert len(shapes) == 1, f"facing tracks differ in shape: {shapes}"
    n, J, _ = by_facing[facings[0]].shape
    infos = {f: np.linalg.inv(_cov_in_common(geom.FACING_YAW[f], sigma_plane, sigma_depth)) for f in facings}
    common = {f: to_common_frame(by_facing[f], f) for f in facings}
    out = np.empty((n, J, 3), float)
    for i in range(n):
        for j in range(J):
            A = np.zeros((3, 3)); b = np.zeros(3)
            for f in facings:
                Ci = infos[f]
                A += Ci
                b += Ci @ common[f][i, j]
            out[i, j] = np.linalg.solve(A, b)
    return out


@register
def test_to_common_frame_inverts_yaw():
    base = np.random.RandomState(2).rand(5, 13, 3) * 10
    left = geom.rotate_y(base, geom.FACING_YAW["left"])  # subject physically turned left
    assert np.allclose(to_common_frame(left, "left"), base, atol=1e-9)


@register
def test_fuse_recovers_truth_front_plus_left():
    rs = np.random.RandomState(3)
    truth = rs.rand(6, 13, 3) * 10            # canonical (common-frame) truth
    # FRONT view: measures x,y exactly; z (depth) corrupted.
    front_cam = truth.copy()
    front_cam[..., 2] += rs.randn(*truth.shape[:2]) * 3.0
    # LEFT view: rotate truth into the left camera frame, corrupt that camera's depth (its z),
    # which corresponds to the subject's x — the axis FRONT got right. Net: complementary.
    left_cam = geom.rotate_y(truth, geom.FACING_YAW["left"])
    left_cam[..., 2] += rs.randn(*truth.shape[:2]) * 3.0
    fused = fuse_facings({"front": front_cam, "left": left_cam}, sigma_depth=6.0, sigma_plane=1.0)
    err = np.linalg.norm(fused - truth, axis=2).mean()
    # Either single view alone has ~depth-noise error (~2-3 units); fusion must beat both.
    front_only = np.linalg.norm(front_cam - truth, axis=2).mean()
    left_only = np.linalg.norm(to_common_frame(left_cam, "left") - truth, axis=2).mean()
    assert err < 0.6 * min(front_only, left_only), (err, front_only, left_only)


@register
def test_fuse_four_facings_shape():
    rs = np.random.RandomState(4)
    truth = rs.rand(4, 13, 3) * 10
    by = {f: geom.rotate_y(truth, geom.FACING_YAW[f]) for f in ["front", "left", "back", "right"]}
    fused = fuse_facings(by)
    assert fused.shape == (4, 13, 3)
    assert np.allclose(fused, truth, atol=1e-6)
