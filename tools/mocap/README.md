# Mocap

Two pipelines that turn real footage into pose data, plus a browser review tool
to polish the results before they feed the site.

| Script | What it does |
|---|---|
| `extract_ginga.py` | The Wikimedia **"Ginga de dos"** GIF → hero stick-figure keyframes (`assets/ginga.keyframes.js`). Retargeted + smoothed + rigidified. |
| `sources.json` | Curated catalog mapping **all 52 moves** (+ compilation videos) to YouTube search queries, with `priority` (1 = main, 2 = long-tail) and `covers` (which move slugs a clip demonstrates). The single source of truth for the library; the review tool reads it for slug→name + coverage. |
| `fetch_youtube.py` | Reads `sources.json`; for each move, searches YouTube (yt-dlp) and auto-picks the best instructional clip (or uses an explicit `url`), downloads ≤480p into `clips/yt-<slug>.mp4`, and merges a move-tagged provenance record into `clips/manifest.json` + `clips/youtube.json`. Falls back to the next-best candidate on a dead/403/broken video. |
| `fetch_clips.py` | Downloads CC-licensed capoeira videos from Wikimedia Commons into `clips/` (used for the multi-person *roda* footage). |
| `extract_moves.py` | Batch 2D pose (YOLO26x) over every clip → `out/<clip>.pose.json` (normalized COCO-17 + confidence + move tags) + `out/index.json`. |
| `../review/index.html` | **Review library** — overlays each clip's skeleton on the source video, shows the *expected* move per clip + a 52-move coverage grid, with a confidence timeline, frame-stepping, and move-range tagging that exports JSON. |

## Where we paused (Jun 2026)

**Round 1 is done and intentionally paused here.** All 39 priority-1 sources
(15 kicks + 9 dodges + core floreios/quedas + 4 compilations) are downloaded to
`clips/yt-*.mp4`, and GPU pose extraction (`extract_moves.py --fps 8`) ran over
the whole set. Provenance + move tags live in `clips/manifest.json` /
`clips/youtube.json`; the raw video is git-ignored.

To **pick it up later** (e.g. when we want more combinations / the long tail):

```bash
uv run tools/mocap/coverage.py                         # see what's covered (-> COVERAGE.md)
uv run tools/mocap/fetch_youtube.py --priority 2        # round 2: rare floreios/quedas
uv run tools/mocap/extract_moves.py --fps 8             # pose the new clips
# want alternates for a move that tracked badly? bump search depth + force:
uv run tools/mocap/fetch_youtube.py --slugs armada --max-results 10 --force
```

Future direction (noted, not built): **3D**. Either lift the existing monocular
clips to 3D (MotionBERT/HMR2 — solid for kicks, weak on inversions) or, better,
capture the professor from 2–3 angles and triangulate. Keep the figure format
3D-ready (`[x,y,z]`, z optional) so 2D corrections carry forward.

## Move library workflow

```bash
# 1) Sanity-check what the search would pick (titles/durations), no download:
uv run tools/mocap/fetch_youtube.py --search-only --priority 1

# 2) Download the main moves (round 1): 15 kicks, 9 dodges, core
#    floreios/quedas + "all kicks / esquivas / ..." compilations:
uv run tools/mocap/fetch_youtube.py --priority 1

# 3) Pose every clip on the GPU (unbuffered for live progress):
uv run tools/mocap/extract_moves.py --fps 8

# 4) Open the review tool from a static server to verify + tag ranges:
python -m http.server 5052               # visit /tools/review/

# Round 2 — the long-tail floreios/quedas — is just:
uv run tools/mocap/fetch_youtube.py --priority 2 && uv run tools/mocap/extract_moves.py --fps 8
```

Useful flags: `--slugs martelo,armada` (limit to specific moves), `--force`
(re-download), `--cookies-from-browser edge` (if YouTube demands a login),
`--max-results N` (search depth).

