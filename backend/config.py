import os
from pydantic import BaseModel
try:
    from dotenv import load_dotenv
    docker_env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docker", "public.env")
    if os.path.exists(docker_env_path):
        load_dotenv(docker_env_path)
    else:
        load_dotenv()
except ImportError:
    # Graceful manual parsing fallback if python-dotenv is not installed in local environment
    docker_env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docker", "public.env")
    if os.path.exists(docker_env_path):
        with open(docker_env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ.setdefault(key.strip(), val.strip())


class Settings(BaseModel):
    """SyncFlow Application and Database Configuration Settings."""
    
    APP_NAME: str = "SyncFlow"
    APP_ENV: str = os.getenv("APP_ENV", "development")
    
    # MongoDB Configuration
    MONGO_HOST: str = os.getenv("MONGO_HOST", "localhost")
    MONGO_PORT: int = int(os.getenv("MONGO_PORT", 27017))
    MONGO_INITDB_ROOT_USERNAME: str = os.getenv("MONGO_INITDB_ROOT_USERNAME", "syncflow_admin")
    MONGO_INITDB_ROOT_PASSWORD: str = os.getenv("MONGO_INITDB_ROOT_PASSWORD", "syncflow_password123")
    MONGO_INITDB_DATABASE: str = os.getenv("MONGO_INITDB_DATABASE", "syncflow_db")
    
    # Preferred Mongo URI
    MONGO_URI: str = os.getenv(
        "MONGO_URI",
        f"mongodb://{os.getenv('MONGO_INITDB_ROOT_USERNAME', 'syncflow_admin')}:{os.getenv('MONGO_INITDB_ROOT_PASSWORD', 'syncflow_password123')}@{os.getenv('MONGO_HOST', 'localhost')}:{os.getenv('MONGO_PORT', 27017)}/{os.getenv('MONGO_INITDB_DATABASE', 'syncflow_db')}?authSource=admin"
    )
    
    # LLM API Keys & Permitted Models
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
    DEFAULT_LLM_PROVIDER: str = os.getenv("DEFAULT_LLM_PROVIDER", "gemini")
    ALLOWED_GEMINI_MODELS: list = ["gemini-flash-latest", "gemini-flash-lite-latest"]
    DEFAULT_GEMINI_MODEL: str = os.getenv("DEFAULT_GEMINI_MODEL", "gemini-flash-latest")
    
    # Streamlit Config
    STREAMLIT_SERVER_PORT: int = int(os.getenv("STREAMLIT_SERVER_PORT", 8501))


settings = Settings()
