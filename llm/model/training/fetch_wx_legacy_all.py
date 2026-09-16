"""Fetch legacy-era (2015-01 .. 2022-09) HRES weather for every manifest station.

Parallel driver around fetch_wx_legacy.fetch_legacy — one CSV per station into
data_legacy/, which merge_eras.py later stitches to the modern CAMS+HRES file.

  python fetch_wx_legacy_all.py --manifest data/discovery_manifest.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_wx_legacy import fetch_legacy  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=os.path.join(HERE, "data", "discovery_manifest.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "data_legacy"))
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    manifest = json.load(open(args.manifest))
    jobs = []
    for s in manifest["stations"]:
        sid = int(s["openaq_id"])
        out_path = os.path.join(args.out, f"wx_{sid}.csv")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 50_000:
            print(f"  skip existing wx_{sid}.csv", flush=True)
            continue
        jobs.append((sid, float(s["lat"]), float(s["lon"]), out_path))

    print(f"legacy wx: {len(jobs)} stations to fetch, {args.workers} workers", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_legacy, lat, lon, out): sid for sid, lat, lon, out in jobs}
        for fut in as_completed(futs):
            sid = futs[fut]
            try:
                n = fut.result()
                done += 1
                print(f"  [{done}/{len(jobs)}] wx_{sid}.csv: {n} hours", flush=True)
            except Exception as e:
                print(f"  wx_{sid} FAILED: {e}", flush=True)
    print("legacy wx fetch done", flush=True)


if __name__ == "__main__":
    main()
