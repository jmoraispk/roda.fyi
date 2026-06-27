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
        for chain in geom.BONES3D:
            pts = [(ox + p[k][0] * (W / 120.0), p[k][1] * (H / 160.0)) for k in chain]
            d.line(pts, fill=(235, 166, 60), width=3)
        hx = ox + p["head"][0] * (W / 120.0); hy = p["head"][1] * (H / 160.0)
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
