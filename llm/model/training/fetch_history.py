"""Fetch multi-year hourly pollutant history per station from OpenAQ's public S3 archive.

Keyless, resumable, stream-and-aggregate: downloads daily CSVs (15-min CPCB cadence),
aggregates to hourly means per pollutant, and appends to one CSV per station.

Usage:
  python fetch_history.py --manifest data/discovery_manifest.json --out data/
  python fetch_history.py --ids 235,8235 --years 2022,2023,2024,2025,2026 --out data/
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://openaq-data-archive.s3.amazonaws.com/records/csv.gz"
TARGET_PARAMS = ["pm25", "pm10", "no2", "o3", "so2"]  # CO deliberately excluded
PARAM_ALIASES = {"pm2.5": "pm25", "pm25": "pm25", "pm10": "pm10", "no2": "no2", "o3": "o3", "so2": "so2"}
YEARS = [2022, 2023, 2024, 2025, 2026]
MAX_WORKERS = 10
RETRIES = 3


def list_year_files(location_id: int, year: int) -> list[str]:
    """List daily CSV keys for one station-year via S3 ListObjectsV2."""
    prefix = f"records/csv.gz/locationid={location_id}/year={year}/"
    keys, token = [], None
    url = (f"https://openaq-data-archive.s3.amazonaws.com/?list-type=2&prefix={prefix}&max-keys=1000")
    while True:
        req_url = url + (f"&continuation-token={token}" if token else "")
        for attempt in range(RETRIES):
            try:
                with urllib.request.urlopen(req_url, timeout=45) as r:
                    body = r.read().decode("utf-8", "replace")
                break
            except Exception:
                if attempt == RETRIES - 1:
                    return keys
                time.sleep(2 * (attempt + 1))
        keys += re.findall(r"<Key>([^<]+)</Key>", body)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", body)
        if not m:
            break
        token = m.group(1)
    return [k for k in keys if k.endswith(".csv.gz")]


def fetch_and_aggregate_day(key: str) -> dict[str, list[tuple[str, float, int]]]:
    """Download one daily gz, return {param: [(hour_utc, mean_value, n), ...]}."""
    url = f"https://openaq-data-archive.s3.amazonaws.com/{key}"
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = gzip.decompress(r.read()).decode("utf-8", "replace")
            break
        except Exception:
            if attempt == RETRIES - 1:
                return {}
            time.sleep(2 * (attempt + 1))
    else:
        return {}

    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        return {}
    cols = {c.strip().lower(): c for c in reader.fieldnames}
    dcol = next((cols[c] for c in cols if c in ("datetime", "date", "timestamp_utc", "timestamp", "datetimeutc")), None)
    pcol = next((cols[c] for c in cols if c in ("parameter", "parameter_name", "pollutant")), None)
    vcol = next((cols[c] for c in cols if c in ("value", "value_raw")), None)
    if not (dcol and pcol and vcol):
        return {}

    # bucket[(param, hour_utc)] -> [sum, n]
    # datetime is IST (+05:30) in the archive; convert to UTC so station data
    # aligns exactly with the UTC CAMS/HRES covariates.
    from datetime import datetime, timezone, timedelta
    IST = timezone(timedelta(hours=5, minutes=30))
    bucket: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in reader:
        try:
            pname = PARAM_ALIASES.get(str(row.get(pcol, "")).strip().lower())
            if pname is None or pname not in TARGET_PARAMS:
                continue
            val = float(row.get(vcol, "") or "")
            if val <= -900:  # sentinel/missing
                continue
            dstr = str(row.get(dcol, ""))
            dt = datetime.fromisoformat(dstr)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=IST)
            # floor to the IST hour first, then convert the hour label to UTC:
            # one IST hour maps to exactly one UTC hour (no 30-min straddling)
            hour_utc = dt.replace(minute=0, second=0).astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
            b = bucket[(pname, hour_utc)]
            b[0] += val
            b[1] += 1
        except (ValueError, TypeError):
            continue

    out: dict[str, list[tuple[str, float, int]]] = defaultdict(list)
    for (pname, hour), (s, n) in bucket.items():
        if n:
            out[pname].append((hour, round(s / n, 3), int(n)))
    return out


def process_station(location_id: int, name: str, out_dir: str, years: list[int]) -> dict:
    """Stream all daily files for a station into an hourly CSV. Resumable per year via marker file."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    out_path = os.path.join(out_dir, f"station_{location_id}_{slug}.csv")
    done_marker = out_path + ".done_years"
    done_years = set()
    if os.path.exists(done_marker):
        done_years = set(json.load(open(done_marker)))

    rows: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))  # hour -> param -> [vals]
    ckpt_path = out_path + ".rowsckpt.json"
    # Resume from the in-RAM checkpoint.  If years are marked done but no checkpoint
    # exists, the previous run was killed mid-station -> redo those years.
    if os.path.exists(ckpt_path):
        try:
            ck = json.load(open(ckpt_path))
            for hour, rec in ck.items():
                for p, vals in rec.items():
                    rows[hour][p].extend(vals)
        except Exception:
            pass
    elif done_years:
        done_years = set()
    n_files = n_err = 0
    for year in years:
        if year in done_years:
            continue
        keys = list_year_files(location_id, year)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futs = {ex.submit(fetch_and_aggregate_day, k): k for k in keys}
            for fut in as_completed(futs):
                try:
                    day = fut.result()
                except Exception:
                    n_err += 1
                    continue
                n_files += 1
                for pname, samples in day.items():
                    for hour, mean, _n in samples:
                        rows[hour][pname].append(mean)
        done_years.add(year)
        json.dump(sorted(done_years), open(done_marker, "w"))
        # persist the aggregated rows so a kill never loses marked years
        json.dump({h: dict(rec) for h, rec in rows.items()}, open(ckpt_path, "w"))
        print(f"  [{location_id} {name}] year {year}: {n_files} files", flush=True)

    if rows:
        with open(out_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["hour_utc"] + TARGET_PARAMS + [f"{p}_n" for p in TARGET_PARAMS])
            for hour in sorted(rows):
                rec = rows[hour]
                w.writerow([hour] + [round(sum(rec[p]) / len(rec[p]), 3) if rec.get(p) else "" for p in TARGET_PARAMS]
                           + [len(rec.get(p, [])) for p in TARGET_PARAMS])
    if os.path.exists(ckpt_path):
        os.remove(ckpt_path)
    print(f"[{location_id} {name}] DONE -> {out_path} ({len(rows)} hours, {n_files} files, {n_err} errors)", flush=True)
    return {"id": location_id, "name": name, "hours": len(rows), "files": n_files, "errors": n_err, "path": out_path}


