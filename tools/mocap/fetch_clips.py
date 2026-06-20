# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Fetch CC-licensed capoeira videos from Wikimedia Commons for mocap.

Queries the Commons API for capoeira videos, keeps the short, movement-rich
ones (drops interviews/talks), downloads them into tools/mocap/clips/ and
writes clips/manifest.json with full provenance (title, source page, author,
license) — CC BY-SA requires attribution, so that file is the source of truth
and is committed even though the heavy video files are git-ignored.

Run:  uv run tools/mocap/fetch_clips.py
"""
import json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
UA = "RodaCapoeira-mocap/1.0 (research; capoeira movement lexicon)"

API = "https://commons.wikimedia.org/w/api.php"
MAX_DURATION = 70          # seconds — short demos/rodas, not lectures
MAX_MB = 50
# Titles that are talks/interviews, not movement.
SKIP = re.compile(r"conversa|idoso|VOA|ONU|d[eé]cada|afrodescend|milit|nampula|"
                  r"patr[ií]cia|filme conta|renasce", re.I)


def api(params):
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{API}?{qs}", headers={"User-Agent": UA})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def download(url, dest):
    """Commons rate-limits bursts; retry with backoff and space requests out."""
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Referer": "https://commons.wikimedia.org/",
                "Accept": "*/*",
            })
            with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
                f.write(r.read())
            return True
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                wait = 15 * (attempt + 1)
                print(f"        429 rate-limited, waiting {wait}s ...", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"        FAILED: {e}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"        FAILED: {e}", file=sys.stderr)
            return False
    return False


def main():
    os.makedirs(CLIPS, exist_ok=True)
    data = api({
        "action": "query", "format": "json",
        "generator": "search",
        "gsrsearch": "capoeira filetype:video",
        "gsrnamespace": "6", "gsrlimit": "50",
        "prop": "imageinfo",
        "iiprop": "url|size|mime|duration|extmetadata",
    })
    pages = list(data.get("query", {}).get("pages", {}).values())
    picks = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        if not str(ii.get("mime", "")).startswith("video"):
            continue
        dur = float(ii.get("duration") or 0)
        mb = (ii.get("size") or 0) / 1e6
        title = p["title"]
        if SKIP.search(title) or dur > MAX_DURATION or mb > MAX_MB:
            continue
        em = ii.get("extmetadata", {})
        picks.append({
            "title": title,
            "url": ii["url"],
            "page": ii.get("descriptionurl"),
            "license": strip_html(em.get("LicenseShortName", {}).get("value")),
            "author": strip_html(em.get("Artist", {}).get("value")),
            "duration_s": round(dur, 1),
            "size_mb": round(mb, 1),
        })

    picks.sort(key=lambda x: x["size_mb"])
    print(f"Selected {len(picks)} movement clips (of {len(pages)} found):")
    manifest = []
    for it in picks:
        base = re.sub(r"^File:", "", it["title"])
        base = re.sub(r"[^\w.-]+", "_", base)
        if not base.lower().endswith((".webm", ".ogv", ".ogg", ".mp4")):
            base += ".webm"
        dest = os.path.join(CLIPS, base)
        it["file"] = base
        manifest.append(it)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"  have  {base}")
            continue
        print(f"  get   {base}  ({it['size_mb']}MB, {it['duration_s']}s, {it['license']})")
        if download(it["url"], dest):
            time.sleep(4)  # be polite between originals

    with open(os.path.join(CLIPS, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\nWrote provenance for {len(manifest)} clips -> clips/manifest.json")


if __name__ == "__main__":
    main()
