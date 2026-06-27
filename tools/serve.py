# /// script
# requires-python = ">=3.10"
# ///
"""Static file server for the repo root, with HTTP Range support.

  uv run tools/serve.py            # serve repo root on http://localhost:8137
  uv run tools/serve.py 9000       # custom port

Python's stdlib `http.server` ignores Range requests and streams whole files,
which makes a large video (ours is ~1 GB) effectively non-seekable in a
<video> element. This adds 206 Partial Content so the segment tool can stream
and frame-step the video straight from the server.
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_RANGE = re.compile(r"bytes=(\d*)-(\d*)\s*$")


class RangeHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if rng is None or not os.path.isfile(path):
            return super().do_GET()

        size = os.path.getsize(path)
        m = _RANGE.match(rng.strip())
        if not m or (m.group(1) == "" and m.group(2) == ""):
            return super().do_GET()

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
    print(f"serving {ROOT}\n  http://localhost:{port}  (Range-enabled)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
