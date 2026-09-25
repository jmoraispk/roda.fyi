"""Motion format v2 (docs/motion-format-v2.md): 29-joint skeleton, derived joints,
ground contacts, document assembly/validation, and the v2 -> v1 downgrade."""
from run_tests import register
import re
import numpy as np
import geom

JOINTS_V2 = [
    "pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee", "spine2",
    "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot", "neck",
    "left_collar", "right_collar", "head", "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow", "left_wrist", "right_wrist",
    "nose", "left_ear", "right_ear", "left_heel", "right_heel", "left_hand_tip", "right_hand_tip",
]
V2 = {n: i for i, n in enumerate(JOINTS_V2)}

MP_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index"]
MP = {n: i for i, n in enumerate(MP_NAMES)}

# The 17 landmarks the cameras actually see, as (v2 name, MediaPipe name).
OBSERVED = [
    ("nose", "nose"), ("left_ear", "left_ear"), ("right_ear", "right_ear"),
    ("left_shoulder", "left_shoulder"), ("right_shoulder", "right_shoulder"),
    ("left_elbow", "left_elbow"), ("right_elbow", "right_elbow"),
    ("left_wrist", "left_wrist"), ("right_wrist", "right_wrist"),
    ("left_hand_tip", "left_index"), ("right_hand_tip", "right_index"),
    ("left_hip", "left_hip"), ("right_hip", "right_hip"),
    ("left_knee", "left_knee"), ("right_knee", "right_knee"),
    ("left_ankle", "left_ankle"), ("right_ankle", "right_ankle"),
    ("left_heel", "left_heel"), ("right_heel", "right_heel"),
    ("left_foot", "left_foot_index"), ("right_foot", "right_foot_index"),
]
OBS_NAMES = [v for v, _ in OBSERVED]
OBS_MP = np.array([MP[m] for _, m in OBSERVED])
OBS = {n: i for i, n in enumerate(OBS_NAMES)}

# Parent -> child bone tree over the v2 joints (for drawing and rigidify).
BONES_V2 = [
    ("pelvis", "left_hip"), ("pelvis", "right_hip"), ("pelvis", "spine1"),
    ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
    ("left_ankle", "left_heel"), ("left_ankle", "left_foot"),
    ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
    ("right_ankle", "right_heel"), ("right_ankle", "right_foot"),
    ("spine1", "spine2"), ("spine2", "spine3"), ("spine3", "neck"), ("neck", "head"),
    ("head", "nose"), ("head", "left_ear"), ("head", "right_ear"),
    ("spine3", "left_collar"), ("left_collar", "left_shoulder"),
    ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"), ("left_wrist", "left_hand_tip"),
    ("spine3", "right_collar"), ("right_collar", "right_shoulder"),
    ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"), ("right_wrist", "right_hand_tip"),
]

EFFECTORS = {
    "left_foot": ["left_ankle", "left_heel", "left_foot"],
    "right_foot": ["right_ankle", "right_heel", "right_foot"],
    "left_hand": ["left_wrist", "left_hand_tip"],
    "right_hand": ["right_wrist", "right_hand_tip"],
}

_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def mp_to_observed(a33):
    """[..., 33, D] MediaPipe-ordered array -> [..., 21, D] observed landmarks."""
    return np.asarray(a33)[..., OBS_MP, :]


def _lerp(a, b, t):
    return a + (b - a) * t


