from run_tests import register
import numpy as np

JOINTS3D = ["head", "shoulderL", "shoulderR", "elbowL", "handL", "elbowR", "handR",
            "hipL", "hipR", "kneeL", "footL", "kneeR", "footR"]

BONES3D = [
    ["shoulderL", "shoulderR"],
    ["hipL", "hipR"],
    ["shoulderL", "hipL"],
    ["shoulderR", "hipR"],
    ["shoulderL", "elbowL", "handL"],
    ["shoulderR", "elbowR", "handR"],
    ["hipL", "kneeL", "footL"],
    ["hipR", "kneeR", "footR"],
]

FACING_YAW = {"front": 0.0, "left": 90.0, "back": 180.0, "right": 270.0}


def rotate_y(P, deg):
    """Rotate point(s) about the +y (up) axis. P: array-like [...,3]."""
    P = np.asarray(P, float)
    t = np.radians(deg)
    c, s = np.cos(t), np.sin(t)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return np.stack([c * x + s * z, y, -s * x + c * z], axis=-1)


def pose_to_array(pose):
    return np.array([pose[j] for j in JOINTS3D], float)


def array_to_pose(arr, headR=9):
    pose = {j: [round(float(arr[i, 0]), 2), round(float(arr[i, 1]), 2),
                round(float(arr[i, 2]), 2)] for i, j in enumerate(JOINTS3D)}
    pose["headR"] = headR
    return pose


def mirror_pose(pose, axis=60.0):
    """Left<->right mirror: reflect x about `axis` and negate z (keep handedness),
    AND swap L/R joint labels so 'left arm' stays anatomically the left arm."""
    swap = {"shoulderL": "shoulderR", "shoulderR": "shoulderL",
            "elbowL": "elbowR", "elbowR": "elbowL", "handL": "handR", "handR": "handL",
            "hipL": "hipR", "hipR": "hipL", "kneeL": "kneeR", "kneeR": "kneeL",
            "footL": "footR", "footR": "footL"}
    out = {}
    for k, v in pose.items():
        if k == "headR":
            out[k] = v
            continue
        dst = swap.get(k, k)
        out[dst] = [2 * axis - v[0], v[1], -v[2]]
    return out


@register
def test_rotate_y_roundtrip():
    P = np.array([[10.0, 5.0, 0.0], [0.0, 1.0, 7.0]])
    assert np.allclose(rotate_y(rotate_y(P, 90), -90), P, atol=1e-9)
    assert np.allclose(rotate_y(P, 360), P, atol=1e-9)


@register
def test_rotate_y_known():
    # +90° about up turns +x into -z (right-handed, y up, z toward viewer).
    out = rotate_y([1.0, 0.0, 0.0], 90)
    assert np.allclose(out, [0.0, 0.0, -1.0], atol=1e-9), out


@register
def test_mirror_twice_identity():
    pose = {"head": [70, 134, 4], "headR": 9,
            "shoulderL": [42, 118, 6], "shoulderR": [68, 118, -6],
            "elbowL": [36, 106, 8], "elbowR": [74, 106, -8],
            "handL": [32, 92, 9], "handR": [72, 94, -9],
            "hipL": [48, 74, 5], "hipR": [66, 74, -5],
            "kneeL": [44, 44, 8], "kneeR": [72, 44, -8],
            "footL": [38, 10, 10], "footR": [78, 10, -10]}
    back = mirror_pose(mirror_pose(pose))
    for k in pose:
        assert np.allclose(back[k], pose[k]), (k, back[k], pose[k])


@register
def test_mirror_flips_and_swaps():
    pose = {"shoulderL": [50, 100, 6], "shoulderR": [70, 100, -6], "headR": 9}
    m = mirror_pose(pose, axis=60)
    # left shoulder was at x=50,z=6 -> becomes the RIGHT shoulder at x=70,z=-6
    assert m["shoulderR"] == [70, 100, -6]
    assert m["shoulderL"] == [50, 100, 6]
