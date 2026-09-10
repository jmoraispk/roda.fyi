"""Keypoint index maps: Sapiens Goliath-308 -> MediaPipe-33 and -> COCO-17 -> H36M-17.

Goliath-308 output order is the goliath.py `keypoint_info` order with the 36 teeth
keypoints dropped; every index we use is < 220 (before the teeth block), so the
output channel index equals the goliath id. Verified against the Sapiens-lite
GOLIATH_KPTS_COLORS table.
"""

# 33 MediaPipe landmark names, in MediaPipe order (index = position).
MP_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index",
]

# MediaPipe index -> Goliath-308 channel index.
# Eyes: MediaPipe splits inner/center/outer; Goliath has a single eye centre, so the
# three MP eye slots all read the same Goliath eye (downstream only uses `nose` for
# the head joint, so this is QA-only detail). Wrists live in the hand block (41/62).
MP_TO_GOLIATH = [
    0,    # 0  nose
    1,    # 1  left_eye_inner   -> left_eye
    1,    # 2  left_eye
    1,    # 3  left_eye_outer   -> left_eye
    2,    # 4  right_eye_inner  -> right_eye
    2,    # 5  right_eye
    2,    # 6  right_eye_outer  -> right_eye
    3,    # 7  left_ear
    4,    # 8  right_ear
    189,  # 9  mouth_left       -> l_outer_corner_of_mouth
    188,  # 10 mouth_right      -> r_outer_corner_of_mouth
    5,    # 11 left_shoulder
    6,    # 12 right_shoulder
    7,    # 13 left_elbow
    8,    # 14 right_elbow
    62,   # 15 left_wrist
    41,   # 16 right_wrist
    58,   # 17 left_pinky       -> left_pinky_finger4 (tip)
    37,   # 18 right_pinky      -> right_pinky_finger4
    46,   # 19 left_index       -> left_forefinger4
    25,   # 20 right_index      -> right_forefinger4
    42,   # 21 left_thumb       -> left_thumb4
    21,   # 22 right_thumb      -> right_thumb4
    9,    # 23 left_hip
    10,   # 24 right_hip
    11,   # 25 left_knee
    12,   # 26 right_knee
    13,   # 27 left_ankle
    14,   # 28 right_ankle
    17,   # 29 left_heel
    20,   # 30 right_heel
    15,   # 31 left_foot_index  -> left_big_toe
    18,   # 32 right_foot_index -> right_big_toe
]
assert len(MP_NAMES) == len(MP_TO_GOLIATH) == 33

# COCO-17 (standard order) -> Goliath-308 channel index, used to feed MotionBERT.
# COCO: nose, l/r eye, l/r ear, l/r shoulder, l/r elbow, l/r wrist, l/r hip, l/r knee, l/r ankle.
COCO17_TO_GOLIATH = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 62, 41, 9, 10, 11, 12, 13, 14,
]
assert len(COCO17_TO_GOLIATH) == 17


def coco2h36m(x):
    """COCO-17 (T,17,C) -> H36M-17 (T,17,C). Port of MotionBERT lib.utils.utils_data."""
    import numpy as np
    T, V, C = x.shape
    y = np.zeros((T, 17, C), dtype=x.dtype)
    y[:, 0] = (x[:, 11] + x[:, 12]) * 0.5   # hip (pelvis)
    y[:, 1] = x[:, 12]                       # right hip
    y[:, 2] = x[:, 14]                       # right knee
    y[:, 3] = x[:, 16]                       # right ankle
    y[:, 4] = x[:, 11]                       # left hip
    y[:, 5] = x[:, 13]                       # left knee
    y[:, 6] = x[:, 15]                       # left ankle
    y[:, 8] = (x[:, 5] + x[:, 6]) * 0.5      # thorax (mid shoulder)
    y[:, 7] = (y[:, 0] + y[:, 8]) * 0.5      # spine
    y[:, 9] = (x[:, 1] + x[:, 2]) * 0.5      # neck/nose region (mid eye)
    y[:, 10] = x[:, 0]                        # head -> nose
    y[:, 11] = x[:, 5]                        # left shoulder
    y[:, 12] = x[:, 7]                        # left elbow
    y[:, 13] = x[:, 9]                        # left wrist
    y[:, 14] = x[:, 6]                        # right shoulder
    y[:, 15] = x[:, 8]                        # right elbow
    y[:, 16] = x[:, 10]                       # right wrist
    return y


# H36M-17 index -> MediaPipe-33 index (for filling `world` from the lifter output).
# The 13 joints retarget.mp_world_to_roda consumes are all covered here.
H36M_TO_MP = {
    10: 0,   # head -> nose
    11: 11,  # left shoulder
    14: 12,  # right shoulder
    12: 13,  # left elbow
    15: 14,  # right elbow
    13: 15,  # left wrist
    16: 16,  # right wrist
    4: 23,   # left hip
    1: 24,   # right hip
    5: 25,   # left knee
    2: 26,   # right knee
    6: 27,   # left ankle
    3: 28,   # right ankle
}
