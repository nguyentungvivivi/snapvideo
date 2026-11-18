import asyncio
from contextlib import asynccontextmanager
import mimetypes
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

import uvicorn
import yt_dlp
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from services.database import (
    admin_login,
    admin_modify_client,
    change_admin_password,
    consume_client_quota,
    create_vip_request,
    delete_vip_key,
    generate_vip_keys,
    get_admin_dashboard_stats,
    get_or_register_client,
    get_public_settings,
    init_db,
    list_clients_admin,
    list_vip_keys,
    list_vip_requests,
    normalize_client_id,
    redeem_vip_key,
    resolve_vip_request,
    update_settings,
    verify_admin_token,
)
from services.downloader import cleanup_expired_jobs, create_download_job, get_job, sanitize_filename
from services.extractor import ensure_ffmpeg, extract_media_info
from services.platform_detector import detect_platform, normalize_url

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


async def _periodic_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(300)
        try:
            await asyncio.to_thread(cleanup_expired_jobs)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    await asyncio.to_thread(ensure_ffmpeg)
    await asyncio.to_thread(cleanup_expired_jobs)
    sweep_task = asyncio.create_task(_periodic_cleanup_loop())
    try:
        yield
    finally:
        sweep_task.cancel()


app = FastAPI(
    title="SnapVid — Tải Video & MP3 Đa Nền Tảng Tốc Độ Cao",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=800)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_client_context(request: Request, x_client_id: Optional[str] = None) -> tuple[str, str, str]:
    cookie_cid = request.cookies.get("snapvid_cid")
    cid = normalize_client_id(x_client_id or cookie_cid)
    forwarded = request.headers.get("x-forwarded-for")
    ip = (forwarded.split(",")[0].strip() if forwarded else None) or (
        request.client.host if request.client else "127.0.0.1"
    )
    ua = request.headers.get("user-agent") or ""
    return cid, ip, ua


def _require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Phiên quản trị không hợp lệ hoặc đã hết hạn.")
    return token


# --- Schemas ---
class AnalyzeRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    entry_index: int = Field(default=0, ge=0)
    cookies_text: Optional[str] = None
    browser_cookies: Optional[str] = None


class DownloadRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    mode: str = Field(default="video", pattern="^(video|audio)$")
    quality: str = Field(default="1080", max_length=32)
    ext: str = Field(default="mp4", pattern="^(mp4|webm|mp3|m4a|wav)$")
    bitrate: str = Field(default="320", max_length=16)
    title: Optional[str] = Field(default=None, max_length=300)
    entry_index: int = Field(default=0, ge=0)
    is_carousel: bool = Field(default=False)
    cookies_text: Optional[str] = None
    browser_cookies: Optional[str] = None


class VipRedeemRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=64)


class VipOrderRequest(BaseModel):
    plan_type: str = Field(..., min_length=2, max_length=64)
    contact_info: str = Field(..., min_length=3, max_length=160)
    note: str = Field(default="", max_length=300)


class AdminLoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


class AdminPasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=4, max_length=128)


class AdminGenerateKeysRequest(BaseModel):
    plan_name: str = Field(default="VIP Tháng", max_length=64)
    duration_days: int = Field(default=30, ge=1, le=36500)
    max_uses: int = Field(default=1, ge=1, le=1000)
    quantity: int = Field(default=1, ge=1, le=50)
    note: str = Field(default="", max_length=140)


class AdminClientActionRequest(BaseModel):
    action: str = Field(..., pattern="^(reset_today|add_bonus|grant_vip_days|revoke_vip|toggle_block)$")
    value: int = Field(default=0)
    plan_name: str = Field(default="VIP Admin", max_length=64)


class AdminResolveVipRequest(BaseModel):
    approve: bool
    days: int = Field(default=30, ge=1, le=36500)


# --- Public & Quota Endpoints ---
@app.get("/api/health")
async def health_check():
    ffmpeg_dir = await asyncio.to_thread(ensure_ffmpeg)
    return {
        "status": "ok",
        "yt_dlp_version": yt_dlp.version.__version__,
        "ffmpeg_ready": bool(ffmpeg_dir),
    }


@app.get("/api/state")
async def public_state(
    request: Request,
    response: Response,
    x_client_id: Optional[str] = Header(default=None),
):
    cid, ip, ua = _resolve_client_context(request, x_client_id)
    client_info = await asyncio.to_thread(get_or_register_client, cid, ip, ua)
    settings = await asyncio.to_thread(get_public_settings)
    response.set_cookie(
        key="snapvid_cid",
        value=cid,
        max_age=365 * 86400,
        httponly=False,
        samesite="lax",
    )
    return {"settings": settings, "client": client_info}


