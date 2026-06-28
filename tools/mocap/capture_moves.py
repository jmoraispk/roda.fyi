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

import geom, segment, fuse, retarget                 # noqa: E402
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


_JI = {j: i for i, j in enumerate(geom.JOINTS3D)}
_MP_LHIP, _MP_RHIP, _MP_LSHO, _MP_RSHO = 23, 24, 11, 12


def _root_translation(img_span, w, h, torso_metric):
    """MediaPipe world landmarks are hip-centered every frame, so the skeleton has
    NO translation. Recover where the body actually moves from the image (screen)
    pelvis path, scaled to metric by the body's torso length. Front view => we can
    trust screen x (left/right) and screen y (up/down); depth (forward/back) needs a
    side view, so leave z=0 here."""
    from scipy.signal import savgol_filter
    a = np.asarray(img_span, float)
    n = len(a)
    pel = (a[:, _MP_LHIP, :2] + a[:, _MP_RHIP, :2]) / 2.0 * np.array([w, h])
    sho = (a[:, _MP_LSHO, :2] + a[:, _MP_RSHO, :2]) / 2.0 * np.array([w, h])
    for col in (pel[:, 0], pel[:, 1], sho[:, 0], sho[:, 1]):  # interp undetected frames
        m = ~np.isnan(col)
        if m.sum() and m.sum() < n:
            col[~m] = np.interp(np.arange(n)[~m], np.arange(n)[m], col[m])
    torso_px = np.median(np.linalg.norm(sho - pel, axis=1))
    mpp = torso_metric / max(float(torso_px), 1e-6)           # meters per pixel
    root = np.zeros((n, 3))
    root[:, 0] = (pel[:, 0] - pel[0, 0]) * mpp                # screen +x -> world +x (right)
    root[:, 1] = -(pel[:, 1] - pel[0, 1]) * mpp               # screen y is down -> world +y up
    if n >= 5:
        win = min(7, n if n % 2 else n - 1)
        root[:, 0] = savgol_filter(root[:, 0], win, 2)
        root[:, 1] = savgol_filter(root[:, 1], win, 2)
    return root


def _foot_motion(clean):
    """Total foot travel over a (cleaned) clip, normalised by torso length.
    A robust proxy for 'is this a full, real rep' — legs carry the move and are
    steadier than arms/hands under MediaPipe depth noise."""
    sho = (clean[:, _JI["shoulderL"]] + clean[:, _JI["shoulderR"]]) / 2
    hip = (clean[:, _JI["hipL"]] + clean[:, _JI["hipR"]]) / 2
    bl = float(np.nanmedian(np.linalg.norm(sho - hip, axis=1))) or 1.0
    fl = np.linalg.norm(np.diff(clean[:, _JI["footL"]], axis=0), axis=1).sum()
    fr = np.linalg.norm(np.diff(clean[:, _JI["footR"]], axis=0), axis=1).sum()
    return float((fl + fr) / bl)


def _grounded_start(W, s0, fps, max_back_s=2.0, band_frac=0.12):
    """Walk backward from a segment's start to the nearest frame where BOTH feet are
    on the ground (a real base stance). Some reps were labelled starting mid-windup —
    the active foot already lifted — so the very first frame floats one foot. Extending
    to the grounded frame gives a both-feet-planted base WITHOUT fabricating motion
    (these are real captured frames). Capped so we never wander into neighbouring
    material, and we stop at a detection gap rather than cross it."""
    lo = max(0, s0 - int(max_back_s * fps))
    for t in range(s0, lo - 1, -1):
        fr = W[t]
        if not np.all(np.isfinite(fr)):
            break
        sho = (fr[_JI["shoulderL"]] + fr[_JI["shoulderR"]]) / 2.0
        hip = (fr[_JI["hipL"]] + fr[_JI["hipR"]]) / 2.0
        torso = float(np.linalg.norm(sho - hip)) or 1.0
        yL, yR = float(fr[_JI["footL"], 1]), float(fr[_JI["footR"], 1])
        feet_lowest = (min(yL, yR) - float(fr[:, 1].min())) < band_frac * torso  # upright
        level = abs(yL - yR) < band_frac * torso                                 # feet same height
        if feet_lowest and level:
            return t
    return s0


