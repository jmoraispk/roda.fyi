# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "ultralytics>=8.3",
#   "torch",
#   "torchvision",
#   "numpy",
# ]
#
# # GPU build of PyTorch for a CUDA 13 driver (same as extract_ginga.py).
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
Batch pose extraction over the downloaded capoeira clips.

For every clip in clips/manifest.json (or any video passed on the CLI) this:
  1. probes size/fps with ffprobe,
  2. decodes frames through an ffmpeg rawvideo pipe (robust for webm/ogv on
     Windows, where cv2.VideoCapture often can't open VP8/VP9),
  3. runs Ultralytics YOLO26x-pose (COCO-17) on the GPU, batched,
  4. picks the *dominant* person per frame (confidence x box-area, with light
     continuity toward the previous pick) — roda footage has 2+ people, so
     this is a heuristic that the review library exists to correct,
  5. writes out/<clip>.pose.json with NORMALIZED keypoints (0..1) + per-point
     and per-frame confidence + the clip's CC provenance.
Finally it writes out/index.json so tools/review/ can list everything.

The review tool overlays these keypoints onto the source <video> in the
browser, so we keep raw normalized COCO-17 here and do no retargeting/smoothing
(that is the ginga pipeline's job once a clean clip+range has been chosen).

Run (from repo root):
  uv run tools/mocap/extract_moves.py                 # all clips, GPU
  uv run tools/mocap/extract_moves.py --fps 15 --device cpu
  uv run tools/mocap/extract_moves.py path/to/one.webm
"""
import argparse, glob, json, os, subprocess, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
OUT = os.path.join(HERE, "out")

COCO = ["nose", "eyeL", "eyeR", "earL", "earR", "shoL", "shoR", "elbL", "elbR",
        "wriL", "wriR", "hipL", "hipR", "kneeL", "kneeR", "ankL", "ankR"]


def ffprobe(path):
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
           "stream=width,height,r_frame_rate:format=duration", "-of", "json", path]
    j = json.loads(subprocess.check_output(cmd))
    st = j["streams"][0]
    num, den = (st["r_frame_rate"].split("/") + ["1"])[:2]
    fps = float(num) / float(den or 1)
    dur = float(j.get("format", {}).get("duration", 0) or 0)
    return int(st["width"]), int(st["height"]), fps, dur


def decode_frames(path, sample_fps, max_w):
    """Yield (w, h) then RGB uint8 arrays, decoded via an ffmpeg pipe."""
    W, H, src_fps, dur = ffprobe(path)
    ow = min(max_w, W)
    ow -= ow % 2
    oh = round(H * ow / W)
    oh -= oh % 2
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf",
           f"fps={sample_fps},scale={ow}:{oh}", "-f", "rawvideo",
           "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = ow * oh * 3
    yield (ow, oh, dur)
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(oh, ow, 3)
    proc.stdout.close()
    proc.wait()


def load_model(model_name, device):
    import torch
    from ultralytics import YOLO
    cuda = torch.cuda.is_available()
    if device is None:
        device = 0 if cuda else "cpu"
    on_gpu = cuda and str(device) != "cpu"
    print(f"  torch {torch.__version__} | CUDA: {cuda} | "
          f"device: {torch.cuda.get_device_name(0) if on_gpu else 'CPU'}")
    return YOLO(model_name), device


def pick_person(data, boxes_xywh, prev_center, diag):
    """data:[P,17,3], boxes_xywh:[P,4]. Return (kp[17,3], center) or (None,prev)."""
    best, best_score, best_center = None, -1.0, prev_center
    for i in range(data.shape[0]):
        mc = float(data[i, :, 2].mean())
        if mc < 0.25:
            continue
        cx, cy, bw, bh = [float(v) for v in boxes_xywh[i]]
        score = mc * (bw * bh) ** 0.5
        if prev_center is not None:
            d = ((cx - prev_center[0]) ** 2 + (cy - prev_center[1]) ** 2) ** 0.5
            score *= np.exp(-(d / (0.35 * diag)) ** 2) + 0.15  # favor continuity
        if score > best_score:
            best, best_score, best_center = data[i], score, (cx, cy)
    return best, best_center


def process(path, model, device, sample_fps, max_w, prov):
    name = os.path.splitext(os.path.basename(path))[0]
    gen = decode_frames(path, sample_fps, max_w)
    ow, oh, dur = next(gen)
    diag = (ow ** 2 + oh ** 2) ** 0.5
    frames = list(gen)
    print(f"  {name}: {len(frames)} frames @ {sample_fps}fps  {ow}x{oh}")

    t0 = time.perf_counter()
    raw = []  # (data[P,17,3], xywh[P,4]) per frame
    B = 16
    for s in range(0, len(frames), B):
        batch = [f[:, :, ::-1] for f in frames[s:s + B]]  # RGB->BGR for ultralytics
        for res in model.predict(batch, verbose=False, imgsz=640, device=device):
            if res.keypoints is None or len(res.keypoints) == 0:
                raw.append((None, None))
            else:
                raw.append((res.keypoints.data.cpu().numpy(),
                            res.boxes.xywh.cpu().numpy() if res.boxes is not None else None))
    dt = time.perf_counter() - t0
    print(f"    pose: {len(frames)} frames in {dt:.1f}s ({len(frames)/max(dt,1e-6):.1f} fps)")

    out_frames, prev_center = [], None
    for i, (data, xywh) in enumerate(raw):
        kp = None
        if data is not None and xywh is not None:
            kp, prev_center = pick_person(data, xywh, prev_center, diag)
        if kp is None:
            out_frames.append({"t": round(i / sample_fps, 3), "c": 0.0, "k": None})
            continue
        k = [[round(float(x) / ow, 4), round(float(y) / oh, 4), round(float(c), 3)]
             for (x, y, c) in kp]
        mc = round(float(np.mean([p[2] for p in k])), 3)
        out_frames.append({"t": round(i / sample_fps, 3), "c": mc, "k": k})

    detected = sum(1 for f in out_frames if f["k"])
    doc = {
        "file": os.path.basename(path),
        "names": COCO,
        "w": ow, "h": oh, "fps": sample_fps, "dur": round(dur, 2),
        "n": len(out_frames), "detected": detected,
        "meanconf": round(float(np.mean([f["c"] for f in out_frames if f["k"]] or [0])), 3),
        "source": prov,
        "frames": out_frames,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{name}.pose.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    return {k: doc[k] for k in ("file", "w", "h", "fps", "dur", "n", "detected",
                                "meanconf", "source")} | {"pose": f"{name}.pose.json"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="*", help="specific video files (default: manifest)")
    ap.add_argument("--model", default="yolo26x-pose.pt")
    ap.add_argument("--fps", type=int, default=12, help="sample fps")
    ap.add_argument("--max-w", type=int, default=720, help="downscale width for inference")
    ap.add_argument("--device", default=None, help="0 / cpu (default: GPU if present)")
    ap.add_argument("--redo", action="store_true",
                    help="re-pose clips that already have out/<name>.pose.json "
                         "(default: skip them, so a rerun only does the leftover)")
    args = ap.parse_args()

    prov_by_file = {}
    mpath = os.path.join(CLIPS, "manifest.json")
    if os.path.exists(mpath):
        for it in json.load(open(mpath, encoding="utf-8")):
            prov_by_file[it["file"]] = {k: it.get(k) for k in
                                        ("title", "page", "author", "license",
                                         "moves", "slug", "query")}

    if args.clips:
        paths = args.clips
    else:
        paths = sorted(glob.glob(os.path.join(CLIPS, "*.webm")) +
                       glob.glob(os.path.join(CLIPS, "*.ogv")) +
                       glob.glob(os.path.join(CLIPS, "*.mp4")))
    if not paths:
        print("No clips found. Run fetch_clips.py first.", file=sys.stderr)
        sys.exit(1)

    INDEX_KEYS = ("file", "w", "h", "fps", "dur", "n", "detected", "meanconf")
    model = device = None
    index = []
    for p in paths:
        name = os.path.splitext(os.path.basename(p))[0]
        posefile = os.path.join(OUT, f"{name}.pose.json")
        prov = prov_by_file.get(os.path.basename(p), {"title": os.path.basename(p)})
        # Skip clips already posed (so a rerun only does the leftover); still
        # list them in the index, refreshing move-tags/provenance from manifest.
        if not args.redo and os.path.exists(posefile):
            try:
                d = json.load(open(posefile, encoding="utf-8"))
                entry = {k: d.get(k) for k in INDEX_KEYS}
                entry["source"] = prov
                entry["pose"] = f"{name}.pose.json"
                index.append(entry)
                print(f"  {name}: skip (have pose.json)")
                continue
            except (OSError, json.JSONDecodeError):
                pass  # unreadable -> recompute
        if model is None:
            model, device = load_model(args.model, args.device)
        try:
            index.append(process(p, model, device, args.fps, args.max_w, prov))
        except Exception as e:
            print(f"  ERROR on {p}: {e}", file=sys.stderr)

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nProcessed {len(index)} clips -> out/index.json")


if __name__ == "__main__":
    main()
