# SyncFlow Launcher PowerShell Script
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
python app.py @args
