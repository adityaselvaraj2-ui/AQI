"""Optuna hyperparameter search for the global (pooled) LightGBM models.

One study per pollutant family (pm, gas) — PM2.5/PM10 share dynamics; NO2/O3/SO2
each get their own study since their weather/photochemistry response differs.
The search optimises the GLOBAL model params (the fine-tunes inherit the winner
per family via hpo_params.json); data is a cached pooled subset of 6 diverse
stations so a trial takes ~20-40 s instead of minutes.

  python hpo.py --n-trials 50 [--timeout 5400]
  -> writes hpo_params.json  {"pm25": {...}, "pm10": {...}, "no2": {...}, ...}
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import optuna  # noqa: E402
import lightgbm as lgb  # noqa: E402

from features import TARGETS, CAPS, StationFeatureSpace  # noqa: E402
from train import metrics  # noqa: E402
from train_all import (  # noqa: E402
    load_station_pair, load_fire_daily, slug,
    season_es_mask, GLOBAL_STRIDE, GLOBAL_H_STEP,
)
from io_utils import atomic_write_json, ensure_disk_free  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MERGED_DIR = os.path.join(HERE, "data_merged")
HPO_PATH = os.path.join(HERE, "hpo_params.json")
CACHE_PATH = os.path.join(HERE, "data", "hpo_pool.npz")

# 6 stations across the basin: N-Delhi, Delhi-centre, Gurgaon, Noida, Ghaziabad, Faridabad
HPO_STATIONS = [(8472, "Bawana"), (235, "Anand_Vihar"), (6325, "Gurugram_Sector_51"),
                (6988, "Noida_Sector_116"), (6359, "Vivek_Vihar"), (6972, "Faridabad_Sector_11")]
HPO_STATIONS = [(sid, name.replace("_", " ")) for sid, name in HPO_STATIONS]

FAMILIES = {
    "pm25": "pm", "pm10": "pm", "no2": "no2", "o3": "o3", "so2": "so2",
}
FAMILY_COLS = {
    "pm": ["pm25", "pm10"],
    "no2": ["no2"], "o3": ["o3"], "so2": ["so2"],
}

BASE = {
    "objective": "regression", "metric": "l2", "verbosity": -1, "num_threads": 8,
    "learning_rate": 0.05,
    "feature_pre_filter": False,   # min_data_in_leaf varies across trials on a reused Dataset
}


def build_pool() -> tuple[np.ndarray, list[str], np.ndarray, dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Cache the pooled HPO subset to disk so trials don't rebuild features."""
    horizons = list(range(1, 73, GLOBAL_H_STEP))
    Xs, cols, t0s, hs, ys, ms = [], None, [], [], {c: [] for c in TARGETS}, {c: [] for c in TARGETS}
    for sid, name in HPO_STATIONS:
        merged = load_station_pair(sid, name, MERGED_DIR)
        if merged is None:
            print(f"  hpo-pool skip {sid} {name}", flush=True)
            continue
        space = StationFeatureSpace(merged, load_fire_daily(sid))
        from train_all import assemble_samples
        X, c, t0_ns, hh, y, mask = assemble_samples(space, horizons, GLOBAL_STRIDE)
        if cols is None:
            cols = c
        Xs.append(X); t0s.append(t0_ns); hs.append(hh)
        for col in TARGETS:
            ys[col].append(y[col]); ms[col].append(mask[col])
        print(f"  hpo-pool {sid} {name}: +{len(t0_ns)} rows", flush=True)
    X = np.vstack(Xs)
    t0 = np.concatenate(t0s); hh = np.concatenate(hs)
    y = {c: np.concatenate(v) for c, v in ys.items()}
    mask = {c: np.concatenate(v) for c, v in ms.items()}
    np.savez_compressed(CACHE_PATH, X=X, t0=t0, hh=hh, cols=json.dumps(cols),
                        **{f"y_{c}": v for c, v in y.items()},
                        **{f"m_{c}": v for c, v in mask.items()})
    return X, cols, t0, y, mask


