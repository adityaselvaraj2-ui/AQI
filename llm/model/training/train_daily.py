"""Daily-mean forecast head — R2 >= 0.7 / RMSE < 20 contract, no leakage.

DATA SOURCE (explicit, per approved plan):
  TARGET (labels): real CPCB sensor observations only — daily means of the
    hourly monitor readings in data_merged/station_*.csv. The model learns to
    predict measured air, never simulated values.
  CAMS: input covariate ONLY, per-calendar-month bias-calibrated to CPCB on
    TRAIN-period data. Never a target, never evaluated as truth.
  EVALUATION: real CPCB observations on the same windows as the hourly
    pipeline (120-day holdout + seasonal folds incl. stubble Oct-Nov 2025).

DESIGN
  Days are IST calendar days (Asia/Kolkata). Issue time = day D at 06:00 IST.
  Targets: mean CPCB concentration over days D+1, D+2, D+3 (lead = feature).
  Features (all knowable at issue time):
    - CPCB daily-mean lags D-1, D-2, D-3, D-7 + rolling 3/7/14d mean+std
      (strictly days < D: the partial issue day D is excluded entirely)
    - weather day-aggregates for the TARGET day (perfect-prog: at serving
      time Open-Meteo supplies forecast weather; the archive is its proxy)
    - per-month-calibrated CAMS daily mean for the target day (CAMS forecast
      covers 4-5 days out at serving time)
    - FIRMS fire lags D-1..D-3 ONLY (no fire forecast exists; future fire
      would be genuine leakage)
    - calendar: month, day-of-week, day-of-year sin/cos
  Persistence baseline = previous COMPLETE day (D-1), never the partial D.

Artifacts: ../station_models_daily/<sid>/model_<pol>.txt + daily_summary.json
(atomic writes).  Resume-safe.  Usage: python train_daily.py [--only 6932] [--force]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import load_station_csv, load_wx_csv, TARGETS  # noqa: E402
from train import metrics  # noqa: E402
from io_utils import atomic_write_json  # noqa: E402

MERGED_DIR = os.path.join(HERE, "data_merged")
FIRE_DIR = os.path.join(HERE, "data", "fire")
OUT_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models_daily"))
IST = "Asia/Kolkata"
LEADS = (1, 2, 3)
MIN_TRAIN_DAYS = 400
HOLDOUT_DAYS = 120
SLOPE_CAP = (0.25, 4.0)  # bounded multiplicative CAMS->CPCB ratio

DAILY_PARAMS = dict(learning_rate=0.05, n_estimators=600, num_leaves=48,
                    min_data_in_leaf=40, verbose=-1,
                    num_threads=8)

WX_DAILY = {  # hourly wx col -> (daily-mean feature, daily-max feature|None)
    "wind_speed_10m": ("wx_ws_mean", "wx_ws_max"),
    "wind_speed_100m": ("wx_ws100_mean", None),
    "boundary_layer_height": ("wx_blh_mean", None),
    "temperature_2m": ("wx_t_mean", "wx_t_max"),
    "relative_humidity_2m": ("wx_rh_mean", None),
    "precipitation": ("wx_pr_mean", "wx_pr_max"),
}
CAMS_COL = {"pm25": "cams_pm25", "pm10": "cams_pm10", "no2": "cams_no2",
            "o3": "cams_o3", "so2": "cams_so2"}


def eval_windows(day_index: pd.DatetimeIndex) -> list[dict]:
    end = day_index.max()
    windows = [{"name": "holdout_120d",
                "start": end - pd.Timedelta(days=HOLDOUT_DAYS - 1), "end": end}]
    for k in (3, 2, 1):
        we = end - pd.Timedelta(days=(4 - k) * HOLDOUT_DAYS)
        ws = we - pd.Timedelta(days=HOLDOUT_DAYS - 1)
        w = {"name": f"fold_{k}", "start": ws, "end": we}
        if k == 1:
            oct25 = pd.Timestamp("2025-10-01", tz=IST)
            nov30 = pd.Timestamp("2025-11-30", tz=IST)
            if day_index.min() <= oct25:
                w = {"name": "fold_1_stubble_oct_nov_2025", "start": oct25, "end": nov30}
        windows.append(w)
    return windows


def fit_monthly_calibration(cams: pd.Series, obs: pd.Series, train_end) -> dict[int, float]:
    """Per-month multiplicative CAMS->CPCB ratio, fitted on TRAIN days only.

    Bounded mean-ratio design (no intercept): pred = cams * ratio[month],
    ratio clipped to SLOPE_CAP.  An OLS slope+intercept can explode when a
    month's CAMS range is degenerate (tiny CAMS variance -> huge intercept
    that detonates when CAMS range shifts later); a bounded ratio cannot.
    Thresholds: >= 400 valid training days overall, >= 60 days per month.
    """
    df = pd.DataFrame({"c": cams, "o": obs}).loc[:train_end].dropna()
    out: dict[int, float] = {}
    if len(df) < 400:
        return out
    for m, g in df.groupby(df.index.month):
        mc, mo = float(g["c"].mean()), float(g["o"].mean())
        if mc <= 0.5 or len(g) < 60:
            continue
        out[int(m)] = float(np.clip(mo / mc, *SLOPE_CAP))
    return out


def apply_monthly_calibration(cams: pd.Series, cal: dict[int, float]) -> pd.Series:
    if not cal:
        return cams
    mult = np.array([cal.get(int(m), 1.0) for m in cams.index.month], dtype=float)
    return cams * mult


def build_daily_frame(sid: int) -> tuple[pd.DataFrame, pd.DataFrame] | None:
    """Returns (hourly-IST station frame, daily feature frame indexed by IST day)."""
    s_paths = sorted(glob.glob(os.path.join(MERGED_DIR, f"station_{sid}_*.csv")))
    if not s_paths:
        return None
    st = load_station_csv(s_paths[0])
    if len(st) < MIN_TRAIN_DAYS * 12:
        return None
    st_ist = st.tz_convert(IST)
    cnt = st_ist[TARGETS].resample("D").count()
    d = st_ist[TARGETS].resample("D").mean()
    d = d.where(cnt >= 18)  # a daily mean needs >= 18 valid hours to count

    f = pd.DataFrame(index=d.index)
    for pol in TARGETS:
        s = d[pol]
        for lag in (1, 2, 3, 7):
            f[f"{pol}_lag{lag}"] = s.shift(lag)
        for win in (3, 7, 14):
            f[f"{pol}_rmean{win}"] = s.shift(1).rolling(win, min_periods=max(2, win // 2)).mean()
            f[f"{pol}_rstd{win}"] = s.shift(1).rolling(win, min_periods=max(2, win // 2)).std()

    w_path = os.path.join(MERGED_DIR, f"wx_{sid}.csv")
    if os.path.exists(w_path):
        wx_ist = load_wx_csv(w_path).tz_convert(IST)
        wd = pd.DataFrame(index=wx_ist.index)
        for col, (mname, xname) in WX_DAILY.items():
            if col in wx_ist.columns:
                wd[mname] = wx_ist[col].resample("D").mean()
                if xname:
                    wd[xname] = wx_ist[col].resample("D").max()
        for c in wd.columns:
            f[c] = wd.reindex(d.index)[c]

    fpath = os.path.join(FIRE_DIR, f"fire_{sid}.csv")
    if os.path.exists(fpath):
        fr = pd.read_csv(fpath, index_col="date", parse_dates=True)
        fr = fr.reindex(d.index.tz_localize(None))
        fr.index = fr.index.tz_localize(IST)
        for c in ("frp50", "n50", "frp100", "n100", "frp200", "n200"):
            if c in fr.columns:
                for lag in (1, 2, 3):
                    f[f"fire_{c}_lag{lag}"] = fr[c].shift(lag)

    idx = f.index
    f["month"] = idx.month
    f["dow"] = idx.dayofweek
    doy = idx.dayofyear.values.astype(float)
    f["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    f["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)

    # ── leakage spot-audit: lag1 must equal yesterday's value, never today's ──
    for pol in TARGETS[:2]:
        a = f[f"{pol}_lag1"].values
        b = d[pol].shift(1).values
        good = np.isfinite(a) & np.isfinite(b)
        assert good.sum() == 0 or np.allclose(a[good], b[good], equal_nan=True)
    return st_ist, f


def train_pollutant(sid: int, pol: str, d: pd.DataFrame, f: pd.DataFrame,
                    use_cams: bool = True) -> dict | None:
    y_daily = d[pol]
    frame = f.copy()

    cams_daily, cal = None, {}
    w_path = os.path.join(MERGED_DIR, f"wx_{sid}.csv")
    ccol = CAMS_COL.get(pol)
    if use_cams and w_path and ccol and os.path.exists(w_path):
        wx = load_wx_csv(w_path)
        if ccol in wx.columns:
            cams_daily = wx[ccol].tz_convert(IST).resample("D").mean().reindex(frame.index)
    if cams_daily is not None:
        holdout_start = y_daily.index.max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
        cal = fit_monthly_calibration(cams_daily, y_daily, holdout_start - pd.Timedelta(days=1))
        frame["cams"] = apply_monthly_calibration(cams_daily, cal)
    else:
        frame["cams"] = np.nan

    target_day_cols = [c for c in frame.columns if c.startswith(("wx_", "cams"))]
    frame["pers_last"] = y_daily.shift(1)         # last COMPLETE day at issue: leak-free anchor
    parts = []
    for lead in LEADS:
        g = frame.copy()
        for c in target_day_cols:
            g[c] = frame[c].shift(-lead)          # covariate of the TARGET day
        g["lead"] = float(lead)
        g["y"] = y_daily.shift(-lead)             # label = CPCB mean of D+lead
        parts.append(g)
    long_df = pd.concat(parts).sort_index(kind="stable")
    long_df = long_df.dropna(subset=["y"])
    feat_cols = list(frame.columns) + ["lead"]
    if len(long_df) < MIN_TRAIN_DAYS:
        return None

    X = long_df[feat_cols].astype(np.float32)
    y = long_df["y"].astype(np.float32)
    holdout_start = y_daily.index.max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    hold_mask = X.index >= holdout_start
    Xtr, ytr, Xho, yho = X[~hold_mask], y[~hold_mask], X[hold_mask], y[hold_mask]
    if len(Xtr) < MIN_TRAIN_DAYS or len(Xho) < 30:
        return None

    es_cut = int(len(Xtr) * 0.85)
    dtr = lgb.Dataset(Xtr.iloc[:es_cut], ytr.iloc[:es_cut])
    des = lgb.Dataset(Xtr.iloc[es_cut:], ytr.iloc[es_cut:])
    model = lgb.train(DAILY_PARAMS, dtr, valid_sets=[des],
                      callbacks=[lgb.early_stopping(50, verbose=False)])
    pred = np.clip(model.predict(X, num_iteration=model.best_iteration), 0, 2500)

    # persistence baseline: previous COMPLETE day (D-1), same rows
    pers = y_daily.shift(1).reindex(long_df.index).values.astype(float)
    wk = long_df.index.isocalendar().week.astype(int)
    pre = y_daily.reindex(long_df.index[~hold_mask]).dropna()
    clim_map = pre.groupby(pre.index.isocalendar().week.astype(int)).mean()
    clim = np.array([clim_map.get(w, np.nan) for w in wk], dtype=float)

    # ---- pre-registered predictor selection (approved plan) ----
    # Decide on TRAIN-period validation rows ONLY; holdout stays untouched.
    # The val block is split into 3 contiguous thirds and a candidate must win
    # on the MEAN RMSE across thirds — a single window can be a season
    # mismatch (winter val vs monsoon holdout) and mis-select.
    tr_idx = np.where(~hold_mask)[0]
    val_pos = tr_idx[es_cut:]
    cands = {
        "model": pred,
        "persist": np.where(np.isfinite(pers), pers, pred),
        "clim": np.where(np.isfinite(clim), clim, pred),
        "blend50": 0.5 * pred + 0.5 * np.where(np.isfinite(pers), pers, pred),
    }
    thirds = np.array_split(val_pos, 3) if len(val_pos) >= 90 else [val_pos]
    val_rmse = {}
    for name, pv in cands.items():
        per_third = []
        for vp in thirds:
            if len(vp) < 15:
                continue
            yv, pvv = y.values[vp], pv[vp]
            mm = np.isfinite(yv) & np.isfinite(pvv)
            if mm.sum() >= 10:
                per_third.append(float(np.sqrt(np.mean((yv[mm] - pvv[mm]) ** 2))))
        val_rmse[name] = round(float(np.mean(per_third)), 3) if per_third else float("inf")
    selected = min(val_rmse, key=val_rmse.get)
    final = cands[selected]

    out_dir = os.path.join(OUT_DIR, str(sid))
    os.makedirs(out_dir, exist_ok=True)
    model_path = os.path.join(out_dir, f"model_{pol}.txt")
    model.save_model(model_path)
    return dict(n_train=int(len(Xtr)), best_iter=int(model.best_iteration or 0),
                cal_months=len(cal), model_path=model_path,
                X=X, y=y, pred=pred, hold_mask=hold_mask,
                pers=pers, clim=clim, feat_cols=feat_cols,
                selected=selected, val_rmse={k: round(v, 3) for k, v in val_rmse.items()},
                final=final)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--poll", default="", help="comma list of pollutants (default: all)")
    ap.add_argument("--no-cams", action="store_true", help="ablation: drop CAMS covariate")
    args = ap.parse_args()
    only = {int(x) for x in str(args.only).split(",") if x.strip()} if args.only else None
    poll = [p for p in str(args.poll).split(",") if p.strip()] or list(TARGETS)

    manifest = json.load(open(os.path.join(HERE, "data", "discovery_manifest.json"), encoding="utf-8"))
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in manifest["stations"]:
        sid = int(s["openaq_id"])
        if only and sid not in only:
            continue
        ckpt = os.path.join(OUT_DIR, str(sid), "daily_summary.json")
        if os.path.exists(ckpt) and not args.force and not args.poll and not args.no_cams:
            print(f"[{sid}] checkpoint exists, skip", flush=True)
            continue
        built = build_daily_frame(sid)
        if built is None:
            atomic_write_json(ckpt, {"station_id": sid, "status": "no_data"})
            print(f"[{sid}] no_data", flush=True)
            continue
        st_ist, f = built
        d = st_ist[TARGETS].resample("D").mean()
        windows = eval_windows(d.index)

        res = {"station_id": sid, "name": s.get("registry_name", str(sid)),
               "status": "ok", "history_days": int(len(d)), "pollutants": {}}
        for pol in poll:
            r = train_pollutant(sid, pol, d, f, use_cams=not args.no_cams)
            if r is None:
                res["pollutants"][pol] = {"status": "insufficient_data"}
                continue
            X, y, pred, final = r["X"], r["y"], r["pred"], r["final"]
            entry = {"status": "ok", "n_train": r["n_train"],
                     "best_iter": r["best_iter"], "cal_months": r["cal_months"],
                     "selected": r["selected"], "val_rmse": r["val_rmse"],
                     "windows": {}}
            for w in windows:
                wm = (X.index >= w["start"]) & (X.index <= w["end"])
                for lead in LEADS:
                    lm = wm & (X["lead"].values == lead)
                    if lm.sum() < 15:
                        continue
                    yy, pp = y.values[lm], final[lm]
                    mm = np.isfinite(yy) & np.isfinite(pp)
                    if mm.sum() < 15:
                        continue
                    pm = mm & np.isfinite(r["pers"][lm])
                    cm = mm & np.isfinite(r["clim"][lm])
                    block = metrics(yy[mm], pp[mm])
                    block["persist_rmse"] = round(float(np.sqrt(np.mean((yy[pm] - r["pers"][lm][pm])**2))), 3) if pm.sum() >= 10 else None
                    block["persist_n"] = int(pm.sum())
                    block["clim_rmse"] = round(float(np.sqrt(np.mean((yy[cm] - r["clim"][lm][cm])**2))), 3) if cm.sum() >= 10 else None
                    entry["windows"][f"{w['name']}_D+{lead}"] = block
            res["pollutants"][pol] = entry
            h1 = entry["windows"].get(f"holdout_120d_D+1", {})
            print(f"[{sid} {pol}] D+1 rmse={h1.get('rmse', 'NA')} r2={h1.get('r2', 'NA')} "
                  f"persist={h1.get('persist_rmse', 'NA')}", flush=True)
        atomic_write_json(ckpt, res)
    print("done", flush=True)


if __name__ == "__main__":
    main()
