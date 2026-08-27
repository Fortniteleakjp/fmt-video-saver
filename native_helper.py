"""FMT Video Saver のNative Messagingホスト。

拡張機能から受け取ったマニフェストURLと一時Cookieを yt-dlp に渡し、
HLS/DASHの取得・結合をローカルで行います。標準出力はNative Messaging専用です。
"""

import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile


HOST_NAME = "com.fmtsaver.helper"
PROGRESS_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")
CONFIG_NAME = "local-config.json"
PARTIAL_SUFFIXES = (".part", ".ytdl", ".temp")


def app_dir():
    """PyInstaller化した場合も含め、ヘルパー本体が置かれたディレクトリを返す。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def load_local_config():
    """ローカル専用設定（Gitに載せない）を読み込む。存在しなければ空設定。"""
    override = os.environ.get("FMT_VIDEO_SAVER_CONFIG")
    candidates = [Path(override)] if override else []
    candidates.append(app_dir() / CONFIG_NAME)
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                config = json.load(handle)
            return config if isinstance(config, dict) else {}
        except (OSError, ValueError):
            continue
    return {}


def host_of(url):
    match = re.match(r"https?://([^/?#]+)", str(url), re.IGNORECASE)
    if not match:
        return ""
    return match.group(1).split("@")[-1].split(":")[0].lower()


def host_matches(host, pattern, include_subdomains):
    pattern = str(pattern or "").lower().lstrip(".")
    if not host or not pattern:
        return False
    if host == pattern:
        return True
    return bool(include_subdomains) and host.endswith("." + pattern)


def extra_headers_for(url, rules):
    """登録ホストに一致した時だけ追加ヘッダを返す。

    トークンを無関係なCDNへ送らないよう、対象URLのホストで明示的に絞り込む。
    rules は先頭が優先（拡張が実測したトークン → ローカル設定の順に渡す）。
    """
    host = host_of(url)
    headers = []
    seen = set()
    for rule in rules or []:
        if not isinstance(rule, dict):
            continue
        name = re.sub(r"[\r\n:]", "", str(rule.get("header") or "Authorization")).strip()
        value = re.sub(r"[\r\n]", "", str(rule.get("value") or "")).strip()
        if not name or not value or name.lower() in seen:
            continue
        include_subdomains = rule.get("includeSubdomains", True)
        if any(host_matches(host, pattern, include_subdomains) for pattern in rule.get("hosts") or []):
            headers.append((name, value))
            seen.add(name.lower())
    return headers


def cleanup_partials(download_dir, base_name):
    """前回失敗の残骸だけを消す。完成済みの動画ファイルには触れない。"""
    removed = []
    try:
        entries = list(download_dir.iterdir())
    except OSError:
        return removed
    for path in entries:
        name = path.name
        if not path.is_file() or not name.startswith(base_name + "."):
            continue
        tail = name[len(base_name):]
        is_partial = tail.endswith(PARTIAL_SUFFIXES) or ".part-Frag" in tail
        if not is_partial:
            continue
        try:
            path.unlink()
            removed.append(name)
        except OSError:
            pass
    return removed


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    length = struct.unpack("<I", header)[0]
    if length > 16 * 1024 * 1024:
        raise ValueError("メッセージが大きすぎます")
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        raise ValueError("メッセージが途中で終了しました")
    return json.loads(payload.decode("utf-8"))


def write_message(message):
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def find_ytdlp():
    for command in ("yt-dlp.exe", "yt-dlp"):
        path = shutil.which(command)
        if path:
            return [path]
    try:
        subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        return [sys.executable, "-m", "yt_dlp"]
    except (OSError, subprocess.SubprocessError):
        return None


def safe_filename(value):
    value = str(value or "video")
    value = "".join("_" if char in '<>:/\\|?*"' or ord(char) < 32 else char for char in value)
    value = " ".join(value.split()).strip(" .")
    return (value or "video")[:120]


def write_cookie_file(cookies):
    if not cookies:
        return None
    handle = tempfile.NamedTemporaryFile(prefix="fmt-saver-", suffix=".txt", delete=False, mode="w", encoding="utf-8", newline="\n")
    try:
        handle.write("# Netscape HTTP Cookie File\n")
        for cookie in cookies:
            domain = str(cookie.get("domain", ""))
            path = str(cookie.get("path", "/")) or "/"
            name = str(cookie.get("name", ""))
            value = str(cookie.get("value", ""))
            if not domain or not name:
                continue
            include_subdomains = "TRUE" if domain.startswith(".") else "FALSE"
            secure = "TRUE" if cookie.get("secure") else "FALSE"
            expires = cookie.get("expirationDate") or 0
            try:
                expires = int(float(expires))
            except (TypeError, ValueError):
                expires = 0
            handle.write("\t".join([domain, include_subdomains, path, secure, str(expires), name, value]) + "\n")
        handle.close()
        return handle.name
    except Exception:
        handle.close()
        try:
            os.unlink(handle.name)
        except OSError:
            pass
        raise


def download_stream(request, send_progress):
    url = str(request.get("url", ""))
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "HTTP(S) URLのみ処理できます。"}

    ytdlp = find_ytdlp()
    if not ytdlp:
        return {"ok": False, "error": "yt-dlp が見つかりません。yt-dlpをPATHに追加してください。"}

    download_dir = Path(os.environ.get("FMT_VIDEO_SAVER_DOWNLOAD_DIR", Path.home() / "Downloads"))
    download_dir.mkdir(parents=True, exist_ok=True)
    base_name = safe_filename(Path(str(request.get("filename", "video"))).stem)
    output_template = str(download_dir / f"{base_name}.%(ext)s")
    # 拡張がページから実測したトークンを優先し、無ければローカル設定を使う
    auth_rules = list(request.get("authHeaders") or []) + list(load_local_config().get("authHeaders") or [])
    cleanup_partials(download_dir, base_name)
    cookie_path = None
    try:
        cookie_path = write_cookie_file(request.get("cookies", []))
        args = ytdlp + [
            "--no-playlist",
            "--newline",
            "--windows-filenames",
            "--output",
            output_template,
        ]
        if request.get("mode") == "youtube-audio":
            args.extend([
                "--format", "bestaudio/best",
                "--extract-audio",
                "--audio-format", "wav",
                "--audio-quality", "0",
            ])
        else:
            args.extend([
                "--format", "bestvideo+bestaudio/best",
                "--merge-output-format", "mp4",
            ])
        if request.get("mode", "").startswith("youtube"):
            # nチャレンジ解決にはJSランタイムとEJSソルバースクリプトの両方が必要
            args.extend(["--remote-components", "ejs:github"])
            node = shutil.which("node.exe") or shutil.which("node")
            if node:
                args.extend(["--js-runtimes", f"node:{node}"])
        else:
            # 汎用サイトでTLS/HTTP fingerprintを要求する場合にcurl_cffiを利用する
            args.extend(["--extractor-args", "generic:impersonate", "--impersonate", "chrome"])
        args.extend(["--retries", "10", "--fragment-retries", "10"])
        if cookie_path:
            args.extend(["--cookies", cookie_path])
        if request.get("referer", "").startswith(("http://", "https://")):
            args.extend(["--referer", str(request["referer"])])
        for name, value in extra_headers_for(url, auth_rules):
            args.extend(["--add-header", f"{name}:{value}"])
        ffmpeg = os.environ.get("FMT_VIDEO_SAVER_FFMPEG") or shutil.which("ffmpeg")
        if ffmpeg:
            args.extend(["--ffmpeg-location", str(Path(ffmpeg).parent)])
        args.append(url)

        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        output_lines = []
        for line in process.stdout:
            line = line.rstrip()
            if line:
                output_lines.append(line)
                match = PROGRESS_RE.search(line)
                if match:
                    send_progress(float(match.group(1)), "取得中")
                elif "[Merger]" in line or "Merging formats" in line:
                    send_progress(99, "映像と音声を結合中")
                elif "[ExtractAudio]" in line:
                    send_progress(98, "音声を処理中")
        return_code = process.wait()
        output = "\n".join(output_lines)
        if return_code != 0:
            return {"ok": False, "error": output[-4000:] or "yt-dlpの処理に失敗しました。"}

        produced = []
        for path in download_dir.glob(f"{base_name}.*"):
            if path.is_file() and path.suffix.lower() not in {".part", ".ytdl"}:
                produced.append(path)
        produced.sort(key=lambda path: path.stat().st_mtime, reverse=True)
        return {"ok": True, "path": str(produced[0]) if produced else str(download_dir), "message": "ダウンロードと結合が完了しました。"}
    except OSError as error:
        return {"ok": False, "error": f"ローカル実行に失敗しました: {error}"}
    finally:
        if cookie_path:
            try:
                os.unlink(cookie_path)
            except OSError:
                pass


def main():
    while True:
        try:
            request = read_message()
            if request is None:
                return
            if request.get("type") == "download":
                job_id = request.get("jobId", "")
                response = download_stream(
                    request,
                    lambda progress, stage: write_message({
                        "ok": True,
                        "event": "progress",
                        "jobId": job_id,
                        "progress": max(0, min(99, round(progress))),
                        "stage": stage,
                    }),
                )
                response["event"] = "complete"
                response["jobId"] = job_id
            else:
                response = {"ok": False, "error": f"未対応の要求です: {request.get('type')}"}
            write_message(response)
        except Exception as error:  # Native Messagingが切断されないよう応答する
            write_message({"ok": False, "error": f"Nativeヘルパーエラー: {error}"})


if __name__ == "__main__":
    main()
