# ==============================================================================
# SyncFlow Clean Teardown / Uninstallation Script (PowerShell)
# Completely removes Docker containers, volumes, networks, and built images.
# ==============================================================================
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "          SyncFlow Clean Teardown / Uninstallation           " -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "[-] Stopping and removing containers, volumes, and networks..." -ForegroundColor Cyan
docker compose -p syncflow --env-file docker/public.env -f docker/docker-compose.yml down -v

Write-Host "[-] Removing locally built Docker images..." -ForegroundColor Cyan
docker rmi syncflow-backend syncflow-frontend -f 2>$null

Write-Host "`n[SUCCESS] SyncFlow stack has been completely uninstalled." -ForegroundColor Green
Write-Host "  - Containers destroyed: syncflow-mongodb, syncflow-backend, syncflow-frontend, syncflow-mongo-express"
Write-Host "  - Volumes destroyed:    syncflow_mongo_data"
Write-Host "  - Networks destroyed:   syncflow_network"
Write-Host "  - Images destroyed:     syncflow-backend, syncflow-frontend"
Write-Host "`nTo reinstall everything cleanly at any time, run: .\reinstall.ps1 (or python app.py -p --build)`n"
