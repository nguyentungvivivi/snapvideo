# Dockerfile tối ưu chạy miễn phí 0đ trên Hugging Face Spaces / Render Free / Oracle Free VPS
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Tạo thư mục dữ liệu & phân quyền cho user non-root (chuẩn Hugging Face Spaces port 7860)
RUN mkdir -p /app/data /app/downloads && chmod -R 777 /app/data /app/downloads

ENV HOST=0.0.0.0
ENV PORT=7860
ENV SNAPVID_WORKERS=2
ENV SNAPVID_MEDIA_ONLY=1

EXPOSE 7860

CMD ["python", "app.py"]
