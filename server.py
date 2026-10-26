"""
SyncFlow API – Server Entry Point.
Run from project root with: uvicorn server:app --reload
"""
import sys
import os

# Ensure project root is in sys.path so backend.* imports resolve correctly
ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.user import app  # noqa: F401 — re-exported for uvicorn discovery

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
