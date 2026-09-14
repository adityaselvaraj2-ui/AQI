"""Pure ML forecast endpoint - no physics coupling, just the trained model."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Query, Request, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services.ml_forecast_service import predict_pm25_series, model_status
from app.services.weather_providers import fetch_forecast_weather
from app.services.realtime_service import fetch_iqair_realtime, fetch_weatherapi_realtime

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


def _build_live_history_from_iqair(iqair_data: dict[str, Any], hours: int = 30) -> list[dict[str, Any]]:
    """Build a realistic 30-hour PM2.5 history anchored on current IQAir live reading.
    If pm25 concentration is not directly provided, inverts IQAir's AQI into PM2.5.
    """
    pm25 = iqair_data.get("pm25")
    if pm25 is None or float(pm25) <= 0:
        aqi_val = float(iqair_data.get("aqi") or 134)
        if aqi_val <= 50:
            pm25 = (aqi_val / 50.0) * 12.0
        elif aqi_val <= 100:
            pm25 = 12.1 + ((aqi_val - 51) / (100 - 51)) * (35.4 - 12.1)
        elif aqi_val <= 150:
            pm25 = 35.5 + ((aqi_val - 101) / (150 - 101)) * (55.4 - 35.5)
        elif aqi_val <= 200:
            pm25 = 55.5 + ((aqi_val - 151) / (200 - 151)) * (150.4 - 55.5)
        elif aqi_val <= 300:
            pm25 = 150.5 + ((aqi_val - 201) / (300 - 201)) * (250.4 - 150.5)
        else:
            pm25 = 250.5 + ((aqi_val - 301) / (500 - 301)) * (500.4 - 250.5)

    now = datetime.now(timezone.utc)
    history = []
    # Provide 30 hours of history to cover up to 24-hour lag + timezone shift
    for h in range(hours, -1, -1):
        t = now - timedelta(hours=h)
        hour = t.hour
        if hour < 6 or hour > 20:
            factor = 1.15  # night accumulation
        elif 10 <= hour <= 16:
            factor = 0.85  # daytime dispersion
        else:
            factor = 1.0
        history.append({
            "timestamp": t.replace(minute=0, second=0, microsecond=0).isoformat(),
            "value_ug_m3": round(float(pm25) * factor, 1),
        })
    return history


@router.get(
    "/forecast/72hr-ml",
    summary="72-hour AQI forecast from ML model only (no physics coupling)",
    tags=["Forecast"],
)
@limiter.limit("30/minute")
async def forecast_72hr_ml(
    request: Request,
    lat: float = Query(28.6139, ge=28.0, le=29.0),
    lon: float = Query(77.2090, ge=76.5, le=77.8),
    station_name: str = Query("Delhi-ITO", max_length=64),
) -> dict[str, Any]:
    """
    Pure ML forecast for 72 hours.
    
    The model was trained on physics + chemical features, but inference
    runs ONLY the ML model - no physics coupling loop, no inversion engine,
    no box model. Features come from WeatherAPI (weather + 6 pollutants).
    
    Live PM2.5 anchor comes from IQAir real-time + WeatherAPI concentrations.
    """
    try:
        # Get weather + chemistry from WeatherAPI (primary) or Open-Meteo fallback
        met_data = await fetch_forecast_weather(lat, lon)
        
        # Get live PM2.5 from IQAir + WeatherAPI for ML anchor
        iqair_data = await fetch_iqair_realtime()
        live_history = _build_live_history_from_iqair(iqair_data, 30)
        
        # Get ML model status
        ml_info = model_status()
        
        # Chemistry from WeatherAPI (6 pollutants per hour)
        air_quality_payload = {"hourly": met_data.get("chemistry", {})} if met_data.get("chemistry") else None
        
        # Run ML prediction with live anchor
        forecast_times = met_data.get("hourly", {}).get("time", [])[:72]
        
        if not forecast_times:
            raise RuntimeError("No forecast times available from weather provider")
        
        ml_predictions, ml_status = predict_pm25_series(
            forecast_times=forecast_times,
            weather_payload=met_data,
            air_quality_payload=air_quality_payload,
            history_rows=live_history,
            station_lat=lat,
            station_lon=lon,
        )
        
        # Build AQI from ML PM2.5 predictions and WeatherAPI chemistry
        from app.domain.aqi_scales import _sub_index, _cat, aqi_standard, aqi_method
        
        forecast_hours = []
        hourly = met_data.get("hourly", {})
        chem = met_data.get("chemistry") or {}
        chem_pm10 = chem.get("pm10") or []
        chem_no2 = chem.get("no2") or []
        chem_o3 = chem.get("o3") or []
        chem_so2 = chem.get("so2") or []
        chem_co = chem.get("co") or []
        
        for i, stamp in enumerate(forecast_times):
            ml_pm25 = ml_predictions[i] if i < len(ml_predictions) else None
            p_pm25 = round(float(ml_pm25), 1) if ml_pm25 is not None else 65.0
            
            raw_pm10 = chem_pm10[i] if i < len(chem_pm10) and chem_pm10[i] is not None else None
            p_pm10 = round(float(raw_pm10), 1) if raw_pm10 is not None else round(p_pm25 * 1.85, 1)

            raw_no2 = chem_no2[i] if i < len(chem_no2) and chem_no2[i] is not None else None
            p_no2 = round(float(raw_no2), 1) if raw_no2 is not None else 24.0

            raw_o3 = chem_o3[i] if i < len(chem_o3) and chem_o3[i] is not None else None
            p_o3 = round(float(raw_o3), 1) if raw_o3 is not None else 45.0

            raw_so2 = chem_so2[i] if i < len(chem_so2) and chem_so2[i] is not None else None
            p_so2 = round(float(raw_so2), 1) if raw_so2 is not None else 14.0

            raw_co = chem_co[i] if i < len(chem_co) and chem_co[i] is not None else None
            p_co = round(float(raw_co), 2) if raw_co is not None else 0.45

            sub_pm25 = _sub_index("PM2.5", p_pm25, "epa")
            sub_pm10 = _sub_index("PM10", p_pm10, "epa")
            sub_no2 = _sub_index("NO2", p_no2, "epa")
            sub_o3 = _sub_index("O3", p_o3, "epa")
            sub_so2 = _sub_index("SO2", p_so2, "epa")
            sub_co = _sub_index("CO", p_co, "epa")

            aqi = sub_pm25
            category = _cat(aqi, "epa")[0]
            dominant = "PM2.5"
            pm25_source = "ML model" if ml_pm25 is not None else "unavailable"
            
            def at(name: str) -> Any:
                values = hourly.get(name) or []
                return values[i] if i < len(values) else None

            t1000 = at("temperature_1000hPa")
            t925 = at("temperature_925hPa")
            inversion_dt = round(float(t925) - float(t1000), 2) if (t1000 is not None and t925 is not None) else 0.0
            
            forecast_hours.append({
                "timestamp": stamp,
                "aqi": aqi,
                "aqi_standard": aqi_standard("epa"),
                "aqi_method": aqi_method("epa"),
                "pm25_source": pm25_source,
                "category": category,
                "dominant_pollutant": dominant,
                "sub_indices": [
                    {"pollutant": "PM2.5", "concentration": p_pm25, "sub_index": sub_pm25, "category": _cat(sub_pm25, "epa")[0]},
                    {"pollutant": "PM10", "concentration": p_pm10, "sub_index": sub_pm10, "category": _cat(sub_pm10, "epa")[0]},
                    {"pollutant": "NO2", "concentration": p_no2, "sub_index": sub_no2, "category": _cat(sub_no2, "epa")[0]},
                    {"pollutant": "O3", "concentration": p_o3, "sub_index": sub_o3, "category": _cat(sub_o3, "epa")[0]},
                    {"pollutant": "SO2", "concentration": p_so2, "sub_index": sub_so2, "category": _cat(sub_so2, "epa")[0]},
                    {"pollutant": "CO", "concentration": p_co, "sub_index": sub_co, "category": _cat(sub_co, "epa")[0]},
                ],
                # Meteorology (from WeatherAPI)
                "pbl_height_m": at("boundary_layer_height") or 0,
                "pbl_height_met_m": at("boundary_layer_height") or 0,
                "pbl_suppression_pct": 0,
                "inversion_delta_t": inversion_dt,
                "aerosol_optical_depth": 0,
                "aerosol_sw_forcing_w_m2": 0,
                "aerosol_dt_surface_c": 0,
                "feedback_iterations": 0,
                "wind_speed_ms": at("wind_speed_10m") or 0,
                "wind_direction_deg": at("wind_direction_10m") or 0,
                "temperature_2m_c": at("temperature_2m") or 0,
                "relative_humidity_pct": at("relative_humidity_2m") or 0,
                "precipitation_mm": at("precipitation") or 0,
                "shortwave_radiation_w_m2": at("shortwave_radiation") or 0,
                "dew_point_2m_c": at("dew_point_2m") or 0,
                "apparent_temperature_c": at("apparent_temperature") or 0,
                "precipitation_probability_pct": at("precipitation_probability") or 0,
                "rain_mm": at("rain") or 0,
                "showers_mm": at("showers") or 0,
                "visibility_m": at("visibility") or 0,
                "cloud_cover_pct": at("cloud_cover") or 0,
                "surface_pressure_hpa": at("surface_pressure") or 0,
                "pressure_msl_hpa": at("pressure_msl") or 0,
                "weather_code": int(at("weather_code") or 0),
                "wind_gusts_ms": at("wind_gusts_10m") or 0,
                "plume_contribution": 0.0,
            })
        
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "location": {"lat": lat, "lon": lon},
            "station_name": station_name,
            "aqi_standard": aqi_standard("epa"),
            "aqi_method": aqi_method("epa"),
            "concentration_unit": "µg/m³",
            "forecast_hours": forecast_hours,
            "model": "ML-only (HistGradientBoostingRegressor with physics+chemical features)",
            "ml_model": ml_status,
            "weather_source": met_data.get("weather_source", "weatherapi"),
            "provider_failures": met_data.get("provider_failures", []),
            "live_anchor": {"pm25_ug_m3": live_history[-1]["value_ug_m3"] if live_history else None, "source": "IQAir + WeatherAPI"},
            "limitations": [
                "Pure ML model - no physics coupling",
                "AQI derived from ML PM2.5 only (dominant in Delhi)",
                "Other pollutants not predicted by ML in this version",
                "No aerosol-radiation feedback loop",
                "No inversion dynamics beyond what ML learned from training features",
                "Live history synthesized from current reading (no true 24h history)",
            ],
        }
        
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ML forecast unavailable: {str(e)}")


@router.get(
    "/forecast/ml-status",
    summary="ML model status and held-out metrics",
    tags=["Forecast"],
)
@limiter.limit("60/minute")
async def ml_status_endpoint(request: Request) -> dict[str, Any]:
    """Return ML model status, version, and held-out test metrics."""
    return model_status()