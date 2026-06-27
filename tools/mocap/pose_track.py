# /// script
# requires-python = ">=3.10"
# dependencies = ["mediapipe>=0.10.14", "numpy"]
# ///
"""Per-frame 3D pose over a whole video -> out/<name>.track.json.

Decodes via an ffmpeg rawvideo pipe (robust on Windows) and runs MediaPipe
Tasks PoseLandmarker, storing both normalized image landmarks and metric
world landmarks (+visibility) per frame.

Run:
  uv run tools/mocap/pose_track.py videos/first_5_moves.mp4 --fps 30
"""
import argparse, json, os, subprocess, sys, time, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
             "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task")
MODEL_PATH = os.path.join(HERE, "pose_landmarker_heavy.task")

MP_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index",
]


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
    W, H, _src_fps, dur = ffprobe(path)
    ow = min(max_w, W); ow -= ow % 2
    oh = round(H * ow / W); oh -= oh % 2
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf",
           f"fps={sample_fps},scale={ow}:{oh}", "-f", "rawvideo",
           "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    n = ow * oh * 3
    yield (ow, oh, dur)
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(oh, ow, 3)
    proc.stdout.close()
    proc.wait()
    if proc.returncode:  # surface decode errors instead of silently truncating
        err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        raise RuntimeError(f"ffmpeg exited {proc.returncode} decoding {path}\n{err}")


def ensure_model():
    if not os.path.exists(MODEL_PATH):
        print(f"  downloading model -> {MODEL_PATH}")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def make_landmarker(model_path, mode="video"):
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    base = mp_python.BaseOptions(model_asset_path=model_path)
    rm = vision.RunningMode.IMAGE if mode == "image" else vision.RunningMode.VIDEO
    opts = vision.PoseLandmarkerOptions(
        base_options=base, running_mode=rm,
        num_poses=1, min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5)
    return vision.PoseLandmarker.create_from_options(opts), mp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--max-w", type=int, default=960)
    ap.add_argument("--mode", choices=["video", "image"], default="video",
                    help="image = per-frame detection (no temporal tracker -> no lag on fast motion)")
    args = ap.parse_args()

    model_path = ensure_model()
    landmarker, mp = make_landmarker(model_path, args.mode)

    gen = decode_frames(args.video, args.fps, args.max_w)
    ow, oh, dur = next(gen)
    name = os.path.splitext(os.path.basename(args.video))[0]
    print(f"  {name}: decoding @ {args.fps}fps  {ow}x{oh}  ({dur:.1f}s)")

    frames_out, found, t0 = [], 0, time.perf_counter()
    for i, frame in enumerate(gen):
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
        ts_ms = int(i * 1000 / args.fps)
        res = (landmarker.detect(mp_image) if args.mode == "image"
               else landmarker.detect_for_video(mp_image, ts_ms))
        if not res.pose_landmarks:
            frames_out.append({"t": round(i / args.fps, 3), "c": 0.0, "img": None, "world": None})
            continue
        found += 1
        lm = res.pose_landmarks[0]
        wl = res.pose_world_landmarks[0]
        img = [[round(p.x, 4), round(p.y, 4), round(getattr(p, "visibility", 1.0), 3)] for p in lm]
        world = [[round(p.x, 4), round(p.y, 4), round(p.z, 4), round(getattr(p, "visibility", 1.0), 3)] for p in wl]
        c = round(float(np.mean([p[2] for p in img])), 3)
        frames_out.append({"t": round(i / args.fps, 3), "c": c, "img": img, "world": world})
        if i % 300 == 0:
            print(f"    frame {i}  ({found} detected)  {i/max(time.perf_counter()-t0,1e-6):.1f} fps")

    doc = {"file": os.path.basename(args.video), "backend": "mediapipe-heavy",
           "fps": args.fps, "w": ow, "h": oh, "n": len(frames_out),
           "detected": found, "mp_names": MP_NAMES, "frames": frames_out}
    os.makedirs(OUT, exist_ok=True)
    suffix = ".image" if args.mode == "image" else ""
    path = os.path.join(OUT, f"{name}{suffix}.track.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  pose found in {found}/{len(frames_out)} frames -> {path}")
    if found < len(frames_out) * 0.8:
        print("  WARNING: <80% frames detected", file=sys.stderr)


if __name__ == "__main__":
    main()
