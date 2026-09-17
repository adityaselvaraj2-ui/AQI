"""Pipeline-integrity helpers: atomic JSON writes, keyed read-modify-write
merges, and disk-space preflight checks.

Every persistent JSON artifact in the training pipeline goes through here so a
crash can never leave a truncated file and concurrent/partial runs can never
blindly clobber other stations' entries (the Vivek Vihar bug).

Usage:
    atomic_write_json(path, obj)                     # temp file + os.replace
    merge_json_entries(path, entries, key="station_id", sort_key=None)
    ensure_disk_free(path, need_gb=1.0)
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile


def atomic_write_json(path: str, obj) -> None:
    """Write obj to path atomically: temp file in the same dir, then os.replace."""
    d = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp_", suffix=".json", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=1 if not isinstance(obj, (list, dict)) else None)
            if not isinstance(obj, (list, dict)):
                pass
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        # truncated/corrupt from a pre-fix run — keep going with default but warn
        print(f"[io_utils] WARNING: {path} is corrupt; starting from scratch", flush=True)
        return default


def merge_json_entries(path: str, entries: list[dict], key: str = "station_id",
                       sort_key=None, indent: int | None = 2) -> list[dict]:
    """Read-modify-write a JSON *list* of dicts keyed by `key`.

    Existing entries with the same key are REPLACED by the new ones; all other
    entries are preserved.  Write is atomic.  Returns the merged list.
    """
    if not isinstance(entries, list) or not entries:
        raise ValueError(f"refusing to merge empty/non-list entries into {path}")
    current = _load_json(path, [])
    if not isinstance(current, list):
        current = []
    by_key = {}
    for rec in current:
        if isinstance(rec, dict) and key in rec:
            by_key[rec[key]] = rec
    for rec in entries:
        if isinstance(rec, dict) and key in rec:
            by_key[rec[key]] = rec
    merged = list(by_key.values())
    if sort_key is not None:
        merged.sort(key=sort_key)
    atomic_write_json(path, merged)
    return merged


def ensure_disk_free(path: str, need_gb: float = 1.0) -> float:
    """Raise if free space at `path` is below need_gb; return free GB."""
    free_gb = shutil.disk_usage(os.path.abspath(path)).free / 1024 ** 3
    if free_gb < need_gb:
        raise RuntimeError(
            f"disk preflight FAILED: {free_gb:.1f} GB free at {path}, need {need_gb} GB"
        )
    return free_gb
