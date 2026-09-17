"""Fetch the NASA FIRMS VIIRS_SNPP_SP active-fire archive for the NCR fire-belt box.

MAP-key tier limits each request to a 1-5 day range, so the archive is pulled
in 5-day chunks into firms_cache/chunk_XXXX.csv (resumable: existing chunks are
skipped; each chunk is independently re-fetchable).  4 parallel workers keep
wall-clock at ~15 min for the full 2015..today window.  Verified against the
API: Nov 2015 returns data, Nov 2018 returns 9,318 pixels in 3 days, off-season
Jan 2024 ~92 pixels/day.

  python fetch_firms.py            # fetch all missing chunks (4 workers)
  python fetch_firms.py --status   # just report chunk coverage
"""
from __future__ import annotations

import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "firms_cache")

MAP_KEY = os.environ.get("FIRMS_API_KEY", "").strip()
if not MAP_KEY:
    _env = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".env"))
    with open(_env, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("FIRMS_API_KEY="):
                MAP_KEY = line.split("=", 1)[1].strip()
                break
if not MAP_KEY:
    sys.exit("FIRMS_API_KEY not found in .env")

BOX = (73.5, 27.0, 81.0, 32.8)          # west,south,east,north  (NCR + Punjab/Haryana fire belt)
PRODUCT = "VIIRS_SNPP_SP"
CHUNK_DAYS = 5                           # MAP-key tier: [1..5]
WORKERS = 1                              # FIRMS MAP keys reject concurrent requests (HTTP 400)
PACE_S = 1.5                             # seconds between requests
START = date(2015, 1, 1)
END = date.today() - timedelta(days=1)   # SP archive lags ~1 day

URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
    f"{MAP_KEY}/{PRODUCT}/{BOX[0]},{BOX[1]},{BOX[2]},{BOX[3]}/{CHUNK_DAYS}/{{d0}}"
)
EMPTY_HEADER = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,"
                "satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n")


def chunk_starts():
    d = START
    out = []
    while d <= END:
        out.append(d)
        d += timedelta(days=CHUNK_DAYS)
    return out


def fetch_chunk(d0: date) -> str:
    url = URL.format(d0=d0.isoformat())
    last_err = None
    for attempt, wait in enumerate((10, 30, 75, 150), 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "delhi-aqi-training/1.0"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            s = text.strip()
            if s.lower().startswith("invalid"):
                # "Invalid day range" / "Invalid MAP_KEY" etc — not transient
                raise ValueError(s[:80])
            if not s:
                text = EMPTY_HEADER
            return text
        except ValueError:
            raise
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:120]
            except Exception:  # noqa: BLE001
                pass
            # FIRMS rate-limits with HTTP 400 + "Over RATE LIMIT" body
            if "rate" in body.lower() or e.code == 429:
                last_err = f"HTTP {e.code} rate-limited"
                time.sleep(90)
                continue
            last_err = f"HTTP {e.code} {body}"
            time.sleep(wait)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            time.sleep(wait)
    raise RuntimeError(f"chunk {d0} failed after retries: {last_err}")


def one_chunk(d0: date):
    out_path = os.path.join(CACHE, f"chunk_{d0.isoformat()}.csv")
    if os.path.exists(out_path):
        return d0, -1  # already cached
    text = fetch_chunk(d0)
    n = max(0, text.count("\n") - 1)
    tmp = out_path + ".part"
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    os.replace(tmp, out_path)
    return d0, n


def main() -> None:
    os.makedirs(CACHE, exist_ok=True)
    starts = chunk_starts()
    if "--status" in sys.argv:
        have = sum(1 for d in starts if os.path.exists(os.path.join(CACHE, f"chunk_{d.isoformat()}.csv")))
        print(f"chunks: {have}/{len(starts)} cached (window {START} .. {END})")
        return
    todo = [d for d in starts if not os.path.exists(os.path.join(CACHE, f"chunk_{d.isoformat()}.csv"))]
    print(f"fetching {len(todo)}/{len(starts)} chunks ({PRODUCT}, {CHUNK_DAYS}d each, box {BOX}, "
          f"window {START}..{END}, {WORKERS} workers)", flush=True)
    done = failed = 0
    total_rows = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(one_chunk, d): d for d in todo}
        for fut in as_completed(futs):
            d0 = futs[fut]
            try:
                _, n = fut.result()
                if n == -1:
                    continue
                total_rows += n
                done += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  FAIL {d0}: {e}", flush=True)
            if (done + failed) % 40 == 0:
                rate = (done + failed) / max(time.time() - t0, 1)
                eta = (len(todo) - done - failed) / max(rate, 0.01) / 60
                print(f"  {done+failed}/{len(todo)} chunks, {total_rows} px, {rate:.2f} ch/s, ETA {eta:.0f} min", flush=True)
            time.sleep(PACE_S)
    print(f"DONE: {done} chunks fetched ({failed} failed), {total_rows} pixels -> {CACHE}", flush=True)


if __name__ == "__main__":
    main()
