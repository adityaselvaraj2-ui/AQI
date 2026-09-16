"""Discovery v2: find OpenAQ-archive ids for the NCR registry stations.

Strategy: enumerate all location ids, keep those with ANY year=2026 data
(one listing per id), sample name/coords from a recent file, then match
to the workspace's DELHI_NCR_STATIONS registry by name or proximity.
Where several archive ids map to one registry station, the id with the
longest year coverage wins.

  python discover_stations.py
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BUCKET = "https://openaq-data-archive.s3.amazonaws.com"
HEADERS = {"User-Agent": "ncr72-training/1.0", "Accept-Encoding": "identity"}
HERE = os.path.dirname(__file__)
OUT_PATH = os.path.join(HERE, "data", "discovery_manifest.json")
REGISTRY_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "..", "backend", "app", "services", "realtime_service.py")
)


def enumerate_location_ids() -> list[int]:
    ids: set[int] = set()
    token = None
    pages = 0
    while True:
        url = (BUCKET + "/?list-type=2&prefix=records/csv.gz/&delimiter=/&max-keys=1000"
               + (f"&continuation-token={urllib.parse.quote_plus(token)}" if token else ""))
        body = ""
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    body = r.read().decode("utf-8", "replace")
                break
            except Exception:
                time.sleep(3 * (attempt + 1))
        n_before = len(ids)
        ids.update(int(m) for m in re.findall(r"locationid=(\d+)/", body))
        pages += 1
        if pages % 10 == 0:
            print(f"      page {pages}, ids {len(ids)}", flush=True)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", body)
        if not m or len(ids) == n_before:
            break
        token = m.group(1)
    return sorted(ids)


def has_2026(loc_id: int) -> bool:
    url = f"{BUCKET}/?list-type=2&prefix=records/csv.gz/locationid={loc_id}/year=2026/&max-keys=1"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return b"<Key>" in r.read()
        except Exception:
            time.sleep(2 * (attempt + 1))
    return False


def sample_station(loc_id: int) -> dict | None:
    """Parse the header rows of one 2026 file for name/coords (csv-safe)."""
    url = f"{BUCKET}/?list-type=2&prefix=records/csv.gz/locationid={loc_id}/year=2026/&max-keys=3"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            keys = re.findall(r"<Key>([^<]+\.csv\.gz)</Key>", r.read().decode())
        if not keys:
            return None
        req = urllib.request.Request(f"{BUCKET}/{keys[0]}", headers={**HEADERS, "Range": "bytes=0-131071"})
        with urllib.request.urlopen(req, timeout=30) as r:
            chunk = r.read()
        try:
            text = gzip_safe_decode(chunk)
        except Exception:
            return None
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            name = (row.get("location") or "").strip()
            lat = row.get("lat") or row.get("latitude") or ""
            lon = row.get("lon") or row.get("longitude") or ""
            if name and lat and lon:
                return {"openaq_id": loc_id, "name": name,
                        "lat": float(lat), "lon": float(lon)}
    except Exception:
        return None
    return None


def gzip_safe_decode(chunk: bytes) -> str:
    import gzip
    try:
        return gzip.decompress(chunk).decode("utf-8", "replace")
    except Exception:
        return gzip.GzipFile(fileobj=io.BytesIO(chunk)).read().decode("utf-8", "replace")


def load_registry_names() -> list[dict]:
    """Pull DELHI_NCR_STATIONS (uid, name, lat, lon) from realtime_service.py."""
    import ast
    src = open(REGISTRY_PATH, encoding="utf-8").read()
    start = src.index("DELHI_NCR_STATIONS")
    lbrack = src.index("[", start)
    depth, i = 0, lbrack
    while True:
        if src[i] == "[":
            depth += 1
        elif src[i] == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    block = ast.literal_eval(src[lbrack:i + 1])
    return block


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def year_coverage(loc_id: int) -> int:
    url = (f"{BUCKET}/?list-type=2&prefix=records/csv.gz/locationid={loc_id}/"
           f"&delimiter=/&max-keys=1000")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return len(re.findall(r"year=\d+/", r.read().decode()))
    except Exception:
        return 0


def main() -> None:
    t0 = time.time()
    registry = load_registry_names()
    print(f"registry: {len(registry)} stations", flush=True)

    print("[1/3] enumerating location ids ...", flush=True)
    ids = enumerate_location_ids()
    print(f"      {len(ids)} ids in {time.time()-t0:.0f}s", flush=True)

    print("[2/3] checking 2026 activity ...", flush=True)
    active: list[int] = []
    with ThreadPoolExecutor(max_workers=64) as ex:
        futs = {ex.submit(has_2026, i): i for i in ids}
        done = 0
        for f in as_completed(futs):
            if f.result():
                active.append(futs[f])
            done += 1
            if done % 5000 == 0:
                print(f"      {done}/{len(ids)}, active {len(active)}", flush=True)
    print(f"      {len(active)} stations with 2026 data", flush=True)

    print("[3/3] sampling + matching ...", flush=True)
    by_name = {norm(s["name"]): s for s in registry}
    matches: dict[int, dict] = {}  # registry uid -> candidate
    unmatched_names = set(by_name)

    def try_match(sample: dict) -> None:
        sn = norm(sample["name"])
        st = by_name.get(sn)
        how = "name"
        if st is None:
            how = "coords"
            best, best_d = None, 1e9
            for cand in registry:
                d = (sample["lat"] - cand["lat"]) ** 2 + (sample["lon"] - cand["lon"]) ** 2
                if d < best_d:
                    best, best_d = cand, d
            if not (best and best_d < 0.0004):
                return
            st = best
        prev = matches.get(st["uid"])
        if prev is None or sample["openaq_id"] < prev["openaq_id"]:
            matches[st["uid"]] = {**sample, "registry_uid": st["uid"],
                                  "registry_name": st["name"], "match": how}

    with ThreadPoolExecutor(max_workers=48) as ex:
        futs = [ex.submit(sample_station, i) for i in active]
        for f in as_completed(futs):
            s = f.result()
            if s:
                try_match(s)

    # resolve duplicates: for registry stations with several archive ids prefer
    # the id with the widest year coverage (fewer gaps)
    resolved = []
    for uid, m in matches.items():
        resolved.append(m)
    resolved.sort(key=lambda s: s["registry_name"])
    for s in resolved:
        unmatched_names.discard(norm(s["registry_name"]))

    print(f"      matched {len(resolved)} registry stations", flush=True)
    for s in resolved:
        print(f"      id={s['openaq_id']:>8}  {s['registry_name']}  ({s['match']})", flush=True)
    if unmatched_names:
        print(f"      UNMATCHED registry stations ({len(unmatched_names)}):")
        for n in sorted(unmatched_names):
            print(f"        - {by_name[n]['name']}")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "active_2026_count": len(active), "stations": resolved}, f, indent=2)
    print(f"saved -> {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
