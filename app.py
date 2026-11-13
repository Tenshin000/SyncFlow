"""SyncFlow Application Launcher & Environment Initiator.

Verifies and auto-installs missing host dependencies, starts the Docker Compose
environment (MongoDB, FastAPI backend, Web UI, Mongo Express), monitors health
checks, and launches the default web browser at:
http://localhost:8501/login.html

Usage:
    python app.py                 # Starts containers, verifies health, launches UI
    python app.py --populate      # Starts containers and populates DB from JSON files
    python app.py --clean         # Resets DB collections from JSON files on start
"""
import os
import sys
import time
import argparse
import subprocess
import webbrowser
import warnings
import urllib.request
import urllib.error
from typing import List, Optional

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DOCKER_DIR = os.path.join(PROJECT_ROOT, "docker")
COMPOSE_FILE = os.path.join(DOCKER_DIR, "docker-compose.yml")
ENV_FILE = os.path.join(DOCKER_DIR, "public.env")
REQUIREMENTS_FILE = os.path.join(PROJECT_ROOT, "requirements.txt")
POPULATE_SCRIPT = os.path.join(PROJECT_ROOT, "populate_db.py")

LOGIN_URL = "http://localhost:8501/login.html"
HEALTH_URL = "http://localhost:8000/syncflow/health"
API_DOCS_URL = "http://localhost:8000/docs"
MONGO_EXPRESS_URL = "http://localhost:8081"

MAX_WAIT_SECONDS = 90

DEFAULT_ENV_CONTENT = """# ==============================================================================
# SyncFlow Public Environment Variables (Default Local Dev Setup)
# ==============================================================================
MONGO_INITDB_ROOT_USERNAME=syncflow_admin
MONGO_INITDB_ROOT_PASSWORD=syncflow_password123
MONGO_INITDB_DATABASE=syncflow_db
MONGO_PORT=27017
FRONTEND_PORT=8501
BACKEND_PORT=8000
MONGO_EXPRESS_PORT=8081
STREAMLIT_SERVER_PORT=8501
MONGO_URI=mongodb://syncflow_admin:syncflow_password123@mongodb:27017/syncflow_db?authSource=admin
JWT_SECRET=syncflow_insecure_development_jwt_secret_key_change_in_production_2026
"""


def _check_and_install_python_dependencies() -> None:
    """Verifies that required Python packages are installed; installs missing ones via pip."""
    print("[1/5] Checking Python dependencies...")

    # Key modules required for host tools and scripts
    required_modules = {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "pymongo": "pymongo",
        "pydantic": "pydantic",
        "bcrypt": "bcrypt",
        "dotenv": "python-dotenv",
        "google.generativeai": "google-generativeai"
    }

    missing = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for module_name, pkg_name in required_modules.items():
            try:
                __import__(module_name)
            except ImportError:
                missing.append(pkg_name)

    if missing:
        print(f"      Missing Python package(s): {', '.join(missing)}")
        print("      Automatically installing dependencies from requirements.txt...")
        try:
            if os.path.isfile(REQUIREMENTS_FILE):
                cmd = [sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS_FILE]
            else:
                cmd = [sys.executable, "-m", "pip", "install"] + missing
            subprocess.run(cmd, check=True)
            print("      All required Python dependencies successfully installed.")
        except subprocess.CalledProcessError as exc:
            print(f"\n[WARNING] Automatic pip installation failed with exit code {exc.returncode}.")
            print("Please run manually: pip install -r requirements.txt")
    else:
        print("      All Python host dependencies are satisfied.")


def _ensure_env_file() -> None:
    """Ensures docker/public.env exists with working defaults."""
    if not os.path.isfile(ENV_FILE):
        print(f"      Generating default environment configuration at: {ENV_FILE}")
        os.makedirs(os.path.dirname(ENV_FILE), exist_ok=True)
        with open(ENV_FILE, "w", encoding="utf-8") as f:
            f.write(DEFAULT_ENV_CONTENT.strip() + "\n")


