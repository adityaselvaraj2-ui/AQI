"""Two-stage training: pooled global pretrain -> per-station fine-tune.

Stage A (global): pools (station, T0, h) samples from every station's full
archive history to learn the shared NCR dynamics (seasonality, diurnal cycle,
weather response, CAMS correction).  RAM-bounded via issue-time stride and
per-horizon subsampling; samples are packed as float32 numpy arrays.

Stage B (per station): each station's model CONTINUES the global model
(init_model=) on THAT STATION'S OWN full history.  init_model produces a
self-contained booster whose predict() includes the global prior — unlike
init_score, which predict() silently drops (that would poison serving).
Metrics: 120-day chronological holdout per station.

Rows are NaN-tolerant: a sample is usable when the station-memory anchor
feature (`{col}_now`) and the target exist — so the pre-CAMS era (2018–2022,
where only HRES weather + station lags + calendar exist) still trains.
LightGBM handles the remaining NaN covariates natively.

  python train_all.py --manifest data/discovery_manifest.json
  python train_all.py --global-only
  python train_all.py --finetune-only
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import (  # noqa: E402
    TARGETS,
    CAPS,
    StationFeatureSpace,
    load_station_csv,
    load_wx_csv,
    prepare_merged,
)
from train import PARAMS, TEST_DAYS, MIN_TEST_ROWS, HORIZONS, metrics  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))
GLOBAL_DIR = os.path.join(MODELS_DIR, "_global")

GLOBAL_PARAMS = dict(PARAMS, learning_rate=0.06, num_leaves=80, min_data_in_leaf=200)
GLOBAL_MAX_ROUNDS = 900
GLOBAL_ES_ROUNDS = 60
GLOBAL_STRIDE = 4            # thin issue times 4x in the pooled set
GLOBAL_H_STEP = 8            # train global on horizons 1,9,17,...,73->1..72 step 8
FT_STRIDE = 2                # thin issue times 2x per station fine-tune
FT_MAX_ROUNDS = 450          # fresh trees ON TOP of the global model
FT_ES_ROUNDS = 45
FT_LR = 0.03


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")


def load_station_pair(sid: int, name: str, data_dir: str):
    s_path = os.path.join(data_dir, f"station_{sid}_{slug(name)}.csv")
    w_path = os.path.join(data_dir, f"wx_{sid}.csv")
    if not os.path.exists(s_path):
        return None
    station = load_station_csv(s_path)
    if station[TARGETS].notna().any(axis=1).sum() < 3000:
        return None
    if os.path.exists(w_path):
        wx = load_wx_csv(w_path)
    else:  # no covariates file: calendar + station lags only
        wx = pd.DataFrame(index=station.index, columns=["temperature_2m"])
    return prepare_merged(station, wx)


# ── sample assembly (numpy, RAM-safe) ────────────────────────────────────────

def assemble_samples(space: StationFeatureSpace, horizons: list[int],
                     stride: int) -> tuple[np.ndarray, list[str], np.ndarray, np.ndarray,
                                           dict[str, np.ndarray]]:
    """Pack (T0, h) samples into a contiguous float32 matrix.

    Returns (X, feature_cols, t0_ns int64, h int16, {col: y float32}).
    """
    idx = space.index[::stride]
    n = len(idx)
    X: np.ndarray | None = None
    cols: list[str] | None = None
    t0_parts: list[np.ndarray] = []
    h_parts: list[np.ndarray] = []
    y_parts: dict[str, list[np.ndarray]] = {c: [] for c in TARGETS}

    for j, h in enumerate(horizons):
        f = space.frame_for_horizon(h).iloc[::stride]
        arr = f.to_numpy(dtype=np.float32, copy=False)
        if X is None:            # first horizon fixes shape; preallocate the full stack
            cols = list(f.columns)
            X = np.empty((len(horizons) * len(arr), arr.shape[1]), dtype=np.float32)
        X[j * len(arr):(j + 1) * len(arr)] = arr
        del f, arr
        t0_parts.append(idx.asi8.copy())          # int64 ns
        h_parts.append(np.full(n, h, dtype=np.int16))
        for c in TARGETS:
            y_parts[c].append(space.df[c].shift(-h).values[::stride].astype(np.float32))

    assert X is not None and cols is not None
    t0_ns = np.concatenate(t0_parts)
    hh = np.concatenate(h_parts)
    y = {c: np.concatenate(v) for c, v in y_parts.items()}
    return X, list(cols or []), t0_ns, hh, y


def season_es_mask(t0_ns: np.ndarray, split_ns: int, tr_mask: np.ndarray,
                   total_issues_hint: int) -> np.ndarray:
    """Early-stop mask over TRAIN rows: the last ~10% of pre-split issues,
    preferring the same calendar month as the holdout (season-matched ES)."""
    t0_dt = pd.DatetimeIndex(t0_ns)
    split_month = pd.Timestamp(split_ns).month
    cand = np.flatnonzero(tr_mask & (t0_ns < split_ns - 30 * 24 * 3600 * 10**9))
    if len(cand) == 0:
        return np.zeros(len(t0_ns), dtype=bool)
    same_month = cand[t0_dt.month[cand] == split_month]
    pool = same_month if len(same_month) >= 24 * 30 else cand
    n_es = max(48, int(0.10 * len(cand)))
    es_set = pool[-n_es:] if len(pool) >= n_es else pool
    es = np.zeros(len(t0_ns), dtype=bool)
    es[es_set] = True
    return es


# ── Stage A: pooled global pretrain ─────────────────────────────────────────

def collect_pooled(manifest: dict, data_dir: str, stride: int, h_step: int):
    horizons = list(range(1, 73, h_step))
    Xs: list[np.ndarray] = []
    cols: list[str] | None = None
    t0s: list[np.ndarray] = []
    hs: list[np.ndarray] = []
    ss: list[np.ndarray] = []
    ys: dict[str, list[np.ndarray]] = {c: [] for c in TARGETS}
    used: list[int] = []

    for st in manifest["stations"]:
        sid, name = int(st["openaq_id"]), st["registry_name"]
        merged = load_station_pair(sid, name, data_dir)
        if merged is None:
            print(f"  skip {sid} {name} (no/short data)", flush=True)
            continue
        space = StationFeatureSpace(merged)
        X, c, t0_ns, hh, y = assemble_samples(space, horizons, stride)
        del space, merged
        if cols is None:
            cols = c
        Xs.append(X)
        t0s.append(t0_ns)
        hs.append(hh)
        ss.append(np.full(len(t0_ns), sid % 10000, dtype=np.int32))
        for col in TARGETS:
            ys[col].append(y[col])
        used.append(sid)
        print(f"  pooled {sid} {name}: +{len(t0_ns)} rows (total {sum(len(a) for a in t0s)})",
              flush=True)

    X = np.vstack(Xs)
    del Xs
    t0_ns = np.concatenate(t0s)
    hh = np.concatenate(hs)
    stn = np.concatenate(ss)
    y = {c: np.concatenate(v) for c, v in ys.items()}
    return X, cols or [], t0_ns, hh, stn, y, used


def train_global(X: np.ndarray, cols: list[str], t0_ns: np.ndarray,
                 y: np.ndarray, col: str) -> lgb.Booster | None:
    split_ns = int(t0_ns.max()) - TEST_DAYS * 24 * 3600 * 10**9
    te = t0_ns >= split_ns
    # NaN-tolerant validity: need the station-memory anchor + target only
    now_idx = cols.index(f"{col}_now")
    valid = ~np.isnan(y) & ~np.isnan(X[:, now_idx])
    tr, te = (~te) & valid, te & valid
    if tr.sum() < 10000 or te.sum() < 2000:
        print(f"  global {col}: not enough rows ({int(tr.sum())}/{int(te.sum())})", flush=True)
        return None

    es = season_es_mask(t0_ns, split_ns, tr, int(tr.sum()))
    dtrain = lgb.Dataset(X[tr & ~es], label=y[tr & ~es])
    dval = lgb.Dataset(X[tr & es], label=y[tr & es], reference=dtrain)
    model = lgb.train(
        GLOBAL_PARAMS, dtrain, num_boost_round=GLOBAL_MAX_ROUNDS,
        valid_sets=[dval], callbacks=[lgb.early_stopping(GLOBAL_ES_ROUNDS, verbose=False)],
    )
    pred = np.clip(model.predict(X[te], num_iteration=model.best_iteration), 0, CAPS[col])
    m = metrics(y[te], pred)
    print(f"  [global {col}] RMSE {m['rmse']} MAE {m['mae']} R2 {m['r2']} bias {m['bias']} "
          f"(n={m['n']}, iters={model.best_iteration})", flush=True)
    model.save_model(os.path.join(GLOBAL_DIR, f"{col}.txt"))
    return model


# ── Stage B: per-station fine-tune ──────────────────────────────────────────

def finetune_station(sid: int, name: str, data_dir: str) -> dict:
    merged = load_station_pair(sid, name, data_dir)
    if merged is None:
        return {"station_id": sid, "name": name, "status": "no_data"}
    global_cols = [c for c in TARGETS if os.path.exists(os.path.join(GLOBAL_DIR, f"{c}.txt"))]
    if not global_cols:
        return {"station_id": sid, "name": name, "status": "no_global_model"}

    space = StationFeatureSpace(merged)
    # step-2 horizons: the single horizon-feature model interpolates across h,
    # so training on 36 of 72 horizons halves cost with no serving difference
    horizons = list(range(1, 73, 2))
    X, cols, t0_ns, hh, y = assemble_samples(space, horizons, FT_STRIDE)
    del space, merged

    split_ns = int(t0_ns.max()) - TEST_DAYS * 24 * 3600 * 10**9
    te0 = t0_ns >= split_ns

    out_dir = os.path.join(MODELS_DIR, str(sid))
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "feature_columns.json"), "w") as f:
        json.dump(cols, f)

    result: dict = {"station_id": sid, "name": name, "status": "ok", "pollutants": {}}
    for col in TARGETS:
        if col not in global_cols:
            continue
        yc = y[col]
        now_idx = cols.index(f"{col}_now")
        valid = ~np.isnan(yc) & ~np.isnan(X[:, now_idx])
        tr, te = valid & ~te0, valid & te0
        if tr.sum() < 5000 or te.sum() < MIN_TEST_ROWS:
            result["pollutants"][col] = {"status": "insufficient_data",
                                         "n_train": int(tr.sum()), "n_test": int(te.sum())}
            continue

        es = season_es_mask(t0_ns, split_ns, tr, int(tr.sum()))

        # CONTINUE the global model on this station's own history: init_model
        # yields a self-contained booster (predict() keeps the global prior)
        gmodel = lgb.Booster(model_file=os.path.join(GLOBAL_DIR, f"{col}.txt"))
        dtrain = lgb.Dataset(X[tr & ~es], label=yc[tr & ~es])
        dval = lgb.Dataset(X[tr & es], label=yc[tr & es], reference=dtrain)
        model = lgb.train(
            dict(PARAMS, learning_rate=FT_LR), dtrain, num_boost_round=FT_MAX_ROUNDS,
            init_model=gmodel,
            valid_sets=[dval], callbacks=[lgb.early_stopping(FT_ES_ROUNDS, verbose=False)],
        )
        best_iter = int(model.best_iteration or FT_MAX_ROUNDS)

        pred = np.clip(model.predict(X[te], num_iteration=best_iter), 0, CAPS[col])
        overall = metrics(yc[te], pred)
        per_h = {}
        te_h = hh[te]
        for h in horizons:
            m = te_h == h
            if m.sum() >= 50:
                per_h[str(h)] = metrics(yc[te][m], pred[m])
        marks = {h: {k: v[k] for k in ("rmse", "mae", "r2", "bias")}
                 for h, v in per_h.items() if h in ("1", "6", "12", "24", "48", "72")}

        model.save_model(os.path.join(out_dir, f"{col}.txt"))
        result["pollutants"][col] = {"overall": overall, "marks": marks, "best_iteration": best_iter}
        print(f"    [{sid} {name}] {col}: RMSE {overall['rmse']} MAE {overall['mae']} "
              f"R2 {overall['r2']} bias {overall['bias']} (n={overall['n']})", flush=True)

    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump({"station_id": sid, "name": name, "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                   "test_days": TEST_DAYS, "split_time": str(pd.Timestamp(split_ns)),
                   "stride": FT_STRIDE, "init_model": "global",
                   "pollutants": result["pollutants"]}, f, indent=2)
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=os.path.join(HERE, "data", "discovery_manifest.json"))
    ap.add_argument("--global-only", action="store_true")
    ap.add_argument("--finetune-only", action="store_true")
    ap.add_argument("--data-dir", default=os.path.join(HERE, "data"))
    args = ap.parse_args()

    manifest = json.load(open(args.manifest))
    stations = manifest["stations"]
    print(f"manifest: {len(stations)} stations", flush=True)

    if not args.finetune_only:
        os.makedirs(GLOBAL_DIR, exist_ok=True)
        print("=== Stage A: pooled global pretrain ===", flush=True)
        X, cols, t0_ns, hh, stn, y, used = collect_pooled(
            manifest, args.data_dir, GLOBAL_STRIDE, GLOBAL_H_STEP)
        print(f"pooled rows: {len(t0_ns)}, features: {len(cols)}", flush=True)
        with open(os.path.join(GLOBAL_DIR, "feature_columns.json"), "w") as f:
            json.dump(cols, f)
        globals_ = []
        for col in TARGETS:
            m = train_global(X, cols, t0_ns, y[col], col)
            if m is not None:
                globals_.append(col)
        del X, y
        with open(os.path.join(GLOBAL_DIR, "meta.json"), "w") as f:
            json.dump({"trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                       "stations_used": used, "pollutants": globals_,
                       "stride": GLOBAL_STRIDE, "h_step": GLOBAL_H_STEP}, f, indent=2)
        if args.global_only:
            return

    print("=== Stage B: per-station fine-tune ===", flush=True)
    summary_path = os.path.join(MODELS_DIR, "metrics_summary.json")
    rows: list[dict] = []
    if os.path.exists(summary_path):  # MERGE, never clobber previous runs
        try:
            rows = json.load(open(summary_path, encoding="utf-8"))
        except Exception:
            rows = []
    by_id = {int(r.get("station_id", -1)): r for r in rows}
    for st in stations:
        sid, name = int(st["openaq_id"]), st["registry_name"]
        print(f"=== fine-tune {sid} {name} ===", flush=True)
        res = finetune_station(sid, name, args.data_dir)
        by_id[sid] = res
        with open(summary_path, "w") as f:
            json.dump(list(by_id.values()), f, indent=2)
    print(f"summary -> {summary_path} ({len(by_id)} stations)", flush=True)


if __name__ == "__main__":
    main()
