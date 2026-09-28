---
license: mit
language:
- en
tags:
- air-quality
- aqi
- forecasting
- delhi
- lightgbm
- chronos
- time-series
---

# AirLens station models — Delhi NCR AQI

Trained per-station forecasting artifacts for AirLens (Smart India Hackathon 2026,
Team Tech Titans / TECHTITANS07X). These are the weights served at runtime by the
AirLens API with `MODEL_SOURCE=hf`; code lives at
https://github.com/TECHTITANS07X/AIRLENS.

## Contents

| Path | What it is |
|---|---|
| `station_models/<station_id>/` | One LightGBM Booster per pollutant (`.txt`), `feature_columns.json`, `meta.json` (frozen climatology, blend flags, band calibration) |
| `station_models_chronos2/global_<poll>/` | Chronos-2 LoRA adapters (comparison model; LOST the head-to-head, ships only behind `ENABLE_CHRONOS=1`) |
| `station_registry.json` | Station registry: OpenAQ ids, names, coordinates |

Pollutants: PM2.5, PM10, NO2, O3, SO2 (CO deliberately excluded).

## How they were trained

- Inputs: the station's own hourly observation history (OpenAQ/CPCB archive) plus
  Open-Meteo CAMS-AQ and HRES fields (pressure-level soundings, boundary-layer height,
  winds), built by the same `StationFeatureSpace` used at serving time.
- Horizon features 1..168 (7 days); hyperparameters via rolling-origin HPO; a CAMS
  blend is kept only where holdout scoring favoured it (`meta.json: blend_used`).
- 10–90% uncertainty bands calibrated on rolling short windows
  (`rolling_shortwindow_conformal_v5`), with measured holdout coverage in `meta.json`.

## Measured holdout performance (real sensors)

LightGBM fleet, **120-day holdout window 2026-05-19 → 2026-09-16**, deployed-model
protocol, scored per (station, pollutant) on that station's own merged frame.
Medians across the 45 stations (38 with SO2), concentrations in µg/m³ — identical
numbers to `station_models/metrics_summary.json` in the code repo:

| Pollutant | MAE (median) | RMSE (median) | R² (median) | 1–6 h MAE (median) |
|---|---|---|---|---|
| PM2.5 | 17.6 | 23.0 | 0.11 | 15.0 |
| PM10  | 48.7 | 74.7 | 0.30 | 42.1 |
| NO2   | 9.1  | 23.0 | 0.29 | 7.3 |
| O3    | 11.0 | 13.8 | 0.34 | 9.2 |
| SO2   | 3.9  | 15.5 | 0.05 | 3.1 |

Chronos-2 LoRA (CPCB-trained candidate): evaluated on 33 (station, pollutant) pairs
under the same aligned holdout protocol; the production LightGBM fleet won every
evaluated slice, so zero pairs were promoted (see the repo's
`station_models_chronos2/CHRONOS2_VERDICT.md`).

## Intended use / limits

- Served at `/api/v1/forecast/station-168hr` with live OpenAQ history and
  Open-Meteo covariates fetched per request; hours beyond the verified CAMS lead
  time run on an explicit climatology fallback and are labelled as such.
- Trained on Delhi NCR CPCB stations; not validated for other regions.
- These are statistical station models — the AirLens physics engine is a separate
  component and has no withheld-data backtest.
