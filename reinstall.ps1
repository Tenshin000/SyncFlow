# ==============================================================================
# SyncFlow Reinstallation & Complete Restoration Script (PowerShell)
# Builds containers, starts services, verifies health, seeds DB, opens browser.
# ==============================================================================
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       SyncFlow Stack Reinstallation & Restoration           " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

python app.py --populate --build
