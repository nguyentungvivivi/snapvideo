from concurrent.futures import ThreadPoolExecutor
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import yt_dlp

from services.extractor import _friendly_error, build_ydl_base_opts
from services.platform_detector import detect_platform, normalize_url

BASE_DIR = Path(__file__).resolve().parent.parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

JOB_TTL_SECONDS = 20 * 60  # Auto-clean completed files after 20 minutes
MAX_STORAGE_BYTES = int(1.5 * 1024 * 1024 * 1024)  # Cap temp folder at 1.5 GB for 0đ free hosts
MAX_WORKERS = int(os.environ.get("SNAPVID_WORKERS", "3"))

_jobs_lock = threading.Lock()
JOBS: Dict[str, Dict[str, Any]] = {}
_worker_pool = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="snapvid_dl")


def sanitize_filename(title: str, suffix: str, ext: str) -> str:
    """Build a clean, OS-safe filename preserving Vietnamese & Unicode characters."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title or "video")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    if not cleaned:
        cleaned = "snapvid_media"
    if len(cleaned) > 90:
        cleaned = cleaned[:90].strip()
    tag = f" ({suffix})" if suffix else ""
    return f"{cleaned}{tag}.{ext.lstrip('.')}"


def _format_speed(speed_bps: Optional[float]) -> Optional[str]:
    if not speed_bps or speed_bps <= 0:
        return None
    mbps = speed_bps / (1024 * 1024)
    if mbps >= 1.0:
        return f"{mbps:.1f} MB/s"
    kbps = speed_bps / 1024
    return f"{kbps:.0f} KB/s"


def cleanup_expired_jobs() -> None:
    """Remove old download directories and stale job entries."""
    now = time.time()
    expired_ids = []
    with _jobs_lock:
        for jid, job in JOBS.items():
            if now - job.get("created_at", now) > JOB_TTL_SECONDS:
                expired_ids.append(jid)
        for jid in expired_ids:
            JOBS.pop(jid, None)

    for jid in expired_ids:
        job_dir = DOWNLOADS_DIR / jid
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)

    # Also sweep orphan folders on disk older than TTL and enforce storage cap
    if DOWNLOADS_DIR.exists():
        folders = []
        total_bytes = 0
        for child in DOWNLOADS_DIR.iterdir():
            if child.is_dir():
                try:
                    mtime = child.stat().st_mtime
                    if now - mtime > JOB_TTL_SECONDS:
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        fsize = sum(f.stat().st_size for f in child.rglob("*") if f.is_file())
                        total_bytes += fsize
                        folders.append((mtime, fsize, child))
                except OSError:
                    pass

        # Evict oldest completed folders if temp storage exceeds MAX_STORAGE_BYTES
        if total_bytes > MAX_STORAGE_BYTES:
            folders.sort(key=lambda x: x[0])
            for _mtime, fsize, folder in folders:
                job_entry = get_job(folder.name)
                if job_entry and job_entry.get("status") in ("downloading", "processing"):
                    continue
                shutil.rmtree(folder, ignore_errors=True)
                total_bytes -= fsize
                if total_bytes <= MAX_STORAGE_BYTES * 0.7:
                    break


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _jobs_lock:
        job = JOBS.get(job_id)
        return dict(job) if job else None


def _update_job(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def create_download_job(
    raw_url: str,
    mode: str = "video",
    quality: str = "1080",
    ext: str = "mp4",
    bitrate: str = "320",
    title_hint: Optional[str] = None,
    entry_index: int = 0,
    is_carousel: bool = False,
    cookies_text: Optional[str] = None,
    browser_cookies: Optional[str] = None,
) -> Dict[str, Any]:
    """Register and spawn a background download + FFmpeg processing task."""
    cleanup_expired_jobs()
    url = normalize_url(raw_url)
    platform = detect_platform(url)

    job_id = uuid.uuid4().hex[:12]
    job_dir = DOWNLOADS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    job_record = {
        "job_id": job_id,
        "url": url,
        "platform": platform["name"],
        "mode": mode,
        "quality": quality,
        "ext": ext,
        "bitrate": bitrate,
        "status": "queued",
        "progress": 2.0,
        "stage_text": "Đang xếp hàng xử lý tốc độ cao...",
        "speed": None,
        "eta": None,
        "filename": None,
        "filesize": None,
        "error": None,
        "created_at": time.time(),
    }

    with _jobs_lock:
        JOBS[job_id] = job_record

    _worker_pool.submit(
        _run_download_worker,
        job_id=job_id,
        url=url,
        platform_name=platform["name"],
        job_dir=job_dir,
        mode=mode,
        quality=quality,
        ext=ext.lower(),
        bitrate=bitrate,
        title_hint=title_hint,
        entry_index=entry_index,
        is_carousel=is_carousel,
        cookies_text=cookies_text,
        browser_cookies=browser_cookies,
    )
    return dict(job_record)


def _run_download_worker(
    job_id: str,
    url: str,
    platform_name: str,
    job_dir: Path,
    mode: str,
    quality: str,
    ext: str,
    bitrate: str,
    title_hint: Optional[str],
    entry_index: int,
    is_carousel: bool,
    cookies_text: Optional[str],
    browser_cookies: Optional[str],
) -> None:
    opts, cookie_file = build_ydl_base_opts(cookies_text, browser_cookies)
    output_template = str(job_dir / "output.%(ext)s")
    opts["outtmpl"] = output_template
    opts["concurrent_fragment_downloads"] = 4

    if is_carousel:
        opts["noplaylist"] = False
        opts["playlist_items"] = str(max(1, entry_index + 1))
    else:
        opts["noplaylist"] = True

    seen_files: list[str] = []

    def progress_hook(d: Dict[str, Any]) -> None:
        st = d.get("status")
        fname = d.get("filename") or ""
        if fname and fname not in seen_files:
            seen_files.append(fname)

        if st == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            raw_pct = (downloaded / total * 100.0) if total > 0 else 35.0

            # Smooth progress across video + audio streams (0..88% for download, 88..99% for FFmpeg)
            if mode == "video" and len(seen_files) == 1:
                scaled_pct = 5.0 + raw_pct * 0.72
                stage = "Đang tải luồng hình ảnh chất lượng cao..."
            elif mode == "video" and len(seen_files) >= 2:
                scaled_pct = 77.0 + raw_pct * 0.13
                stage = "Đang tải luồng âm thanh gốc..."
            else:
                scaled_pct = 5.0 + raw_pct * 0.80
                stage = "Đang tải dữ liệu âm thanh..."

            current = get_job(job_id)
            prev_pct = current["progress"] if current else 0.0
            _update_job(
                job_id,
                status="downloading",
                progress=round(max(prev_pct, min(scaled_pct, 90.0)), 1),
                stage_text=stage,
                speed=_format_speed(d.get("speed")),
                eta=int(d["eta"]) if isinstance(d.get("eta"), (int, float)) and d["eta"] >= 0 else None,
            )
        elif st == "finished":
            _update_job(
                job_id,
                status="processing",
                progress=91.0,
                stage_text=(
                    "Đang ghép hình ảnh & âm thanh bằng FFmpeg..."
                    if mode == "video"
                    else f"Đang xuất tệp âm thanh {ext.upper()}..."
                ),
                speed=None,
                eta=None,
            )

    def postprocessor_hook(d: Dict[str, Any]) -> None:
        if d.get("status") == "started":
            _update_job(
                job_id,
                status="processing",
                progress=94.0,
                stage_text=(
                    f"Đang đóng gói định dạng {ext.upper()}..."
                    if mode == "video"
                    else f"Đang chuyển đổi âm thanh sang {ext.upper()} ({bitrate} kbps)..."
                    if ext == "mp3"
                    else f"Đang xử lý định dạng âm thanh {ext.upper()}..."
                ),
            )

    opts["progress_hooks"] = [progress_hook]
    opts["postprocessor_hooks"] = [postprocessor_hook]

    # Configure format & postprocessors
    quality_tag = ""
    if mode == "audio":
        target_ext = ext if ext in ("mp3", "m4a", "wav") else "mp3"
        opts["format"] = "bestaudio/best"
        pp_cfg: Dict[str, Any] = {
            "key": "FFmpegExtractAudio",
            "preferredcodec": target_ext,
        }
        if target_ext == "mp3":
            q_val = bitrate if bitrate in ("320", "192", "128") else "320"
            pp_cfg["preferredquality"] = q_val
            quality_tag = f"{q_val}kbps"
        elif target_ext == "m4a":
            pp_cfg["preferredquality"] = "0"
            quality_tag = "AAC"
        else:
            quality_tag = "Lossless"
        opts["postprocessors"] = [pp_cfg]
    else:
        target_ext = ext if ext in ("mp4", "webm") else "mp4"
        opts["format"] = "bestvideo+bestaudio/best"
        sort_rules = []
        if quality and quality != "best" and quality.isdigit():
            sort_rules.append(f"res:{int(quality)}")
            quality_tag = f"{quality}p"
        else:
            quality_tag = "HD"

        if target_ext == "mp4":
            # Prefer H.264 + AAC at the chosen resolution for universal MP4 playback;
            # because res:X comes first, 2K/4K VP9/AV1 still wins when 1440p/2160p is selected!
            sort_rules.extend(["vcodec:h264", "acodec:aac", "ext:mp4:m4a"])
            opts["merge_output_format"] = "mp4"
            opts["postprocessors"] = [
                {"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}
            ]
        else:
            sort_rules.extend(["ext:webm"])
            opts["merge_output_format"] = "webm"
            opts["postprocessors"] = [
                {"key": "FFmpegVideoRemuxer", "preferedformat": "webm"}
            ]

        opts["format_sort"] = sort_rules

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        if info and "entries" in info and info["entries"]:
            entries = [e for e in info["entries"] if e]
            if entries:
                info = entries[0]

        # Locate resulting media file inside job_dir
        candidates = [
            p
            for p in job_dir.iterdir()
            if p.is_file() and not p.name.endswith((".part", ".ytdl", ".temp"))
        ]
        if not candidates:
            raise RuntimeError("Không tìm thấy tệp đầu ra sau khi xử lý.")

        # Prefer file matching target_ext or largest file
        exact_ext = [p for p in candidates if p.suffix.lower().lstrip(".") == target_ext]
        final_file = max(exact_ext or candidates, key=lambda p: p.stat().st_size)
        actual_ext = final_file.suffix.lstrip(".") or target_ext

        final_title = title_hint or (info.get("title") if info else None) or f"SnapVid_{platform_name}"
        nice_filename = sanitize_filename(final_title, quality_tag, actual_ext)

        _update_job(
            job_id,
            status="completed",
            progress=100.0,
            stage_text="Hoàn tất! Đang tải tệp về thiết bị...",
            file_path=str(final_file),
            filename=nice_filename,
            filesize=final_file.stat().st_size,
            speed=None,
            eta=None,
        )
    except yt_dlp.utils.DownloadError as exc:
        _update_job(
            job_id,
            status="error",
            stage_text="Quá trình tải gặp lỗi",
            error=_friendly_error(str(exc), platform_name),
        )
        shutil.rmtree(job_dir, ignore_errors=True)
    except Exception as exc:
        _update_job(
            job_id,
            status="error",
            stage_text="Quá trình xử lý gặp sự cố",
            error=f"Không thể hoàn tất xử lý media: {exc}",
        )
        shutil.rmtree(job_dir, ignore_errors=True)
    finally:
        if cookie_file and os.path.exists(cookie_file):
            try:
                os.remove(cookie_file)
            except OSError:
                pass
