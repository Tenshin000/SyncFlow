@echo off
title SyncFlow Clean Teardown
cd /d "%~dp0"
echo ============================================================
echo           SyncFlow Clean Teardown / Uninstallation          
echo ============================================================
echo [-] Stopping and removing containers, volumes, and networks...
docker compose -p syncflow --env-file docker\public.env -f docker\docker-compose.yml down -v
echo [-] Removing locally built Docker images...
docker rmi syncflow-backend syncflow-frontend -f 2>nul
echo.
echo [SUCCESS] SyncFlow stack has been completely uninstalled.
echo To reinstall everything cleanly at any time, run: reinstall.bat (or python app.py -p --build)
echo.
pause
