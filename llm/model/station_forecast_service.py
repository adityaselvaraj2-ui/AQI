"""Per-station 72-hour pollutant forecast service.

Serves the trained per-station LightGBM models (llm/model/station_models/).
The feature space is built with the SAME StationFeatureSpace class used in
training (llm/model/training/features.py), so training and serving can never
drift apart.

Live data flow per request:
  1. station observations, last ~10 days  -> OpenAQ public S3 archive (keyless)
  2. live anchor at T0                    -> consensus snapshot (injected)
  3. CAMS + HRES hourly fields T0-48..T0+72 -> Open-Meteo forecast APIs (keyless)
  4. LightGBM (station, pollutant) x horizons 1..72 with horizon feature
  5. CPCB sub-indices via the app's own aqi_service -> AQI = max(sub-indices)

CO is deliberately excluded (per project decision): not trained, not forecast.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "station_models"))
TRAINING_DIR = os.path.abspath(os.path.join(HERE, "training"))
if TRAINING_DIR not in sys.path:
    sys.path.insert(0, TRAINING_DIR)

from features import (  # noqa: E402
    TARGETS, CAPS, StationFeatureSpace, prepare_merged, load_wx_csv, blended, horizon_band,
)

FIRE_DIR = os.path.join(TRAINING_DIR, "data", "fire")


def fetch_fire_daily(station_id: int) -> pd.DataFrame | None:
    """Local FIRMS daily fire aggregates built by training/build_fire_features.py.

    The same file the trainer used, so the fire features at serving are exactly
    the ones the model learned with (yesterday's FRP/pixel counts per ring)."""
    p = os.path.join(FIRE_DIR, f"fire_{station_id}.csv")
    if not os.path.exists(p):
        return None
    try:
        f = pd.read_csv(p, index_col="date", parse_dates=True)
        return f if len(f) else None
    except Exception:  # noqa: BLE001
        return None

BUCKET = "https://openaq-data-archive.s3.amazonaws.com"
PARAM_ALIASES = {"pm2.5": "pm25", "pm25": "pm25", "pm10": "pm10", "no2": "no2",
                 "o3": "o3", "so2": "so2"}
SPECIES_OUT = {"pm25": "PM2.5", "pm10": "PM10", "no2": "NO2", "o3": "O3", "so2": "SO2"}

WX_CACHE: dict[tuple[float, float], tuple[float, pd.DataFrame]] = {}
MODEL_CACHE: dict[str, object] = {}
_HISTORY_CACHE: dict[tuple, tuple[float, pd.DataFrame]] = {}
HISTORY_TTL_S = 1800  # archive files update daily; 30-min reuse is always fresh enough

CAMS_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
FCST_URL = "https://api.open-meteo.com/v1/forecast"
CAMS_HOURLY = "pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide"
FCST_HOURLY = ("temperature_2m,relative_humidity_2m,precipitation,cloud_cover,"
               "surface_pressure,wind_speed_10m,wind_direction_10m,wind_speed_100m,"
               "boundary_layer_height")


def _http(url: str, timeout: int = 45) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "ncr72-serving/1.0",
                                               "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _http_json(url: str, timeout: int = 45) -> dict:
    return json.loads(_http(url, timeout).decode())


# ── station history from the keyless S3 archive ─────────────────────────────

def _recent_day_keys(location_id: int, days: int) -> list[str]:
    """Deterministic daily keys for the last `days`+2 days (no existence probing —
    the S3 key layout is fixed; missing days simply 404 and are skipped)."""
    keys: list[str] = []
    d = pd.Timestamp.utcnow().tz_localize(None)
    for back in range(days + 2):
        stamp = (d - pd.Timedelta(days=back)).strftime("%Y%m%d")
        keys.append(
            f"records/csv.gz/locationid={location_id}/year={stamp[:4]}"
            f"/month={stamp[4:6]}/location-{location_id}-{stamp}.csv.gz"
        )
    return keys


def fetch_recent_history(location_id: int, days: int = 12) -> pd.DataFrame:
    """Hourly means of the last `days` days of station observations (UTC index).

    TTL-cached per (station, day-key set): the S3 archive updates daily and the
    newest file lags by hours, so a completed fetch is reused for 30 minutes.
    Cuts per-request latency from ~4.5 s (12 sequential S3 GETs) to ~1 s while
    keeping the T0 anchor live via the consensus snapshot (fetched separately,
    never cached)."""
    keys = _recent_day_keys(location_id, days)
    cache_key = (location_id, tuple(keys))
    now = time.monotonic()
    hit = _HISTORY_CACHE.get(cache_key)
    if hit and now - hit[0] < HISTORY_TTL_S:
        return hit[1].copy()
    bucket: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    def grab(key: str) -> None:
        try:
            raw = gzip.decompress(_http(f"{BUCKET}/{key}", timeout=40)).decode("utf-8", "replace")
        except Exception:
            return
        reader = csv.DictReader(io.StringIO(raw))
        # datetime is IST (+05:30); floor to the IST hour then convert to UTC so the
        # hourly labels align exactly with the UTC CAMS/HRES covariates
        from datetime import datetime, timezone, timedelta
        IST = timezone(timedelta(hours=5, minutes=30))
        for row in reader:
            pname = PARAM_ALIASES.get(str(row.get("parameter", "")).strip().lower())
            if pname is None or pname not in TARGETS:
                continue
            try:
                val = float(row.get("value") or "")
            except ValueError:
                continue
            if val <= -900:
                continue
            try:
                dt = datetime.fromisoformat(str(row.get("datetime") or ""))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=IST)
                hour = dt.replace(minute=0, second=0).astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
            except ValueError:
                continue
            if hour:
                bucket[hour][pname].append(val)

    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(grab, keys))

    rows = {}
    for hour, rec in bucket.items():
        rows[hour] = {p: float(np.mean(v)) for p, v in rec.items()}
    df = pd.DataFrame.from_dict(rows, orient="index")
    if df.empty:
        return df
    df.index = pd.DatetimeIndex(pd.to_datetime(df.index, format="%Y-%m-%dT%H", utc=True))
    df = df.sort_index()
    _HISTORY_CACHE[cache_key] = (now, df)
    return df


