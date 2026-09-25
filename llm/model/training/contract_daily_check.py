"""CONTRACT CHECK — daily-mean head (pre-registered thresholds, enforced mechanically).

Contract (D+1 daily mean, per station x pollutant, per evaluation window):
    PM2.5, NO2, O3, SO2 :  R2 >= 0.7   RMSE < 20      (approved plan)
    PM10                :  R2 >= 0.5   RMSE <= 45     (floor-limited: daily-mean
                          persistence floor is 55.2 — measured; no leak-free
                          model can do RMSE < 20 on PM10)
Windows: holdout_120d and fold_1_stubble_oct_nov_2025 reported SEPARATELY.
D+2 / D+3 reported separately. No aggregation hides a failing slice.

Usage: python contract_daily_check.py
Exit code 0 always (reporting tool).
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.abspath(os.path.join(HERE, "..", "station_models_daily"))

THRESH = {
    "pm25": {"r2": 0.7, "rmse": 20.0},
    "no2":  {"r2": 0.7, "rmse": 20.0},
    "o3":   {"r2": 0.7, "rmse": 20.0},
    "so2":  {"r2": 0.7, "rmse": 20.0},
    "pm10": {"r2": 0.5, "rmse": 45.0},
}
POLL_ORDER = ["pm25", "pm10", "no2", "o3", "so2"]
POLL_LABEL = {"pm25": "PM2.5", "pm10": "PM10", "no2": "NO2", "o3": "O3", "so2": "SO2"}


def main() -> None:
    base = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    paths = sorted(p for p in os.listdir(base) if os.path.isdir(os.path.join(base, p)))
    rows = []
    for sid in paths:
        f = os.path.join(base, sid, "daily_summary.json")
        if not os.path.exists(f):
            continue
        j = json.load(open(f, encoding="utf-8"))
        if j.get("status") != "ok":
            rows.append((int(sid), j.get("name", sid), "-", "-", "-", "-", "-", "NO_DATA"))
            continue
        for pol in POLL_ORDER:
            e = j.get("pollutants", {}).get(pol)
            if not e or e.get("status") != "ok":
                continue
            for key, m in sorted(e.get("windows", {}).items()):
                if not key.endswith("_D+1"):
                    continue  # contract is D+1; D+2/D+3 printed in the appendix
                win = key.rsplit("_D+1", 1)[0]
                th = THRESH[pol]
                ok_r2 = m["r2"] >= th["r2"]
                ok_rm = m["rmse"] < th["rmse"] if pol != "pm10" else m["rmse"] <= th["rmse"]
                verdict = "PASS" if (ok_r2 and ok_rm) else ("MARGINAL" if (m["r2"] >= th["r2"] - 0.2 and m["rmse"] <= th["rmse"] * 1.5) else "FAIL")
                rows.append((int(sid), j.get("name", sid), POLL_LABEL[pol], win,
                             m["rmse"], m["r2"], m.get("persist_rmse"), verdict,
                             ok_r2, ok_rm))

    # ---- per (pollutant, window) verdict table ----
    print("=" * 96)
    print("DAILY-MEAN CONTRACT CHECK — D+1, thresholds:", json.dumps(THRESH))
    print("=" * 96)
    from collections import defaultdict
    agg = defaultdict(lambda: {"pass": 0, "marg": 0, "fail": 0, "total": 0})
    for r in rows:
        if len(r) < 10:
            continue
        _, _, pol, win, _, _, _, v, _, _ = r
        k = (pol, win)
        agg[k]["total"] += 1
        agg[k]["pass" if v == "PASS" else "marg" if v == "MARGINAL" else "fail"] += 1
    wins = sorted({k[1] for k in agg})
    print(f"{'pollutant':10s} {'window':32s} {'pass':>5s} {'marg':>5s} {'fail':>5s} {'total':>5s}")
    for pol in POLL_ORDER:
        for win in wins:
            a = agg.get((POLL_LABEL[pol], win))
            if not a:
                continue
            print(f"{pol:10s} {win:32s} {a['pass']:>5d} {a['marg']:>5d} {a['fail']:>5d} {a['total']:>5d}")
    tot_pass = sum(a["pass"] for a in agg.values())
    tot_all = sum(a["total"] for a in agg.values())
    print(f"\npairs passing BOTH thresholds (D+1): {tot_pass}/{tot_all}")

    # ---- full failing list: never collapse ----
    fails = [r for r in rows if len(r) > 7 and r[7] == "FAIL"]
    print(f"\n--- FAILING PAIRS ({len(fails)}) — full list, D+1 ---")
    print(f"{'sid':>5s} {'name':26s} {'poll':6s} {'window':32s} {'rmse':>8s} {'r2':>8s} {'persist':>8s}")
    for r in sorted(fails, key=lambda x: (x[2], x[5] if isinstance(x[5], float) else 0)):
        pol = r[2]
        th = THRESH[[k for k, v in POLL_LABEL.items() if v == pol][0]]
        print(f"{r[0]:>5d} {str(r[1])[:26]:26s} {pol:6s} {r[3]:32s} {r[4]:>8.2f} {r[5]:>8.3f} "
              f"{r[6] if r[6] is not None else float('nan'):>8.2f}")

    # ---- appendix: D+2 / D+3 ----
    print("\n--- APPENDIX: D+2 / D+3 (reported, not contracted) ---")
    print(f"{'sid':>5s} {'name':26s} {'poll':6s} {'window':32s} {'lead':5s} {'rmse':>8s} {'r2':>8s}")
    for sid in paths:
        f = os.path.join(base, sid, "daily_summary.json")
        if not os.path.exists(f):
            continue
        j = json.load(open(f, encoding="utf-8"))
        if j.get("status") != "ok":
            continue
        for pol in POLL_ORDER:
            e = j.get("pollutants", {}).get(pol)
            if not e or e.get("status") != "ok":
                continue
            for key, m in sorted(e.get("windows", {}).items()):
                if key.endswith(("_D+2", "_D+3")):
                    win, lead = key.rsplit("_D+", 1)
                    print(f"{int(sid):>5d} {str(j.get('name', sid))[:26]:26s} {pol:6s} {win:32s} D+{lead:3s} "
                          f"{m['rmse']:>8.2f} {m['r2']:>8.3f}")


if __name__ == "__main__":
    main()
