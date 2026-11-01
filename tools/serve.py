# /// script
# requires-python = ">=3.10"
# ///
"""Static file server for the repo root, with HTTP Range support.

  uv run tools/serve.py            # serve repo root on http://localhost:8137
  uv run tools/serve.py 8140       # custom port (the capture tool runs on 8140)

Python's stdlib `http.server` ignores Range requests and streams whole files,
which makes a large video (ours is ~1 GB) effectively non-seekable in a
<video> element. This adds 206 Partial Content so the segment tool can stream
and frame-step the video straight from the server.

Also mounts the capture-session API (tools/capture_api.py): /api/capture/* and
/captures/* for tools/segment/capture.html. Localhost only, no auth.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capture_api  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CLIPS = os.path.join(ROOT, "tools", "mocap", "clips")
FETCH_ONE = os.path.join(ROOT, "tools", "mocap", "fetch_one.py")
_RANGE = re.compile(r"bytes=(\d*)-(\d*)\s*$")
_CLIP_NAME = re.compile(r"^yt-[a-z0-9_\-]+\.mp4$")   # yt id can carry '_' / '-'
MIN_BYTES = 250_000


class RangeHandler(SimpleHTTPRequestHandler):
    _downloading = set()                 # clip names currently being fetched
    _lock = threading.Lock()

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_clip(self):
        """On-demand: re-download an annotated clip's exact YouTube source so the
        segment tool can play it under its pose overlay. Footage isn't stored in
        the repo, so this fetches yt-<slug>.mp4 into tools/mocap/clips/ on first use."""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = (q.get("name") or [""])[0]
        yt = (q.get("yt") or [""])[0]
        sec = (q.get("sec") or [""])[0]            # optional "START-END" seconds (trim)
        if not _CLIP_NAME.match(name):
            return self._json(400, {"ok": False, "error": "bad clip name"})
        section = None
        if sec:
            m = re.match(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$", sec)
            if not m:
                return self._json(400, {"ok": False, "error": "bad sec range"})
            section = [m.group(1), m.group(2)]
        out = os.path.join(CLIPS, name)
        served = "/tools/mocap/clips/" + name
        if os.path.isfile(out) and os.path.getsize(out) >= MIN_BYTES:
            return self._json(200, {"ok": True, "path": served, "cached": True})
        if not yt:
            return self._json(400, {"ok": False, "error": "missing yt id/url"})
        url = yt if yt.startswith("http") else ("https://www.youtube.com/watch?v=" + yt)
        uv = shutil.which("uv")
        if not uv:
            return self._json(500, {"ok": False, "error": "uv not on PATH (needed to run yt-dlp)"})
        with RangeHandler._lock:
            if name in RangeHandler._downloading:
                return self._json(409, {"ok": False, "error": "already downloading — retry in a moment"})
            RangeHandler._downloading.add(name)
        try:
            os.makedirs(CLIPS, exist_ok=True)
            cmd = [uv, "run", FETCH_ONE, "--url", url, "--out", out]
            if section:
                cmd += ["--section", section[0], section[1]]
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
            if os.path.isfile(out) and os.path.getsize(out) >= MIN_BYTES:
                return self._json(200, {"ok": True, "path": served})
            tail = (r.stderr or r.stdout or "download failed").strip().splitlines()
            return self._json(502, {"ok": False, "error": tail[-1] if tail else "download failed"})
        except subprocess.TimeoutExpired:
            return self._json(504, {"ok": False, "error": "download timed out"})
        except Exception as e:                                   # noqa: BLE001
            return self._json(500, {"ok": False, "error": str(e)})
        finally:
            with RangeHandler._lock:
                RangeHandler._downloading.discard(name)

    def do_POST(self):
        if not capture_api.handle(self, "POST"):
            self._json(404, {"error": "unknown endpoint"})

    def do_PUT(self):
        if not capture_api.handle(self, "PUT"):
            self._json(404, {"error": "unknown endpoint"})

    def do_HEAD(self):
        if capture_api.handle(self, "HEAD"):
            return
        return super().do_HEAD()

    def do_GET(self):
        if self.path.startswith("/api/clip"):
            return self.handle_clip()
        if capture_api.handle(self, "GET"):
            return
        parsed = urllib.parse.urlsplit(self.path)
        clean_path = self.translate_path(parsed.path)
        if not os.path.isfile(clean_path) and os.path.isfile(clean_path + ".html"):
            self.path = parsed.path + ".html"
            if parsed.query:
                self.path += "?" + parsed.query
        path = self.translate_path(self.path)
        if self.headers.get("Range") is None or not os.path.isfile(path):
            return super().do_GET()
        return self.send_file(path)

    def send_file(self, path, head=False):
        """Serve a file, honouring a single-range `Range` header (206)."""
        size = os.path.getsize(path)
        m = _RANGE.match((self.headers.get("Range") or "").strip())
        if not m or (m.group(1) == "" and m.group(2) == ""):
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if not head:
                with open(path, "rb") as f:
                    try:
                        shutil.copyfileobj(f, self.wfile, 256 * 1024)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
            return

        if m.group(1) == "":                       # suffix range: last N bytes
            start, end = max(0, size - int(m.group(2))), size - 1
        else:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)

        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        if head:
            return

        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                buf = f.read(min(64 * 1024, remaining))
                if not buf:
                    break
                try:
                    self.wfile.write(buf)
                except (BrokenPipeError, ConnectionResetError):
                    break                          # browser cancelled the range (normal while seeking)
                remaining -= len(buf)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), RangeHandler)
    print(f"serving {ROOT}\n  http://localhost:{port}  (Range-enabled)\n"
          f"  capture data: {capture_api.CAPTURE_DIR}  pose GPUs: {','.join(capture_api.GPUS)}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
