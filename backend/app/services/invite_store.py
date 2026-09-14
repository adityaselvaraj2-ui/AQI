"""Authority invite codes: Supabase is the ONLY store.

One module owns every invite-code read/write. The backend's service-role key
is the only writer; the browser never sees codes directly (RLS: zero policies,
all browser grants revoked — see supabase/invite_codes.sql).

There is deliberately NO SQLite fallback: per operator decision the website
checks the live Supabase database, period. If Supabase is unreachable, code
operations fail with a clear error rather than silently diverging into a
second store — two stores of truth is how codes get "lost".

Redemption is atomic through a single guarded PATCH: Postgres evaluates
`used_by=is.null` and the new value in one UPDATE, so two concurrent
redemptions cannot both succeed — exactly one receives the row back.
"""

from __future__ import annotations

import logging
import re
import secrets
import time
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

CODE_RE = re.compile(r"^NCR72-[A-Z0-9]{6,20}$")


class InviteStoreError(Exception):
    """User-facing invite-code failure (message maps straight to the client)."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class StoreUnavailableError(InviteStoreError):
    """Supabase is configured but unreachable / table missing (maps to 503)."""

    def __init__(self, detail: str = "") -> None:
        msg = "Invite-code database is unreachable" + (f": {detail}" if detail else "") + ". Try again shortly."
        super().__init__(msg, 503)


# ── Connection helpers ───────────────────────────────────────────────────────


def active_backend() -> str:
    """Reported in the operator console header. Always 'supabase' now."""
    return "supabase"


def _require_config() -> None:
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_role_key):
        raise StoreUnavailableError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured")


def _service_headers() -> dict[str, str]:
    s = get_settings()
    return {
        "apikey": s.supabase_service_role_key,
        "Authorization": f"Bearer {s.supabase_service_role_key}",
    }


def _sb_url() -> str:
    return f"{get_settings().supabase_url.rstrip('/')}/rest/v1/authority_invite_codes"


# ── Normalisation / validation ───────────────────────────────────────────────


def normalize(code: str | None) -> str:
    return (code or "").strip().upper()


def validate_format(code: str) -> str | None:
    """Human-readable problem with the code's shape, or None when it looks right."""
    if not CODE_RE.match(code):
        return "Codes look like NCR72-XXXXXXXX — uppercase letters and digits after the dash."
    return None


# ── Public API ───────────────────────────────────────────────────────────────


