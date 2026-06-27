# Video Motion-Capture Pipeline (own footage → 3D move animations + mirror) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible pipeline that turns `videos/first_5_moves.mp4` (5 moves, ×3 reps, in 4 orientations, plus an aú repeated from a second start position) into clean, averaged, **3D** stick-figure animations per move, and add a **mirror / switch-side** control to the site's 3D figure.

**Architecture:** A small Python package (`tools/mocap/capture/`) of pure, unit-tested DSP/geometry modules, driven by two PEP-723 `uv` scripts (`pose_track.py` for per-frame 3D pose, `capture_moves.py` for the segment→align→fuse→retarget→emit pipeline). The pipeline exploits the recording protocol: the *same* move performed facing 0°/90°/180°/270° is treated as an unsynchronized multi-view capture, with the **human body as the calibration pattern** — per-view monocular 3D poses are time-normalized (phase-aligned), averaged across the 3 reps, then **fused across facings by inverse-variance weighting** so each world axis is reconstructed from the view that saw it best (depth from side views, width from front/back). Output is per-move keyframe JS (`window.RODA_MOCAP`), consumed by an upgraded `assets/figure3d.js` that plays animations and can mirror left/right.

**Tech Stack:** Python 3.10+ via `uv` (PEP-723 inline deps); `numpy` + `scipy` for DSP/geometry; **MediaPipe Tasks `PoseLandmarker`** (33-joint 3D `world_landmarks`) as the default pose backend, with **NVIDIA GEM-X** (Apache-2.0 monocular whole-body 3D) documented as a drop-in high-fidelity upgrade; `ffmpeg`/`ffprobe` for decode (already used by `extract_moves.py`); vanilla ES5-ish JS + Canvas 2D on the web side (no new runtime deps).

---

## Background: what's already here (read before starting)

- `tools/mocap/extract_ginga.py` — the **reference pipeline**: pose → retarget → `fill_and_smooth` → `rigidify` → `normalize` (fit into a `120×160` viewBox) → realism report + QA contact sheet. **Reuse its helpers' design**; this plan generalizes it to a long multi-move video, in 3D, with multi-view fusion.
- `tools/mocap/extract_moves.py` — batch 2D pose over clips; contains a robust `ffprobe`/`decode_frames` ffmpeg pipe (copy this for decode) and the "dominant person" picker.
- `tools/review/index.html` — pose-review tool: overlays a skeleton on the source `<video>`, has a confidence timeline, frame-stepping, and in/out range tagging that **exports JSON**. We extend this idea for segment confirmation.
- `assets/figure3d.js` — current 3D viewer. Consumes ONE static pose dict with keys: `head`, `headR`, `shoulderL`, `shoulderR`, `hipL`, `hipR`, `elbowL`, `handL`, `elbowR`, `handR`, `kneeL`, `footL`, `kneeR`, `footR`. Coordinates: x→right, y→up, z→toward viewer, in the same `120(w)×160(h)` scale as the 2D figures (see existing `MOVES_EXT` `p3d` values, e.g. `head:[58,134,4]`).
- `assets/moves.extended.js` — `MOVES_EXT[slug].p3d` static poses for `ginga`, `bencao`, `meia-lua-de-frente`, `armada`, `au`. These are the **5 moves** in the video. This pipeline replaces the static `p3d` with real captured animation, while leaving `p3d` as a fallback.
- `index.html` — move detail page already exists (`renderMovePage` ~line 1726, `showMove` ~line 1803, `createFigure3D` calls ~lines 1784 & 1843). Scripts loaded at lines 918–920. A 2D `mirror(p,ax)` helper exists at line 967 (mirrors x about `ax`, default 60) — we add the 3D analogue in `figure3d.js`.
- Video facts (from `ffprobe`): `1920×1080`, `30/1` fps, `422.19 s`, `12661` frames. Single subject, clean outdoor background, full body in frame, distinct rest stances between reps — **ideal** for monocular pose.

---

## Global Constraints

- **Never commit the raw video or large derived tracks.** `videos/first_5_moves.mp4` must stay git-ignored, as must the full-resolution per-frame track JSON. Only small per-move outputs (`assets/moves3d/*.js`), the segments JSON, the manifest, and QA thumbnails (optional) enter git. Add the gitignore rules in Task 1.
- **PEP-723 `uv` scripts.** Every runnable script declares its deps inline in a `# /// script` header and is run with `uv run tools/mocap/<script>.py ...`, exactly like `extract_ginga.py`. Mirror its CUDA-index header pattern only for GPU backends (MediaPipe is CPU/GPU-agnostic and needs no torch).
- **Pure modules are numpy/scipy-only and import-safe.** `tools/mocap/capture/*.py` (except the pose backend) must import with only `numpy`/`scipy` so the test runner can load them without MediaPipe/torch installed.
- **3D coordinate convention (canonical, used everywhere downstream):** right-handed, **x→right, y→up, z→toward camera/viewer**, world units later fit to the `120×160` viewBox (x centered at 60, feet near y≈10, head near y≈134, z centered at 0). Any backend's native axes are converted to this in `retarget.py` (MediaPipe world landmarks are hip-origin metric with **y pointing down** — flip it).
- **Output joint set = exactly the `figure3d.js` keys** (listed above). `neck` may be carried internally but is NOT required in the emitted pose dicts.
- **Facing names:** `front`=0°, `left`=90° (subject's left toward camera), `back`=180°, `right`=270°. Internally use yaw degrees `{front:0, left:90, back:180, right:270}` about the +y (up) axis. (Renamed from the user's "b"/"d" to `left`/`right` for clarity, as invited.)
- **QA is by inspection + asserts** (the repo has no pytest infra). Pure modules ship `assert`-based tests run by one PEP-723 test runner; integrative scripts ship a printed realism report + a vision contact sheet/overlay a human or vision model can scan, exactly like `extract_ginga.py`.
- **No new website runtime dependencies.** The web side is vanilla JS + Canvas; new data ships as static `<script>` files.
- **DRY / YAGNI / frequent commits.** Each task ends with a single focused commit.

---

## File Structure

### New files (pipeline)
- `tools/mocap/capture/__init__.py` — package marker + re-exports.
- `tools/mocap/capture/geom.py` — Roda 3D skeleton defs, `rotate_y`, `mirror_pose`, centering helpers. (numpy only)
- `tools/mocap/capture/segment.py` — energy series, rest/active span detection, stance + facing classifiers. (numpy only)
- `tools/mocap/capture/align.py` — phase-align (time-normalize) + average reps with variance. (numpy only)
- `tools/mocap/capture/fuse.py` — rotate views to a common body frame + inverse-variance multi-view fusion. (numpy only)
- `tools/mocap/capture/retarget.py` — MediaPipe-33 → Roda joints, fill/smooth/rigidify wrappers, `normalize_sequence` into the viewBox. (numpy + scipy)
- `tools/mocap/capture/io_formats.py` — load/save helpers + JSON schemas for track/segments/output. (stdlib + numpy)
- `tools/mocap/capture/run_tests.py` — PEP-723 test runner; imports the pure modules and runs all `assert` tests.
- `tools/mocap/pose_track.py` — PEP-723 script: video → `out/<name>.track.json` (per-frame 3D world + 2D image + conf). MediaPipe backend; GEM-X documented.
- `tools/mocap/capture_moves.py` — PEP-723 orchestrator: track + segments + manifest → `assets/moves3d/<slug>.js` + QA.
- `tools/mocap/capture_manifest.json` — declares the recording (move order, facings, reps, slugs, aú start variants).
- `tools/mocap/CAPTURE.md` — recording protocol + how to re-run the pipeline.
- `tools/segment/index.html` — segment-confirmation tool (extends the review-tool idea) exporting `segments.json`.

### New files (output data, committed)
- `assets/moves3d/ginga.js`, `bencao.js`, `meia-lua-de-frente.js`, `armada.js`, `au.js` — `window.RODA_MOCAP[slug] = {...}`.

### Modified files (website)
- `assets/figure3d.js` — animation playback + variant/side (mirror) support; backward compatible with static poses.
- `index.html` — load `assets/moves3d/*.js`; play captured animation on the move page; add a "Mirror / switch side" toggle (+ aú start-variant toggle).
- `.gitignore` — ignore raw video + large tracks.
- `tools/pyproject.toml` — add `mediapipe`, `scipy` to dev deps (optional; scripts are PEP-723 self-contained, but keep the manifest honest).

---

## Data formats (authoritative — every task depends on these)

**Raw track** `tools/mocap/out/<name>.track.json` (git-ignored; produced by `pose_track.py`):
```json
{
  "file": "first_5_moves.mp4",
  "backend": "mediapipe-heavy",
  "fps": 30,
  "w": 1920, "h": 1080,
  "n": 12661,
  "mp_names": ["nose", "left_eye_inner", "...33 BlazePose names..."],
  "frames": [
    { "t": 0.0, "c": 0.97,
      "img":   [[0.51, 0.33, 0.99], "...33 [x,y,visibility], x/y normalized 0..1..."],
      "world": [[0.01, -0.62, 0.03, 0.99], "...33 [x,y,z,visibility] meters, hip-origin, y-down..."] }
  ]
}
```

**Segments** `tools/mocap/capture/segments.json` (committed; proposed by `segment.py`, confirmed in the segment tool):
```json
{
  "file": "first_5_moves.mp4", "fps": 30,
  "segments": [
    { "i": 0, "start": 152, "end": 211, "move": "ginga", "facing": "front",
      "rep": 0, "startStance": "ginga", "endStance": "ginga", "quality": "good" }
  ]
}
```
`start`/`end` are frame indices into the track. `move` is a slug; `facing` ∈ {front,left,back,right}; for the aú, `move:"au"` with `startStance:"ginga"` or `"paralela"` distinguishes the two variants.

**Per-move output** `assets/moves3d/<slug>.js` (committed; produced by `capture_moves.py`):
```js
window.RODA_MOCAP = window.RODA_MOCAP || {};
window.RODA_MOCAP['armada'] = {
  source: "first_5_moves.mp4 (own capture, 3 reps × 4 facings, fused)",
  fps: 24, frameMs: 41.67,
  viewBox: [120, 160],
  joints: ["head","shoulderL","shoulderR","elbowL","handL","elbowR","handR",
           "hipL","hipR","kneeL","footL","kneeR","footR"],
  mirrorAxis: 60,
  variants: {
    "default": { frames: [ { head:[58,134,4], headR:9, "...all joints..." } ] }
  }
};
// aú additionally has variants "fromGinga" (== default) and "fromParalela".
```

