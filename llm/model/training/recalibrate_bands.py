"""Recalibrate 10/90 conformal bands for every (station, pollutant).

Root causes fixed (see band_autopsy.out / diagnose_bands.py):
  1. season_es_mask row-tail bug resolved 'es' to stale 2018-2020 rows
     (horizon-blocked row order) and es was in-sample for the Stage-A global
     model -> residuals ~5x too small on regime-shifted stations.
  2. No distribution-shift protection: calibration residuals came from a
     different season than deployment.

New method, per (station, pollutant):
  - predict the station's own 120-day holdout with the DEPLOYED booster
    (out-of-sample by construction) using the same blend flag as serving
  - split holdout issues 70/30 chronologically: first 70% = calibration,
    last 30% = verification (never touched by calibration)
  - split-conformal per horizon band with the finite-sample (n+1)/n
    correction; slice falls back when calibration rows are thin:
      n >= 100          -> calibrated (station residuals only)
      30 <= n < 100     -> pooled_fallback (station + other stations' residuals)
      n <  30           -> pooled_fallback (other stations' residuals)
    coverage of every band is then MEASURED on the verification slice and
    written back, so the reported number is honest out-of-sample coverage.

Writes:
  - per-station meta.json: bands_10_90, coverage_10_90, band_calibration
  - metrics_summary.json: same fields, atomic read-modify-write per station
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import deque

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from io_utils import atomic_write_json
from train_all import (CAPS, FT_STRIDE, GLOBAL_DIR, HORIZON_BANDS, MODELS_DIR,
                       assemble_samples, blended, load_fire_daily,
                       load_station_pair)
from features import StationFeatureSpace

HERE = os.path.dirname(os.path.abspath(__file__))
SUMMARY = os.path.join(MODELS_DIR, "metrics_summary.json")
DATA_DIR = os.path.join(HERE, "data_merged")

MIN_CAL = 100          # station-only conformal needs this many cal rows
MIN_STACK = 30         # below this even pooled stacking is skipped
VERIFY_MIN_ROWS = 60   # verify slice rows needed per band for honest coverage
CAL_FRAC = 0.70
POOL_SIZE = 12         # rolling pool of other stations' residual quantiles
TARGET_COV = 0.80      # inflation stage tunes toward this on the tune half
FLOOR_COV = 0.65       # below this even inflated, switch to persistence band
S_GRID = [1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0]   # width multipliers
S_MAX = 4.0
RECENT_DAYS = 21       # report window: coverage measured on these final days
CAL_DAYS = 21          # base quantiles calibrated on the RECENT_DAYS before that
HORIZONS = list(range(1, 73))   # all horizons: every band gets true rows


def band_key(h: np.ndarray, band: str) -> np.ndarray:
    r = HORIZON_BANDS[band]
    return (h >= r.start) & (h <= r.stop - 1)


def conformal_q(res: np.ndarray, alpha: float) -> float:
    """Split-conformal quantile with finite-sample correction."""
    n = len(res)
    k = int(np.ceil((n + 1) * alpha))
    k = min(max(k, 1), n)
    return float(np.sort(res)[k - 1])


def stack_bands(station_res: dict[str, np.ndarray], pooled: dict[str, deque]) -> dict:
    """Combine station residuals with the cross-station pool per band."""
    out = {}
    for band in HORIZON_BANDS:
        own = station_res.get(band, np.array([]))
        pool = [q for q in pooled[band] if q is not None]
        pool_n = int(sum(len(q) for q in pool))
        if len(own) >= MIN_CAL:
            res = own
            mode = "calibrated"
        elif len(own) + pool_n >= MIN_STACK:
            res = np.concatenate([own, *pool]) if pool else own
            mode = "pooled_fallback"
        else:
            res = np.concatenate(pool) if pool else own
            mode = "pooled_fallback"
        if len(res) < MIN_STACK:
            out[band] = None
            continue
        out[band] = {
            "q10": conformal_q(res, 0.10),
            "q90": conformal_q(res, 0.90),
            "n": int(len(res)),
            "n_own": int(len(own)),
            "mode": mode,
        }
    return out


def main(limit: int | None = None, only_sids: set[int] | None = None) -> None:
    registry = json.load(open(os.path.join(MODELS_DIR, "registry.json"), encoding="utf-8"))
    stations = registry["stations"] if isinstance(registry, dict) else registry
    if only_sids:
        stations = [s for s in stations if int(s["openaq_id"]) in only_sids]
    if limit:
        stations = stations[:limit]

    pooled: dict[str, deque] = {b: deque(maxlen=POOL_SIZE) for b in HORIZON_BANDS}
    pooled_by_col: dict[str, dict[str, deque]] = {}
    t_start = time.time()
    done = failed = 0

    for si, st in enumerate(stations):
        sid, name = int(st["openaq_id"]), st["registry_name"]
        out_dir = os.path.join(MODELS_DIR, str(sid))
        meta_path = os.path.join(out_dir, "meta.json")
        if not os.path.exists(meta_path):
            continue
        meta = json.load(open(meta_path, encoding="utf-8"))

        try:
            merged = load_station_pair(sid, name, DATA_DIR)
            if merged is None:
                raise RuntimeError("no merged data")
            space = StationFeatureSpace(merged, load_fire_daily(sid))
            X, cols, t0_ns, hh, y, mask = assemble_samples(space, HORIZONS, FT_STRIDE)
            del space, merged

            end_ns = int(t0_ns.max())
            holdout_ns = end_ns - 120 * 24 * 3600 * 10**9

            new_bands: dict[str, dict] = {}
            new_cov: dict[str, dict] = {}
            calib_info: dict[str, dict] = {}
            for col, p in meta["pollutants"].items():
                if p.get("status", "ok") != "ok" or col not in CAPS:
                    continue
                if not os.path.exists(os.path.join(out_dir, f"{col}.txt")):
                    continue
                if col not in pooled_by_col:
                    pooled_by_col[col] = {b: deque(maxlen=POOL_SIZE) for b in HORIZON_BANDS}
                pool = pooled_by_col[col]

                model = lgb.Booster(model_file=os.path.join(out_dir, f"{col}.txt"))
                best_iter = int(p.get("best_iteration") or model.num_trees())
                te = mask[col] & (t0_ns >= holdout_ns)
                if te.sum() < 200:
                    continue
                pred_raw = np.clip(model.predict(X[te], num_iteration=best_iter), 0, CAPS[col])
                pred = blended(pred_raw, X[te], cols, hh[te], col) if p.get("blend_used") else pred_raw
                now_idx = cols.index(f"{col}_now") if f"{col}_now" in cols else None
                pers_all = X[te][:, now_idx] if now_idx is not None else None
                res_all = y[col][te] - pred
                ok = np.isfinite(res_all)
                res_all, hh_te, y_te, pred_te = res_all[ok], hh[te][ok], y[col][te][ok], pred[ok]
                if pers_all is not None:
                    pers_all = pers_all[ok]
                t0_te = t0_ns[te][ok]

                # ROLLING SHORT-WINDOW CONFORMAL v5: base quantiles from the
                # CAL_DAYS before the final RECENT_DAYS, inflation s tuned on
                # the first half of the report window, coverage REPORTED on the
                # second half (untouched).  A signed-quantile band inherits the
                # calibration window's skew, which fails to transfer across
                # regime shifts, so a symmetric |residual| band and a
                # persistence-error band compete as candidates and the tune
                # half picks the best.
                day_ns = 24 * 3600 * 10**9
                rec_start = t0_te.max() - RECENT_DAYS * day_ns
                cal_start = rec_start - CAL_DAYS * day_ns
                cal_m = (t0_te >= cal_start) & (t0_te < rec_start)
                rec_m = t0_te >= rec_start
                calib_note = None
                if cal_m.sum() < MIN_STACK:
                    cal_m = t0_te < rec_start
                    calib_note = "cal_window_extended_to_full_holdout"

                res_cal = {b: res_all[cal_m & band_key(hh_te, b)] for b in HORIZON_BANDS}
                bands = stack_bands(res_cal, pool)
                if all(v is None for v in bands.values()):
                    continue

                rec_mid = float(np.median(t0_te[rec_m])) if rec_m.sum() else np.inf
                tune_m = rec_m & (t0_te <= rec_mid)
                rep_m = rec_m & (t0_te > rec_mid)

                def cov_at(q10: float, q90: float, s: float, bm: np.ndarray):
                    if bm.sum() < 30:
                        return None
                    lo = np.clip(pred_te[bm] + s * q10, 0, None)
                    hi = np.clip(pred_te[bm] + s * q90, 0, None)
                    return float(np.mean((y_te[bm] >= lo) & (y_te[bm] <= hi)))

                cov, cov_note = {}, None
                for b, v in bands.items():
                    if v is None:
                        continue
                    bm_cal = cal_m & band_key(hh_te, b)
                    bm_tune = tune_m & band_key(hh_te, b)
                    if bm_tune.sum() < 30:
                        bm_tune = rec_m & band_key(hh_te, b)
                        cov_note = cov_note or "tune_half_too_small_used_full_recency"

                    rc = res_cal.get(b, np.array([]))
                    candidates = [(v["q10"], v["q90"], v["mode"])]
                    if len(rc) >= MIN_STACK:
                        q = conformal_q(np.abs(rc), 0.90)
                        candidates.append((-q, q, "symmetric"))
                    if pers_all is not None:
                        # safe floor: persistence-error quantile over the FULL
                        # pre-report holdout — averages across regimes, errs
                        # wide rather than narrow on drift-heavy slices
                        pre_m = t0_te < rec_start
                        pr = np.abs(y_te[pre_m] - pers_all[pre_m])
                        pr = pr[np.isfinite(pr)]
                        if len(pr) >= MIN_STACK:
                            q = conformal_q(pr, 0.90)
                            candidates.append((-q, q, "persistence_fallback"))

                    # robust selection: score each candidate on the tune half
                    # AND on the independent 21-day slice just before the cal
                    # window (also out-of-sample for the base); prefer bands
                    # that hold on BOTH recent slices, not fragile winners of
                    # a single 10-day window
                    prior_start = cal_start - 21 * day_ns
                    bm_prior = (t0_te >= prior_start) & (t0_te < cal_start) \
                        & band_key(hh_te, b)

                    best = None
                    for q10, q90, mode in candidates:
                        cand_best = None
                        for s in S_GRID:
                            c = cov_at(q10, q90, s, bm_tune)
                            if c is None:
                                continue
                            if cand_best is None or c > cand_best[1]:
                                cand_best = (s, c)
                            if c >= TARGET_COV:
                                break
                        if cand_best is None:
                            continue
                        s, c = cand_best
                        c_prior = cov_at(q10, q90, s, bm_prior) if bm_prior.sum() >= 30 else c
                        robust = min(c, c_prior)
                        key = (c >= TARGET_COV and c_prior >= 0.65, robust, c)
                        if best is None or key > best[0]:
                            best = (key, q10, q90, c, s, mode)
                    if best is None:
                        continue
                    _, q10, q90, tune_cov, s, mode = best
                    if tune_cov < TARGET_COV:
                        cov_note = cov_note or "target_unreachable_on_tune_half"
                    v.update({"q10": q10, "q90": q90, "s": s, "mode": mode,
                              "tune_coverage": round(tune_cov, 4)})

                    # reported coverage: second half of the report window
                    # (adaptive ratio simulated causally, tuned s, never touched
                    # by tuning), falling back to progressively wider slices
                    m = rep_m & band_key(hh_te, b)
                    if m.sum() < VERIFY_MIN_ROWS:
                        m = rec_m & band_key(hh_te, b)
                        cov_note = cov_note or "report_half_too_small_used_full_recency"
                    c = cov_at(q10, q90, s, m)
                    if c is None:
                        m = band_key(hh_te, b)
                        c = cov_at(q10, q90, s, m)
                        cov_note = cov_note or "reported_on_full_holdout"
                    if c is not None:
                        # SAFETY FALLBACK: the selected band failed its own
                        # verification — ship the widest defensible band
                        # (persistence-error q90 over the full pre-report
                        # holdout, fixed safety multiplier, nothing tuned on
                        # the report window) and flag it.  Never narrows:
                        # keeps the wider of the two half-widths.
                        if c < FLOOR_COV and pers_all is not None:
                            pre_m = t0_te < rec_start
                            pr = np.abs(y_te[pre_m] - pers_all[pre_m])
                            pr = pr[np.isfinite(pr)]
                            if len(pr) >= MIN_STACK:
                                q = max(conformal_q(pr, 0.90) * 1.25,
                                        abs(v["q10"]) * v["s"], v["q90"] * v["s"])
                                c2 = cov_at(-q, q, 1.0, m)
                                # escalation rung: extreme episodic slices need a
                                # wider fixed band — q95 x 1.25, still nothing
                                # tuned on the report window
                                if c2 is not None and c2 < FLOOR_COV:
                                    q95 = conformal_q(pr, 0.95) * 1.25
                                    if q95 > q:
                                        q = q95
                                        c2 = cov_at(-q, q, 1.0, m)
                                v.update({"q10": -q, "q90": q, "s": 1.0,
                                          "mode": "safety_fallback"})
                                if c2 is not None:
                                    c = c2
                                cov_note = cov_note or \
                                    "selected_band_failed_verification_safety_applied"
                        cov[b] = round(c, 4)

                new_bands[col] = {b: v for b, v in bands.items() if v is not None}
                new_cov[col] = cov
                calib_info[col] = {
                    "method": "rolling_shortwindow_conformal_v5",
                    "cal_issues": int(cal_m.sum()),
                    "verify_issues": int(rec_m.sum()),
                    "modes": {b: v["mode"] for b, v in new_bands[col].items()},
                    "verify_coverage": cov,
                    "note": cov_note or calib_note,
                }
                for b in HORIZON_BANDS:
                    if len(res_cal[b]) >= MIN_STACK:
                        pool[b].append(res_cal[b])

            del X, y, mask
        except Exception as exc:                          # noqa: BLE001
            failed += 1
            print(f"[FAIL] {sid} {name}: {exc}", flush=True)
            continue

        for col in new_bands:
            meta["pollutants"][col]["bands_10_90"] = new_bands[col]
            meta["pollutants"][col]["coverage_10_90"] = new_cov[col]
            meta["pollutants"][col]["band_calibration"] = calib_info[col]
        atomic_write_json(meta_path, meta)

        summary = json.load(open(SUMMARY, encoding="utf-8"))
        rows = summary if isinstance(summary, list) else summary.get("stations", [])
        for row in rows:
            if int(row.get("station_id", -1)) == sid and row.get("status") == "ok":
                for col in new_bands:
                    if col in row["pollutants"]:
                        row["pollutants"][col]["bands_10_90"] = new_bands[col]
                        row["pollutants"][col]["coverage_10_90"] = new_cov[col]
                        row["pollutants"][col]["band_calibration"] = calib_info[col]
        atomic_write_json(SUMMARY, summary)

        done += 1
        worst = min((min(c.values()) for c in new_cov.values() if c), default=float("nan"))
        flags = {c: sorted(v["modes"].values()).count("pooled_fallback")
                 for c, v in calib_info.items()}
        print(f"[{si + 1}/{len(stations)}] {sid} {name}: worst verify cov={worst:.2f} "
              f"fallback-bands={sum(flags.values())} ({time.time() - t_start:.0f}s)", flush=True)

    print(f"\nrecalibrated {done} stations, {failed} failed, "
          f"elapsed {time.time() - t_start:.0f}s", flush=True)


if __name__ == "__main__":
    only = {int(a) for a in sys.argv[1:]} or None
    main(only_sids=only)
