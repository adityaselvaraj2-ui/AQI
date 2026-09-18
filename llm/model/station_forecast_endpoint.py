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

from fastapi import APIRouter, Query, Request

from app.core.rate_limit import limiter
from app.domain.species import Pollutant
from app.services.aqi_service import _aqi_category, compute_sub_indices
from llm.model.station_forecast_service import forecast_station_168hr

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
    summary="168-hour (7-day) per-station pollutant forecast from the trained module",
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
) -> dict[str, Any]:
    registry = {st.get("openaq_id"): st for st in _load_registry()}
    st = registry.get(station_id)
    if st is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"unknown station_id {station_id}")

    anchor = await _consensus_anchor() if use_anchor else None
    try:
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
    except FileNotFoundError as e:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=503,
            detail=f"station model not trained yet: {e}",
        )
    except (RuntimeError, OSError, ValueError) as e:
        from fastapi import HTTPException

        raise HTTPException(status_code=502, detail=f"forecast generation failed: {e}")
    except asyncio.TimeoutError:
        from fastapi import HTTPException

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
