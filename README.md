# SnapVid v2.0 — Web Tải Video Đa Nền Tảng, Quản Trị Admin & Hệ Thống VIP

Ứng dụng web tải video, Shorts, Reels và trích xuất âm thanh từ **YouTube, Instagram, X (Twitter), Facebook, TikTok, Threads...** tốc độ cao, giao diện tối giản không quảng cáo, chuẩn SEO, tích hợp **Giới hạn lượt tải hằng ngày (`X` lượt/thiết bị)**, **Hệ thống Gói VIP (Tháng / Năm)** và **Bảng điều khiển Admin toàn diện**.

## Tính năng nổi bật

1. **Đa nền tảng & Định dạng xuất**:
   - Hỗ trợ YouTube, YouTube Shorts, Instagram (Post, Carousel nhiều video, Reels), X (Twitter), Facebook, Facebook Reels, TikTok, Threads.
   - Xuất **MP4 / WebM** (`360p` → `4K Ultra HD 60fps`) và **MP3 (`320 / 192 / 128 kbps`), M4A, WAV Lossless**.
2. **Giới hạn lượt tải mỗi ngày theo thiết bị khách (`X` lượt/ngày)**:
   - Mặc định tặng **3 lượt / ngày / mỗi máy khách** (kết hợp Cookie mã thiết bị `SV-XXXX` + dấu vân tay IP/Trình duyệt).
   - Admin có thể tuỳ chỉnh con số `X` bất kỳ ngay trên giao diện quản trị, reset lượt hoặc cộng thêm lượt thưởng cho từng máy.
3. **Chế độ Nạp VIP & Mã Kích Hoạt VIP**:
   - Khách có thể nhập **Mã VIP** (`VIP-XXXX-XXXX-XXXX`) để lên VIP tức thì hoặc gửi yêu cầu nâng cấp Gói Tháng / Năm kèm thông tin chuyển khoản/Zalo/Telegram.
   - Admin tạo mã VIP hàng loạt hoặc bấm duyệt nâng cấp VIP trực tiếp cho mã máy `SV-XXXX`.
4. **Bảng Điều Khiển Thông Báo Trực Tiếp (`/admin`)**:
   - Soạn thông báo hiển thị ngay trên đầu trang chủ (hỗ trợ biến `{limit}` tự điền số lượt miễn phí hôm nay, chọn màu sắc & chữ chạy ngang Marquee).
5. **Tối ưu chuyển đổi, Chi phí vận hành 0đ & Chuẩn SEO**:
   - Chạy 100% nội bộ trên `FastAPI + yt-dlp + FFmpeg + SQLite WAL`, bộ nhớ đệm metadata TTL 10 phút, giới hạn luồng `ThreadPoolExecutor` và tự động dọn ổ cứng.
   - Đầy đủ thẻ Meta SEO, Open Graph, Twitter Card, dữ liệu có cấu trúc `Schema.org` (`WebApplication` + `FAQPage`), `/robots.txt` và `/sitemap.xml`.

## Thông tin truy cập

- **Trang người dùng:** `http://localhost:8000`
- **Trang Quản trị Admin:** `http://localhost:8000/admin`
- **Mật khẩu Admin mặc định:** `admin123` *(có thể đổi ngay trong trang Admin)*
