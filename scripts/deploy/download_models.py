"""Download the model artifacts from the Hugging Face Hub for local serving.

The inverse of upload_models_to_hf.py: fetches the LightGBM station fleet, the
Chronos-2 adapters and the station registry into the repository tree so a
MODEL_SOURCE=local checkout (the development default) can serve forecasts
without cloning gigabytes of weights through git.

Usage:
    set HF_MODEL_REPO=techtitans07x/airlens-models
    set HF_TOKEN=hf_...            (only needed if the model repo is private)
    python scripts/deploy/download_models.py [--pollutant pm25] [--chronos]

Notes:
  - The LightGBM fleet (~640 MB) downloads station_models/<id>/ directories.
  - Chronos-2 adapters are optional (opt-in via --chronos, ~320 MB, and the
    runtime also requires ENABLE_CHRONOS=1 plus torch/chronos to serve them).
  - With no --station filter this pulls every trained station; pass
    --station 50 to fetch a single station quickly.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_ROOT / "llm" / "model" / "station_models"
CHRONOS_DIR = REPO_ROOT / "llm" / "model" / "station_models_chronos2"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default=os.environ.get("HF_MODEL_REPO", ""),
                    help="HF repo id (defaults to $HF_MODEL_REPO)")
    ap.add_argument("--station", action="append", default=[],
                    help="station id to fetch (repeatable; default: all)")
    ap.add_argument("--chronos", action="store_true",
                    help="also fetch the Chronos-2 adapters")
    args = ap.parse_args()

    if not args.repo:
        print("error: no repo id given and HF_MODEL_REPO is not set", file=sys.stderr)
        return 2

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("error: pip install huggingface_hub first", file=sys.stderr)
        return 2

    if args.station:
        patterns = [f"station_models/{sid}/*" for sid in args.station]
    else:
        patterns = ["station_models/*/*"]
    if args.chronos:
        patterns.append("station_models_chronos2/global_*/*")
    patterns.append("station_registry.json")

    root = snapshot_download(
        repo_id=args.repo,
        allow_patterns=patterns,
        token=(os.environ.get("HF_TOKEN") or "").strip() or None,
    )
    root_path = Path(root)

    # materialise the files inside the repo tree where local-mode serving looks
    targets = [(root_path / "station_models", MODELS_DIR)]
    if args.chronos:
        targets.append((root_path / "station_models_chronos2", CHRONOS_DIR))
    registry_src = root_path / "station_registry.json"
    registry_dst = REPO_ROOT / "llm" / "artifacts" / "station_registry.json"
    if registry_src.is_file():
        registry_dst.parent.mkdir(parents=True, exist_ok=True)
        registry_dst.write_bytes(registry_src.read_bytes())
        print(f"station_registry.json -> {registry_dst.relative_to(REPO_ROOT)}")

    for src, dst in targets:
        if not src.is_dir():
            continue
        dst.mkdir(parents=True, exist_ok=True)
        n = 0
        for p in src.rglob("*"):
            if p.is_dir():
                continue
            rel = p.relative_to(src)
            out = dst / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(p.read_bytes())
            n += 1
        print(f"{n} files -> {dst.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
