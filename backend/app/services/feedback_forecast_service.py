"""API orchestration for the deterministic Delhi NCR two-way feedback forecast."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.physics.box_model import FeedbackMetHour, simulate_feedback_72h
from app.services.consensus_service import collect_consensus

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude=28.6139&longitude=77.2090"
    "&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,shortwave_radiation"
    "&forecast_days=3&timezone=auto"
)


def _fallback_met() -> list[FeedbackMetHour]:
    """Deterministic presentation-safe meteorology when Open-Meteo is unavailable."""
    series: list[FeedbackMetHour] = []
    for hour in range(72):
        local = hour % 24
        daylight = 7 <= local <= 17
        series.append(
            FeedbackMetHour(
                temperature_c=27.0 if daylight else 12.0,
                wind_speed_kmh=4.0 if not daylight else 11.0,
                wind_direction_deg=315.0 if hour % 36 < 18 else 180.0,
                shortwave_w_m2=550.0 if daylight else 0.0,
            )
        )
    return series


async def _fetch_met() -> list[FeedbackMetHour]:
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(OPEN_METEO_URL)
            response.raise_for_status()
            hourly = response.json().get("hourly", {})
            fields = [hourly.get(name, []) for name in ("temperature_2m", "wind_speed_10m", "wind_direction_10m", "shortwave_radiation")]
            if min(map(len, fields)) < 72:
                raise ValueError("Open-Meteo returned fewer than 72 hourly values")
            return [FeedbackMetHour(float(fields[0][i]), float(fields[1][i]), float(fields[2][i]), float(fields[3][i])) for i in range(72)]
    except Exception:
        return _fallback_met()


async def build_feedback_forecast() -> dict[str, Any]:
    consensus = await collect_consensus()
    base_pm25 = float(consensus.get("metrics", {}).get("pm25", 178.0))
    now = datetime.now(timezone.utc)
    met = await _fetch_met()
    start_hour = now.hour
    forecast, insights = simulate_feedback_72h(base_pm25, start_hour, met)
    return {
        "forecast_72h": forecast,
        "atmospheric_insights": insights,
    }