---

## Task 1: Package skeleton, manifest, protocol doc, gitignore, test runner

**Files:**
- Create: `tools/mocap/capture/__init__.py`, `tools/mocap/capture/io_formats.py`, `tools/mocap/capture/run_tests.py`, `tools/mocap/capture_manifest.json`, `tools/mocap/CAPTURE.md`
- Modify: `.gitignore`, `tools/pyproject.toml`

**Interfaces:**
- Produces: `capture.io_formats.load_json(path) -> dict`, `save_js(obj, varexpr, path)`, `save_json(obj, path)`; the `run_tests.py` harness `register(fn)` + `main()`; `capture_manifest.json` schema (below).

- [ ] **Step 1: Create the package marker**

Create `tools/mocap/capture/__init__.py`:
```python
"""Roda video motion-capture pipeline (pure numpy/scipy modules).

Modules:
  geom      - 3D skeleton defs + rotations + mirror
  segment   - energy/rest/active span detection + stance/facing classifiers
  align     - phase-align (time-normalize) + average reps
  fuse      - rotate views to a common frame + inverse-variance fusion
  retarget  - MediaPipe-33 -> Roda joints + normalize into the viewBox
  io_formats- json/js load+save helpers
"""
```

- [ ] **Step 2: Create IO helpers**

Create `tools/mocap/capture/io_formats.py`:
```python
import json, os


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(obj, path, indent=2):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
    return path


def save_js(obj, var_expr, path, header="// Generated by tools/mocap/capture_moves.py — do not edit by hand."):
    """Write `<var_expr> = <compact-json>;` (e.g. var_expr="window.RODA_MOCAP['au']")."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\n")
        f.write("window.RODA_MOCAP = window.RODA_MOCAP || {};\n")
        f.write(var_expr + " = ")
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    return path
```

- [ ] **Step 3: Create the recording manifest**

Create `tools/mocap/capture_manifest.json`. **The user must confirm/edit `order` after a first segment pass** — this is the assumed mapping from the contact-sheet review:
```json
{
  "file": "first_5_moves.mp4",
  "reps": 3,
  "facings": ["front", "left", "back", "right"],
  "out_fps": 24,
  "samples": 48,
  "_note": "order = the sequence of (move, startStance) groups as performed. Each group is reps×facings executions. Edit after the first segment proposal if the auto-labels are wrong.",
  "order": [
    { "move": "ginga",               "slug": "ginga",               "startStance": "ginga" },
    { "move": "bencao",              "slug": "bencao",              "startStance": "ginga" },
    { "move": "meia-lua-de-frente",  "slug": "meia-lua-de-frente",  "startStance": "ginga" },
    { "move": "armada",             "slug": "armada",             "startStance": "ginga" },
    { "move": "au",                 "slug": "au",                 "startStance": "ginga",    "variant": "fromGinga" },
    { "move": "au",                 "slug": "au",                 "startStance": "paralela", "variant": "fromParalela" }
  ]
}
```

- [ ] **Step 4: Create the protocol doc**

Create `tools/mocap/CAPTURE.md`:
```markdown
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
```

- [ ] **Step 5: Update `.gitignore`**

Append to `.gitignore`:
```gitignore
# Own capture footage (heavy; never commit) + large per-frame tracks.
videos/*.mp4
videos/*.mov
videos/*.MOV
tools/mocap/out/*.track.json
# Transient frame extracts from exploration.
_explore/
```

- [ ] **Step 6: Note deps in pyproject (manifest honesty)**

In `tools/pyproject.toml`, add to the `dependencies` list:
```toml
    "scipy",
    "mediapipe>=0.10.14",
```

- [ ] **Step 7: Create the test runner**

Create `tools/mocap/capture/run_tests.py`:
```python
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
"""Run all pure-module asserts: `uv run tools/mocap/capture/run_tests.py`."""
import sys, os, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # import sibling modules

_TESTS = []


def register(fn):
    _TESTS.append(fn)
    return fn


def main():
    # Importing a module runs its `@register`-decorated test defs.
    import geom, segment, align, fuse, retarget  # noqa: F401
    passed = failed = 0
    for fn in _TESTS:
        try:
            fn()
            print(f"  ok    {fn.__module__}.{fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__module__}.{fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
```

Note: each pure module imports the runner's `register` via `from run_tests import register` at module top (the runner inserts its own dir on `sys.path`).

- [ ] **Step 8: Verify**

Run: `uv run tools/mocap/capture/run_tests.py`
Expected: it imports (modules are empty stubs for now → an `ImportError` is fine to defer; create empty `geom.py`, `segment.py`, `align.py`, `fuse.py`, `retarget.py` containing only `from run_tests import register` so the import succeeds and prints `0 passed, 0 failed`).

Create those 5 stub files now, each containing exactly:
```python
from run_tests import register  # noqa: F401
```

Re-run: expected output ends with `0 passed, 0 failed` and exit code 0.

- [ ] **Step 9: Commit**

```bash
git add tools/mocap/capture tools/mocap/capture_manifest.json tools/mocap/CAPTURE.md .gitignore tools/pyproject.toml
git commit -m "feat(mocap): capture package skeleton, manifest, protocol, test runner"
```

---

## Task 2: `geom.py` — 3D skeleton, rotation, mirror

**Files:**
- Modify: `tools/mocap/capture/geom.py`

**Interfaces:**
- Produces:
  - `JOINTS3D: list[str]` (the 13 figure3d keys, fixed order)
  - `BONES3D: list[list[str]]` (chains, == `SEGS3D` in figure3d.js)
  - `rotate_y(P, deg) -> np.ndarray` (P shape `[...,3]`, rotate about +y/up)
  - `mirror_pose(pose, axis=60.0) -> dict` (pose dict → mirrored dict)
  - `pose_to_array(pose) -> np.ndarray [J,3]`, `array_to_pose(arr, headR=9) -> dict`
  - `FACING_YAW: dict[str,float] = {"front":0,"left":90,"back":180,"right":270}`

- [ ] **Step 1: Write the failing tests + module**

Replace `tools/mocap/capture/geom.py` with:
```python
from run_tests import register
import numpy as np

JOINTS3D = ["head", "shoulderL", "shoulderR", "elbowL", "handL", "elbowR", "handR",
            "hipL", "hipR", "kneeL", "footL", "kneeR", "footR"]

BONES3D = [
    ["shoulderL", "shoulderR"],
    ["hipL", "hipR"],
    ["shoulderL", "hipL"],
    ["shoulderR", "hipR"],
    ["shoulderL", "elbowL", "handL"],
    ["shoulderR", "elbowR", "handR"],
    ["hipL", "kneeL", "footL"],
    ["hipR", "kneeR", "footR"],
]

FACING_YAW = {"front": 0.0, "left": 90.0, "back": 180.0, "right": 270.0}


def rotate_y(P, deg):
    """Rotate point(s) about the +y (up) axis. P: array-like [...,3]."""
    P = np.asarray(P, float)
    t = np.radians(deg)
    c, s = np.cos(t), np.sin(t)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return np.stack([c * x + s * z, y, -s * x + c * z], axis=-1)


def pose_to_array(pose):
    return np.array([pose[j] for j in JOINTS3D], float)


def array_to_pose(arr, headR=9):
    pose = {j: [round(float(arr[i, 0]), 2), round(float(arr[i, 1]), 2),
                round(float(arr[i, 2]), 2)] for i, j in enumerate(JOINTS3D)}
    pose["headR"] = headR
    return pose


def mirror_pose(pose, axis=60.0):
    """Left<->right mirror: reflect x about `axis` and negate z (keep handedness),
    AND swap L/R joint labels so 'left arm' stays anatomically the left arm."""
    swap = {"shoulderL": "shoulderR", "shoulderR": "shoulderL",
            "elbowL": "elbowR", "elbowR": "elbowL", "handL": "handR", "handR": "handL",
            "hipL": "hipR", "hipR": "hipL", "kneeL": "kneeR", "kneeR": "kneeL",
            "footL": "footR", "footR": "footL"}
    out = {}
    for k, v in pose.items():
        if k == "headR":
            out[k] = v
            continue
        dst = swap.get(k, k)
        out[dst] = [2 * axis - v[0], v[1], -v[2]]
    return out


@register
def test_rotate_y_roundtrip():
    P = np.array([[10.0, 5.0, 0.0], [0.0, 1.0, 7.0]])
    assert np.allclose(rotate_y(rotate_y(P, 90), -90), P, atol=1e-9)
    assert np.allclose(rotate_y(P, 360), P, atol=1e-9)


@register
def test_rotate_y_known():
    # +90° about up turns +x into -z (right-handed, y up, z toward viewer).
    out = rotate_y([1.0, 0.0, 0.0], 90)
    assert np.allclose(out, [0.0, 0.0, -1.0], atol=1e-9), out


@register
def test_mirror_twice_identity():
    pose = {"head": [70, 134, 4], "headR": 9,
            "shoulderL": [42, 118, 6], "shoulderR": [68, 118, -6],
            "elbowL": [36, 106, 8], "elbowR": [74, 106, -8],
            "handL": [32, 92, 9], "handR": [72, 94, -9],
            "hipL": [48, 74, 5], "hipR": [66, 74, -5],
            "kneeL": [44, 44, 8], "kneeR": [72, 44, -8],
            "footL": [38, 10, 10], "footR": [78, 10, -10]}
    back = mirror_pose(mirror_pose(pose))
    for k in pose:
        assert np.allclose(back[k], pose[k]), (k, back[k], pose[k])


@register
def test_mirror_flips_and_swaps():
    pose = {"shoulderL": [50, 100, 6], "shoulderR": [70, 100, -6], "headR": 9}
    m = mirror_pose(pose, axis=60)
    # left shoulder was at x=50,z=6 -> becomes the RIGHT shoulder at x=70,z=-6
    assert m["shoulderR"] == [70, 100, -6]
    assert m["shoulderL"] == [50, 100, 6]
```

- [ ] **Step 2: Run tests**

Run: `uv run tools/mocap/capture/run_tests.py`
Expected: 4 `geom` tests pass; final line `4 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add tools/mocap/capture/geom.py
git commit -m "feat(mocap): geom — 3D skeleton, rotate_y, left/right mirror"
```

---

## Task 3: `pose_track.py` — video → per-frame 3D pose (MediaPipe backend)

