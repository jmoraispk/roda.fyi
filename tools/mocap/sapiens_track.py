#!/usr/bin/env python
"""Sapiens-1B (Goliath-308) 2D pose + MotionBERT 3D lift over a whole video.

Emits out/<name>.<backend>.track.json matching the schema written by pose_track.py
(the MediaPipe reference): 33 MediaPipe landmarks in MediaPipe order, normalized
`img` coords (origin top-left) + per-joint vis, and metric `world` coords
(root ~ mid-hip, x-right/y-down/z-away) so retarget.py / capture_moves.py run unchanged.

  source tools/mocap/.venv/bin/activate
  python tools/mocap/sapiens_track.py videos/first_5_moves.mp4 --fps 30

Decodes with OpenCV (no system ffmpeg needed). GPU only (Turing fp16).
"""
import argparse
import json
import os
import sys
import time

import cv2
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from posepipe.keypoint_map import MP_NAMES, MP_TO_GOLIATH, COCO17_TO_GOLIATH, H36M_TO_MP  # noqa: E402
from posepipe.detect import PersonDetector  # noqa: E402
from posepipe.pose2d import SapiensPose, Sapiens2Pose  # noqa: E402
from posepipe import lift3d  # noqa: E402

OUT = os.path.join(HERE, "out")
MODELS = os.environ.get("RODA_MOCAP_MODELS") or os.path.join(HERE, "models")
MOTIONBERT_CKPT = os.path.join(MODELS, "checkpoint", "pose3d", "FT_MB_release_MB_ft_h36m", "best_epoch.bin")

# 2D backends: torchscript Sapiens-1B (default) or safetensors Sapiens2-5B (newer SOTA).
SAP2_CFG = ("/home/joao/sapiens2_src/sapiens/pose/configs/keypoints308/"
            "shutterstock_goliath_3po/sapiens2_5b_keypoints308_shutterstock_goliath_3po-1024x768.py")
BACKENDS = {
    "sapiens1b": dict(tag="sapiens1b-2d+motionbert", kind="ts",
                      ckpt=os.path.join(MODELS, "sapiens_1b_goliath_best_goliath_AP_639_torchscript.pt2")),
    "sapiens2-5b": dict(tag="sapiens2-5b-2d+motionbert", kind="sap2",
                        ckpt=os.path.join(MODELS, "sapiens2_5b_pose.safetensors"), cfg=SAP2_CFG),
}


def make_pose(backend, device):
    b = BACKENDS[backend]
    if b["kind"] == "ts":
        return SapiensPose(b["ckpt"], device=device)
    return Sapiens2Pose(b["cfg"], b["ckpt"], device=device)

MP_G = np.asarray(MP_TO_GOLIATH)
COCO_G = np.asarray(COCO17_TO_GOLIATH)


