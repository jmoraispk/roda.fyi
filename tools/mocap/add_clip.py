# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "yt-dlp>=2025.1",
# ]
# ///
"""Add an ad-hoc YouTube clip to the move library.

Downloads a single URL (optionally trimmed to a section) into clips/yt-<slug>.mp4
and upserts its provenance into clips/manifest.json + clips/youtube.json, so:
  - extract_moves.py picks up the provenance when it poses the clip, and
  - the segment tool's library dropdown lists it (loads video + pose overlay).

  uv run tools/mocap/add_clip.py --url https://youtu.be/ID --slug myclip
  uv run tools/mocap/add_clip.py --url https://youtu.be/ID --slug myclip --section 31 59

Then pose it:
  uv run tools/mocap/extract_moves.py tools/mocap/clips/yt-myclip.mp4

Copyright: footage is fetched only to run/inspect pose analysis. Nothing is
redistributed or used to train anything.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
LICENSE = "YouTube (fetched for algorithmic pose analysis only)"

sys.path.insert(0, HERE)
from fetch_one import download_clip  # noqa: E402


def upsert(path, rec, key="file"):
    items = []
    if os.path.exists(path):
        try:
            items = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            items = []
    items = [it for it in items if it.get(key) != rec.get(key)]
    items.append(rec)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--slug", required=True, help="lower-case [a-z0-9-]; file = yt-<slug>.mp4")
    ap.add_argument("--section", nargs=2, type=float, metavar=("START", "END"), default=None)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--moves", default="", help="comma list of move slugs this clip shows")
    ap.add_argument("--cookies-from-browser", default=None)
    args = ap.parse_args()

    slug = args.slug.strip().lower()
    file = f"yt-{slug}.mp4"
    out = os.path.join(CLIPS, file)
    section = list(args.section) if args.section else None

    print(f"downloading {args.url} -> {file}"
          + (f"  [{section[0]:.0f}..{section[1]:.0f}s]" if section else ""))
    info, path = download_clip(args.url, out, args.height, section,
                               args.cookies_from_browser)
    if not path:
        print("FAIL: download produced no usable file", file=sys.stderr)
        return 1

    page = info.get("webpage_url") or args.url
    moves = [m.strip() for m in args.moves.split(",") if m.strip()]
    size_mb = round(os.path.getsize(path) / 1e6, 1)
    rec = {
        "title": info.get("title"),
        "url": page, "page": page,
        "author": info.get("uploader") or info.get("channel"),
        "license": LICENSE,
        "duration_s": info.get("duration"),
        "size_mb": size_mb,
        "file": file,
        "slug": slug, "kind": "move",
        "moves": moves,
        "query": "",
        "yt_id": info.get("id"),
        "section": section,
    }
    upsert(os.path.join(CLIPS, "manifest.json"), rec)
    if rec["yt_id"]:
        upsert(os.path.join(CLIPS, "youtube.json"), rec)
    print(f"OK  {file}  {size_mb}MB  ({info.get('title')!r})")
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