**Files:**
- Create: `tools/mocap/pose_track.py`
- Reference: `tools/mocap/extract_moves.py` (`ffprobe`, `decode_frames`)

**Interfaces:**
- Produces: `out/<name>.track.json` per the schema above (33 MediaPipe joints, `img` + `world` + visibility). Consumed by `capture_moves.py`.

### Backend note
MediaPipe `PoseLandmarker` (`pose_landmarker_heavy.task`) returns, per frame, `pose_landmarks` (normalized image x,y,z + visibility) and `pose_world_landmarks` (metric x,y,z, hip-origin, **y-down**). We store both: `world` drives 3D; `img` drives the 2D overlay QA + facing checks. **GEM-X upgrade:** replace `_mp_backend` with a `_gemx_backend` that emits the same 33-name schema (map SOMA/GEM joints → BlazePose names) — nothing downstream changes.

- [ ] **Step 1: Write the script**

Create `tools/mocap/pose_track.py`:
```python
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
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = ow * oh * 3
    yield (ow, oh, dur)
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(oh, ow, 3)
    proc.stdout.close(); proc.wait()


def ensure_model():
    if not os.path.exists(MODEL_PATH):
        print(f"  downloading model -> {MODEL_PATH}")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def make_landmarker(model_path):
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    base = mp_python.BaseOptions(model_asset_path=model_path)
    opts = vision.PoseLandmarkerOptions(
        base_options=base, running_mode=vision.RunningMode.VIDEO,
        num_poses=1, min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5)
    return vision.PoseLandmarker.create_from_options(opts), mp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--max-w", type=int, default=960)
    args = ap.parse_args()

    model_path = ensure_model()
    landmarker, mp = make_landmarker(model_path)

    gen = decode_frames(args.video, args.fps, args.max_w)
    ow, oh, dur = next(gen)
    name = os.path.splitext(os.path.basename(args.video))[0]
    print(f"  {name}: decoding @ {args.fps}fps  {ow}x{oh}  ({dur:.1f}s)")

    frames_out, found, t0 = [], 0, time.perf_counter()
    for i, frame in enumerate(gen):
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
        ts_ms = int(i * 1000 / args.fps)
        res = landmarker.detect_for_video(mp_image, ts_ms)
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
    path = os.path.join(OUT, f"{name}.track.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  pose found in {found}/{len(frames_out)} frames -> {path}")
    if found < len(frames_out) * 0.8:
        print("  WARNING: <80% frames detected", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run on a short slice first (fast smoke test)**

Make a 12s probe clip and track it (the probe clip is git-ignored under `_explore/`):
```bash
ffmpeg -v error -ss 8 -t 12 -i videos/first_5_moves.mp4 -c copy _explore/probe.mp4
uv run tools/mocap/pose_track.py _explore/probe.mp4 --fps 30
```
Expected: prints model download (first run), then `pose found in ~360/360 frames -> .../probe.track.json`. Open the JSON; confirm `frames[100].world` has 33 `[x,y,z,vis]` entries and `frames[100].img` has 33 `[x,y,vis]`.

- [ ] **Step 3: Run on the full video**

```bash
uv run tools/mocap/pose_track.py videos/first_5_moves.mp4 --fps 30
```
Expected: `out/first_5_moves.track.json` written; ≥80% frames detected. (This file is git-ignored.)

- [ ] **Step 4: Commit (script only — track is git-ignored)**

```bash
git add tools/mocap/pose_track.py
git commit -m "feat(mocap): pose_track — video to per-frame 3D world+image track (MediaPipe)"
```

---

## Task 4: `segment.py` — rest/active detection + stance & facing classifiers

**Files:**
- Modify: `tools/mocap/capture/segment.py`

**Interfaces:**
- Consumes: world track as `np.ndarray W[F, J, 3]` (Roda-joint order from `retarget`, y-up) and confidence `C[F, J]`. (For proposal, `capture_moves.py` retargets the raw track first — see Task 9.)
- Produces:
  - `energy(W, fps) -> np.ndarray [F]`
  - `find_active_spans(E, fps, min_active_s=0.5, min_rest_s=0.25, rest_pct=35.0, pad=2) -> list[tuple[int,int]]`
  - `classify_stance(pose) -> str` in {"paralela","ginga","stand"} (pose: `[J,3]`)
  - `classify_facing(span_world, span_img) -> str` in {"front","left","back","right"}

### Algorithm
- **Energy** = mean over joints of inter-frame joint speed (body-length-normalized), smoothed. Rest = energy below an adaptive percentile; an *active span* is a run above threshold of length ≥ `min_active_s`, **bounded on both sides by rest** of length ≥ `min_rest_s`. This operationalizes "the movement is contained between a start and an end position."
- **Stance** (of the bounding rest pose) distinguishes the aú's two starts: `paralela` = feet together + upright (small foot separation, hips high, knees fairly straight); `ginga` = wide split stance (large foot separation, one knee bent, hips lower); else `stand`.
- **Facing** from the shoulder line's orientation in the camera's xz-plane plus nose offset: front/back by sign of chest normal z; left/right by which shoulder is nearer the camera.

- [ ] **Step 1: Write tests + module**

Replace `tools/mocap/capture/segment.py` with:
```python
from run_tests import register
import numpy as np
import geom

JI = {j: i for i, j in enumerate(geom.JOINTS3D)}


def _body_len(W):
    sho = (W[:, JI["shoulderL"]] + W[:, JI["shoulderR"]]) / 2
    hip = (W[:, JI["hipL"]] + W[:, JI["hipR"]]) / 2
    d = np.linalg.norm(sho - hip, axis=1)
    return float(np.nanmedian(d)) or 1.0


def energy(W, fps):
    """Body-length-normalized mean joint speed per frame, lightly smoothed."""
    bl = _body_len(W)
    vel = np.linalg.norm(np.diff(W, axis=0), axis=2)  # [F-1, J]
    e = np.nanmean(vel, axis=1) * fps / bl
    e = np.concatenate([e[:1], e])  # align length to F
    k = max(1, int(round(fps * 0.12)))  # ~120ms moving average
    if k > 1:
        ker = np.ones(k) / k
        e = np.convolve(e, ker, mode="same")
    return e


def find_active_spans(E, fps, min_active_s=0.5, min_rest_s=0.25, rest_pct=35.0, pad=2):
    thr = np.percentile(E, rest_pct)
    active = E > thr
    spans, i, F = [], 0, len(E)
    runs = []
    while i < F:
        j = i
        while j < F and active[j] == active[i]:
            j += 1
        runs.append((active[i], i, j))  # (is_active, start, end)
        i = j
    min_a, min_r = int(min_active_s * fps), int(min_rest_s * fps)
    for idx, (is_act, s, e) in enumerate(runs):
        if not is_act or (e - s) < min_a:
            continue
        prev_rest = idx > 0 and not runs[idx - 1][0] and (runs[idx - 1][2] - runs[idx - 1][1]) >= min_r
        next_rest = idx < len(runs) - 1 and not runs[idx + 1][0] and (runs[idx + 1][2] - runs[idx + 1][1]) >= min_r
        if prev_rest and next_rest:
            spans.append((max(0, s - pad), min(F, e + pad)))
    return spans


def classify_stance(pose):
    p = np.asarray(pose, float)
    bl = np.linalg.norm((p[JI["shoulderL"]] + p[JI["shoulderR"]]) / 2 -
                        (p[JI["hipL"]] + p[JI["hipR"]]) / 2) or 1.0
    foot_sep = abs(p[JI["footL"]][0] - p[JI["footR"]][0]) / bl
    hip_y = (p[JI["hipL"]][1] + p[JI["hipR"]][1]) / 2
    foot_y = (p[JI["footL"]][1] + p[JI["footR"]][1]) / 2
    hip_height = (hip_y - foot_y) / bl  # bigger = more upright
    if foot_sep < 0.55 and hip_height > 1.4:
        return "paralela"
    if foot_sep > 0.9:
        return "ginga"
    return "stand"


def classify_facing(span_world, span_img):
    """span_world: [n,J,3] (y-up, z toward viewer). span_img: [n,J(mp or roda),...]
    Uses the mean chest normal across the span."""
    W = np.asarray(span_world, float).mean(axis=0)
    shoL, shoR = W[JI["shoulderL"]], W[JI["shoulderR"]]
    hip = (W[JI["hipL"]] + W[JI["hipR"]]) / 2
    sho = (shoL + shoR) / 2
    across = shoR - shoL                 # points from left to right shoulder
    up = sho - hip
    normal = np.cross(across, up)        # chest normal (points out of the chest)
    n = normal / (np.linalg.norm(normal) + 1e-9)
    # z toward viewer: normal_z > 0 => chest faces camera (front)
    if abs(n[2]) >= abs(n[0]):
        return "front" if n[2] > 0 else "back"
    # left/right: which shoulder is closer to the camera (larger z)
    return "left" if shoL[2] > shoR[2] else "right"


# ---------- tests ----------
def _ortho_pose(yaw_deg=0.0, foot_sep=0.4, hip_h=1.5):
    """Canonical upright pose, rotated by yaw about up.

    `foot_sep` and `hip_h` are expressed in body-length (shoulder->hip) units,
    so they map directly to what `classify_stance` measures:
      computed foot_sep  = |footL.x - footR.x| / bl  == foot_sep
      computed hip_height = (hip_y - foot_y) / bl     == hip_h
    """
    bl = 6.0
    hip_y = 6.0
    sho_y = hip_y + bl                    # = 12
    foot_y = hip_y - hip_h * bl           # legs hang hip_h body-lengths below the hips
    knee_y = (hip_y + foot_y) / 2.0
    fx = foot_sep * bl / 2.0              # half the foot separation
    base = {
        "head": [0, sho_y + 4, 0],
        "shoulderL": [-3, sho_y, 0], "shoulderR": [3, sho_y, 0],
        "elbowL": [-4, sho_y - 4, 0], "handL": [-4, sho_y - 7, 0],
        "elbowR": [4, sho_y - 4, 0], "handR": [4, sho_y - 7, 0],
        "hipL": [-2, hip_y, 0], "hipR": [2, hip_y, 0],
        "kneeL": [-2, knee_y, 0], "footL": [-fx, foot_y, 0],
        "kneeR": [2, knee_y, 0], "footR": [fx, foot_y, 0],
    }
    arr = geom.pose_to_array({**base, "headR": 9})
    return geom.rotate_y(arr, yaw_deg)


