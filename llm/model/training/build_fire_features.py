"""Build per-station daily fire features from the cached FIRMS VIIRS archive.

Input : data/firms_cache/chunk_*.csv           (from fetch_firms.py)
        ../../station_models/registry.json     (station lat/lon)
        data/wx_{sid}.csv                      (hourly wind for upwind weighting)
Output: data/fire/fire_{sid}.csv               one row per station per UTC day:
          frp50 n50 frp100 n100 frp200 n200    total FRP (MW) & pixel count within radius (km)
          frpup100 nup100 frpup200 nup200      upwind-weighted (cos^2 sector weight against
                                               the station's prevailing wind that day)

Upwind definition: a fire at bearing θ (from station, 0=N) is upwind when θ ≈
wind_direction (meteorological "from" bearing); weight = max(0, cos(θ−wind))².
Fires counted are vegetation fires only (type==0).  All days 2015-01-01..today.

  python build_fire_features.py
"""
from __future__ import annotations

import glob
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json, ensure_disk_free  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "firms_cache")
OUT_DIR = os.path.join(HERE, "data", "fire")
REGISTRY = os.path.abspath(os.path.join(HERE, "..", "station_models", "registry.json"))

KM_PER_DEG_LAT = 110.574
RINGS = (50.0, 100.0, 200.0)


def load_registry_stations() -> list[dict]:
    reg = json_load(REGISTRY)
    stations = reg.get("stations", reg if isinstance(reg, list) else [])
    out = []
    for st in stations:
        if st.get("lat") is None or st.get("lon") is None:
            continue
        out.append({"sid": int(st["openaq_id"]), "name": st.get("registry_name", str(st["openaq_id"])),
                    "lat": float(st["lat"]), "lon": float(st["lon"])})
    return out


def json_load(path: str):
    import json
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def slug(name: str) -> str:
    import re
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")


def daily_wind_bearing(sid: int, name: str) -> pd.Series:
    """Per-UTC-date prevailing wind 'from'-bearing (radians) from hourly wind_direction_10m.

    Prefers the merged (both-era) station file so legacy-era fires get upwind
    weights too; falls back to the modern-era wx file.
    """
    candidates = [
        os.path.join(HERE, "data_merged", f"wx_{sid}.csv"),   # both-era weather (wind lives here)
        os.path.join(HERE, "data", f"wx_{sid}.csv"),           # modern-only fallback
    ]
    wx_path = next((p for p in candidates if os.path.exists(p)), None)
    if wx_path is None:
        return pd.Series(dtype=np.float64)
    wx = pd.read_csv(wx_path, usecols=lambda c: c in ("hour_utc", "wind_direction_10m"))
    if "wind_direction_10m" not in wx.columns:
        return pd.Series(dtype=np.float64)   # no wind on file -> upwind weights stay 0
    # merged CSVs store hour_utc as the *index*; plain wx files keep it as a column
    if "hour_utc" in wx.columns:
        idx = pd.DatetimeIndex(pd.to_datetime(wx["hour_utc"], format="ISO8601", utc=True))
    elif isinstance(wx.index, pd.DatetimeIndex):
        idx = wx.index
    else:
        return pd.Series(dtype=np.float64)
    wd = pd.to_numeric(wx["wind_direction_10m"], errors="coerce").to_numpy()
    rad = np.deg2rad(wd)
    s = pd.DataFrame({"sin": np.sin(rad), "cos": np.cos(rad)}, index=idx).resample("D").mean()
    ok = s["sin"].notna() & s["cos"].notna()
    return np.arctan2(s["sin"][ok], s["cos"][ok])


