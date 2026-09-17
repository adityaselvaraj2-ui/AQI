"""Merge modern-era (2022-09..2026, CAMS+HRES) and legacy-era (2015..2021, HRES-only)
CSVs into one training file per station.

Station rows: union of both eras (modern wins on overlapping hours).
Weather rows: legacy HRES fills 2015..2022-09 (CAMS columns empty), modern file
fills the rest.  The result loads directly via features.load_station_csv /
load_wx_csv — LightGBM treats the pre-CAMS NaN covariates natively.

  python merge_eras.py --modern data --legacy data_legacy --out data_merged
"""
from __future__ import annotations

import argparse
import json
import os
import re

import pandas as pd

TARGETS = ["pm25", "pm10", "no2", "o3", "so2"]


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")


def read_station(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.index = pd.DatetimeIndex(pd.to_datetime(df["hour_utc"], format="%Y-%m-%dT%H", utc=True))
    return df.drop(columns=["hour_utc"]).sort_index()


def read_wx(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    try:
        df.index = pd.DatetimeIndex(pd.to_datetime(df["hour_utc"], format="%Y-%m-%dT%H", utc=True))
    except ValueError:
        df.index = pd.DatetimeIndex(pd.to_datetime(df["hour_utc"], format="ISO8601", utc=True))
    # normalise legacy short CAMS names to the modern Open-Meteo schema so both
    # eras concat into identical columns (legacy CAMS cells are empty/NaN)
    df = df.rename(columns={"pm25": "pm2_5", "no2": "nitrogen_dioxide",
                            "o3": "ozone", "so2": "sulphur_dioxide"})
    return df.drop(columns=["hour_utc"]).sort_index()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modern", default=os.path.join(os.path.dirname(__file__), "data"))
    ap.add_argument("--legacy", default=os.path.join(os.path.dirname(__file__), "data_legacy"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "data_merged"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    report = []
    for fname in sorted(os.listdir(args.modern)):
        if not fname.startswith("station_") or not fname.endswith(".csv"):
            continue
        m = re.match(r"station_(\d+)_(.+)\.csv$", fname)
        sid, sname = int(m.group(1)), m.group(2)

        sm = read_station(os.path.join(args.modern, fname))
        legacy_path = os.path.join(args.legacy, fname)
        sl = read_station(legacy_path) if os.path.exists(legacy_path) else None
        station = pd.concat([sm, sl]) if sl is not None else sm
        station = station[~station.index.duplicated(keep="first")].sort_index()

        wm_path = os.path.join(args.modern, f"wx_{sid}.csv")
        wl_path = os.path.join(args.legacy, f"wx_{sid}.csv")
        if not os.path.exists(wm_path):
            report.append({"station_id": sid, "name": sname, "status": "no_modern_wx"})
            continue
        wm = read_wx(wm_path)
        wl = read_wx(wl_path) if os.path.exists(wl_path) else None
        wx = pd.concat([wl, wm]) if wl is not None else wm
        wx = wx[~wx.index.duplicated(keep="first")].sort_index()

        out_s = os.path.join(args.out, fname)
        out_w = os.path.join(args.out, f"wx_{sid}.csv")
        n_obs = int(station[TARGETS].notna().any(axis=1).sum())
        # integrity gate: never overwrite a good merged file with a smaller one,
        # and log every row-count check against the sources (contract §4)
        if os.path.exists(out_s):
            prev = read_station(out_s)
            prev_obs = int(prev[TARGETS].notna().any(axis=1).sum())
            if prev_obs > n_obs:
                report.append({"station_id": sid, "name": sname, "status": "skipped_regression",
                               "existing_obs_hours": prev_obs, "new_obs_hours": n_obs})
                print(f"  {sid} {sname}: SKIPPED — merged file already has {prev_obs} obs hours "
                      f"> new {n_obs} (raw sources incomplete?)", flush=True)
                continue
        station.to_csv(out_s, index_label="hour_utc", date_format="%Y-%m-%dT%H")
        wx.to_csv(out_w, index_label="hour_utc", date_format="%Y-%m-%dT%H")
        print(f"  [row-check] {fname}: {len(sm)} modern + {len(sl) if sl is not None else 0} legacy "
              f"-> {len(station)} merged (obs {n_obs})", flush=True)
        report.append({
            "station_id": sid, "name": sname, "status": "ok",
            "hours": int(len(station)),
            "obs_hours": n_obs,
            "span": f"{station.index.min()} .. {station.index.max()}",
            "legacy_hours": int(len(sl)) if sl is not None else 0,
        })
        print(f"  {sid} {sname}: {len(station)} h ({n_obs} obs) "
              f"legacy+{len(sl) if sl is not None else 0}", flush=True)

    with open(os.path.join(args.out, "merge_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    ok = [r for r in report if r.get("status") == "ok"]
    print(f"merged {len(ok)} stations -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
