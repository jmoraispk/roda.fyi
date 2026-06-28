# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "yt-dlp>=2025.1",
# ]
# ///
"""Download a single YouTube clip to an exact output path.

Used by the segment tool's on-demand "library" loader (via tools/serve.py's
/api/clip endpoint): we keep only pose.json + the source URL in the repo, so
when you want to *watch* an annotated clip we re-fetch the exact video it was
analysed from. Downloading the exact URL (not a fresh search) keeps the video
frame-aligned with its pose overlay.

  uv run tools/mocap/fetch_one.py --url https://youtu.be/ID --out tools/mocap/clips/yt-armada.mp4

Copyright: footage is fetched only to run/inspect pose analysis. Nothing is
redistributed or used to train anything.
"""
import argparse
import glob
import os
import sys

MIN_BYTES = 250_000


def download_clip(url, out, height=480, section=None, cookies=None):
    """Download one YouTube URL to an exact .mp4 path. `section` is an optional
    [start, end] in seconds (trims to that range, keyframe-accurate). Returns
    (info, path) where path is the written .mp4 or None on failure."""
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import download_range_func

    out = os.path.abspath(out)
    base = os.path.splitext(out)[0]
    os.makedirs(os.path.dirname(out), exist_ok=True)

    opts = {
        "format": (f"bv*[height<={height}]+ba/b[height<={height}]/bv*+ba/b"),
        "merge_output_format": "mp4",
        "outtmpl": base + ".%(ext)s",
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

    # yt-dlp should produce <base>.mp4; if a container slipped through, rename it.
    if not os.path.exists(out):
        for p in glob.glob(base + ".*"):
            if os.path.splitext(p)[1].lower() in (".mp4", ".mkv", ".webm", ".m4v"):
                try:
                    os.replace(p, out)
                except OSError:
                    pass
                break

    ok = os.path.exists(out) and os.path.getsize(out) >= MIN_BYTES
    return info, (out if ok else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="YouTube watch URL or https URL")
    ap.add_argument("--out", required=True, help="exact .mp4 path to write")
    ap.add_argument("--height", type=int, default=480, help="max video height")
    ap.add_argument("--section", nargs=2, type=float, metavar=("START", "END"),
                    default=None, help="trim to START..END seconds")
    ap.add_argument("--cookies-from-browser", default=None,
                    help="edge/chrome/firefox if YouTube demands a login")
    args = ap.parse_args()

    _info, path = download_clip(args.url, args.out, args.height,
                                args.section, args.cookies_from_browser)
    if path:
        print("OK " + path)
        return 0
    print("FAIL: no usable file written", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
