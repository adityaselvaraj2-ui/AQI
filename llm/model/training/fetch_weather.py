"""Fetch 4-year hourly CAMS air-quality + HRES weather history per station (Open-Meteo).

All timestamps stored in UTC (matching OpenAQ station CSVs). IST features are derived
later in the training pipeline. Chunked requests with retry + politeness sleep.

Usage:
  python fetch_weather.py --manifest data/discovery_manifest.json --out data/
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import time
import urllib.request
from datetime import date, timedelta

CAMS_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
HRES_URL = "https://archive-api.open-meteo.com/v1/archive"
CAMS_HOURLY = "pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide"
HRES_HOURLY = ("temperature_2m,relative_humidity_2m,precipitation,cloud_cover,"
               "surface_pressure,wind_speed_10m,wind_direction_10m,wind_speed_100m,boundary_layer_height")
START = date(2022, 9, 17)
CHUNK_DAYS = 120
RETRIES = 4


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def chunks(start: date, end: date, n: int):
    cur = start
    while cur <= end:
        yield cur, min(cur + timedelta(days=n - 1), end)
        cur += timedelta(days=n)


def get_json(url: str, params: dict) -> dict | None:
    q = "&".join(f"{k}={v}" for k, v in params.items())
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=90) as r:
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
    times = h.get("time", [])
    for i, t in enumerate(times):
        rec = out.setdefault(t, {})
        for k, vals in h.items():
            if k == "time" or i >= len(vals):
                continue
            v = vals[i]
            if v is not None:
                rec[k] = v
    return out


def fetch_station(lat: float, lon: float, out_path: str, end: date) -> dict:
    done_marker = out_path + ".done_chunks"
    done = set()
    if os.path.exists(done_marker):
        done = set(json.load(open(done_marker)))

    camso, hreso = {}, {}
    n_req = 0
    for a, b in chunks(START, end, CHUNK_DAYS):
        tag = f"{a.isoformat()}_{b.isoformat()}"
        if tag in done:
            continue
        common = dict(latitude=f"{lat:.3f}", longitude=f"{lon:.3f}", timezone="UTC",
                      start_date=a.isoformat(), end_date=b.isoformat())
        c = get_json(CAMS_URL, {**common, "hourly": CAMS_HOURLY})
        time.sleep(1.2)
        w = get_json(HRES_URL, {**common, "hourly": HRES_HOURLY})
        time.sleep(1.2)
        n_req += 2
        if c:
            camso.update(hours_to_map(c))
        if w:
            hreso.update(hours_to_map(w))
        done.add(tag)
        json.dump(sorted(done), open(done_marker, "w"))

    hours = sorted(set(camso) | set(hreso))
    if hours:
        cols_c = CAMS_HOURLY.split(",")
        cols_w = HRES_HOURLY.split(",")
        with open(out_path, "w", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(["hour_utc"] + cols_c + cols_w)
            for t in hours:
                c, w = camso.get(t, {}), hreso.get(t, {})
                wr.writerow([t] + [c.get(k, "") for k in cols_c] + [w.get(k, "") for k in cols_w])
    print(f"  [{lat},{lon}] -> {out_path} ({len(hours)} hours, {n_req} requests)", flush=True)
    return {"lat": lat, "lon": lon, "hours": len(hours), "path": out_path}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "data"))
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    m = json.load(open(args.manifest))
    stations = m.get("stations") or m.get("matched") or m
    if isinstance(stations, dict):
        stations = list(stations.values())
    norm = []
    for s in stations:
        aid = s.get("openaq_id") or s.get("archive_id")
        if aid:
            norm.append({"archive_id": int(aid), "lat": s["lat"], "lon": s["lon"]})
    stations = norm
    if args.limit:
        stations = stations[: args.limit]

    end = date.today()
    results = []
    for s in stations:
        lat, lon = s["lat"], s["lon"]
        slug = f"wx_{s['archive_id']}"
        out_path = os.path.join(args.out, f"{slug}.csv")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 50_000:
            print(f"  skip existing {out_path}", flush=True)
        else:
            results.append(fetch_station(lat, lon, out_path, end))
    json.dump(results, open(os.path.join(args.out, "weather_summary.json"), "w"), indent=2)
    print("done")


if __name__ == "__main__":
    main()
