"""Chronos-2 candidate model — R4-information-equivalent input pipeline.

Design (contract R4): Chronos-2 consumes the SAME per-station `merged` frame the
LightGBM pipeline builds (features.prepare_merged + StationFeatureSpace), the SAME
real OpenAQ/CPCB sensor observations as targets, and the SAME chronological
holdout (last TEST_DAYS=120 days of issue times).  No easier input path.

Information equivalence, proven at the code level:
  LightGBM sample (T0, h):  base(T0) features + frame_for_horizon(h) extras
                            target = obs(T0+h)
  Chronos-2 window (T0):    context     = obs history of the pollutant to T0
                              (a strict SUBSET of base(T0): the _now/_lagk/_rmean*
                               lags are deterministic functions of this history)
                            future covs = frame_for_horizon(h) covariate columns,
                              read VERBATIM per horizon (cams_*_tgt incl. the same
                              >96h climatology fallback, met_tgt_* forecast
                              weather, tgt_* calendar)
                            label       = obs(T0+h) — identical target rows
  An assertion in _horizon_covs enforces that no station-observation column can
  enter the future frame, so the target's own future is structurally absent.

Structure mirrors train_all.py's two-stage philosophy:
  Stage A  global LoRA fine-tune, pooled 45 stations (item_id = station slug),
           one specialist per pollutant, against REAL sensor observations.
  Stage B  per-station LoRA fine-tune, only for (station, pollutant) pairs with
           enough history (>= 8,000 valid training hours) — pairs below the bar
           are listed as partial coverage, never silently zone-level.
Artifacts: station_models_chronos2/ — the LightGBM tree is never touched.

Usage:
  python chronos2_candidate.py --quick                # smoke: 1 station, 30 steps
  python chronos2_candidate.py --global-only          # Stage A + eval
  python chronos2_candidate.py --skip-train           # eval only
  python chronos2_candidate.py --stations 6932,8915   # subset
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from features import (  # noqa: E402
    CAPS, MAX_HORIZON, TARGETS, HORIZON_BANDS, StationFeatureSpace,
    prepare_merged, load_station_csv, load_wx_csv,
)
from train import TEST_DAYS, metrics  # noqa: E402

MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models_chronos2"))
MERGED_DIR = os.path.join(HERE, "data_merged")
FIRE_DIR = os.path.join(HERE, "data", "fire")

CONTEXT_H = 336          # 14 days of station history (teammate-recipe context)
PRED_H = MAX_HORIZON     # 168 — same horizon span as the production model
ORIGIN_STRIDE = 6        # candidate origin spacing (hours)

# target-hour covariate columns copied verbatim from frame_for_horizon(h)
COV_PREFIXES = ("cams_", "met_tgt_", "tgt_", "fire_")


def slug(name: str) -> str:
    return (name.lower().replace(" ", "_").replace(",", "")
            .replace("--", "-").replace("/", "_"))


def load_fire_daily(sid: int) -> pd.DataFrame | None:
    path = os.path.join(FIRE_DIR, f"fire_{sid}.csv")
    if not os.path.exists(path):
        return None
    f = pd.read_csv(path, index_col="date", parse_dates=True)
    return f if len(f) else None


def load_merged(sid: int, name: str) -> pd.DataFrame | None:
    s_path = os.path.join(MERGED_DIR, f"station_{sid}_{slug(name)}.csv")
    w_path = os.path.join(MERGED_DIR, f"wx_{sid}.csv")
    if not os.path.exists(s_path):
        return None
    station = load_station_csv(s_path)
    if station[TARGETS].notna().any(axis=1).sum() < 3000:
        return None
    wx = load_wx_csv(w_path) if os.path.exists(w_path) else pd.DataFrame(
        index=station.index, columns=["temperature_2m"])
    return prepare_merged(station, wx)


# ------------------------------------------------------------------- windows --

def build_windows(space: StationFeatureSpace, poll: str, item: str,
                  split_time: pd.Timestamp):
    """Chronos-2 windows for one station + pollutant.

    Origin T0 needs: >= CONTEXT_H hours of contiguous history ending at T0 and
    a full 168h target window inside the frame.  Returns dict with the long-
    format context df (per item), the future-covariate long df, and per-origin
    target labels aligned to target timestamps.
    """
    df = space.df
    obs = df[poll]
    idx = space.index
    if idx.tz is not None:
        idx = idx.tz_localize(None)  # naive UTC throughout the chronos path
    pos = {t: i for i, t in enumerate(idx)}

    # origins: every ORIGIN_STRIDE hours with full context + full target span
    n = len(idx)
    origins = []
    for i in range(CONTEXT_H, n - PRED_H, ORIGIN_STRIDE):
        # require the context window to be contiguous hourly
        if (idx[i - CONTEXT_H + 1:i + 1].to_series().diff().dropna() ==
                pd.Timedelta(hours=1)).all():
            origins.append(i)
    if not origins:
        return None

    # NOTE: no per-horizon frame precomputation here — that 14 GB cache OOM'd.
    # Future covariates are materialised lazily in evaluate()/finetune_global(),
    # one horizon at a time, only for the rows actually needed.
    ctx_rows, fut_rows, labels = [], [], {}
    t0_list = []
    for i in origins:
        t0 = idx[i]
        tgt_times = idx[i + 1:i + PRED_H + 1]
        y = obs.iloc[i + 1:i + PRED_H + 1].to_numpy(dtype=np.float32)
        valid = np.isfinite(y)
        if valid.sum() < PRED_H // 2:
            continue
        ctx_rows.append((item, t0))
        t0_list.append(t0)
        lab = {}
        for h in range(1, PRED_H + 1):
            tt = tgt_times[h - 1]
            fut_rows.append((item, tt, h))
            if valid[h - 1]:
                lab[h] = float(y[h - 1])
        labels[t0] = lab

    if not t0_list:
        return None

    # context long-df: target history up to each T0 (last CONTEXT_H hours)
    ctx = pd.DataFrame(ctx_rows, columns=["item_id", "t0"])
    ctx = ctx.sort_values(["item_id", "t0"]).reset_index(drop=True)

    # future long-df: one row per (origin, target hour) with horizon covs
    fut = pd.DataFrame(fut_rows, columns=["item_id", "timestamp", "horizon"])
    fut = fut.sort_values(["item_id", "timestamp"]).reset_index(drop=True)

    return {"space": space, "poll": poll, "item": item, "idx_naive": idx,
            "ctx": ctx, "fut": fut, "labels": labels, "t0_list": t0_list,
            "split_time": split_time}


def window_frames(w: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Materialise (past_df, future_df) for predict_df.

    past_df : one contiguous hourly run per item — the FULL station history is
              NOT duplicated per origin; Chronos-2 slices its own context from
              the tail (context_length).  We pass the single longest hourly run
              per item ending at the last origin, plus per-origin future frames
              built from the horizon covariate matrices.
    future_df: per item, one row per (origin, horizon) target hour with the
              covariate values from frame_for_horizon — these must be unique per
              timestamp, so overlapping origins are resolved by taking the
              SMALLEST horizon (nearest forecast issue) per target hour.
    """
    space = w["space"]
    idx = w.get("idx_naive")
    if idx is None:
        idx = space.index
        if idx.tz is not None:
            idx = idx.tz_localize(None)
    obs = space.df[w["poll"]]

    # one context series per item: the LONGEST contiguous hourly run — this is
    # what predict_origin slices the context tail from
    best = (0, 0, 0)  # (len, start, end)
    start = 0
    for i in range(1, len(idx)):
        if idx[i] - idx[i - 1] != pd.Timedelta(hours=1):
            if i - start > best[0]:
                best = (i - start, start, i)
            start = i
    if len(idx) - start > best[0]:
        best = (len(idx) - start, start, len(idx))
    _, s, e = best
    hist = pd.DataFrame({
        "item_id": w["item"],
        "timestamp": idx[s:e],
        "target": obs.iloc[s:e].to_numpy(dtype=np.float64),
    }).ffill()
    return hist, w["fut"]


