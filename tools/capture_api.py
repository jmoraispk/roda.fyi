"""Capture-session API for tools/segment/capture.html (stdlib only; mounted by serve.py).

Internal tool: bound to localhost by serve.py, no auth. Everything heavy lives in
the capture data dir (git-ignored), one folder per session:

  <CAPTURE_DIR>/<session>/
    session.json                 meta + per-view marks (edited by the UI)
    front.orig.<ext>             uploaded original (never modified)
    front.proxy.mp4              30 fps H.264 proxy — what the UI plays and tracking runs on
    front.track.json             pose track over the proxy (track.json schema)
    side.*                       same for the side take
    fused/<slug>/<variant>.json  motion v2 result (+ .qa.json for the QA view)
    .uploads/                    in-progress chunked uploads

Env:
  RODA_CAPTURE_DIR   data dir (default: <main checkout>/tools/mocap/captures)
  RODA_CAPTURE_GPUS  comma list of GPU ids for pose jobs (default "1")
"""
import datetime
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import uuid
from collections import deque

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _main_checkout():
    """The primary checkout (worktrees share its git dir); falls back to ROOT."""
    try:
        common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=ROOT,
                                         text=True, stderr=subprocess.DEVNULL).strip()
        return os.path.dirname(os.path.abspath(os.path.join(ROOT, common)))
    except Exception:                                            # noqa: BLE001
        return ROOT


MAIN = _main_checkout()
CAPTURE_DIR = os.path.abspath(os.environ.get("RODA_CAPTURE_DIR") or os.path.join(MAIN, "tools", "mocap", "captures"))
GPUS = [g.strip() for g in os.environ.get("RODA_CAPTURE_GPUS", "1").split(",") if g.strip()]
MOCAP = os.path.join(ROOT, "tools", "mocap")


def _first_existing(*paths):
    return next((p for p in paths if os.path.exists(p)), None)


VENV_PY = _first_existing(os.path.join(MOCAP, ".venv", "bin", "python"),
                          os.path.join(MAIN, "tools", "mocap", ".venv", "bin", "python"))
MODELS = _first_existing(os.path.join(MOCAP, "models"), os.path.join(MAIN, "tools", "mocap", "models"))
UV = shutil.which("uv")

VIEWS = ("front", "side")
_SID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_FILE = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$")
_VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}
_LOCK = threading.Lock()


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "session"


def sdir(sid):
    if not _SID.match(sid or ""):
        raise ValueError("bad session id")
    return os.path.join(CAPTURE_DIR, sid)


