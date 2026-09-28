# llm/model — per-station forecasting module

Serving code for the 168-hour per-station forecasts (`/api/v1/forecast/station-168hr`):

- `station_forecast_endpoint.py` — FastAPI routes
- `station_forecast_service.py` — LightGBM serving (live OpenAQ history + Open-Meteo covariates)
- `station_chronos2_service.py` — optional Chronos-2 comparison path (`ENABLE_CHRONOS=1`)
- `training/` — the training pipeline that produced the artifacts
- `MODEL_CARD.md` — the model card published alongside the weights on the HF Hub

## Where the model weights live

The LightGBM fleet (`station_models/<id>/`, ~640 MB) and the Chronos-2 adapters
(`station_models_chronos2/global_*/`, ~320 MB) are **not in git** — they live on the
Hugging Face Hub (default repo id: `techtitans07x/airlens-models`). The small
metrics/eval files (`metrics_summary.json`, `head_to_head.json`, `eval_*.json`,
`CHRONOS2_VERDICT.md`, `registry.json`) stay tracked in git.

### Fetch weights for local serving

```bash
set HF_MODEL_REPO=techtitans07x/airlens-models
python scripts/deploy/download_models.py            # all stations, LightGBM only
python scripts/deploy/download_models.py --station 50 --station 301
python scripts/deploy/download_models.py --chronos  # also the Chronos-2 adapters
```

### Serving without any local weights (HF Spaces)

Set `MODEL_SOURCE=hf` and `HF_MODEL_REPO` (plus `HF_TOKEN` only if the model repo is
private). On the first request for a station the service downloads just that station's
directory into `MODEL_CACHE_DIR` and caches it in memory — nothing downloads at boot.

## Uploading after a retrain

```bash
set HF_TOKEN=hf_...                                  # env only, never a CLI argument
python scripts/deploy/upload_models_to_hf.py --dry-run
python scripts/deploy/upload_models_to_hf.py
```

The upload excludes the tracked metrics files (the repo is their home) and pushes
only the weights plus `station_registry.json`.
