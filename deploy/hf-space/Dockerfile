# ── AirLens API — Hugging Face Space (Docker) ────────────────────────────────
# Serves the FastAPI backend only: the React console lives on Vercel, which
# proxies /api/* here. Static console assets are deliberately NOT built in
# this image, so no Node stage is needed.
#
# Models are NOT baked in: MODEL_SOURCE=hf lazily fetches each station's
# artifacts from $HF_MODEL_REPO on first request (nothing downloads at boot).

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# libgomp1: lightgbm's OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-space.txt ./
RUN pip install --no-cache-dir -r requirements-space.txt

COPY llm/ ./llm/
COPY backend/ ./backend/

# Non-root user (HF Spaces requires uid 1000 'user')
RUN useradd --create-home --uid 1000 user \
    && chown -R user:user /app /tmp/hf
USER user

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:7860/api/v1/health || exit 1

# Single worker: the in-process response cache / rate limiter would diverge
# across workers. Scale out = move that state to Redis first.
#
# Paths: --app-dir backend puts backend/ on sys.path (app.main:app); PYTHONPATH
# keeps the repo root importable for `llm.model.*` (the per-station forecast
# module lives outside the backend package).
ENV PYTHONPATH=/app
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
