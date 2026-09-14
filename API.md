# API Reference — Delhi NCR Coupled AQI Forecast

Base URL: `http://localhost:8000`
Interactive docs: `http://localhost:8000/docs`

---

## Authentication

Read-only `GET` endpoints are **public** (rate-limited).
Mutation `POST` endpoints require the `X-API-Key` header:

```
X-API-Key: your-api-key-from-env
```

---

## Rate Limits

| Endpoint group | Limit |
|----------------|-------|
| `/forecast/*` | 30 req/min |
| `/inversion/*` | 30 req/min |
| `/plume/*` | 20 req/min |
| `/realtime/overview`, `/realtime/station/{uid}` | 60 req/min |
| `/realtime/stations` | 30 req/min |
| `/ingest/*` | 120 req/min (authenticated) |

Exceeded limits return `429 Too Many Requests`.

Every endpoint that depends on an upstream API (Open-Meteo, NASA FIRMS, OpenAQ)
returns **`502`** with the upstream error in `detail` when that upstream is
unavailable. Nothing falls back to synthetic data.

---

## GET `/api/v1/forecast/72hr`

72-hour hourly AQI forecast from the coupled column model.

### Query parameters

| Param | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `lat` | float | 28.6139 | 28.0–29.0 | Station latitude |
| `lon` | float | 77.2090 | 76.5–77.8 | Station longitude |
| `station_name` | string | "Delhi-ITO" | max 64 chars | Display name |
| `base_aqi` | int | *(none)* | 0–500 | Live station AQI, for anchoring hour 0 |

The endpoint also attempts to find a live OpenAQ station within ~15 km of
`lat`/`lon` and anchor hour 0 to its observed PM2.5/PM10. If OpenAQ is
unreachable this is skipped silently and the modelled hour 0 is used — a missing
anchor degrades the forecast but does not fail the request.

### Example

```bash
curl -s "http://localhost:8000/api/v1/forecast/72hr?lat=28.6289&lon=77.2432&station_name=Delhi-ITO" \
  | python -m json.tool
```

```json
{
  "generated_at": "2026-11-15T04:30:00Z",
  "location": { "lat": 28.6289, "lon": 77.2432 },
  "station_name": "Delhi-ITO",
  "forecast_hours": [
    {
      "timestamp": "2026-11-15T04:00:00+05:30",
      "aqi": 287,
      "category": "Poor",
      "dominant_pollutant": "PM2.5",
      "sub_indices": [
        { "pollutant": "PM2.5", "concentration": 112.4, "sub_index": 287, "category": "Poor" },
        { "pollutant": "PM10",  "concentration": 198.2, "sub_index": 165, "category": "Moderate" },
        { "pollutant": "NO2",   "concentration": 78.5,  "sub_index": 78,  "category": "Satisfactory" },
        { "pollutant": "O3",    "concentration": 21.4,  "sub_index": 21,  "category": "Good" },
        { "pollutant": "SO2",   "concentration": 18.0,  "sub_index": 22,  "category": "Good" },
        { "pollutant": "CO",    "concentration": 2.8,   "sub_index": 140, "category": "Moderate" }
      ],

      "pbl_height_m": 342.1,
      "inversion_delta_t": 4.2,
      "wind_speed_ms": 3.8,
      "wind_direction_deg": 315.0,

      "pbl_height_met_m": 420.5,
      "pbl_suppression_pct": 18.6,
      "aerosol_optical_depth": 0.577,
      "aerosol_sw_forcing_w_m2": -46.2,
      "aerosol_dt_surface_c": -0.92,
      "feedback_iterations": 4,

      "plume_contribution": 0.34
    }
  ]
}
```

### Field reference

**Meteorology → chemistry**

| Field | Meaning |
|---|---|
| `pbl_height_m` | Mixing depth **after** the aerosol feedback (metres) |
| `inversion_delta_t` | T(925 hPa) − T(1000 hPa) in °C; positive = inversion |
| `wind_speed_ms` | 10 m wind speed |
| `wind_direction_deg` | Meteorological convention: the direction the wind blows **from** |

**Chemistry → meteorology** — the return leg of the coupling, exposed so it is
auditable rather than buried inside the AQI number.

| Field | Meaning |
|---|---|
| `pbl_height_met_m` | Unperturbed PBL straight from the met model |
| `pbl_suppression_pct` | Percent of mixing depth removed by aerosol cooling |
| `aerosol_optical_depth` | Column AOD implied by the PM2.5 profile |
| `aerosol_sw_forcing_w_m2` | Surface shortwave removed (≤ 0). Exactly 0 at night — aerosol cannot dim a dark sky |
| `aerosol_dt_surface_c` | Surface temperature change (≤ 0) |
| `feedback_iterations` | Picard iterations to convergence (typically 1–6, cap 12) |

