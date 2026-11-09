@echo off
title SyncFlow Launcher
cd /d "%~dp0"
python app.py %*
if %ERRORLEVEL% neq 0 (
    echo.
    echo An error occurred. Press any key to exit...
    pause >nul
)
