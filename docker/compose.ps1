# ==============================================================================
# SyncFlow - PowerShell Docker Compose Lifecycle Management Script
# ==============================================================================

param (
    [string]$Command = "up",
    [string]$Service = ""
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ScriptDir "docker-compose.yml"
$EnvFile = Join-Path $ScriptDir "public.env"

function Run-Compose {
    param([string[]]$ComposeArgs)
    docker compose --env-file $EnvFile -f $ComposeFile @ComposeArgs
}

switch ($Command.ToLower()) {
    "up" {
        Write-Host "=== Starting SyncFlow Environment (MongoDB, FastAPI, Web UI, Mongo Express) ===" -ForegroundColor Cyan
        Run-Compose @("up", "--build", "-d")
        Write-Host "SyncFlow services are up and running!" -ForegroundColor Green
        Write-Host "  - SyncFlow Web App:     http://localhost:8501" -ForegroundColor Yellow
        Write-Host "  - SyncFlow REST API:    http://localhost:8000/docs" -ForegroundColor Yellow
        Write-Host "  - Mongo Express Web UI: http://localhost:8081" -ForegroundColor Yellow
        Write-Host "  - MongoDB Server:       localhost:27017" -ForegroundColor Yellow
    }
    "down" {
        Write-Host "=== Stopping SyncFlow Containers ===" -ForegroundColor Yellow
        Run-Compose @("down")
        Write-Host "Containers stopped." -ForegroundColor Green
    }
    "clean" {
        Write-Host "=== Stopping SyncFlow Containers and Removing Volumes ===" -ForegroundColor Red
        Run-Compose @("down", "-v")
        Write-Host "Containers and persistent volumes removed." -ForegroundColor Green
    }
    "build" {
        Write-Host "=== Rebuilding SyncFlow Application Image ===" -ForegroundColor Cyan
        Run-Compose @("build", "--no-cache")
    }
    "logs" {
        if ($Service) {
            Run-Compose @("logs", "-f", $Service)
        } else {
            Run-Compose @("logs", "-f")
        }
    }
    { $_ -in "ps", "status" } {
        Run-Compose @("ps")
    }
    "restart" {
        Write-Host "=== Restarting SyncFlow Environment ===" -ForegroundColor Yellow
        Run-Compose @("restart")
    }
    "shell" {
        Write-Host "=== Opening bash inside SyncFlow Application container ===" -ForegroundColor Cyan
        Run-Compose @("exec", "app", "bash")
    }
    "mongosh" {
        Write-Host "=== Opening mongosh inside SyncFlow MongoDB container ===" -ForegroundColor Cyan
        Run-Compose @("exec", "mongodb", "mongosh", "--username", "syncflow_admin", "--password", "syncflow_password123", "--authenticationDatabase", "admin", "syncflow_db")
    }
    default {
        Write-Host "Usage: .\compose.ps1 [command] [-Service <name>]" -ForegroundColor Cyan
        Write-Host "Commands:"
        Write-Host "  up         - Build and start all services in background (default)"
        Write-Host "  down       - Stop and remove all running containers"
        Write-Host "  clean      - Stop containers and purge persistent database volumes"
        Write-Host "  build      - Rebuild the application image from Dockerfile"
        Write-Host "  logs       - Follow container output logs (optional: .\compose.ps1 logs -Service app)"
        Write-Host "  ps         - Show status of all services"
        Write-Host "  restart    - Restart all running services"
        Write-Host "  shell      - Open an interactive shell inside the Python app container"
        Write-Host "  mongosh    - Open interactive MongoDB shell connected to syncflow_db"
    }
}
