# SnapVid — Triển Khai Cloudflare Workers + D1 & GitHub (Chi Phí 0đ)

## 1. Hệ thống đã trực tuyến trên Cloudflare (24/7 — 0đ)

- **Trang chủ người dùng:** `https://snapvideo.nguyenhuutung2305007.workers.dev/`
- **Bảng điều khiển Admin:** `https://snapvideo.nguyenhuutung2305007.workers.dev/admin` *(Mật khẩu mặc định: `admin123`)*
- **Cơ sở dữ liệu Edge:** Cloudflare D1 (`snapvideo-db`, vùng APAC) lưu vĩnh viễn toàn bộ cấu hình thông báo, giới hạn lượt `X`, mã VIP, yêu cầu nâng cấp và danh sách thiết bị khách — **không bao giờ bị reset**.
- **Kho mã nguồn GitHub:** `https://github.com/nguyentungvivivi/snapvideo`

---

## 2. Kết nối Máy chủ xử lý Video Python + FFmpeg (24/7 — 0đ)

Cloudflare Workers chạy toàn bộ giao diện, Admin, VIP, bộ đếm lượt `X`, ảnh bìa HD và SEO ở rìa mạng (Edge) với chi phí 0đ. Để xử lý tải và ghép video 4K / MP3 320kbps bằng **`yt-dlp` + `FFmpeg`** (24/7 kể cả khi tắt máy tính):

1. Tạo một Space miễn phí tại **[huggingface.co/new-space](https://huggingface.co/new-space)** → chọn **SDK: `Docker`** (*Blank*), gói **CPU basic (Free · 2 vCPU · 16GB RAM)**.
2. Đẩy toàn bộ repo `https://github.com/nguyentungvivivi/snapvideo` vào Space đó (Space tự chạy theo `Dockerfile` ở cổng `7860`).
3. Lấy đường dẫn Space của bạn (dạng `https://<ten-ban>-snapvideo.hf.space`).
4. Mở **`https://snapvideo.nguyenhuutung2305007.workers.dev/admin`** → đăng nhập `admin123` → mở mục **Tuỳ chỉnh Bảng giá Gói VIP, Liên hệ & Kết nối** → dán đường dẫn Space vào ô **Link Máy chủ Xử lý Video Python+FFmpeg** → bấm **Lưu cấu hình & Đăng thông báo**.

*(Hoặc nếu muốn test nhanh bằng máy tính cá nhân, chỉ cần chạy `python app.py` kèm `cloudflared tunnel --url http://127.0.0.1:8000` rồi dán link tunnel vào ô đó trong `/admin`!)*