def _read(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _view_status(d, view, meta):
    st = {"original": meta.get("views", {}).get(view, {}).get("original")}
    proxy = os.path.join(d, f"{view}.proxy.mp4")
    st["proxy"] = f"{view}.proxy.mp4" if os.path.isfile(proxy) else None
    st["track"] = _read(os.path.join(d, f"{view}.track.info.json"))
    return st


def session_doc(sid):
    d = sdir(sid)
    meta = _read(os.path.join(d, "session.json"))
    if meta is None:
        return None
    meta["status"] = {v: _view_status(d, v, meta) for v in VIEWS}
    fused = []
    fdir = os.path.join(d, "fused")
    for slug in sorted(os.listdir(fdir)) if os.path.isdir(fdir) else []:
        for fn in sorted(os.listdir(os.path.join(fdir, slug))):
            if fn.endswith(".json") and not fn.endswith(".qa.json"):
                qa = _read(os.path.join(fdir, slug, fn[:-5] + ".qa.json"), {})
                fused.append({"slug": slug, "variant": fn[:-5], "path": f"fused/{slug}/{fn}",
                              "qa": f"fused/{slug}/{fn[:-5]}.qa.json", "metrics": qa.get("metrics")})
    meta["fused"] = fused
    return meta


def list_sessions():
    out = []
    if os.path.isdir(CAPTURE_DIR):
        for sid in sorted(os.listdir(CAPTURE_DIR), reverse=True):
            m = _read(os.path.join(CAPTURE_DIR, sid, "session.json"))
            if m:
                out.append({"id": sid, "name": m.get("name"), "created": m.get("created"),
                            "marks": {v: len(m.get("views", {}).get(v, {}).get("marks", [])) for v in VIEWS}})
    return out


def create_session(body):
    name = (body.get("name") or "").strip() or "capture"
    base = f"{datetime.date.today().isoformat()}-{_slug(name)}"
    sid, k = base, 2
    with _LOCK:
        while os.path.exists(os.path.join(CAPTURE_DIR, sid)):
            sid, k = f"{base}-{k}", k + 1
        os.makedirs(os.path.join(CAPTURE_DIR, sid))
        meta = {"version": 1, "id": sid, "name": name, "created": _now(),
                "height_m": float(body.get("height_m") or 1.75),
                "side_facing": body.get("side_facing") if body.get("side_facing") in ("left", "right") else "right",
                "notes": body.get("notes") or "",
                "views": {v: {"original": None, "marks": []} for v in VIEWS}}
        _write(os.path.join(CAPTURE_DIR, sid, "session.json"), meta)
    return session_doc(sid)


def update_session(sid, body):
    """Merge UI-editable fields; server-owned fields (originals) are preserved."""
    path = os.path.join(sdir(sid), "session.json")
    with _LOCK:
        meta = _read(path)
        if meta is None:
            raise FileNotFoundError(sid)
        for k in ("name", "notes"):
            if k in body:
                meta[k] = str(body[k])
        if "height_m" in body:
            meta["height_m"] = float(body["height_m"])
        if body.get("side_facing") in ("left", "right"):
            meta["side_facing"] = body["side_facing"]
        for v in VIEWS:
            marks = (body.get("views") or {}).get(v, {}).get("marks")
            if isinstance(marks, list):
                meta["views"][v]["marks"] = marks
        meta["updated"] = _now()
        _write(path, meta)
    return session_doc(sid)


# ---------------------------------------------------------------- uploads
def _upload_paths(uid):
    if not re.match(r"^[a-f0-9]{16}$", uid or ""):
        raise ValueError("bad upload id")
    for sid in os.listdir(CAPTURE_DIR) if os.path.isdir(CAPTURE_DIR) else []:
        meta = os.path.join(CAPTURE_DIR, sid, ".uploads", uid + ".json")
        if os.path.isfile(meta):
            return meta, meta[:-5] + ".part"
    raise FileNotFoundError(uid)


def upload_init(body):
    sid, view = body.get("session"), body.get("view")
    if view not in VIEWS:
        raise ValueError("view must be front or side")
    d = sdir(sid)
    if not os.path.isfile(os.path.join(d, "session.json")):
        raise FileNotFoundError(sid)
    name, size = os.path.basename(str(body.get("name") or "video.mp4")), int(body.get("size") or 0)
    ext = os.path.splitext(name)[1].lower()
    if ext not in _VIDEO_EXT or size <= 0:
        raise ValueError(f"unsupported file {name!r}")
    key = f"{sid}|{view}|{name}|{size}|{body.get('lastModified')}"
    uid = hashlib.sha1(key.encode()).hexdigest()[:16]
    up = os.path.join(d, ".uploads")
    os.makedirs(up, exist_ok=True)
    meta, part = os.path.join(up, uid + ".json"), os.path.join(up, uid + ".part")
    if not os.path.isfile(meta):
        _write(meta, {"id": uid, "session": sid, "view": view, "name": name, "size": size, "started": _now()})
        open(part, "ab").close()
    return {"id": uid, "offset": os.path.getsize(part), "size": size}


def upload_status(uid):
    meta_p, part = _upload_paths(uid)
    meta = _read(meta_p)
    return {"id": uid, "offset": os.path.getsize(part), "size": meta["size"]}


def upload_chunk(uid, offset, rfile, length):
    """Append `length` bytes at `offset` (must equal bytes already received)."""
    meta_p, part = _upload_paths(uid)
    meta = _read(meta_p)
    have = os.path.getsize(part)
    if offset != have:
        # Drain the body so the connection stays usable, then report where to resume.
        _drain(rfile, length)
        return 409, {"id": uid, "offset": have, "size": meta["size"], "error": "offset mismatch"}
    if have + length > meta["size"]:
        _drain(rfile, length)
        return 400, {"error": "chunk exceeds declared size"}
    with open(part, "ab") as f:
        left = length
        while left > 0:
            buf = rfile.read(min(1 << 20, left))
            if not buf:
                break
            f.write(buf)
            left -= len(buf)
    have = os.path.getsize(part)
    done = have == meta["size"]
    if done:
        _finish_upload(meta, part)
        os.remove(meta_p)
    return 200, {"id": uid, "offset": have, "size": meta["size"], "done": done}


def _drain(rfile, n):
    while n > 0:
        buf = rfile.read(min(1 << 20, n))
        if not buf:
            break
        n -= len(buf)


def _finish_upload(meta, part):
    sid, view = meta["session"], meta["view"]
    d = sdir(sid)
    for fn in os.listdir(d):                   # replace any previous take for this view
        if fn.startswith(view + "."):
            p = os.path.join(d, fn)
            if os.path.isfile(p):
                os.remove(p)
    dst = os.path.join(d, f"{view}.orig{os.path.splitext(meta['name'])[1].lower()}")
    os.replace(part, dst)
    with _LOCK:
        smeta = _read(os.path.join(d, "session.json"))
        smeta["views"][view]["original"] = {"name": meta["name"], "size": meta["size"],
                                            "file": os.path.basename(dst), "uploaded": _now()}
        _write(os.path.join(d, "session.json"), smeta)
    JOBS.submit("prepare", sid, view)


# ---------------------------------------------------------------- jobs
class Job:
    def __init__(self, kind, sid, view=None, args=None):
        self.id = uuid.uuid4().hex[:10]
        self.kind, self.session, self.view, self.args = kind, sid, view, args or {}
        self.state, self.progress, self.stage, self.error = "queued", 0.0, "", None
        self.created, self.started, self.ended = time.time(), None, None
        self.log = deque(maxlen=60)
        self.proc = None
        self.gpu = None

    def as_dict(self):
        return {k: getattr(self, k) for k in ("id", "kind", "session", "view", "args", "state", "progress",
                                               "stage", "error", "created", "started", "ended", "gpu")} | \
               {"log": list(self.log)[-15:]}


class JobQueue:
    def __init__(self):
        self.jobs = []
        self.cv = threading.Condition()
        self.started = False

    def start(self):
        if self.started:
            return
        self.started = True
        for g in GPUS:
            threading.Thread(target=self._worker, args=("gpu", g), daemon=True).start()
        threading.Thread(target=self._worker, args=("cpu", None), daemon=True).start()

    def submit(self, kind, sid, view=None, args=None):
        self.start()
        sdir(sid)
        with self.cv:
            for j in self.jobs:                 # don't queue the same work twice
                if (j.kind, j.session, j.view, j.args) == (kind, sid, view, args or {}) and j.state in ("queued", "running"):
                    return j
            j = Job(kind, sid, view, args)
            self.jobs.append(j)
            self.cv.notify_all()
        return j

    def list(self, sid=None):
        with self.cv:
            return [j.as_dict() for j in self.jobs if sid is None or j.session == sid][-50:]

    def cancel(self, jid):
        with self.cv:
            for j in self.jobs:
                if j.id == jid:
                    if j.state == "queued":
                        j.state, j.ended = "cancelled", time.time()
                    elif j.state == "running" and j.proc:
                        j.state = "cancelling"
                        j.proc.terminate()
                    return j.as_dict()
        return None

    def _next(self, pool):
        for j in self.jobs:
            if j.state == "queued" and _pool_of(j) == pool:
                # a pose job needs its proxy; wait while a prepare for that view is pending
                if j.kind == "pose" and any(o.kind == "prepare" and o.session == j.session and o.view == j.view
                                            and o.state in ("queued", "running") for o in self.jobs):
                    continue
                return j
        return None

    def _worker(self, pool, gpu):
        while True:
            with self.cv:
                j = self._next(pool)
                while j is None:
                    self.cv.wait(timeout=2.0)
                    j = self._next(pool)
                j.state, j.started, j.gpu = "running", time.time(), gpu
            try:
                _run_job(j, gpu)
                if j.state == "cancelling":
                    j.state = "cancelled"
                elif j.state == "running":
                    j.state, j.progress = "done", 1.0
            except Exception as e:                             # noqa: BLE001
                j.state, j.error = ("cancelled" if j.state == "cancelling" else "failed"), str(e)
            j.ended = time.time()
            with self.cv:
                self.cv.notify_all()


def _pool_of(j):
    if j.kind == "pose" and j.args.get("backend", "sapiens1b") != "mediapipe":
        return "gpu"
    return "cpu"


JOBS = JobQueue()
_PROGRESS = re.compile(r"^@@progress\s+(\d+)\s+(\d+)")
_STAGE = re.compile(r"^@@stage\s+(.+)")


def _job_command(j, gpu):
    d = sdir(j.session)
    env = dict(os.environ)
    if j.kind == "prepare":
        meta = _read(os.path.join(d, "session.json"))
        src = os.path.join(d, meta["views"][j.view]["original"]["file"])
        return [UV, "run", "--quiet", os.path.join(MOCAP, "make_proxy.py"), src,
                os.path.join(d, f"{j.view}.proxy.mp4")], env
    if j.kind == "pose":
        proxy = os.path.join(d, f"{j.view}.proxy.mp4")
        out = os.path.join(d, f"{j.view}.track.json")
        backend = j.args.get("backend", "sapiens1b")
        if backend == "mediapipe":
            return [UV, "run", "--quiet", os.path.join(MOCAP, "pose_track.py"), proxy,
                    "--mode", "image", "--max-w", "1920", "--out", out], env
        if not VENV_PY or not MODELS:
            raise RuntimeError("Sapiens needs tools/mocap/.venv and tools/mocap/models (main checkout)")
        env["CUDA_VISIBLE_DEVICES"] = gpu
        env["RODA_MOCAP_MODELS"] = MODELS
        cmd = [VENV_PY, os.path.join(MOCAP, "sapiens_track.py"), proxy, "--backend", backend,
               "--device", "cuda:0", "--out", out]
        if j.args.get("scope") == "marks":
            ranges = marked_ranges(j.session, j.view)
            if not ranges:
                raise RuntimeError(f"no spans marked in the {j.view} take yet (or track the whole video)")
            rpath = os.path.join(d, f"{j.view}.track.ranges.json")
            _write(rpath, ranges)
            j.log.append(f"tracking {len(ranges)} marked range(s), {sum(b - a for a, b in ranges)} frames")
            cmd += ["--ranges", rpath]
        return cmd, env
    if j.kind == "fuse":
        cmd = [UV, "run", "--quiet", os.path.join(MOCAP, "fuse_session.py"), d]
        if j.args.get("only"):
            cmd += ["--only", j.args["only"]]
        return cmd, env
    if j.kind == "publish":
        return [UV, "run", "--quiet", os.path.join(MOCAP, "fuse_session.py"), d,
                "--publish", j.args["target"]], env
    raise ValueError(f"unknown job kind {j.kind}")


def marked_ranges(sid, view, margin=30):
    """Merged [start, end) frame ranges covering every span in a view, +/- margin."""
    meta = _read(os.path.join(sdir(sid), "session.json")) or {}
    spans = sorted((max(0, int(m["start"]) - margin), int(m["end"]) + margin)
                   for m in meta.get("views", {}).get(view, {}).get("marks", []))
    out = []
    for a, b in spans:
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _run_job(j, gpu):
    cmd, env = _job_command(j, gpu)
    env["PYTHONUNBUFFERED"] = "1"
    j.log.append("$ " + " ".join(os.path.relpath(c, ROOT) if c.startswith(ROOT) else c for c in cmd))
    j.proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, bufsize=1)
    for line in j.proc.stdout:
        line = line.rstrip()
        m = _PROGRESS.match(line)
        if m:
            done, total = int(m.group(1)), int(m.group(2))
            j.progress = min(1.0, done / total) if total else 0.0
            continue
        m = _STAGE.match(line)
        if m:
            j.stage = m.group(1)
            continue
        if line:
            j.log.append(line)
    rc = j.proc.wait()
    if j.state == "cancelling":
        return
    if rc != 0:
        raise RuntimeError(f"exit {rc}: " + (j.log[-1] if j.log else ""))
    if j.kind == "pose":
        _write_track_info(j)


