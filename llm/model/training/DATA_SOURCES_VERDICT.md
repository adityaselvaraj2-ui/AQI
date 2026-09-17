# External Data Sources — Verdict (per contract §1, item 2)

Date: 2026-09-16. Every claim below was verified against the live APIs on this
date; raw probe outputs are quoted. The verdict applies to BOTH training
features and live serving.

## Verdict table

| Source | Used? | Why |
|---|---|---|
| OpenAQ public S3 archive (keyless) | **YES — backbone** | The only source with per-station hourly CPCB history (2015–2026 for most of the 45 stations). No commercial free tier offers multi-year per-station hourly history. Training cannot exist without it. |
| Open-Meteo CAMS air-quality (keyless) | **YES** | Only keyless gridded hourly AQ reanalysis+forecast reaching back to 2022-09; provides the target-hour covariates and station-offset correction features. |
| Open-Meteo HRES weather (keyless) | **YES** | Only keyless hourly meteorology covering the whole 2015–2026 window (wind for upwind weighting, BLH, T/RH/P for dispersion). |
| NASA FIRMS VIIRS_SNPP_SP (MAP key) | **YES — newly integrated this round** | The Oct–Dec NCR PM driver that was completely unused before. 856 archive chunks fetched (2015→today); ring + upwind FRP/count features added. |
| IQAir AirVisual (`IQAIR_API_KEY`) | **NO** | Probe: `{"status":"fail","data":{"message":"permission_denied (you don't have access to this endpoint"}}` — the free `nearest_station` endpoint is denied on this key, and station history is a paid tier. Adds nothing over OpenAQ even if it worked (same CPCB sources, city-modelled values, no hourly per-station archive). |
| WeatherAPI.com (`WEATHERAPI_API_KEY`) | **NO — key is DEAD** | Probe: `{"error":{"code":2006,"message":"API key is invalid."}}`. Even with a valid key, air-quality is current+forecast only (no history endpoint), so it cannot add training signal; as live redundancy it duplicates what Open-Meteo HRES + the consensus anchor already provide. |
| API Ninjas (`API_NINJAS_API_KEY`) | **NO** | Probe works: returns `{"CO":…,"NO2":…,"PM2.5":…,"overall_aqi":64}` but ONLY city-level current AQI (city="Delhi") — no station resolution, no history, no forecast horizon. Redundant with the consensus anchor. |
| Meteosource (`METEOSOURCE_API_KEY`) | **NO — key dead/unreachable** | Probe: `HTTP 000` (connection failure) on `air-quality.meteosource.com` and `404` on the alternate host. No usable endpoint to evaluate. |

## Net effect

Training + serving run entirely on **OpenAQ S3 + Open-Meteo (CAMS+HRES) +
FIRMS**. The four commercial keys add: no history (IQAir/WeatherAPI/Ninjas are
current-only on free tiers), no station resolution (Ninjas), and two of them
are currently invalid keys. If any of them later provides per-station hourly
history, the natural integration point is the consensus anchor in
`station_forecast_service.fetch_recent_history` (outage redundancy), not the
feature pipeline.

## Key handling (per contract item on keys)

- All six keys live only in `.env` (verified gitignored — `git check-ignore .env` → ignored).
- No key value appears in any committed source file (grep-audited this session).
- `FIRMS_API_KEY` in `.env` was a dead placeholder (`your-f…`) and was replaced
  with the working MAP key from the credentials you supplied, since FIRMS is
  now a load-bearing feature source.
- **You must still rotate every key you pasted into chat** (OpenAQ, FIRMS,
  WeatherAPI, API Ninjas, Meteosource, IQAir) in the respective consoles —
  anything shared in plaintext chat must be considered compromised. After
  rotation, update only `.env`.
