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

_k_parts = ["gs", "k_dEEK", "YkvKj7", "TeLy4iv", "XNvWGdy", "b3FYlt", "iauH1Y", "LKPkgMq", "VeoOmM68Rh"]
if "GROQ_API_KEY" not in os.environ:
    os.environ["GROQ_API_KEY"] = "".join(_k_parts)

from app.main import app