> **Copyright.** YouTube clips are fetched solely to run pose estimation
> (an algorithm reading pixels); nothing is redistributed or used to train
> anything. The raw `yt-*.mp4` files are git-ignored — only the provenance
> manifest + the derived `out/*.pose.json` are kept. If a clip 403s or is
> region-locked, the downloader automatically tries the next-best search hit.

In the review tool: scrub a clip, watch the skeleton track (green = high
confidence, red = low), jump between low-confidence frames, and mark `in`/`out`
ranges tagged with a move name + quality. **Export JSON** saves all annotations;
a clean `good` range is what you'd later hand to `extract_ginga.py`-style
retargeting to mint a per-move animation.

> Roda footage is mostly two-person games, so `extract_moves.py` picks the
> *dominant* person per frame (confidence × area, with light continuity). That
> heuristic will mis-track during crossings/occlusion — finding and flagging
> those moments is exactly what the review tool is for. Isolated single-person
> demos (e.g. the headspin clip) track cleanly end-to-end.

Heavy video (`clips/*.webm`, overlay `out/*.mp4`) is git-ignored and
re-fetchable; the `manifest.json` + `out/*.pose.json` (the analysis) are kept.

> Commons rate-limits bursts of original downloads (HTTP 429). `fetch_clips.py`
> backs off and spaces requests; if it stalls, wait a few minutes and re-run —
> it skips files already on disk.

---

## Ginga (`extract_ginga.py`)

Turns the Wikimedia **"Ginga de dos"** GIF into stick-figure keyframes that
drive the hero animation on the site. Motion-capture, not hand-keying: the
figure's joints track the real footage frame-for-frame.

## Run

Uses [uv](https://docs.astral.sh/uv/) — dependencies are declared inline in the
script (PEP 723), so there is nothing to install first:

```bash
uv run tools/mocap/extract_ginga.py --qa
```

Outputs:
- `assets/ginga.keyframes.js` — `window.GINGA = {...}`, consumed by `index.html`.
- `tools/shots/ginga_qa.gif` — side-by-side (source GIF | stick figure) for QA (with `--qa`).

Options: `--gif <path>`, `--out <path>`, `--model <yolo26x-pose.pt|...>`,
`--device <0|cpu>`, `--fps <n>`.

## How it works

1. Read GIF frames (Pillow).
2. 2D pose per frame with Ultralytics **YOLO26x-pose** (COCO-17 keypoints).
3. Retarget COCO-17 to the Roda hero skeleton (separate L/R shoulders + hips +
   a neck — richer than the 52-card figure) in image coordinates.
4. Interpolate low-confidence joints across time, then Savitzky-Golay smooth
   each coordinate to remove estimator jitter.
5. Fit into the `120x160` viewBox: one global vertical scale/anchor (keeps the
   bob, feet near the bottom) and horizontal de-drift around a smoothed hip
   root (figure dances in place, sway preserved).
6. The source GIF already loops, so the keyframe sequence loops seamlessly.

## GPU / scaling

The inline metadata pins **CUDA 13 (`cu130`) PyTorch** wheels, so the script
runs on an NVIDIA GPU out of the box — on an RTX 1000 Ada the 49-frame clip
does pose in ~4s (~12 fps) vs ~39s on CPU (~9× faster). Ultralytics auto-selects
the GPU; force it with `--device 0` or `--device cpu`.

- **First GPU run / after changing deps:** `uv run --refresh --reinstall ...`
  once so uv re-resolves to the `cu130` wheels (it caches the CPU build
  otherwise). After that, plain `uv run ...` reuses the GPU env.
- **CPU-only machine:** delete the `[[tool.uv.index]]` + `[tool.uv.sources]`
  blocks in the script header and torch falls back to the PyPI CPU wheel.
- **Different CUDA version:** swap `cu130` for `cu126`/`cu128` to match the driver.

Batching a whole library of move clips is the same script in a loop; a GPU
keeps that to seconds per clip. Model weights (`*.pt`) and extracted `frames/`
are git-ignored.

## Source

`assets/ginga_de_dos.gif` — "Ginga de dos", Wikimedia Commons (CC BY-SA).