def _pick_rep(W, segs, fps):
    """Choose ONE rep for a move. The segments are now hand-labelled, so TRUST the
    stored facing instead of re-deriving it geometrically (that recombination was
    rotating mislabelled facings by the wrong yaw → mirror flips). We take the FIRST
    front-facing 'good' rep: front shows the full frontal plane with the least
    occlusion and needs no yaw rotation; fall back to the first good rep of any
    facing. We deliberately do NOT fuse the four orientations or average reps yet
    (that cancels motion) — one clean rep keeps the movement crisp. The start is
    nudged back to the nearest grounded base so the first frame has both feet down."""
    good = [s for s in segs if s.get("quality") != "bad"] or list(segs)
    fronts = [s for s in good if s.get("facing") == "front"]
    s = min(fronts or good, key=lambda s: s["start"])      # earliest rep (first repetition)
    st = _grounded_start(W, s["start"], fps)
    en = s["end"]
    clean = retarget.fill_smooth_rigidify(W[st:en])
    return {"seg": s, "start": st, "end": en, "clean": clean, "facing": s.get("facing", "front"),
            "motion": _foot_motion(clean), "dur": en - st}


def build(track, manifest, do_qa):
    W, img, _det = load_track_world(track)
    seg_doc = io.load_json(SEG_PATH)
    out_fps = manifest["out_fps"]

    # group segments by (slug, variant-by-startStance); pool all orientations.
    groups = {}
    variant_of = {}
    for o in manifest["order"]:
        variant_of[(o["slug"], o.get("startStance"))] = o.get("variant", "default")
    for s in seg_doc["segments"]:
        if s.get("quality") == "bad":
            continue
        variant = variant_of.get((s["move"], s.get("startStance")), "default")
        groups.setdefault((s["move"], variant), []).append(s)

    w, h = track.get("w", 1), track.get("h", 1)
    by_slug = {}
    for (slug, variant), segs in groups.items():
        best = _pick_rep(W, segs, track["fps"])
        s = best["seg"]
        st, en = best["start"], best["end"]
        clean = best["clean"]
        # rotate the chosen rep into a front-facing common frame, then normalise.
        common = fuse.to_common_frame(clean, best["facing"])
        # recover root translation from the image and rotate it the same way.
        sho = (clean[:, _JI["shoulderL"]] + clean[:, _JI["shoulderR"]]) / 2
        hip = (clean[:, _JI["hipL"]] + clean[:, _JI["hipR"]]) / 2
        torso_m = float(np.median(np.linalg.norm(sho - hip, axis=1)))
        root = _root_translation(img[st:en], w, h, torso_m)
        common = common + geom.rotate_y(root, -geom.FACING_YAW[best["facing"]])[:, None, :]
        frames = retarget.normalize_sequence(common)
        by_slug.setdefault(slug, {})[variant] = frames
        travel = float(np.linalg.norm(root[-1] - root[0]) / max(torso_m, 1e-6))
        lead = s["start"] - st
        print(f"    {slug}/{variant}: rep i={s['i']} f={st}-{en} "
              f"(+{lead}f base lead, {best['dur']}f) facing={best['facing']} "
              f"footTravel={best['motion']:.1f} rootTravel={travel:.2f}bl")
        if do_qa:
            _qa_report(slug, variant, frames, out_fps)

    os.makedirs(MOVES3D, exist_ok=True)
    for slug, variants in by_slug.items():
        variants = dict(variants)
        if "default" not in variants:   # web always loads a 'default'; prefer fromGinga for au
            variants["default"] = variants.get("fromGinga") or next(iter(variants.values()))
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
    stem = os.path.splitext(manifest["file"])[0]
    if args.track:
        track_path = args.track
    else:
        # prefer the lag-free IMAGE-mode track (per-frame detection, no temporal
        # smoothing) when it exists; fall back to the VIDEO-mode track otherwise.
        image_track = os.path.join(OUT, stem + ".image.track.json")
        track_path = image_track if os.path.exists(image_track) else os.path.join(OUT, stem + ".track.json")
    print(f"track: {track_path}")
    track = io.load_json(track_path)
    if args.propose:
        propose(track, manifest)
    if args.build:
        build(track, manifest, args.qa)
    if not (args.propose or args.build):
        ap.error("pass --propose or --build")


if __name__ == "__main__":
    main()
