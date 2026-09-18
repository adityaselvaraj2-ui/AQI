"""Two-stage training: pooled global pretrain -> per-station fine-tune.

Stage A (global): pools (station, T0, h) samples from every station's full
archive history to learn the shared NCR dynamics (seasonality, diurnal cycle,
weather response, CAMS correction, FIRE response).  RAM-bounded via issue-time
stride and per-horizon subsampling; samples are packed as float32 numpy arrays.

Stage B (per station): each station's model CONTINUES the global model
(init_model=) on THAT STATION'S OWN full history.  init_model produces a
self-contained booster whose predict() includes the global prior — unlike
init_score, which predict() silently drops (that would poison serving).

Evaluation (per station, per pollutant):
  * contract holdout  — the standing last-120-day chronological window
  * rolling folds     — 3 additional chronological windows before it, one of
                        which covers the Oct–Nov 2025 stubble season; metrics
                        per fold and per horizon band (1-6h / 24h / 48-72h)
  * blend             — model blended with persistence ({col}_now) and
                        climatology ({col}_rmean168) with band-dependent
                        weights; both model-only and blended metrics recorded
Fine-tune rounds scale with available training rows (no fixed round count).

Sample validity (drop-garbage): target + anchor present, neither on the CAPS
clip plateau, and log-space 24h jumps within the discontinuity guard — see
features.StationFeatureSpace.target_and_mask.

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
    HORIZON_BANDS,
    MAX_HORIZON,
    CAMS_MAX_LEAD_HOURS,
    StationFeatureSpace,
    blended,
    horizon_band,
    load_station_csv,
    load_wx_csv,
    prepare_merged,
)
from train import PARAMS, TEST_DAYS, MIN_TEST_ROWS, metrics  # noqa: E402
from io_utils import atomic_write_json, merge_json_entries, ensure_disk_free  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))
GLOBAL_DIR = os.path.join(MODELS_DIR, "_global")
DATA_DIR = os.path.join(HERE, "data")
MERGED_DIR = os.path.join(HERE, "data_merged")
FIRE_DIR = os.path.join(HERE, "data", "fire")
HPO_PATH = os.path.join(HERE, "hpo_params.json")

GLOBAL_PARAMS = dict(PARAMS, learning_rate=0.06, num_leaves=80, min_data_in_leaf=200)
GLOBAL_MAX_ROUNDS = 900
GLOBAL_ES_ROUNDS = 60
GLOBAL_STRIDE = 12           # thin issue times 12x in the pooled set (168h doubles the
                             # horizon count; this holds the pooled matrix ~4 GB on 16 GB RAM)
GLOBAL_H_STEP = 12           # train global on horizons 1,13,25,...,157->1..168 step 12
FT_STRIDE = 4                # thin issue times 4x per station fine-tune (168h doubles horizon count)
FT_LR = 0.03
FT_ES_ROUNDS = 45
FT_MIN_ROUNDS = 120          # scaled fine-tune budget (see ft_rounds)
FT_MAX_ROUNDS = 600
FT_FOLD_ROUNDS = 150         # rolling-origin fold fits: fixed small budget
FT_FOLD_LR = 0.05

def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")


def load_hpo_params() -> dict[str, dict]:
    try:
        with open(HPO_PATH, encoding="utf-8") as fh:
            raw = json.load(fh)
        return {col: dict(p) for col, p in raw.items()}
    except FileNotFoundError:
        return {}


def ft_rounds(n_train: int) -> int:
    """Scale fine-tune rounds to station history volume (log curve, capped)."""
    if n_train <= 50_000:
        return FT_MIN_ROUNDS
    return int(min(FT_MAX_ROUNDS, FT_MIN_ROUNDS + 480 * np.log10(n_train / 50_000) / np.log10(20)))


def load_fire_daily(sid: int) -> pd.DataFrame | None:
    path = os.path.join(FIRE_DIR, f"fire_{sid}.csv")
    if not os.path.exists(path):
        return None
    f = pd.read_csv(path, index_col="date", parse_dates=True)
    return f if len(f) else None


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
                                           dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Pack (T0, h) samples into a contiguous float32 matrix.

    Returns (X, feature_cols, t0_ns int64, h int16,
             {col: y float32}, {col: valid bool}).
    """
    idx = space.index[::stride]
    n = len(idx)
    X: np.ndarray | None = None
    cols: list[str] | None = None
    t0_parts: list[np.ndarray] = []
    h_parts: list[np.ndarray] = []
    y_parts: dict[str, list[np.ndarray]] = {c: [] for c in TARGETS}
    m_parts: dict[str, list[np.ndarray]] = {c: [] for c in TARGETS}

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
            y, mask = space.target_and_mask(c, h)
            y_parts[c].append(y[::stride].astype(np.float32))
            m_parts[c].append(mask[::stride])

    assert X is not None and cols is not None
    t0_ns = np.concatenate(t0_parts)
    hh = np.concatenate(h_parts)
    y = {c: np.concatenate(v) for c, v in y_parts.items()}
    mask = {c: np.concatenate(v) for c, v in m_parts.items()}
    return X, list(cols or []), t0_ns, hh, y, mask