def generate_code(label: str, created_by: str = "operator") -> dict[str, Any]:
    """Mint a fresh unique code (8 random hex chars ≈ 4.3 billion space)."""
    code = f"NCR72-{secrets.token_hex(4).upper()}"
    _require_config()
    try:
        resp = httpx.post(
            _sb_url(),
            headers={**_service_headers(), "Prefer": "return=representation"},
            json=[{"code": code, "label": label.strip()[:120], "created_by": created_by}],
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc
    if resp.status_code not in (200, 201):
        raise InviteStoreError(f"Database rejected the new code (HTTP {resp.status_code}).", 502)
    return {"code": code, "label": label.strip()[:120]}


def create_custom_code(code: str, label: str, created_by: str = "operator") -> dict[str, Any]:
    """Insert an operator-chosen code; 409 when it already exists."""
    code = normalize(code)
    problem = validate_format(code)
    if problem:
        raise InviteStoreError(problem, 422)
    # Real-time duplicate check first, for a precise message.
    status = get_status(code)
    if status.get("exists"):
        when = " and already used" if status.get("used") else ""
        raise InviteStoreError(f"This code is already defined{when}.", 409)

    _require_config()
    try:
        resp = httpx.post(
            _sb_url(),
            headers={**_service_headers(), "Prefer": "return=representation"},
            json=[{"code": code, "label": label.strip()[:120], "created_by": created_by}],
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc
    if resp.status_code not in (200, 201):
        # 409 = lost a race with a concurrent insert of the same code.
        raise InviteStoreError("This code is already defined.", 409)
    return {"code": code, "label": label.strip()[:120]}


def get_status(code: str) -> dict[str, Any]:
    """Real-time status of one code: exists / available / already used."""
    code = normalize(code)
    _require_config()
    try:
        resp = httpx.get(
            _sb_url(),
            params={"select": "*", "code": f"eq.{code}", "limit": 1},
            headers=_service_headers(),
            timeout=8.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc
    rows = resp.json()
    if not rows:
        return {"exists": False, "used": False}
    row = rows[0]
    return {
        "exists": True,
        "used": row.get("used_by") is not None,
        "label": row.get("label") or "",
        "created_at": row.get("created_at"),
    }


def redeem(code: str, user_id: str, user_email: str | None) -> None:
    """Atomically consume a code for user_id, or raise InviteStoreError.

    Single guarded UPDATE: races cannot double-consume. Empty response means
    the code either doesn't exist or was consumed a moment ago — distinguish
    with one follow-up read for the precise user-facing message.
    """
    code = normalize(code)
    _require_config()
    try:
        resp = httpx.patch(
            _sb_url(),
            params={"code": f"eq.{code}", "used_by": "is.null"},
            headers={**_service_headers(), "Prefer": "return=representation"},
            json={"used_by": user_id, "used_by_email": user_email, "used_at": _now_iso()},
            timeout=8.0,
        )
        resp.raise_for_status()
        if resp.json():  # representation non-empty → THIS call won the race
            return
        row = _get_row(code)
        if row is None:
            raise InviteStoreError("This invite code is not recognised.", 403)
        raise InviteStoreError("This invite code has already been used.", 403)
    except httpx.HTTPError as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc


def list_codes() -> list[dict[str, Any]]:
    """All codes, newest first (operator console listing)."""
    _require_config()
    try:
        resp = httpx.get(
            _sb_url(),
            params={"select": "*", "order": "created_at.desc", "limit": 200},
            headers=_service_headers(),
            timeout=8.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc


def revoke(code: str) -> bool:
    """Delete an unused code (used codes are history, not revocable)."""
    code = normalize(code)
    _require_config()
    try:
        resp = httpx.delete(
            _sb_url(),
            params={"code": f"eq.{code}", "used_by": "is.null"},
            headers=_service_headers(),
            timeout=8.0,
        )
        resp.raise_for_status()
        return resp.text not in ("", "null") and int(resp.text or 0) > 0
    except (httpx.HTTPError, ValueError) as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc


def import_code(
    code: str,
    label: str,
    created_by: str,
    created_at_epoch: float | None,
    used_by: str | None,
    used_by_email: str | None,
    used_at_epoch: float | None,
) -> None:
    """One-time migration helper: insert an existing code with its history.

    Used by the operator to move legacy codes into Supabase. Bypasses the
    duplicate pre-check on purpose — callers use on-conflict behaviour to
    decide whether to skip. Raises StoreUnavailableError on connectivity
    problems; returns silently on success or conflict-skip.
    """
    _require_config()
    row: dict[str, Any] = {"code": code, "label": label, "created_by": created_by}
    if created_at_epoch:
        row["created_at"] = _epoch_to_iso(created_at_epoch)
    if used_by is not None:
        row["used_by"] = used_by
        row["used_by_email"] = used_by_email
        row["used_at"] = _epoch_to_iso(used_at_epoch or time.time())
    try:
        resp = httpx.post(
            _sb_url(),
            headers={**_service_headers(), "Prefer": "resolution=ignore-duplicates,return=minimal"},
            params={"on_conflict": "code"},
            json=[row],
            timeout=8.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise StoreUnavailableError(str(exc.__class__.__name__)) from exc


def _get_row(code: str) -> dict[str, Any] | None:
    resp = httpx.get(
        _sb_url(),
        params={"select": "*", "code": f"eq.{code}", "limit": 1},
        headers=_service_headers(),
        timeout=8.0,
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def _epoch_to_iso(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
