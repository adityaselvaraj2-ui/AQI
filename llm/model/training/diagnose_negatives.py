"""Diagnose every negative-R2 (station, pollutant) pair individually.

For each failing pair, measures against the merged per-station dataset:
  1. history span + total hours (short history?)
  2. big gaps in the observation record (sensor dropout?)
  3. era-boundary discontinuity: does the station's level jump at 2022-09-01
     (CAMS era start / monitor recalibration)?  Compares the 6 months before
     vs after the boundary, and the 2015-18 era vs 2025-26 era mean.
  4. test-window variance vs sensor noise floor: if obs variance in the
     holdout is tiny (flat series), R2 is mathematically impossible to be
     high for any forecaster.

Writes training/diagnosis_negatives.json and prints a table.

  python diagnose_negatives.py
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))
MERGED_DIR = os.path.join(HERE, "data_merged")
SUMMARY = os.path.join(MODELS_DIR, "metrics_summary.json")

POLL_COLS = {"pm25": "pm25", "pm10": "pm10", "no2": "no2", "o3": "o3", "so2": "so2"}


def station_frame(sid: int) -> pd.DataFrame | None:
    import glob
    hits = glob.glob(os.path.join(MERGED_DIR, f"station_{sid}_*.csv"))
    if not hits:
        return None
    df = pd.read_csv(hits[0], parse_dates=["hour_utc"])
    df["hour_utc"] = df["hour_utc"].dt.tz_localize("UTC")
    df = df.sort_values("hour_utc").set_index("hour_utc")
    return df


def main() -> None:
    summary = json.load(open(SUMMARY, encoding="utf-8"))
    out = []

    for st in summary:
        sid, name = st["station_id"], st["name"]
        df = station_frame(sid)
        for poll, m in (st.get("pollutants") or {}).items():
            ov = m.get("overall") or {}
            r2 = ov.get("r2")
            if r2 is None or r2 >= 0.0:
                continue  # only diagnosing negative-R2 pairs

            diag = {"station_id": sid, "name": name, "pollutant": poll, "r2": r2}

            if df is None:
                diag["data"] = "merged csv missing"
                out.append(diag)
                continue

            col = POLL_COLS.get(poll)
            if col not in df.columns:
                diag["data"] = f"column {col} missing"
                out.append(diag)
                continue

            s = df[col].dropna()
            diag["hours_obs"] = int(len(s))
            diag["span"] = [str(s.index.min()), str(s.index.max())]

            # years with >= 1000 obs hours
            by_year = s.groupby(s.index.year).size()
            diag["hours_by_year"] = {int(k): int(v) for k, v in by_year.items() if v >= 1000}

            # largest gap
            if len(s) > 1:
                gaps = s.index.to_series().diff().dt.total_seconds() / 3600.0
                diag["max_gap_h"] = float(gaps.max())

            # era boundary discontinuity (2022-09-01: CAMS era start)
            b = pd.Timestamp("2022-09-01", tz="UTC")
            pre = s[(s.index >= b - pd.Timedelta(days=183)) & (s.index < b)]
            post = s[(s.index >= b) & (s.index < b + pd.Timedelta(days=183))]
            if len(pre) > 500 and len(post) > 500:
                diag["era_pre_mean"] = round(float(pre.mean()), 1)
                diag["era_post_mean"] = round(float(post.mean()), 1)
                diag["era_jump_pct"] = round(100.0 * (post.mean() - pre.mean()) / max(pre.mean(), 1e-9), 1)

            # 2015-18 vs 2025-26 level
            old = s[(s.index >= "2015") & (s.index < "2019")]
            new = s[(s.index >= "2025")]
            if len(old) > 500 and len(new) > 500:
                diag["old2015_18_mean"] = round(float(old.mean()), 1)
                diag["new2025_26_mean"] = round(float(new.mean()), 1)

            # holdout window = last 120 days of usable covariate span.
            # Approximate with the last 120 days of the observation series.
            tail = s.last("120D")
            diag["holdout_mean"] = round(float(tail.mean()), 1)
            diag["holdout_std"] = round(float(tail.std()), 1)
            # flatness: std/mean and the 10-90 pct spread
            if tail.mean() > 0:
                diag["holdout_cv"] = round(float(tail.std() / tail.mean()), 3)
            diag["holdout_p10"] = round(float(tail.quantile(0.10)), 1)
            diag["holdout_p90"] = round(float(tail.quantile(0.90)), 1)
            # step-like series detection: fraction of hours where |diff| is 0
            if len(tail) > 1000:
                d = tail.diff().dropna()
                diag["pct_zero_diff"] = round(100.0 * float((d == 0).mean()), 1)

            out.append(diag)

    with open(os.path.join(HERE, "diagnosis_negatives.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    print(f"{len(out)} negative-R2 pairs diagnosed -> diagnosis_negatives.json\n")
    print(f"{'station':<34} {'poll':<5} {'R2':>7} {'obsHrs':>7} {'years':<28} "
          f"{'maxGap':>7} {'eraJump%':>9} {'old18':>7} {'new26':>7} {'holdCV':>7}")
    for d in out:
        years = ",".join(str(y) for y in d.get("hours_by_year", {}))
        print(f"{d['name'][:33]:<34} {d['pollutant']:<5} {d['r2']:+7.2f} {d.get('hours_obs',0):>7} "
              f"{years[:28]:<28} {d.get('max_gap_h',0):>7.0f} {str(d.get('era_jump_pct','')):>9} "
              f"{str(d.get('old2015_18_mean','')):>7} {str(d.get('new2025_26_mean','')):>7} "
              f"{str(d.get('holdout_cv','')):>7}")


if __name__ == "__main__":
    main()