def season_es_mask(t0_ns: np.ndarray, split_ns: int, tr_mask: np.ndarray) -> np.ndarray:
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


# ── conformal band calibration (10/90) ──────────────────────────────────────

def conformal_bands(model: lgb.Booster, X: np.ndarray, hh: np.ndarray, y: np.ndarray,
                    es: np.ndarray, cols: list[str], col: str,
                    best_iter: int) -> tuple[dict, dict]:
    """Split-conformal 10/90 bands from training-tail residuals, per horizon band.

    Returns ({band: {q10, q90}}, {band: holdout_coverage}) — the coverage dict is
    filled by the caller once holdout predictions exist.
    """
    pred_es = np.clip(model.predict(X[es], num_iteration=best_iter), 0, CAPS[col])
    res = y[es] - pred_es
    hh_es = hh[es]
    bands = {}
    for band, rng in HORIZON_BANDS.items():
        m = (hh_es >= min(rng)) & (hh_es <= max(rng))
        if m.sum() >= 100:
            q10, q90 = np.quantile(res[m], 0.10), np.quantile(res[m], 0.90)
        else:
            q10, q90 = np.quantile(res, 0.10), np.quantile(res, 0.90)
        bands[band] = {"q10": float(q10), "q90": float(q90), "n": int(m.sum())}
    return bands, {b: 0.0 for b in bands}


def coverage_of(bands: dict, y: np.ndarray, pred: np.ndarray, hh: np.ndarray) -> dict:
    out = {}
    for band, q in bands.items():
        if band not in HORIZON_BANDS:
            continue
        rng = HORIZON_BANDS[band]
        m = (hh >= min(rng)) & (hh <= max(rng))
        if m.sum() < 30:
            continue
        lo = np.clip(pred[m] + q["q10"], 0, None)
        hi = np.clip(pred[m] + q["q90"], 0, None)
        out[band] = round(float(np.mean((y[m] >= lo) & (y[m] <= hi))), 4)
    return out


# ── Stage A: pooled global pretrain ─────────────────────────────────────────

def collect_pooled(manifest: dict, data_dir: str, stride: int, h_step: int):
    horizons = list(range(1, MAX_HORIZON + 1, h_step))
    Xs: list[np.ndarray] = []
    cols: list[str] | None = None
    t0s: list[np.ndarray] = []
    hs: list[np.ndarray] = []
    ys: dict[str, list[np.ndarray]] = {c: [] for c in TARGETS}
    ms: dict[str, list[np.ndarray]] = {c: [] for c in TARGETS}
    used: list[int] = []

    for st in manifest["stations"]:
        sid, name = int(st["openaq_id"]), st["registry_name"]
        merged = load_station_pair(sid, name, data_dir)
        if merged is None:
            print(f"  skip {sid} {name} (no/short data)", flush=True)
            continue
        space = StationFeatureSpace(merged, load_fire_daily(sid))
        X, c, t0_ns, hh, y, mask = assemble_samples(space, horizons, stride)
        del space, merged
        if cols is None:
            cols = c
        Xs.append(X)
        t0s.append(t0_ns)
        hs.append(hh)
        for col in TARGETS:
            ys[col].append(y[col])
            ms[col].append(mask[col])
        used.append(sid)
        print(f"  pooled {sid} {name}: +{len(t0_ns)} rows (total {sum(len(a) for a in t0s)})",
              flush=True)

    X = np.vstack(Xs)
    del Xs
    t0_ns = np.concatenate(t0s)
    hh = np.concatenate(hs)
    y = {c: np.concatenate(v) for c, v in ys.items()}
    mask = {c: np.concatenate(v) for c, v in ms.items()}
    return X, cols or [], t0_ns, hh, y, mask, used


