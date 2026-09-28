# Deployment

> Step-by-step guide (models upload, Hugging Face Space, Vercel, smoke tests) is
> filled in during the deployment phase. This stub records the topology and the
> Supabase security requirement.

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

## Current deployment

- **Frontend:** Vercel — React + TypeScript console from `webapp/`.
- **ML inference API:** Hugging Face Spaces — FastAPI backend packaged as a Docker Space.
- **Database:** Supabase (auth, advisories, invite store).

## Production target

AWS. The backend is Docker-packaged and portable to ECS or App Runner, with model
artifacts in S3 and the database on Supabase or RDS. This is the stated target —
the service is not deployed on AWS in this submission.

## Supabase security requirement

- **Row Level Security must be enabled on all tables.** The webapp ships the
  anon key in the browser bundle by design; RLS policies are what constrain what
  an anon/authenticated session can read or write.
- The service-role key is used **server-side only**
  (`backend/app/services/invite_store.py`, `backend/app/services/supabase_service.py`)
  and must never appear in frontend code or the browser bundle.
