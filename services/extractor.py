import copy
import logging
import os
import shutil
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional

import yt_dlp

from services.platform_detector import detect_platform, normalize_url

logger = logging.getLogger("snapvid.extractor")

_CACHE_TTL_SEC = 600  # 10-minute metadata cache to save CPU & network
_CACHE_MAX_ITEMS = 250
_cache_lock = threading.Lock()
_analyze_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}


def ensure_ffmpeg() -> Optional[str]:
    """Ensure ffmpeg and ffprobe are on PATH (via static-ffmpeg fallback if needed)."""
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return os.path.dirname(ffmpeg_path)
    try:
        import static_ffmpeg

        static_ffmpeg.add_paths()
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path:
            return os.path.dirname(ffmpeg_path)
    except Exception as exc:
        logger.warning("static_ffmpeg setup warning: %s", exc)
    return None


QUALITY_LABELS = {
    4320: ("8K Ultra HD", "8K"),
    2160: ("4K Ultra HD", "4K"),
    1440: ("2K Quad HD", "2K"),
    1080: ("Full HD 1080p", "FHD"),
    720: ("HD 720p", "HD"),
    540: ("qHD 540p", "SD+"),
    480: ("SD 480p", "SD"),
    360: ("360p Tiết kiệm", "360p"),
    240: ("240p Siêu nhẹ", "240p"),
    144: ("144p Tối thiểu", "144p"),
}


def _snap_resolution(raw_res: int) -> int:
    """Snap slightly off-by-a-few-pixels dimensions (e.g. 1078, 718, 538) to clean tiers."""
    for std in (4320, 2160, 1440, 1080, 720, 540, 480, 360, 240, 144):
        if abs(raw_res - std) <= 24:
            return std
    return raw_res


def _estimate_stream_bytes(fmt: Dict[str, Any], duration: Optional[float]) -> Optional[int]:
    size = fmt.get("filesize") or fmt.get("filesize_approx")
    if size and size > 0:
        return int(size)
    bitrate_kbps = fmt.get("tbr") or fmt.get("vbr") or fmt.get("abr")
    if bitrate_kbps and duration and duration > 0:
        return int((float(bitrate_kbps) * 1000.0 / 8.0) * float(duration))
    return None


def _friendly_error(err_msg: str, platform_name: str) -> str:
    low = err_msg.lower()
    if any(k in low for k in ("login required", "sign in", "cookies", "logged-in", "rate-limit reached")):
        return (
            f"{platform_name} yêu cầu xác thực hoặc giới hạn truy cập với video này. "
            "Nếu đây là bài đăng giới hạn độ tuổi/riêng tư, hãy mở 'Cài đặt nâng cao' và thêm Cookies."
        )
    if any(k in low for k in ("private video", "video is private", "this content isn't available")):
        return f"Video trên {platform_name} đang ở chế độ riêng tư hoặc đã bị gỡ bỏ."
    if "unsupported url" in low:
        return "Đường dẫn này chưa được hỗ trợ hoặc không chứa video hợp lệ."
    if any(k in low for k in ("not available in your country", "geo")):
        return "Video này bị giới hạn khu vực địa lý bởi người đăng."
    if "no video formats found" in low or "there is no video in this" in low:
        return f"Bài đăng {platform_name} này chỉ chứa hình ảnh hoặc văn bản, không có video."
    return f"Không thể phân tích video từ {platform_name}. Vui lòng kiểm tra lại đường dẫn."


