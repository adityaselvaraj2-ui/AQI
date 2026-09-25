"""Chronos-2 (CPCB-trained) per-station forecast serving path.

Loads the LoRA adapters finetuned on REAL CPCB station observations
(llm/model/station_models_chronos2/global_<poll>/, base amazon/chronos-2) and
runs the SAME inference recipe used at training/evaluation time
(llm/model/training/chronos2_candidate.py: context 336h, future covariates from
frame_for_horizon, quantiles 0.1/0.5/0.9).

Honesty notes (do not weaken these):
  - This is the CPCB-trained candidate that LOST the head-to-head against the
    production LightGBM fleet (66/66 station-pollutant comparisons,
    station_models_chronos2/head_to_head.json).  It is exposed as a clearly
    labeled COMPARISON model, never as the primary forecast.
  - It is NOT the teammate's CAMS-reanalysis-scored R2=0.96 model; this one is
    scored against real sensors (see CHRONOS2_VERDICT.md).
  - Inputs are the exact same live frames the LightGBM model sees
    (station_forecast_service.build_live_space), so the comparison is fair.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CHRONOS_DIR = os.path.abspath(os.path.join(HERE, "station_models_chronos2"))

CONTEXT_H = 336   # 14 days of context — identical to training
PRED_H = 168      # forecast span — identical to training


def _torch_has_cuda() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


_DEVICE = "cuda" if _torch_has_cuda() else "cpu"

# The adapter was trained on covariate columns produced by frame_for_horizon.
# Any frame column is a valid covariate channel; the pipeline consumes whatever
# columns are present in both past and future frames.
_PIPE_CACHE: dict[str, Any] = {"pipes": {}, "lock": threading.Lock()}


def chronos_available() -> bool:
    """True when at least one finetuned pollutant adapter exists on disk."""
    return any(
        os.path.isdir(os.path.join(CHRONOS_DIR, f"global_{p}"))
        for p in ("pm25", "pm10", "no2", "o3", "so2")
    )


def chronos_headline() -> dict[str, Any]:
    """Head-to-head verdict + per-pollutant metrics, straight from the artifacts."""
    out: dict[str, Any] = {"available": chronos_available(), "device": _DEVICE}
    h2h_path = os.path.join(CHRONOS_DIR, "head_to_head.json")
    if os.path.exists(h2h_path):
        try:
            with open(h2h_path, encoding="utf-8") as f:
                rows = json.load(f)
            wins = sum(1 for r in rows if r.get("winner_rmse") == "chronos")
            out["head_to_head"] = {
                "comparisons": len(rows),
                "chronos_wins": wins,
                "lightgbm_wins": len(rows) - wins,
                "verdict": "lightgbm" if wins < len(rows) else "chronos",
            }
        except Exception:  # noqa: BLE001
            pass
    verdict_path = os.path.join(CHRONOS_DIR, "CHRONOS2_VERDICT.md")
    if os.path.exists(verdict_path):
        out["verdict_doc"] = "llm/model/station_models_chronos2/CHRONOS2_VERDICT.md"
    return out


def _get_pipe(poll: str):
    """Load (and cache) the LoRA-adapted pipeline for one pollutant."""
    with _PIPE_CACHE["lock"]:
        pipe = _PIPE_CACHE["pipes"].get(poll)
        if pipe is not None:
            return pipe
        import torch  # noqa: F401  (import guard: fail loudly if missing)
        from chronos.chronos2 import Chronos2Pipeline

        ckpt = os.path.join(CHRONOS_DIR, f"global_{poll}")
        if not os.path.isdir(ckpt):
            raise FileNotFoundError(f"no chronos-2 adapter for {poll} at {ckpt}")
        t0 = time.time()
        # adapter dir loads natively: pipeline detects the peft adapter config,
        # loads base amazon/chronos-2, then applies the LoRA weights
        pipe = Chronos2Pipeline.from_pretrained(ckpt, device_map=_DEVICE)
        _PIPE_CACHE["pipes"][poll] = pipe
        print(f"[chronos2] loaded {poll} adapter on {_DEVICE} in {time.time()-t0:.1f}s",
              flush=True)
        return pipe


def chronos_station_forecast(station_id: int, name: str, lat: float, lon: float,
                             anchor: dict[str, float] | None = None) -> dict:
    """168h Chronos-2 forecast for one station, same response contract as
    station_forecast_service.forecast_station_168hr (model="chronos2")."""
    t_start = time.time()
    # late imports: keep the heavy torch/chronos stack out of module import time
    from llm.model.station_forecast_service import (  # noqa: E402
        build_live_space, fetch_covariates, fetch_recent_history, load_station_models,
    )
    from features import horizon_band  # noqa: E402  (same trainer feature module)

    history = fetch_recent_history(station_id, days=15)  # CONTEXT_H=336 needs 14 days
    wx = fetch_covariates(lat, lon)
    bundle = load_station_models(station_id)
    if bundle is None:
        raise FileNotFoundError(f"no trained models for station {station_id}")

    space, t0 = build_live_space(
        station_id, history, wx, anchor, bool(bundle.get("has_fire")),
        (bundle.get("meta") or {}).get("climatology"),
    )
    idx = space.index
    i0 = idx.get_loc(t0)          # tz-aware index + tz-aware t0: locate first
    t0_aware = t0                 # keep the AWARE t0 for output timestamps
    if idx.tz is not None:
        idx = idx.tz_localize(None)  # naive UTC throughout the chronos path (as in training)
    t0 = idx[i0]                  # naive t0 for the chronos frames
    hist_frames, fut_frames = [], []
    polls_used: list[str] = []
    cov_cols: list[str] | None = None
    for poll, meta_p in (bundle.get("meta", {}).get("pollutants") or {}).items():
        ckpt = os.path.join(CHRONOS_DIR, f"global_{poll}")
        if not os.path.isdir(ckpt):
            continue
        item = f"s{station_id}_{poll}"
        polls_used.append(poll)
        obs = space.df[poll]
        lo = max(0, i0 - CONTEXT_H + 1)
        if i0 - lo + 1 < 168:
            continue
        past = pd.DataFrame({
            "item_id": item,
            "timestamp": idx[lo:i0 + 1],
            "target": obs.iloc[lo:i0 + 1].to_numpy(dtype=np.float64),
        })
        # exact per-horizon covariate frames for the PRED_H target hours — the
        # same construction as training/evaluate() (built one h at a time)
        blocks = []
        for h in range(1, PRED_H + 1):
            f = space.frame_for_horizon(h)
            if isinstance(f.index, pd.DatetimeIndex) and f.index.tz is not None:
                f.index = f.index.tz_localize(None)
            if cov_cols is None:
                cov_cols = [c for c in f.columns if c != "horizon"]
            sub = f.iloc[[i0]][cov_cols].copy()
            sub.insert(0, "horizon", np.int16(h))
            sub.insert(0, "timestamp", [idx[i0] + pd.Timedelta(hours=h)])
            sub.insert(0, "origin", [t0])
            sub.insert(0, "item_id", item)
            blocks.append(sub)
        fut = pd.concat(blocks, ignore_index=True)
        del blocks
        hist_frames.append(past)
        fut_frames.append(fut)

    if not hist_frames:
        raise RuntimeError(f"no chronos-2 adapters applicable for station {station_id}")

    past_df = pd.concat(hist_frames, ignore_index=True)
    fut_df = pd.concat(fut_frames, ignore_index=True)
    cov_cols = [c for c in fut_df.columns
                if c not in ("item_id", "timestamp", "origin", "horizon")]
    # predict_df requires future_df columns ⊆ df columns: carry the covariate
    # PAST values into the context frame (identical to the training-time merge)
    past_df = past_df.merge(
        fut_df[["item_id", "timestamp"] + cov_cols].drop_duplicates(["item_id", "timestamp"]),
        on=["item_id", "timestamp"], how="left", suffixes=("", "_f"))
    for c in cov_cols:
        if c + "_f" in past_df.columns:
            past_df[c] = past_df[c + "_f"]
            past_df = past_df.drop(columns=[c + "_f"])
        past_df[c] = past_df[c].astype(float).ffill().fillna(0.0)
    past_df["target"] = past_df["target"].astype(float).ffill().fillna(0.0)

    preds: dict[str, pd.DataFrame] = {}
    for poll in polls_used:
        item = f"s{station_id}_{poll}"
        pipe = _get_pipe(poll)
        p_past = past_df[past_df["item_id"] == item]
        p_fut = fut_df[fut_df["item_id"] == item].drop_duplicates(subset=["timestamp"], keep="first")
        cols = [c for c in cov_cols if c in p_fut.columns]
        out = pipe.predict_df(
            p_past[["item_id", "timestamp", "target"] + cols],
            future_df=p_fut[["item_id", "timestamp"] + cols],
            prediction_length=PRED_H,
            quantile_levels=[0.1, 0.5, 0.9],
            batch_size=32,
        )
        p50 = out.set_index("timestamp")["0.5"]
        p10 = out.set_index("timestamp")["0.1"]
        p90 = out.set_index("timestamp")["0.9"]
        cap = float({"pm25": 1500, "pm10": 2000, "no2": 400, "o3": 400, "so2": 500}[poll])
        preds[poll] = pd.DataFrame({
            "p50": [float(np.clip(p50.loc[t], 0, cap))
                    for t in p_fut["timestamp"]],
            "p10": [float(np.clip(p10.loc[t], 0, cap))
                    for t in p_fut["timestamp"]],
            "p90": [float(np.clip(p90.loc[t], 0, cap))
                    for t in p_fut["timestamp"]],
        }, index=range(1, len(p_fut) + 1))

    hours_out = []
    for h in range(1, PRED_H + 1):
        # tz-aware timestamps: browsers otherwise interpret naive UTC as local
        # time and every hour label shifts by the UTC offset
        ts = t0_aware + pd.Timedelta(hours=h)
        conc, p10m, p90m = {}, {}, {}
        for poll, dfp in preds.items():
            conc[poll] = float(dfp.loc[h, "p50"])
            p10m[poll] = float(dfp.loc[h, "p10"])
            p90m[poll] = float(dfp.loc[h, "p90"])
        hours_out.append({
            "horizon": h,
            "timestamp": ts.isoformat(),
            "aq_source": "cams_forecast" if h <= 96 else "climatology_fallback",
            "cams_available": h <= 96,
            "horizon_band": horizon_band(h),
            "conc": conc,
            "conc_p10": p10m,
            "conc_p90": p90m,
        })

    return {
        "station_id": station_id,
        "station_name": name,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "t0": t0.isoformat(),
        "anchor_used": bool(anchor),
        "history_hours": int(len(history)),
        "model_hours": PRED_H,
        "cams_max_lead_hours": 96,
        "generation_ms": int((time.time() - t_start) * 1000),
        "hours": hours_out,
    }
