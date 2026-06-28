# Handoff — 2D-estimation pose pipeline on the GPU server

You are picking up a self-contained sub-task for the **roda.fyi** project. The owner is
running a **RTMW3D** experiment on a laptop in parallel; **your job on the server is the
2D-estimation path** (Sapiens-2B preferred), then lift to 3D, and produce a pose track that
is **drop-in compatible** with the existing pipeline so we can A/B all three backends.

Do **not** assume anything beyond this note + the repo. Read `pose_estimation_report.md`
(committed at repo root) for the full SOTA rationale.

---

## 1. Hardware you're on
- 2× **Quadro RTX 8000** (48 GB each, **Turing / sm_75**).
- fp16 works; **no bf16** (Turing). Plan dtype accordingly.
- 48 GB is enough to run **Sapiens-2B at native 1080p / 1024²**. One model per card; you can
  run two experiments in parallel.

## 2. The input
- `videos/first_5_moves.mp4` — **1920×1080, 30 fps, 12,661 frames (~7 min)**. (Heavy; gitignored.
  Get it from the owner via scp/rsync.)
- Content: 5 capoeira moves — **ginga, bençao, meia-lua-de-frente, armada, aú** — each performed
  **3× from 4 orientations** (front 0°, left 90°, back 180°, right 270°), **plus aú repeated from a
  `paralela` start**. **Single camera, sequential** (NOT synchronized multi-view — no triangulation).

## 3. THE OUTPUT CONTRACT (most important)
Emit `tools/mocap/out/first_5_moves.<backend>.track.json` matching **exactly** the schema written by
`tools/mocap/pose_track.py` (the MediaPipe reference), so `retarget.py`, `capture_moves.py`, and the
segment-tool overlay all work **unchanged**:

```json
{
  "file": "first_5_moves.mp4",
  "backend": "sapiens2b-2d+motionbert",
  "fps": 30, "w": 1920, "h": 1080,
  "n": 12661, "detected": 12500,
  "mp_names": [ "...the 33 MediaPipe names, in order (see below)..." ],
  "frames": [
    { "t": 0.000, "c": 0.93,
      "img":   [[x, y, vis], ... 33 rows ...],      // normalized [0..1] image coords, origin top-left, + per-joint confidence
      "world": [[x, y, z, vis], ... 33 rows ...] }, // metric 3D (meters), root ≈ mid-hip, + confidence
    { "t": 0.033, "c": 0.0, "img": null, "world": null }   // null when no detection that frame
  ]
}
```

**Compatibility requirement:** output the **33 MediaPipe landmarks in MediaPipe order** (map your
model's richer keypoints down to these). This lets the whole downstream reuse without edits.
Feet are part of the 33: `left_heel`=29, `right_heel`=30, `left_foot_index`(toe)=31, `right_foot_index`(toe)=32.

The 33 `mp_names` (index = position):
```
nose, left_eye_inner, left_eye, left_eye_outer, right_eye_inner, right_eye, right_eye_outer,
left_ear, right_ear, mouth_left, mouth_right, left_shoulder, right_shoulder, left_elbow,
right_elbow, left_wrist, right_wrist, left_pinky, right_pinky, left_index, right_index,
left_thumb, right_thumb, left_hip, right_hip, left_knee, right_knee, left_ankle, right_ankle,
left_heel, right_heel, left_foot_index, right_foot_index
```

Coordinate conventions (match MediaPipe so `retarget.py` works):
- `img`: x,y in [0,1] over the full frame, origin **top-left**.
- `world`: metric meters, **root ≈ mid-hip**, axes x-right / y-down / z-toward-camera (negative).
  `retarget.mp_world_to_roda` flips Y and Z into Roda's y-up / z-toward-viewer 13-joint skeleton.
- `vis`: 0..1 per-joint confidence (we store it for QA; keep it real, don't hardcode 1.0).

## 4. Recommended approach
1. **Sapiens-2B** pose (2D, dense keypoints) at **native res** → best 2D in-the-wild.
2. Lift 2D→3D with **MotionBERT** (or VideoPose3D). Map outputs to the 33 MP indices for both
   `img` (from Sapiens 2D) and `world` (from the lifter).
3. Alternative if Sapiens is too slow: **RTMPose-x whole-body (133)** + MotionBERT.

Known risk — **aú is inverted (cartwheel/handstand)**: 2D should be fine, but monocular 3D lifters
are trained on upright mocap (Human3.6M), so 3D may degrade on inversions. Report per-move quality;
we may keep MediaPipe just for aú.

## 5. How to verify against the existing pipeline (optional but encouraged)
- The downstream builder already exists. After producing your track.json:
  ```
  uv run tools/mocap/capture_moves.py --build --track tools/mocap/out/first_5_moves.<backend>.track.json
  ```
  (`capture_moves.py` flags: `--propose --build --qa --track`.) It retargets to the 13-joint
  skeleton and writes `assets/moves3d/*.js`.
- Visual QA of the raw keypoints: open `tools/segment/index.html` (served over http via
  `tools/serve.py`) and load your track as the **track** input — it draws the 2D skeleton overlay.

## 6. Repo / branch hygiene
- Repo: **roda.fyi**. Branch off **`main`** (the laptop work is being merged there now).
  New branch e.g. **`feat/sapiens-2d-pipeline`**.
- Existing MediaPipe pipeline (mirror its structure): `tools/mocap/` — `pose_track.py` (inference),
  `retarget.py` (MP-33 → Roda-13 + smoothing/rigidify), `geom.py`, `segment.py`, `capture_moves.py`,
  `io_formats.py`.
- **Never commit** `videos/*.mp4` or `tools/mocap/out/*.track.json` (already gitignored). Model
  weights (`*.pt`, `*.onnx`, `*.task`) are gitignored too.

## 7. The only deliverable that must return to the laptop
Just the **`first_5_moves.<backend>.track.json`** (~20 MB). The laptop runs retarget + website from it.
