"""IITM SAFAR forecast bulletin — live government WRF-Chem reference for Delhi NCR.

SAFAR (System of Air Quality and Weather Forecasting and Research, IITM Pune)
runs an operational WRF-Chem-class forecast for exactly this domain. The public
bulletin page is keyless and answers globally; the dedicated EWS JSON host
(ews.tropmet.res.in) is geo-blocked outside India (connection refused from this
environment — measured 2026-09-21, both candidate URLs), so the forecast page
is the integration point.

What SAFAR provides here: per-station DAILY forecast rows
(date / AQI category / AQI number / lead pollutant). AQI is frequently "NA"
outside the peak season — the category text is then the only signal. This is a
CATEGORICAL, DAILY reference: it cannot enter hourly ML features, so its role
is (a) an authority-visible consensus/benchmark reference and (b) a qualitative
cross-check of our day-scale category forecasts. It is NOT used to tune or
select models — the contract scoring stays sensor-only.

Honesty rules (same as every provider in this repo):
- Only data actually present in the upstream bulletin is surfaced; nothing is
  synthesised, and "NA" stays None.
- Any failure raises RuntimeError with the precise reason; callers translate
  that into 502/503, never into silent fallback values.
- No API key exists for this source, so there is no key management here.
"""
from __future__ import annotations

import json
import re
import ssl
import time
from typing import Any

import httpx
from app.services.http_client import shared_client_context

_SAFAR_FORECAST_URL = "https://safar.tropmet.res.in/delhi_ncr_forecast.php"
_TIMEOUT_S = 10.0
_TTL_S = 6 * 3600  # bulletin updates twice daily; 6h cache is generous

_cache: dict[str, Any] = {"at": 0.0, "stations": None}


def _legacy_ssl_context() -> ssl.SSLContext:
    """SSL context that tolerates IITM's legacy Diffie-Hellman parameters.

    The SAFAR host handshakes with DH params OpenSSL 3 rejects by default
    (measured: ssl.SSLError DH_KEY_TOO_SMALL), while browsers/curl accept it.
    Scope: this context is used ONLY for the safar.tropmet.res.in fetch.
    """
    ctx = ssl.create_default_context()
    ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def _parse_markers(html: str) -> list[dict[str, Any]]:
    """Extract per-station markers from the page's JS object literal.

    The embedded array is NOT valid JSON (single-quoted string values), so
    each marker is extracted with scoped regexes: the page is split on
    '"title":\'' and every field is taken from its own chunk.
    """
    if "var markers" not in html:
        raise RuntimeError("SAFAR bulletin: markers array not found in page")
    chunks = html.split('"title":\'')[1:]
    out: list[dict[str, Any]] = []
    for chunk in chunks:
        title = chunk.split("'", 1)[0].strip()
        lat_m = re.search(r'"lat":\'([0-9.\-]+)\'', chunk)
        lng_m = re.search(r'"lng":\'([0-9.\-]+)\'', chunk)
        desc_m = re.search(r'"description":\'(.*)\'\s*\}', chunk, re.S)
        desc = desc_m.group(1) if desc_m else ""
        rows: list[dict[str, Any]] = []
        # each forecast row: <td align="left">DATE</td> ... category ... AQI ... lead
        for row_m in re.finditer(
                r"<td align=\"left\">(\d{4}-\d{2}-\d{2})</td>"
                r"<td[^>]*>([^<]*)</td>"
                r"<td[^>]*>\s*([0-9NA.]+)\s*</td>"
                r"<td[^>]*>\s*([A-Za-z0-9+\- ]*)\s*</td>",
                desc):
            date, category, aqi_raw, lead = (g.strip() for g in row_m.groups())
            aqi: float | None
            try:
                aqi = float(aqi_raw)
            except ValueError:
                aqi = None
            rows.append({
                "date": date,
                "category": category or None,
                "aqi": aqi,
                "lead_pollutant": lead or None,
            })
        out.append({
            "station": title,
            "lat": float(lat_m.group(1)) if lat_m else None,
            "lng": float(lng_m.group(1)) if lng_m else None,
            "forecast": rows,
        })
    return out


async def fetch_safar_forecast(force: bool = False) -> dict[str, Any]:
    """Live SAFAR Delhi-NCR per-station daily forecast (TTL-cached)."""
    now = time.time()
    if not force and _cache["stations"] is not None and now - _cache["at"] < _TTL_S:
        return _cache["stations"]

    try:
        async with shared_client_context(timeout=_TIMEOUT_S) as client:
            resp = await client.get(_SAFAR_FORECAST_URL, headers={
                "User-Agent": "Mozilla/5.0 (aqi-forecast reference fetch)",
            })
    except Exception as e:
        raise RuntimeError(f"SAFAR bulletin unreachable: {type(e).__name__}: {e}") from e
    if resp.status_code != 200:
        raise RuntimeError(f"SAFAR bulletin HTTP {resp.status_code}")
    stations = _parse_markers(resp.text)
    if not stations:
        raise RuntimeError("SAFAR bulletin parsed to zero stations")

    payload = {
        "source": "IITM SAFAR (safar.tropmet.res.in) — operational WRF-Chem-class forecast",
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": ("Daily AQI category (+ number when published). Reference only — "
                 "never used for model training, tuning, or selection."),
        "stations": stations,
    }
    _cache["at"] = now
    _cache["stations"] = payload
    return payload
