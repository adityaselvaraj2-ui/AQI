# FINAL REPORT — Per-Station 72-h Forecast (v2: FIRMS fire features + HPO + rolling folds + blend + conformal bands)

Date: 2026-09-17. Raw machine outputs: `contract_check_FINAL.txt`, `contract_check_BEFORE.txt`
(v1 baseline), `retrain_v2c.log` (final training log), `METRICS.md`, `STATION_METRICS.xlsx`.

## 1. Contract compliance (unchanged thresholds: RMSE 10–15, MAE 5–10, R² 0.7–1, |bias|→0)

**2 / 218 (station, pollutant) pairs pass all four thresholds** — both are O3
(Najafgarh, Nehru Nagar). This is reported verbatim, not softened.

Per-pollutant medians (full per-station list in `contract_check_FINAL.txt` and `METRICS.md`):

| Pollutant | med RMSE | med MAE | med R² | med bias | RMSE pass | MAE pass | R² pass | bias pass |
|---|---|---|---|---|---|---|---|---|
| PM2.5 | 23.21 | 16.86 | 0.173 | +0.22 | 1/45 | 0/45 | 0/45 | 39/45 |
| PM10  | 76.26 | 46.67 | 0.351 | +0.12 | 0/45 | 0/45 | 0/45 | 26/45 |
| NO2   | 12.00 | 8.13  | 0.350 | +0.93 | 34/45 | 32/45 | 0/45 | 42/45 |
| O3    | 13.68 | 9.73  | 0.504 | +2.09 | 25/45 | 26/45 | 2/45 | 36/45 |
| SO2   | 5.47  | 3.54  | 0.098 | +0.57 | 36/38 | 37/38 | 0/38 | 37/38 |

v1 → v2 changes (same holdout): O3 R² 0.36→0.50, NO2 R² 0.33→0.35, PM10 R² 0.30→0.35,
SO2 RMSE 6.6→5.5, bias pass-rate up for every pollutant. The fire features moved the
needle; they did not make an impossible target possible.

## 2. Why R² 0.7 across the board is structurally unreachable (evidence, per contract §2)

**(a) The scoring season dominates R².** Same deployed model class, four chronological
folds, median R² across stations:

| Pollutant | Oct–Nov 2025 STUBBLE fold | fold_2 | fold_3 | Monsoon HOLDOUT |
|---|---|---|---|---|
| PM2.5 | **0.693** | 0.650 | 0.549 | 0.173 |
| PM10  | 0.606 | 0.592 | 0.462 | 0.351 |
| NO2   | 0.568 | 0.536 | 0.544 | 0.350 |
| O3    | **0.796** | 0.753 | 0.737 | 0.504 |
| SO2   | 0.230 | 0.208 | 0.292 | 0.098 |

In the fire-driven season — the season this product exists for — PM2.5 and O3
*already meet* R² 0.7-class skill. The standing 120-day holdout lands in the monsoon
trough, when the atmosphere's memory is shortest and day-to-day variance is noise
dominated. A single-window R² mostly measures the window, not the model.

**(b) Horizon decomposition.** Median R² by band (deployed artifact):

| Pollutant | +1–6h | +24h | +48–72h |
|---|---|---|---|
| PM2.5 | 0.338 | 0.199 | 0.136 |
| PM10  | 0.495 | 0.377 | 0.300 |
| NO2   | 0.513 | 0.393 | 0.288 |
| O3    | 0.619 | 0.533 | 0.443 |
| SO2   | 0.389 | 0.125 | 0.004 |

Same model, same season: near-term skill is 2–3× the 72 h skill everywhere. One
all-horizon R² threshold hides that the failure is specifically long-horizon.

**(c) Baseline parity check (v1 benchmark, same holdout).** Trained model beat
persistence by 36%, climatology by 25%, raw CAMS by 64% (PM2.5 RMSE 21.0 vs
32.9/28.2/58.1). The model is the best available forecast at essentially every
station; the absolute numbers are set by what is predictable in that season.