def main() -> None:
    ensure_disk_free(HERE, need_gb=0.5)
    files = sorted(glob.glob(os.path.join(CACHE, "chunk_*.csv")))
    if not files:
        sys.exit("no FIRMS chunks cached — run fetch_firms.py first")
    stations = load_registry_stations()
    print(f"{len(files)} FIRMS chunks, {len(stations)} stations", flush=True)

    usecols = ["latitude", "longitude", "acq_date", "frp", "type"]
    frames = []
    for i, f in enumerate(files):
        try:
            df = pd.read_csv(f, usecols=usecols)
        except ValueError:  # a chunk with only the header has no frp col? handle robustly
            df = pd.read_csv(f)
            for c in usecols:
                if c not in df.columns:
                    df[c] = np.nan
        frames.append(df[df["type"] == 0][["latitude", "longitude", "acq_date", "frp"]])
    fires = pd.concat(frames, ignore_index=True)
    fires["acq_date"] = pd.to_datetime(fires["acq_date"], format="%Y-%m-%d", utc=True)
    fires["frp"] = pd.to_numeric(fires["frp"], errors="coerce").fillna(0.0)
    fires = fires.dropna(subset=["latitude", "longitude"])
    print(f"vegetation-fire pixels: {len(fires):,} ({fires['acq_date'].min().date()} .. "
          f"{fires['acq_date'].max().date()})", flush=True)
    del frames

    os.makedirs(OUT_DIR, exist_ok=True)
    lat_p = np.deg2rad(fires["latitude"].to_numpy())
    lon_p = np.deg2rad(fires["longitude"].to_numpy())
    frp_p = fires["frp"].to_numpy()
    date_p = fires["acq_date"].to_numpy()
    all_dates = pd.date_range(fires["acq_date"].min(), fires["acq_date"].max(), freq="D", tz="UTC")

    report = []
    for st in stations:
        lat0, lon0 = np.deg2rad(st["lat"]), np.deg2rad(st["lon"])  # match pixel radians
        # Distances in km: pixel and station lat/lon are in RADIANS, so convert
        # rad->deg (57.2958) before scaling by km-per-degree. (Earlier draft used
        # rad deltas directly with the degree constant — all distances were 57x
        # too small and every ring mask came back empty.)
        KM_PER_RAD_LAT = KM_PER_DEG_LAT * 57.29577951308232
        dy = (lat_p - lat0) * KM_PER_RAD_LAT
        dx = (lon_p - lon0) * (KM_PER_RAD_LAT * np.cos(lat0))
        r = np.sqrt(dx * dx + dy * dy)
        bearing = np.arctan2(dx, dy)                      # 0=N, clockwise-positive
        wb = daily_wind_bearing(st["sid"], st["name"])

        rows = {d: {} for d in all_dates}
        dates_idx = pd.DatetimeIndex(date_p)
        wcos2 = None
        if len(wb):
            wd_map = pd.Series(wb.values, index=wb.index)
            wday = wd_map.reindex(dates_idx).to_numpy()    # per-pixel day wind bearing
            with np.errstate(invalid="ignore"):
                wcos2 = np.clip(np.cos(bearing - wday), 0, None) ** 2

        out = pd.DataFrame(index=all_dates)
        for R in RINGS:
            m = r <= R
            g = pd.DataFrame({"frp": np.where(m, frp_p, 0.0), "n": m.astype(np.float32)},
                             index=dates_idx).resample("D").sum()
            out[f"frp{int(R)}"] = g["frp"]
            out[f"n{int(R)}"] = g["n"]
        for R in (100.0, 200.0):
            m = (r <= R) & (wcos2 > 0 if wcos2 is not None else r <= R)
            if wcos2 is None:
                up_frp = np.zeros(len(frp_p))
                up_n = np.zeros(len(frp_p), dtype=np.float32)
            else:
                up_frp = frp_p * wcos2 * (r <= R)
                up_n = (wcos2 * (r <= R)).astype(np.float32)
            g = pd.DataFrame({"frp": up_frp, "n": up_n}, index=dates_idx).resample("D").sum()
            out[f"frpup{int(R)}"] = g["frp"]
            out[f"nup{int(R)}"] = g["n"]

        out = out.fillna(0.0).round(2)
        out.index = out.index.strftime("%Y-%m-%d")
        out.index.name = "date"
        path = os.path.join(OUT_DIR, f"fire_{st['sid']}.csv")
        out.to_csv(path)
        peak = float(out["frp200"].max())
        report.append({"station_id": st["sid"], "name": st["name"], "file": path,
                       "days": int(len(out)), "peak_frp200": peak})
        print(f"  {st['sid']} {st['name']}: {len(out)} days, peak FRP200 {peak:.0f} MW", flush=True)

    atomic_write_json(os.path.join(OUT_DIR, "fire_summary.json"), report)
    season = fires[dates_idx.month.isin([10, 11])]
    print(f"DONE: {len(report)} stations. Stubble-season (Oct-Nov) pixel share: "
          f"{len(season)/max(len(fires),1):.0%}", flush=True)


if __name__ == "__main__":
    main()
