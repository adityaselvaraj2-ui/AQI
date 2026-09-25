"""Layout adapter: chronos summary -> production metrics_summary format.

This exists ONLY so the UNMODIFIED contract_check.py can read the Chronos
candidate summary. It changes no thresholds, no scoring, no aggregation —
it is purely a format translation (R3 compliance).

The one derived quantity: `overall.bias` = mean(pred - y), computed from the
per-origin prediction dumps (preds_<poll>/<sid>.json) — the exact same
(y, pred) pairs the summary's rmse/mae/r2 were computed from.

Output: station_models_chronos2/metrics_summary_contract_format.json
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
C2 = os.path.join(ROOT, "station_models_chronos2")


def main() -> None:
    with open(os.path.join(C2, "metrics_summary.json"), encoding="utf-8") as f:
        rows = json.load(f)

    # bias per (sid, poll) from per-origin dumps, when available
    bias_cache: dict[tuple[int, str], float] = {}
    for poll_dir in sorted(os.listdir(C2)):
        if not poll_dir.startswith("preds_"):
            continue
        poll = poll_dir[len("preds_"):]
        pdir = os.path.join(C2, poll_dir)
        for fn in sorted(os.listdir(pdir)):
            if not fn.endswith(".json"):
                continue
            sid = int(fn.split(".")[0])
            with open(os.path.join(pdir, fn), encoding="utf-8") as f:
                dump = json.load(f)
            diffs = []
            for origin in (dump.get("origins") or {}).values():
                for y, p in zip(origin.get("ys") or [], origin.get("ps") or []):
                    if y is not None and p is not None:
                        diffs.append(p - y)
            if diffs:
                bias_cache[(sid, poll)] = sum(diffs) / len(diffs)

    stations: dict[int, dict] = {}
    for r in rows:
        sid, poll = int(r["station_id"]), r["pollutant"]
        ov = r.get("overall") or {}
        if ov.get("n", 0) == 0:
            continue
        st = stations.setdefault(sid, {"station_id": sid, "name": r["name"],
                                       "status": "ok", "pollutants": {}})
        st["pollutants"][poll] = {
            "overall": {
                "rmse": ov["rmse"], "mae": ov["mae"], "r2": ov["r2"], "n": ov["n"],
                "bias": bias_cache.get((sid, poll), float("nan")),
            },
            "bands_model": r.get("bands") or {},
            "blend_used": False,  # chronos candidate is evaluated raw, no blend
        }

    out = os.path.join(C2, "metrics_summary_contract_format.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(list(stations.values()), f, indent=1)
    print(f"wrote {out}: {len(stations)} stations, "
          f"{sum(len(s['pollutants']) for s in stations.values())} pairs, "
          f"{sum(1 for v in bias_cache.values())} biases from dumps, "
          f"{sum(1 for s in stations.values() for m in s['pollutants'].values() if m['overall']['bias'] != m['overall']['bias'])} NaN biases")


if __name__ == "__main__":
    main()
