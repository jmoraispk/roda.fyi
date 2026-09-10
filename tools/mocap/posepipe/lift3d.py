"""2D->3D lifting with MotionBERT (DSTformer), following the official wild recipe.

Input is the per-frame COCO-17 2D track (image px + score). We convert to H36M-17,
normalise the WHOLE sequence with MotionBERT's crop_scale (so overlapping clips share
one frame), run DSTformer over overlapping 243-frame windows (flip TTA, root-relative
output), average the overlaps, then return a metric, MediaPipe-world-convention track.
"""
import numpy as np
import torch

from .dstformer import load_dstformer
from .keypoint_map import coco2h36m

CLIP = 243
STRIDE = 81
FLIP_L = [4, 5, 6, 11, 12, 13]
FLIP_R = [1, 2, 3, 14, 15, 16]
# MediaPipe world is metric metres with the torso ~0.5 m; MotionBERT output is
# normalised (~unit). Scale so a typical shoulder->hip spans ~0.5 m (see calibrate()).
SCALE_M = 1.8
Z_SIGN = 1.0   # set so a front-facing subject reads as "front" after mp_world_to_roda


def _crop_scale(motion):
    """Port of MotionBERT crop_scale (ratio=1): normalise (T,17,3) xy to [-1,1] by the
    sequence bbox of confident joints; confidence kept in channel 2."""
    res = motion.copy()
    valid = motion[motion[..., 2] != 0][:, :2]
    if len(valid) < 4:
        return np.zeros_like(motion)
    xmin, xmax = valid[:, 0].min(), valid[:, 0].max()
    ymin, ymax = valid[:, 1].min(), valid[:, 1].max()
    scale = max(xmax - xmin, ymax - ymin)
    if scale == 0:
        return np.zeros_like(motion)
    xs = (xmin + xmax - scale) / 2
    ys = (ymin + ymax - scale) / 2
    res[..., :2] = (motion[..., :2] - [xs, ys]) / scale
    res[..., :2] = (res[..., :2] - 0.5) * 2
    return np.clip(res, -1, 1)


def _flip(x):
    f = x.clone()
    f[..., 0] *= -1
    f[..., FLIP_L + FLIP_R, :] = f[..., FLIP_R + FLIP_L, :]
    return f


def lift(coco17, scores, det_mask, ckpt_path, device="cuda:0"):
    """coco17: (T,17,2) image px. scores: (T,17). det_mask: (T,) bool.
    Returns world17 (T,17,3) in MediaPipe-world convention (metres) and vis (T,17)."""
    T = coco17.shape[0]
    xy = coco17.astype(np.float32).copy()
    sc = scores.astype(np.float32).copy()
    # interpolate undetected/zero-score frames in 2D so the lifter sees a clean sequence
    idx = np.arange(T)
    good = det_mask.copy()
    if good.sum() < 2:
        return np.zeros((T, 17, 3), np.float32), np.zeros((T, 17), np.float32)
    for j in range(17):
        for c in range(2):
            col = xy[:, j, c]
            xy[:, j, c] = np.interp(idx, idx[good], col[good])
        scol = sc[:, j]
        sc[:, j] = np.interp(idx, idx[good], scol[good])

    motion = np.concatenate([xy, sc[..., None]], axis=2)        # (T,17,3) COCO
    h36m = coco2h36m(motion)                                    # (T,17,3) H36M
    norm = _crop_scale(h36m)                                    # global normalise

    model = load_dstformer(ckpt_path, device)
    inp = torch.from_numpy(norm).float().to(device)             # (T,17,3)

    acc = torch.zeros(T, 17, 3, device=device)
    wsum = torch.zeros(T, 1, 1, device=device)
    starts = list(range(0, max(T - CLIP, 0) + 1, STRIDE))
    if not starts or starts[-1] + CLIP < T:
        starts.append(max(T - CLIP, 0))
    with torch.inference_mode():
        for st in starts:
            en = min(st + CLIP, T)
            clip = inp[st:en].unsqueeze(0)                      # (1,f,17,3)
            pred = model(clip)
            pred_f = _flip(model(_flip(clip)))
            pred = (pred + pred_f) * 0.5
            pred[:, :, 0, :] = 0                                # root-relative
            f = en - st
            # triangular weights so overlap blends smoothly
            w = torch.minimum(torch.arange(1, f + 1, device=device),
                              torch.arange(f, 0, -1, device=device)).float()
            acc[st:en] += pred[0] * w[:, None, None]
            wsum[st:en] += w[:, None, None]
    out = (acc / wsum.clamp(min=1e-6)).cpu().numpy()           # (T,17,3) normalised, y-down

    # to MediaPipe-world convention: x-right, y-down, z=+away; metric; root at hip(0)
    out[..., 2] *= Z_SIGN
    out *= SCALE_M
    out = out - out[:, 0:1, :]                                  # root = mid-hip
    vis = np.clip(sc, 0, 1)
    return out.astype(np.float32), vis