**`plume_contribution`** is the fraction of this hour's AQI attributable to
stubble smoke, in 0–1. It is computed by running the **entire column a second
time with the smoke removed** and differencing the resulting AQI, not by
subtracting a concentration. When there are no fire detections it is `0.0` for
every hour and the second run is skipped.

### Errors

| Code | Condition |
|------|-----------|
| `422` | Lat/lon outside the Delhi NCR bbox, or `base_aqi` out of 0–500 |
| `429` | Rate limit exceeded |
| `502` | Open-Meteo unavailable |

---

## GET `/api/v1/inversion/status`

72-hour inversion diagnostics. No parameters.

```bash
curl -s "http://localhost:8000/api/v1/inversion/status" | python -m json.tool
```

```json
[
  {
    "timestamp": "2026-11-15T04:00:00+05:30",
    "delta_t_celsius": 4.2,
    "pbl_height_m": 420.5,
    "lapse_rate_k_per_km": -5.6,
    "inversion_present": true,
    "severity": "Moderate",
    "aqi_amplification_factor": 2.853
  }
]
```

`pbl_height_m` here is the **unperturbed** met-model depth; the feedback-adjusted
depth is `pbl_height_m` on the forecast endpoint. `lapse_rate_k_per_km` is
Γ = −ΔT / 0.75 km, so a positive ΔT (inversion) gives a negative Γ.

### Severity bands

| Severity | ΔT range |
|----------|----------|
| None | < 1.5 °C |
| Weak | 1.5 – 3.5 °C |
| Moderate | 3.5 – 6.0 °C |
| Strong | > 6.0 °C |

These are classification bands from the Indian boundary-layer literature.

### On `aqi_amplification_factor`

This is `1200 m / PBL`, bounded to `[0.25, 6.0]` — a **reported diagnostic of how
compressed the mixing layer is**, nothing more. It is *not* multiplied into the
AQI. Concentrations come from the prognostic box model, which accumulates mass
under a lid rather than scaling a steady-state value.

Earlier revisions of this document tabulated a "typical AQI impact" of 1.5–4×
against these bands. That mapping was invented, and it also described an
architecture the code no longer uses. There is no fixed multiplier from ΔT to
AQI: the same ΔT produces a very different AQI depending on how long the lid has
held, what is stranded in the residual layer, and how well ventilated the city
is. That path-dependence is the whole point of the model.

---

## GET `/api/v1/plume/vectors`

Fire hotspots and their Lagrangian trajectories. No parameters.

```bash
curl -s "http://localhost:8000/api/v1/plume/vectors" | python -m json.tool
```

```json
{
  "timestamp": "2026-11-15T04:30:00Z",
  "wind_850hpa_u": 2.62,
  "wind_850hpa_v": -2.62,
  "wind_series": [[2.62, -2.62], [2.71, -2.44]],
  "hotspot_count_total": 1834,
  "hotspots": [
    {
      "lat": 30.9,
      "lon": 75.8,
      "frp_mw": 120.0,
      "source_state": "Punjab",
      "detected_at": "2026-11-15T02:00:00Z",
      "confidence": "h"
    }
  ],
  "plumes": [
    {
      "origin": { "lat": 30.9, "lon": 75.8, "frp_mw": 120.0, "source_state": "Punjab",
                  "detected_at": "2026-11-15T02:00:00Z", "confidence": "h" },
      "trajectory": [[30.9, 75.8], [30.82, 75.89], [30.74, 75.98]],
      "arrival_delhi_t_hours": 21.0,
      "pm25_contribution_ug_m3": 4.7,
      "pm25_column_ug_m2": 5640.0,
      "closest_approach_km": 12.4,
      "travel_distance_km": 281.6
    }
  ],
  "pm25_profile_ug_m3": [0.0, 0.0, 1.2, 3.8, 7.1]
}
```

### Field reference

| Field | Meaning |
|---|---|
| `wind_850hpa_u` / `_v` | Transport wind at hour 0, m/s. `u` east-positive, `v` north-positive |
| `wind_series` | Hourly (u, v) used to advect the trajectories, 72 entries |
| `hotspot_count_total` | **All** detections found. Emissions are summed over every one of them |
| `hotspots` | Detections, truncated to the largest contributors for map rendering |
| `plumes` | Per-detection trajectories, sorted by contribution, capped at 60 |
| `pm25_profile_ug_m3` | Per-hour aggregate smoke concentration in the transport layer, 72 entries. **This is what the forecast consumes** |

