import re
from urllib.parse import urlparse, urlunparse

PLATFORMS = {
    "youtube_shorts": {
        "id": "youtube_shorts",
        "name": "YouTube Shorts",
        "family": "youtube",
        "badge": "Shorts",
        "color": "#FF0033",
    },
    "youtube": {
        "id": "youtube",
        "name": "YouTube",
        "family": "youtube",
        "badge": "YouTube",
        "color": "#FF0033",
    },
    "instagram_reels": {
        "id": "instagram_reels",
        "name": "Instagram Reels",
        "family": "instagram",
        "badge": "IG Reels",
        "color": "#E1306C",
    },
    "instagram": {
        "id": "instagram",
        "name": "Instagram",
        "family": "instagram",
        "color": "#E1306C",
        "badge": "Instagram",
    },
    "twitter": {
        "id": "twitter",
        "name": "X (Twitter)",
        "family": "twitter",
        "badge": "X / Twitter",
        "color": "#1D9BF0",
    },
    "facebook_reels": {
        "id": "facebook_reels",
        "name": "Facebook Reels",
        "family": "facebook",
        "badge": "FB Reels",
        "color": "#1877F2",
    },
    "facebook": {
        "id": "facebook",
        "name": "Facebook",
        "family": "facebook",
        "badge": "Facebook",
        "color": "#1877F2",
    },
    "tiktok": {
        "id": "tiktok",
        "name": "TikTok",
        "family": "tiktok",
        "badge": "TikTok",
        "color": "#00F2EA",
    },
    "threads": {
        "id": "threads",
        "name": "Threads",
        "family": "threads",
        "badge": "Threads",
        "color": "#A0A0A0",
    },
    "generic": {
        "id": "generic",
        "name": "Web Media",
        "family": "generic",
        "badge": "Media",
        "color": "#10B981",
    },
}


def normalize_url(raw_url: str) -> str:
    """Clean whitespace, extract URL if pasted with surrounding text, and normalize scheme."""
    if not raw_url:
        return ""
    text = raw_url.strip()
    match = re.search(r"https?://[^\s<>\"']+", text)
    if match:
        text = match.group(0)
    elif not text.startswith(("http://", "https://")) and "." in text:
        text = "https://" + text

    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL không hợp lệ. Vui lòng dán đường dẫn bắt đầu bằng https://")

    host = (parsed.hostname or "").lower()
    if (
        host in ("localhost", "127.0.0.1", "0.0.0.0", "::1")
        or host.startswith(("192.168.", "10.", "169.254."))
        or re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.", host)
        or host.endswith(".local")
    ):
        raise ValueError("Không hỗ trợ địa chỉ mạng nội bộ.")

    if host in ("drive.google.com", "docs.google.com", "drive.usercontent.google.com"):
        raise ValueError("Hệ thống chỉ hỗ trợ tải video & âm thanh mạng xã hội, không hỗ trợ Google Drive.")

    netloc = parsed.netloc
    if host in ("vxtwitter.com", "fxtwitter.com", "fixupx.com", "fixvx.com"):
        netloc = "x.com"
    elif host in ("ddinstagram.com", "kkinstagram.com"):
        netloc = "www.instagram.com"

    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, ""))


def detect_platform(url: str) -> dict:
    """Identify social platform and content subtype."""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        path = (parsed.path or "").lower()
    except Exception:
        return PLATFORMS["generic"]

    if any(h in host for h in ("youtube.com", "youtu.be", "music.youtube.com")):
        if "/shorts/" in path:
            return PLATFORMS["youtube_shorts"]
        return PLATFORMS["youtube"]

    if "instagram.com" in host or "instagr.am" in host:
        if "/reel/" in path or "/reels/" in path:
            return PLATFORMS["instagram_reels"]
        return PLATFORMS["instagram"]

    if any(h in host for h in ("twitter.com", "x.com", "t.co")):
        return PLATFORMS["twitter"]

    if any(h in host for h in ("facebook.com", "fb.watch", "fb.com", "m.facebook.com")):
        if "/reel/" in path or "/reels/" in path or "/share/r/" in path:
            return PLATFORMS["facebook_reels"]
        return PLATFORMS["facebook"]

    if "tiktok.com" in host:
        return PLATFORMS["tiktok"]

    if "threads.net" in host or "threads.com" in host:
        return PLATFORMS["threads"]

    return PLATFORMS["generic"]