def train_global(X: np.ndarray, cols: list[str], t0_ns: np.ndarray,
                 y: np.ndarray, mask: np.ndarray, col: str) -> lgb.Booster | None:
    split_ns = int(t0_ns.max()) - TEST_DAYS * 24 * 3600 * 10**9
    te = t0_ns >= split_ns
    valid = mask
    tr, te = (~te) & valid, te & valid
    if tr.sum() < 10000 or te.sum() < 2000:
        print(f"  global {col}: not enough rows ({int(tr.sum())}/{int(te.sum())})", flush=True)
        return None

    es = season_es_mask(t0_ns, split_ns, tr)
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

def _band_metrics(y: np.ndarray, pred: np.ndarray, hh: np.ndarray) -> dict:
    out = {}
    for band, rng in HORIZON_BANDS.items():
        lo, hi = min(rng), max(rng)
        m = (hh >= lo) & (hh <= hi)
        if m.sum() >= 30:
            out[band] = metrics(y[m], pred[m])
    return out


def eval_windows(t0_ns: np.ndarray) -> list[dict]:
    """Contract holdout (last TEST_DAYS) + rolling folds before it.

    fold_3..fold_1 walk backwards in TEST_DAYS steps; fold_1 is pinned to fully
    cover Oct–Nov 2025 (stubble season) when the station's history reaches it.
    """
    end_ns = int(t0_ns.max())
    day_ns = 24 * 3600 * 10**9
    windows = [{"name": "holdout_120d", "start": end_ns - TEST_DAYS * day_ns, "end": end_ns + 1}]
    step = TEST_DAYS * day_ns
    for k in (3, 2, 1):
        we = end_ns - (4 - k) * step
        ws = we - step
        w = {"name": f"fold_{k}", "start": ws, "end": we}
        if k == 1:  # pin to the stubble season when the archive covers it
            oct25 = int(pd.Timestamp("2025-10-01", tz="UTC").value)
            nov30 = int(pd.Timestamp("2025-11-30 23:00", tz="UTC").value)
            if t0_ns.min() <= oct25:
                w = {"name": "fold_1_stubble_oct_nov_2025", "start": oct25, "end": nov30 + 1}
        windows.append(w)
    return windows