def load_manifest(path: str) -> list[dict]:
    m = json.load(open(path))
    stations = m.get("stations") or m.get("matched") or m
    if isinstance(stations, dict):
        stations = list(stations.values())
    # normalise to (archive_id, name) pairs using the registry name so file
    # slugs match the training loader exactly
    out = []
    for s in stations:
        aid = s.get("openaq_id") or s.get("archive_id")
        name = s.get("registry_name") or s.get("name")
        if aid and name:
            out.append({"archive_id": int(aid), "name": name})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=None, help="discovery manifest json mapping registry stations to archive ids")
    ap.add_argument("--ids", default=None, help="comma list of archive location ids (with --names)")
    ap.add_argument("--names", default=None, help="comma list of station names matching --ids")
    ap.add_argument("--years", default=",".join(map(str, YEARS)))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "data"))
    ap.add_argument("--limit", type=int, default=None, help="only first N stations (smoke test)")
    ap.add_argument("--parallel-stations", type=int, default=3,
                    help="how many stations to process concurrently")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    years = [int(y) for y in args.years.split(",")]

    if args.manifest:
        stations = load_manifest(args.manifest)
        pairs = [(int(s["archive_id"]), s["name"]) for s in stations]
    elif args.ids:
        ids = [int(x) for x in args.ids.split(",")]
        names = args.names.split(",") if args.names else [str(i) for i in ids]
        pairs = list(zip(ids, names))
    else:
        sys.exit("need --manifest or --ids")

    if args.limit:
        pairs = pairs[: args.limit]

    results = []
    if args.parallel_stations > 1:
        print(f"fetching {len(pairs)} stations, {args.parallel_stations} in parallel", flush=True)
        with ThreadPoolExecutor(max_workers=args.parallel_stations) as ex:
            futs = {ex.submit(process_station, loc_id, name, args.out, years): (loc_id, name)
                    for loc_id, name in pairs}
            for fut in as_completed(futs):
                loc_id, name = futs[fut]
                try:
                    results.append(fut.result())
                except Exception as e:
                    print(f"[{loc_id} {name}] FAILED: {e}", flush=True)
                    results.append({"id": loc_id, "name": name, "error": str(e)})
    else:
        for loc_id, name in pairs:
            results.append(process_station(loc_id, name, args.out, years))
    summary_path = os.path.join(args.out, "fetch_summary.json")
    json.dump(results, open(summary_path, "w"), indent=2)
    print(f"summary -> {summary_path}")


if __name__ == "__main__":
    main()