def observed_to_v2(obs):
    """[F, 21, 3] observed landmarks -> [F, 29, 3] full v2 skeleton (derived joints
    are the geometric estimates documented in docs/motion-format-v2.md)."""
    o = np.asarray(obs, float)
    out = np.zeros(o.shape[:-2] + (len(JOINTS_V2), 3))
    for n in OBS_NAMES:
        out[..., V2[n], :] = o[..., OBS[n], :]
    g = lambda n: out[..., V2[n], :]  # noqa: E731
    pelvis = (g("left_hip") + g("right_hip")) / 2
    sho = (g("left_shoulder") + g("right_shoulder")) / 2
    head = (g("left_ear") + g("right_ear")) / 2
    spine3 = _lerp(pelvis, sho, 0.75)
    out[..., V2["pelvis"], :] = pelvis
    out[..., V2["spine1"], :] = _lerp(pelvis, sho, 0.25)
    out[..., V2["spine2"], :] = _lerp(pelvis, sho, 0.50)
    out[..., V2["spine3"], :] = spine3
    out[..., V2["head"], :] = head
    out[..., V2["neck"], :] = _lerp(sho, head, 0.30)
    for side in ("left", "right"):
        c = _lerp(sho, g(f"{side}_shoulder"), 0.40)
        out[..., V2[f"{side}_collar"], :] = _lerp(c, spine3, 0.20)
    return out


def rigidify_observed(obs):
    """Constant bone lengths over time for the observed landmarks (keeps each bone's
    per-frame direction, sets its median length), rooted at the hip mid-point."""
    a = np.asarray(obs, float).copy()
    tree = [("root", "left_hip"), ("root", "right_hip"),
            ("root", "left_shoulder"), ("root", "right_shoulder"),
            ("left_shoulder", "left_ear"), ("right_shoulder", "right_ear"),
            ("left_shoulder", "nose"),
            ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"), ("left_wrist", "left_hand_tip"),
            ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"), ("right_wrist", "right_hand_tip"),
            ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
            ("left_ankle", "left_heel"), ("left_ankle", "left_foot"),
            ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
            ("right_ankle", "right_heel"), ("right_ankle", "right_foot")]
    root = (a[:, OBS["left_hip"]] + a[:, OBS["right_hip"]]) / 2
    get = lambda src, n: root if n == "root" else src[:, OBS[n]]  # noqa: E731
    out = np.zeros_like(a)
    for par, ch in tree:
        vec = get(a, ch) - get(a, par)
        L = float(np.median(np.linalg.norm(vec, axis=1)))
        nrm = np.linalg.norm(vec, axis=1, keepdims=True)
        nrm[nrm < 1e-9] = 1e-9
        out[:, OBS[ch]] = get(out, par) + vec / nrm * L
    return out


def ground(frames):
    """Shift y so the floor is y=0: the median over frames of the per-frame lowest
    point (something is on the floor in almost every frame, even mid-aú)."""
    P = np.asarray(frames, float).copy()
    P[..., 1] -= float(np.median(P[..., 1].min(axis=1)))
    return P


def contacts(frames, fps, h_foot=0.06, h_hand=0.08, v_max=0.6):
    """Per-frame 0/1 ground-contact flags for feet and hands. frames: [F,29,3] grounded."""
    P = np.asarray(frames, float)
    out = {}
    for eff, names in EFFECTORS.items():
        pts = P[:, [V2[n] for n in names]]                    # [F,k,3]
        low = pts[np.arange(len(P)), pts[..., 1].argmin(axis=1)]  # lowest point per frame
        vel = np.zeros(len(P))
        if len(P) > 1:
            d = np.linalg.norm(np.diff(low, axis=0), axis=1) * fps
            vel = np.concatenate([d[:1], d])
            vel = np.minimum(vel, np.concatenate([d, d[-1:]]))  # stationary on either side
        h = h_foot if eff.endswith("foot") else h_hand
        out[eff] = [int(y < h and v < v_max) for y, v in zip(low[:, 1], vel)]
    return out


def variant_key(variant):
    return ".".join(variant.get(k) or "default" for k in ("start", "middle", "end"))


