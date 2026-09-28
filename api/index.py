"""
Vercel Serverless Entry Point for Delhi NCR AQI FastAPI Application
"""
import os
import sys

# Ensure backend directory is in python search path
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.abspath(os.path.join(current_dir, ".."))
backend_dir = os.path.join(root_dir, "backend")

for path in [backend_dir, root_dir, current_dir]:
    if path not in sys.path:
        sys.path.insert(0, path)


from app.main import app