def _check_docker_running() -> bool:
    """Verifies that Docker daemon is reachable."""
    try:
        res = subprocess.run(
            ["docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10
        )
        return res.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _resolve_compose_command() -> List[str]:
    """Detects whether modern 'docker compose' or legacy 'docker-compose' is available."""
    try:
        res = subprocess.run(["docker", "compose", "version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0:
            return ["docker", "compose"]
    except Exception:
        pass

    try:
        res = subprocess.run(["docker-compose", "version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0:
            return ["docker-compose"]
    except Exception:
        pass

    return ["docker", "compose"]


def _is_url_ready(url: str) -> bool:
    """Checks if an HTTP URL responds with a 200 OK status."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SyncFlow-Launcher/1.0"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, ConnectionResetError, OSError):
        return False


def main():
    parser = argparse.ArgumentParser(description="SyncFlow Full Stack Application Launcher")
    parser.add_argument("--populate", "-p", action="store_true", help="Populate MongoDB with sample data after launch")
    parser.add_argument("--clean", action="store_true", help="Clean and re-populate MongoDB collections")
    parser.add_argument("--dump", action="store_true", help="Dump current MongoDB collections to docker/mongo-init JSON files and exit")
    parser.add_argument("--build", "-b", action="store_true", help="Force rebuild Docker containers before starting")
    args = parser.parse_args()

    if args.dump:
        subprocess.run([sys.executable, POPULATE_SCRIPT, "--dump"])
        sys.exit(0)

    print("=" * 65)
    print("                 SYNCFLOW APPLICATION LAUNCHER")
    print("=" * 65)

    # 1. Dependency checks & auto-installation
    _check_and_install_python_dependencies()
    _ensure_env_file()

    # 2. Check Docker daemon availability
    print("[2/5] Checking Docker daemon status...")
    if not _check_docker_running():
        print("\n[ERROR] Docker daemon is not running or 'docker' is not in PATH.")
        print("Please start Docker Desktop and run this script again.")
        sys.exit(1)
    print("      Docker daemon is active and responsive.")

    # 3. Start SyncFlow containers via Docker Compose
    print("[3/5] Starting SyncFlow Docker containers (project: syncflow)...")
    compose_bin = _resolve_compose_command()
    compose_cmd = compose_bin + [
        "-p", "syncflow",
        "--env-file", ENV_FILE,
        "-f", COMPOSE_FILE,
        "up", "-d"
    ]
    if args.build:
        compose_cmd.append("--build")

    try:
        subprocess.run(compose_cmd, cwd=DOCKER_DIR, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"\n[ERROR] Failed to start Docker Compose services (exit code {exc.returncode}).")
        sys.exit(exc.returncode)

    # 4. Wait for backend and frontend services to be ready
    print("[4/5] Waiting for services to become ready...")
    start_time = time.time()
    backend_ready = False
    frontend_ready = False

    while time.time() - start_time < MAX_WAIT_SECONDS:
        if not backend_ready and _is_url_ready(HEALTH_URL):
            backend_ready = True
            print("      - FastAPI Backend is healthy.")

        if not frontend_ready and _is_url_ready(LOGIN_URL):
            frontend_ready = True
            print("      - Frontend Web UI is ready.")

        if backend_ready and frontend_ready:
            break

        time.sleep(1)

    if not (backend_ready and frontend_ready):
        print("\n[WARNING] Timed out waiting for some services to respond.")
        print(f"Backend ready:  {backend_ready} ({HEALTH_URL})")
        print(f"Frontend ready: {frontend_ready} ({LOGIN_URL})")
        print("Containers might still be initializing. Inspect logs with: docker compose -p syncflow logs")
    else:
        elapsed = round(time.time() - start_time, 1)
        print(f"      All services operational in {elapsed}s.")

    # Optional database population if requested
    if args.populate or args.clean:
        print("\n[-] Populating database as requested...")
        pop_cmd = [sys.executable, POPULATE_SCRIPT]
        if args.clean:
            pop_cmd.append("--clean")
        subprocess.run(pop_cmd)

    # 5. Open default web browser
    print(f"[5/5] Opening default browser at: {LOGIN_URL}")
    webbrowser.open(LOGIN_URL)

    # Print summary information
    print("\n" + "=" * 65)
    print("SyncFlow is up and running:")
    print(f"  - Web Application: {LOGIN_URL}")
    print(f"  - REST API Docs:   {API_DOCS_URL}")
    print(f"  - Mongo Express:   {MONGO_EXPRESS_URL}")
    print(f"  - MongoDB Server:  localhost:27017 (database: syncflow_db)")
    print("=" * 65)
    print("Database Notice:")
    print("  MongoDB collections are initialized empty by default.")
    print("  To populate seed data at any time, run: python populate_db.py")
    print("  To wipe and re-seed, run:               python populate_db.py --clean")
    print("=" * 65)
    print("To stop SyncFlow, run: docker compose -p syncflow down")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    main()
