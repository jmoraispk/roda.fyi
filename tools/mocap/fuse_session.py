# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy", "pillow"]
# ///
"""Fuse a two-view capture session into motion v2 documents.

  uv run tools/mocap/fuse_session.py <session_dir>                     # fuse every move variant
  uv run tools/mocap/fuse_session.py <session_dir> --only au/<variantKey>
  uv run tools/mocap/fuse_session.py <session_dir> --publish au/<variantKey>

For each (move, variant) with good/ok reps marked in BOTH takes: rank every
front x side rep pairing by DTW cost, fuse the best pair (front x,y + side z,y,
monocular-lift fallback), and write
  <session>/fused/<slug>/<variantKey>.json     motion v2 (docs/motion-format-v2.md)
  <session>/fused/<slug>/<variantKey>.qa.json  re-projections + metrics for the QA view

--publish copies one result to assets/motion/v2/ and re-derives the v1 site file.
"""
import argparse
import json
import os
import shutil
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "capture"))

import dtw                    # noqa: E402
import motion_v2 as mv        # noqa: E402
import twoview                # noqa: E402
import io_formats as io       # noqa: E402

V2_DIR = os.path.join(ROOT, "assets", "motion", "v2")
METHOD = "twoview-dtw-fusion/1"
QUALITY_PENALTY = {"good": 1.0, "ok": 1.15}


def load_track(path):
    """-> (img[F,33,3] pixels+conf, world[F,33,3] or None, fps, (w, h))."""
    t = io.load_json(path)
    F, w, h = len(t["frames"]), t.get("w", 1), t.get("h", 1)
    img = np.full((F, 33, 3), np.nan)
    world = np.full((F, 33, 3), np.nan)
    for i, fr in enumerate(t["frames"]):
        if fr.get("img"):
            a = np.asarray(fr["img"], float)
            img[i] = a[:, :3] * [w, h, 1]
        if fr.get("world"):
            world[i] = np.asarray(fr["world"], float)[:, :3]
    return img, world, t.get("fps", 30), (w, h)


def variant_of(mark):
    v = mark.get("variant") or {}
    return {k: (v.get(k) or "default") for k in ("start", "middle", "end")}


def group_reps(marks):
    """{(slug, variantKey): [mark, ...]} for usable move reps, in time order."""
    out = {}
    for m in sorted(marks, key=lambda m: m["start"]):
        if m.get("kind", "rep") != "rep" or m.get("quality") == "bad" or not m.get("move"):
            continue
        if m["end"] - m["start"] < 5:
            continue
        out.setdefault((m["move"], mv.variant_key(variant_of(m))), []).append(m)
    return out


def rep_slice(img, world, m):
    s, e = m["start"], min(m["end"], len(img))
    return img[s:e], world[s:e]


def fuse_group(slug, vkey, front_reps, side_reps, T, meta):
    fimg, fworld, fps, (fw, fh) = T["front"]
    simg, sworld, _, (sw, sh) = T["side"]
    ff = [dtw.features(*rep_slice(fimg, fworld, m)) for m in front_reps]
    sf = [dtw.features(*rep_slice(simg, sworld, m)) for m in side_reps]
    ranked = dtw.rank_pairs(ff, sf)
    for r in ranked:
        r["score"] = r["cost"] * QUALITY_PENALTY.get(front_reps[r["front"]].get("quality"), 1.0) \
            * QUALITY_PENALTY.get(side_reps[r["side"]].get("quality"), 1.0)
    ranked.sort(key=lambda r: r["score"])
    best = ranked[0]
    fm, sm = front_reps[best["front"]], side_reps[best["side"]]
    fi, fwo = rep_slice(fimg, fworld, fm)
    si, swo = rep_slice(simg, sworld, sm)
    side_sign = 1 if meta.get("side_facing", "right") == "right" else -1
    s_front = twoview.metres_per_px(fimg, meta["height_m"])
    s_side = twoview.metres_per_px(simg, meta["height_m"])
    res = twoview.fuse({"img": fi, "world": fwo}, {"img": si, "world": swo}, best["warp"],
                       side_sign, s_front, s_side)

    stances = fm.get("stances") or {}
    if (sm.get("stances") or {}) != stances:
        print(f"  note {slug}/{vkey}: front/side stances differ {stances} vs {sm.get('stances')}; using front")
    src = {
        "session": meta["id"],
        "front": {"video": (meta["views"]["front"].get("original") or {}).get("name"),
                  "rep": fm.get("rep"), "start": fm["start"], "end": fm["end"]},
        "side": {"video": (meta["views"]["side"].get("original") or {}).get("name"),
                 "rep": sm.get("rep"), "start": sm["start"], "end": sm["end"]},
        "reps": {"front": len(front_reps), "side": len(side_reps)},
        "method": METHOD,
    }
    st = res["stats"]
    quality = {"dtw_cost": round(best["cost"], 4),
               "reproj_px": {k: (round(v, 2) if v is not None else None) for k, v in st["reproj_px"].items()},
               "fallback": {k: round(v, 4) for k, v in st["fallback"].items()}}
    doc = mv.make_doc(slug, variant_of(fm), fps, res["v2"], stances, src, quality)

    warp = best["warp"]
    qa = {
        "slug": slug, "variant": vkey, "fps": fps, "n": len(doc["frames"]),
        "joints": mv.JOINTS_V2, "bones": mv.BONES_V2,
        "front": {"video": "front.proxy.mp4", "frames": list(range(fm["start"], fm["start"] + len(fi))),
                  "proj": np.round(res["proj"]["front"] / [fw, fh], 4).tolist()},
        "side": {"video": "side.proxy.mp4", "frames": np.round(sm["start"] + warp, 2).tolist(),
                 "proj": np.round(res["proj"]["side"] / [sw, sh], 4).tolist()},
        "contacts": doc["contacts"],
        "metrics": {**quality, "side_scale_fit": st["side_scale_fit"],
                    "metres_per_px": {"front": round(s_front, 6), "side": round(s_side, 6)},
                    "pair": {"front_rep": fm.get("rep"), "side_rep": sm.get("rep")},
                    "candidates": [{"front_rep": front_reps[r["front"]].get("rep"),
                                    "side_rep": side_reps[r["side"]].get("rep"),
                                    "cost": round(r["cost"], 4)} for r in ranked]},
    }
    return doc, qa