def make_doc(slug, variant, fps, frames, stances, source, quality=None):
    """Assemble a v2 document from a [F,29,3] y-up metric track (not yet grounded)."""
    P = ground(frames)
    P[..., 0] -= P[0, V2["pelvis"], 0]
    P[..., 2] -= P[0, V2["pelvis"], 2]
    variant = {k: (variant or {}).get(k) or "default" for k in ("start", "middle", "end")}
    doc = {
        "version": 2, "kind": "move", "slug": slug, "variant": variant,
        "fps": fps, "units": "m", "axes": "x right, y up, z toward viewer",
        "joints": JOINTS_V2,
        "frames": np.round(P, 3).tolist(),
        "contacts": contacts(P, fps),
        "stances": {"start": stances.get("start") or "unknown", "end": stances.get("end") or "unknown"},
        "source": source,
    }
    if quality:
        doc["quality"] = quality
    validate_doc(doc)
    return doc


def validate_doc(doc):
    """Raise AssertionError if `doc` breaks the v2 contract."""
    assert doc.get("version") == 2, "version must be 2"
    assert doc.get("kind") in ("move", "transition")
    assert _SLUG.match(doc.get("slug", "")) or doc.get("kind") == "transition", doc.get("slug")
    for k in ("start", "middle", "end"):
        assert _SLUG.match(doc["variant"][k]), ("bad variant part", doc["variant"][k])
    assert doc["units"] == "m" and doc["axes"] == "x right, y up, z toward viewer"
    assert doc["joints"] == JOINTS_V2
    F = len(doc["frames"])
    assert F >= 2 and doc["fps"] > 0
    arr = np.asarray(doc["frames"], float)
    assert arr.shape == (F, len(JOINTS_V2), 3), arr.shape
    assert np.all(np.isfinite(arr)), "non-finite coordinates"
    assert set(doc["contacts"]) == set(EFFECTORS)
    for eff, flags in doc["contacts"].items():
        assert len(flags) == F and set(flags) <= {0, 1}, eff
    assert {"start", "end"} <= set(doc["stances"])
    for k in ("front", "side", "reps", "method"):
        assert k in doc["source"], ("source missing", k)
    return True


V1_FROM_V2 = {
    "shoulderL": "left_shoulder", "shoulderR": "right_shoulder",
    "elbowL": "left_elbow", "elbowR": "right_elbow",
    "handL": "left_wrist", "handR": "right_wrist",
    "hipL": "left_hip", "hipR": "right_hip",
    "kneeL": "left_knee", "kneeR": "right_knee",
    "footL": "left_ankle", "footR": "right_ankle",
}


def v2_to_v1_array(frames):
    """[F,29,3] v2 frames -> [F,13,3] in geom.JOINTS3D order (same axes)."""
    P = np.asarray(frames, float)
    out = np.zeros((P.shape[0], len(geom.JOINTS3D), 3))
    for i, j in enumerate(geom.JOINTS3D):
        if j == "head":
            out[:, i] = (P[:, V2["left_ear"]] + P[:, V2["right_ear"]]) / 2
        else:
            out[:, i] = P[:, V2[V1_FROM_V2[j]]]
    return out


# ---------- tests ----------
def _standing_obs(F=10):
    """Upright figure (metres, y up), facing +z, left hand side on +x."""
    base = {
        "nose": [0, 1.62, 0.10], "left_ear": [0.08, 1.63, 0], "right_ear": [-0.08, 1.63, 0],
        "left_shoulder": [0.19, 1.42, 0], "right_shoulder": [-0.19, 1.42, 0],
        "left_elbow": [0.22, 1.12, 0], "right_elbow": [-0.22, 1.12, 0],
        "left_wrist": [0.23, 0.86, 0.02], "right_wrist": [-0.23, 0.86, 0.02],
        "left_hand_tip": [0.23, 0.70, 0.04], "right_hand_tip": [-0.23, 0.70, 0.04],
        "left_hip": [0.10, 0.92, 0], "right_hip": [-0.10, 0.92, 0],
        "left_knee": [0.11, 0.50, 0.02], "right_knee": [-0.11, 0.50, 0.02],
        "left_ankle": [0.11, 0.08, 0], "right_ankle": [-0.11, 0.08, 0],
        "left_heel": [0.11, 0.03, -0.05], "right_heel": [-0.11, 0.03, -0.05],
        "left_foot": [0.12, 0.02, 0.14], "right_foot": [-0.12, 0.02, 0.14],
    }
    one = np.array([base[n] for n in OBS_NAMES], float)
    return np.tile(one[None], (F, 1, 1))