@register
def test_energy_low_when_still():
    W = np.tile(_ortho_pose(0)[None], (30, 1, 1))
    assert energy(W, 30).max() < 1e-6


@register
def test_find_active_spans_one_move():
    fps = 30
    still = np.tile(_ortho_pose(0)[None], (fps, 1, 1))         # 1s rest
    # 0.8s of motion: translate every joint linearly
    move = np.tile(_ortho_pose(0)[None], (int(0.8 * fps), 1, 1)).astype(float)
    ramp = np.linspace(0, 30, move.shape[0])[:, None, None]
    move = move + ramp
    W = np.concatenate([still, move, still], axis=0)
    spans = find_active_spans(energy(W, fps), fps)
    assert len(spans) == 1, spans
    s, e = spans[0]
    assert fps - 6 <= s <= fps + 6 and 2 * fps - 6 <= e <= 2 * fps + 12, (s, e)


@register
def test_classify_stance():
    paralela = geom.array_to_pose(_ortho_pose(0, foot_sep=0.3, hip_h=1.6))
    ginga = geom.array_to_pose(_ortho_pose(0, foot_sep=1.4))
    assert classify_stance(geom.pose_to_array(paralela)) == "paralela"
    assert classify_stance(geom.pose_to_array(ginga)) == "ginga"


@register
def test_classify_facing():
    front = geom.rotate_y(_ortho_pose(0), 0)[None]
    back = geom.rotate_y(_ortho_pose(0), 180)[None]
    assert classify_facing(front, None) == "front"
    assert classify_facing(back, None) == "back"
