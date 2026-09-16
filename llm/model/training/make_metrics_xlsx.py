"""Export the per-station holdout metrics to a formatted Excel workbook.

Output: llm/model/station_models/STATION_METRICS.xlsx
  - "Per-Station Metrics" sheet: one row per station x pollutant with
    MSE/RMSE/MAE/R2/bias; medians computed with live MEDIAN() formulas.
  - "Horizon Detail" sheet: PM2.5 RMSE/MAE/R2 at +1h/+6h/+24h/+48h/+72h marks.
"""
from __future__ import annotations

import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))
SUMMARY = os.path.join(MODELS_DIR, "metrics_summary.json")
OUT = os.path.join(MODELS_DIR, "STATION_METRICS.xlsx")

POLLUTANTS = [("pm25", "PM2.5"), ("pm10", "PM10"), ("no2", "NO2"), ("o3", "O3"), ("so2", "SO2")]
HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
HEADER_FONT = Font(name="Arial", bold=True, color="FFFFFF", size=10)
BODY_FONT = Font(name="Arial", size=10)
TITLE_FONT = Font(name="Arial", bold=True, size=12)


def main() -> None:
    rows = json.load(open(SUMMARY, encoding="utf-8"))
    wb = Workbook()

    # ── Sheet 1: per-station metrics ─────────────────────────────────────────
    ws = wb.active
    ws.title = "Per-Station Metrics"
    ws["A1"] = "Per-station 72-hour forecast holdout metrics (120-day chronological test, CO excluded)"
    ws["A1"].font = TITLE_FONT
    headers = ["Station", "ID", "Pollutant", "MSE", "RMSE (µg/m³)", "MAE (µg/m³)", "R²", "Bias (µg/m³)", "n"]
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=3, column=c, value=h)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(horizontal="center")

    r = 4
    n_rows = 0
    for st in sorted(rows, key=lambda x: x.get("name", "")):
        for key, label in POLLUTANTS:
            p = st.get("pollutants", {}).get(key)
            if not p or not p.get("overall"):
                continue
            o = p["overall"]
            vals = [st.get("name"), st.get("station_id"), label,
                    o["mse"], o["rmse"], o["mae"], o["r2"], o["bias"], o["n"]]
            for c, v in enumerate(vals, 1):
                cell = ws.cell(row=r, column=c, value=v)
                cell.font = BODY_FONT
                if c >= 4:
                    cell.number_format = "0.000" if c != 9 else "0"
            r += 1
            n_rows += 1
    last = r - 1

    # medians as live formulas over the data block
    r += 1
    ws.cell(row=r, column=1, value="Median across stations").font = Font(name="Arial", bold=True, size=10)
    med_row = r
    r += 1
    for key, label in POLLUTANTS:
        col_letters = {}
        # column offsets: D..I hold mse..n
        ws.cell(row=r, column=3, value=label).font = BODY_FONT
        for c, stat in zip(range(4, 9), ("mse", "rmse", "mae", "r2", "bias")):
            col = get_column_letter(c)
            f = (f"=MEDIAN(IF($C$4:$C${last}=\"{label}\",{col}4:{col}{last}))")
            cell = ws.cell(row=r, column=c, value=f)
            cell.font = BODY_FONT
            cell.number_format = "0.000"
        ws.cell(row=r, column=2, value="median").font = BODY_FONT
        r += 1
    for c, w in zip(range(1, 10), (26, 8, 9, 12, 13, 13, 9, 13, 9)):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "A4"

    # ── Sheet 2: horizon detail (error growth) ───────────────────────────────
    ws2 = wb.create_sheet("Horizon Detail")
    ws2["A1"] = "Error growth by forecast horizon (RMSE/MAE/R², per station, PM2.5 & PM10)"
    ws2["A1"].font = TITLE_FONT
    headers2 = ["Station", "Pollutant", "+1h RMSE", "+6h RMSE", "+24h RMSE", "+48h RMSE", "+72h RMSE",
                "+1h MAE", "+6h MAE", "+24h MAE", "+48h MAE", "+72h MAE",
                "+1h R²", "+6h R²", "+24h R²", "+48h R²", "+72h R²"]
    for c, h in enumerate(headers2, 1):
        cell = ws2.cell(row=3, column=c, value=h)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
    r2 = 4
    for st in sorted(rows, key=lambda x: x.get("name", "")):
        for key, label in (("pm25", "PM2.5"), ("pm10", "PM10")):
            p = st.get("pollutants", {}).get(key)
            if not p or not p.get("marks"):
                continue
            marks = p["marks"]
            vals = [st.get("name"), label]
            for stat in ("rmse", "mae", "r2"):
                for h in ("1", "6", "24", "48", "72"):
                    m = marks.get(h)
                    vals.append(m[stat] if m else None)
            for c, v in enumerate(vals, 1):
                cell = ws2.cell(row=r2, column=c, value=v)
                cell.font = BODY_FONT
                if c >= 3:
                    cell.number_format = "0.000"
            r2 += 1
    for c in range(1, 18):
        ws2.column_dimensions[get_column_letter(c)].width = 11
    ws2.column_dimensions["A"].width = 26
    ws2.freeze_panes = "C4"

    wb.save(OUT)
    print(f"-> {OUT} ({n_rows} station-pollutant rows)")


if __name__ == "__main__":
    main()
