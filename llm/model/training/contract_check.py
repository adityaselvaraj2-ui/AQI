"""CONTRACT CHECK — the original spec's thresholds, enforced mechanically.

For every (station, pollutant) on the standing 120-day chronological holdout:
    RMSE  10-15        -> PASS <= 15,  MARGINAL 15-20,  FAIL > 20
    MAE   5-10         -> PASS <= 10,  MARGINAL 10-15,  FAIL > 15
    R^2   0.7-1.0      -> PASS >= 0.7, MARGINAL 0.5-0.7, FAIL < 0.5
    |bias| close to 0  -> PASS <= 5,   MARGINAL 5-10,   FAIL > 10  (ug/m3)

A pair "passes the contract" only if all 4 thresholds PASS.

Usage:
    python contract_check.py [path/to/metrics_summary.json]

Exit code: 0 always (reporting tool, not a gate).
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.abspath(os.path.join(HERE, "..", "station_models", "metrics_summary.json"))

POLL_ORDER = ["pm25", "pm10", "no2", "o3", "so2"]
POLL_LABEL = {"pm25": "PM2.5", "pm10": "PM10", "no2": "NO2", "o3": "O3", "so2": "SO2"}


def verdict(value: float, lo: float, hi: float, marg_lo: float, marg_hi: float) -> str:
    """PASS inside [lo, hi]; MARGINAL inside [marg_lo, marg_hi]; FAIL outside."""
    if lo <= value <= hi:
        return "PASS"
    if marg_lo <= value <= marg_hi:
        return "MARGINAL"
    return "FAIL"


def rmse_v(x): return verdict(x, 0.0, 15.0, 15.0, 20.0)      # note: lower is better
def mae_v(x):  return verdict(x, 0.0, 10.0, 10.0, 15.0)
def r2_v(x):   return verdict(x, 0.7, 1.0, 0.5, 0.7)
def bias_v(x): return verdict(abs(x), 0.0, 5.0, 5.0, 10.0)


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    with open(path, encoding="utf-8") as f:
        summary = json.load(f)

    rows = []  # (station_id, name, poll, rmse, mae, r2, bias, n)
    for st in summary:
        if st.get("status") != "ok":
            print(f"[skip] station {st.get('name')} status={st.get('status')}")
            continue
        for poll, m in (st.get("pollutants") or {}).items():
            ov = m.get("overall")
            if not ov or ov.get("n", 0) == 0:
                continue
            rows.append((st["station_id"], st["name"], poll,
                         ov["rmse"], ov["mae"], ov["r2"], ov["bias"], ov["n"]))

    print("=" * 100)
    print(f"CONTRACT CHECK — {len(rows)} (station, pollutant) pairs  |  source: {os.path.basename(path)}")
    print("=" * 100)

    # ---------- per-station ----------
    print("\n### PER-STATION (every pair listed; V = verdict per threshold: R=RMSE M=MAE Q=R2 B=|bias|)")
    n_pass_all, n_total = 0, 0
    failing = []
    for sid, name, poll, rmse, mae, r2, bias, n in sorted(rows, key=lambda r: (r[1], POLL_ORDER.index(r[2]))):
        vs = (rmse_v(rmse), mae_v(mae), r2_v(r2), bias_v(bias))
        all_pass = all(v == "PASS" for v in vs)
        n_total += 1
        n_pass_all += all_pass
        flag = "ALL-PASS" if all_pass else "/".join(
            v[0] for v, ok in zip(vs, [rmse_v(rmse) == "PASS", mae_v(mae) == "PASS",
                                       r2_v(r2) == "PASS", bias_v(bias) == "PASS"]) if not ok)
        line = (f"{name:<22} {POLL_LABEL[poll]:<5} RMSE {rmse:7.2f} {vs[0]:<8} MAE {mae:6.2f} {vs[1]:<8} "
                f"R2 {r2:+.3f} {vs[2]:<8} bias {bias:+7.2f} {vs[3]:<8} n={n:<6} -> {flag}")
        print(line)
        if not all_pass:
            failing.append(line)

    pct = 100.0 * n_pass_all / max(n_total, 1)
    print("\n### CONTRACT RESULT")
    print(f"pairs passing ALL 4 thresholds: {n_pass_all}/{n_total}  ({pct:.1f}%)")

    # ---------- per-pollutant aggregate ----------
    print("\n### PER-POLLUTANT AGGREGATE (median across stations + pair pass-rate)")
    import statistics
    print(f"{'poll':<6} {'medRMSE':>8} {'medMAE':>7} {'medR2':>7} {'medBias':>8} "
          f"{'RMSE_P':>7} {'MAE_P':>6} {'R2_P':>6} {'BIAS_P':>7} {'ALL4':>6}")
    for poll in POLL_ORDER:
        sub = [r for r in rows if r[2] == poll]
        if not sub:
            continue
        rmses = [r[3] for r in sub]; maes = [r[4] for r in sub]
        r2s = [r[5] for r in sub]; biases = [r[6] for r in sub]
        pr = sum(1 for r in sub if rmse_v(r[3]) == "PASS")
        pm = sum(1 for r in sub if mae_v(r[4]) == "PASS")
        pq = sum(1 for r in sub if r2_v(r[5]) == "PASS")
        pb = sum(1 for r in sub if bias_v(r[6]) == "PASS")
        pa = sum(1 for r in sub if rmse_v(r[3]) == mae_v(r[4]) == r2_v(r[5]) == bias_v(r[6]) == "PASS")
        print(f"{POLL_LABEL[poll]:<6} {statistics.median(rmses):8.2f} {statistics.median(maes):7.2f} "
              f"{statistics.median(r2s):+7.3f} {statistics.median(biases):+8.2f} "
              f"{pr:3}/{len(sub):<3} {pm:2}/{len(sub):<3} {pq:2}/{len(sub):<3} {pb:3}/{len(sub):<3} {pa:2}/{len(sub)}")

    # ---------- full failing list ----------
    print(f"\n### FULL FAILING LIST ({len(failing)} pairs, actual numbers, nothing collapsed)")
    for line in failing:
        print(line)

    # ---------- fold variance (stubble fold vs holdout) ----------
    print("\n### ROLLING FOLDS (R2 per fold; stubble fold = Oct-Nov 2025) — variance across seasons")
    fold_stats = []
    for st in summary:
        if st.get("status") != "ok":
            continue
        for poll, m in (st.get("pollutants") or {}).items():
            folds = m.get("folds") or {}
            if not folds:
                continue
            hs = [f["overall"]["r2"] for f in folds.values() if f.get("overall")]
            if len(hs) < 2:
                continue
            stub = next((v["overall"] for k, v in folds.items() if "stubble" in k), None)
            hold = next((v["overall"] for k, v in folds.items() if "holdout" in k), None)
            fold_stats.append((st["name"], POLL_LABEL[poll],
                               {k: round(v["overall"]["r2"], 2) for k, v in folds.items()},
                               (stub or {}).get("rmse"), (hold or {}).get("rmse")))
    import statistics as _st
    if fold_stats:
        deltas = [abs(f[3] - f[4]) for f in fold_stats if f[3] is not None and f[4] is not None]
        print(f"stations with >=2 folds: {len(fold_stats)}; "
              f"median |stubble-RMSE - holdout-RMSE| = {_st.median(deltas) if deltas else float('nan'):.2f}")
        for name, poll, folds, stub_rmse, hold_rmse in sorted(fold_stats)[:80]:
            print(f"  {name:<22} {poll:<5} {folds}  stubbleRMSE={stub_rmse if stub_rmse is None else round(stub_rmse,1)} "
                  f"holdRMSE={hold_rmse if hold_rmse is None else round(hold_rmse,1)}")
    else:
        print("  (no fold data in this summary — retrain with the new trainer)")

    # ---------- horizon bands ----------
    print("\n### HORIZON BANDS (median across stations; model artifact = overall/bands_*)")
    bands_med = {}
    for st in summary:
        if st.get("status") != "ok":
            continue
        for poll, m in (st.get("pollutants") or {}).items():
            bands = (m.get("bands_blended") if m.get("blend_used") else m.get("bands_model")) \
                    or m.get("bands_model") or m.get("bands_blended") or {}
            for band, met in bands.items():
                bands_med.setdefault((poll, band), []).append((met["rmse"], met["mae"], met["r2"]))
    for poll in POLL_ORDER:
        cells = []
        for band in ("1-6h", "24h", "48-72h"):
            vals = bands_med.get((poll, band))
            if not vals:
                cells.append(f"{band:>7}: --")
                continue
            r = _st.median(v[0] for v in vals)
            q = _st.median(v[2] for v in vals)
            cells.append(f"{band:>7}: RMSE {r:6.2f} R2 {q:+.2f} (n={len(vals)})")
        if cells:
            print(f"  {POLL_LABEL[poll]:<5} " + "  |  ".join(cells))


if __name__ == "__main__":
    main()