@register
def test_v2_joint_list_matches_contract():
    assert len(JOINTS_V2) == 29 and JOINTS_V2[0] == "pelvis" and JOINTS_V2[21] == "right_wrist"
    assert len(OBS_NAMES) == 21 and len(set(OBS_NAMES)) == 21
    assert all(n in V2 for n in OBS_NAMES)
    for a, b in BONES_V2:
        assert a in V2 and b in V2


@register
def test_observed_to_v2_derived_joints():
    v2 = observed_to_v2(_standing_obs(3))
    assert v2.shape == (3, 29, 3)
    pel, sho = v2[0, V2["pelvis"]], (v2[0, V2["left_shoulder"]] + v2[0, V2["right_shoulder"]]) / 2
    assert np.allclose(pel, [0, 0.92, 0])
    assert np.allclose(v2[0, V2["spine2"]], (pel + sho) / 2)
    ys = [v2[0, V2[n], 1] for n in ("pelvis", "spine1", "spine2", "spine3", "neck", "head")]
    assert all(a < b for a, b in zip(ys, ys[1:])), ys           # spine climbs monotonically
    assert v2[0, V2["left_collar"], 0] > 0 > v2[0, V2["right_collar"], 0]


@register
def test_contacts_standing_and_lifted():
    P = observed_to_v2(_standing_obs(12))
    P[6:, V2["right_ankle"], 1] += 0.4                            # right foot kicks up
    P[6:, V2["right_heel"], 1] += 0.4
    P[6:, V2["right_foot"], 1] += 0.4
    c = contacts(ground(P), 30)
    assert c["left_foot"] == [1] * 12
    assert c["right_foot"][:5] == [1] * 5 and c["right_foot"][7:] == [0] * 5
    assert c["left_hand"] == [0] * 12


@register
def test_make_doc_roundtrip_valid():
    P = observed_to_v2(_standing_obs(8))
    P[..., 0] += 3.0                                              # arbitrary camera offset
    doc = make_doc("au", {"start": "ginga-left-back"}, 30, P, {"start": "ginga-left-back", "end": "paralela"},
                   {"front": {}, "side": {}, "reps": {}, "method": "test"})
    arr = np.asarray(doc["frames"])
    assert doc["variant"] == {"start": "ginga-left-back", "middle": "default", "end": "default"}
    assert variant_key(doc["variant"]) == "ginga-left-back.default.default"
    assert abs(arr[0, V2["pelvis"], 0]) < 1e-9 and abs(arr[0, V2["pelvis"], 2]) < 1e-9
    assert abs(arr[..., 1].min(axis=1).max()) < 1e-3              # grounded: lowest point on y=0
    bad = dict(doc, frames=doc["frames"][:1])
    try:
        validate_doc(bad)
        raise RuntimeError("validate_doc accepted a 1-frame doc")
    except AssertionError:
        pass


@register
def test_v2_to_v1_head_and_feet():
    P = observed_to_v2(_standing_obs(2))
    v1 = v2_to_v1_array(P)
    JI = {j: i for i, j in enumerate(geom.JOINTS3D)}
    assert np.allclose(v1[0, JI["head"]], [0, 1.63, 0])
    assert np.allclose(v1[0, JI["footL"]], [0.11, 0.08, 0])       # v1 foot = ankle
    assert v1[0, JI["shoulderL"], 0] > 0                          # left stays on +x


@register
def test_rigidify_observed_constant_lengths():
    rs = np.random.RandomState(7)
    o = _standing_obs(20) + rs.randn(20, 21, 3) * 0.01
    r = rigidify_observed(o)
    L = np.linalg.norm(r[:, OBS["left_knee"]] - r[:, OBS["left_ankle"]], axis=1)
    assert L.std() < 1e-9