Per plume:

| Field | Meaning |
|---|---|
| `trajectory` | (lat, lon) waypoints at **hourly** steps |
| `arrival_delhi_t_hours` | Hours until closest approach; `null` if the plume misses Delhi |
| `pm25_column_ug_m2` | Column loading delivered over Delhi, µg/m² |
| `pm25_contribution_ug_m3` | That loading spread through the 1200 m transport layer |
| `closest_approach_km` | Minimum distance from the trajectory to Delhi |
| `travel_distance_km` | Along-trajectory path length to the closest-approach point |

### Two things worth knowing

**Concentrations are transport-layer values, not surface values.** Long-range
smoke arrives *above* Delhi's shallow nocturnal boundary layer. How much reaches
the ground depends on the mixing depth that hour, which only the forecast's box
model can resolve — it lets 40% into the mixed layer directly and delivers the
rest when the layer grows into the smoke next morning. Reading
`pm25_contribution_ug_m3` as "µg/m³ added at street level" will overstate the
night-time impact and understate the morning peak.

**An empty `hotspots` list is a real answer.** If `FIRMS_API_KEY` is unset or
FIRMS is unreachable, the list is empty. The code contains no synthetic hotspot
generator; one existed and was deleted, because fabricated detections on a map
are indistinguishable from observations to anyone reading the dashboard.

---

## GET `/api/v1/realtime/overview`

Live city-level AQI from OpenAQ.

| Param | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `instant` | `instant` or `nowcast` |

`instant` applies breakpoints to the latest hourly concentration. `nowcast`
applies the **US EPA NowCast** weighting over the recent hours, which is what
US-style dashboards display — it damps a single anomalous hour.

Note that `nowcast` mode uses EPA 2012 breakpoints while `instant` uses CPCB
2014. The two scales are not comparable: the same PM2.5 gives a materially
different number. Do not put them side by side without saying which is which.

## GET `/api/v1/realtime/stations`

All Delhi NCR monitoring stations with live AQI, lat/lon and category. Same
`mode` parameter. Paginated internally, so expect the full station list rather
than the first page.

## GET `/api/v1/realtime/station/{uid}`

Full pollutant breakdown for one station by OpenAQ location id.

---

## POST `/api/v1/ingest/observation`

Ingest a live CPCB station reading. **Requires `X-API-Key`.**

```bash
curl -s -X POST "http://localhost:8000/api/v1/ingest/observation" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "station_id": "CPCB-DL-ITO-01",
    "location": { "lat": 28.6289, "lon": 77.2432 },
    "timestamp": "2026-11-15T04:00:00+05:30",
    "pm25": 112.4, "pm10": 198.2, "no2": 78.5,
    "o3": 12.1, "so2": 18.0, "co": 2.8
  }'
```

Returns `202 Accepted`:

```json
{
  "accepted": true,
  "station_id": "CPCB-DL-ITO-01",
  "timestamp": "2026-11-15T04:00:00+05:30",
  "message": "Observation accepted for assimilation"
}
```

**`202` here does not mean stored.** There is no time-series database in this
deployment; the observation is validated and acknowledged, and persistence is
out of scope. The endpoint exists so the ingestion contract and its auth are
real, not to imply an assimilation pipeline that does not exist.

Validation is strict and rejects unknown fields:

- `location` must be inside the Delhi NCR bbox
- `pm25`, `pm10` in 0–1000 µg/m³
- `no2`, `o3`, `so2` in 0–500 µg/m³
- `co` in 0–50 mg/m³

---

## GET `/api/v1/health`

```bash
curl http://localhost:8000/api/v1/health
# {"status":"ok","timestamp":"2026-11-15T04:30:00Z"}
```

Liveness only — it does not probe upstreams, so a healthy response does not imply
Open-Meteo, FIRMS or OpenAQ are reachable.

---

## CPCB AQI Category Reference

| Category | AQI Range | Health Impact |
|----------|-----------|---------------|
| Good | 0–50 | Minimal |
| Satisfactory | 51–100 | Minor breathing discomfort for sensitive people |
| Moderate | 101–200 | Breathing discomfort on prolonged exposure |
| Poor | 201–300 | Breathing discomfort, heart disease patients affected |
| Very Poor | 301–400 | Respiratory illness on prolonged exposure |
| Severe | 401–500 | Affects healthy people, serious risk to sensitive groups |

`aqi` is capped at 500, the top of the CPCB scale. A capped value means "at least
500", not "exactly 500".
