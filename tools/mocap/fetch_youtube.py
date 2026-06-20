# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "yt-dlp>=2025.1",
# ]
# ///
"""
Fetch capoeira move clips from YouTube for the move library.

Reads sources.json (the curated move -> query catalog), and for every entry
either downloads an explicit `url` or runs a yt-dlp search on `query` and
auto-picks the best instructional candidate. Clips land in clips/ as
`yt-<slug>.mp4` (so extract_moves.py globs them) and a provenance + move-tag
record is merged into clips/manifest.json (and the richer clips/youtube.json).

Copyright: footage is fetched only to run pose estimation (algorithmic
analysis). Nothing is redistributed or used to train anything.

Examples (from repo root):
  # 1) Probe candidates without downloading (sanity-check titles/durations):
  uv run tools/mocap/fetch_youtube.py --search-only --priority 1

  # 2) Download the priority-1 set (kicks, dodges, core floreios/quedas, comps):
  uv run tools/mocap/fetch_youtube.py --priority 1

  # 3) A single move (or comma list), forcing a re-download:
  uv run tools/mocap/fetch_youtube.py --slugs martelo,armada --force

  # 4) If YouTube asks you to "sign in to confirm you're not a bot":
  uv run tools/mocap/fetch_youtube.py --slugs martelo --cookies-from-browser edge
"""
import argparse, glob, json, math, os, sys, time

for _s in (sys.stdout, sys.stderr):          # YouTube titles are full of emoji
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
SOURCES = os.path.join(HERE, "sources.json")
MIN_BYTES = 250_000          # smaller than this = a broken/partial download

STOP = {"capoeira", "tutorial", "how", "to", "the", "a", "de", "da", "do",
        "e", "kick", "takedown", "basic", "all", "names", "step", "by"}
INSTRUCTIONAL = ["tutorial", "how to", "como", "aula", "aprenda", "passo",
                 "basic", "básico", "basico", "lesson", "learn", "fazer",
                 "step by step", "iniciante", "beginner", "tutoriais"]
BAD = ["live", "ao vivo", "roda completa", "podcast", "reaction", "react",
       "music video", "clipe", "berimbau solo", "documentary", "documentário"]


def load_sources():
    with open(SOURCES, encoding="utf-8") as f:
        data = json.load(f)
    moves = {m["slug"]: m for m in data["moves"]}
    entries = []
    for c in data.get("compilations", []):
        entries.append({**c, "kind": "compilation"})
    for m in data["moves"]:
        entries.append({**m, "kind": "move", "covers": m.get("covers", [m["slug"]])})
    return entries, moves


def keywords(query):
    return [w for w in "".join(c if c.isalnum() or c == " " else " "
                               for c in query.lower()).split()
            if w not in STOP and len(w) > 1]


def score(entry, kws, is_comp):
    """Heuristic relevance score for one yt-dlp search result."""
    title = (entry.get("title") or "").lower()
    if not title:
        return -1.0
    dur = entry.get("duration")
    s = 0.0
    s += 3.0 * sum(1 for k in set(kws) if k in title)         # query keyword hits
    if any(p in title for p in INSTRUCTIONAL):
        s += 3.5                                              # looks like a lesson
    if any(b in title for b in BAD):
        s -= 5.0
    lo, hi = (45, 2400) if is_comp else (8, 720)              # sane duration window
    if dur:
        if lo <= dur <= hi:
            s += 2.0
        elif dur < lo:
            s -= 2.0
        else:
            s -= min(4.0, (dur - hi) / 600.0)
    else:
        s -= 0.5                                              # unknown duration
    vc = entry.get("view_count") or 0
    s += min(1.5, math.log10(vc + 10) / 4.0)                  # mild popularity nudge
    return s


def search(ydl, query, n):
    info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    return [e for e in (info or {}).get("entries", []) if e]


def webpage(entry):
    u = entry.get("webpage_url") or entry.get("url") or ""
    if u.startswith("http"):
        return u
    return f"https://www.youtube.com/watch?v={entry.get('id')}"