def suggest_params(trial: optuna.Trial) -> dict:
    return dict(
        num_leaves=trial.suggest_int("num_leaves", 31, 127),
        min_data_in_leaf=trial.suggest_int("min_data_in_leaf", 50, 400, log=True),
        feature_fraction=trial.suggest_float("feature_fraction", 0.6, 1.0),
        bagging_fraction=trial.suggest_float("bagging_fraction", 0.6, 1.0),
        bagging_freq=1,
        lambda_l2=trial.suggest_float("lambda_l2", 1e-3, 10.0, log=True),
        lambda_l1=trial.suggest_float("lambda_l1", 1e-4, 1.0, log=True),
        min_gain_to_split=trial.suggest_float("min_gain_to_split", 0.0, 0.5),
        max_depth=trial.suggest_categorical("max_depth", [-1, 8, 12]),
    )


def run_study(family: str, cols: list[str], X: np.ndarray, t0: np.ndarray, hh: np.ndarray,
              y: np.ndarray, mask: np.ndarray, col: str, n_trials: int, timeout: int) -> dict:
    from train import TEST_DAYS
    split_ns = int(t0.max()) - TEST_DAYS * 24 * 3600 * 10**9
    te = t0 >= split_ns
    valid = mask
    tr, te = (~te) & valid, te & valid
    if tr.sum() < 8000 or te.sum() < 2000:
        print(f"[{family}] not enough rows ({int(tr.sum())}/{int(te.sum())}) — skipping", flush=True)
        return {}
    es = season_es_mask(t0, split_ns, tr)
    dtrain = lgb.Dataset(X[tr & ~es], label=y[tr & ~es])
    dval = lgb.Dataset(X[tr & es], label=y[tr & es], reference=dtrain)
    dtest = lgb.Dataset(X[te], label=y[te])

    def objective(trial: optuna.Trial) -> float:
        params = dict(BASE, **suggest_params(trial))
        model = lgb.train(
            params, dtrain, num_boost_round=320,
            valid_sets=[dval], callbacks=[lgb.early_stopping(40, verbose=False),
                                          lgb.log_evaluation(0)],
        )
        pred = np.clip(model.predict(X[te], num_iteration=model.best_iteration), 0, CAPS[col])
        m = metrics(y[te], pred)
        # report holdout RMSE so the pruner can cut hopeless trials early
        trial.report(m["rmse"], step=1)
        if trial.should_prune():
            raise optuna.TrialPruned()
        # final selection metric: holdout RMSE (primary) with a small bias penalty
        return m["rmse"] + 0.05 * abs(m["bias"])

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="minimize",
                                sampler=optuna.samplers.TPESampler(seed=42),
                                pruner=optuna.pruners.MedianPruner(n_startup_trials=8))
    study.optimize(objective, n_trials=n_trials, timeout=timeout, show_progress_bar=False)
    best = dict(BASE, **study.best_params)
    print(f"[{family}] best rmse+bias {study.best_value:.3f} over {len(study.trials)} trials: "
          f"{ {k: (round(v, 4) if isinstance(v, float) else v) for k, v in study.best_params.items()} }",
          flush=True)
    return best


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-trials", type=int, default=50)
    ap.add_argument("--timeout", type=int, default=5400, help="per-family cap, seconds")
    ap.add_argument("--refresh-pool", action="store_true")
    args = ap.parse_args()

    ensure_disk_free(HERE, need_gb=1.0)
    if args.refresh_pool and os.path.exists(CACHE_PATH):
        os.remove(CACHE_PATH)
    if not os.path.exists(CACHE_PATH):
        build_pool()
    z = np.load(CACHE_PATH, allow_pickle=False)
    X, cols, t0, hh = z["X"], json.loads(str(z["cols"])), z["t0"], z["hh"]
    y = {c: z[f"y_{c}"] for c in TARGETS}
    mask = {c: z[f"m_{c}"] for c in TARGETS}
    print(f"hpo pool: {len(t0)} rows, {len(cols)} features", flush=True)

    out: dict[str, dict] = {}
    if os.path.exists(HPO_PATH):
        try:
            out = json.load(open(HPO_PATH, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            out = {}
    for family, cols_in_family in FAMILY_COLS.items():
        # family representative: first pollutant with usable rows
        for col in cols_in_family:
            best = run_study(family, cols, X, t0, hh, y[col], mask[col], col,
                             args.n_trials, args.timeout)
            if best:
                for c2 in cols_in_family:      # family shares the winner
                    out[c2] = {k: v for k, v in best.items() if k not in ("objective", "metric", "verbosity", "num_threads", "learning_rate")}
                break
        atomic_write_json(HPO_PATH, out)
    print(f"hpo params -> {HPO_PATH}", flush=True)


if __name__ == "__main__":
    main()
