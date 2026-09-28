"""MODEL_SOURCE resolution for the per-station model artifacts.

`resolve_station_dir` decides where a station's LightGBM artifacts live:

  - MODEL_SOURCE=local (default, development): the in-repo
    llm/model/station_models/<id>/ directory; missing stations resolve to None
    so the caller can report "not trained".
  - MODEL_SOURCE=hf (deployment): a lazy, per-station snapshot_download from
    $HF_MODEL_REPO that pulls ONLY station_models/<id>/* into the cache dir —
    never the whole repo, and nothing at import/boot time. The snapshot call
    is patched here, so the Hub is never contacted.

A download failure raises FileNotFoundError with a message the API layer maps
to a clean 503; the Hub exception itself never escapes.

These tests avoid pytest fixtures on purpose: the project's stdlib runner
(backend/tests/run_without_pytest.py) calls each test function with no
arguments, so setup/teardown is done with context managers to stay runnable
under both this runner and plain pytest.
"""
import contextlib
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from llm.model import station_chronos2_service as C  # noqa: E402
from llm.model import station_forecast_service as S  # noqa: E402

_ENV_KEYS = ("MODEL_SOURCE", "HF_MODEL_REPO", "MODEL_CACHE_DIR", "ENABLE_CHRONOS")


@contextlib.contextmanager
def _env(**overrides):
    """Set env overrides for the block; restore afterwards. None = unset."""
    saved = {k: os.environ.get(k) for k in _ENV_KEYS}
    S._HF_STATION_DIRS.clear()
    for key, value in overrides.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        S._HF_STATION_DIRS.clear()


@contextlib.contextmanager
def _patched(obj, name, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)


def test_local_mode_resolves_in_repo_station():
    """local mode returns the repo path for a station that has artifacts."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "station_models"
        (root / "123").mkdir(parents=True)
        with _env(), _patched(S, "MODELS_DIR", str(root)):
            assert S.resolve_station_dir(123) == str(root / "123")


def test_local_mode_returns_none_for_untrained_station():
    """local mode returns None (not an error) when the station was never trained."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "station_models"
        root.mkdir()
        with _env(), _patched(S, "MODELS_DIR", str(root)):
            assert S.resolve_station_dir(999) is None


def test_hf_mode_downloads_only_that_station():
    """hf mode requests allow_patterns for exactly one station and caches the path."""
    with tempfile.TemporaryDirectory() as td:
        fake_root = Path(td) / "snapshot"
        (fake_root / "station_models" / "42").mkdir(parents=True)
        cache_dir = Path(td) / "cache"
        calls = {}

        def fake_snapshot_download(**kwargs):
            calls.update(kwargs)
            return str(fake_root)

        with _env(MODEL_SOURCE="hf", HF_MODEL_REPO="acme/airlens-models",
                  MODEL_CACHE_DIR=str(cache_dir)), \
                _patched(S, "_snapshot_download", fake_snapshot_download):
            resolved = S.resolve_station_dir(42)
            assert resolved == os.path.join(str(fake_root), "station_models", "42")
            assert calls["repo_id"] == "acme/airlens-models"
            assert calls["allow_patterns"] == ["station_models/42/*"]
            assert calls["cache_dir"] == str(cache_dir)

            # second call is served from the in-memory cache: no second download
            calls.clear()
            assert S.resolve_station_dir(42) == resolved
            assert not calls, "hf resolution must be cached after the first download"


def test_hf_mode_raises_clean_error_when_repo_missing_station():
    """A snapshot that lacks the station's artifacts is a clean FileNotFoundError."""
    with tempfile.TemporaryDirectory() as td:
        fake_root = Path(td) / "snapshot"
        (fake_root / "station_models").mkdir(parents=True)
        with _env(MODEL_SOURCE="hf", HF_MODEL_REPO="acme/airlens-models",
                  MODEL_CACHE_DIR=str(Path(td) / "cache")), \
                _patched(S, "_snapshot_download", lambda **kw: str(fake_root)):
            with pytest.raises(FileNotFoundError):
                S.resolve_station_dir(7)


def test_hf_mode_wraps_download_failure_in_filenotfound():
    """A Hub exception never escapes; it becomes a clear 503-mappable error."""
    def boom(**kwargs):
        raise ConnectionError("network unreachable")

    with _env(MODEL_SOURCE="hf", HF_MODEL_REPO="acme/airlens-models"), \
            _patched(S, "_snapshot_download", boom):
        with pytest.raises(FileNotFoundError, match="download .* failed"):
            S.resolve_station_dir(5)


def test_hf_mode_without_repo_is_a_clean_error():
    """MODEL_SOURCE=hf with no HF_MODEL_REPO must fail loudly and clearly."""
    with _env(MODEL_SOURCE="hf", HF_MODEL_REPO=None):
        with pytest.raises(FileNotFoundError, match="HF_MODEL_REPO"):
            S.resolve_station_dir(1)


def test_chronos_opt_in_gate():
    """The Chronos-2 comparison path is off unless ENABLE_CHRONOS=1."""
    with _env(ENABLE_CHRONOS=None):
        assert C.chronos_available() is False
    with _env(ENABLE_CHRONOS="0"):
        assert C.chronos_available() is False
    with tempfile.TemporaryDirectory() as td, \
            _env(ENABLE_CHRONOS="1", MODEL_SOURCE=None, HF_MODEL_REPO=None), \
            _patched(C, "CHRONOS_DIR", str(td)):
        (Path(td) / "global_pm25").mkdir()
        assert C.chronos_available() is True