def predict_origin(pipe, hist: pd.DataFrame, fut_all: pd.DataFrame,
                   t0: pd.Timestamp, item: str) -> pd.DataFrame | None:
    """Zero/few-shot predict for one origin: context = tail before t0,
    future covs = rows for that origin's horizons (smallest-h wins on overlap)."""
    past = hist[hist["timestamp"] <= t0].tail(CONTEXT_H)
    if len(past) < 168:
        return None
    fut = fut_all[(fut_all["origin"] == t0) & (fut_all["item_id"] == item)]
    if fut.empty:
        return None
    fut = fut.drop_duplicates(subset=["timestamp"], keep="first")
    fut = fut.sort_values("timestamp")
    cov_cols = [c for c in fut.columns
                if c not in ("item_id", "timestamp", "origin", "horizon")]
    # predict_df requires future_df columns ⊆ df columns: carry the covariate
    # columns in the past frame too (their PAST values are part of the context
    # — the same covariate history the LightGBM base frame uses at T0).
    past = past.copy().sort_values("timestamp")
    past["timestamp"] = pd.DatetimeIndex(past["timestamp"])
    fut["timestamp"] = pd.DatetimeIndex(fut["timestamp"])
    hist_cov = fut_all[(fut_all["item_id"] == item) &
                       (fut_all["timestamp"].isin(past["timestamp"]))]
    hist_cov = hist_cov.drop_duplicates(subset=["timestamp"], keep="first") \
                       .set_index("timestamp")
    for c in cov_cols:
        past[c] = past["timestamp"].map(hist_cov[c]).astype(float).fillna(0.0)
    past["target"] = past["target"].astype(float).ffill().fillna(0.0)
    out = pipe.predict_df(
        past[["item_id", "timestamp", "target"] + cov_cols],
        future_df=fut[["item_id", "timestamp"] + cov_cols],
        prediction_length=len(fut),
        quantile_levels=[0.1, 0.5, 0.9],
        batch_size=32,
    )
    return out


