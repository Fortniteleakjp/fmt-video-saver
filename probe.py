import json, os, struct, subprocess, sys, tempfile
from pathlib import Path

d = Path(tempfile.mkdtemp(prefix="probe-"))
for n in ["test.mp4", "test.mp4.part", "test.mp4.part-Frag1", "test.mp4.ytdl"]:
    (d / n).write_text("x")
print("before:", sorted(p.name for p in d.iterdir()))

msg = json.dumps({"type": "download", "jobId": "t", "url": "https://example.invalid/x.m3u8",
                  "filename": "test.m3u8", "mode": "stream"}).encode()
env = dict(os.environ, FMT_VIDEO_SAVER_DOWNLOAD_DIR=str(d))
p = subprocess.run([sys.argv[1]], input=struct.pack("<I", len(msg)) + msg,
                   capture_output=True, env=env, timeout=180)
print("after :", sorted(x.name for x in d.iterdir()))
