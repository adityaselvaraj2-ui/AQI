"""Fetch pre-CAMS era HRES weather history (2015-01 .. 2022-09) for one station.

CAMS air-quality fields begin 2022-09; HRES meteorology goes back decades.
Station rows from the pre-CAMS era train with station lags + weather + calendar
(CAMS features left empty — LightGBM handles that natively).

  python fetch_wx_legacy.py --lat 28.65 --lon 77.32 --out data/wx_235.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import time
import urllib.request
from datetime import date, timedelta

HRES_URL = "https://archive-api.open-meteo.com/v1/archive"
HRES_HOURLY = ("temperature_2m,relative_humidity_2m,precipitation,cloud_cover,"
               "surface_pressure,wind_speed_10m,wind_direction_10m,wind_speed_100m,"
               "boundary_layer_height")
CAMS_COLS = ["pm25", "pm10", "no2", "o3", "so2"]  # written empty for the legacy era
START = date(2015, 1, 1)
LEGACY_END = date(2022, 9, 15)
CHUNK_DAYS = 200
RETRIES = 4


def chunks(start: date, end: date, n: int):
    cur = start
    while cur <= end:
        yield cur, min(cur + timedelta(days=n - 1), end)
        cur += timedelta(days=n)


def get_json(url: str, params: dict) -> dict | None:
    q = "&".join(f"{k}={v}" for k, v in params.items())
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=120) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"    retry in {wait}s ({e})", flush=True)
            time.sleep(wait)
    return None


def hours_to_map(payload: dict) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    if not payload or "hourly" not in payload:
        return out
    h = payload["hourly"]
    for i, t in enumerate(h.get("time", [])):
        rec = out.setdefault(t, {})
        for k, vals in h.items():
            if k == "time" or i >= len(vals):
                continue
            if vals[i] is not None:
                rec[k] = vals[i]
    return out


def fetch_legacy(lat: float, lon: float, out_path: str) -> int:
    done_marker = out_path + ".legacy_chunks"
    done = set()
    if os.path.exists(done_marker):
        done = set(json.load(open(done_marker)))

    hreso: dict[str, dict[str, float]] = {}
    for a, b in chunks(START, LEGACY_END, CHUNK_DAYS):
        tag = f"{a.isoformat()}_{b.isoformat()}"
        if tag in done:
            continue
        params = dict(latitude=f"{lat:.3f}", longitude=f"{lon:.3f}", timezone="UTC",
                      start_date=a.isoformat(), end_date=b.isoformat(), hourly=HRES_HOURLY)
        w = get_json(HRES_URL, params)
        time.sleep(1.0)
        if w:
            hreso.update(hours_to_map(w))
        done.add(tag)
        json.dump(sorted(done), open(done_marker, "w"))

    hours = sorted(hreso)
    if hours:
        cols_w = HRES_HOURLY.split(",")
        with open(out_path, "w", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(["hour_utc"] + CAMS_COLS + cols_w)
            for t in hours:
                w = hreso.get(t, {})
                wr.writerow([t] + [""] * len(CAMS_COLS) + [w.get(k, "") for k in cols_w])
    print(f"  [{lat},{lon}] legacy -> {out_path} ({len(hours)} hours)", flush=True)
    return len(hours)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    fetch_legacy(args.lat, args.lon, args.out)


if __name__ == "__main__":
    main()
