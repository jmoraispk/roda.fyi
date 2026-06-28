# How roda.fyi works

`roda.fyi` is a static, dependency-free (vanilla HTML/CSS/JS) site about capoeira.
Its centrepiece is a set of **3D stick-figure move animations** you can rotate,
zoom, and mirror. This doc explains how the whole thing fits together — from a
hand-held training video to the animated figure on a move page.

```
 video ─▶ pose tracking ─▶ track.json ─▶ segment tool ─▶ segments.json ─▶ build ─▶ assets/moves3d/*.js ─▶ figure3d.js
 (mp4)    (MediaPipe/        (per-frame    (label move +    (confirmed       (capture_moves)  (RODA_MOCAP data)   (browser render)
          Sapiens)           keypoints)    facing + reps)   spans)
```

## Repository map

| Path | What lives there |
|---|---|
| `index.html` | The whole single-page site (routing, move pages, UI). Loads the figure engine + move data. |
| `assets/figure3d.js` | The 3D stick-figure engine (`createFigure3D`) — projection, orbit/zoom, floor, depth sorting, mirror. |
| `assets/moves3d/*.js` | **Generated** per-move animation data (`window.RODA_MOCAP[slug]`). Do not hand-edit. |
| `assets/moves*.js`, `ginga.keyframes.js` | Move catalog + the hero ginga keyframes. |
| `tools/mocap/` | The Python motion-capture pipeline (own footage → animations) + the YouTube move library. See `tools/mocap/README.md` and `tools/mocap/CAPTURE.md`. |
| `tools/mocap/capture/` | Pure, unit-tested pipeline modules (`geom`, `segment`, `align`, `fuse`, `retarget`, `io_formats`). |
| `tools/segment/` | Browser tool to review the tracked skeleton on the video and label move spans. |
| `tools/serve.py` | Tiny dev server with HTTP-range support (so the segment tool can scrub video) + an on-demand YouTube clip endpoint. |
| `docs/` | This overview + planning specs under `docs/superpowers/plans/`. |

## The 3D figure system

### Skeleton & coordinate conventions
Figures use a 13-joint skeleton (`geom.JOINTS3D`):

```
head, shoulderL/R, elbowL/R, handL/R, hipL/R, kneeL/R, footL/R
```

A **pose** is `{joint: [x, y, z], ..., headR}`. Conventions (shared by the
generator and `figure3d.js`):

- **Axes:** `x` = right, `y` = up, `z` = toward the viewer (right-handed).
- **Scale:** every clip is scaled so the median shoulder→hip (torso) length is a
  constant `40` units, so the figure keeps a stable size even while it travels.
- **Floor / grounding:** every frame is shifted so its **lowest joint sits on the
  floor** (`y ≈ 20`). That means the support foot in a stance — and the **hands
  when inverted in an aú** — actually touch the ground, instead of one global
  minimum touching while every other frame floats.
- **Head:** the head ball is anchored at the **skull centre (mid-point of the
  ears)**, not the nose tip. The nose sits at the front of the face, so anchoring
  there made the head look like it was falling forward (worst when bending).
- **Mirror axis:** the sway path is centred on `x = 60`, so the left/right mirror
  (`mirrorAxis`) is a clean reflection. Mirroring reflects `x` about the axis,
  negates `z`, and swaps L/R joint labels (`geom.mirror_pose` / `mirror3d`).
- **viewBox** is nominally `120 × 160`, but travelling moves (e.g. the aú) exceed
  it on purpose; the viewer auto-fits the whole clip so nothing is clipped.

### The viewer (`assets/figure3d.js`)
`createFigure3D(canvas, source, opts)` renders either an animation
(`{fps, frames, mirrorAxis}`) or a single static pose. It:

- auto-fits the camera to the clip's bounding box (stable framing while it plays),
- draws a perspective-projected **floor grid** at the clip's lowest `y` and a soft
  contact shadow under the pelvis,
- depth-sorts bones and tints them by `z` (far = dim, near = bright) for a sense
  of 3D,
- supports **drag to orbit**, **wheel to zoom**, **mirror** (`setSide`), and
  **variant** switching (`setVariant`).

`index.html` prefers a captured animation (`RODA_MOCAP[slug]`) and falls back to a
static hand-authored pose (`ext.p3d`) for moves that haven't been captured.

## Move animation data (`assets/moves3d/*.js`)
Each file is generated and assigns one entry:

```js
window.RODA_MOCAP['au'] = {
  source, fps, frameMs, viewBox: [120,160], joints: [...13 names],
  mirrorAxis: 60,
  variants: { default: [ /* frame poses */ ], fromGinga: [ ... ] }
};
```