def _write_track_info(j):
    d = sdir(j.session)
    t = _read(os.path.join(d, f"{j.view}.track.json"), {})
    _write(os.path.join(d, f"{j.view}.track.info.json"),
           {"file": f"{j.view}.track.json", "backend": t.get("backend"), "fps": t.get("fps"),
            "n": t.get("n"), "detected": t.get("detected"), "w": t.get("w"), "h": t.get("h"),
            "scope": j.args.get("scope", "all"), "created": _now()})


# ---------------------------------------------------------------- HTTP glue
def config():
    return {"capture_dir": CAPTURE_DIR, "gpus": GPUS,
            "backends": (["sapiens1b", "sapiens2-5b"] if VENV_PY and MODELS else []) + ["mediapipe"],
            "stances": ["ginga-left-back", "ginga-right-back", "paralela", "cocorinha",
                        "negativa-left", "negativa-right", "stand"]}


def handle(h, method):
    """Route /api/capture/* and /captures/*. Returns True if handled."""
    path = urllib.parse.urlsplit(h.path).path
    if path.startswith("/captures/"):
        if method not in ("GET", "HEAD"):
            return False
        rel = urllib.parse.unquote(path[len("/captures/"):])
        if not _FILE.match(rel) or ".." in rel.split("/"):
            h._json(400, {"error": "bad path"})
            return True
        full = os.path.join(CAPTURE_DIR, rel)
        if not os.path.isfile(full) or "/.uploads/" in "/" + rel:
            h._json(404, {"error": "not found"})
            return True
        if full.endswith(".json") and "gzip" in (h.headers.get("Accept-Encoding") or ""):
            return _send_gzip_json(h, full, head=(method == "HEAD"))
        h.send_file(full, head=(method == "HEAD"))
        return True
    if not path.startswith("/api/capture/"):
        return False
    parts = path[len("/api/capture/"):].strip("/").split("/")
    try:
        body = {}
        if method in ("POST", "PUT") and not (parts[0] == "uploads" and method == "PUT"):
            n = int(h.headers.get("Content-Length") or 0)
            body = json.loads(h.rfile.read(n) or b"{}") if n else {}
        code, out = _route(h, method, parts, body)
    except FileNotFoundError as e:
        code, out = 404, {"error": f"not found: {e}"}
    except (ValueError, KeyError, TypeError) as e:
        code, out = 400, {"error": str(e)}
    except Exception as e:                                     # noqa: BLE001
        code, out = 500, {"error": str(e)}
    h._json(code, out)
    return True