# ── covariates: CAMS (past+future) + HRES weather (past+future) ─────────────

def fetch_covariates(lat: float, lon: float) -> pd.DataFrame:
    """CAMS (-48h..+72h) + HRES weather (-48h..+72h) on a UTC hourly index."""
    key = (round(lat, 3), round(lon, 3))
    now = time.time()
    hit = WX_CACHE.get(key)
    if hit and now - hit[0] < 1800:
        return hit[1]

    today = pd.Timestamp.utcnow().tz_localize(None).strftime("%Y-%m-%d")
    start = (pd.Timestamp.utcnow().tz_localize(None) - pd.Timedelta(days=3)).strftime("%Y-%m-%d")
    end = (pd.Timestamp.utcnow().tz_localize(None) + pd.Timedelta(days=4)).strftime("%Y-%m-%d")
    # end_date extends +4 days so the CAMS *forecast* fields cover every target
    # hour T0+1..T0+72 (the same covariates the model trained on)
    cams = _http_json(
        f"{CAMS_URL}?latitude={lat:.4f}&longitude={lon:.4f}&hourly={CAMS_HOURLY}"
        f"&start_date={start}&end_date={end}&timezone=UTC"
    )
    fcst = _http_json(
        f"{FCST_URL}?latitude={lat:.4f}&longitude={lon:.4f}&hourly={FCST_HOURLY}"
        f"&forecast_days=4&past_days=3&timezone=UTC"
    )
    if "hourly" not in cams or "hourly" not in fcst:
        raise RuntimeError("covariate fetch failed")

    def to_df(h: dict, rename: dict[str, str] | None = None) -> pd.DataFrame:
        df = pd.DataFrame(h)
        if rename:
            df = df.rename(columns=rename)
        df["time"] = pd.to_datetime(df["time"], format="ISO8601", utc=True)
        return df.set_index("time").apply(pd.to_numeric, errors="coerce")

    rename = {"pm2_5": "cams_pm25", "pm10": "cams_pm10", "nitrogen_dioxide": "cams_no2",
              "ozone": "cams_o3", "sulphur_dioxide": "cams_so2"}
    cams_df = to_df(cams["hourly"], rename)
    fcst_df = to_df(fcst["hourly"])
    wx = cams_df.join(fcst_df, how="outer").sort_index()
    wx = wx[~wx.index.duplicated(keep="last")].sort_index()

    WX_CACHE[key] = (now, wx)
    return wx


