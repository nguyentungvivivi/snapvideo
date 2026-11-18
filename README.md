---
title: SnapVideo
emoji: ⚡
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# SnapVid v2.0 — Web Tải Video Đa Nền Tảng, Quản Trị Admin & Hệ Thống VIP

Ứng dụng web tải video, Shorts, Reels và trích xuất âm thanh từ **YouTube, Instagram, X (Twitter), Facebook, TikTok, Threads...** tốc độ cao, giao diện tối giản không quảng cáo, chuẩn SEO, tích hợp **Giới hạn lượt tải hằng ngày (`X` lượt/thiết bị)**, **Hệ thống Gói VIP (Tháng / Năm)** và **Bảng điều khiển Admin toàn diện**.

## Kiến trúc 0đ (Cloudflare Edge + D1 + Hugging Face Spaces Docker)

- **Giao diện & Quản trị 24/7:** Cloudflare Workers + Cloudflare D1 (`https://snapvideo.nguyenhuutung2305007.workers.dev`)
- **Máy chủ xử lý Video/Audio 24/7:** Docker Container chạy `FastAPI + yt-dlp + FFmpeg` trên Hugging Face Spaces (`https://sunteeeeeee-snapvideo.hf.space`)
- **Kho mã nguồn:** `https://github.com/nguyentungvivivi/snapvideo`
