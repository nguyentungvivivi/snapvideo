# Hướng Dẫn Push GitHub & Triển Khai Cloudflare (Chi Phí 0đ)

## 1. Push mã nguồn lên GitHub
Kho Git cục bộ đã được khởi tạo sẵn tại nhánh `main`. Tạo một repository trống trên GitHub (ví dụ `https://github.com/<username>/snapvid.git`), sau đó chạy:

```powershell
git remote add origin https://github.com/<username>/snapvid.git
git push -u origin main
```

---

## 2. Triển khai lên Cloudflare với chi phí 0đ

Vì lõi xử lý tải & ghép video 4K / MP3 320kbps sử dụng tiến trình gốc **Python + `yt-dlp` + `FFmpeg`** (môi trường Cloudflare Workers JS thuần không chạy trực tiếp file thực thi `ffmpeg`), có **2 mô hình chuẩn 0đ** kết hợp Cloudflare:

### Cách A: Cloudflare Tunnel (Nhanh nhất — Xuất link HTTPS công khai ngay từ máy hiện tại)
Phù hợp khi muốn phát trực tiếp máy chủ `http://127.0.0.1:8000` ra tên miền `https://` của Cloudflare ngay lập tức:
```powershell
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://127.0.0.1:8000
```
*(Hoặc gắn tên miền riêng miễn phí trong mục **Cloudflare Zero Trust → Networks → Tunnels**).*

### Cách B: Chạy 24/7 không cần bật máy tính (Cloudflare Pages/CDN + Docker Cloud 0đ)
1. **Backend (Python + FFmpeg + SQLite):** Kết nối repo GitHub vừa push vào **Hugging Face Spaces (chọn SDK: Docker — miễn phí 2 vCPU, 16GB RAM)** hoặc **Render Free** (dự án đã có sẵn `Dockerfile`).
2. **Frontend / Tên miền trên Cloudflare:**
   - Trỏ CNAME tên miền trên **Cloudflare DNS** (bật đám mây cam CDN chống DDoS) về địa chỉ Backend, **hoặc**
   - Triển khai giao diện tĩnh lên **Cloudflare Workers / Pages** qua tệp `wrangler.jsonc`:
     ```powershell
     npx wrangler deploy
     ```
