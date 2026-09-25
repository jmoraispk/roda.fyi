# /// script
# requires-python = ">=3.10"
# dependencies = ["imageio-ffmpeg>=0.5"]
# ///
"""Transcode an uploaded phone video into the capture tool's working proxy.

  uv run tools/mocap/make_proxy.py <in.mov> <out.proxy.mp4>

Phone footage is usually HEVC, variable frame rate, and may carry a rotation
flag. The proxy is constant 30 fps H.264 with the rotation baked in, long side
<= 1920 px, and a keyframe every 15 frames. That way frame N is the same frame
in the browser, the pose tracker and the fused output, and scrubbing over an SSH
tunnel stays snappy. The original upload is kept untouched next to it.

Uses the static ffmpeg from imageio-ffmpeg (no system ffmpeg needed).
Prints `@@progress <done_ms> <total_ms>` lines for the job runner.
"""
import os
import re
import subprocess
import sys

import imageio_ffmpeg

FPS = 30


def duration_ms(ffmpeg, src):
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", src], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    if not m:
        raise SystemExit(f"cannot read duration of {src}:\n{r.stderr[-800:]}")
    h, mi, s = m.groups()
    return int((int(h) * 3600 + int(mi) * 60 + float(s)) * 1000)


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    total = duration_ms(ffmpeg, src)
    tmp = out + ".tmp.mp4"
    scale = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'"
    cmd = [ffmpeg, "-hide_banner", "-y", "-i", src, "-map", "0:v:0", "-an",
           "-vf", f"fps={FPS},{scale},format=yuv420p",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
           "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
           "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", tmp]
    print(f"@@stage transcode ({total / 1000:.0f}s of video)", flush=True)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in proc.stdout:
        if line.startswith("out_time_us="):
            try:
                print(f"@@progress {int(line.split('=')[1]) // 1000} {total}", flush=True)
            except ValueError:
                pass
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise SystemExit(f"ffmpeg failed:\n{err[-2000:]}")
    os.replace(tmp, out)
    print(f"proxy -> {out} ({os.path.getsize(out) / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
