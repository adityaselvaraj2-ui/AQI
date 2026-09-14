"""Runtime inference for trained PM2.5 forecasts (chemical regime enhanced).

Loads chemical regime model (primary) or legacy PM2.5 model (fallback).
At inference, builds chemical features from WeatherAPI per-hour chemistry
when available, otherwise uses CAMS PM2.5 proxy.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from app.services.ml_features import FEATURE_NAMES, build_pm25_features, history_features

_CHEMICAL_MODEL_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "pm25_chemical_regime.joblib"
_LEGACY_MODEL_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "pm25_hist_gradient_boosting.joblib"
_IST = timezone(timedelta(hours=5, minutes=30))

# Chemical regime feature names (9 features)
CHEMICAL_FEATURE_NAMES = [
    "no2_o3_ratio", "oxidation_capacity", "pm_formation_potential", "co_no2_ratio",
    "is_rush_hour", "is_nocturnal", "is_morning_transition", "is_evening_transition",
    "cams_change",
]

FULL_FEATURE_NAMES = FEATURE_NAMES + CHEMICAL_FEATURE_NAMES


def _local_hour(value: str | datetime) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(_IST).replace(tzinfo=None)
    return parsed.replace(minute=0, second=0, microsecond=0)


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


@lru_cache(maxsize=1)
def _load_bundle() -> tuple[Any, dict[str, Any], bool] | None:
    """Load model artifact. Returns (model, metadata, is_chemical).
    
    Tries chemical regime model first, falls back to legacy.
    """
    for path, is_chem in [(_CHEMICAL_MODEL_PATH, True), (_LEGACY_MODEL_PATH, False)]:
        if not path.is_file():
            continue
        try:
            bundle = joblib.load(path)
            model = bundle["model"]
            metadata = bundle["metadata"]
            expected = FULL_FEATURE_NAMES if is_chem else FEATURE_NAMES
            if metadata.get("feature_names") != expected:
                raise ValueError(f"packaged model feature schema mismatch: expected {expected}")
            return model, metadata, is_chem
        except (OSError, KeyError, TypeError, ValueError, AttributeError):
            continue
    return None


def _build_chemical_regime_features(
    weather: dict[str, Any],
    cams_pm25: float,
    cams_origin_pm25: float,
    target_time: datetime,
    air_chem: dict[str, float] | None = None,
) -> list[float]:
    """Build chemical regime features.
    
    At inference: air_chem comes from WeatherAPI per-hour chemistry (6 pollutants).
    Falls back to CAMS PM2.5 proxy if WeatherAPI chemistry unavailable.
    """
    temp = weather.get("temperature_2m", 25.0)
    rh = weather.get("relative_humidity_2m", 50.0)
    solar = weather.get("shortwave_radiation", 200.0)
    pbl = weather.get("boundary_layer_height", 500.0)
    wind = weather.get("wind_speed_10m", 2.0)
    
    # Use WeatherAPI chemistry if available, else CAMS proxy
    if air_chem:
        pm25_proxy = air_chem.get("pm2_5", cams_pm25)
        no2_proxy = air_chem.get("no2", 20.0 + pm25_proxy * 0.3)
        o3_proxy = air_chem.get("o3", 40.0 + solar * 0.05 - pm25_proxy * 0.1)
        co_proxy = air_chem.get("co", 500.0 + pm25_proxy * 10.0)
    else:
        pm25_proxy = cams_pm25
        no2_proxy = 20.0 + pm25_proxy * 0.3
        o3_proxy = 40.0 + solar * 0.05 - pm25_proxy * 0.1
        co_proxy = 500.0 + pm25_proxy * 10.0
    
    # Chemical regime indicators
    no2_o3_ratio = no2_proxy / max(o3_proxy, 1.0)
    oxidation_capacity = o3_proxy * solar / 1000.0
    pm_formation_potential = (no2_proxy + co_proxy / 100.0) * rh / 100.0 * (1000.0 / pbl)
    co_no2_ratio = co_proxy / max(no2_proxy, 1.0)
    
    # Diurnal regime
    hour = target_time.hour
    is_rush_hour = 1.0 if hour in (7, 8, 9, 18, 19, 20) else 0.0
    is_nocturnal = 1.0 if hour < 6 or hour > 22 else 0.0
    is_morning_transition = 1.0 if hour in (5, 6, 7, 8) else 0.0
    is_evening_transition = 1.0 if hour in (17, 18, 19, 20) else 0.0
    
    # CAMS trend
    cams_change = cams_pm25 - cams_origin_pm25
    
    return [
        no2_o3_ratio, oxidation_capacity, pm_formation_potential, co_no2_ratio,
        is_rush_hour, is_nocturnal, is_morning_transition, is_evening_transition,
        cams_change,
    ]


def model_status() -> dict[str, Any]:
    bundle = _load_bundle()
    if bundle is None:
        return {"available": False, "model": "physics-only", "mode": "none"}
    _model, metadata, is_chem = bundle
    return {
        "available": True,
        "model": metadata.get("model_type", "trained PM2.5 model"),
        "version": metadata.get("model_version"),
        "target": metadata.get("target", "future station PM2.5"),
        "target_unit": metadata.get("target_unit", "µg/m³"),
        "held_out_rmse_pm25_ug_m3": (metadata.get("held_out_test") or {}).get("rmse"),
        "held_out_rmse_aqi": (metadata.get("held_out_test_aqi") or {}).get("rmse"),
        "validation": "chronological held-out diagnostic; not a guarantee",
        "mode": "chemical_regime" if is_chem else "legacy_pm25",
    }


def predict_pm25_series(
    *,
    forecast_times: list[str],
    weather_payload: dict[str, Any],
    air_quality_payload: dict[str, Any] | None,
    history_rows: list[dict[str, Any]] | None,
    station_lat: float,
    station_lon: float,
) -> tuple[list[float | None], dict[str, Any]]:
    """Predict each live forecast hour from current station history.
    
    Uses chemical regime features when WeatherAPI per-hour chemistry is available.
    """
    status = model_status()
    if not status["available"] or not forecast_times or not history_rows:
        return [None] * len(forecast_times), {**status, "used": False, "reason": "missing model or live history"}

    bundle = _load_bundle()
    assert bundle is not None
    model, metadata, is_chemical = bundle

    history: dict[datetime, float] = {}
    for row in history_rows:
        stamp = row.get("timestamp")
        value = _finite(row.get("value_ug_m3", row.get("pm25_ug_m3", row.get("value"))))
        if stamp is not None and value is not None and value >= 0:
            history[_local_hour(str(stamp))] = value

    forecast_origin = _local_hour(forecast_times[0])
    eligible_origins = [stamp for stamp in history if stamp <= forecast_origin]
    if not eligible_origins:
        return [None] * len(forecast_times), {**status, "used": False, "reason": "no current live PM2.5 anchor"}
    observation_origin = max(eligible_origins)
    if forecast_origin - observation_origin > timedelta(hours=3):
        return [None] * len(forecast_times), {**status, "used": False, "reason": "live PM2.5 anchor is stale"}
    recent = [history.get(observation_origin - timedelta(hours=lag)) for lag in range(25)]
    history_summary = history_features(recent)

    weather = weather_payload.get("hourly") or {}
    air = (air_quality_payload or {}).get("hourly") or {}
    
    # Extract WeatherAPI per-hour chemistry (if available)
    air_chem_by_hour: list[dict[str, float]] = []
    if air and "pm2_5" in air and "no2" in air:
        # WeatherAPI format: chemistry dict with per-hour arrays
        n = len(air.get("pm2_5", []))
        for i in range(n):
            chem = {}
            for pol in ["pm2_5", "pm10", "no2", "o3", "so2", "co"]:
                vals = air.get(pol, [])
                chem[pol] = _finite(vals[i]) if i < len(vals) else None
            air_chem_by_hour.append(chem)
    
    # CAMS PM2.5 fallback
    cams_origin = _finite((air.get("pm2_5") or [None])[0]) if air else None
    if cams_origin is None:
        return [None] * len(forecast_times), {**status, "used": False, "reason": "missing live air-quality forecast"}

    predictions: list[float | None] = []
    origin_index = forecast_origin

    for index, stamp in enumerate(forecast_times):
        target = _local_hour(stamp)
        def at(name: str) -> Any:
            values = weather.get(name) or []
            return values[index] if index < len(values) else None

        cams_values = air.get("pm2_5") or []
        cams_target = _finite(cams_values[index] if index < len(cams_values) else None)
        if cams_target is None:
            predictions.append(None)
            continue
        
        weather_row = {
            "temperature_2m": at("temperature_2m"),
            "relative_humidity_2m": at("relative_humidity_2m"),
            "precipitation": at("precipitation"),
            "boundary_layer_height": at("boundary_layer_height"),
            "shortwave_radiation": at("shortwave_radiation"),
            "wind_speed_10m": at("wind_speed_10m"),
            "wind_direction_10m": at("wind_direction_10m"),
            "temperature_1000hPa": at("temperature_1000hPa"),
            "temperature_925hPa": at("temperature_925hPa"),
        }
        
        # Base PM2.5 features
        base = build_pm25_features(
            station_lat=station_lat,
            station_lon=station_lon,
            lead_hours=max(1, round((target - observation_origin).total_seconds() / 3600.0)),
            target_time=target,
            history=history_summary,
            cams_pm25=cams_target,
            cams_origin_pm25=cams_origin,
            weather=weather_row,
        )
        
        # Chemical regime features (WeatherAPI chemistry or CAMS proxy)
        air_chem = air_chem_by_hour[index] if index < len(air_chem_by_hour) else None
        chem = _build_chemical_regime_features(
            weather_row, cams_target, cams_origin, target, air_chem
        )
        
        features = base + chem if is_chemical else base
        features = [value if math.isfinite(value) else float("nan") for value in features]
        
        try:
            prediction = float(model.predict(np.asarray([features], dtype=np.float32))[0])
        except (ValueError, TypeError):
            prediction = float("nan")
        predictions.append(round(min(max(prediction, 0.0), 1000.0), 2) if math.isfinite(prediction) else None)

    used = sum(value is not None for value in predictions)
    return predictions, {
        **status,
        "used": used > 0,
        "hours_used": used,
        "forecast_origin": origin_index.isoformat(),
        "observation_origin": observation_origin.isoformat(),
        "chemistry_source": "weatherapi" if air_chem_by_hour else "cams_proxy",
    }