# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "ultralytics>=8.3",
#   "torch",
#   "torchvision",
#   "numpy",
#   "pillow",
#   "scipy",
# ]
#
# # GPU build of PyTorch for a CUDA 13 driver (e.g. RTX 1000 Ada). uv pulls
# # torch/torchvision from this index instead of the CPU-only PyPI wheels.
# # CPU-only box? Delete the two blocks below and torch falls back to PyPI.
# [[tool.uv.index]]
# name = "pytorch-cu130"
# url = "https://download.pytorch.org/whl/cu130"
# explicit = true
#
# [tool.uv.sources]
# torch = { index = "pytorch-cu130" }
# torchvision = { index = "pytorch-cu130" }
# ///
"""
Ginga mocap: turn the Wikimedia "Ginga de dos" GIF into stick-figure keyframes.

Pipeline
  1. Read the GIF frames (Pillow).
  2. 2D pose per frame with Ultralytics YOLO-pose (COCO-17 keypoints).
     49 frames is trivial on CPU; a GPU just makes it instant.
  3. Retarget COCO-17 -> the Roda hero skeleton (separate L/R shoulders +
     hips + a neck, richer than the 52-card figure) in *image* coordinates.
  4. Fill low-confidence joints by temporal interpolation, then smooth each
     coordinate over time (Savitzky-Golay) to kill estimator jitter.
  5. Fit the whole sequence into Roda's 120x160 viewBox with ONE global
     scale+translate (feet anchored near the bottom) so the sway/bob is
     preserved without per-frame scale jitter.
  6. Emit assets/ginga.keyframes.js (window.GINGA = {...}); the GIF already
     loops, so the keyframe sequence loops seamlessly.
  Optional --qa writes a side-by-side (GIF | stick figure) montage GIF.

Run (from repo root):
  uv run tools/mocap/extract_ginga.py --qa
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageSequence, ImageDraw

# COCO-17 keypoint indices
NOSE, LEYE, REYE, LEAR, REAR = 0, 1, 2, 3, 4
LSHO, RSHO, LELB, RELB, LWRI, RWRI = 5, 6, 7, 8, 9, 10
LHIP, RHIP, LKNE, RKNE, LANK, RANK = 11, 12, 13, 14, 15, 16

# Roda hero skeleton: joints we export (image space, later normalized).
JOINTS = [
    "head", "neck",
    "shoulderL", "shoulderR",
    "elbowL", "handL", "elbowR", "handR",
    "hipL", "hipR",
    "kneeL", "footL", "kneeR", "footR",
]
# Bones drawn between joints (for QA render + mirrors the site figure).
BONES = [
    ("shoulderL", "shoulderR"), ("neck", "head"),
    ("neck", "hipL"), ("neck", "hipR"), ("hipL", "hipR"),
    ("shoulderL", "elbowL"), ("elbowL", "handL"),
    ("shoulderR", "elbowR"), ("elbowR", "handR"),
    ("hipL", "kneeL"), ("kneeL", "footL"),
    ("hipR", "kneeR"), ("kneeR", "footR"),
]
# Kinematic tree (parent -> child), topologically ordered from the pelvis
# "root" (virtual = hip midpoint). Used to rebuild a rigid, fixed-length
# skeleton from per-frame bone directions. "root" is not a real JOINT.
BONE_TREE = [
    ("root", "neck"), ("neck", "head"),
    ("neck", "shoulderL"), ("neck", "shoulderR"),
    ("shoulderL", "elbowL"), ("elbowL", "handL"),
    ("shoulderR", "elbowR"), ("elbowR", "handR"),
    ("root", "hipL"), ("root", "hipR"),
    ("hipL", "kneeL"), ("kneeL", "footL"),
    ("hipR", "kneeR"), ("kneeR", "footR"),
]
CONF = 0.30  # keypoint confidence floor


def load_frames(gif_path):
    img = Image.open(gif_path)
    return [f.convert("RGB") for f in ImageSequence.Iterator(img)]


def run_pose(frames, model_name, device=None):
    import time
    import torch
    from ultralytics import YOLO
    cuda = torch.cuda.is_available()
    if device is None:
        device = 0 if cuda else "cpu"
    on_gpu = cuda and str(device) not in ("cpu",)
    dev_name = torch.cuda.get_device_name(0) if on_gpu else "CPU"
    print(f"  torch {torch.__version__} | CUDA available: {cuda} | running on: {dev_name}")
    model = YOLO(model_name)
    # x,y,conf per keypoint; None where no person found.
    out = []
    t0 = time.perf_counter()
    for fr in frames:
        res = model.predict(np.asarray(fr), verbose=False, imgsz=640, device=device)[0]
        if res.keypoints is None or len(res.keypoints) == 0:
            out.append(None)
            continue
        data = res.keypoints.data.cpu().numpy()  # [persons,17,3]
        # pick the most confident / largest person
        if res.boxes is not None and len(res.boxes) == data.shape[0]:
            best = int(np.argmax(res.boxes.conf.cpu().numpy()))
        else:
            best = int(np.argmax(data[:, :, 2].sum(axis=1)))
        out.append(data[best])
    dt = time.perf_counter() - t0
    print(f"  {len(frames)} frames in {dt:.1f}s ({len(frames)/dt:.1f} fps)")
    return out


def _pt(kp, idx):
    x, y, c = kp[idx]
    return (float(x), float(y)) if c >= CONF else None


def _mid(a, b):
    if a and b:
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return a or b


def retarget(kps):
    """COCO-17 -> Roda joints, in image coordinates. Missing -> NaN."""
    F = len(kps)
    raw = {j: np.full((F, 2), np.nan) for j in JOINTS}
    for i, kp in enumerate(kps):
        if kp is None:
            continue
        lsho, rsho = _pt(kp, LSHO), _pt(kp, RSHO)
        lhip, rhip = _pt(kp, LHIP), _pt(kp, RHIP)
        # head = mean of whatever head points are visible (back view: ears).
        head_pts = [p for p in (_pt(kp, NOSE), _pt(kp, LEYE), _pt(kp, REYE),
                                 _pt(kp, LEAR), _pt(kp, REAR)) if p]
        head = (float(np.mean([p[0] for p in head_pts])),
                float(np.mean([p[1] for p in head_pts]))) if head_pts else None
        vals = {
            "head": head,
            "neck": _mid(lsho, rsho),
            "shoulderL": lsho, "shoulderR": rsho,
            "elbowL": _pt(kp, LELB), "handL": _pt(kp, LWRI),
            "elbowR": _pt(kp, RELB), "handR": _pt(kp, RWRI),
            "hipL": lhip, "hipR": rhip,
            "kneeL": _pt(kp, LKNE), "footL": _pt(kp, LANK),
            "kneeR": _pt(kp, RKNE), "footR": _pt(kp, RANK),
        }
        for j, v in vals.items():
            if v is not None:
                raw[j][i] = v
    return raw


def fill_and_smooth(raw):
    from scipy.signal import savgol_filter
    F = next(iter(raw.values())).shape[0]
    win = min(7, F if F % 2 else F - 1)
    if win % 2 == 0:
        win -= 1
    out = {}
    for j, arr in raw.items():
        a = arr.copy()
        for ax in range(2):
            col = a[:, ax]
            mask = ~np.isnan(col)
            if mask.sum() == 0:
                col[:] = 0.0
            elif mask.sum() < F:
                idx = np.arange(F)
                col[~mask] = np.interp(idx[~mask], idx[mask], col[mask])
            if win >= 3 and mask.sum() >= 3:
                col = savgol_filter(col, win, 2)
            a[:, ax] = col
        out[j] = a
    return out


def rigidify(poses):
    """Rebuild the skeleton with fixed bone lengths.

    2D pose estimators jitter bone *lengths* frame to frame (limbs visibly
    stretch/shrink). We keep each frame's measured bone *direction* but force a
    constant length per bone (its median over the clip), reconstructing joints
    by walking the kinematic tree from the pelvis root. Angles/motion are
    preserved; proportions stop wobbling, so the figure reads as one body.
    """
    F = next(iter(poses.values())).shape[0]
    root = (poses["hipL"] + poses["hipR"]) / 2.0          # virtual pelvis, [F,2]

    def parent_arr(name):
        return root if name == "root" else out[name]

    def data_arr(name):
        return root if name == "root" else poses[name]

    # Fixed length per bone = median measured length over the clip.
    lengths = {}
    for par, ch in BONE_TREE:
        d = data_arr(ch) - data_arr(par)
        lengths[(par, ch)] = float(np.nanmedian(np.hypot(d[:, 0], d[:, 1])))

    out = {}
    for par, ch in BONE_TREE:
        pdat, cdat = data_arr(par), data_arr(ch)
        vec = cdat - pdat
        norm = np.hypot(vec[:, 0], vec[:, 1])
        norm[norm < 1e-6] = 1e-6
        unit = vec / norm[:, None]                        # per-frame direction
        out[ch] = parent_arr(par) + unit * lengths[(par, ch)]
    return out


def normalize(poses, pad_x=12.0, top=14.0, bottom=152.0,
              sway_target=0.34, bob_target=0.30):
    """Fit the sequence into the 120x160 viewBox as an *in-place* ginga.

    The raw capture has the dancer stepping/swaying across more than a full
    body-length in image space — faithful, but as a looping hero figure it
    reads as lurching sideways and ends up tiny. So we keep the *shape* of the
    motion (every joint's offset from the pelvis) but damp the bodily
    translation: the pelvis's lateral swing and vertical bob are each scaled
    down to a tasteful fraction of a body-length. The legs still step and the
    weight still shifts; the torso just stays near center. Then one global
    scale anchors the lowest foot to the baseline and fills the frame.
    """
    from scipy.signal import savgol_filter
    F = next(iter(poses.values())).shape[0]
    hipmid = (poses["hipL"] + poses["hipR"]) / 2.0
    body = float(np.nanmedian(np.hypot(*(poses["neck"] - hipmid).T))) or 1.0

    win = F if F % 2 else F - 1
    # Lateral: remove slow travel (savgol drift), then damp the residual sway.
    driftx = savgol_filter(hipmid[:, 0], win, 2) if win >= 3 else hipmid[:, 0]
    rx = hipmid[:, 0] - driftx
    gx = min(1.0, sway_target * body / max(rx.max() - rx.min(), 1e-6))
    # Vertical: damp the bob around the mean hip height (keeps the rise/sink feel).
    ry = hipmid[:, 1] - hipmid[:, 1].mean()
    gy = min(1.0, bob_target * body / max(ry.max() - ry.min(), 1e-6))

    damped = {}
    for j, arr in poses.items():
        dx = arr[:, 0] - driftx - (1.0 - gx) * rx
        dy = arr[:, 1] - (1.0 - gy) * ry
        damped[j] = np.stack([dx, dy], axis=1)

    allpts = np.concatenate(list(damped.values()), axis=0)
    half_w = max(np.nanmax(np.abs(allpts[:, 0])), 1e-3)
    miny, maxy = np.nanmin(allpts[:, 1]), np.nanmax(allpts[:, 1])
    scale = min((120 - 2 * pad_x) / (2 * half_w), (bottom - top) / max(maxy - miny, 1e-3))

    frames = []
    for i in range(F):
        pose = {}
        for j, arr in damped.items():
            x, y = arr[i]
            pose[j] = [round(60.0 + x * scale, 2), round(bottom - (maxy - y) * scale, 2)]
        frames.append(pose)
    return frames


def write_js(frames, fps, out_path):
    payload = {
        "source": "Ginga de dos (Wikimedia Commons, CC BY-SA)",
        "fps": round(fps, 3),
        "frameMs": round(1000.0 / fps, 2),
        "viewBox": [120, 160],
        "joints": JOINTS,
        "bones": BONES,
        "frames": frames,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/mocap/extract_ginga.py — do not edit by hand.\n")
        f.write("window.GINGA = ")
        json.dump(payload, f, separators=(",", ":"))
        f.write(";\n")
    return payload


def qa_montage(src_frames, frames, out_gif, fps):
    scale = 2  # 120x160 -> 240x320
    pad = 16
    out = []
    for i, fr in enumerate(src_frames):
        L = fr
        R = Image.new("RGB", (120 * scale, 160 * scale), (23, 18, 13))
        d = ImageDraw.Draw(R)
        p = frames[i]
        for a, b in BONES:
            x1, y1 = p[a]; x2, y2 = p[b]
            d.line([x1 * scale, y1 * scale, x2 * scale, y2 * scale],
                   fill=(230, 212, 178), width=5)
        hx, hy = p["head"]
        d.ellipse([hx * scale - 14, hy * scale - 14, hx * scale + 14, hy * scale + 14],
                  fill=(235, 166, 60))
        h = max(L.height, R.height)
        canvas = Image.new("RGB", (L.width + pad + R.width, h), (10, 8, 6))
        canvas.paste(L, (0, (h - L.height) // 2))
        canvas.paste(R, (L.width + pad, (h - R.height) // 2))
        out.append(canvas)
    dur = int(1000 / fps)
    out[0].save(out_gif, save_all=True, append_images=out[1:], duration=dur, loop=0)
    print(f"  QA montage -> {out_gif}")


def _render_fig(pose, H):
    """Render one final-figure pose (120x160 viewBox) to a PIL image H px tall."""
    sc = H / 160.0
    W = round(120 * sc)
    im = Image.new("RGB", (W, H), (23, 18, 13))
    d = ImageDraw.Draw(im)
    for a, b in BONES:
        x1, y1 = pose[a]; x2, y2 = pose[b]
        d.line([x1 * sc, y1 * sc, x2 * sc, y2 * sc], fill=(230, 212, 178), width=max(3, int(5 * sc)))
    hx, hy = pose["head"]
    rr = max(5, int(7 * sc))
    d.ellipse([hx * sc - rr, hy * sc - rr, hx * sc + rr, hy * sc + rr], fill=(235, 166, 60))
    return im


def qa_sheet(src, poses_img, frames, out_png, n=9):
    """Vision-QA contact sheet: N columns sampled across the cycle, each column
    = source frame with the captured skeleton overlaid (top) over the final
    stick figure (bottom). One static PNG a human *or a vision model* can scan
    to judge how faithfully the figure tracks the dancer and how 'real' it reads.
    """
    F = len(src)
    idxs = [round(k * (F - 1) / (n - 1)) for k in range(n)]
    H, gap, bg = 230, 10, (12, 9, 7)
    cols = []
    for i in idxs:
        s = src[i].convert("RGB")
        sc = H / s.height
        s = s.resize((round(s.width * sc), H))
        d = ImageDraw.Draw(s)
        for a, b in BONES:
            pa, pb = poses_img[a][i], poses_img[b][i]
            if np.isnan(pa).any() or np.isnan(pb).any():
                continue
            d.line([pa[0] * sc, pa[1] * sc, pb[0] * sc, pb[1] * sc], fill=(124, 195, 107), width=4)
        hh = poses_img["head"][i]
        if not np.isnan(hh).any():
            d.ellipse([hh[0] * sc - 6, hh[1] * sc - 6, hh[0] * sc + 6, hh[1] * sc + 6], fill=(235, 166, 60))
        fig = _render_fig(frames[i], H)
        cw = max(s.width, fig.width)
        col = Image.new("RGB", (cw, H * 2 + gap), bg)
        col.paste(s, ((cw - s.width) // 2, 0))
        col.paste(fig, ((cw - fig.width) // 2, H + gap))
        cols.append(col)
    total_w = sum(c.width for c in cols) + gap * (len(cols) + 1)
    sheet = Image.new("RGB", (total_w, H * 2 + gap + 2 * gap), bg)
    x = gap
    for c in cols:
        sheet.paste(c, (x, gap))
        x += c.width + gap
    sheet.save(out_png)
    print(f"  QA contact sheet -> {out_png}")


def realism_report(frames, fps):
    """Quantitative realism proxies for the final animation. Catches the things
    that make a reconstructed figure look 'off': wobbling proportions, snappy
    (non-smooth) motion, and impossible joint angles."""
    J = {j: np.array([f[j] for f in frames], float) for j in JOINTS}
    torso = np.hypot(*(J["neck"] - ((J["hipL"] + J["hipR"]) / 2)).T)
    body = float(np.median(torso)) or 1.0

    bone_cv = {}
    for a, b in BONES:
        L = np.hypot(*(J[a] - J[b]).T)
        bone_cv[f"{a}-{b}"] = float(np.std(L) / max(np.mean(L), 1e-6))

    def ang(a, b, c):
        v1, v2 = J[a] - J[b], J[c] - J[b]
        cos = (v1 * v2).sum(1) / (np.hypot(*v1.T) * np.hypot(*v2.T) + 1e-9)
        return np.degrees(np.arccos(np.clip(cos, -1, 1)))

    knee = np.concatenate([ang("hipL", "kneeL", "footL"), ang("hipR", "kneeR", "footR")])
    elbow = np.concatenate([ang("shoulderL", "elbowL", "handL"), ang("shoulderR", "elbowR", "handR")])

    # smoothness: per-joint acceleration magnitude (frame^-2), normalized by body length
    acc = np.mean([np.hypot(*np.diff(J[j], 2, axis=0).T).mean() for j in JOINTS]) / body
    bob = float(J["neck"][:, 1].max() - J["neck"][:, 1].min()) / body
    hipcx = (J["hipL"][:, 0] + J["hipR"][:, 0]) / 2
    sway = float(hipcx.max() - hipcx.min()) / body

    worst = sorted(bone_cv.items(), key=lambda kv: -kv[1])[:3]
    cv_mean = float(np.mean(list(bone_cv.values())))

    def flag(ok):
        return "ok  " if ok else "WARN"

    print("  realism report:")
    print(f"    [{flag(cv_mean < 0.06)}] bone-length CV   mean {cv_mean:.3f}  "
          f"worst {', '.join(f'{k} {v:.2f}' for k, v in worst)}  (want <0.06)")
    print(f"    [{flag(knee.max() <= 188)}] knee angle       {knee.min():.0f}–{knee.max():.0f}°  (want <188)")
    print(f"    [{flag(elbow.max() <= 188)}] elbow angle      {elbow.min():.0f}–{elbow.max():.0f}°  (want <188)")
    print(f"    [{flag(acc < 0.12)}] motion accel     {acc:.3f} body/frame²  (want <0.12, smoother)")
    print(f"    [{flag(0.08 <= sway <= 0.45)}] sway             {sway:.2f} body-lengths  (want 0.08–0.45)")
    print(f"    [{flag(0.08 <= bob <= 0.6)}] bob              {bob:.2f} body-lengths  (want 0.08–0.6)")
    return {"bone_cv_mean": cv_mean, "knee_max": float(knee.max()),
            "accel": float(acc), "bob": bob, "sway": sway}


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    ap.add_argument("--gif", default=os.path.join(here, "assets", "ginga_de_dos.gif"))
    ap.add_argument("--out", default=os.path.join(root, "assets", "ginga.keyframes.js"))
    ap.add_argument("--model", default="yolo26x-pose.pt")
    ap.add_argument("--device", default=None,
                    help="0 for first GPU, cpu to force CPU; default auto-detects")
    ap.add_argument("--fps", type=float, default=50.0 / 3.0)  # GIF avg_frame_rate
    ap.add_argument("--no-rigid", action="store_true",
                    help="skip fixed-bone-length reconstruction (raw smoothed joints)")
    ap.add_argument("--qa", action="store_true",
                    help="write QA montage GIF + contact-sheet PNG for vision review")
    ap.add_argument("--dry-run", action="store_true",
                    help="analyze + QA only; do not overwrite the keyframes file")
    args = ap.parse_args()

    print(f"Reading {args.gif}")
    src = load_frames(args.gif)
    print(f"  {len(src)} frames @ {src[0].size}")
    print(f"Pose estimation with {args.model} ...")
    kps = run_pose(src, args.model, device=args.device)
    found = sum(1 for k in kps if k is not None)
    print(f"  person found in {found}/{len(src)} frames")
    if found < len(src) * 0.5:
        print("  WARNING: pose found in <50% of frames", file=sys.stderr)

    raw = retarget(kps)
    poses = fill_and_smooth(raw)
    if not args.no_rigid:
        poses = rigidify(poses)
        print("  rigid-skeleton normalization: bone lengths fixed to clip medians")
    frames = normalize(poses)

    realism_report(frames, args.fps)
    if args.dry_run:
        print("  --dry-run: keyframes NOT written")
    else:
        payload = write_js(frames, args.fps, args.out)
        print(f"Wrote {len(frames)} keyframes -> {args.out}")

    if args.qa:
        qa_dir = os.path.join(root, "tools", "shots")
        os.makedirs(qa_dir, exist_ok=True)
        tag = "_norigid" if args.no_rigid else ""
        qa_montage(src, frames, os.path.join(qa_dir, f"ginga_qa{tag}.gif"), round(args.fps, 3))
        qa_sheet(src, poses, frames, os.path.join(qa_dir, f"ginga_sheet{tag}.png"))


if __name__ == "__main__":
    main()
