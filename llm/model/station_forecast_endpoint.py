"""Per-station 168-hour (7-day) forecast API endpoints.

Serves the trained per-station LightGBM models (llm/model/station_models/):
  GET /api/v1/forecast/stations          -> station registry with training status
  GET /api/v1/forecast/station-168hr     -> 168h (7-day) forecast for one station
  GET /api/v1/forecast/station-72hr      -> legacy path, same 168h payload
  GET /api/v1/forecast/station-status    -> training/metrics summary (model_hours: 168)

The model concentrations are converted to CPCB sub-indices with the app's own
aqi_service, so AQI = max(sub-indices) exactly like everywhere else on the site.
A live consensus anchor (the same snapshot that feeds the Live AQI desk) is used
as the T0 observation when available.

Honesty flags per hour: hours 1..96 are backed by live CAMS AQ forecasts
(aq_source="cams_forecast"); hours 97..168 run on the explicit climatology +
weather-ventilation fallback (aq_source="climatology_fallback") because the
CAMS AQ forecast is verified only to ~+96h.  Confidence bands (conc_p10/p90,
aqi_p10/p90) widen with horizon and each hour carries its horizon_band.

The model concentrations are converted to CPCB sub-indices with the app's own
aqi_service, so AQI = max(sub-indices) exactly like everywhere else on the site.
A live consensus anchor (the same snapshot that feeds the Live AQI desk) is used
as the T0 observation when available.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import pandas as pd

from app.api.v1.auth_endpoints import require_authority

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.rate_limit import limiter
from app.domain.species import Pollutant
from app.services.aqi_service import _aqi_category, compute_sub_indices
from llm.model.station_forecast_service import (
    fetch_covariates,
    fetch_recent_history,
    forecast_station_168hr,
)

router = APIRouter()

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.path.abspath(os.path.join(HERE, "station_models", "registry.json"))

ANCHOR_TTL_S = 600
_anchor_cache: dict[str, Any] = {"at": 0.0, "metrics": None}


def _load_registry() -> list[dict[str, Any]]:
    if not os.path.exists(REGISTRY_PATH):
        return []
    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f).get("stations", [])


def _trained_station_ids() -> set[int]:
    base = os.path.join(HERE, "station_models")
    out = set()
    try:
        for entry in os.listdir(base):
            if entry.isdigit() and os.path.exists(os.path.join(base, entry, "meta.json")):
                out.add(int(entry))
    except OSError:
        pass
    return out


async def _consensus_anchor() -> dict[str, float] | None:
    """Live T0 pollutant concentrations from the consensus snapshot (cached 10 min)."""
    now = time.time()
    if now - _anchor_cache["at"] < ANCHOR_TTL_S:
        return _anchor_cache["metrics"]
    metrics: dict[str, float] | None = None
    try:
        from app.services.consensus_service import collect_consensus

        data = await asyncio.wait_for(collect_consensus(), timeout=25)
        m = (data or {}).get("metrics") or {}
        out = {}
        for key, target in (("pm25", "pm25"), ("pm10", "pm10"), ("no2", "no2"),
                            ("o3", "o3"), ("so2", "so2")):
            v = m.get(key)
            if isinstance(v, (int, float)) and v > 0:
                out[target] = float(v)
        metrics = out or None
    except Exception:
        metrics = None
    _anchor_cache["at"] = now
    _anchor_cache["metrics"] = metrics
    return metrics


def _hourly_payload(hour: dict[str, Any]) -> dict[str, Any]:
    """Convert model concentrations to CPCB sub-indices + AQI for one hour."""
    conc_map = {
        Pollutant.PM25: hour["conc"].get("pm25"),
        Pollutant.PM10: hour["conc"].get("pm10"),
        Pollutant.NO2: hour["conc"].get("no2"),
        Pollutant.O3: hour["conc"].get("o3"),
        Pollutant.SO2: hour["conc"].get("so2"),
    }
    concentrations = {p: float(v) for p, v in conc_map.items() if isinstance(v, (int, float))}
    if not concentrations:
        return {}
    subs = compute_sub_indices(concentrations, mode="instant")
    sub_list = [
        {
            "pollutant": s["pollutant"].value,
            "concentration": s["concentration"],
            "sub_index": s["sub_index"],
            "category": s["category"].value,
        }
        for s in subs
    ]
    aqi = max((s["sub_index"] for s in sub_list), default=0)
    dominant = max(sub_list, key=lambda s: s["sub_index"])["pollutant"] if sub_list else "PM2.5"
    category = _aqi_category(aqi, "instant")
    # AQI at the 10/90 band edges — widens with horizon; days 5-7 visibly less certain
    aqi_lo = _aqi_from_conc({k: v for k, v in hour.get("conc_p10", {}).items()
                             if isinstance(v, (int, float))}) if hour.get("conc_p10") else None
    aqi_hi = _aqi_from_conc({k: v for k, v in hour.get("conc_p90", {}).items()
                             if isinstance(v, (int, float))}) if hour.get("conc_p90") else None
    return {
        "horizon": hour["horizon"],
        "timestamp": hour["timestamp"],
        "aqi": aqi,
        "category": category.value if hasattr(category, "value") else str(category),
        "dominant_pollutant": dominant,
        "sub_indices": sub_list,
        # band passthrough (raw concentrations + AQI at the edges) + honesty flags
        "conc": hour.get("conc", {}),
        "conc_p10": hour.get("conc_p10", {}),
        "conc_p90": hour.get("conc_p90", {}),
        "aqi_p10": aqi_lo,
        "aqi_p90": aqi_hi,
        "aq_source": hour.get("aq_source"),
        "cams_available": hour.get("cams_available"),
        "horizon_band": hour.get("horizon_band"),
    }


@router.get(
    "/forecast/stations",
    summary="Station registry with per-station training availability",
    tags=["Forecast"],
)
@limiter.limit("60/minute")
async def list_stations(request: Request) -> dict[str, Any]:
    trained = _trained_station_ids()
    stations = []
    for st in _load_registry():
        stations.append({
            "uid": st.get("registry_uid"),
            "name": st.get("registry_name") or st.get("name"),
            "station_id": st.get("openaq_id"),
            "lat": st.get("lat"),
            "lon": st.get("lon"),
            "trained": st.get("openaq_id") in trained,
        })
    return {"stations": stations, "count": len(stations)}


_CONC_KEY_TO_POLLUTANT = {
    "pm25": Pollutant.PM25, "pm10": Pollutant.PM10, "no2": Pollutant.NO2,
    "o3": Pollutant.O3, "so2": Pollutant.SO2,
}


def _aqi_from_conc(conc_map: dict[str, float]) -> int | None:
    """CPCB AQI (max sub-index) for a raw concentration map, or None if empty."""
    if not conc_map:
        return None
    typed = {_CONC_KEY_TO_POLLUTANT[k]: float(v) for k, v in conc_map.items()
             if k in _CONC_KEY_TO_POLLUTANT and isinstance(v, (int, float))}
    if not typed:
        return None
    subs = compute_sub_indices(typed, mode="instant")
    return max((s["sub_index"] for s in subs), default=None)


@router.get(
    "/forecast/station-168hr",
    summary=("168-hour (7-day) per-station pollutant forecast — model=lightgbm "
             "(production, scored on real sensors) or model=chronos2 "
             "(CPCB-trained comparison model, LOST the head-to-head)"),
    tags=["Forecast"],
)
@router.get(
    "/forecast/station-72hr",
    summary="Legacy path — now returns the full 168-hour (7-day) forecast",
    tags=["Forecast"],
    include_in_schema=False,
)
@limiter.limit("30/minute")
async def forecast_station(
    request: Request,
    station_id: int = Query(..., description="OpenAQ archive station id"),
    use_anchor: bool = Query(True, description="Anchor T0 with the live consensus snapshot"),
    model: str = Query(
        "lightgbm", pattern="^(lightgbm|chronos2)$",
        description=("lightgbm = production fleet (primary). chronos2 = CPCB-trained "
                     "Chronos-2 comparison model kept for transparency, NOT the primary forecast."),
    ),
) -> dict[str, Any]:
    registry = {st.get("openaq_id"): st for st in _load_registry()}
    st = registry.get(station_id)
    if st is None:
        raise HTTPException(status_code=404, detail=f"unknown station_id {station_id}")

    anchor = await _consensus_anchor() if use_anchor else None
    try:
        if model == "chronos2":
            from llm.model.station_chronos2_service import (
                chronos_available, chronos_station_forecast,
            )

            if not chronos_available():
                raise HTTPException(status_code=503, detail="chronos-2 model stack not available")
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    chronos_station_forecast,
                    int(st["openaq_id"]),
                    st.get("registry_name") or st.get("name") or str(station_id),
                    float(st["lat"]),
                    float(st["lon"]),
                    anchor,
                ),
                timeout=240,
            )
        else:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    forecast_station_168hr,
                    int(st["openaq_id"]),
                    st.get("registry_name") or st.get("name") or str(station_id),
                    float(st["lat"]),
                    float(st["lon"]),
                    anchor,
                ),
                timeout=120,
            )
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=503,
            detail=f"station model not trained yet: {e}",
        )
    except (RuntimeError, OSError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"forecast generation failed: {e}")
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="forecast generation timed out")

    hours = [h for h in (_hourly_payload(x) for x in result["hours"]) if h]
    return {
        "station": {
            "uid": st.get("registry_uid"),
            "name": st.get("registry_name") or st.get("name"),
            "station_id": int(st["openaq_id"]),
            "lat": st.get("lat"),
            "lon": st.get("lon"),
        },
        # model transparency: every response says which model produced it
        "model": model,
        "model_label": (
            "Chronos-2 (CPCB-trained comparison model — LOST the head-to-head "
            "vs production LightGBM; shown for transparency)" if model == "chronos2"
            else "LightGBM per-station fleet (production — scored on real CPCB sensors)"
        ),
        "generated_at": result["generated_at"],
        "t0": result["t0"],
        "anchor_used": bool(anchor),
        "history_hours": result["history_hours"],
        "model_hours": result.get("model_hours", 168),
        "cams_max_lead_hours": result.get("cams_max_lead_hours", 96),
        "generation_ms": result["generation_ms"],
        "band_modes": result.get("band_modes"),
        "band_coverage": result.get("band_coverage"),
        "forecast_hours": hours,
    }


@router.get(
    "/forecast/station-status",
    summary="Training status and holdout metrics for the per-station module",
    tags=["Forecast"],
)
@limiter.limit("30/minute")
async def station_status(request: Request) -> dict[str, Any]:
    base = os.path.join(HERE, "station_models")
    summary_path = os.path.join(base, "metrics_summary.json")
    summary: Any = None
    if os.path.exists(summary_path):
        with open(summary_path, encoding="utf-8") as f:
            summary = json.load(f)
    return {
        "trained_stations": sorted(_trained_station_ids()),
        "registry_count": len(_load_registry()),
        "metrics_summary": summary,
    }


@router.get(
    "/forecast/chronos-status",
    summary=("Chronos-2 (CPCB-trained comparison model) availability and honest "
             "head-to-head verdict vs the production LightGBM fleet"),
    tags=["Forecast"],
)
@limiter.limit("30/minute")
async def chronos_status(request: Request) -> dict[str, Any]:
    """Public availability + the head-to-head verdict, stated plainly."""
    from llm.model.station_chronos2_service import chronos_available, chronos_headline

    return {
        "chronos2": chronos_headline(),
        "primary_model": "lightgbm",
        "note": (
            "The production forecast is the per-station LightGBM fleet. The "
            "CPCB-trained Chronos-2 candidate is served for comparison only; it "
            "lost the head-to-head against LightGBM on real-sensor holdouts. "
            "No CAMS-reanalysis-scored number is used anywhere on this site."
        ),
    }


# ── model transparency (AUTHORITY-ONLY) ─────────────────────────────────────

_TRANSPARENCY_TTL_S = 600
_transparency_cache: dict[tuple, Any] = {}


@router.get(
    "/forecast/model-transparency",
    summary=("Authority-only: real sensor reading vs our model forecast vs raw "
             "CAMS, hour by hour, clearly labeled which is which"),
    tags=["Forecast"],
)
@limiter.limit("10/minute")
async def model_transparency(
    request: Request,
    station_id: int = Query(..., description="OpenAQ archive station id"),
    authority: dict[str, Any] = Depends(require_authority),
) -> dict[str, Any]:
    """Side-by-side of the three 'truths' for the same station/hour.

    Rows are PAST hours: what the sensor actually measured (ground truth),
    what the model forecast for that hour (from the CURRENT live forecast run,
    backfilled hours where the forecast horizon did not reach), and what the
    raw CAMS regional cell said (the smooth ~40 km estimate the sensor is
    compared against). The gap between columns is exactly what the holdout
    metrics measure — this page makes it visible instead of documented.
    """
    registry = {st.get("openaq_id"): st for st in _load_registry()}
    st = registry.get(station_id)
    if st is None:
        raise HTTPException(status_code=404, detail=f"unknown station {station_id}")

    now = time.time()
    ck = ("transparency", station_id, int(now // _TRANSPARENCY_TTL_S))
    if ck in _transparency_cache:
        return _transparency_cache[ck]

    from app.services.aqi_service import compute_sub_indices as _csi

    lat, lon = float(st["lat"]), float(st["lon"])

    async def _rows() -> list[dict[str, Any]]:
        # all three series on one UTC hourly index over the shared window
        history = await asyncio.to_thread(fetch_recent_history, station_id, 5)
        wx = await asyncio.to_thread(fetch_covariates, lat, lon)
        try:
            fc = await asyncio.wait_for(
                asyncio.to_thread(forecast_station_168hr, station_id,
                                  st.get("registry_name") or st.get("name"), lat, lon),
                timeout=120)
        except Exception:
            fc = None
        if history is None or history.empty or wx is None or wx.empty:
            raise HTTPException(status_code=503, detail="sensor history or covariates unavailable")

        idx = wx.index.floor("h")
        lo = max(history.index.min(), wx.index.min())
        hi = min(history.index.max(), wx.index.max())
        hours: list[dict[str, Any]] = []
        fc_by_ts = {}
        if fc:
            t0 = pd.Timestamp(fc["t0"])
            for hr in fc.get("hours", []):
                fc_by_ts[t0 + pd.Timedelta(hours=int(hr["horizon"]))] = hr
        for ts in pd.date_range(lo.floor("h"), hi.floor("h"), freq="h"):
            if ts not in history.index:
                continue
            k = ts.strftime("%Y-%m-%dT%H")
            obs = history.loc[ts]
            sensor = {c: (float(obs[c]) if c in obs and pd.notna(obs[c]) else None)
                      for c in ("pm25", "pm10", "no2", "o3", "so2")}
            cams = {c: (float(wx.at[ts, f"cams_{c}"])
                        if f"cams_{c}" in wx.columns and pd.notna(wx.at[ts, f"cams_{c}"])
                        else None) for c in ("pm25", "pm10", "no2", "o3", "so2")}
            fh = fc_by_ts.get(ts)
            model = fh["conc"] if fh else None
            hours.append({
                "timestamp": ts.isoformat(),
                "sensor": sensor,               # REAL measured reality
                "cams_cell": cams,             # smoothed regional estimate (~40 km)
                "model_forecast": model,       # what our model said for this hour
                "model_aq_source": fh["aq_source"] if fh else None,
            })
        return hours

    try:
        rows = await _rows()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — surface precise reason, no fallback values
        raise HTTPException(status_code=502, detail=f"transparency build failed: {type(e).__name__}: {e}")
    payload = {
        "station_id": station_id,
        "station_name": st.get("registry_name") or st.get("name"),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": ("AUTHORITY ONLY. 'sensor' = real CPCB/OpenAQ measurement; "
                 "'cams_cell' = raw CAMS regional reanalysis/forecast (~40 km cell, "
                 "smoothed, not a station reading); 'model_forecast' = our trained "
                 "model's forecast for that hour (live run, where horizon covers)."),
        "rows": rows,
    }
    _transparency_cache[ck] = payload
    return payload


@router.get(
    "/forecast/safar-reference",
    summary=("IITM SAFAR operational daily forecast bulletin (government "
             "WRF-Chem reference) — reference only, never a model input"),
    tags=["Forecast"],
)
@limiter.limit("10/minute")
async def safar_reference(request: Request) -> dict[str, Any]:
    """Live per-station SAFAR daily forecast (category + AQI when published)."""
    from app.services.safar_service import fetch_safar_forecast

    try:
        return await asyncio.wait_for(fetch_safar_forecast(), timeout=20)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="SAFAR bulletin timed out")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
