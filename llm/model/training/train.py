"""Train one LightGBM model per (station, pollutant) on 4 years of hourly data.

Design (leakage-free, horizon-conditioned):
  - every training sample = (issue_time T0, horizon h in 1..72); target = observation at T0+h
  - features use ONLY data available at T0 (station memory, CAMS level, weather analysis)
    plus CAMS/HRES fields AT the target hour (legitimately available as +72h forecasts)
  - `horizon` is itself a feature, so one model per (station, pollutant) serves all 72 hours
  - chronological split: train = issues before the last TEST_DAYS days; test = last TEST_DAYS
  - holdout metrics MSE/RMSE/MAE/R2/bias, overall and per horizon

Usage:
  python train.py --station 235 Anand_Vihar
  python train.py --all [--stride 2]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import (  # noqa: E402
    TARGETS,
    build_issue_features,
    load_station_csv,
    load_wx_csv,
    prepare_merged,
)

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))

PARAMS = {
    "objective": "regression",
    "metric": "l2",
    "learning_rate": 0.05,
    "num_leaves": 64,
    "min_data_in_leaf": 100,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbosity": -1,
    "num_threads": 8,
}
TEST_DAYS = 120
EARLY_STOP_ROUNDS = 120
MAX_ROUNDS = 2000
MIN_TEST_ROWS = 3000
HORIZONS = list(range(1, 73))
CAPS = {"pm25": 1500, "pm10": 2000, "no2": 400, "o3": 400, "so2": 500}


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    err = y_pred - y_true
    mse = float(np.mean(err**2))
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    return {
        "n": int(len(y_true)),
        "mse": round(mse, 3),
        "rmse": round(float(np.sqrt(mse)), 3),
        "mae": round(float(np.mean(np.abs(err))), 3),
        "r2": round(float(r2), 4),
        "bias": round(float(np.mean(err)), 3),
    }


def build_dataset(space, horizons: list[int], stride: int = 1):
    """Assemble (T0, h) samples; optionally thin issue times by `stride` to save RAM."""
    frames, idxs = [], []
    ys = {col: [] for col in TARGETS}
    idx = space.index[::stride]
    for h in horizons:
        f = space.frame_for_horizon(h).iloc[::stride]
        f.index = idx
        frames.append(f)
        idxs.append(pd.MultiIndex.from_arrays(
            [idx, np.full(len(idx), h, dtype=np.int16)],
            names=["issue_time", "horizon"],
        ))
        for col in TARGETS:
            ys[col].append(pd.Series(space.df[col].shift(-h).values[::stride], index=idx))

    X = pd.concat(frames, axis=0)
    del frames
    index = pd.MultiIndex.from_arrays(
        [np.concatenate([i.get_level_values(0) for i in idxs]),
         np.concatenate([i.get_level_values(1) for i in idxs])],
        names=["issue_time", "horizon"],
    )
    del idxs
    X.index = index
    y = {col: pd.concat(v).set_axis(index) for col, v in ys.items()}
    return X, y


def train_station(station_id: int, name: str, data_dir: str,
                  test_days: int = TEST_DAYS, stride: int = 1) -> dict:
    s_path = os.path.join(data_dir, f"station_{station_id}_{name}.csv")
    w_path = os.path.join(data_dir, f"wx_{station_id}.csv")
    if not os.path.exists(s_path):
        return {"station_id": station_id, "name": name, "status": "no_station_data"}
    if not os.path.exists(w_path):
        return {"station_id": station_id, "name": name, "status": "no_wx_data"}

    merged = prepare_merged(load_station_csv(s_path), load_wx_csv(w_path))
    space = build_issue_features(merged)
    X, y_all = build_dataset(space, HORIZONS, stride=stride)
    del space, merged

    issues = X.index.get_level_values("issue_time")
    last_issue = issues.max()
    split_time = last_issue - pd.Timedelta(days=test_days)
    test_mask = issues >= split_time
    complete = X.notna().all(axis=1)

    out_dir = os.path.join(MODELS_DIR, str(station_id))
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "feature_columns.json"), "w") as f:
        json.dump(list(X.columns), f)

    result: dict = {"station_id": station_id, "name": name, "status": "ok", "pollutants": {}}
    trained_any = False

    for col in TARGETS:
        y = y_all[col]
        valid = complete & y.notna()
        tr_sel = valid & ~test_mask
        te_sel = valid & test_mask

        if tr_sel.sum() < 5000 or te_sel.sum() < MIN_TEST_ROWS:
            result["pollutants"][col] = {
                "status": "insufficient_data",
                "n_train": int(tr_sel.sum()),
                "n_test": int(te_sel.sum()),
            }
            continue

        X_tr, y_tr = X[tr_sel], y[tr_sel]
        X_te, y_te = X[te_sel], y[te_sel]

        # season-stratified early stopping: validate on the SAME calendar months as the
        # test window, taken from the previous year, so ES data distribution ≈ test
        tr_issues = X_tr.index.get_level_values("issue_time").unique().sort_values()
        te_month = pd.Timestamp(split_time).month
        es_candidate = tr_issues[tr_issues < pd.Timestamp(split_time) - pd.Timedelta(days=30)]
        es_pool = es_candidate[es_candidate.month == te_month]
        if len(es_pool) < 24 * 30:
            es_pool = es_candidate
        n_es = max(48, int(0.10 * len(es_candidate)))
        es_set = set(es_pool[-n_es:]) if len(es_pool) >= n_es else set(es_pool)
        es_mask = X_tr.index.get_level_values("issue_time").isin(es_set)

        dtrain = lgb.Dataset(X_tr[~es_mask], label=y_tr[~es_mask])
        dval = lgb.Dataset(X_tr[es_mask], label=y_tr[es_mask], reference=dtrain)
        model = lgb.train(
            PARAMS,
            dtrain,
            num_boost_round=MAX_ROUNDS,
            valid_sets=[dval],
            callbacks=[lgb.early_stopping(EARLY_STOP_ROUNDS, verbose=False)],
        )
        best_iter = int(model.best_iteration or MAX_ROUNDS)

        te_h = X_te.index.get_level_values("horizon")
        pred = np.clip(model.predict(X_te, num_iteration=best_iter), 0, CAPS[col])

        # overall + per-horizon metrics on the holdout
        overall = metrics(y_te.values, pred)
        per_h: dict[str, dict] = {}
        for h in HORIZONS:
            m = te_h == h
            if m.sum() >= 50:
                per_h[str(h)] = metrics(y_te[m].values, pred[m])
        marks = {h: per_h[h] for h in ("1", "6", "12", "24", "48", "72") if h in per_h}

        model.save_model(os.path.join(out_dir, f"{col}.txt"))
        result["pollutants"][col] = {
            "overall": overall,
            "marks": {h: {k: v[k] for k in ("rmse", "mae", "r2", "bias")} for h, v in marks.items()},
            "best_iteration": best_iter,
        }
        trained_any = True
        print(f"    [{station_id} {name}] {col}: RMSE {overall['rmse']} | MAE {overall['mae']} | "
              f"R2 {overall['r2']} | bias {overall['bias']} (n={overall['n']}, iters={best_iter})", flush=True)

    del X, y_all

    meta = {
        "station_id": station_id,
        "name": name,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "test_days": test_days,
        "split_time": str(split_time),
        "horizons": HORIZONS,
        "stride": stride,
        "pollutants": result["pollutants"],
    }
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    if not trained_any:
        result["status"] = "insufficient_data"
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--station", nargs=2, metavar=("ID", "NAME"))
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--test-days", type=int, default=TEST_DAYS)
    ap.add_argument("--stride", type=int, default=1, help="thin issue times by this factor to save RAM")
    ap.add_argument("--data-dir", default=os.path.join(HERE, "data"))
    args = ap.parse_args()

    os.makedirs(MODELS_DIR, exist_ok=True)

    if args.all:
        import glob
        import re
        rows = []
        for s_path in sorted(glob.glob(os.path.join(args.data_dir, "station_*.csv"))):
            m = re.match(r"station_(\d+)_(.+)\.csv$", os.path.basename(s_path))
            if not m:
                continue
            sid, sname = int(m.group(1)), m.group(2)
            if not os.path.exists(os.path.join(args.data_dir, f"wx_{sid}.csv")):
                print(f"skip {sid} {sname}: no wx", flush=True)
                continue
            print(f"=== training {sid} {sname} ===", flush=True)
            rows.append(train_station(sid, sname, args.data_dir, args.test_days, args.stride))
            with open(os.path.join(MODELS_DIR, "metrics_summary.json"), "w") as f:
                json.dump(rows, f, indent=2)
        print("summary -> metrics_summary.json", flush=True)
    elif args.station:
        sid, sname = int(args.station[0]), args.station[1]
        res = train_station(sid, sname, args.data_dir, args.test_days, args.stride)
        print(json.dumps(res, indent=2))
    else:
        ap.error("need --station ID NAME or --all")


if __name__ == "__main__":
    main()