def build_ydl_base_opts(
    cookies_text: Optional[str] = None,
    browser_cookies: Optional[str] = None,
) -> tuple[Dict[str, Any], Optional[str]]:
    """Construct shared yt-dlp options and optional temporary cookie file."""
    ffmpeg_dir = ensure_ffmpeg()
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "geo_bypass": True,
        "socket_timeout": 25,
        "http_headers": {
            "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        },
    }
    if ffmpeg_dir:
        opts["ffmpeg_location"] = ffmpeg_dir

    cookie_temp_path: Optional[str] = None
    if cookies_text and cookies_text.strip():
        fd, cookie_temp_path = tempfile.mkstemp(prefix="snapvid_cookies_", suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(cookies_text.strip() + "\n")
        opts["cookiefile"] = cookie_temp_path
    elif browser_cookies and browser_cookies in ("chrome", "edge", "firefox", "brave"):
        opts["cookiesfrombrowser"] = (browser_cookies,)

    return opts, cookie_temp_path


def extract_media_info(
    raw_url: str,
    cookies_text: Optional[str] = None,
    browser_cookies: Optional[str] = None,
    entry_index: int = 0,
) -> Dict[str, Any]:
    """Extract metadata, thumbnail, aspect ratio, and available MP4/WebM/MP3/M4A quality tiers."""
    url = normalize_url(raw_url)
    platform = detect_platform(url)

    use_cache = not (cookies_text or browser_cookies)
    cache_key = f"{url}::{entry_index}"
    if use_cache:
        now_ts = time.time()
        with _cache_lock:
            cached = _analyze_cache.get(cache_key)
            if cached and (now_ts - cached[0]) < _CACHE_TTL_SEC:
                return copy.deepcopy(cached[1])

    opts, cookie_file = build_ydl_base_opts(cookies_text, browser_cookies)
    opts["extract_flat"] = False

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise ValueError(_friendly_error(str(exc), platform["name"])) from exc
    except Exception as exc:
        raise ValueError(f"Lỗi kết nối khi phân tích liên kết: {exc}") from exc
    finally:
        if cookie_file and os.path.exists(cookie_file):
            try:
                os.remove(cookie_file)
            except OSError:
                pass

    if not info:
        raise ValueError("Không nhận được dữ liệu từ đường dẫn này.")

    # Handle multi-video posts (e.g. Instagram carousel or X multi-video post)
    carousel_count = 1
    carousel_items = []
    if "entries" in info and info["entries"]:
        valid_entries = [e for e in info["entries"] if e]
        if not valid_entries:
            raise ValueError("Bài đăng này không chứa video có thể tải.")
        carousel_count = len(valid_entries)
        for idx, ent in enumerate(valid_entries):
            carousel_items.append(
                {
                    "index": idx,
                    "title": ent.get("title") or f"Phần {idx + 1}",
                    "duration": ent.get("duration"),
                    "thumbnail": ent.get("thumbnail"),
                }
            )
        chosen_idx = max(0, min(entry_index, carousel_count - 1))
        parent_title = info.get("title")
        parent_uploader = info.get("uploader") or info.get("channel")
        info = valid_entries[chosen_idx]
        if not info.get("title") and parent_title:
            info["title"] = parent_title
        if not info.get("uploader") and parent_uploader:
            info["uploader"] = parent_uploader

    duration = info.get("duration")
    formats = info.get("formats") or []

    # Separate audio and video streams
    audio_streams = [
        f
        for f in formats
        if f.get("acodec") not in (None, "none")
        and f.get("vcodec") in (None, "none")
        and f.get("ext") != "mhtml"
    ]
    best_audio_bytes = 0
    if audio_streams:
        sizes = [s for s in (_estimate_stream_bytes(a, duration) for a in audio_streams) if s]
        if sizes:
            best_audio_bytes = max(sizes)
    elif duration:
        best_audio_bytes = int((128_000 / 8) * float(duration))

    # Inspect video streams
    video_tiers: Dict[int, Dict[str, Any]] = {}
    max_width = info.get("width") or 0
    max_height = info.get("height") or 0

    for fmt in formats:
        ext = (fmt.get("ext") or "").lower()
        vcodec = fmt.get("vcodec")
        note = (fmt.get("format_note") or "").lower()
        if ext == "mhtml" or "storyboard" in note or vcodec in (None, "none"):
            continue
        # Some extractors set vcodec=None when single combined HTTP file is returned
        w = fmt.get("width")
        h = fmt.get("height")
        if w and h:
            max_width = max(max_width, w)
            max_height = max(max_height, h)
            short_side = _snap_resolution(min(int(w), int(h)))
        elif h or w:
            dim = int(h or w)
            short_side = _snap_resolution(dim)
        else:
            continue

        if short_side < 120:
            continue

        fps = fmt.get("fps") or 0
        dyn = fmt.get("dynamic_range") or "SDR"
        is_hdr = dyn not in ("SDR", None, "")
        has_audio = fmt.get("acodec") not in (None, "none")
        est_bytes = _estimate_stream_bytes(fmt, duration)
        if est_bytes and not has_audio and best_audio_bytes:
            est_bytes += best_audio_bytes

        existing = video_tiers.get(short_side)
        # Prefer mp4/h264 size estimate or higher fps metadata for display
        is_h264 = "avc" in (vcodec or "").lower() or "h264" in (vcodec or "").lower()
        score = (1 if is_h264 else 0, fps or 0, est_bytes or 0)

        if not existing or score > existing["_score"]:
            label_title, badge = QUALITY_LABELS.get(
                short_side, (f"{short_side}p", f"{short_side}p")
            )
            video_tiers[short_side] = {
                "quality": str(short_side),
                "resolution": short_side,
                "width": w,
                "height": h,
                "label": label_title,
                "badge": badge,
                "fps": int(round(fps)) if fps and fps >= 50 else None,
                "hdr": is_hdr,
                "filesize_approx": est_bytes,
                "_score": score,
            }

    # Build sorted video options list (highest resolution first)
    video_options: List[Dict[str, Any]] = []
    for res_key in sorted(video_tiers.keys(), reverse=True):
        item = dict(video_tiers[res_key])
        item.pop("_score", None)
        video_options.append(item)

    # Fallback when platform (e.g. direct X/IG/FB CDN) doesn't expose width/height prior to download
    if not video_options:
        fallback_size = _estimate_stream_bytes(info, duration)
        video_options = [
            {
                "quality": "best",
                "resolution": 1080,
                "width": None,
                "height": None,
                "label": "Chất lượng gốc cao nhất (HD)",
                "badge": "MAX",
                "fps": None,
                "hdr": False,
                "filesize_approx": fallback_size,
            },
            {
                "quality": "720",
                "resolution": 720,
                "width": None,
                "height": None,
                "label": "HD 720p",
                "badge": "HD",
                "fps": None,
                "hdr": False,
                "filesize_approx": int(fallback_size * 0.65) if fallback_size else None,
            },
            {
                "quality": "480",
                "resolution": 480,
                "width": None,
                "height": None,
                "label": "SD 480p",
                "badge": "SD",
                "fps": None,
                "hdr": False,
                "filesize_approx": int(fallback_size * 0.4) if fallback_size else None,
            },
        ]

    # Mark top quality as recommended (prefer 1080p as sweet spot if 4K exists, or highest if <=1080p)
    recommended_marked = False
    for opt in video_options:
        if opt["resolution"] == 1080:
            opt["recommended"] = True
            recommended_marked = True
            break
    if not recommended_marked and video_options:
        video_options[0]["recommended"] = True

    # Build audio options (MP3 320 / 192 / 128 + M4A + WAV)
    dur_sec = float(duration) if duration and duration > 0 else None
    audio_options = [
        {
            "id": "mp3_320",
            "ext": "mp3",
            "bitrate": "320",
            "label": "MP3 · 320 kbps",
            "sublabel": "Chất lượng cao nhất (Studio)",
            "badge": "HQ",
            "recommended": True,
            "filesize_approx": int((320_000 / 8) * dur_sec) if dur_sec else None,
        },
        {
            "id": "mp3_192",
            "ext": "mp3",
            "bitrate": "192",
            "label": "MP3 · 192 kbps",
            "sublabel": "Tiêu chuẩn, cân bằng dung lượng",
            "badge": "STD",
            "recommended": False,
            "filesize_approx": int((192_000 / 8) * dur_sec) if dur_sec else None,
        },
        {
            "id": "mp3_128",
            "ext": "mp3",
            "bitrate": "128",
            "label": "MP3 · 128 kbps",
            "sublabel": "Nhẹ, tải nhanh, tiết kiệm bộ nhớ",
            "badge": "LITE",
            "recommended": False,
            "filesize_approx": int((128_000 / 8) * dur_sec) if dur_sec else None,
        },
        {
            "id": "m4a_best",
            "ext": "m4a",
            "bitrate": "best",
            "label": "M4A · Âm thanh gốc (AAC)",
            "sublabel": "Giữ nguyên luồng âm thanh gốc",
            "badge": "AAC",
            "recommended": False,
            "filesize_approx": best_audio_bytes or (int((130_000 / 8) * dur_sec) if dur_sec else None),
        },
        {
            "id": "wav_lossless",
            "ext": "wav",
            "bitrate": "lossless",
            "label": "WAV · Lossless",
            "sublabel": "Không nén, phù hợp dựng phim / edit",
            "badge": "WAV",
            "recommended": False,
            "filesize_approx": int((1_411_200 / 8) * dur_sec) if dur_sec else None,
        },
    ]

    # Pick highest quality thumbnail
    thumbnail = info.get("thumbnail")
    thumbnails = info.get("thumbnails") or []
    if thumbnails:
        valid_thumbs = [t for t in thumbnails if t.get("url") and str(t.get("url")).startswith("http")]
        if valid_thumbs:
            # Prefer jpg/webp/png with highest width/preference
            valid_thumbs.sort(
                key=lambda t: (t.get("preference") or 0, t.get("width") or 0, t.get("height") or 0),
                reverse=True,
            )
            thumbnail = valid_thumbs[0]["url"]

    is_vertical = bool(max_height and max_width and max_height > max_width)
    if platform["id"] in ("youtube_shorts", "instagram_reels", "facebook_reels", "tiktok"):
        is_vertical = True

    title = (info.get("title") or info.get("description") or f"Video {platform['name']}").strip()
    if len(title) > 140:
        title = title[:137] + "..."

    author = (
        info.get("channel")
        or info.get("uploader")
        or info.get("creator")
        or info.get("uploader_id")
        or platform["name"]
    )

    result = {
        "url": url,
        "webpage_url": info.get("webpage_url") or url,
        "title": title,
        "author": author,
        "duration": int(round(duration)) if duration else None,
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "upload_date": info.get("upload_date"),
        "thumbnail": thumbnail,
        "is_vertical": is_vertical,
        "platform": platform,
        "carousel_count": carousel_count,
        "carousel_items": carousel_items,
        "selected_entry": entry_index if carousel_count > 1 else 0,
        "video_options": video_options,
        "audio_options": audio_options,
    }
    if use_cache:
        with _cache_lock:
            if len(_analyze_cache) >= _CACHE_MAX_ITEMS:
                oldest_k = min(_analyze_cache, key=lambda k: _analyze_cache[k][0])
                _analyze_cache.pop(oldest_k, None)
            _analyze_cache[cache_key] = (time.time(), copy.deepcopy(result))
    return result
