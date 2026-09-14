"""Periodic archive of live API data into Supabase.

A single asyncio background task wakes every SUPABASE_SYNC_INTERVAL_MINUTES,
pulls the live station network + city overview through the existing realtime
services, and upserts two tables:

  aqi_snapshots   — one row per station per cycle (time-series for ML training
                    and historical replay; this is exactly the data the
                    retraining pipeline said it was missing)
  city_overview   — the city-wide aggregate, one row per cycle

Design notes:
- Everything is best-effort: a Supabase outage logs a warning and waits for
  the next cycle; the live API is never slowed down by the archive.
- The task starts via FastAPI lifespan (main.py) so it dies with the server.
- Interval 0 (or missing service key) disables the loop entirely.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import get_settings
from app.services import supabase_service
from app.services.realtime_service import fetch_all_stations, fetch_city_overview

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None
_last_result: dict[str, Any] = {"ran": False}


def _station_rows(stations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    observed = datetime.now(timezone.utc).isoformat()
    rows = []
    for s in stations:
        pollutants = s.get("pollutants") or {}
        weather = s.get("weather") or {}
        rows.append(
            {
                "station_uid": str(s.get("uid") or ""),
                "station_name": s.get("name"),
                "observed_at": observed,
                "aqi": s.get("aqi"),
                "category": s.get("category"),
                "dominant_pollutant": s.get("dominant_pollutant"),
                "pm25": pollutants.get("PM2.5"),
                "pm10": pollutants.get("PM10"),
                "no2": pollutants.get("NO2"),
                "o3": pollutants.get("O3"),
                "so2": pollutants.get("SO2"),
                "co": pollutants.get("CO"),
                "temperature_c": weather.get("temperature"),
                "humidity_pct": weather.get("humidity"),
                "wind_speed_kmh": weather.get("wind_speed"),
                "wind_direction_deg": weather.get("wind_direction"),
                "lat": s.get("lat"),
                "lon": s.get("lon"),
            }
        )
    return rows


def _overview_row(overview: dict[str, Any]) -> dict[str, Any]:
    return {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "aqi": overview.get("aqi"),
        "category": overview.get("category"),
        "pm25": overview.get("pm25"),
        "pm10": overview.get("pm10"),
        "no2": overview.get("no2"),
        "o3": overview.get("o3"),
        "so2": overview.get("so2"),
        "co": overview.get("co"),
        "station_count": overview.get("station_count"),
    }


async def run_sync_once() -> dict[str, Any]:
    """One archive cycle. Also used by the manual /sync trigger endpoint."""
    global _last_result
    try:
        stations = await fetch_all_stations("instant")
        overview = await fetch_city_overview("instant")
        rows = _station_rows(stations)
        overview_row = _overview_row(overview)

        station_count = await supabase_service.upsert_rows(
            "aqi_snapshots", rows, on_conflict="station_uid,observed_at"
        )
        overview_count = await supabase_service.upsert_rows(
            "city_overview", [overview_row], on_conflict="observed_at"
        )
        result = {
            "ran": True,
            "stations_fetched": len(rows),
            "station_rows_upserted": station_count,
            "overview_upserted": overview_count,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        if station_count:
            logger.info("Supabase archive: %s station rows, overview=%s", station_count, overview_count)
        return result
    except Exception as exc:  # noqa: BLE001 - the archive must never kill the server
        logger.warning("Supabase archive cycle failed: %s", exc)
        _last_result = {"ran": True, "error": str(exc)}
        return _last_result
    finally:
        pass


async def _loop() -> None:
    settings = get_settings()
    interval = max(0.0, settings.supabase_sync_interval_minutes) * 60.0
    while True:
        await run_sync_once()
        await asyncio.sleep(interval)


def start_sync_task() -> None:
    """Idempotent: safe to call from lifespan startup on every boot."""
    global _task
    settings = get_settings()
    if (
        _task is None
        or _task.done()
    ) and settings.supabase_sync_interval_minutes > 0 and settings.supabase_service_role_key:
        _task = asyncio.create_task(_loop())
        logger.info(
            "Supabase archive sync started (every %s min)", settings.supabase_sync_interval_minutes
        )


def stop_sync_task() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        _task = None


def sync_status() -> dict[str, Any]:
    settings = get_settings()
    return {
        "enabled": bool(
            settings.supabase_service_role_key and settings.supabase_sync_interval_minutes > 0
        ),
        "interval_minutes": settings.supabase_sync_interval_minutes,
        "last": _last_result,
    }
