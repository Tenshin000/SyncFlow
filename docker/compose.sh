#!/usr/bin/env bash
# ==============================================================================
# SyncFlow - Docker Compose Lifecycle Management Script
# ==============================================================================

set -euo pipefail

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/public.env"

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check docker command availability
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR] Docker is not installed or not in PATH.${NC}"
    exit 1
fi

# Function to run docker compose with correct context and env file
run_compose() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# Command dispatcher
COMMAND="${1:-up}"

case "$COMMAND" in
    up)
        echo -e "${BLUE}=== Starting SyncFlow Environment (MongoDB, FastAPI, Web UI, Mongo Express) ===${NC}"
        run_compose up --build -d
        echo -e "${GREEN}SyncFlow services are up and running!${NC}"
        echo -e "  - SyncFlow Web App:     ${YELLOW}http://localhost:8501${NC}"
        echo -e "  - SyncFlow REST API:    ${YELLOW}http://localhost:8000/docs${NC}"
        echo -e "  - Mongo Express Web UI: ${YELLOW}http://localhost:8081${NC}"
        echo -e "  - MongoDB Server:       ${YELLOW}localhost:27017${NC}"
        ;;
    down)
        echo -e "${YELLOW}=== Stopping SyncFlow Containers ===${NC}"
        run_compose down
        echo -e "${GREEN}Containers stopped successfully.${NC}"
        ;;
    clean)
        echo -e "${RED}=== Stopping SyncFlow Containers and Removing Volumes ===${NC}"
        run_compose down -v
        echo -e "${GREEN}Containers and persistent volumes removed.${NC}"
        ;;
    build)
        echo -e "${BLUE}=== Rebuilding SyncFlow Application Image ===${NC}"
        run_compose build --no-cache
        ;;
    logs)
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            run_compose logs -f "$SERVICE"
        else
            run_compose logs -f
        fi
        ;;
    ps|status)
        run_compose ps
        ;;
    restart)
        echo -e "${YELLOW}=== Restarting SyncFlow Environment ===${NC}"
        run_compose restart
        ;;
    shell)
        echo -e "${BLUE}=== Opening bash inside SyncFlow Application container ===${NC}"
        run_compose exec app bash
        ;;
    mongosh)
        echo -e "${BLUE}=== Opening mongosh inside SyncFlow MongoDB container ===${NC}"
        run_compose exec mongodb mongosh --username syncflow_admin --password syncflow_password123 --authenticationDatabase admin syncflow_db
        ;;
    help|*)
        echo -e "${BLUE}Usage: ./compose.sh [command]${NC}"
        echo "Commands:"
        echo "  up         - Build and start all services in background (default)"
        echo "  down       - Stop and remove all running containers"
        echo "  clean      - Stop containers and purge persistent database volumes"
        echo "  build      - Rebuild the application image from Dockerfile"
        echo "  logs       - Follow container output logs (optional: ./compose.sh logs app)"
        echo "  ps         - Show status of all services"
        echo "  restart    - Restart all running services"
        echo "  shell      - Open an interactive shell inside the Python app container"
        echo "  mongosh    - Open interactive MongoDB shell connected to syncflow_db"
        echo "  help       - Display this help message"
        ;;
esac
