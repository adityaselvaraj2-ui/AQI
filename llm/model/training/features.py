"""Horizon-conditioned feature engineering for per-station pollutant forecast models.

Every training sample is a (issue_time T0, horizon h in 1..72) pair; the target is
the station observation at T0+h.  Features use ONLY information available at
issue time T0 — exactly what the live service will have:

  A. station-observation memory at T0: lags 1..168h, rolling mean/std, value at T0
  B. CAMS at the target hour T0+h:     the +72h CAMS forecast field (keyless)
  C. CAMS memory at T0:                level + lag24 of CAMS at the station
  D. HRES weather at T0+h (forecast) and at T0 (analysis), plus wind vectors
  E. calendar at the TARGET hour:      IST hour-of-day, day-of-year, season flags
  F. FIRE at T0 (FIRMS, day-granular): FRP/pixel counts within 50/100/200 km and
                                       upwind-weighted 100/200 km, as of YESTERDAY
                                       (archive availability), level + log1p +
                                       lag7 + fire-season flag.  Fires are the
                                       primary Oct–Dec PM driver in NCR.

Sample validity mask (drop-garbage rules, applied identically in training and
evaluable per sample):
  1. target and {col}_now must exist
  2. neither may sit at the CAPS clip plateau (sensor-garbage artefact)
  3. log-space 24h jump of the anchor within 2.5 + 4·σ_log — rejects monitor
     re-zero/reboot spikes while keeping every real pollution episode
     (a 150→450 µg/m³ episode jump is ~2σ_log; a sensor artefact is >6σ_log)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

TARGETS = ["pm25", "pm10", "no2", "o3", "so2"]
HRES_COLS = [
    "temperature_2m", "relative_humidity_2m", "precipitation", "cloud_cover",
    "surface_pressure", "wind_speed_10m", "wind_direction_10m", "wind_speed_100m",
    "boundary_layer_height",
]
FIRE_COLS = ["frp50", "n50", "frp100", "n100", "frp200", "n200", "frpup100", "nup100",
             "frpup200", "nup200"]

OBS_LAGS = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168]
OBS_ROLLS = [6, 24, 72, 168]

CAPS = {"pm25": 1500, "pm10": 2000, "no2": 400, "o3": 400, "so2": 500}

# horizon bands for reporting: near-term / day-ahead / long-lead
HORIZON_BANDS = {"1-6h": range(1, 7), "24h": range(22, 27), "48-72h": range(48, 73)}


def horizon_band(h: int) -> str:
    for name, rng in HORIZON_BANDS.items():
        if h in rng:
            return name
    return "other"


def _parse_hours(series: pd.Series) -> pd.DatetimeIndex:
    ts = pd.to_datetime(series, format="%Y-%m-%dT%H", utc=True)
    return pd.DatetimeIndex(ts)


def load_station_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.index = _parse_hours(df["hour_utc"])
    return df.drop(columns=["hour_utc"]).sort_index()


def load_wx_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    try:
        df.index = _parse_hours(df["hour_utc"])
    except ValueError:  # Open-Meteo writes full ISO stamps (…T00:00)
        df.index = pd.DatetimeIndex(pd.to_datetime(df["hour_utc"], format="ISO8601", utc=True))
    # namespace CAMS concentrations so they never collide with station observations
    # (handles both Open-Meteo raw names and short names)
    rename = {
        "pm2_5": "cams_pm25", "pm25": "cams_pm25",
        "pm10": "cams_pm10",
        "nitrogen_dioxide": "cams_no2", "no2": "cams_no2",
        "ozone": "cams_o3", "o3": "cams_o3",
        "sulphur_dioxide": "cams_so2", "so2": "cams_so2",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    return df.drop(columns=["hour_utc"]).sort_index()


def _cyclical(series: pd.Series, period: float) -> tuple[pd.Series, pd.Series]:
    ang = 2 * np.pi * series / period
    return np.sin(ang), np.cos(ang)


def prepare_merged(station: pd.DataFrame, wx: pd.DataFrame) -> pd.DataFrame:
    """Outer-join onto a complete hourly grid (gap-fill) with CAMS namespaced."""
    df = station.join(wx, how="outer").sort_index()
    full_idx = pd.date_range(df.index.min(), df.index.max(), freq="h")
    df = df.reindex(full_idx)
    for col in TARGETS:
        if col in df.columns:
            hi = CAPS[col]
            df[col] = df[col].clip(0, hi)
    return df


def _hourly_fire(fire_daily: pd.DataFrame, index: pd.DatetimeIndex) -> pd.DataFrame:
    """Expand daily fire aggregates to the hourly index.

    A day's fire data becomes known the NEXT UTC day (archive availability), so
    features are shifted by one day and forward-filled onto hours.
    """
    f = fire_daily.sort_index()
    f.index = pd.DatetimeIndex(f.index)
    if f.index.tz is None:
        f.index = f.index.tz_localize("UTC")   # align with the (UTC) hourly index
    f = f.shift(1, freq="D")                       # known-with-1-day-lag
    idx = pd.DatetimeIndex(index.tz_localize("UTC") if index.tz is None else index)
    days = idx.floor("D")
    day_rows = f.reindex(days.unique()).ffill()    # one row per day, gaps forward-filled
    out = day_rows.reindex(days)                   # expand day-rows onto hours (order = idx)
    out.index = index                              # restore the caller's exact index
    return out


# blend weights (model, persistence, climatology) per horizon band — shared by
# training AND serving so the served artifact is bit-identical to the scored one
BLEND_W = {"1-6h": (0.68, 0.22, 0.10), "24h": (0.75, 0.12, 0.13), "48-72h": (0.85, 0.05, 0.10),
           "other": (0.80, 0.10, 0.10)}


def blended(pred: np.ndarray, X: np.ndarray, cols: list[str], hh: np.ndarray,
            col: str) -> np.ndarray:
    """Band-weighted blend of model prediction with persistence + climatology.

    NaN-safe: after an observation gap, {col}_now and {col}_rmean168 can be
    NaN (NaN would otherwise poison the whole blend and every metric computed
    from it).  A missing component's weight is renormalised onto the remaining
    finite components — persistence-weight flows to climatology, then to the
    model; climatology-weight flows to persistence, then to the model."""
    now = X[:, cols.index(f"{col}_now")]
    clim = X[:, cols.index(f"{col}_rmean168")]
    out = pred.copy()
    in_band = np.zeros(len(hh), dtype=bool)
    for band, (wm, wp, wc) in BLEND_W.items():
        if band == "other":
            continue
        lo, hi = min(HORIZON_BANDS[band]), max(HORIZON_BANDS[band])
        m = (hh >= lo) & (hh <= hi)
        in_band |= m
        out[m] = _mix(pred[m], now[m], clim[m], wm, wp, wc)
    other = ~in_band
    wm, wp, wc = BLEND_W["other"]
    out[other] = _mix(pred[other], now[other], clim[other], wm, wp, wc)
    return np.clip(out, 0, CAPS[col])


def _mix(pred: np.ndarray, now: np.ndarray, clim: np.ndarray,
         wm: float, wp: float, wc: float) -> np.ndarray:
    """Weighted mix, NaN-safe by renormalisation (see blended docstring):
    zeroing a missing component's weight and dividing by the surviving total
    redistributes that weight across the remaining components proportionally.
    pred is always finite (model output, clipped); if every blend input were
    NaN the result would be 0, so fall back to raw pred in that corner."""
    p_ok, n_ok, c_ok = np.isfinite(pred), np.isfinite(now), np.isfinite(clim)
    wm_ = np.where(p_ok, wm, 0.0)
    wpv = np.where(n_ok, wp, 0.0)
    wcv = np.where(c_ok, wc, 0.0)
    tot = wm_ + wpv + wcv
    safe = np.where(tot <= 0, 1.0, tot)
    out = ((wm_ / safe) * np.where(p_ok, pred, 0.0)
           + (wpv / safe) * np.where(n_ok, now, 0.0)
           + (wcv / safe) * np.where(c_ok, clim, 0.0))
    return np.where(tot <= 0, pred, out)


class StationFeatureSpace:
    """Base (issue-time) features for one station, reusable across all 72 horizons."""

    def __init__(self, merged: pd.DataFrame, fire_daily: pd.DataFrame | None = None):
        self.df = merged
        self.index = merged.index
        self.n = len(merged)

        base = pd.DataFrame(index=merged.index)

        # station-observation memory at T0
        obs = merged[TARGETS]
        for col in TARGETS:
            s = obs[col]
            base[f"{col}_now"] = s.shift(1)
            for lag in OBS_LAGS:
                base[f"{col}_lag{lag}"] = s.shift(lag)
            for win in OBS_ROLLS:
                base[f"{col}_rmean{win}"] = s.shift(1).rolling(win, min_periods=max(3, win // 3)).mean()
            base[f"{col}_rstd24"] = s.shift(1).rolling(24, min_periods=6).std()
            base[f"{col}_trend24"] = s.shift(1) - s.shift(25)
            # log-space rolling sigma: robust scale for the discontinuity guard
            base[f"{col}_lrstd24"] = np.log1p(s.shift(1)).rolling(24, min_periods=6).std()

        # CAMS level + memory at T0
        for col in TARGETS:
            c = f"cams_{col}"
            if c in merged.columns:
                base[c] = merged[c]
                base[f"{c}_lag24"] = merged[c].shift(24)
                cams_rmean24 = merged[c].rolling(24, min_periods=6).mean()
                cams_rmean168 = merged[c].rolling(168, min_periods=24).mean()
                base[f"{c}_rmean24"] = cams_rmean24
                # station-vs-CAMS offset (the local bias correction the model must apply)
                off = obs[col].shift(1) - merged[c]
                base[f"{col}_off_now"] = off
                base[f"{col}_off_rmean24"] = off.rolling(24, min_periods=6).mean()
                base[f"{col}_off_rmean168"] = off.rolling(168, min_periods=24).mean()
                # anomaly ratios: current level vs its own recent baseline
                base[f"{col}_anom24"] = obs[col].shift(1) / (obs[col].shift(1).rolling(24, min_periods=6).mean() + 1.0)
                base[f"{c}_anom24"] = merged[c] / (cams_rmean24 + 1.0)
                base[f"{col}_off_frac"] = off / (merged[c] + 5.0)

        # HRES weather at T0 (analysis) + wind vectors
        if "wind_speed_10m" in merged.columns:
            base["met0_ws10"] = merged["wind_speed_10m"]
        if "wind_speed_100m" in merged.columns:
            base["met0_ws100"] = merged["wind_speed_100m"]
        if "wind_direction_10m" in merged.columns:
            base["met0_wsin"], base["met0_wcos"] = _cyclical(merged["wind_direction_10m"], 360.0)

        # FIRMS fire memory at T0 (day-granular, known with a 1-day lag)
        self.has_fire = fire_daily is not None and len(fire_daily) > 0
        if self.has_fire:
            fh = _hourly_fire(fire_daily[FIRE_COLS], merged.index)
            for c in FIRE_COLS:
                lvl = fh[c].astype(np.float32)
                base[f"fire_{c}"] = lvl
                base[f"fire_{c}_log"] = np.log1p(lvl)
                base[f"fire_{c}_lag7"] = fh[c].shift(24 * 7)
            frp200 = fh["frp200"].astype(np.float32)
            base["fire_season"] = fh.index.month.isin([10, 11, 12]).astype(np.float32)
            base["fire_frp200_anom7"] = frp200 / (fh["frp200"].shift(24 * 7) + 10.0)

        self.base = base.astype(np.float32)
        self.df_cams_cols = {c: f"cams_{c}" for c in TARGETS if f"cams_{c}" in merged.columns}

    # -- per-horizon assembly ---------------------------------------------------

    def frame_for_horizon(self, h: int) -> pd.DataFrame:
        """Feature frame for samples (T0, h) over every issue time T0."""
        df = self.df
        f = self.base.copy()
        f["horizon"] = np.float32(h)

        shifted = df.shift(-h)
        for col, c in self.df_cams_cols.items():
            f[f"{c}_tgt"] = shifted[c]
            # target-hour CAMS expressed as an anomaly vs its recent baseline at T0
            base_rmean24 = self.base.get(f"{c}_rmean24")
            if base_rmean24 is not None:
                f[f"{c}_tgt_anom"] = shifted[c] / (base_rmean24 + 1.0)
        for wc in HRES_COLS:
            if wc in df.columns:
                f[f"met_tgt_{wc}"] = shifted[wc]
        if "wind_direction_10m" in df.columns:
            sin_t, cos_t = _cyclical(shifted["wind_direction_10m"], 360.0)
            f["met_tgt_wsin"] = sin_t
            f["met_tgt_wcos"] = cos_t

        # calendar at the TARGET hour
        tgt_index = self.index + pd.Timedelta(hours=h)
        ist_t = (tgt_index + pd.Timedelta(hours=5, minutes=30)).hour
        f["tgt_ist_hour"] = np.asarray(ist_t, dtype=np.float32)
        s_sin, s_cos = _cyclical(pd.Series(ist_t, index=self.index), 24.0)
        f["tgt_ist_sin"], f["tgt_ist_cos"] = s_sin.values.astype(np.float32), s_cos.values.astype(np.float32)
        f["tgt_doy_sin"] = np.sin(2 * np.pi * tgt_index.dayofyear / 365.25).astype(np.float32)
        f["tgt_doy_cos"] = np.cos(2 * np.pi * tgt_index.dayofyear / 365.25).astype(np.float32)
        f["tgt_month"] = np.asarray(tgt_index.month, dtype=np.float32)
        f["tgt_is_winter"] = np.isin(tgt_index.month, [11, 12, 1, 2]).astype(np.float32)
        return f

    def target_and_mask(self, col: str, h: int) -> tuple[np.ndarray, np.ndarray]:
        """Target series at T0+h plus the sample-validity mask (see module docstring)."""
        s = self.df[col]
        y = s.shift(-h)
        now = self.base[f"{col}_now"]
        lrstd = self.base[f"{col}_lrstd24"]
        cap = CAPS[col]
        # discontinuity guard in log space (2.5 abs floor + 4 sigma)
        jump = (np.log1p(now) - np.log1p(s.shift(25))).abs()
        jump_next = (np.log1p(y) - np.log1p(s.shift(h + 24))).abs()
        lrstd_next = lrstd.shift(h)
        ok_jump = (jump <= 2.5 + 4.0 * (lrstd + 0.35)) & \
                  (jump_next <= 2.5 + 4.0 * (lrstd_next + 0.35))
        not_capped = (y < cap) & (now < cap)
        mask = y.notna() & now.notna() & not_capped & ok_jump
        return y.values.astype(np.float32), mask.values

    def target_for_horizon(self, col: str, h: int) -> pd.Series:
        return pd.Series(self.df[col].shift(-h).values, index=self.index, name=col)


def build_issue_features(merged: pd.DataFrame, fire_daily: pd.DataFrame | None = None) -> StationFeatureSpace:
    return StationFeatureSpace(merged, fire_daily)
