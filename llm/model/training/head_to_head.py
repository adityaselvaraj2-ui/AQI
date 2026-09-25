"""Stage 4 head-to-head: LightGBM vs Chronos-2 vs baselines, per (station, pollutant, band).

Scoring is ALWAYS against real station observations (R1) at true per-station
granularity (R2), on the SAME 120-day holdout windows both models used.
LightGBM predictions come from the serving-style path (booster + production
blend) on rows built by the SAME assemble_samples/features.py pipeline (R4).
Chronos predictions come from the per-origin dumps written by
chronos2_candidate.evaluate() on identical (origin, horizon) pairs.

Baseline anchors (the production blend's own components):
  persistence  = {col}_now        (obs at issue time)
  climatology  = {col}_rmean168   (trailing 168h mean at issue time)

Output:
  llm/model/station_models_chronos2/head_to_head.json
    - per (station, poll, band): rmse/r2 for each system + winner
    - per (station, poll): overall winner + R6 promotion verdict
  stdout: compact win/loss tables (never a median-only summary)

  python head_to_head.py [--poll pm25] [--stations 6932,235]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from train_all import assemble_samples  # noqa: E402
from chronos2_candidate import load_merged, load_fire_daily, MERGED_DIR  # noqa: E402
from features import StationFeatureSpace, blended, CAPS, HORIZON_BANDS  # noqa: E402
from train import TEST_DAYS  # noqa: E402

MODELS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models"))
CHRONOS_DIR = os.path.abspath(os.path.join(HERE, "..", "station_models_chronos2"))
DATA_DIR = MERGED_DIR  # same per-station merged frames the Chronos eval consumed
POLL_ORDER = ("pm25", "pm10", "no2", "o3", "so2")
BAND_ORDER = ("1-6h", "24h", "48-72h", "96h", "120h", "144-168h")


def band_of(h: int) -> str | None:
    for b, rng in HORIZON_BANDS.items():
        if h in rng:
            return b
    return None


def score(y: np.ndarray, p: np.ndarray) -> dict:
    if len(y) < 30:
        return {}
    err = p - y
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return {
        "n": int(len(y)),
        "rmse": round(float(np.sqrt((err ** 2).mean())), 3),
        "mae": round(float(np.abs(err).mean()), 3),
        "r2": round(float(1 - (err ** 2).sum() / ss_tot), 4) if ss_tot > 0 else "nan",
        "bias": round(float(err.mean()), 3),
    }


def eval_station(sid: int, name: str, poll: str, origins: dict) -> dict | None:
    merged = load_merged(sid, name)
    if merged is None:
        return None
    space = StationFeatureSpace(merged, load_fire_daily(sid))
    booster_path = os.path.join(MODELS_DIR, str(sid), f"{poll}.txt")
    if not os.path.exists(booster_path):
        return None
    import lightgbm as lgb  # local import: heavy, only needed here

    booster = lgb.Booster(model_file=booster_path)
    # Comparison grid == exactly the (t0, h) pairs the Chronos dump scores:
    # issue times every ORIGIN_STRIDE hours (the chronos origin cadence),
    # horizon hours restricted to the reporting bands.  Everything outside
    # that grid is never compared, so assembling it would only burn RAM
    # (stride 1 x all 168 horizons needs ~14 GB).
    from chronos2_candidate import ORIGIN_STRIDE

    band_hours = sorted({h for rng in HORIZON_BANDS.values() for h in rng})
    X, cols, t0_ns, hh, y_all, mask_all = assemble_samples(space, band_hours, ORIGIN_STRIDE)
    del merged

    y, mask = y_all[poll], mask_all[poll]
    split_ns = int(t0_ns.max()) - TEST_DAYS * 24 * 3600 * 10**9
    te = mask & (t0_ns >= split_ns)
    if te.sum() < 1000:
        return None

    pred_raw = np.clip(booster.predict(X[te], num_iteration=booster.num_trees()),
                       0, CAPS[poll])
    pred_prod = blended(pred_raw, X[te], cols, hh[te], poll)
    now = X[te][:, cols.index(f"{poll}_now")]
    clim = X[te][:, cols.index(f"{poll}_rmean168")]

    # index LightGBM rows by (t0, h)
    lgb_idx = {(int(t), int(h)): i for i, (t, h) in enumerate(zip(t0_ns[te], hh[te]))}

    # align chronos origins onto the same (t0, h) grid
    rows = {"t": [], "h": [], "y": [], "ch": []}
    for o in origins.values():
        t0_ns_v = int(pd.Timestamp(o["t0"]).value)
        for h, yv, pv in zip(o["hs"], o["ys"], o["ps"]):
            i = lgb_idx.get((t0_ns_v, int(h)))
            if i is None:
                continue
            rows["t"].append(t0_ns_v)
            rows["h"].append(int(h))
            rows["y"].append(float(yv))
            rows["ch"].append(float(pv))
    if len(rows["y"]) < 1000:
        return None
    tA, hA = np.array(rows["t"]), np.array(rows["h"])
    yA = np.array(rows["y"])
    chA = np.clip(np.array(rows["ch"]), 0, CAPS[poll])
    ii = np.array([lgb_idx[(int(t), int(h))] for t, h in zip(tA, hA)])
    lgA, lgPA, lgBA = now[ii], pred_raw[ii], pred_prod[ii]

    # Chronos dropped into the SAME production blend weights
    ch_bl = _chronos_blend(chA, now[ii], clim[ii], hA, poll)
    hybrid = np.array(lgBA if len(lgBA) else lgA, dtype=float, copy=True)

    per_band = {}
    for b in BAND_ORDER:
        rng = HORIZON_BANDS[b]
        m = (hA >= min(rng)) & (hA <= max(rng))
        if m.sum() < 30:
            continue
        per_band[b] = {
            "lgb_model": score(yA[m], lgA[m]),
            "lgb_production": score(yA[m], lgBA[m]),
            "chronos": score(yA[m], chA[m]),
            "chronos_blended": score(yA[m], ch_bl[m]),
            "persistence": score(yA[m], now[ii[m]]),
            "climatology": score(yA[m], clim[ii[m]]),
        }
        per_band[b]["winner_rmse"] = min(
            (k for k in ("lgb_model", "lgb_production", "chronos", "chronos_blended",
                         "persistence", "climatology") if per_band[b].get(k)),
            key=lambda k: per_band[b][k]["rmse"])
        per_band[b]["n"] = int(m.sum())
        # hybrid: take chronos in this band when it beats production there
        ref = per_band[b]["lgb_production"] or per_band[b]["lgb_model"]
        if per_band[b]["chronos"] and ref and per_band[b]["chronos"]["rmse"] < ref["rmse"]:
            hybrid[m] = chA[m]

    overall = {
        "lgb_model": score(yA, lgA),
        "lgb_production": score(yA, lgBA),
        "chronos": score(yA, chA),
        "chronos_blended": score(yA, ch_bl),
        "hybrid": score(yA, hybrid),
        "persistence": score(yA, now[ii]),
        "climatology": score(yA, clim[ii]),
    }
    prod = overall["lgb_production"] if overall["lgb_production"] else overall["lgb_model"]
    overall["winner_rmse"] = min(
        (k for k in ("lgb_model", "lgb_production", "chronos", "chronos_blended",
                     "persistence", "climatology") if overall.get(k)),
        key=lambda k: overall[k]["rmse"])
    # R6 gate: chronos (raw or blended) must beat production overall AND every band
    verdict = "lightgbm"
    for ck in ("chronos", "chronos_blended"):
        c = overall[ck]
        if not c or not prod or c["rmse"] >= prod["rmse"]:
            continue
        band_ok = all(
            per_band[b].get(ck) and per_band[b]["lgb_production"]
            and per_band[b][ck]["rmse"] < per_band[b]["lgb_production"]["rmse"]
            for b in per_band)
        if band_ok:
            verdict = ck
            break
    out = {"station_id": sid, "name": name, "pollutant": poll,
           "n_aligned": int(len(yA)), "overall": overall, "bands": per_band,
           "r6_verdict": verdict}
    # Paired significance (24h-block means damp serial correlation; DM-style
    # t on block means).  mean_sq_diff > 0 => the challenger is WORSE.
    prod_arr = lgBA if overall["lgb_production"] else lgA
    out["paired"] = {}
    if prod_arr is not None and len(yA) >= 192:
        def _block_t(a, b):
            d = (a - yA) ** 2 - (b - yA) ** 2
            nb = len(d) // 24
            if nb < 8:
                return None, None, None
            db = d[: nb * 24].reshape(nb, 24).mean(axis=1)
            se = float(db.std(ddof=1) / np.sqrt(nb)) if nb > 1 else 0.0
            return (float(d.mean()),
                    float(db.mean() / se) if se > 0 else None, int(nb))
        for label, arr in (("chronos_vs_prod", chA), ("hybrid_vs_prod", hybrid)):
            if arr is None:
                continue
            md, t, nb = _block_t(arr, prod_arr)
            out["paired"][label] = {"mean_sq_diff": md, "t_block": t, "blocks": nb}
    del space, X
    return out


def _chronos_blend(pred: np.ndarray, now: np.ndarray, clim: np.ndarray,
                   hh: np.ndarray, col: str) -> np.ndarray:
    """Apply the production band weights to a Chronos prediction vector.

    Same NaN-safe renormalisation semantics as features.blended, but without
    needing the full X matrix (the anchors are passed directly)."""
    from features import BLEND_W

    out = np.array(pred, dtype=float, copy=True)
    in_band = np.zeros(len(hh), dtype=bool)
    for band, (wm, wp, wc) in BLEND_W.items():
        if band == "other":
            continue
        lo, hi = min(HORIZON_BANDS[band]), max(HORIZON_BANDS[band])
        m = (hh >= lo) & (hh <= hi)
        in_band |= m
        out[m] = _mix3(pred[m], now[m], clim[m], wm, wp, wc)
    other = ~in_band
    wm, wp, wc = BLEND_W["other"]
    out[other] = _mix3(pred[other], now[other], clim[other], wm, wp, wc)
    return np.clip(out, 0, CAPS[col])


def _mix3(pred, now, clim, wm, wp, wc):
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--poll", type=str, default=None)
    ap.add_argument("--stations", type=str, default=None)
    ap.add_argument("--out", type=str, default=os.path.join(CHRONOS_DIR, "head_to_head.json"))
    args = ap.parse_args()

    polls = [args.poll] if args.poll else list(POLL_ORDER)
    keep = {int(x) for x in args.stations.split(",")} if args.stations else None

    with open(os.path.join(HERE, "data", "discovery_manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    name_of = {int(s["openaq_id"]): s["registry_name"] for s in manifest["stations"]}

    results: list[dict] = []
    for poll in polls:
        path = os.path.join(CHRONOS_DIR, f"eval_{poll}.json")
        if not os.path.exists(path):
            print(f"[{poll}] no chronos eval yet, skipping")
            continue
        with open(path, encoding="utf-8") as f:
            entries = json.load(f)
        t0 = time.time()
        for e in entries:
            sid = e["station_id"]
            if keep and sid not in keep:
                continue
            # per-origin dumps live in preds_<poll>/<sid>.json (the summary
            # strips origins to keep metrics_summary.json lean)
            preds_path = os.path.join(CHRONOS_DIR, f"preds_{poll}", f"{sid}.json")
            origins: dict = {}
            if os.path.exists(preds_path):
                with open(preds_path, encoding="utf-8") as f:
                    origins = json.load(f).get("origins", {})
            if not origins:
                print(f"  {sid} {e.get('name', '')[:24]}: no per-origin dump yet — skipped",
                      flush=True)
                continue
            r = eval_station(sid, e.get("name") or name_of.get(sid, str(sid)), poll, origins)
            if r:
                results.append(r)
                ov = r["overall"]
                print(f"  {sid:>6} {e.get('name','')[:24]:<24} lgb_prod {ov['lgb_production']['rmse']:>6.1f} | "
                      f"chronos {ov['chronos']['rmse']:>6.1f} | ch_blend {ov['chronos_blended']['rmse']:>6.1f} | "
                      f"pers {ov['persistence']['rmse']:>6.1f} | winner {ov['winner_rmse']} -> {r['r6_verdict']}",
                      flush=True)
            else:
                print(f"  {sid:>6} {e.get('name','')[:24]:<24} SKIP (alignment/booster missing)", flush=True)
        print(f"[{poll}] {len(results)} station results ({time.time()-t0:.0f}s)", flush=True)

    os.makedirs(CHRONOS_DIR, exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f)
    os.replace(tmp, args.out)

    # ---- summary: winner counts per band per system (explicit, not medians) ----
    wins: dict = {}
    for r in results:
        for b, d in r["bands"].items():
            key = (r["pollutant"], b)
            wins.setdefault(key, {}).setdefault(d["winner_rmse"], 0)
            wins[key][d["winner_rmse"]] += 1
    print("\n=== WIN/LOSS by (pollutant, band) — count of (station) wins by system ===")
    for (poll, b) in sorted(wins, key=lambda k: (POLL_ORDER.index(k[0]), BAND_ORDER.index(k[1]))):
        print(f"{poll:>5} {b:>9}: " + ", ".join(f"{k}={v}" for k, v in sorted(wins[(poll, b)].items(),
                                                               key=lambda kv: -kv[1])))
    from collections import Counter
    verdicts = Counter(r["r6_verdict"] for r in results)
    print(f"\nR6 promotion verdicts over {len(results)} (station, pollutant) pairs: {dict(verdicts)}")

    # ---- per-band hybrid test: pick the better system PER BAND, then pool ----
    # MSEs are additive, so the hybrid's pooled RMSE is exact, not an estimate.
    hybrid_wins = 0
    for r in results:
        prod = r["overall"].get("lgb_production") or r["overall"].get("lgb_model")
        hy = r["overall"].get("hybrid")
        if not prod or not hy:
            continue
        if hy["rmse"] < prod["rmse"]:
            hybrid_wins += 1
            pr = (r.get("paired") or {}).get("hybrid_vs_prod") or {}
            t, md = pr.get("t_block"), pr.get("mean_sq_diff")
            if t is not None:
                # md < 0 and |t|>2 => hybrid genuinely better, not noise
                sig = ("BETTER(sig)" if md < 0 and abs(t) > 2 else
                       "worse(sig)" if md > 0 and abs(t) > 2 else "ns")
                sig = f"  [hybrid-vs-prod t={t:+.1f} {sig}, {pr.get('blocks')} blocks]"
            else:
                sig = ""
            print(f"  HYBRID wins: {r['station_id']} {r['name']} {r['pollutant']} "
                  f"hybrid {hy['rmse']:.1f} < prod {prod['rmse']:.1f} "
                  f"({100 * (1 - hy['rmse'] / prod['rmse']):.2f}%){sig}")
    print(f"Per-band hybrid (chronos 1-6h where better + LightGBM elsewhere): "
          f"beats production at {hybrid_wins}/{len(results)} pairs", flush=True)


if __name__ == "__main__":
    main()