# ── model loading ────────────────────────────────────────────────────────────

def load_station_models(station_id: int) -> dict | None:
    import lightgbm as lgb
    sdir = os.path.join(MODELS_DIR, str(station_id))
    if not os.path.isdir(sdir):
        return None
    meta_path = os.path.join(sdir, "meta.json")
    if not os.path.exists(meta_path):
        return None
    cache_key = f"{station_id}:{os.path.getmtime(meta_path)}"
    if MODEL_CACHE.get("meta_key") == cache_key:
        return MODEL_CACHE["bundle"]

    cols = json.load(open(os.path.join(sdir, "feature_columns.json")))
    bundle = {"feature_columns": cols, "models": {}, "station_id": station_id,
              "has_fire": any(str(c).startswith("fire_") for c in cols)}
    try:
        with open(meta_path, encoding="utf-8") as fh:
            bundle["meta"] = json.load(fh)
    except Exception:  # noqa: BLE001
        bundle["meta"] = {}
    for col in TARGETS:
        p = os.path.join(sdir, f"{col}.txt")
        if os.path.exists(p):
            m = lgb.Booster(model_file=p)
            bundle["models"][col] = m
    if not bundle["models"]:
        return None
    MODEL_CACHE["meta_key"] = cache_key
    MODEL_CACHE["bundle"] = bundle
    return bundle


# ── forecast assembly ────────────────────────────────────────────────────────


def build_issue_frame(bundle: dict, history: pd.DataFrame, wx: pd.DataFrame,
                      anchor: dict[str, float] | None) -> tuple[pd.DataFrame, pd.Timestamp]:
    """Feature frame for the single live issue time T0 (= current UTC hour).

    Timeline is extended to NOW: the archive's newest files can lag by hours-days,
    so the gap is filled with CAMS values plus the station's last-known CAMS offset
    (mean of the last 24 offset samples), then the live consensus anchor is placed
    at T0.  Features remain issue-anchored, identical to training.
    """
    station = history[TARGETS].copy()
    now_hour = pd.Timestamp.utcnow().tz_convert("UTC").floor("h")
    last_obs = station.index.max() if len(station) else now_hour - pd.Timedelta(hours=48)
    if now_hour > last_obs:
        gap = pd.date_range(last_obs + pd.Timedelta(hours=1), now_hour, freq="h")
        ext = pd.DataFrame(index=gap, columns=TARGETS, dtype=float)
        # CAMS as the gap prior (converted to station scale by the last known offset)
        for col in TARGETS:
            cams = wx.get(f"cams_{col}")
            if cams is not None:
                aligned = cams.reindex(gap)
                obs_last = station[col].last("48h")
                if len(obs_last) and aligned.notna().any():
                    common = obs_last.index.intersection(cams.index)
                    off = float((obs_last - cams.reindex(common)).mean()) if len(common) else 0.0
                    aligned = (aligned + off).clip(0, CAPS[col])
                    ext[col] = aligned
        station = pd.concat([station, ext]).sort_index()

    # live consensus anchor at T0 (authoritative live values)
    if anchor:
        for k, v in anchor.items():
            if k in station.columns:
                station.loc[now_hour, k] = float(v)

    merged = prepare_merged(station, wx)
    fire = fetch_fire_daily(bundle["station_id"]) if bundle.get("has_fire") else None
    space = StationFeatureSpace(merged, fire)
    t0 = now_hour
    if t0 not in space.index:
        t0 = space.index[space.index.get_indexer([t0], method="nearest")[0]]
    frames = []
    for h in range(1, 73):
        # select the issue row BY LABEL: the merged grid extends to +72h (future
        # covariates), so tail(1) would grab a future row with NaN station lags
        f = space.frame_for_horizon(h).loc[[t0]].copy()
        f.index = pd.MultiIndex.from_arrays([[t0], [h]], names=["issue_time", "horizon"])
        frames.append(f)
    X = pd.concat(frames, axis=0)
    return X, t0