def fuse_session(d, only=None):
    meta = io.load_json(os.path.join(d, "session.json"))
    T = {}
    for v in ("front", "side"):
        p = os.path.join(d, f"{v}.track.json")
        if not os.path.isfile(p):
            raise SystemExit(f"no {v} track yet — run pose tracking for the {v} take first")
        print(f"@@stage load {v} track", flush=True)
        T[v] = load_track(p)
    groups = {v: group_reps(meta["views"][v].get("marks", [])) for v in ("front", "side")}
    keys = sorted(set(groups["front"]) & set(groups["side"]))
    for k in sorted(set(groups["front"]) ^ set(groups["side"])):
        which = "front" if k in groups["front"] else "side"
        print(f"  skip {k[0]}/{k[1]}: only marked in the {which} take")
    ntrans = sum(m.get("kind") == "transition" for v in ("front", "side") for m in meta["views"][v].get("marks", []))
    if ntrans:
        print(f"  {ntrans} transition span(s) recorded (not fused yet)")
    if only:
        keys = [k for k in keys if "/".join(k) == only]
    if not keys:
        raise SystemExit("nothing to fuse: mark at least one good/ok rep of a move in BOTH takes")
    for i, (slug, vkey) in enumerate(keys):
        print(f"@@stage fuse {slug}/{vkey}", flush=True)
        print(f"@@progress {i} {len(keys)}", flush=True)
        doc, qa = fuse_group(slug, vkey, groups["front"][(slug, vkey)], groups["side"][(slug, vkey)], T, meta)
        out = os.path.join(d, "fused", slug)
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, vkey + ".json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"))
        with open(os.path.join(out, vkey + ".qa.json"), "w", encoding="utf-8") as f:
            json.dump(qa, f, separators=(",", ":"))
        q = doc["quality"]
        print(f"  {slug}/{vkey}: {len(doc['frames'])}f  pair F{qa['metrics']['pair']['front_rep']}"
              f"/S{qa['metrics']['pair']['side_rep']}  dtw {q['dtw_cost']}  reproj {q['reproj_px']}  "
              f"fallback {q['fallback']}")
    print(f"@@progress {len(keys)} {len(keys)}", flush=True)


def publish(d, target):
    slug, vkey = target.split("/", 1)
    src = os.path.join(d, "fused", slug, vkey + ".json")
    doc = io.load_json(src)
    mv.validate_doc(doc)
    dst_dir = os.path.join(V2_DIR, slug)
    os.makedirs(dst_dir, exist_ok=True)
    shutil.copyfile(src, os.path.join(dst_dir, vkey + ".json"))
    print(f"  published -> assets/motion/v2/{slug}/{vkey}.json")
    sys.path.insert(0, HERE)
    import capture_moves
    capture_moves.write_v2_index()
    capture_moves.build_from_v2([slug])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session_dir")
    ap.add_argument("--only", help="<slug>/<variantKey>")
    ap.add_argument("--publish", help="<slug>/<variantKey>: copy to assets/motion/v2 + rebuild v1")
    a = ap.parse_args()
    if a.publish:
        publish(a.session_dir, a.publish)
    else:
        fuse_session(a.session_dir, a.only)


if __name__ == "__main__":
    main()