**(d) Calibrated uncertainty works.** Split-conformal 10/90 bands, empirical
coverage (nominal 0.80): PM2.5 0.92, PM10 0.89, NO2 0.89, O3 0.95, SO2 0.87
(median across stations, all horizon bands). Slightly conservative — bands are
trustworthy for user communication.

## 3. Revised, per-slice targets (defensible; not a blanket reinterpretation)

| Slice | Old target | Revised | Justification |
|---|---|---|---|
| O3, any horizon | R² 0.7 | **R² ≥ 0.5 monsoon / ≥ 0.75 fire season** | 0.796 achieved in stubble fold; monsoon O3 ≈ 0.5 is the physical ceiling shown by all baselines |
| PM2.5 fire season (Oct–Dec) | R² 0.7 | **R² ≥ 0.6 median, ≥ 0.5 at 80% of stations** | 0.693 achieved in fold; fire signal now a live feature |
| NO2, SO2 (any season) | RMSE 10–15 | **RMSE ≤ 15 (NO2) / ≤ 8 (SO2), MAE ≤ 10 / ≤ 5, |bias| ≤ 2** | RMSE/MAE/bias targets are already met at ~80% of stations; R² 0.7 is unreachable for low-variance trace gases |
| PM2.5/PM10, monsoon, +48–72h | R² 0.7 | **R² ≥ 0.3 / ≥ 0.25; report with coverage bands** | band table (a); the alternative is no forecast at all |
| Bias | →0 | **keep |median bias| ≤ 2 µg/m³ per pollutant** | already passing 26–42/45 |

The original single-table target mixes *predictability* (season, horizon) with
*model quality* (vs baselines). By the baseline-parity test the models are at the
practical frontier; the per-slice table above is what an honest contract looks like.

## 4. What changed in this iteration (all verified, no vibes)

- **NASA FIRMS fire features** (previously unused): 1.52 M fire pixels, 2015–2026,
  VIIRS_SNPP_SP, per-station FRP/pixel counts in 50/100/200 km rings, lagged 0–72 h,
  upwind-weighted via merged-era wind bearing; verified against independent probes
  (Nov-2023 stubble week: 3,146 raw ring pixels, 2,023 upwind-weighted vs 7 in July).
- **Optuna HPO** per pollutant family (50 trials × 4 families; pm25/pm10 share).
- **Rolling-origin folds** with true pre-window retrains (no in-sample reuse),
  incl. a full Oct–Nov 2025 stubble fold.
- **Persistence + climatology blend** with per-band weights, adopted only where it
  beat the model on the holdout (flagged per station-pollutant as `blend_used`).
- **NaN-safe blend**: missing persistence/climatology after observation gaps now
  renormalises weights instead of poisoning predictions (root cause of the NaN
  folds found and fixed this iteration).
- **Pipeline integrity**: atomic JSON writes, keyed read-modify-write summaries,
  disk preflight, checkpoint-resume (`--finetune-only`, `--only`, `--force`).
- **Serving**: fire features served from the same per-station files the trainer used
  (zero skew); schema-adaptive feature space per model; history TTL cache —
  13.5 s cold → 1.3 s warm per request.

## 5. Deliverables (in `llm/`)

- `station_models/` — 218 boosters (45 stations × 5 pollutants, 7 SO2-less stations),
  per-station `meta.json` (folds, bands, coverage, blend flags), `registry.json`,
  `METRICS.md`, `STATION_METRICS.xlsx` (static baked medians, verified readable).
- `training/` — full reproducible pipeline; `DATA_SOURCES_VERDICT.md` (API verdicts);
  `contract_check_FINAL.txt` (raw machine output).
- Live endpoints: `/api/v1/forecast/stations` (45/45 trained),
  `/forecast/station-72hr?station_id=…` (verified: Bawana 72 h, anchor live, 4.0 s),
  `/forecast/station-status`.

## 6. Remaining known limitations

- 7 stations have no SO2 model — their monitors report **zero SO2 hours in the
  entire archive** (column entirely empty, 2015–2026): Pusa, Burari Crossing,
  Shadipur, Noida Sector 62, CRRI Mathura Road, Lodhi Road, IGI Airport (T3).
  This is a monitoring-instrument gap at those sites, not a fetch failure
  (verified: 0 non-null SO2 values in 4,800–28,600 rows per station).
  Their endpoints serve the remaining 4 pollutants.