`variants.default` is what a move page plays; extra variants (e.g. the aú
`fromGinga` vs `fromParalela` start) are cycled by the variant button.

## The capture pipeline (own footage → animations)
Driven by `tools/mocap/capture_moves.py`. See `tools/mocap/CAPTURE.md` for the
step list; the key stages:

1. **Pose tracking** (`pose_track.py`): per-frame whole-body pose over the video →
   `tools/mocap/out/<clip>.track.json` (git-ignored; large).
2. **Segment proposal/labelling**: `--propose` auto-detects active spans, then you
   confirm/relabel them in the **segment tool** and export
   `tools/mocap/capture/segments.json` (move + camera facing + rep + quality per
   span).
3. **Build** (`--build [--qa]`): turns the confirmed segments into
   `assets/moves3d/*.js`.

### How `--build` chooses and cleans a rep
- **One rep per move, no merging.** It does *not* fuse the four facings or average
  reps (that cancelled real motion and rotated mislabelled facings by the wrong
  yaw). It takes the **first front-facing `good` rep** — front shows the full
  frontal plane with the least occlusion and needs no rotation.
- **Trusts the hand labels.** Facing comes from your label, not a geometric guess.
- **Grounded start.** The chosen rep's start is nudged back to the nearest frame
  where both feet are actually on the ground, so the first frame is a real base
  stance (some reps were labelled starting mid-windup).
- **Root motion.** MediaPipe world landmarks are hip-centred (no translation), so
  the body's real left/right/up travel is recovered from the image-space pelvis
  path, scaled to metric by torso length.
- **Clean-up** (`retarget.py`): interpolate gaps → Savitzky-Golay smooth →
  rigidify (constant bone lengths) → scale/centre/ground (`normalize_sequence`).

### `track.json` schema
```jsonc
{
  "file": "...", "backend": "mediapipe-heavy" | "sapiens1b-2d+motionbert",
  "fps": 30, "w": 960, "h": 540, "n": <#frames>, "detected": <#detected>,
  "mp_names": [ ...33 MediaPipe landmark names... ],
  "frames": [ { "t": <sec>, "c": <conf>,
               "img":   [[x,y,vis], ...33],     // normalized image space (0..1)
               "world": [[x,y,z,vis], ...33] }  // MediaPipe world (metres, hip-centred)
            ]
}
```
Two backends produce this same schema, so they're interchangeable:
- **`*.image.track.json`** — MediaPipe in IMAGE mode (per-frame, lag-free). The
  default for the 3D build: its world-coordinate convention is the one
  `mp_world_to_roda` is validated against.
- **`*.sapiens1b-2d+motionbert.track.json`** — Sapiens 2D + MotionBERT lift; more
  accurate 2D keypoints (best for the segment-tool overlay).

### Pipeline modules & tests (`tools/mocap/capture/`)
`geom` (skeleton, rotations, mirror), `segment` (energy/active-span detection,
stance/facing classifiers), `align` (resample/average reps), `fuse` (multi-facing
fusion — available, currently unused), `retarget` (MediaPipe→Roda mapping,
smoothing, rigidify, normalize/ground), `io_formats` (JSON/JS I/O). Run the unit
tests:

```bash
uv run tools/mocap/capture/run_tests.py
```

## Segment labelling tool (`tools/segment/`)
A browser tool that overlays the tracked skeleton on the source video and lets you
draw/relabel move spans (move, camera facing, rep, quality), with timeline zoom,
±1-frame nudging, draggable edges, undo, playback speed, an overlay frame-offset,
and a YouTube library. Export writes `tools/mocap/capture/segments.json`. Serve it
with the range-capable dev server:

```bash
uv run tools/serve.py        # random port; visit /tools/segment/
```

## YouTube move library
Separate from the own-footage capture: `tools/mocap/fetch_youtube.py` +
`extract_moves.py` build a searchable library of reference clips (2D pose only).
Details in `tools/mocap/README.md`.

## Quickstart (reproduce the animations)
```bash
# 1) (once) per-frame pose track over the video  -> out/<clip>.track.json
uv run tools/mocap/pose_track.py videos/first_5_moves.mp4 --fps 30

# 2) label spans in the browser (exports capture/segments.json)
uv run tools/serve.py            # visit /tools/segment/

# 3) build the per-move 3D animations (+ QA sheets in tools/shots/)
uv run tools/mocap/capture_moves.py --build --qa
```

## Deeper docs
- `tools/mocap/CAPTURE.md` — the own-footage capture pipeline, step by step.
- `tools/mocap/README.md` — the YouTube move library + ginga hero extraction.
- `docs/superpowers/plans/` — design/implementation plans (incl. the server-side
  2D-estimation handoff).