def pick(entry, candidates):
    is_comp = entry["kind"] == "compilation"
    kws = keywords(entry["query"])
    ranked = sorted(((score(c, kws, is_comp), c) for c in candidates),
                    key=lambda x: x[0], reverse=True)
    return ranked


def existing_clip(slug):
    for p in glob.glob(os.path.join(CLIPS, f"yt-{slug}.*")):
        if os.path.splitext(p)[1].lower() in (".mp4", ".mkv", ".webm", ".m4v"):
            return p
    return None


def download(entry, url, height, section, cookies):
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import download_range_func
    slug = entry["slug"]
    opts = {
        "format": (f"bv*[height<={height}]+ba/b[height<={height}]/"
                   f"bv*+ba/b"),
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(CLIPS, f"yt-{slug}.%(ext)s"),
        "noplaylist": True, "quiet": True, "no_warnings": True,
        "retries": 5, "fragment_retries": 5, "concurrent_fragment_downloads": 4,
        "windowsfilenames": True, "overwrites": True,
    }
    if section:
        opts["download_ranges"] = download_range_func(None, [tuple(section)])
        opts["force_keyframes_at_cuts"] = True
    if cookies:
        opts["cookiesfrombrowser"] = (cookies,)
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    path = existing_clip(slug)
    return info, path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--priority", type=int, default=1,
                    help="1=main moves (round 1), 2=long tail, 0=all")
    ap.add_argument("--slugs", default="", help="comma list to limit to")
    ap.add_argument("--kind", choices=["all", "move", "compilation"], default="all")
    ap.add_argument("--search-only", action="store_true",
                    help="probe candidates, write candidates.json, no download")
    ap.add_argument("--max-results", type=int, default=6)
    ap.add_argument("--height", type=int, default=480, help="max video height")
    ap.add_argument("--cookies-from-browser", default=None,
                    help="edge/chrome/firefox if YouTube demands a login")
    ap.add_argument("--force", action="store_true", help="re-download if present")
    args = ap.parse_args()

    from yt_dlp import YoutubeDL
    os.makedirs(CLIPS, exist_ok=True)
    entries, moves = load_sources()

    only = {s.strip() for s in args.slugs.split(",") if s.strip()}
    sel = []
    for e in entries:
        if only:
            if e["slug"] not in only:
                continue
        else:
            if args.priority and e.get("priority", 1) != args.priority:
                continue
            if args.kind != "all" and e["kind"] != args.kind:
                continue
        sel.append(e)

    if not sel:
        print("Nothing selected.", file=sys.stderr)
        sys.exit(1)

    print(f"{'PROBE' if args.search_only else 'FETCH'} {len(sel)} entries "
          f"(priority={args.priority or 'all'}, kind={args.kind})\n")

    sopts = {"quiet": True, "no_warnings": True, "extract_flat": True,
             "skip_download": True, "noplaylist": True}
    if args.cookies_from_browser:
        sopts["cookiesfrombrowser"] = (args.cookies_from_browser,)

    candidates_out, manifest_add, failures = {}, [], []
    with YoutubeDL(sopts) as syd:
        for i, e in enumerate(sel, 1):
            slug = e["slug"]
            head = f"[{i}/{len(sel)}] {slug:<22}"
            url, section = e.get("url"), e.get("section")

            if not args.force and not args.search_only:
                ex = existing_clip(slug)
                if ex:
                    print(f"{head} skip (have {os.path.basename(ex)})")
                    continue

            # Build an ordered list of (url, title, dur) to try. For a search,
            # that's the ranked candidates so we can fall back past a dead /
            # 403'd / broken video to the next-best one.
            attempts = []
            if url:
                attempts.append((url, e.get("title", slug), None))
                print(f"{head} -> explicit url")
            else:
                try:
                    cands = search(syd, e["query"], args.max_results)
                except Exception as ex:
                    print(f"{head} SEARCH FAIL: {ex}")
                    failures.append((slug, f"search: {ex}"))
                    continue
                ranked = pick(e, cands)
                candidates_out[slug] = [
                    {"score": round(sc, 2), "id": c.get("id"),
                     "title": c.get("title"), "dur": c.get("duration"),
                     "views": c.get("view_count"), "url": webpage(c)}
                    for sc, c in ranked[:args.max_results]]
                if not ranked:
                    print(f"{head} no candidates")
                    failures.append((slug, "no candidates"))
                    continue
                attempts = [(webpage(c), c.get("title") or "", c.get("duration"))
                            for _sc, c in ranked[:4]]
                best = ranked[0][1]
                print(f"{head} -> {ranked[0][0]:.1f}  {(best.get('title') or '')[:60]!r}"
                      f"  ({best.get('duration')}s)")

            if args.search_only:
                continue

            info = path = None
            last_err = "no candidates downloaded"
            for ai, (u, title, dur) in enumerate(attempts):
                if ai:
                    print(f"        fallback #{ai}: {title[:54]!r}")
                try:
                    info, path = download(e, u, args.height, section,
                                          args.cookies_from_browser)
                except Exception as ex:
                    last_err = str(ex).splitlines()[0][:150]
                    info = path = None
                    continue
                if path and os.path.exists(path) and os.path.getsize(path) >= MIN_BYTES:
                    break
                last_err = "broken/partial download (too small)"
                if path and os.path.exists(path):
                    try: os.remove(path)
                    except OSError: pass
                info = path = None

            if not (info and path):
                print(f"        DOWNLOAD FAIL: {last_err}")
                failures.append((slug, f"download: {last_err}"))
                continue

            size_mb = round(os.path.getsize(path) / 1e6, 1)
            rec = {
                "title": info.get("title"),
                "url": webpage(info), "page": webpage(info),
                "author": info.get("uploader") or info.get("channel"),
                "license": "YouTube (fetched for algorithmic pose analysis only)",
                "duration_s": info.get("duration"),
                "size_mb": size_mb,
                "file": os.path.basename(path),
                "slug": slug, "kind": e["kind"],
                "moves": e.get("covers", [slug]),
                "query": e.get("query"), "yt_id": info.get("id"),
                "section": section,
            }
            manifest_add.append(rec)
            print(f"        ok  {rec['file']}  {size_mb}MB  ({rec['duration_s']}s)")
            time.sleep(0.4)

    if candidates_out:
        with open(os.path.join(CLIPS, "candidates.json"), "w", encoding="utf-8") as f:
            json.dump(candidates_out, f, ensure_ascii=False, indent=2)
        print(f"\nWrote candidates.json ({len(candidates_out)} queries)")

    if args.search_only:
        print("\nSearch-only: review clips/candidates.json, then run without "
              "--search-only.")
        return

    # Merge into clips/manifest.json (key by file) + write richer youtube.json.
    mpath = os.path.join(CLIPS, "manifest.json")
    manifest = []
    if os.path.exists(mpath):
        manifest = json.load(open(mpath, encoding="utf-8"))
    by_file = {m.get("file"): m for m in manifest}
    for rec in manifest_add:
        by_file[rec["file"]] = rec
    manifest = list(by_file.values())
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    ypath = os.path.join(CLIPS, "youtube.json")
    yt = [m for m in manifest if m.get("yt_id")]
    with open(ypath, "w", encoding="utf-8") as f:
        json.dump(yt, f, ensure_ascii=False, indent=2)

    ok = len(manifest_add)
    print(f"\nDownloaded {ok} clip(s). manifest.json now lists {len(manifest)} "
          f"file(s) ({len(yt)} from YouTube).")
    if failures:
        print(f"\n{len(failures)} failure(s):")
        for slug, why in failures:
            print(f"  - {slug}: {why}")
    print("\nNext: uv run tools/mocap/extract_moves.py   (GPU pose extraction)")


if __name__ == "__main__":
    main()