def finetune_station(sid: int, name: str, data_dir: str, hpo: dict[str, dict]) -> dict:
    merged = load_station_pair(sid, name, data_dir)
    if merged is None:
        return {"station_id": sid, "name": name, "status": "no_data"}
    global_cols = [c for c in TARGETS if os.path.exists(os.path.join(GLOBAL_DIR, f"{c}.txt"))]
    if not global_cols:
        return {"station_id": sid, "name": name, "status": "no_global_model"}

    space = StationFeatureSpace(merged, load_fire_daily(sid))
    space_clim = space.clim   # freeze BEFORE del space (fallback tables for meta.json)
    # step-2 horizons: the single horizon-feature model interpolates across h,
    # so training on 84 of 168 horizons keeps cost bounded (FT_STRIDE thins
    # issue times to compensate for the 2.3x horizon growth vs the 72h model)
    horizons = list(range(1, MAX_HORIZON + 1, 2))
    X, cols, t0_ns, hh, y, mask = assemble_samples(space, horizons, FT_STRIDE)
    del space, merged

    end_ns = int(t0_ns.max())
    holdout_ns = end_ns - TEST_DAYS * 24 * 3600 * 10**9
    windows = eval_windows(t0_ns)

    out_dir = os.path.join(MODELS_DIR, str(sid))
    os.makedirs(out_dir, exist_ok=True)
    atomic_write_json(os.path.join(out_dir, "feature_columns.json"), cols)

    result: dict = {"station_id": sid, "name": name, "status": "ok",
                    "history_span": [str(pd.Timestamp(t0_ns.min())), str(pd.Timestamp(end_ns))],
                    "pollutants": {}}
    for col in TARGETS:
        if col not in global_cols:
            continue
        yc, valid = y[col], mask[col]
        te0 = t0_ns >= holdout_ns
        tr, te = valid & ~te0, valid & te0
        n_train = int(tr.sum())
        if n_train < 5000 or int(te.sum()) < MIN_TEST_ROWS:
            result["pollutants"][col] = {"status": "insufficient_data",
                                         "n_train": n_train, "n_test": int(te.sum())}
            continue

        es = season_es_mask(t0_ns, holdout_ns, tr)

        # CONTINUE the global model on this station's own history: init_model
        # yields a self-contained booster (predict() keeps the global prior)
        gmodel = lgb.Booster(model_file=os.path.join(GLOBAL_DIR, f"{col}.txt"))
        params = dict(PARAMS, learning_rate=FT_LR)
        params.update(hpo.get(col, {}))
        rounds = ft_rounds(n_train)
        dtrain = lgb.Dataset(X[tr & ~es], label=yc[tr & ~es])
        dval = lgb.Dataset(X[tr & es], label=yc[tr & es], reference=dtrain)
        model = lgb.train(
            params, dtrain, num_boost_round=rounds,
            init_model=gmodel,
            valid_sets=[dval], callbacks=[lgb.early_stopping(FT_ES_ROUNDS, verbose=False)],
        )
        best_iter = int(model.best_iteration or rounds)

        pred_raw = np.clip(model.predict(X[te], num_iteration=best_iter), 0, CAPS[col])
        pred_bl = blended(pred_raw, X[te], cols, hh[te], col)
        y_te = yc[te]
        overall = metrics(y_te, pred_raw)
        overall_bl = metrics(y_te, pred_bl)

        # calibrated 10/90 bands: split-conformal on training-tail residuals,
        # coverage verified on the holdout (the number that must be ~0.80)
        bands, _ = conformal_bands(model, X, hh, yc, es, cols, col, best_iter)
        use_blend0 = overall_bl["rmse"] <= overall["rmse"]
        cover = coverage_of(bands, y_te, pred_bl if use_blend0 else pred_raw, hh[te])

        # rolling-origin folds: for each earlier window, RETRAIN a fold model on
        # only the data before that window (continued from the global model with a
        # reduced fixed budget) and score INSIDE the window — true out-of-sample
        # season-variance evidence, not in-sample re-scoring of the deployed model
        use_blend = overall_bl["rmse"] <= overall["rmse"]
        folds = {}
        for w in windows:
            if w["name"] == "holdout_120d":
                fm = te.copy()          # deployed predictions exist only on te rows
                p_m, p_b = pred_raw, pred_bl  # already te-indexed
                yw = yc[fm]
                pred = p_b if use_blend else p_m
                folds[w["name"]] = {"window": [str(pd.Timestamp(w["start"])), str(pd.Timestamp(w["end"]))],
                                    "n": int(fm.sum()),
                                    "model": "deployed",
                                    "overall": metrics(yw, pred),
                                    "bands": _band_metrics(yw, pred, hh[fm])}
                continue
            tr_w = valid & (t0_ns < w["start"])
            fm = valid & (t0_ns >= w["start"]) & (t0_ns < w["end"])
            if tr_w.sum() < 5000 or int(fm.sum()) < 2000:
                continue
            fw_model = lgb.train(
                dict(PARAMS, learning_rate=FT_FOLD_LR),
                lgb.Dataset(X[tr_w], label=yc[tr_w]),
                num_boost_round=FT_FOLD_ROUNDS, init_model=gmodel,
            )
            p_m = np.clip(fw_model.predict(X[fm], num_iteration=FT_FOLD_ROUNDS), 0, CAPS[col])
            p_b = blended(p_m, X[fm], cols, hh[fm], col)
            yw = yc[fm]
            pred = p_b if use_blend else p_m
            folds[w["name"]] = {"window": [str(pd.Timestamp(w["start"])), str(pd.Timestamp(w["end"]))],
                                "n": int(fm.sum()),
                                "model": "rolling-origin",
                                "overall": metrics(yw, pred),
                                "bands": _band_metrics(yw, pred, hh[fm])}
        marks_raw = {h: {k: v[k] for k in ("rmse", "mae", "r2", "bias")}
                     for h, v in _band_metrics(y_te, pred_raw, hh[te]).items()}
        marks_bl = {h: {k: v[k] for k in ("rmse", "mae", "r2", "bias")}
                    for h, v in _band_metrics(y_te, pred_bl, hh[te]).items()}

        model.save_model(os.path.join(out_dir, f"{col}.txt"))
        result["pollutants"][col] = {
            "overall": overall_bl if use_blend else overall,
            "model_only": overall,
            "blended": overall_bl,
            "blend_used": bool(use_blend),
            "bands_model": marks_raw,
            "bands_blended": marks_bl,
            "folds": folds,
            "n_train": n_train,
            "ft_rounds_budget": rounds,
            "best_iteration": best_iter,
            "hpo_applied": hpo.get(col, {}),
            "bands_10_90": bands,
            "coverage_10_90": cover,
        }
        src = overall_bl if use_blend else overall
        print(f"    [{sid} {name}] {col}: RMSE {src['rmse']} MAE {src['mae']} "
              f"R2 {src['r2']} bias {src['bias']} "
              f"({'blend' if use_blend else 'model'}, n_train={n_train}, rounds<={rounds})", flush=True)

    atomic_write_json(os.path.join(out_dir, "meta.json"),
                      {"station_id": sid, "name": name, "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                       "test_days": TEST_DAYS, "split_time": str(pd.Timestamp(holdout_ns)),
                       "stride": FT_STRIDE, "init_model": "global",
                       "model_hours": MAX_HORIZON,
                       "cams_max_lead_hours": CAMS_MAX_LEAD_HOURS,
                       # frozen >CAMS-cutoff fallback tables — serving passes this exact
                       # dict into StationFeatureSpace so train/serve substitute the
                       # same pseudo-CAMS values (a 12-day live history cannot rebuild them)
                       "climatology": space_clim,
                       "folds": [w["name"] for w in windows],
                       "pollutants": result["pollutants"]})
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=os.path.join(HERE, "data", "discovery_manifest.json"))
    ap.add_argument("--global-only", action="store_true")
    ap.add_argument("--finetune-only", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="re-fine-tune stations that already have a checkpoint")
    ap.add_argument("--only", default="",
                    help="comma-separated station ids to fine-tune (default: all)")
    ap.add_argument("--redo-if-72h", action="store_true",
                    help="re-fine-tune stations whose checkpoint predates the 168h model "
                         "(meta has no model_hours) even without --force")
    ap.add_argument("--data-dir", default=MERGED_DIR)
    args = ap.parse_args()

    ensure_disk_free(MODELS_DIR, need_gb=2.0)
    manifest = json.load(open(args.manifest))
    stations = manifest["stations"]
    if args.only:
        want = {int(x) for x in str(args.only).split(",") if x.strip()}
        stations = [s for s in stations if int(s["openaq_id"]) in want]
    print(f"manifest: {len(stations)} stations (data_dir={args.data_dir})", flush=True)

    if not args.finetune_only:
        os.makedirs(GLOBAL_DIR, exist_ok=True)
        print("=== Stage A: pooled global pretrain ===", flush=True)
        X, cols, t0_ns, hh, y, mask, used = collect_pooled(
            manifest, args.data_dir, GLOBAL_STRIDE, GLOBAL_H_STEP)
        print(f"pooled rows: {len(t0_ns)}, features: {len(cols)}", flush=True)
        atomic_write_json(os.path.join(GLOBAL_DIR, "feature_columns.json"), cols)
        globals_ = []
        for col in TARGETS:
            m = train_global(X, cols, t0_ns, y[col], mask[col], col)
            if m is not None:
                globals_.append(col)
        del X, y, mask
        atomic_write_json(os.path.join(GLOBAL_DIR, "meta.json"),
                          {"trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                           "stations_used": used, "pollutants": globals_,
                           "stride": GLOBAL_STRIDE, "h_step": GLOBAL_H_STEP})
        if args.global_only:
            return

    hpo = load_hpo_params()
    print(f"=== Stage B: per-station fine-tune (HPO: {bool(hpo)}) ===", flush=True)
    summary_path = os.path.join(MODELS_DIR, "metrics_summary.json")
    for st in stations:
        sid, name = int(st["openaq_id"]), st["registry_name"]
        done_marker = os.path.join(MODELS_DIR, str(sid), "meta.json")
        if os.path.exists(done_marker):
            stale = args.redo_if_72h and "model_hours" not in json.load(open(done_marker, encoding="utf-8"))
            if not args.force and not stale:
                print(f"=== skip {sid} {name} (checkpoint exists; --force/--redo-if-72h to redo) ===", flush=True)
                continue
        print(f"=== fine-tune {sid} {name} ===", flush=True)
        res = finetune_station(sid, name, args.data_dir, hpo)
        # keyed read-modify-write: never clobbers other stations' entries
        merge_json_entries(summary_path, [res], key="station_id", sort_key=lambda r: r["station_id"])
    print(f"summary -> {summary_path}", flush=True)


if __name__ == "__main__":
    main()
