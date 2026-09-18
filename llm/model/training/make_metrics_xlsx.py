"""Export the per-station holdout metrics to a formatted Excel workbook.

Output: llm/model/station_models/STATION_METRICS.xlsx
  - "Per-Station Metrics" sheet: one row per station x pollutant with
    MSE/RMSE/MAE/R2/bias.  The "Median across stations" rows are written as
    STATIC VALUES (baked at generation time) — MEDIAN(IF()) dynamic arrays
    render blank outside Excel 2019+/365, so the workbook must not depend on
    them.  Data cells are literals anyway (the workbook is a report, not a
    model).  The script verifies itself by re-opening the file with openpyxl
    and printing the baked median rows.
  - "Horizon Detail" sheet: RMSE/MAE/R2 at +1-6h / +24h / +48-72h / +96h /
    +120h / +144-168h bands per station (PM2.5/PM10)
    station for PM2.5 & PM10.
"""
from __future__ import annotations

import json
import os
import statistics

from openpyxl import Workbook, load_workbook
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
MEDIAN_FONT = Font(name="Arial", size=10, bold=True, color="007000")
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
    per_poll = {label: {k: [] for k in ("mse", "rmse", "mae", "r2", "bias")} for _, label in POLLUTANTS}
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
            for k in per_poll[label]:
                per_poll[label][k].append(o[k])
            r += 1
            n_rows += 1
    last = r - 1

    # median rows: STATIC baked values (verified after save) — not formulas,
    # because MEDIAN(IF()) renders blank outside Excel 2019+/365
    r += 1
    ws.cell(row=r, column=1, value="Median across stations (static values baked at generation)").font = \
        Font(name="Arial", bold=True, size=10, italic=True)
    r += 1
    medians_baked = {}
    for key, label in POLLUTANTS:
        if not per_poll[label]["rmse"]:
            continue
        ws.cell(row=r, column=2, value="median").font = BODY_FONT
        ws.cell(row=r, column=3, value=label).font = BODY_FONT
        med = {}
        for c, stat in zip(range(4, 9), ("mse", "rmse", "mae", "r2", "bias")):
            v = round(float(statistics.median(per_poll[label][stat])), 3)
            med[stat] = v
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = MEDIAN_FONT
            cell.number_format = "0.000"
        medians_baked[label] = med
        r += 1
    for c, w in zip(range(1, 10), (26, 8, 9, 12, 13, 13, 9, 13, 9)):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "A4"

    # ── Sheet 2: horizon-band detail ─────────────────────────────────────────
    ws2 = wb.create_sheet("Horizon Detail")
    ws2["A1"] = "Error growth by horizon band (RMSE/MAE/R²; blended artifact where it wins, else model-only)"
    ws2["A1"].font = TITLE_FONT
    headers2 = ["Station", "Pollutant",
                "1-6h RMSE", "24h RMSE", "48-72h RMSE", "96h RMSE", "120h RMSE", "144-168h RMSE",
                "1-6h MAE", "24h MAE", "48-72h MAE", "96h MAE", "120h MAE", "144-168h MAE",
                "1-6h R²", "24h R²", "48-72h R²", "96h R²", "120h R²", "144-168h R²"]
    for c, h in enumerate(headers2, 1):
        cell = ws2.cell(row=3, column=c, value=h)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
    r2 = 4
    for st in sorted(rows, key=lambda x: x.get("name", "")):
        for key, label in (("pm25", "PM2.5"), ("pm10", "PM10")):
            p = st.get("pollutants", {}).get(key)
            if not p or not p.get("overall"):
                continue
            bands = (p.get("bands_blended") if p.get("blend_used") else p.get("bands_model")) \
                or p.get("bands_model") or p.get("bands_blended") or {}
            if not bands:
                continue
            vals = [st.get("name"), label]
            for stat in ("rmse", "mae", "r2"):
                for band in ("1-6h", "24h", "48-72h", "96h", "120h", "144-168h"):
                    m = bands.get(band)
                    vals.append(m[stat] if m else None)
            for c, v in enumerate(vals, 1):
                cell = ws2.cell(row=r2, column=c, value=v)
                cell.font = BODY_FONT
                if c >= 3:
                    cell.number_format = "0.000"
            r2 += 1
    for c in range(1, 21):
        ws2.column_dimensions[get_column_letter(c)].width = 12
    ws2.column_dimensions["A"].width = 26
    ws2.freeze_panes = "C4"

    wb.save(OUT)
    print(f"-> {OUT} ({n_rows} station-pollutant rows)")

    # ── self-verification: reopen and print the baked median rows ───────────
    wb2 = load_workbook(OUT, read_only=True, data_only=True)
    ws1 = wb2["Per-Station Metrics"]
    print("\nVERIFICATION — median rows as read back from the saved file:")
    found = False
    for row in ws1.iter_rows(min_col=2, max_col=8, values_only=True):
        if row[0] == "median":
            found = True
            print(f"  median {row[1]:<6} MSE {row[2]:>10.3f}  RMSE {row[3]:>7.3f}  "
                  f"MAE {row[4]:>7.3f}  R2 {row[5]:>7.3f}  bias {row[6]:>+8.3f}")
    wb2.close()
    if not found:
        raise SystemExit("SELF-VERIFICATION FAILED: no baked median rows found in the saved workbook")
    print("SELF-VERIFICATION OK: medians are static values readable without Excel formulas")


if __name__ == "__main__":
    main()
