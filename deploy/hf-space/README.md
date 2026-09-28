---
title: AirLens API
emoji: 🌫️
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: true
---

# AirLens API — FastAPI on Hugging Face Spaces

Docker Space serving the AirLens backend (ML inference API). The React console
is deployed separately on Vercel, which proxies `/api/*` to this Space; the
Swagger UI is available at `/docs`.

## Runtime model

- `MODEL_SOURCE=hf` (default in the Space): each station's LightGBM artifacts are
  lazily fetched from `$HF_MODEL_REPO` on first request into `$MODEL_CACHE_DIR`
  (default `/tmp/hf`) and cached in memory. **Nothing downloads at boot**, so the
  Space starts fast and `/api/v1/health` responds immediately.
- The production LightGBM fleet is the default path; the Chronos-2 comparison
  model runs only with `ENABLE_CHRONOS=1` (CPU-only Spaces: leave it at 0).

## Secrets to set (Settings → Variables and secrets)

| Secret | Purpose |
|---|---|
| `APP_API_KEY` | Key for mutating endpoints (X-API-Key) |
| `OPENAQ_API_KEY` | Live station observations (`/realtime/*` returns 502 without it) |
| `FIRMS_API_KEY` | NASA FIRMS fire detections (plume endpoints) |
| `GROQ_API_KEY` | AI health assistant (feature degrades cleanly when unset) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only — never expose to the browser |
| `HF_MODEL_REPO` | Model repo id, e.g. `techtitans07x/airlens-models` |
| `HF_TOKEN` | Only if the model repo is private |
| `ALLOWED_ORIGINS` | Your Vercel domain(s) — never `*` |
| `MODEL_SOURCE` | `hf` |
| `ENABLE_CHRONOS` | `0` unless you accept the CPU cost of the comparison model |

Open-Meteo needs no key, so the forecast and inversion endpoints work before any
secrets are configured.
