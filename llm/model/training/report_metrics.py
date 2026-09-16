"""Generate the final per-station metrics report from metrics_summary.json.

Writes:
  llm/model/station_models/METRICS.md  — human-readable per-station table
  (also prints the same table to stdout)

  python report_metrics.py
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))
SUMMARY = os.path.join(MODELS_DIR, "metrics_summary.json")
OUT = os.path.join(MODELS_DIR, "METRICS.md")

TARGET_LABEL = {"pm25": "PM2.5", "pm10": "PM10", "no2": "NO2", "o3": "O3", "so2": "SO2"}
POLLUTANT_UNITS = {"pm25": "µg/m³", "pm10": "µg/m³", "no2": "µg/m³", "o3": "µg/m³", "so2": "µg/m³"}


def fmt(v, nd=2):
    if v is None or (isinstance(v, float) and v != v):
        return "—"
    return f"{v:.{nd}f}"


def main() -> None:
    with open(SUMMARY, encoding="utf-8") as f:
        rows = json.load(f)

    lines = []
    lines.append("# Per-Station Model Metrics — 72-hour forecast holdout\n")
    lines.append("One LightGBM model per (station, pollutant), fine-tuned from the pooled NCR")
    lines.append("global model on that station's own full archive history. Metrics are computed")
    lines.append("on a **120-day chronological holdout** (the most recent 120 days of the")
    lines.append("station's record, never seen in training, no shuffling). CO is excluded by design.\n")
    lines.append("Units: µg/m³. Bias = mean(pred − observed); 0 is perfect.\n")

    for st in rows:
        sid, name = st.get("station_id"), st.get("name")
        lines.append(f"\n## {name} (station {sid})\n")
        polls = st.get("pollutants", {})
        if st.get("status") != "ok" or not polls:
            lines.append(f"_status: {st.get('status', 'unknown')}_\n")
            continue
        lines.append("| Pollutant | MSE | RMSE | MAE | R² | Bias | n |")
        lines.append("|---|---|---|---|---|---|---|")
        for col in ("pm25", "pm10", "no2", "o3", "so2"):
            p = polls.get(col)
            if not p or not p.get("overall"):
                lines.append(f"| {TARGET_LABEL[col]} | insuff. data | | | | | |")
                continue
            o = p["overall"]
            lines.append(
                f"| {TARGET_LABEL[col]} | {fmt(o['mse'])} | {fmt(o['rmse'])} | {fmt(o['mae'])} "
                f"| {fmt(o['r2'], 3)} | {fmt(o['bias'])} | {o['n']} |")
        # horizon degradation for the flagship pollutant
        p25 = polls.get("pm25") or polls.get("pm10") or next(iter(polls.values()))
        if p25 and p25.get("overall") and p25.get("marks"):
            flagship = "PM2.5" if "pm25" in polls else TARGET_LABEL.get(next(iter(polls)), "")
            lines.append(f"\n**{flagship} error growth by forecast horizon** (RMSE µg/m³ · MAE µg/m³ · R²):\n")
            lines.append("| +h | RMSE | MAE | R² | bias |")
            lines.append("|---|---|---|---|---|")
            for h in ("1", "6", "12", "24", "48", "72"):
                m = p25["marks"].get(h)
                if m:
                    lines.append(f"| {h}h | {fmt(m['rmse'])} | {fmt(m['mae'])} | {fmt(m['r2'], 3)} | {fmt(m['bias'])} |")

    # aggregate summary
    lines.append("\n\n## Aggregate across stations\n")
    lines.append("| Pollutant | median RMSE | median MAE | median R² | median bias | stations |")
    lines.append("|---|---|---|---|---|---|")
    agg = {}
    for col in ("pm25", "pm10", "no2", "o3", "so2"):
        vals = {"rmse": [], "mae": [], "r2": [], "bias": []}
        n = 0
        for st in rows:
            p = st.get("pollutants", {}).get(col)
            if p and p.get("overall"):
                o = p["overall"]
                for k in vals:
                    if o.get(k) == o.get(k):  # not NaN
                        vals[k].append(o[k])
                n += 1
        if n:
            med = {k: sorted(v)[len(v) // 2] if v else float("nan") for k, v in vals.items()}
            agg[col] = med
            lines.append(
                f"| {TARGET_LABEL[col]} | {fmt(med['rmse'])} | {fmt(med['mae'])} "
                f"| {fmt(med['r2'], 3)} | {fmt(med['bias'])} | {n} |")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    try:
        print("\n".join(lines))
    except UnicodeEncodeError:  # Windows console (cp1252): strip non-latin1 glyphs
        import sys
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print("\n".join(lines))
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
