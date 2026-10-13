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

---

# Two-view capture tool (single phone, front + side takes)

The current workflow. One phone on a tripod, two **separate** takes:

1. **Front take** — the performer faces the camera and does 3–5 reps of each move.
2. **Side take** — the performer turns 90° and repeats the same sequence.

Then fuse: `x,y` come from the front take and `z,y` from the side take. The output
is [motion format v2](../../docs/motion-format-v2.md), and the site's v1 files are
derived from it.

## Run (on the GPU server)
```bash
RODA_CAPTURE_GPUS=1 uv run tools/serve.py 8140     # localhost only, no auth
# on the laptop:  ssh -L 8140:localhost:8140 <gpu-server>
# open http://localhost:8140/tools/segment/capture.html
```
| env | default | |
|---|---|---|
| `RODA_CAPTURE_DIR` | `<main checkout>/tools/mocap/captures` | session data (git-ignored) |
| `RODA_CAPTURE_GPUS` | `1` | GPU ids for pose jobs (one worker per id) |

## Steps in the UI
1. **+ new session**: enter the performer's height (sets the metric scale) and which
   way the performer faces *in the image* during the side take.
2. **⬆ upload** each take. Uploads are 16 MB chunks. If one is interrupted, pick the
   same file again and it resumes from the last chunk. When an upload finishes, the
   server makes `<view>.proxy.mp4` (30 fps H.264, keyframe every 15 frames). The UI
   plays the proxy and the tracker runs on it, so frame numbers match everywhere.
3. **Mark** each take in order. Set the move (full catalogue, same slugs as the site),
   the start → end stance and the variant (start / middle / end, `default` = standard
   form). Then press `i` at the start of a rep and `o` at its end. Reps number
   themselves per move + variant, and the next rep's start stance is filled in from
   this rep's end stance. Use the `transition` lane for spans that link move A into
   move B; they're stored but not fused yet.
4. **Track pose** (Sapiens-1B + MotionBERT on the GPU, about 4 fps). "Marked spans"
   tracks only the marked reps ±1 s and is much faster than "whole video".
5. **Fuse**: for every move variant marked in both takes, the tool tries every front
   × side rep pairing and keeps the lowest DTW cost. It time-warps the side rep onto
   the front rep and fuses them. When a joint is occluded in one take (typically the
   far limb in the side take), that coordinate comes from the other take's monocular
   3D lift.
6. **QA**: the fused skeleton re-projected onto both videos (the side one time-warped),
   an orbitable 3D view of the v2 result, ground contacts, reprojection error, and the
   share of joint-frames that used the lift fallback. **Publish** copies the result to
   `assets/motion/v2/<slug>/<variantKey>.json` and rebuilds `assets/moves3d/<slug>.js`.

## Session folder (never committed)
```
<session>/session.json            meta + marks per view
<session>/<view>.orig.<ext>       upload, untouched
<session>/<view>.proxy.mp4        working proxy
<session>/<view>.track.json       pose track (track.json schema)
<session>/fused/<slug>/<variantKey>.json|.qa.json
```

## CLI equivalents
```bash
uv run tools/mocap/fuse_session.py tools/mocap/captures/<session>                  # fuse all
uv run tools/mocap/fuse_session.py tools/mocap/captures/<session> --publish au/<variantKey>
uv run tools/mocap/capture_moves.py --from-v2                                       # v2 -> v1
```

## Assumptions / limits
- Weak perspective: the phone is a few metres away, and each take has one metric
  scale estimated from the performer's height and the ankle→ear chain length.
  Moving a long way toward or away from the camera within a rep bends `y` slightly.
- Both takes must start from the same spot and orientation relative to the move,
  and the side take must be a clean 90° turn.
- In the side take, left/right labels on the far limb can be swapped by the 2D
  model. Low-confidence joints use the lift fallback, but a confident swap won't be
  caught. Check the QA view.
