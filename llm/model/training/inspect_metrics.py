"""Quick per-station/per-horizon metrics inspection for the training run."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "llm/model/station_models/metrics_summary.json"
only = sys.argv[2] if len(sys.argv) > 2 else None
pollutant = sys.argv[3] if len(sys.argv) > 3 else "pm25"

rows = json.load(open(path, encoding="utf-8"))
shown = 0
for st in rows:
    if st.get("status") != "ok":
        continue
    if only and st["name"].lower() != only.lower():
        continue
    polls = st.get("pollutants", {})
    p = polls.get(pollutant)
    if not p or p.get("status") != "ok":
        continue
    o = p["overall"]
    print(f"{st['name']}: overall RMSE {o['rmse']} MAE {o['mae']} R2 {o['r2']} bias {o['bias']} "
          f"(n={o['n']}, iters={p.get('best_iteration')})")
    for h in ("1", "6", "12", "24", "48", "72"):
        m = p.get("marks", {}).get(h)
        if m:
            print(f"   +{h:>2}h: RMSE {m['rmse']:>8} MAE {m['mae']:>8} R2 {m['r2']:>8} bias {m['bias']}")
    shown += 1
if not shown:
    print("no matching rows")