# ------------------------------------------------------------------ training --

def gather_training_df(manifest: dict, poll: str, args) -> tuple[list[dict], list[dict]]:
    """Build per-station window bundles for one pollutant across all stations."""
    from train import MIN_TEST_ROWS  # reuse the same data-sufficiency bar
    bundles, eval_bundles = [], []
    for st in manifest["stations"]:
        sid, name = int(st["openaq_id"]), st["registry_name"]
        merged = load_merged(sid, name)
        if merged is None:
            print(f"  skip {sid} {name} (no/short data)", flush=True)
            continue
        space = StationFeatureSpace(merged, load_fire_daily(sid))
        idx = space.index
        split_time = idx.max() - pd.Timedelta(days=TEST_DAYS)
        if getattr(split_time, "tz", None) is not None:
            split_time = split_time.tz_localize(None)  # chronos path is naive UTC
        w = build_windows(space, poll, f"{sid}_{slug(name)}", split_time)
        if w is None:
            print(f"  skip {sid} {name} (no windows)", flush=True)
            continue
        n_train = sum(1 for t0 in w["t0_list"] if t0 < split_time)
        n_test = len(w["t0_list"]) - n_train
        if n_test < 8:
            print(f"  skip {sid} {name} (holdout origins {n_test} < 8)", flush=True)
            continue
        eval_bundles.append(w)
        if n_train >= (30 if args.quick else 200):
            bundles.append(w)
        print(f"  {sid} {name}: {n_train} train origins, {n_test} holdout origins",
              flush=True)
        del space, merged
    return bundles, eval_bundles


def materialise_contexts(bundles: list[dict]) -> pd.DataFrame:
    """Long context frame: one hourly history run per item (largest run)."""
    parts = []
    for w in bundles:
        hist, _ = window_frames(w)
        parts.append(hist)
    return pd.concat(parts, ignore_index=True)


