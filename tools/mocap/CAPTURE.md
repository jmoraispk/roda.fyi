# Capture pipeline (own footage → 3D move animations)

Turns a single hand-held video of a move set (each move repeated ×N from a
fixed set of facings) into clean, averaged, **3D** stick-figure animations.

## Why 4 facings
Filming the same move facing 0°/90°/180°/270° is an unsynchronized multi-view
capture: the body is its own calibration pattern. Monocular depth is weak, so we
fuse — width comes from front/back views, depth from side views.

## Run
```bash
# 1) Per-frame 3D pose over the whole video (git-ignored track):
uv run tools/mocap/pose_track.py videos/first_5_moves.mp4 --fps 30

# 2) Propose segments (rest/active detection + stance/facing labels):
uv run tools/mocap/capture_moves.py --propose

# 3) Confirm/relabel segments in the browser tool, Export JSON over
#    tools/mocap/capture/segments.json:
python -m http.server 5053   # visit /tools/segment/

# 4) Build the per-move 3D animations + QA:
uv run tools/mocap/capture_moves.py --build --qa
```

## Pose backend
Default: MediaPipe Tasks PoseLandmarker (33-joint 3D world landmarks).
Upgrade: NVIDIA GEM-X (Apache-2.0, world-space whole-body). Swap is isolated to
`pose_track.py` — emit the same track.json schema and the rest is unchanged.
