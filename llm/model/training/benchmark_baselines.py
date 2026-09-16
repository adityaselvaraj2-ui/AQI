"""Benchmark trained station models against trivial baselines on the SAME holdout.

For one station + pollutant, computes on the exact 120-day chronological holdout:
  - persistence:      pred(T0+h) = obs(T0)
  - 24h-persistence:  pred(T0+h) = obs(T0-24)
  - climatology:      pred(T0+h) = mean obs in the 30 days before T0, same IST hour
  - CAMS-alone:       pred(T0+h) = cams at T0+h  (raw CAMS skill ceiling)
  - model:            the fine-tuned LightGBM prediction (re-loaded from disk)

  python benchmark_baselines.py --station 6932 Alipur --pollutant pm25
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import (TARGETS, CAPS, load_station_csv, load_wx_csv, prepare_merged,  # noqa: E402
                      StationFeatureSpace)
from train import TEST_DAYS, metrics  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data_merged")
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--station", nargs=2, required=True, metavar=("ID", "NAME"))
    ap.add_argument("--pollutant", default="pm25")
    ap.add_argument("--stride", type=int, default=2)
    args = ap.parse_args()
    sid, name = int(args.station[0]), args.station[1]
    col = args.pollutant

    import re
    def slug(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")

    station = load_station_csv(os.path.join(DATA_DIR, f"station_{sid}_{slug(name)}.csv"))
    wx = load_wx_csv(os.path.join(DATA_DIR, f"wx_{sid}.csv"))
    merged = prepare_merged(station, wx)
    space = StationFeatureSpace(merged)

    horizons = list(range(1, 73, 2))
    idx = space.index[::args.stride]
    frames, ys = [], []
    for h in horizons:
        f = space.frame_for_horizon(h).iloc[::args.stride]
        frames.append(f)
        ys.append(pd.Series(space.df[col].shift(-h).values[::args.stride], index=idx))
    X = pd.concat(frames, axis=0)
    t0 = pd.DatetimeIndex(pd.concat([pd.Series(i) for i in [idx] * len(horizons)], ignore_index=True))
    hh = np.concatenate([np.full(len(idx), h, dtype=np.int16) for h in horizons])
    y = pd.concat(ys, ignore_index=True).values.astype(np.float32)
    del frames, ys

    split_ns = int(t0.max().value) - TEST_DAYS * 24 * 3600 * 10**9
    te = t0.asi8 >= split_ns
    now_idx = list(X.columns).index(f"{col}_now")
    valid = ~np.isnan(y) & ~np.isnan(X[f"{col}_now"].values)
    te = te & valid

    obs = merged[col]
    obs_ist = obs.copy()
    obs_ist.index = obs_ist.index + pd.Timedelta(hours=5, minutes=30)
    cams = merged.get(f"cams_{col}")
    t0_te = t0[te]
    h_te = hh[te]
    y_te = y[te]

    # baselines evaluated per sample
    per = pd.DataFrame({"t0": t0_te, "h": h_te, "y": y_te})
    per["t0_ns"] = per["t0"].astype("int64")
    per["tgt"] = per["t0"] + pd.to_timedelta(per["h"], unit="h")

    def series_at(times: pd.Series, s: pd.Series) -> np.ndarray:
        return s.reindex(times).values

    bench = {}
    bench["persistence"] = series_at(per["t0"], obs)
    bench["persistence24"] = series_at(per["t0"] - pd.Timedelta(hours=24), obs)
    # climatology: 30-day rolling mean by IST hour, computed on the full obs series
    ist_hour = (obs.index + pd.Timedelta(hours=5, minutes=30)).hour
    clim = pd.Series(index=obs.index, dtype=float)
    base_df = pd.DataFrame({"v": obs.values, "ih": ist_hour}, index=obs.index)
    grouped = base_df.groupby("ih")["v"]
    roll = grouped.transform(lambda s: s.rolling(30, min_periods=7).mean())
    clim = pd.Series(roll.values, index=obs.index)
    bench["climatology"] = series_at(per["t0"], clim)
    if cams is not None:
        bench["cams_alone"] = series_at(per["tgt"], cams)

    # model
    import lightgbm as lgb
    mdir = os.path.join(MODELS_DIR, str(sid))
    model = lgb.Booster(model_file=os.path.join(mdir, f"{col}.txt"))
    cols = json.load(open(os.path.join(mdir, "feature_columns.json")))
    Xs = X[cols]
    pred = np.clip(model.predict(Xs, num_iteration=None), 0, CAPS[col])[te]

    y_true = per["y"].values
    print(f"\n=== {name} ({sid}) {col.upper()} — {TEST_DAYS}-day holdout, {len(y_true)} samples ===")
    print(f"{'benchmark':<14}{'MSE':>10}{'RMSE':>9}{'MAE':>9}{'R2':>9}{'bias':>8}")
    for label, p in list(bench.items()):
        p = np.asarray(p, dtype=float)
        ok = ~np.isnan(p)
        m = metrics(y_true[ok], p[ok])
        print(f"{label:<14}{m['mse']:>10.1f}{m['rmse']:>9.2f}{m['mae']:>9.2f}{m['r2']:>9.3f}{m['bias']:>8.2f}")
    m = metrics(y_true, pred)
    print(f"{'MODEL':<14}{m['mse']:>10.1f}{m['rmse']:>9.2f}{m['mae']:>9.2f}{m['r2']:>9.3f}{m['bias']:>8.2f}")

    # short-horizon slice (the forecast users see first)
    short = per["h"] <= 6
    print(f"\n-- short horizons (+1h..+6h), n={int(short.sum())} --")
    for label, p in list(bench.items()):
        p = np.asarray(p, dtype=float)[short.values]
        ok = ~np.isnan(p)
        if ok.sum() < 100:
            continue
        m = metrics(y_true[short.values][ok], p[ok])
        print(f"{label:<14}{m['mse']:>10.1f}{m['rmse']:>9.2f}{m['mae']:>9.2f}{m['r2']:>9.3f}{m['bias']:>8.2f}")
    p = pred[short.values]
    m = metrics(y_true[short.values], p)
    print(f"{'MODEL':<14}{m['mse']:>10.1f}{m['rmse']:>9.2f}{m['mae']:>9.2f}{m['r2']:>9.3f}{m['bias']:>8.2f}")


if __name__ == "__main__":
    main()
