"""Shared PM2.5 feature contract for offline training and live inference."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

FEATURE_NAMES = [
    "station_lat",
    "station_lon",
    "lead_hours",
    "current_pm25",
    "lag1_pm25",
    "lag3_pm25",
    "lag6_pm25",
    "lag12_pm25",
    "lag24_pm25",
    "mean6_pm25",
    "mean24_pm25",
    "std24_pm25",
    "trend3_pm25",
    "cams_pm25",
    "cams_origin_pm25",
    "cams_change_pm25",
    "nudged_cams_12h",
    "nudged_cams_24h",
    "nudged_cams_48h",
    "temperature_2m_c",
    "relative_humidity_pct",
    "precipitation_mm",
    "pbl_height_m",
    "shortwave_radiation_w_m2",
    "wind_speed_ms",
    "wind_direction_sin",
    "wind_direction_cos",
    "inversion_delta_t_c",
    "ventilation_m2_s",
    "target_hour_sin",
    "target_hour_cos",
    "target_year_sin",
    "target_year_cos",
]


def _value(mapping: dict[str, Any], key: str) -> float:
    try:
        value = float(mapping.get(key))
    except (TypeError, ValueError):
        return float("nan")
    return value if math.isfinite(value) else float("nan")


def build_pm25_features(
    *,
    station_lat: float,
    station_lon: float,
    lead_hours: int,
    target_time: datetime,
    history: dict[str, float],
    cams_pm25: float,
    cams_origin_pm25: float,
    weather: dict[str, Any],
) -> list[float]:
    """Build one feature row in `FEATURE_NAMES` order."""
    current = _value(history, "current_pm25")
    cams_target = float(cams_pm25)
    cams_origin = float(cams_origin_pm25)
    wind_speed = _value(weather, "wind_speed_10m")
    wind_direction = math.radians(_value(weather, "wind_direction_10m"))
    pbl = _value(weather, "boundary_layer_height")
    t1000 = _value(weather, "temperature_1000hPa")
    t925 = _value(weather, "temperature_925hPa")
    hour_angle = 2.0 * math.pi * target_time.hour / 24.0
    year_angle = 2.0 * math.pi * (target_time.timetuple().tm_yday - 1) / 365.25

    features = {
        "station_lat": float(station_lat),
        "station_lon": float(station_lon),
        "lead_hours": float(lead_hours),
        "current_pm25": current,
        "lag1_pm25": _value(history, "lag1_pm25"),
        "lag3_pm25": _value(history, "lag3_pm25"),
        "lag6_pm25": _value(history, "lag6_pm25"),
        "lag12_pm25": _value(history, "lag12_pm25"),
        "lag24_pm25": _value(history, "lag24_pm25"),
        "mean6_pm25": _value(history, "mean6_pm25"),
        "mean24_pm25": _value(history, "mean24_pm25"),
        "std24_pm25": _value(history, "std24_pm25"),
        "trend3_pm25": _value(history, "trend3_pm25"),
        "cams_pm25": cams_target,
        "cams_origin_pm25": cams_origin,
        "cams_change_pm25": cams_target - cams_origin,
        "nudged_cams_12h": cams_target + (current - cams_origin) * math.exp(-lead_hours / 12.0),
        "nudged_cams_24h": cams_target + (current - cams_origin) * math.exp(-lead_hours / 24.0),
        "nudged_cams_48h": cams_target + (current - cams_origin) * math.exp(-lead_hours / 48.0),
        "temperature_2m_c": _value(weather, "temperature_2m"),
        "relative_humidity_pct": _value(weather, "relative_humidity_2m"),
        "precipitation_mm": _value(weather, "precipitation"),
        "pbl_height_m": pbl,
        "shortwave_radiation_w_m2": _value(weather, "shortwave_radiation"),
        "wind_speed_ms": wind_speed,
        "wind_direction_sin": math.sin(wind_direction),
        "wind_direction_cos": math.cos(wind_direction),
        "inversion_delta_t_c": t925 - t1000,
        "ventilation_m2_s": wind_speed * pbl,
        "target_hour_sin": math.sin(hour_angle),
        "target_hour_cos": math.cos(hour_angle),
        "target_year_sin": math.sin(year_angle),
        "target_year_cos": math.cos(year_angle),
    }
    return [features[name] for name in FEATURE_NAMES]


def history_features(values: list[float | None]) -> dict[str, float]:
    """Summarize newest-first hourly PM2.5 values for live inference."""
    clean = [
        float(value)
        if value is not None and math.isfinite(float(value)) and float(value) >= 0
        else float("nan")
        for value in values
    ]
    if not clean or not math.isfinite(clean[0]):
        return {}

    def at(hours: int) -> float:
        return clean[hours] if hours < len(clean) else float("nan")

    recent6 = [value for value in clean[:6] if math.isfinite(value)]
    recent24 = [value for value in clean[:24] if math.isfinite(value)]
    mean6 = sum(recent6) / len(recent6)
    mean24 = sum(recent24) / len(recent24)
    variance24 = sum((value - mean24) ** 2 for value in recent24) / len(recent24)
    return {
        "current_pm25": clean[0],
        "lag1_pm25": at(1),
        "lag3_pm25": at(3),
        "lag6_pm25": at(6),
        "lag12_pm25": at(12),
        "lag24_pm25": at(24),
        "mean6_pm25": mean6,
        "mean24_pm25": mean24,
        "std24_pm25": math.sqrt(variance24),
        "trend3_pm25": clean[0] - at(3) if math.isfinite(at(3)) else float("nan"),
    }