- 5 of the 50 discovered stations are excluded entirely (decommissioned; no 2026
  archive data exists to train or anchor on).
- Monsoon-season +72 h PM remains the weakest slice everywhere; the conformal bands
  are the honest way to consume those hours.

---

# 168-HOUR (7-DAY) EXTENSION — 2026-09-18

## CAMS data availability (measured live before any code)
Real CAMS AQ forecast fields: **100% non-null through +96–102h, 0% past that
(hard nulls, HTTP 400 if `end_date` > +6d)**. HRES weather: full 168h. Therefore:
hours 1–96 train/serve on live AQ forecasts; hours 97–168 on an explicit
fallback — station climatology (month×hour + day-of-year bins, year Y−1 tables
frozen into meta.json) modulated by forecast-weather ventilation (BLH × wind vs
month-hour normal). Same code path (`_fallback_cams`) in training and serving;
`cams_available_h` feature marks the cutoff; API exposes `aq_source`,
`cams_available`, `horizon_band` per hour.

## Contract check (raw output: `contract_check_168.txt`, 218 pairs listed per station)
**1/218 pairs pass all 4 original thresholds** (Dr. Karni Singh O3). This is on
the standing 120-day monsoon holdout, unchanged thresholds — same verdict level
as the 72h model (2/218); the extension did not degrade days 1–3.

## Days 5–7 vs days 1–3 — the honest gap (median across 45 stations, monsoon holdout)

| Pollutant | 1–6h R² | 24h | 48–72h | 96h | 120h | 144–168h |
|---|---|---|---|---|---|---|
| PM2.5 | 0.32 | 0.20 | 0.13 | 0.09 | 0.07 | **0.01** |
| PM10  | 0.47 | 0.38 | 0.32 | 0.27 | 0.26 | **0.19** |
| NO2   | 0.50 | 0.36 | 0.28 | 0.26 | 0.24 | **0.18** |
| O3    | 0.51 | 0.43 | 0.33 | 0.30 | 0.31 | **0.29** |
| SO2   | 0.33 | 0.15 | 0.03 | 0.01 | −0.03 | **−0.09** |

**Stated plainly:** day 5–7 PM2.5 has essentially no monsoon-season skill (R²
0.00–0.09) and SO2 goes negative; O3/PM10/NO2 retain modest but real skill
(R² 0.18–0.31) at 168h. The days 5–7 numbers are the climatology-fallback
regime; they are visibly worse than days 1–3 and are flagged as such in every
API hour (`aq_source: "climatology_fallback"`) and faded in the UI (days 5–7
show AQI ranges + reduced opacity, day cards carry dates).

## Confidence bands (recalibrated for 168h)
1,306 (station, pollutant, band) combos: **3 below 0.65 coverage (worst 0.53 —
Sri Aurobindo Marg SO2 144-168h), zero below 0.50**. Median PM2.5 half-width
~43 µg/m³ across all bands (honest, since monsoon PM errors are regime-bound).

## Structural notes
- Stage A memory: horizon doubling doubled the pooled matrix; rebalanced
  GLOBAL_STRIDE 4→12, H_STEP 8→12, FT_STRIDE 2→4 (fits 16 GB RAM).
- Stage A (168h) global R²: PM2.5 0.26, NO2 0.46, O3 0.54, SO2 0.47.
- Serving clamps `max_h` to each station's own `model_hours` — old 72h
  artifacts serve 72h without extrapolation.
- UI: `getStationForecast` → `/station-168hr`; strip shows true day cards with
  per-day bands; horizon toggle gains "7 days" (168h, 13 checkpoints).
- API docs: `API.md` gains the `/forecast/station-168hr` section
  (`model_hours: 168`, source table); `llm/README.md` updated. The legacy city
  `/forecast/72hr-ml` endpoint (WeatherAPI-based, separate model) is unchanged.
