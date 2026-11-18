@echo off
chcp 65001 >nul
title SnapVid v2.0 - Web Tai Video Da Nen Tang ^& Quan Tri VIP
cd /d "%~dp0"
echo ========================================================
echo   SnapVid v2.0 - Da Nen Tang + Quan Tri VIP
echo   Trang khach: http://localhost:8000
echo   Trang Admin: http://localhost:8000/admin (MK: admin123)
echo ========================================================
start "" "http://localhost:8000"
python app.py
pause
