# llm/ — Per-Station 168-hour (7-Day) Air-Quality Forecast Module

**Not a chat LLM.** This is a trained ML forecasting module: one LightGBM model per
(station, pollutant) that produces numeric **168-hour (7-day) hourly forecasts** of
PM2.5, PM10, NO2, O3, SO2 (CO excluded by decision) from that station's own
multi-year history plus open forecast covariates. AQI is derived with the app's own
CPCB sub-index logic, so numbers match everywhere else on the site.

**Data-source honesty:** live CAMS AQ forecasts are verified only to ~+96h. Hours
1–96 are backed by real AQ forecast fields (`aq_source: "cams_forecast"`); hours
97–168 run on the explicit climatology + forecast-weather fallback
(`aq_source: "climatology_fallback"`) — the same substitute is used in training,
so the model learns day 5–7 behavior conditioned on fallback inputs. Expect
visibly weaker skill in that band; confidence bands widen accordingly.

## Layout

```
llm/
  README.md                        <- you are here
  model/
    station_forecast_service.py    <- serving: live data -> features -> models -> 168h
    station_forecast_endpoint.py   <- API: /forecast/stations, /station-168hr, /station-status
    station_models/                <- TRAINED ARTIFACTS (per-station .txt + meta.json)
      _global/                     <- pooled NCR pretrain models (Stage A)
      metrics_summary.json         <- per-station holdout metrics (machine-readable)
      METRICS.md                   <- human-readable metrics report
      registry.json                <- 45-station serving registry (uid, coords, ids)
    training/                      <- full reproducible pipeline
      discover_stations.py         <- OpenAQ S3 discovery -> station registry + manifest
      fetch_history.py             <- station observations (OpenAQ public archive, keyless)
      fetch_weather.py             <- CAMS + HRES covariates 2022-09..now (Open-Meteo)
      fetch_wx_legacy.py(+_all)    <- HRES-only covariates 2015..2022-09 (pre-CAMS era)
      merge_eras.py                <- stitch legacy + modern eras per station
      features.py                  <- SHARED feature space (train == serve, zero skew)
      train.py                     <- single-station trainer (reference implementation)
      train_all.py                 <- Stage A global pretrain + Stage B fine-tune
      report_metrics.py            <- METRICS.md generator
      data/ data_legacy/ data_merged/  <- fetched CSVs (gitignored)
```

## Data sources (all keyless)

| Source | What | Era |
|---|---|---|
| OpenAQ public S3 archive | CPCB station observations, 15-min -> hourly | 2015..today |
| Open-Meteo air-quality (CAMS) | pollutant analysis + **forecast fields to ~+96h** (hard nulls past; >96h targets use climatology fallback) | 2022-09..today |
| Open-Meteo archive (HRES) | wind/BLH/temp/pressure/rain/cloud | 2015..today |

The external API keys in `.env` (IQAir, WeatherAPI, FIRMS, …) power the site's
*live* sections — the module itself needs no keys.

## How a forecast is made (serving, `station_forecast_service.py`)

1. Pull that station's last ~12 days of real observations from the OpenAQ archive.
2. Extend the timeline to the current hour: the gap is filled with CAMS plus the
   station's own recent CAMS-vs-observed offset; the **live consensus snapshot**
   (the same feed as the Live AQI desk) is injected at T0.
3. Fetch CAMS + HRES fields for T0−48h .. T0+168h (CAMS AQ data ends ~+96h; HRES
   weather covers the full 168h).
4. Build features with the exact `StationFeatureSpace` class used in training
   (no train/serve skew), one row per horizon 1..168; hours past the CAMS cutoff
   are substituted with the frozen climatology+ventilation tables from meta.json.
5. Predict with the station's five fine-tuned LightGBM boosters; convert to CPCB
   sub-indices and AQI; return 168 hourly entries with `aq_source` flags.

## Training design (leakage-free, horizon-conditioned)

- Every sample is `(issue_time T0, horizon h)`; the target is the observation at
  T0+h. Features use **only what exists at T0**: station lags/rolls, CAMS level
  + offset features, weather analysis — plus CAMS/HRES **forecast fields at the
  target hour** (CAMS capped at its verified ~+96h lead) and target-hour calendar.
- `horizon` is a feature; one booster per (station, pollutant) serves all 168 hours.
- Stage A pools all stations (stride-thinned) to learn shared NCR dynamics;
  Stage B continues each global model (`init_model=`) on the station's own full
  history. Fine-tuned boosters are self-contained — serving needs no global model.
- Validation: the most recent **120 days** of each station's record, chronological,
  never shuffled. Early stopping is season-matched to the holdout.
- NaN-tolerant: the pre-CAMS era (2015–2022) trains on station memory + HRES +
  calendar; LightGBM handles missing covariates natively.

## Reproduce

```bash
# 1. data (resumable)
python llm/model/training/fetch_history.py  --manifest llm/model/training/data/discovery_manifest.json
python llm/model/training/fetch_weather.py  --manifest llm/model/training/data/discovery_manifest.json
python llm/model/training/fetch_history.py  --manifest ... --years 2015,...,2021 --out llm/model/training/data_legacy
python llm/model/training/fetch_wx_legacy_all.py
python llm/model/training/merge_eras.py
# 2. train
python llm/model/training/train_all.py
# 3. report
python llm/model/training/report_metrics.py
```

## Honest-accuracy notes

- Metrics are scored against **station observations**, but through the OpenAQ
  archive, whose newest files can lag by hours-to-days. The live anchor (consensus)
  covers T0; hours 1–72 are pure model + CAMS forecasts.
- See `station_models/METRICS.md` for the per-station table and the
  error-growth-by-horizon marks (+1h … +72h).
- CAMS PM10 runs biased high vs CPCB; the offset features correct most of it,
  but dust-storm spikes remain the hardest regime.