def run_2d(video, fps, batch, device, pose, limit=None, ranges=None):
    """`@@progress done total` lines on stdout feed the capture tool's job runner.
    ranges: optional [[start, end), ...] in sampled-frame indices; frames outside are
    skipped (no decode-to-RGB, no inference) and recorded as undetected."""
    cap = cv2.VideoCapture(video)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or fps
    n_total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(src_fps / fps))
    print(f"  {W}x{H} src_fps={src_fps:.2f} frames={n_total} sampling every {step} -> ~{fps}fps")

    detector = PersonDetector(device=device)
    n_sampled = max(1, n_total // step)
    keep = None
    if ranges:
        keep = np.zeros(n_sampled + 1, bool)
        for a, b in ranges:
            keep[max(0, int(a)):max(0, min(n_sampled + 1, int(b)))] = True
    todo = int(keep.sum()) if keep is not None else n_sampled

    mp_xy, mp_sc, coco_xy, coco_sc, det = [], [], [], [], []
    buf_frames, buf_idx = [], []
    t0 = time.perf_counter()
    read = kept = 0

    def flush():
        nonlocal kept
        if not buf_frames:
            return
        bboxes = detector.detect_batch(buf_frames)
        valid = [i for i, b in enumerate(bboxes) if b is not None]
        results = {}
        if valid:
            fr = [buf_frames[i] for i in valid]
            bb = [bboxes[i] for i in valid]
            kpts, scores = pose.infer(fr, bb)
            for j, i in enumerate(valid):
                results[i] = (kpts[j], scores[j])
        for i in range(len(buf_frames)):
            if i in results:
                g_xy, g_sc = results[i]
                mp_xy.append(g_xy[MP_G]); mp_sc.append(g_sc[MP_G])
                coco_xy.append(g_xy[COCO_G]); coco_sc.append(g_sc[COCO_G])
                det.append(True); kept += 1
            else:
                add_empty()
        buf_frames.clear(); buf_idx.clear()

    def add_empty():
        mp_xy.append(np.zeros((33, 2), np.float32)); mp_sc.append(np.zeros(33, np.float32))
        coco_xy.append(np.zeros((17, 2), np.float32)); coco_sc.append(np.zeros(17, np.float32))
        det.append(False)

    sampled = processed = 0
    while True:
        if read % step != 0:                     # not a sampled frame
            if not cap.grab():
                break
            read += 1
            continue
        if keep is not None and not keep[min(sampled, len(keep) - 1)]:
            if not cap.grab():                   # decode only (keeps the stream in sync)
                break
            flush()                              # keep frame order: pending frames first
            add_empty()
        else:
            ok, frame = cap.read()
            if not ok:
                break
            buf_frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            buf_idx.append(read)
            processed += 1
            if len(buf_frames) >= batch:
                flush()
                print(f"@@progress {processed} {todo}", flush=True)
                if processed % (batch * 20) < batch:
                    el = time.perf_counter() - t0
                    print(f"    frame {len(det)}  ({kept} detected)  {processed/max(el,1e-6):.1f} fps")
        sampled += 1
        read += 1
        if limit and len(det) >= limit:
            break
    flush()
    cap.release()
    return dict(W=W, H=H, mp_xy=np.array(mp_xy), mp_sc=np.array(mp_sc),
                coco_xy=np.array(coco_xy), coco_sc=np.array(coco_sc),
                det=np.array(det), n=len(det))


def build_track(video, fps, data, device, tag, out_path=None):
    W, H, n = data["W"], data["H"], data["n"]
    det = data["det"]
    world17, _wvis = lift3d.lift(data["coco_xy"], data["coco_sc"], det, MOTIONBERT_CKPT, device)

    mp_xy, mp_sc = data["mp_xy"], data["mp_sc"]
    frames_out = []
    found = 0
    for i in range(n):
        t = round(i / fps, 3)
        if not det[i]:
            frames_out.append({"t": t, "c": 0.0, "img": None, "world": None})
            continue
        found += 1
        xy = mp_xy[i]; sc = np.clip(mp_sc[i], 0.0, 1.0)
        img = [[round(float(xy[k, 0] / W), 4), round(float(xy[k, 1] / H), 4), round(float(sc[k]), 3)]
               for k in range(33)]
        # world: fill the 13 lifter joints, then approximate the rest from neighbours
        w = np.zeros((33, 3), np.float32)
        for h36, mp in H36M_TO_MP.items():
            w[mp] = world17[i, h36]
        for k in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10):  # eyes/ears/mouth ~ nose
            w[k] = w[0]
        for k in (17, 19, 21):  # left fingers ~ left wrist
            w[k] = w[15]
        for k in (18, 20, 22):  # right fingers ~ right wrist
            w[k] = w[16]
        w[29] = w[31] = w[27]   # left heel/toe ~ left ankle
        w[30] = w[32] = w[28]   # right heel/toe ~ right ankle
        world = [[round(float(w[k, 0]), 4), round(float(w[k, 1]), 4),
                  round(float(w[k, 2]), 4), round(float(sc[k]), 3)] for k in range(33)]
        c = round(float(np.mean(sc)), 3)
        frames_out.append({"t": t, "c": c, "img": img, "world": world})

    doc = {"file": os.path.basename(video), "backend": tag, "fps": fps,
           "w": W, "h": H, "n": n, "detected": found, "mp_names": MP_NAMES, "frames": frames_out}
    name = os.path.splitext(os.path.basename(video))[0]
    path = out_path or os.path.join(OUT, f"{name}.{tag}.track.json")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  pose found in {found}/{n} frames -> {path}")
    if found < n * 0.8:
        print("  WARNING: <80% frames detected", file=sys.stderr)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--backend", choices=list(BACKENDS), default="sapiens1b")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--limit", type=int, default=None, help="only process first N sampled frames (debug)")
    ap.add_argument("--out", default=None, help="track.json path (default out/<name>.<backend>.track.json)")
    ap.add_argument("--ranges", default=None, help="JSON file [[start,end),...]: only track these frames")
    args = ap.parse_args()
    assert torch.cuda.is_available(), "CUDA required"
    tag = BACKENDS[args.backend]["tag"]
    name = os.path.splitext(os.path.basename(args.video))[0]
    print(f"  {name}: 2D ({args.backend}) ...")
    print("@@stage 2d pose", flush=True)
    pose = make_pose(args.backend, args.device)
    ranges = json.load(open(args.ranges)) if args.ranges else None
    data = run_2d(args.video, args.fps, args.batch, args.device, pose, args.limit, ranges)
    print(f"  lifting 3D (MotionBERT) over {data['n']} frames ...")
    print("@@stage 3d lift", flush=True)
    build_track(args.video, args.fps, data, args.device, tag, args.out)


if __name__ == "__main__":
    main()
