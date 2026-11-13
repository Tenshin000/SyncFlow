@echo off
title SyncFlow Reinstallation
cd /d "%~dp0"
echo ============================================================
echo        SyncFlow Stack Reinstallation & Restoration          
echo ============================================================
python app.py --populate --build
if %ERRORLEVEL% neq 0 (
    echo.
    echo An error occurred during reinstallation. Press any key to exit...
    pause >nul
)