```

- [ ] **Step 2: Run tests**

Run: `uv run tools/mocap/capture/run_tests.py`
Expected: `geom` (4) + `segment` (4) tests pass → `8 passed, 0 failed`.

Note: pure modules use **sibling imports** (`import geom`) consistent with `run_tests.py`, which inserts `capture/` on `sys.path`.

- [ ] **Step 3: Commit**

```bash
git add tools/mocap/capture/segment.py
git commit -m "feat(mocap): segment — energy/rest-active spans + stance/facing classifiers"
```

---

## Task 5: Segment-confirmation tool (`tools/segment/index.html`)

**Files:**
- Create: `tools/segment/index.html`

**Interfaces:**
- Consumes: `videos/first_5_moves.mp4` (served statically) + a proposed `segments.json` (loaded via file picker or fetched from `../mocap/capture/segments.json`).
- Produces: a corrected `segments.json` via an **Export JSON** button (same UX as `tools/review/index.html`).

### Behavior
- Load video + proposed segments. Render a timeline with one block per proposed span (color by `quality`). Click a block → seek to its `start`; show editable fields: `move` (slug dropdown from the manifest order), `facing` (front/left/back/right), `rep` (0..2), `startStance` (ginga/paralela/stand), `quality` (good/ok/bad). `[`/`]` adjust the selected block's in/out at the playhead. `n` adds a new block at the playhead; `Del` removes the selected. **Export JSON** downloads the full `{file,fps,segments}`.

- [ ] **Step 1: Create the tool**

Create `tools/segment/index.html` (self-contained; mirrors the review tool's palette/keys):
```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roda · Segment Confirm</title>
<style>
  :root{--bg:#0e0b09;--panel:#16110d;--panel2:#1d1711;--line:#2a2017;--ink:#ece3d2;
    --mut:#9c8e79;--gold:#eba63c;--good:#7fc36b;--mid:#e2c044;--bad:#d2502a;
    --mono:ui-monospace,Consolas,monospace}
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif;display:flex;flex-direction:column;height:100vh}
  header{display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
  header b{letter-spacing:.04em} .sp{flex:1}
  button,select,input{font:inherit;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:6px 10px}
  button{cursor:pointer} button.gold{background:var(--gold);color:#1a130a;font-weight:700;border-color:var(--gold)}
  .stage{flex:1;display:flex;align-items:center;justify-content:center;background:#000;min-height:0}
  video{max-width:100%;max-height:64vh}
  .timeline{position:relative;height:64px;background:var(--panel2);border-top:1px solid var(--line);cursor:pointer}
  .blk{position:absolute;top:8px;height:48px;border-radius:5px;opacity:.8;border:1px solid #0006}
  .blk.sel{outline:2px solid var(--gold)} .playhead{position:absolute;top:0;width:2px;height:100%;background:#fff}
  .ctl{display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
  .ctl label{color:var(--mut);font-family:var(--mono);font-size:12px}
  small{color:var(--mut);font-family:var(--mono)}
</style></head><body>
<header><b>RODA · SEGMENT CONFIRM</b>
  <small>space play · ←/→ step · [ in · ] out · n new · Del remove</small><span class="sp"></span>
  <input type="file" id="vid" accept="video/mp4">
  <input type="file" id="seg" accept="application/json">
  <button class="gold" id="export">Export JSON</button>
</header>
<div class="stage"><video id="v" controls></video></div>
<div class="timeline" id="tl"><div class="playhead" id="ph"></div></div>
<div class="ctl">
  <label>move <select id="move"></select></label>
  <label>facing <select id="facing"><option>front</option><option>left</option><option>back</option><option>right</option></select></label>
  <label>rep <select id="rep"><option>0</option><option>1</option><option>2</option></select></label>
  <label>start <select id="stance"><option>ginga</option><option>paralela</option><option>stand</option></select></label>
  <label>quality <select id="quality"><option>good</option><option>ok</option><option>bad</option></select></label>
  <span class="sp"></span><small id="info"></small>
</div>
<script>
const SLUGS=["ginga","bencao","meia-lua-de-frente","armada","au"];
const COL={good:"#7fc36b",ok:"#e2c044",bad:"#d2502a"};
let fps=30, segs=[], sel=-1;
const v=document.getElementById('v'), tl=document.getElementById('tl'), ph=document.getElementById('ph');
document.getElementById('move').innerHTML=SLUGS.map(s=>`<option>${s}</option>`).join('');
document.getElementById('vid').onchange=e=>{const f=e.target.files[0]; if(f) v.src=URL.createObjectURL(f);};
document.getElementById('seg').onchange=e=>{const f=e.target.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=()=>{const j=JSON.parse(r.result); fps=j.fps||30; segs=j.segments||[]; draw();}; r.readAsText(f);};
function draw(){
  [...tl.querySelectorAll('.blk')].forEach(b=>b.remove());
  const D=v.duration||(segs.length?Math.max(...segs.map(s=>s.end))/fps:1);
  segs.forEach((s,i)=>{const b=document.createElement('div'); b.className='blk'+(i===sel?' sel':'');
    b.style.left=(100*s.start/fps/D)+'%'; b.style.width=Math.max(0.6,100*(s.end-s.start)/fps/D)+'%';
    b.style.background=COL[s.quality]||'#888'; b.title=`${s.move} ${s.facing} r${s.rep}`;
    b.onclick=ev=>{ev.stopPropagation(); sel=i; v.currentTime=s.start/fps; sync(); draw();}; tl.appendChild(b);});
}
function sync(){ if(sel<0)return; const s=segs[sel];
  move.value=s.move; facing.value=s.facing; rep.value=s.rep; stance.value=s.startStance||'stand'; quality.value=s.quality||'good';
  info.textContent=`#${sel}  ${s.start}-${s.end}f`; }
['move','facing','rep','stance','quality'].forEach(id=>{const el=document.getElementById(id);
  el.onchange=()=>{ if(sel<0)return; const s=segs[sel];
    s.move=move.value; s.facing=facing.value; s.rep=+rep.value; s.startStance=stance.value; s.quality=quality.value; draw();};});
tl.onclick=e=>{const D=v.duration||1; v.currentTime=(e.offsetX/tl.clientWidth)*D;};
function tick(){ const D=v.duration||1; ph.style.left=(100*v.currentTime/D)+'%'; requestAnimationFrame(tick);} tick();
addEventListener('keydown',e=>{ const F=Math.round(v.currentTime*fps);
  if(e.key===' '){e.preventDefault(); v.paused?v.play():v.pause();}
  else if(e.key==='ArrowRight') v.currentTime+=1/fps;
  else if(e.key==='ArrowLeft') v.currentTime-=1/fps;
  else if(e.key==='[' && sel>=0){segs[sel].start=F; draw();}
  else if(e.key===']' && sel>=0){segs[sel].end=F; draw();}
  else if(e.key==='n'){segs.push({i:segs.length,start:F,end:F+30,move:'ginga',facing:'front',rep:0,startStance:'ginga',quality:'good'}); sel=segs.length-1; sync(); draw();}
  else if(e.key==='Delete' && sel>=0){segs.splice(sel,1); sel=-1; draw();}
});
document.getElementById('export').onclick=()=>{
  segs.forEach((s,i)=>s.i=i);
  const blob=new Blob([JSON.stringify({file:'first_5_moves.mp4',fps,segments:segs},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='segments.json'; a.click();
};
</script></body></html>
```

- [ ] **Step 2: Verify in browser**

```bash
python -m http.server 5053
```
Visit `http://localhost:5053/tools/segment/`. Load the video (`videos/first_5_moves.mp4`) and a `segments.json` (use the proposal from Task 9 Step 2 once available, or hand-make a 1-segment file). Confirm: timeline blocks render, clicking seeks, editing fields updates a block, `[`/`]` adjust bounds, Export downloads valid JSON.

- [ ] **Step 3: Commit**

```bash
git add tools/segment/index.html
git commit -m "feat(mocap): browser segment-confirmation tool exporting segments.json"
```

---

## Task 6: `align.py` — phase-align (time-normalize) + average reps

**Files:**
- Modify: `tools/mocap/capture/align.py`

**Interfaces:**
- Produces:
  - `resample_to_progress(track, n) -> np.ndarray [n, J, 3]` (linear time-normalize a single rep to `n` samples; preserves endpoints).
  - `average_reps(tracks, n) -> tuple[np.ndarray [n,J,3], np.ndarray [n,J]]` returns `(mean, std)` after resampling each rep to `n`. `std` is per-sample, per-joint position spread (the variance the user wants smoothed out).

### Note on alignment
Reps differ mainly in *duration*; time-normalizing each to the same `n` samples phase-aligns them well for these discrete, single-stroke moves. (If a move ever needs nonlinear alignment, swap the linear resample for DTW against the median-duration rep — out of scope now; YAGNI.)

- [ ] **Step 1: Write tests + module**

Replace `tools/mocap/capture/align.py` with:
```python
from run_tests import register
import numpy as np


def resample_to_progress(track, n):
    """track: [F,J,3] -> [n,J,3], linear interp over normalized time [0,1]."""
    track = np.asarray(track, float)
    F = track.shape[0]
    if F == n:
        return track.copy()
    src = np.linspace(0.0, 1.0, F)
    dst = np.linspace(0.0, 1.0, n)
    out = np.empty((n,) + track.shape[1:], float)
    for j in range(track.shape[1]):
        for ax in range(track.shape[2]):
            out[:, j, ax] = np.interp(dst, src, track[:, j, ax])
    return out


def average_reps(tracks, n):
    """tracks: list of [F_i,J,3]. Returns (mean[n,J,3], std[n,J])."""
    stack = np.stack([resample_to_progress(t, n) for t in tracks], axis=0)  # [R,n,J,3]
    mean = stack.mean(axis=0)
    std = np.linalg.norm(stack - mean[None], axis=3).mean(axis=0)  # [n,J] mean dist to mean
    return mean, std


@register
def test_resample_endpoints():
    t = np.cumsum(np.ones((10, 2, 3)), axis=0)
    r = resample_to_progress(t, 25)
    assert r.shape == (25, 2, 3)
    assert np.allclose(r[0], t[0]) and np.allclose(r[-1], t[-1])


@register
def test_average_identical():
    t = np.random.RandomState(0).rand(12, 4, 3)
    mean, std = average_reps([t, t, t], n=12)
    assert np.allclose(mean, t, atol=1e-9)
    assert std.max() < 1e-9


@register
def test_average_reduces_spread():
    base = np.random.RandomState(1).rand(20, 5, 3)
    a = base + 0.10
    b = base - 0.10
    mean, std = average_reps([a, b], n=20)
    assert np.allclose(mean, base, atol=1e-9)
    assert std.mean() > 0.05  # captures the inter-rep spread
```

- [ ] **Step 2: Run tests**

Run: `uv run tools/mocap/capture/run_tests.py`
Expected: `align` (3) tests pass alongside the rest.

- [ ] **Step 3: Commit**

```bash
git add tools/mocap/capture/align.py
git commit -m "feat(mocap): align — phase-align + average reps with variance"
```

---

## Task 7: `fuse.py` — common-frame rotation + inverse-variance multi-view fusion

**Files:**
- Modify: `tools/mocap/capture/fuse.py`

**Interfaces:**
- Produces:
  - `to_common_frame(track, facing) -> np.ndarray` (rotate a facing's capture by `-yaw[facing]` about up so the subject faces canonical front).
  - `fuse_facings(by_facing, sigma_depth=4.0, sigma_plane=1.0) -> np.ndarray [n,J,3]` — inverse-variance (Gaussian) fusion across facings, where each view's depth axis (camera z) is modeled as high-variance and the in-image axes as low-variance. After rotating both the estimate and its covariance into the common frame, the fused estimate reconstructs each axis from the views that saw it in-plane.

### Math
For a facing with yaw `θ`, a view measures the (common-frame) point with anisotropic noise: low variance in the camera's image plane (x,y), high variance along depth (camera z). The measurement covariance in the **common frame** is `Cθ = Ry(-θ) · diag(σ_plane², σ_plane², σ_depth²) · Ry(-θ)ᵀ`. Fusing measurements `pθ` (already rotated to common frame): `p* = (Σ Cθ⁻¹)⁻¹ (Σ Cθ⁻¹ pθ)`, per joint, per sample.

- [ ] **Step 1: Write tests + module**

Replace `tools/mocap/capture/fuse.py` with:
```python
from run_tests import register
import numpy as np
import geom


def to_common_frame(track, facing):
    return geom.rotate_y(track, -geom.FACING_YAW[facing])


def _cov_in_common(theta_deg, sp, sd):
    t = np.radians(-theta_deg)  # rotate camera frame into common frame
    c, s = np.cos(t), np.sin(t)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    D = np.diag([sp * sp, sp * sp, sd * sd])
    return R @ D @ R.T


def fuse_facings(by_facing, sigma_depth=4.0, sigma_plane=1.0):
    """by_facing: {facing: track[n,J,3] in its own camera frame}. Returns [n,J,3]."""
    facings = list(by_facing.keys())
    shapes = {by_facing[f].shape for f in facings}
    assert len(shapes) == 1, f"facing tracks differ in shape: {shapes}"
    n, J, _ = by_facing[facings[0]].shape
    infos = {f: np.linalg.inv(_cov_in_common(geom.FACING_YAW[f], sigma_plane, sigma_depth)) for f in facings}
    common = {f: to_common_frame(by_facing[f], f) for f in facings}
    out = np.empty((n, J, 3), float)
    for i in range(n):
        for j in range(J):
            A = np.zeros((3, 3)); b = np.zeros(3)
            for f in facings:
                Ci = infos[f]
                A += Ci
                b += Ci @ common[f][i, j]
            out[i, j] = np.linalg.solve(A, b)
    return out


@register
def test_to_common_frame_inverts_yaw():
    base = np.random.RandomState(2).rand(5, 13, 3) * 10
    left = geom.rotate_y(base, geom.FACING_YAW["left"])  # subject physically turned left
    assert np.allclose(to_common_frame(left, "left"), base, atol=1e-9)


@register
def test_fuse_recovers_truth_front_plus_left():
    rs = np.random.RandomState(3)
    truth = rs.rand(6, 13, 3) * 10            # canonical (common-frame) truth
    # FRONT view: measures x,y exactly; z (depth) corrupted.
    front_cam = truth.copy()
    front_cam[..., 2] += rs.randn(*truth.shape[:2]) * 3.0
    # LEFT view: rotate truth into the left camera frame, corrupt that camera's depth (its z),
    # which corresponds to the subject's x — the axis FRONT got right. Net: complementary.
    left_cam = geom.rotate_y(truth, geom.FACING_YAW["left"])
    left_cam[..., 2] += rs.randn(*truth.shape[:2]) * 3.0
    fused = fuse_facings({"front": front_cam, "left": left_cam}, sigma_depth=6.0, sigma_plane=1.0)
    err = np.linalg.norm(fused - truth, axis=2).mean()
    # Each single view alone (in the common frame) has ~depth-noise error;
    # fusion must beat the BEST single view, not just one of them.
    front_only = np.linalg.norm(front_cam - truth, axis=2).mean()
    left_only = np.linalg.norm(to_common_frame(left_cam, "left") - truth, axis=2).mean()
    assert err < 0.6 * min(front_only, left_only), (err, front_only, left_only)


@register
def test_fuse_four_facings_shape():
    rs = np.random.RandomState(4)
    truth = rs.rand(4, 13, 3) * 10
    by = {f: geom.rotate_y(truth, geom.FACING_YAW[f]) for f in ["front", "left", "back", "right"]}
    fused = fuse_facings(by)
    assert fused.shape == (4, 13, 3)
    assert np.allclose(fused, truth, atol=1e-6)
```

- [ ] **Step 2: Run tests**

Run: `uv run tools/mocap/capture/run_tests.py`
Expected: `fuse` (3) tests pass. The key one (`test_fuse_recovers_truth_front_plus_left`) proves the fusion beats any single view's depth error.

- [ ] **Step 3: Commit**

```bash
git add tools/mocap/capture/fuse.py
git commit -m "feat(mocap): fuse — common-frame rotation + inverse-variance multi-view fusion"
```

---

## Task 8: `retarget.py` — MediaPipe-33 → Roda joints + normalize into viewBox

**Files:**
- Modify: `tools/mocap/capture/retarget.py`

**Interfaces:**
- Produces:
  - `MP = {name: index}` for the 33 BlazePose names.
  - `mp_world_to_roda(world33) -> np.ndarray [13,3]` — map + flip y-up + reorder to `geom.JOINTS3D`. (`world33`: `[33,3]` metric, y-down.)
  - `fill_smooth_rigidify(track) -> np.ndarray [F,13,3]` — temporal interpolation of gaps + Savitzky-Golay + fixed-bone-length reconstruction (3D port of `extract_ginga.py`).
  - `normalize_sequence(frames, pad_x=14, top=18, bottom=150) -> list[dict]` — fit a `[n,13,3]` **y-up** sequence into the `120×160` viewBox (x centered at 60, z centered at 0), returning pose dicts with `headR`. The data stays **y-up** to match `figure3d.js`, which projects `screenY = H/2 − y`: the head maps to the larger output y (`bottom`=150) and the feet to the smaller (`top`=18), so the figure renders upright. (`top`/`bottom` name the scaled y-extent the motion fills, not screen rows.)

### Mapping
`head` = nose; `shoulderL/R` = left/right_shoulder; `elbowL/R` = left/right_elbow; `handL/R` = left/right_wrist; `hipL/R` = left/right_hip; `kneeL/R` = left/right_knee; `footL/R` = left/right_ankle. MediaPipe world y is **down** → set `y_up = -y`. Keep x (right) and z (toward camera) as-is; downstream fusion handles depth.

- [ ] **Step 1: Write tests + module**

Replace `tools/mocap/capture/retarget.py` with:
```python
from run_tests import register
import numpy as np
import geom

MP = {n: i for i, n in enumerate([
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index"])}

_MAP = {
    "head": "nose", "shoulderL": "left_shoulder", "shoulderR": "right_shoulder",
    "elbowL": "left_elbow", "elbowR": "right_elbow",
    "handL": "left_wrist", "handR": "right_wrist",
    "hipL": "left_hip", "hipR": "right_hip",
    "kneeL": "left_knee", "kneeR": "right_knee",
    "footL": "left_ankle", "footR": "right_ankle",
}

_BONE_TREE = [
    ("root", "shoulderL"), ("root", "shoulderR"), ("root", "head"),
    ("shoulderL", "elbowL"), ("elbowL", "handL"),
    ("shoulderR", "elbowR"), ("elbowR", "handR"),
    ("root", "hipL"), ("root", "hipR"),
    ("hipL", "kneeL"), ("kneeL", "footL"),
    ("hipR", "kneeR"), ("kneeR", "footR"),
]
JI = {j: i for i, j in enumerate(geom.JOINTS3D)}


def mp_world_to_roda(world33):
    w = np.asarray(world33, float)
    out = np.zeros((len(geom.JOINTS3D), 3))
    for j, mp_name in _MAP.items():
        p = w[MP[mp_name]].copy()
        p[1] = -p[1]              # MediaPipe world y is down -> up
        out[JI[j]] = p
    return out


def fill_smooth_rigidify(track, conf=None, win=7):
    """track: [F,13,3] (may contain NaN). Interp gaps, Savitzky-Golay, fix bone lengths."""
    from scipy.signal import savgol_filter
    a = np.asarray(track, float).copy()
    F = a.shape[0]
    w = min(win, F if F % 2 else F - 1)
    if w % 2 == 0:
        w -= 1
    for j in range(a.shape[1]):
        for ax in range(3):
            col = a[:, j, ax]
            mask = ~np.isnan(col)
            if mask.sum() == 0:
                col[:] = 0.0
            elif mask.sum() < F:
                idx = np.arange(F)
                col[~mask] = np.interp(idx[~mask], idx[mask], col[mask])
            if w >= 3 and mask.sum() >= 3:
                col = savgol_filter(col, w, 2)
            a[:, j, ax] = col
    return _rigidify(a)


def _rigidify(a):
    F = a.shape[0]
    root = (a[:, JI["hipL"]] + a[:, JI["hipR"]]) / 2.0

    def dat(name):
        return root if name == "root" else a[:, JI[name]]

    lengths = {}
    for par, ch in _BONE_TREE:
        d = dat(ch) - dat(par)
        lengths[(par, ch)] = float(np.nanmedian(np.linalg.norm(d, axis=1)))

    out = np.zeros_like(a)
    parent_pos = {"root": root}
    for par, ch in _BONE_TREE:
        vec = dat(ch) - dat(par)
        norm = np.linalg.norm(vec, axis=1, keepdims=True)
        norm[norm < 1e-6] = 1e-6
        unit = vec / norm
        pos = parent_pos[par] + unit * lengths[(par, ch)]
        out[:, JI[ch]] = pos
        parent_pos[ch] = pos
    return out


def normalize_sequence(frames, pad_x=14.0, top=18.0, bottom=150.0, headR=9):
    """frames: [n,13,3] (y-up) -> list of pose dicts fit into the 120x160 (+z) viewBox.

    Data is kept y-up to match figure3d.js (which projects screenY = H/2 - y).
    `maxy` (the head, in y-up data) maps to `bottom`=150 and `miny` (the feet)
    maps to `top`=18, so the rendered figure stands upright.
    """
    P = np.asarray(frames, float)
    hipmid = (P[:, JI["hipL"]] + P[:, JI["hipR"]]) / 2.0
    cx = float(np.median(hipmid[:, 0]))
    P = P.copy(); P[..., 0] -= cx                 # center x on the pelvis path
    P[..., 2] -= float(np.median(P[..., 2]))      # center z

    xs, ys = P[..., 0], P[..., 1]
    half_w = max(np.max(np.abs(xs)), 1e-3)
    miny, maxy = float(np.min(ys)), float(np.max(ys))
    scale = min((120 - 2 * pad_x) / (2 * half_w), (bottom - top) / max(maxy - miny, 1e-3))

    out = []
    for i in range(P.shape[0]):
        pose = {}
        for j, name in enumerate(geom.JOINTS3D):
            x, y, z = P[i, j]
            pose[name] = [round(60.0 + x * scale, 2),
                          round(bottom - (maxy - y) * scale, 2),
                          round(z * scale, 2)]
        pose["headR"] = headR
        out.append(pose)
    return out


@register
def test_mp_mapping_shape_and_yflip():
    w = np.zeros((33, 3))
    w[MP["nose"]] = [1, 2, 3]
    w[MP["left_ankle"]] = [0, 5, 0]
    roda = mp_world_to_roda(w)
    assert roda.shape == (13, 3)
    assert list(roda[JI["head"]]) == [1, -2, 3]   # y flipped
    assert roda[JI["footL"]][1] == -5


@register
def test_rigidify_constant_bone_length():
    rs = np.random.RandomState(5)
    base = rs.rand(13, 3)
    track = np.stack([base + rs.randn(13, 3) * 0.02 for _ in range(15)], 0)
    out = fill_smooth_rigidify(track, win=5)
    fl = np.linalg.norm(out[:, JI["kneeL"]] - out[:, JI["footL"]], axis=1)
    assert fl.std() < 1e-6  # bone length now constant over time


@register
def test_normalize_into_viewbox():
    rs = np.random.RandomState(6)
    frames = rs.rand(10, 13, 3) * 2 - 1
    poses = normalize_sequence(frames)
    xs = [p[j][0] for p in poses for j in geom.JOINTS3D]
    ys = [p[j][1] for p in poses for j in geom.JOINTS3D]
    assert min(xs) >= 0 and max(xs) <= 120
    assert min(ys) >= 0 and max(ys) <= 160
    assert "headR" in poses[0]


@register
def test_normalize_keeps_head_above_feet():
    # y-up input: head clearly above the feet. figure3d.js projects screenY = H/2 - y,
    # so the emitted head y MUST be larger than the foot y (renders upright).
    fr = np.zeros((4, 13, 3))
    fr[:, JI["head"], 1] = 10.0
    fr[:, JI["footL"], 1] = -10.0
    fr[:, JI["footR"], 1] = -10.0
    poses = normalize_sequence(fr)
    assert poses[0]["head"][1] > poses[0]["footL"][1]
```

- [ ] **Step 2: Run tests**

Run: `uv run tools/mocap/capture/run_tests.py`
Expected: all module tests pass: `geom`(4) + `segment`(4) + `align`(3) + `fuse`(3) + `retarget`(3) = **17 passed, 0 failed**.

- [ ] **Step 3: Commit**

```bash
git add tools/mocap/capture/retarget.py
git commit -m "feat(mocap): retarget — MediaPipe->Roda map, fill/smooth/rigidify, normalize"
```

---

## Task 9: `capture_moves.py` — orchestrator (propose + build + QA)

**Files:**
- Create: `tools/mocap/capture_moves.py`
- Create (output): `assets/moves3d/<slug>.js` (5 files)

**Interfaces:**
- Consumes: `out/first_5_moves.track.json`, `capture_manifest.json`, `capture/segments.json`, and all `capture/*` modules.
- Produces (`--build`): `assets/moves3d/<slug>.js` (`window.RODA_MOCAP[slug]`) with `variants` (aú gets `fromGinga`+`fromParalela`); `--qa` adds a printed realism report + a 3D contact-sheet PNG per move under `tools/shots/`.
- Produces (`--propose`): `capture/segments.json` proposal from the track + manifest order.

### Flow
`--propose`: retarget every detected frame → `W[F,13,3]`; `energy` → `find_active_spans`; for each span, `classify_facing` + bounding `classify_stance`; auto-label by walking the manifest `order` (group g = `reps×len(facings)` spans). Writes a proposal for the tool.
`--build`: read confirmed `segments.json`; for each `(slug, variant)` group and each `facing`, gather its reps → retarget+`fill_smooth_rigidify`+`resample_to_progress(samples)` → `average_reps` → per-facing mean. Then `fuse_facings` across the 4 facings → `[n,13,3]` → `normalize_sequence` → frames. Emit JS. aú builds two variants from `startStance`.

- [ ] **Step 1: Write the orchestrator**

Create `tools/mocap/capture_moves.py`:
```python
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy", "pillow"]
# ///
"""Build per-move 3D animations from a tracked video + confirmed segments.

  uv run tools/mocap/capture_moves.py --propose          # -> capture/segments.json
  uv run tools/mocap/capture_moves.py --build --qa       # -> assets/moves3d/*.js
"""
import argparse, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "capture"))   # import the pure modules as siblings

import geom, segment, align, fuse, retarget          # noqa: E402
import io_formats as io                               # noqa: E402

OUT = os.path.join(HERE, "out")
SEG_PATH = os.path.join(HERE, "capture", "segments.json")
MANIFEST = os.path.join(HERE, "capture_manifest.json")
MOVES3D = os.path.join(ROOT, "assets", "moves3d")
SHOTS = os.path.join(ROOT, "tools", "shots")


def load_track_world(track):
    """track dict -> (W[F,13,3] roda-joint, img[F,33,3], detected_mask[F])."""
    frames = track["frames"]
    F = len(frames)
    W = np.full((F, len(geom.JOINTS3D), 3), np.nan)
    img = np.full((F, 33, 3), np.nan)
    det = np.zeros(F, bool)
    for i, fr in enumerate(frames):
        if fr["world"]:
            w33 = np.array([[p[0], p[1], p[2]] for p in fr["world"]])
            W[i] = retarget.mp_world_to_roda(w33)
            det[i] = True
        if fr["img"]:
            img[i] = np.array(fr["img"])
    return W, img, det


def propose(track, manifest):
    W, img, det = load_track_world(track)
    Wf = retarget.fill_smooth_rigidify(W)  # gives a clean full-length track for energy
    E = segment.energy(Wf, track["fps"])
    spans = segment.find_active_spans(E, track["fps"])
    print(f"  found {len(spans)} active spans")

    order = manifest["order"]
    facings = manifest["facings"]
    reps = manifest["reps"]
    group_size = reps * len(facings)
    segs = []
    for k, (s, e) in enumerate(spans):
        facing = segment.classify_facing(Wf[s:e], img[s:e])
        stance = segment.classify_stance(Wf[s])
        g = k // group_size
        spec = order[g] if g < len(order) else {"slug": "unknown", "variant": None, "startStance": stance}
        segs.append({"i": k, "start": int(s), "end": int(e), "move": spec["slug"],
                     "facing": facing, "rep": (k % group_size) % reps,
                     "startStance": spec.get("startStance", stance), "quality": "good"})
    io.save_json({"file": track["file"], "fps": track["fps"], "segments": segs}, SEG_PATH)
    print(f"  wrote proposal -> {SEG_PATH}  (confirm in tools/segment/)")


def _rep_track(track_world, s, e, n):
    seg = track_world[s:e]
    clean = retarget.fill_smooth_rigidify(seg)
    return align.resample_to_progress(clean, n)


def build(track, manifest, do_qa):
    W, _img, _det = load_track_world(track)
    seg_doc = io.load_json(SEG_PATH)
    samples = manifest["samples"]
    out_fps = manifest["out_fps"]

    # group segments by (slug, variant-by-startStance)
    groups = {}
    variant_of = {}
    for o in manifest["order"]:
        variant_of[(o["slug"], o.get("startStance"))] = o.get("variant", "default")
    for s in seg_doc["segments"]:
        if s.get("quality") == "bad":
            continue
        variant = variant_of.get((s["move"], s.get("startStance")), "default")
        key = (s["move"], variant)
        groups.setdefault(key, {}).setdefault(s["facing"], []).append(s)

    by_slug = {}
    for (slug, variant), by_facing in groups.items():
        per_facing = {}
        for facing, segs in by_facing.items():
            reps = [_rep_track(W, s["start"], s["end"], samples) for s in segs]
            mean, std = align.average_reps(reps, samples)
            per_facing[facing] = mean
            print(f"    {slug}/{variant} {facing}: {len(reps)} reps, mean spread {std.mean():.2f}")
        fused = fuse.fuse_facings(per_facing) if len(per_facing) >= 2 else next(iter(per_facing.values()))
        frames = retarget.normalize_sequence(fused)
        by_slug.setdefault(slug, {})[variant] = frames
        if do_qa:
            _qa_report(slug, variant, frames, out_fps)

    os.makedirs(MOVES3D, exist_ok=True)
    for slug, variants in by_slug.items():
        if slug == "au" and "fromGinga" in variants:
            variants = dict(variants); variants["default"] = variants["fromGinga"]
        obj = {"source": f"{track['file']} (own capture, fused)",
               "fps": out_fps, "frameMs": round(1000.0 / out_fps, 2),
               "viewBox": [120, 160], "joints": geom.JOINTS3D,
               "mirrorAxis": 60, "variants": variants}
        io.save_js(obj, f"window.RODA_MOCAP['{slug}']", os.path.join(MOVES3D, f"{slug}.js"))
        print(f"  wrote assets/moves3d/{slug}.js  variants={list(variants)}")


def _qa_report(slug, variant, frames, fps):
    from PIL import Image, ImageDraw
    J = {j: np.array([f[j] for f in frames], float) for j in geom.JOINTS3D}
    bone_cv = []
    for chain in geom.BONES3D:
        for a, b in zip(chain[:-1], chain[1:]):
            L = np.linalg.norm(J[a] - J[b], axis=1)
            bone_cv.append(np.std(L) / max(np.mean(L), 1e-6))
    cv = float(np.mean(bone_cv))
    acc = float(np.mean([np.linalg.norm(np.diff(J[j], 2, axis=0), axis=1).mean() for j in geom.JOINTS3D]))
    print(f"    QA {slug}/{variant}: bone-CV {cv:.3f} (want <0.05)  accel {acc:.2f}  frames {len(frames)}")

    os.makedirs(SHOTS, exist_ok=True)
    n, cols = len(frames), 8
    idxs = [round(k * (n - 1) / (cols - 1)) for k in range(cols)]
    H = 220; W = 160
    sheet = Image.new("RGB", (W * cols, H), (23, 18, 13))
    d = ImageDraw.Draw(sheet)
    for ci, fi in enumerate(idxs):
        p = frames[fi]; ox = ci * W
        # Data is y-up; PIL raster y is down, so flip y (H - ...) to draw head-up.
        for chain in geom.BONES3D:
            pts = [(ox + p[k][0] * (W / 120.0), H - p[k][1] * (H / 160.0)) for k in chain]
            d.line(pts, fill=(235, 166, 60), width=3)
        hx = ox + p["head"][0] * (W / 120.0); hy = H - p["head"][1] * (H / 160.0)
        d.ellipse([hx - 7, hy - 7, hx + 7, hy + 7], fill=(230, 212, 178))
    out = os.path.join(SHOTS, f"mocap_{slug}_{variant}.png")
    sheet.save(out)
    print(f"    QA sheet -> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--propose", action="store_true")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--qa", action="store_true")
    ap.add_argument("--track", default=None)
    args = ap.parse_args()
    manifest = io.load_json(MANIFEST)
    track_path = args.track or os.path.join(OUT, os.path.splitext(manifest["file"])[0] + ".track.json")
    track = io.load_json(track_path)
    if args.propose:
        propose(track, manifest)
    if args.build:
        build(track, manifest, args.qa)
    if not (args.propose or args.build):
        ap.error("pass --propose or --build")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Propose segments**

```bash
uv run tools/mocap/capture_moves.py --propose
```
Expected: `found N active spans` (target ≈ 72 = 6 groups × 4 facings × 3 reps; ginga may differ since it's continuous — accept ±, the tool fixes it), writes `capture/segments.json`. Open it; spot-check a few `facing`/`startStance` labels against the video.

- [ ] **Step 3: Confirm in the tool**

Open `tools/segment/` (Task 5), load the video + `capture/segments.json`, fix any mislabeled `move`/`facing`/`rep`/`startStance`/`quality`, **Export JSON**, and overwrite `tools/mocap/capture/segments.json`.

- [ ] **Step 4: Build + QA**

```bash
uv run tools/mocap/capture_moves.py --build --qa
```
Expected: per-facing rep counts printed (each ≈3), `bone-CV < 0.06` for most moves, and `assets/moves3d/{ginga,bencao,meia-lua-de-frente,armada,au}.js` written. `au.js` `variants` includes `fromGinga`, `fromParalela`, and `default`. Inspect the QA sheets in `tools/shots/` — each should read as a recognizable move progression.

- [ ] **Step 5: Commit (outputs + script; tracks/tools/shots are git-ignored)**

```bash
git add tools/mocap/capture_moves.py tools/mocap/capture/segments.json assets/moves3d
git commit -m "feat(mocap): orchestrator + first captured 3D move animations"
```

---

## Task 10: `figure3d.js` — animation playback + variant + mirror

**Files:**
- Modify: `assets/figure3d.js`

**Interfaces:**
- `createFigure3D(canvas, poseOrAnim, opts)` now accepts EITHER a static pose dict (current behavior) OR an animation object `{ fps, frames:[poseDict,...], mirrorAxis }`.
- Returned controller gains: `play()`, `pause()`, `setSide('left'|'right')`, `setVariant(name)` (no-op for single-pose), `setAnimation(animObj)`, plus existing `update(pose)`/`destroy()`.

- [ ] **Step 1: Add a 3D mirror helper + animation state**

In `assets/figure3d.js`, after the `SEGS3D` array (line 12), add:
```javascript
function mirror3d(pose, axis) {
  var a = (axis == null) ? 60 : axis;
  var swap = { shoulderL:'shoulderR', shoulderR:'shoulderL', elbowL:'elbowR', elbowR:'elbowL',
    handL:'handR', handR:'handL', hipL:'hipR', hipR:'hipL', kneeL:'kneeR', kneeR:'kneeL',
    footL:'footR', footR:'footL' };
  var out = {};
  for (var k in pose) {
    if (k === 'headR') { out[k] = pose[k]; continue; }
    var dst = swap[k] || k, v = pose[k];
    out[dst] = [2 * a - v[0], v[1], -v[2]];
  }
  return out;
}
```

- [ ] **Step 2: Generalize `createFigure3D`**

Replace the signature line and the `currentPose`/render/return block. Change:
```javascript
function createFigure3D(canvas, p3d) {
```
to:
```javascript
function createFigure3D(canvas, source, opts) {
  opts = opts || {};
```

Then replace the block from `var currentPose = p3d;` (line 103) through the end of the `return { ... };` (line 128) with:
```javascript
  // --- animation + side state ---
  var anim = null;        // { fps, frames, mirrorAxis }
  var staticPose = null;  // single pose dict
  var side = 'right';     // 'right' = as captured; 'left' = mirrored
  var raf = null, startTs = 0;

  function setSource(src) {
    if (src && src.frames && src.frames.length) {
      anim = { fps: src.fps || 24, frames: src.frames, mirrorAxis: src.mirrorAxis || 60 };
      staticPose = null;
    } else {
      staticPose = src || null;
      anim = null;
    }
  }
  setSource(source);

  function applySide(pose) {
    if (!pose) return pose;
    if (side === 'left') return mirror3d(pose, (anim && anim.mirrorAxis) || 60);
    return pose;
  }

  function poseAtTime(ms) {
    var f = anim.frames, n = f.length;
    var dur = n * (1000 / anim.fps);
    var t = ((ms % dur) + dur) % dur;
    var fpos = t / (1000 / anim.fps);
    var i = Math.floor(fpos), j = (i + 1) % n, u = fpos - i;
    var a = f[i], b = f[j], o = {};
    for (var k in a) {
      if (k === 'headR') { o[k] = a[k]; continue; }
      var A = a[k], B = b[k] || a[k];
      o[k] = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u];
    }
    return o;
  }

  function frame(ts) {
    if (!startTs) startTs = ts;
    draw(applySide(poseAtTime(ts - startTs)));
    raf = requestAnimationFrame(frame);
  }

  function render() {
    if (anim) { return; }           // animation drives its own frames
    draw(applySide(staticPose));
  }

  function play() { if (anim && !raf) { startTs = 0; raf = requestAnimationFrame(frame); } }
  function pause() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  // Pointer events (mouse + touch) — unchanged orbit, but re-render statics on drag.
  canvas.addEventListener('pointerdown', function(e) {
    drag = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function(e) {
    if (!drag) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    theta += dx * 0.012; phi += dy * 0.010;
    phi = Math.max(-1.2, Math.min(1.2, phi));
    lastX = e.clientX; lastY = e.clientY;
    if (!anim) render();           // animated views redraw on their own RAF
  });
  canvas.addEventListener('pointerup',     function() { drag = false; });
  canvas.addEventListener('pointercancel', function() { drag = false; });

  if (anim) { play(); } else { render(); }

  return {
    update: function(src) { pause(); setSource(src); startTs = 0; if (anim) { play(); } else render(); },
    setAnimation: function(a) { setSource(a); pause(); play(); },
    setVariant: function(name) {
      if (anim && opts.variants && opts.variants[name]) { setSource({ fps: anim.fps, frames: opts.variants[name], mirrorAxis: anim.mirrorAxis }); pause(); play(); }
    },
    setSide: function(s) { side = (s === 'left') ? 'left' : 'right'; if (!anim) render(); },
    getSide: function() { return side; },
    play: play, pause: pause,
    destroy: function() { pause(); }
  };
}
```

(`opts.variants` lets callers pre-load the variant map so `setVariant` can switch without rebuilding; for static poses it's ignored.)

- [ ] **Step 3: Verify in browser**

```bash
python -m http.server 5054
```
Visit `http://localhost:5054/`, open DevTools console:
```js
var c = document.createElement('canvas'); c.width=320; c.height=380; document.body.appendChild(c);
var v = createFigure3D(c, window.RODA_MOCAP['armada'].variants.default ?
        {fps:window.RODA_MOCAP['armada'].fps, frames:window.RODA_MOCAP['armada'].variants.default} :
        MOVES_EXT['armada'].p3d);
// (requires assets/moves3d/armada.js loaded — Task 11 wires that; for now test mirror with a static pose:)
var s = createFigure3D(c, MOVES_EXT['bencao'].p3d);
s.setSide('left');   // figure flips horizontally; left/right limbs swap
s.setSide('right');  // back to original
```
Expected: static figure renders and mirrors; if `RODA_MOCAP` is loaded, the animated figure plays and loops. No console errors.

- [ ] **Step 4: Commit**

```bash
git add assets/figure3d.js
git commit -m "feat(figure3d): animation playback + variant switch + left/right mirror"
```

---

## Task 11: `index.html` — load mocap data, animate move page, add mirror toggle

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `window.RODA_MOCAP[slug]` (from `assets/moves3d/*.js`), `createFigure3D(...)` (Task 10), `MOVES_EXT[slug].p3d` (fallback).

- [ ] **Step 1: Load the mocap data files**

In `index.html`, after line 920 (`<script src="assets/figure3d.js"></script>`), add:
```html
<!-- Captured 3D move animations (window.RODA_MOCAP), from tools/mocap/capture_moves.py. -->
<script src="assets/moves3d/ginga.js"></script>
<script src="assets/moves3d/bencao.js"></script>
<script src="assets/moves3d/meia-lua-de-frente.js"></script>
<script src="assets/moves3d/armada.js"></script>
<script src="assets/moves3d/au.js"></script>
```

- [ ] **Step 2: Use the captured animation on the move page**

In `renderMovePage` (the 3D-viewer block, lines 1781–1795), replace:
```javascript
  // 3D viewer
  var canvas = document.getElementById('move3dCanvas');
  if (_figure3d) { _figure3d.destroy(); _figure3d = null; }
  if (ext.p3d && typeof createFigure3D === 'function') {
    _figure3d = createFigure3D(canvas, ext.p3d);
  } else {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#251C13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px Space Mono, monospace';
    ctx.fillStyle = '#5c4a35';
    ctx.textAlign = 'center';
    ctx.fillText('3D pose coming soon', canvas.width/2, canvas.height/2);
  }
```
with:
```javascript
  // 3D viewer — prefer captured animation (window.RODA_MOCAP), fall back to static p3d.
  var canvas = document.getElementById('move3dCanvas');
  if (_figure3d) { _figure3d.destroy(); _figure3d = null; }
  var mocap = (typeof RODA_MOCAP !== 'undefined') ? RODA_MOCAP[slug] : null;
  var sideBtn = document.getElementById('moveSideBtn');
  var variantBtn = document.getElementById('moveVariantBtn');
  if (mocap && mocap.variants && typeof createFigure3D === 'function') {
    var firstVariant = mocap.variants['default'] ? 'default' : Object.keys(mocap.variants)[0];
    _figure3d = createFigure3D(canvas,
      { fps: mocap.fps, frames: mocap.variants[firstVariant], mirrorAxis: mocap.mirrorAxis },
      { variants: mocap.variants });
    if (sideBtn) {
      sideBtn.hidden = false;
      sideBtn.textContent = 'Mirror ⇄';
      sideBtn.onclick = function () {
        var s = _figure3d.getSide() === 'left' ? 'right' : 'left';
        _figure3d.setSide(s);
        sideBtn.setAttribute('aria-pressed', String(s === 'left'));
      };
    }
    // aú-style start-position variants
    var vnames = Object.keys(mocap.variants).filter(function (n) { return n !== 'default'; });
    if (variantBtn && vnames.length > 1) {
      variantBtn.hidden = false;
      var vi = 0;
      variantBtn.textContent = vnames[vi];
      variantBtn.onclick = function () {
        vi = (vi + 1) % vnames.length;
        _figure3d.setVariant(vnames[vi]);
        variantBtn.textContent = vnames[vi];
      };
    } else if (variantBtn) { variantBtn.hidden = true; }
  } else if (ext.p3d && typeof createFigure3D === 'function') {
    _figure3d = createFigure3D(canvas, ext.p3d);
    if (sideBtn) {
      sideBtn.hidden = false; sideBtn.textContent = 'Mirror ⇄';
      sideBtn.onclick = function () {
        var s = _figure3d.getSide() === 'left' ? 'right' : 'left';
        _figure3d.setSide(s);
        sideBtn.setAttribute('aria-pressed', String(s === 'left'));
      };
    }
    if (variantBtn) variantBtn.hidden = true;
  } else {
    if (sideBtn) sideBtn.hidden = true;
    if (variantBtn) variantBtn.hidden = true;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#251C13'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px Space Mono, monospace'; ctx.fillStyle = '#5c4a35'; ctx.textAlign = 'center';
    ctx.fillText('3D pose coming soon', canvas.width / 2, canvas.height / 2);
  }
```

- [ ] **Step 3: Add the toggle buttons to the 3D viewer markup**

Find the move 3D viewer container in the HTML (the element holding `<canvas id="move3dCanvas">` and the "drag to rotate" hint). Immediately after the hint element, add:
```html
<div class="move-3d-controls">
  <button class="move-3d-btn" id="moveSideBtn" type="button" aria-pressed="false" hidden>Mirror ⇄</button>
  <button class="move-3d-btn" id="moveVariantBtn" type="button" hidden></button>
</div>
```
(If the move-detail markup differs, place both buttons as siblings of the canvas inside its wrapper.)

- [ ] **Step 4: Add CSS for the controls**

In the `<style>` block, near the other `.move-3d-*` rules, add:
```css
.move-3d-controls{display:flex;gap:8px;justify-content:center;margin-top:8px}
.move-3d-btn{font-family:var(--mono);font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px;cursor:pointer;transition:.18s}
.move-3d-btn:hover{color:var(--cream);border-color:var(--gold)}
.move-3d-btn[aria-pressed=true]{color:var(--gold);border-color:var(--gold)}
```

- [ ] **Step 5: Verify in browser**

```bash
python -m http.server 5055
```
Visit `http://localhost:5055/#move/armada`:
- The 3D figure **plays the captured armada animation** and loops.
- Click **Mirror ⇄** → the figure performs the move to the other side; click again to revert.
- Drag to orbit while it plays.
- Visit `#move/au` → a **variant** button appears (e.g. `fromGinga` ⇄ `fromParalela`); clicking switches the start position.
- Visit a move with no mocap file (e.g. `#move/martelo`) → falls back to static `p3d` (Mirror still works) or "3D pose coming soon"; no console errors.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(site): play captured 3D move animations with mirror + start-variant toggles"
```

---

## Self-Review

### Spec coverage

| Requirement (from the request) | Task(s) |
|---|---|
| Proper pipeline to capture movement from videos | 1–9 |
| Pose / "visual understanding" backend (the bottleneck) — researched + chosen | 3 (MediaPipe default; GEM-X upgrade documented) |
| 5 moves × 3 reps × 4 orientations handled | 4, 9 (segment + group by move/facing/rep) |
| 6th "move" = aú from a 2nd start (ginga vs paralela) as a variation | 1 (manifest), 4 (`classify_stance`), 9 (variants), 11 (variant toggle) |
| Rename b)/d) to engineer-friendly | Global Constraints (`left`/`right`); used throughout |
| **Recognize start & end positions; movement is between them** | 4 (`find_active_spans` bounded by rest), 9 |
| Average / smooth out variance across the 3 reps | 6 (`average_reps` + variance), 8 (smooth/rigidify) |
| 3D stick figures carry the captured movement | 9 (emit), 10 (playback), 11 (wire) |
| Mirror feature to view the other side (per move page) | 2 (`mirror_pose`), 10 (`mirror3d`/`setSide`), 11 (toggle) |
| Don't commit the video | Global Constraints + Task 1 `.gitignore` |
| Use multi-orientation footage well (fuse to real 3D) | 7 (`fuse_facings`), 9 |

All covered.

### Placeholder scan
- Every code step contains complete, runnable code (Python modules, scripts, HTML tool, JS edits). No "TBD"/"implement later".
- Tests are real `assert` bodies, not "write tests here".
- The one human-in-the-loop step (segment confirmation) has a concrete tool (Task 5) and explicit verification.

### Type / name consistency
- `geom.JOINTS3D` (13 keys) is the single joint order used by `segment`, `align`, `fuse`, `retarget`, `capture_moves`, and matches `figure3d.js` keys exactly.
- `FACING_YAW` defined once in `geom`, used by `segment.classify_facing` (implicitly via geometry), `fuse.to_common_frame`, `fuse._cov_in_common`.
- Pure modules use **sibling imports** (`import geom`) consistent with `run_tests.py` (which inserts `capture/` on `sys.path`); `capture_moves.py` does the same `sys.path.insert`. (Task 4 Step 2 explicitly corrects `from capture import geom` → `import geom`.)
- Output schema (`window.RODA_MOCAP[slug] = {fps, frames|variants, mirrorAxis, joints, viewBox}`) is produced by `io_formats.save_js` (Task 1) / `capture_moves.build` (Task 9) and consumed by `figure3d.createFigure3D` (Task 10) + `renderMovePage` (Task 11) — `variants` map + `default` key consistent across all three.
- `createFigure3D(canvas, source, opts)` stays backward-compatible: existing calls `createFigure3D(canvas, ext.p3d)` (index.html 1785/1843) still pass a static pose; the new third arg is optional.

### Known limitations / follow-ups (not blocking)
1. **Monocular depth quality.** MediaPipe world-z is noisy; the 4-facing fusion is what makes the depth trustworthy. If a move was filmed in <2 usable facings, fusion degrades to single-view depth — the QA bone-CV/contact-sheet will reveal it. GEM-X (Task 3 note) is the upgrade if depth is still weak.
2. **Facing/stance auto-labels** are heuristic; the segment tool (Task 5) is the correction step by design (matches the repo's "auto then human-verify" philosophy).
3. **Compare page** (`renderComparePanel`, index.html ~1818) still uses static `p3d`. Wiring it to `RODA_MOCAP` is a small follow-up mirroring Task 11; intentionally out of scope to keep this plan shippable.
4. **`samples`/`out_fps`** (manifest) are global; if one move needs a different cadence, make them per-`order`-entry later. YAGNI for now.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-video-mocap-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
