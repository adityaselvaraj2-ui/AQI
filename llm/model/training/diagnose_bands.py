"""Band miscalibration autopsy on the worst slice: Shadipur (8915) NO2.

Quantifies the hypothesized root causes of 0.30 coverage on an "80%" band:
  1. residual leakage  - es rows were seen by the Stage-A global model and
                         best_iteration was early-stopped on es, so residuals
                         measured on es are in-sample (too small)
  2. blend mismatch    - coverage is evaluated on blended predictions but the
                         bands were calibrated on raw-model residuals
  3. regime shift      - es (month-matched to holdout start = May 2025) sits in
                         a different dispersion regime than the monsoon holdout
Prints each number explicitly.
"""
import json
import os

import lightgbm as lgb
import numpy as np

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from train_all import (CAPS, GLOBAL_DIR, MODELS_DIR, assemble_samples,
                       blended, coverage_of, load_fire_daily, load_station_pair,
                       season_es_mask)
from features import StationFeatureSpace

SID, COL = 5610, "no2"
HERE = os.path.dirname(os.path.abspath(__file__))
HORIZON_BANDS = {"h_1_6": (1, 6), "h_24": (24, 24), "h_48_72": (48, 72)}


def main() -> None:
    meta = json.load(open(os.path.join(MODELS_DIR, str(SID), "meta.json"), encoding="utf-8"))
    p = meta["pollutants"][COL]
    print("== current meta ==")
    print("bands_10_90:", {b: (round(v["q10"], 2), round(v["q90"], 2), v["n"])
                          for b, v in p["bands_10_90"].items()})
    print("coverage_10_90:", p.get("coverage_10_90"))
    print("rmse per band:", {b: v.get("rmse") for b, v in p.get("bands", {}).items()})

    merged = load_station_pair(SID, "Shadipur", os.path.join(HERE, "data_merged"))  # registry_name → file name
    if merged is None:
        raise SystemExit("no data for station")
    space = StationFeatureSpace(merged, load_fire_daily(SID))
    X, cols, t0_ns, hh, y, mask = assemble_samples(space, list(range(1, 73, 2)), 1)
    del space, merged

    holdout_ns = int(t0_ns.max()) - 120 * 24 * 3600 * 10**9
    te = mask[COL] & (t0_ns >= holdout_ns)
    tr = mask[COL] & (t0_ns < holdout_ns)

    model = lgb.Booster(model_file=os.path.join(GLOBAL_DIR, f"{COL}.txt"))
    best_iter = int(p.get("best_iteration", model.num_trees()))

    print("\n== cause 1: residual leakage (in-sample es residuals) ==")
    es = season_es_mask(t0_ns, holdout_ns, tr)
    yc = y[COL]
    cand = np.flatnonzero(tr & (t0_ns < holdout_ns - 30 * 24 * 3600 * 10**9))
    n_es = max(48, int(0.10 * len(cand)))

    pred_es = np.clip(model.predict(X[es], num_iteration=best_iter), 0, CAPS[COL])
    res_es = yc[es] - pred_es
    m16 = (hh[es] >= 1) & (hh[es] <= 6)
    print(f"es n={int(es.sum())}, h1-6 rows={int(m16.sum())}")
    print(f"es residuals h1-6: q10={np.quantile(res_es[m16], .10):.2f} q90={np.quantile(res_es[m16], .90):.2f} "
          f"|res| mean={np.abs(res_es[m16]).mean():.2f}")

    # honest out-of-sample residual scale: split train-tail into cal/val halves
    tail = cand[-2 * n_es:]
    cal, val = tail[:n_es], tail[n_es:]
    mc, mv = (hh[cal] >= 1) & (hh[cal] <= 6), (hh[val] >= 1) & (hh[val] <= 6)
    pred_cal = np.clip(model.predict(X[cal], num_iteration=best_iter), 0, CAPS[COL])
    pred_val = np.clip(model.predict(X[val], num_iteration=best_iter), 0, CAPS[COL])
    res_cal, res_val = yc[cal] - pred_cal, yc[val] - pred_val
    print(f"honest cal h1-6: |res| mean={np.abs(res_cal[mc]).mean():.2f}  "
          f"vs val h1-6: |res| mean={np.abs(res_val[mv]).mean():.2f} "
          f"-> leak factor = {np.abs(res_val[mv]).mean() / max(np.abs(res_cal[mc]).mean(), 1e-9):.2f}x")

    print("\n== cause 2: blend vs raw mismatch on the holdout ==")
    pred_raw = np.clip(model.predict(X[te], num_iteration=best_iter), 0, CAPS[COL])
    pred_bl = blended(pred_raw, X[te], cols, hh[te], COL)
    y_te = yc[te]
    m_te = (hh[te] >= 1) & (hh[te] <= 6)
    for tag, pr in (("raw", pred_raw), ("blend", pred_bl)):
        rm = y_te[m_te] - pr[m_te]
        print(f"{tag}: |res| mean={np.abs(rm).mean():.2f}  q90={np.quantile(rm, .90):.2f}")

    print("\n== cause 3: regime shift (May es vs monsoon holdout) ==")
    mo_es = t0_ns[es].astype("datetime64[M]").astype(int) % 12
    mo_te = t0_ns[te].astype("datetime64[M]").astype(int) % 12
    print("es months:", np.unique(mo_es), " holdout months:", np.unique(mo_te))
    for tag, sel, arr in (("es", m16, yc[es]), ("holdout", m_te, yc[te])):
        print(f"{tag}: y std={arr[sel].std():.2f} mean={arr[sel].mean():.2f}")

    print("\n== coverage reproduction ==")
    bands = {b: {"q10": v["q10"], "q90": v["q90"], "n": v["n"]} for b, v in p["bands_10_90"].items()}
    print("coverage with stored bands (blend):", coverage_of(bands, y_te, pred_bl, hh[te]))
    print("coverage with stored bands (raw):  ", coverage_of(bands, y_te, pred_raw, hh[te]))


if __name__ == "__main__":
    main()
