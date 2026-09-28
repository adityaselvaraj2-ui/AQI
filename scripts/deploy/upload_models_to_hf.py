"""Upload the trained per-station model artifacts to the Hugging Face Hub.

Creates (or reuses) the model repo ${HF_MODEL_REPO} and uploads the LightGBM
station fleet, the Chronos-2 adapters, and the station registry. Model weights
are served from the Hub at runtime with MODEL_SOURCE=hf; git stops carrying
them.

Usage:
    set HF_TOKEN=hf_...                  (token with write access; env only)
    set HF_MODEL_REPO=techtitans07x/airlens-models
    python scripts/deploy/upload_models_to_hf.py [--repo owner/name] [--dry-run]

The token is read from the HF_TOKEN environment variable ONLY — it is never
accepted as a CLI argument (it would land in shell history) and never logged.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_ROOT / "llm" / "model" / "station_models"
CHRONOS_DIR = REPO_ROOT / "llm" / "model" / "station_models_chronos2"
REGISTRY = REPO_ROOT / "llm" / "artifacts" / "station_registry.json"
MODEL_CARD = REPO_ROOT / "llm" / "model" / "MODEL_CARD.md"

# Small eval/metrics files tracked in git are excluded from the upload — the
# Hub copy carries the weights; the repo keeps the metrics.
EXCLUDE_TOP_LEVEL = {
    "METRICS.md", "STATION_METRICS.xlsx", "metrics_summary.json",
    "metrics_summary_v1_backup.json", "registry.json", "README.md",
    "CHRONOS2_VERDICT.md", "head_to_head.json",
    "metrics_summary_contract_format.json",
}
EXCLUDE_DIR_PREFIXES = ("preds_",)


def _collect(paths: list[Path]) -> list[tuple[Path, str]]:
    """(local_path, repo_relative_posix) pairs for everything worth uploading."""
    out: list[tuple[Path, str]] = []
    for base, repo_prefix in ((MODELS_DIR, "station_models"),
                              (CHRONOS_DIR, "station_models_chronos2")):
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_dir():
                continue
            rel = p.relative_to(base)
            if rel.parts[0] in EXCLUDE_TOP_LEVEL or rel.parts[0].startswith(EXCLUDE_DIR_PREFIXES):
                continue
            out.append((p, f"{repo_prefix}/{rel.as_posix()}"))
    if REGISTRY.is_file():
        out.append((REGISTRY, "station_registry.json"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default=os.environ.get("HF_MODEL_REPO", ""),
                    help="HF repo id, e.g. techtitans07x/airlens-models "
                         "(defaults to $HF_MODEL_REPO)")
    ap.add_argument("--dry-run", action="store_true", help="list files and exit")
    args = ap.parse_args()

    if not args.repo:
        print("error: no repo id given and HF_MODEL_REPO is not set", file=sys.stderr)
        return 2
    if not (os.environ.get("HF_TOKEN") or "").strip():
        print("error: HF_TOKEN is not set (never pass it as an argument)", file=sys.stderr)
        return 2

    files = _collect()
    total_mb = sum(p.stat().st_size for p, _ in files) / (1024 * 1024)
    print(f"{len(files)} files, {total_mb:.0f} MB -> {args.repo}")
    for p, rel in files[:10]:
        print(f"  {rel}  ({p.stat().st_size / (1024*1024):.1f} MB)")
    if len(files) > 10:
        print(f"  ... and {len(files) - 10} more")
    if args.dry_run:
        print("dry run: nothing uploaded")
        return 0

    from huggingface_hub import HfApi

    api = HfApi(token=os.environ["HF_TOKEN"])
    api.create_repo(repo_id=args.repo, repo_type="model", exist_ok=True)

    # upload_large_folder is resilient for multi-GB trees (retries per file,
    # parallel workers); upload_folder would be fine but slower at this size.
    api.upload_large_folder(
        repo_id=args.repo,
        repo_type="model",
        folder_path=str(REPO_ROOT),
        allow_patterns=[
            "llm/model/station_models/**",
            "llm/model/station_models_chronos2/**",
            "llm/artifacts/station_registry.json",
        ],
        ignore_patterns=[
            "llm/model/station_models/METRICS.md",
            "llm/model/station_models/STATION_METRICS.xlsx",
            "llm/model/station_models/metrics_summary*.json",
            "llm/model/station_models/registry.json",
            "llm/model/station_models_chronos2/preds_*/**",
            "llm/model/station_models_chronos2/metrics_summary*.json",
            "llm/model/station_models_chronos2/head_to_head.json",
            "llm/model/station_models_chronos2/eval_*.json",
            "llm/model/station_models_chronos2/CHRONOS2_VERDICT.md",
            ".git/**", "webapp/**", "backend/**", "docs/**", "scripts/**",
        ],
    )
    if MODEL_CARD.is_file():
        api.upload_file(
            path_or_fileobj=str(MODEL_CARD),
            path_in_repo="README.md",
            repo_id=args.repo,
            repo_type="model",
        )
        print("model card -> README.md")
    else:
        print("note: llm/model/MODEL_CARD.md not found; repo has no model card")
    print("upload complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
