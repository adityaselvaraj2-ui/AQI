# Deployment

Current deployment: **frontend on Vercel, ML inference API on Hugging Face Spaces,
database on Supabase.** The production target is **AWS** — the backend is
Docker-packaged and portable to ECS or App Runner, with model artifacts in S3 and
the database on Supabase or RDS. Nothing is deployed on AWS in this submission.

## Step 1 — Upload the models to the Hugging Face Hub

1. Create a **write** token at huggingface.co → Settings → Access Tokens.
2. Choose the model repo id (default below) and run:

   ```bash
   set HF_TOKEN=hf_...                                # env only, never an argument
   set HF_MODEL_REPO=techtitans07x/airlens-models
   python scripts/deploy/upload_models_to_hf.py --dry-run   # ~960 MB, ~500 files
   python scripts/deploy/upload_models_to_hf.py
   ```

   The script creates the repo (`exist_ok=True`), uploads `station_models/`,
   `station_models_chronos2/global_*/` and `station_registry.json`, and publishes
   `llm/model/MODEL_CARD.md` as the Hub README. Tracked metrics/eval files are
   excluded — git stays their home.

3. Keep the repo **public** to skip `HF_TOKEN` on the serving side; if it must be
   private, the Space needs a read token (Step 2).

## Step 2 — Create the Space and set the secrets

1. New Space → **Docker** SDK (blank). Name it, e.g. `airlens-api`.
2. Push the Space payload. Either let the workflow do it — on GitHub, set the
   **repository secret** `HF_TOKEN` (HF write token) and the **repository
   variable** `HF_SPACE_REPO` (`techtitans07x/airlens-api`), then merge to
   `main` (`.github/workflows/sync-to-hf-space.yml` assembles the tree: Space
   Dockerfile + requirements at root, `backend/` + `llm/`) — or push manually
   the first time:

   ```bash
   git clone https://huggingface.co/spaces/techtitans07x/airlens-api
   cp deploy/hf-space/Dockerfile deploy/hf-space/requirements-space.txt deploy/hf-space/README.md airlens-api/
   cp -r backend llm airlens-api/
   cd airlens-api && git add -A && git commit -m "AirLens API" && git push
   ```

3. Space → **Settings → Variables and secrets**:

   | Secret | Value |
   |---|---|
   | `APP_API_KEY` | strong random key (`python -c "import secrets; print(secrets.token_urlsafe(32))"`) |
   | `OPENAQ_API_KEY` | OpenAQ v3 key |
   | `FIRMS_API_KEY` | NASA FIRMS MAP_KEY |
   | `GROQ_API_KEY` | Groq key (assistant degrades cleanly without it) |
   | `SUPABASE_URL` | project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key — server-side only |
   | `HF_MODEL_REPO` | `techtitans07x/airlens-models` |
   | `HF_TOKEN` | only if the model repo is private |
   | `ALLOWED_ORIGINS` | your Vercel domain(s), comma-separated — never `*` |
   | `MODEL_SOURCE` | `hf` |
   | `ENABLE_CHRONOS` | `0` (CPU Space; the LightGBM fleet is the default path) |

4. Verify boot: the Space builds the image, starts uvicorn on 7860, and
   `/api/v1/health` returns 200 immediately — **no model downloads at boot**
   (per-station artifacts are fetched lazily on first request).

## Step 3 — Deploy the frontend on Vercel

1. Import the GitHub repo into Vercel; `vercel.json` drives the build
   (`cd webapp && npm ci && npm run build`, output `webapp/dist`).
2. Replace the placeholder in `vercel.json` with your Space URL — every
   `https://REPLACE-ME-airlens-api.hf.space/...` must become
   `https://<your-space-subdomain>.hf.space/...` — and commit.
3. Make sure the Space's `ALLOWED_ORIGINS` lists the Vercel domain(s).
4. Verify with a **preview deployment** (see below) before promoting.

## Step 4 — Smoke tests

Direct against the Space:

```bash
curl -s https://<space-subdomain>.hf.space/api/v1/health
curl -s https://<space-subdomain>.hf.space/api/v1/forecast/stations | head -c 300
curl -s "https://<space-subdomain>.hf.space/api/v1/forecast/station-168hr?station_id=50" | head -c 400
curl -sI https://<space-subdomain>.hf.space/docs | head -1
```

Through Vercel (rewrites + function):

```bash
curl -s https://<vercel-domain>/api/v1/health
curl -sI "https://<vercel-domain>/api/tts?text=hello&lang=en" | grep -i content-type   # audio/mpeg
curl -s https://<vercel-domain>/api/v1/forecast/stations | head -c 300
curl -sI https://<vercel-domain>/ | head -1        # 200, SPA index
```

## Vercel preview verification

Before promoting a production deploy, verify a **preview deployment** (every PR
and CLI `vercel` invocation gets one):

1. `GET https://<preview-url>/api/v1/health` → `200 {"status": "ok", ...}` —
   proves the rewrite to the HF Space works and the Space is up.
2. `GET https://<preview-url>/api/tts?text=hello&lang=en` → `200` with
   `Content-Type: audio/mpeg` — proves the Vercel function still resolves before
   the rewrites and proxies Google Translate TTS.
3. `GET https://<preview-url>/api/v1/forecast/stations` → `200` with the station
   list — proves an authenticated-space path passes through `/api/v1/*` intact.
4. Open the preview URL in a browser and confirm the console renders and the
   hero loads a forecast (SPA fallback serves `/index.html` for every non-API
   path).

## Supabase security requirement

- **Row Level Security must be enabled on all tables.** The webapp ships the
  anon key in the browser bundle by design; RLS policies are what constrain what
  an anon/authenticated session can read or write.
- The service-role key is used **server-side only**
  (`backend/app/services/invite_store.py`, `backend/app/services/supabase_service.py`)
  and must never appear in frontend code or the browser bundle.