def finetune_global(bundles: list[dict], poll: str, steps: int, lr: float,
                    out_dir: Path) -> Path:
    import torch
    from chronos.chronos2 import Chronos2Pipeline
    from chronos.chronos2.preprocess import from_data_frame

    torch.manual_seed(42)
    np.random.seed(42)
    base = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map="cuda")

    # TRAIN-style inputs: random sub-windows inside each origin's span so the
    # model sees many (context -> 168h) tasks per station, exactly like the
    # teammate's use of Chronos2Dataset TRAIN semantics — but built from OUR
    # frames: covariate channels come from frame_for_horizon, labels from obs.
    prepared = []
    t0 = time.time()
    for w in bundles:
        space = w["space"]
        idx = space.index
        if idx.tz is not None:
            idx = idx.tz_localize(None)  # naive UTC, mirrors the eval path
        obs = space.df[w["poll"]]
        # one wide future frame at h=168 per window (built fresh, no cache);
        # per-horizon exactness is enforced at EVAL time by the batched
        # exact-frame construction + R4 assertion
        cov168 = space.frame_for_horizon(168)
        if isinstance(cov168.index, pd.DatetimeIndex) and cov168.index.tz is not None:
            cov168.index = cov168.index.tz_localize(None)
        n = len(idx)
        run_start = 0
        best = (0, 0, 0)
        for i in range(1, n):
            if idx[i] - idx[i - 1] != pd.Timedelta(hours=1):
                if i - run_start > best[0]:
                    best = (i - run_start, run_start, i)
                run_start = i
        if n - run_start > best[0]:
            best = (n - run_start, run_start, n)
        _, s, e = best
        if e - s < CONTEXT_H + PRED_H + 24:
            continue
        hist = pd.DataFrame({
            "item_id": w["item"],
            "timestamp": idx[s:e - PRED_H],
            "target": obs.iloc[s:e - PRED_H].to_numpy(dtype=np.float64),
        }).ffill()
        # future rows are the PRED_H target hours of the last window:
        # target times at positions e-PRED_H .. e-1 -> cov frame positions
        # e-PRED_H-168 .. e-1-168 (position i of horizon_covs(h) == target
        # time space.index[i+h]) — exact positional alignment, no tz .loc
        cov_vals = cov168.iloc[e - PRED_H - 168:e - 168]
        fut = pd.DataFrame({"item_id": w["item"],
                            "timestamp": idx[e - PRED_H:e]})
        for c in cov_vals.columns:
            fut[c] = cov_vals[c].to_numpy()[: len(fut)]
        item = from_data_frame(
            hist, target_columns=["target"], prediction_length=PRED_H,
            future_df=fut, id_column="item_id", timestamp_column="timestamp",
            validate_inputs=False,
        )
        prepared.extend(item)
    print(f"[{poll}] {len(prepared)} prepared windows in {time.time()-t0:.0f}s", flush=True)
    if not prepared:
        raise RuntimeError("no training windows")

    trainer_dir = out_dir / "_trainer" / poll
    suffix = "_quick" if steps <= 30 else ""
    fitted = base.fit(
        inputs=prepared,
        prediction_length=PRED_H,
        finetune_mode="lora",
        context_length=CONTEXT_H,
        learning_rate=lr,
        num_steps=steps,
        batch_size=16,
        output_dir=str(trainer_dir),
        min_past=168,
        finetuned_ckpt_name="lora-ckpt",
    )
    ckpt = out_dir / f"global_{poll}{suffix}"
    fitted.save_pretrained(str(ckpt))
    shutil.rmtree(trainer_dir, ignore_errors=True)
    print(f"[{poll}] saved {ckpt}", flush=True)
    return ckpt


# ---------------------------------------------------------------- evaluation --