def _route(h, method, parts, body):
    head = parts[0]
    if head == "config" and method == "GET":
        return 200, config()
    if head == "sessions":
        if len(parts) == 1:
            if method == "GET":
                return 200, list_sessions()
            if method == "POST":
                return 201, create_session(body)
        else:
            sid = parts[1]
            if method == "GET":
                doc = session_doc(sid)
                return (200, doc) if doc else (404, {"error": "no such session"})
            if method == "PUT":
                return 200, update_session(sid, body)
    if head == "uploads":
        if len(parts) == 1 and method == "POST":
            return 200, upload_init(body)
        if len(parts) == 2 and method == "GET":
            return 200, upload_status(parts[1])
        if len(parts) == 2 and method == "PUT":
            offset = int(h.headers.get("Upload-Offset", "-1"))
            length = int(h.headers.get("Content-Length") or 0)
            return upload_chunk(parts[1], offset, h.rfile, length)
    if head == "jobs":
        if len(parts) == 1 and method == "GET":
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(h.path).query)
            return 200, JOBS.list((q.get("session") or [None])[0])
        if len(parts) == 1 and method == "POST":
            kind, sid, view = body.get("kind"), body.get("session"), body.get("view")
            if kind not in ("prepare", "pose", "fuse", "publish"):
                raise ValueError("bad job kind")
            if kind in ("prepare", "pose") and view not in VIEWS:
                raise ValueError("view must be front or side")
            args = {}
            if kind == "pose":
                args["backend"] = body.get("backend") or "sapiens1b"
                args["scope"] = "marks" if body.get("scope") == "marks" else "all"
                if args["scope"] == "marks" and args["backend"] == "mediapipe":
                    args["scope"] = "all"        # MediaPipe is fast enough to run over everything
                if args["backend"] not in config()["backends"]:
                    raise ValueError(f"backend {args['backend']} unavailable")
                if not os.path.isfile(os.path.join(sdir(sid), f"{view}.proxy.mp4")) and not any(
                        j["kind"] == "prepare" and j["view"] == view and j["state"] in ("queued", "running")
                        for j in JOBS.list(sid)):
                    raise ValueError("upload the video first (no proxy yet)")
            if kind == "fuse" and body.get("only"):
                args["only"] = str(body["only"])
            if kind == "publish":
                if not re.match(r"^[a-z0-9-]+/[a-z0-9.-]+$", body.get("target") or ""):
                    raise ValueError("target must be <slug>/<variantKey>")
                args["target"] = body["target"]
            return 202, JOBS.submit(kind, sid, view if kind in ("prepare", "pose") else None, args).as_dict()
        if len(parts) == 3 and parts[2] == "cancel" and method == "POST":
            j = JOBS.cancel(parts[1])
            return (200, j) if j else (404, {"error": "no such job"})
    return 404, {"error": "unknown endpoint"}


def _send_gzip_json(h, full, head=False):
    gz = full + ".gz"
    if not os.path.isfile(gz) or os.path.getmtime(gz) < os.path.getmtime(full):
        with open(full, "rb") as f:
            data = gzip.compress(f.read(), compresslevel=5)
        with open(gz + ".tmp", "wb") as f:
            f.write(data)
        os.replace(gz + ".tmp", gz)
    size = os.path.getsize(gz)
    h.send_response(200)
    h.send_header("Content-Type", "application/json")
    h.send_header("Content-Encoding", "gzip")
    h.send_header("Content-Length", str(size))
    h.send_header("Cache-Control", "no-store")
    h.end_headers()
    if not head:
        with open(gz, "rb") as f:
            shutil.copyfileobj(f, h.wfile)
    return True