def predict_station(bundle: dict, history: pd.DataFrame, wx: pd.DataFrame,
                    anchor: dict[str, float] | None) -> tuple[dict[str, pd.DataFrame], pd.Timestamp]:
    X, t0 = build_issue_frame(bundle, history, wx, anchor)
    # enforce the exact training column order (loud failure on any skew)
    X = X[bundle["feature_columns"]]
    hh = X.index.get_level_values("horizon").astype(int).to_numpy()
    Xv = X.to_numpy(dtype=np.float32)
    meta_p = (bundle.get("meta") or {}).get("pollutants") or {}
    preds = {}
    for col, model in bundle["models"].items():
        p = np.clip(model.predict(X, num_iteration=model.best_iteration if hasattr(model, "best_iteration") else None), 0, CAPS[col])
        # same blend the artifact was scored with (shared implementation in features.py);
        # applied only where training found it to be the better artifact
        blend_used = bool((meta_p.get(col) or {}).get("blend_used", True))
        if blend_used:
            try:
                p = blended(p, Xv, bundle["feature_columns"], hh, col)
            except ValueError:  # old artifact without the anchor columns
                pass
        preds[col] = pd.DataFrame({
            "horizon": X.index.get_level_values("horizon").astype(int),
            "pred": p,
        }).set_index("horizon")
    return preds, t0


def forecast_station_72hr(station_id: int, name: str, lat: float, lon: float,
                          anchor: dict[str, float] | None = None) -> dict:
    """Top-level entry: live per-station 72h forecast used by the API endpoint."""
    t_start = time.time()
    history = fetch_recent_history(station_id, days=12)
    wx = fetch_covariates(lat, lon)

    bundle = load_station_models(station_id)
    if bundle is None:
        raise FileNotFoundError(f"no trained models for station {station_id}")

    preds, t0 = predict_station(bundle, history, wx, anchor)

    # assemble per-hour outputs (t0 = the current UTC hour used as issue time)
    meta_p = (bundle.get("meta") or {}).get("pollutants") or {}
    hours_out = []
    for h in range(1, 73):
        ts = t0 + pd.Timedelta(hours=h)
        bname = horizon_band(h)
        conc, p10, p90 = {}, {}, {}
        for col, dfp in preds.items():
            v = float(dfp.loc[h, "pred"])
            conc[col] = v
            q = (meta_p.get(col) or {}).get("bands_10_90", {}).get(bname)
            if q:
                p10[col] = round(max(0.0, v + q["q10"]), 2)
                p90[col] = round(max(0.0, v + q["q90"]), 2)
        hours_out.append({
            "horizon": h,
            "timestamp": ts.isoformat(),
            "conc": conc,
            "conc_p10": p10,
            "conc_p90": p90,
        })

    return {
        "station_id": station_id,
        "station_name": name,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "t0": t0.isoformat(),
        "anchor_used": bool(anchor),
        "history_hours": int(len(history)),
        "model_hours": 72,
        "generation_ms": int((time.time() - t_start) * 1000),
        "hours": hours_out,
    }