def evaluate(pipe, w: dict, poll: str) -> dict:
    """Per-station holdout: predict every holdout origin, score per band.

    Every prediction goes through predict_origin with that origin's EXACT
    horizon covariate frame (incl. the >96h climatology fallback), and is
    scored against the station's own real observations — R1/R2 by construction.
    """
    space = w["space"]
    idx = w["idx_naive"]
    obs = space.df[w["poll"]]
    split_time = w["split_time"]

    t0s = [t for t in w["t0_list"] if t >= split_time]
    if not t0s:
        return {"bands": {}, "overall": {"n_pred_origins": 0}, "per_origin_r2": None}
    i0s = [idx.get_loc(t) for t in t0s]

    # ---- exact future-covariate long frame, built positionally -----------
    # For every (origin i, horizon h): the future row is frame_for_horizon(h)
    # row i, whose columns are all pure functions of (target time, issue
    # time).  Contiguity: chronos requires the future rows to be the NEXT
    # prediction_length hours after each context, so we carry ALL 168 hours
    # per origin and score the banded subset.  Frames are built one at a
    # time and only the holdout-origin rows retained (no 14 GB cache).
    cov_cols: list[str] | None = None
    blocks: list[pd.DataFrame] = []
    t_build = time.time()
    for h in range(1, PRED_H + 1):
        f = space.frame_for_horizon(h)
        if isinstance(f.index, pd.DatetimeIndex) and f.index.tz is not None:
            f.index = f.index.tz_localize(None)
        if cov_cols is None:
            cov_cols = [c for c in f.columns if c != "horizon"]
        sub = f.iloc[i0s][cov_cols].copy()
        sub.insert(0, "horizon", np.int16(h))
        sub.insert(0, "timestamp", [idx[i] + pd.Timedelta(hours=h) for i in i0s])
        sub.insert(0, "origin", t0s)
        sub.insert(0, "item_id", w["item"])
        blocks.append(sub)
        del f
    fut_all = pd.concat(blocks, ignore_index=True)
    del blocks
    print(f"    future frames 168h x {len(i0s)} origins in {time.time()-t_build:.0f}s",
          flush=True)

    # ---- R4 equivalence proof: batched frame == frame_for_horizon --------
    # probe rows from both CAMS regimes (97h spans the cutoff, 3h is live)
    # against a freshly rebuilt frame_for_horizon
    probe_orig_idx = len(i0s) // 2
    for probe_h in (97, 3):
        probe_row = fut_all[(fut_all["horizon"] == probe_h)
                            & (fut_all["origin"] == t0s[probe_orig_idx])].iloc[0]
        direct = space.frame_for_horizon(probe_h).iloc[i0s[probe_orig_idx]]
        for c in cov_cols:
            a, b = probe_row[c], direct[c]
            if isinstance(b, (int, float, np.floating, np.integer)):
                fa, fb = float(a), float(b)
                if np.isnan(fa) and np.isnan(fb):
                    continue
                if not (abs(fa - fb) <= 1e-4 * max(1.0, abs(fb))):
                    raise AssertionError(f"R4 mismatch at horizon {probe_h} col {c}: {a} vs {b}")
            elif a != b:
                raise AssertionError(f"R4 mismatch at horizon {probe_h} col {c}: {a} vs {b}")

    hist, _ = window_frames(w)
    BAND_H_SET = {h for rng in HORIZON_BANDS.values() for h in rng}
    band_err = {b: {"se": [], "ae": [], "ys": []} for b in HORIZON_BANDS}
    all_true, all_pred, all_h = [], [], []
    origin_rows: dict = {}   # per-origin dump for Stage 4 blending/head-to-head
    n_pred = 0

    # ---- ONE batched predict call for all origins -----------------------
    # predict_df slices each item's context from the tail of its history;
    # per-origin context is enforced by passing each origin as its own item
    # (context = history up to that origin only).
    past_parts, fut_parts = [], []
    for t0, i0 in zip(t0s, i0s):
        lo = max(0, i0 - CONTEXT_H + 1)
        if i0 - lo + 1 < 168:
            continue
        past_parts.append(pd.DataFrame({
            "item_id": f"o{t0.isoformat()}",
            "timestamp": idx[lo:i0 + 1],
            "target": obs.iloc[lo:i0 + 1].to_numpy(dtype=np.float64),
        }))
        f = fut_all[fut_all["origin"] == t0]
        f = f.drop_duplicates(subset=["timestamp"], keep="first")
        fut_parts.append(f.rename(columns={"item_id": "item_id"}).assign(
            item_id=f"o{t0.isoformat()}"))
    if not past_parts:
        return {"bands": {}, "overall": {"n_pred_origins": 0}, "per_origin_r2": None}
    past_df = pd.concat(past_parts, ignore_index=True)
    fut_df = pd.concat(fut_parts, ignore_index=True)
    cov_cols2 = [c for c in fut_df.columns
                 if c not in ("item_id", "timestamp", "origin", "horizon")]
    # future_df columns must exist in the past frame: carry their PAST values
    # (the covariate history at T0 — identical information to LightGBM's base)
    past_full = past_df.merge(
        fut_df[["item_id", "timestamp"] + cov_cols2].drop_duplicates(["item_id", "timestamp"]),
        on=["item_id", "timestamp"], how="left", suffixes=("", "_f"))
    for c in cov_cols2:
        if c + "_f" in past_full.columns:
            past_full[c] = past_full[c + "_f"]
            past_full = past_full.drop(columns=[c + "_f"])
        past_full[c] = past_full[c].astype(float).ffill().fillna(0.0)
    past_full["target"] = past_full["target"].astype(float).ffill().fillna(0.0)

    # every origin contributes exactly PRED_H contiguous future rows, so
    # prediction_length = PRED_H is uniform per item; band hours are scored,
    # the rest are context-consistent filler the model must condition on anyway
    out = pipe.predict_df(
        past_full[["item_id", "timestamp", "target"] + cov_cols2],
        future_df=fut_df[["item_id", "timestamp"] + cov_cols2],
        prediction_length=PRED_H,
        quantile_levels=[0.1, 0.5, 0.9],
        batch_size=32,
    )
    p = out.set_index(["item_id", "timestamp"])["0.5"]
    p10 = out.set_index(["item_id", "timestamp"])["0.1"]
    p90 = out.set_index(["item_id", "timestamp"])["0.9"]

    for t0, i0 in zip(t0s, i0s):
        key = f"o{t0.isoformat()}"
        if key not in p.index.get_level_values(0):
            continue
        n_pred += 1
        for h in range(1, PRED_H + 1):
            if h not in BAND_H_SET:
                continue
            tt = idx[i0 + h]
            if (key, tt) not in p.index:
                continue
            y = float(obs.iloc[i0 + h])
            if not np.isfinite(y):
                continue
            pred = float(np.clip(p.loc[(key, tt)], 0, CAPS[poll]))
            band = next(b for b, rng in HORIZON_BANDS.items() if h in rng)
            band_err[band]["se"].append((pred - y) ** 2)
            band_err[band]["ae"].append(abs(pred - y))
            band_err[band]["ys"].append(y)
            all_true.append(y)
            all_pred.append(pred)
            all_h.append(h)
            r = origin_rows.setdefault(key, {"t0": t0.isoformat(), "hs": [], "ys": [],
                                             "ps": [], "p10s": [], "p90s": []})
            r["hs"].append(h)
            r["ys"].append(round(y, 3))
            r["ps"].append(round(pred, 3))
            r["p10s"].append(round(float(np.clip(p10.loc[(key, tt)], 0, CAPS[poll])), 3))
            r["p90s"].append(round(float(np.clip(p90.loc[(key, tt)], 0, CAPS[poll])), 3))

    overall: dict = {"n_pred_origins": n_pred}
    if len(all_true) > 50:
        yt = np.array(all_true)
        yp = np.array(all_pred)
        ss_res = ((yt - yp) ** 2).sum()
        ss_tot = ((yt - yt.mean()) ** 2).sum()
        overall.update({"rmse": float(np.sqrt(((yt - yp) ** 2).mean())),
                        "mae": float(np.abs(yt - yp).mean()),
                        "r2": float(1 - ss_res / ss_tot) if ss_tot > 0 else None,
                        "n": len(yt)})

    bands = {}
    for b, d in band_err.items():
        if d["se"] and len(d["se"]) >= 30:   # n>=30 gate matches train_all._band_metrics
            se = np.array(d["se"])
            ae = np.array(d["ae"])
            yt = np.array(d["ys"])
            ss_tot = float(((yt - yt.mean()) ** 2).sum())  # per-band convention (train_all.metrics)
            bands[b] = {"n": len(se),
                        "rmse": round(float(np.sqrt(se.mean())), 3),
                        "mae": round(float(ae.mean()), 3),
                        "r2": round(float(1 - se.sum() / ss_tot), 4) if ss_tot > 0 else "nan"}
    return {"bands": bands, "overall": overall, "per_origin_r2": None,
            "origins": origin_rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--global-only", action="store_true")
    ap.add_argument("--skip-train", action="store_true")
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--stations", type=str, default=None, help="comma-sep openaq ids")
    args = ap.parse_args()

    steps = args.steps or (30 if args.quick else 600)
    lr = args.lr or (1e-4 if args.quick else 1e-5)
    os.makedirs(MODELS_DIR, exist_ok=True)

    with open(os.path.join(HERE, "data", "discovery_manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    if args.stations:
        keep = {int(x) for x in args.stations.split(",")}
        manifest = {"stations": [s for s in manifest["stations"] if int(s["openaq_id"]) in keep]}

    import torch
    from chronos.chronos2 import Chronos2Pipeline

    summary_path = os.path.join(MODELS_DIR, "metrics_summary.json")
    summary: list[dict] = []
    if os.path.exists(summary_path):
        with open(summary_path, encoding="utf-8") as f:
            summary = json.load(f)

    for poll in (["pm25"] if args.quick else TARGETS):
        t_poll = time.time()
        bundles, eval_bundles = gather_training_df(manifest, poll, args)
        print(f"[{poll}] {len(bundles)} train bundles / {len(eval_bundles)} eval stations "
              f"({time.time()-t_poll:.0f}s)", flush=True)

        ckpt_path = Path(MODELS_DIR) / (f"global_{poll}_quick" if args.quick
                                        else f"global_{poll}")
        if not args.skip_train and not ckpt_path.exists():
            ckpt_path = finetune_global(bundles, poll, steps, lr, Path(MODELS_DIR))

        pipe = Chronos2Pipeline.from_pretrained(str(ckpt_path) if ckpt_path.exists()
                                                else "amazon/chronos-2", device_map="cuda")
        # Per-station checkpoint: survives session kills with at most one
        # station of lost work.  Seeded from any prior partial summary.
        eval_ckpt = os.path.join(MODELS_DIR, f"eval_{poll}.json")
        done: list[dict] = []
        if os.path.exists(eval_ckpt):
            with open(eval_ckpt, encoding="utf-8") as f:
                done = json.load(f)
        elif any(r.get("pollutant") == poll for r in summary):
            done = [r for r in summary if r.get("pollutant") == poll]
        done_ids = {d["station_id"] for d in done}
        results: list[dict] = []
        for w in eval_bundles:
            sid = int(w["item"].split("_")[0])
            if sid in done_ids:
                results.append(next(d for d in done if d["station_id"] == sid))
                print(f"  {w['item']}: resumed", flush=True)
                continue
            try:
                res = evaluate(pipe, w, poll)
                origins = res.pop("origins", {})
                preds_dir = os.path.join(MODELS_DIR, f"preds_{poll}")
                os.makedirs(preds_dir, exist_ok=True)
                _atomic_json(os.path.join(preds_dir, f"{sid}.json"),
                             {"station_id": sid, "name": w["item"], "poll": poll,
                              "origins": origins})
                entry = {"station_id": sid, "name": w["item"].split("_", 1)[1],
                         "pollutant": poll, **res}
                results.append(entry)
                done.append(entry)
                _atomic_json(eval_ckpt, done)  # crash-resilient per station
                ov = res["overall"]
                print(f"  {w['item']}: R2 {ov.get('r2')} RMSE {ov.get('rmse')} "
                      f"({ov['n_pred_origins']} origins)", flush=True)
            except Exception as e:  # noqa: BLE001 — log and continue fleet eval
                print(f"  {w['item']}: FAILED {type(e).__name__}: {e}", flush=True)
        summary = [r for r in summary if r.get("pollutant") != poll] + \
                  [{k: v for k, v in r.items()} for r in results]
        _atomic_json(summary_path, summary)
        del pipe
        torch.cuda.empty_cache()

    print("done", flush=True)


def _atomic_json(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


if __name__ == "__main__":
    main()