@app.post("/api/analyze")
async def analyze_video(
    payload: AnalyzeRequest,
    request: Request,
    x_client_id: Optional[str] = Header(default=None),
):
    cid, ip, ua = _resolve_client_context(request, x_client_id)
    client_info = await asyncio.to_thread(get_or_register_client, cid, ip, ua)
    if client_info["is_blocked"]:
        raise HTTPException(status_code=403, detail="Thiết bị của bạn đã bị khoá quyền truy cập.")

    try:
        data = await asyncio.to_thread(
            extract_media_info,
            raw_url=payload.url,
            cookies_text=payload.cookies_text,
            browser_cookies=payload.browser_cookies,
            entry_index=payload.entry_index,
        )
        data["client"] = client_info
        return data
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể phân tích đường dẫn lúc này: {exc}",
        ) from exc


@app.post("/api/download")
async def start_download(
    payload: DownloadRequest,
    request: Request,
    x_client_id: Optional[str] = Header(default=None),
):
    cid, ip, ua = _resolve_client_context(request, x_client_id)
    try:
        norm_url = normalize_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    platform_name = detect_platform(norm_url)["name"]
    media_only = os.environ.get("SNAPVID_MEDIA_ONLY", "").strip() == "1"
    if media_only:
        updated_client = await asyncio.to_thread(get_or_register_client, cid, ip, ua)
    else:
        allowed, msg, updated_client = await asyncio.to_thread(
            consume_client_quota,
            client_id=cid,
            ip=ip,
            user_agent=ua,
            platform=platform_name,
            mode=payload.mode,
            quality=payload.quality,
            title=payload.title or "",
        )
        if not allowed:
            return JSONResponse(
                status_code=402,
                content={
                    "detail": msg,
                    "quota_exceeded": True,
                    "client": updated_client,
                },
            )

    try:
        job = await asyncio.to_thread(
            create_download_job,
            raw_url=norm_url,
            mode=payload.mode,
            quality=payload.quality,
            ext=payload.ext.lower(),
            bitrate=payload.bitrate,
            title_hint=payload.title,
            entry_index=payload.entry_index,
            is_carousel=payload.is_carousel,
            cookies_text=payload.cookies_text,
            browser_cookies=payload.browser_cookies,
        )
        return {
            "job_id": job["job_id"],
            "status": job["status"],
            "client": updated_client,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/progress/{job_id}")
async def check_progress(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình tải.")
    return {k: v for k, v in job.items() if k != "file_path"}


@app.get("/api/file/{job_id}")
async def download_file(job_id: str):
    job = get_job(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Tệp chưa sẵn sàng hoặc đã hết hạn.")

    file_path = job.get("file_path")
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Tệp trên máy chủ đã bị xoá hoặc hết hạn.")

    filename = job.get("filename") or os.path.basename(file_path)
    ascii_fallback = re.sub(r"[^\x20-\x7E]", "_", filename).replace('"', "")
    utf8_encoded = urllib.parse.quote(filename, safe="")

    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type:
        mime_type = "application/octet-stream"

    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{utf8_encoded}'
        )
    }
    return FileResponse(path=file_path, media_type=mime_type, headers=headers)


# --- VIP Public Endpoints ---
@app.post("/api/vip/redeem")
async def api_redeem_vip(
    payload: VipRedeemRequest,
    request: Request,
    x_client_id: Optional[str] = Header(default=None),
):
    cid, ip, ua = _resolve_client_context(request, x_client_id)
    try:
        updated = await asyncio.to_thread(redeem_vip_key, cid, payload.code, ip, ua)
        return {
            "message": f"Kích hoạt thành công {updated['vip_plan']}! Thiết bị của bạn đã được mở khoá không giới hạn.",
            "client": updated,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/vip/request")
async def api_request_vip(
    payload: VipOrderRequest,
    request: Request,
    x_client_id: Optional[str] = Header(default=None),
):
    cid, ip, ua = _resolve_client_context(request, x_client_id)
    await asyncio.to_thread(get_or_register_client, cid, ip, ua)
    try:
        req_id = await asyncio.to_thread(
            create_vip_request,
            cid,
            payload.plan_type,
            payload.contact_info,
            payload.note,
        )
        return {
            "request_id": req_id,
            "message": "Đã gửi yêu cầu nâng cấp VIP tới Admin! Admin sẽ kích hoạt trực tiếp cho mã thiết bị của bạn hoặc gửi mã VIP sớm nhất.",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- Thumbnail Proxy ---
def _fetch_remote_image(raw_url: str) -> tuple[bytes, str]:
    clean_url = normalize_url(raw_url)
    req = urllib.request.Request(
        clean_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        ctype = (resp.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip().lower()
        if not ctype.startswith("image/"):
            raise ValueError("URL không phải hình ảnh hợp lệ.")
        body = resp.read(15 * 1024 * 1024)
        return body, ctype


@app.get("/api/thumbnail")
async def proxy_thumbnail(
    url: str = Query(..., min_length=8, max_length=2048),
    download: int = Query(default=0),
    title: str = Query(default="thumbnail"),
):
    try:
        img_bytes, ctype = await asyncio.to_thread(_fetch_remote_image, url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không tải được ảnh thu nhỏ: {exc}") from exc

    headers = {"Cache-Control": "public, max-age=3600"}
    if download:
        ext_map = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
        ext = ext_map.get(ctype, "jpg")
        fname = sanitize_filename(title, "Thumbnail", ext)
        ascii_fb = re.sub(r"[^\x20-\x7E]", "_", fname).replace('"', "")
        utf8_fn = urllib.parse.quote(fname, safe="")
        headers["Content-Disposition"] = (
            f'attachment; filename="{ascii_fb}"; filename*=UTF-8\'\'{utf8_fn}'
        )
    return Response(content=img_bytes, media_type=ctype, headers=headers)


# --- Admin Control Panel API ---
@app.post("/api/admin/login")
async def api_admin_login(payload: AdminLoginRequest):
    token = await asyncio.to_thread(admin_login, payload.password)
    if not token:
        raise HTTPException(status_code=401, detail="Mật khẩu quản trị không chính xác.")
    return {"token": token}


@app.get("/api/admin/overview")
async def api_admin_overview(_token: str = Depends(_require_admin)):
    stats = await asyncio.to_thread(get_admin_dashboard_stats)
    settings = await asyncio.to_thread(get_public_settings)
    keys = await asyncio.to_thread(list_vip_keys)
    clients = await asyncio.to_thread(list_clients_admin)
    requests_list = await asyncio.to_thread(list_vip_requests)
    return {
        "stats": stats,
        "settings": settings,
        "vip_keys": keys,
        "clients": clients,
        "vip_requests": requests_list,
    }


@app.post("/api/admin/settings")
async def api_admin_update_settings(
    updates: Dict[str, Any],
    _token: str = Depends(_require_admin),
):
    updated = await asyncio.to_thread(update_settings, updates)
    return {"message": "Đã lưu cấu hình hệ thống & thông báo!", "settings": updated}


@app.post("/api/admin/keys")
async def api_admin_create_keys(
    payload: AdminGenerateKeysRequest,
    _token: str = Depends(_require_admin),
):
    created = await asyncio.to_thread(
        generate_vip_keys,
        payload.plan_name,
        payload.duration_days,
        payload.max_uses,
        payload.quantity,
        payload.note,
    )
    return {"created": created}


@app.delete("/api/admin/keys/{code}")
async def api_admin_delete_key(code: str, _token: str = Depends(_require_admin)):
    await asyncio.to_thread(delete_vip_key, code)
    return {"status": "deleted"}


@app.post("/api/admin/clients/{client_id}")
async def api_admin_client_action(
    client_id: str,
    payload: AdminClientActionRequest,
    _token: str = Depends(_require_admin),
):
    await asyncio.to_thread(
        admin_modify_client,
        client_id,
        payload.action,
        payload.value,
        payload.plan_name,
    )
    return {"status": "ok"}


@app.post("/api/admin/vip-requests/{req_id}")
async def api_admin_resolve_vip_request(
    req_id: int,
    payload: AdminResolveVipRequest,
    _token: str = Depends(_require_admin),
):
    await asyncio.to_thread(resolve_vip_request, req_id, payload.approve, payload.days)
    return {"status": "ok"}


@app.post("/api/admin/password")
async def api_admin_change_password(
    payload: AdminPasswordChange,
    _token: str = Depends(_require_admin),
):
    ok = await asyncio.to_thread(
        change_admin_password, payload.old_password, payload.new_password
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng.")
    return {"message": "Đã cập nhật mật khẩu Admin thành công!"}


# --- Technical SEO Routes ---
@app.get("/robots.txt", response_class=PlainTextResponse)
async def robots_txt(request: Request):
    base = str(request.base_url).rstrip("/")
    return f"User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: {base}/sitemap.xml\n"


@app.get("/sitemap.xml")
async def sitemap_xml(request: Request):
    base = str(request.base_url).rstrip("/")
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{base}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>"""
    return Response(content=xml, media_type="application/xml")


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/admin")
async def serve_admin():
    return FileResponse(str(STATIC_DIR / "admin.html"))


@app.get("/")
async def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print(f"\n  SnapVid dang chay tai: http://localhost:{port}")
    print(f"  Bang dieu khien Admin: http://localhost:{port}/admin (Mat khau mac dinh: admin123)\n")
    uvicorn.run("app:app", host=host, port=port, reload=False)
