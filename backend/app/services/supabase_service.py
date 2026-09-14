"""Supabase integration: OAuth token verification + service-role data sync.

Two independent jobs live here:

1. verify_supabase_access_token() — validates an access token issued by
   Supabase Auth (used by Google sign-in) by asking Supabase itself to
   resolve it: GET /auth/v1/user with the token as Bearer returns the user
   record only for a live, valid token. This delegates RS256 verification to
   Supabase and avoids pulling a JWT/JWKS library into the deployment — the
   same no-new-dependencies constraint as core/jwt_utils.py.

2. upsert_rows() — service-role writes for the periodic data sync. Uses the
   SUPABASE_SERVICE_ROLE_KEY (server-only, never shipped to the browser) to
   bypass RLS for operational tables. Failure modes are non-fatal: if Supabase
   is unreachable or not configured, sync methods log and continue so the
   console never breaks because of the archival path.

Dependencies: only httpx (already in requirements.txt). No supabase-py.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class SupabaseAuthError(Exception):
    """Supabase token verification failure (maps to HTTP 401 by the router)."""


async def create_auth_user(email: str, password: str, full_name: str, email_confirm: bool = True) -> dict[str, Any] | None:
    """Register a manual (email+password) account in Supabase Auth.

    Why: the public `profiles` table has a foreign key to `auth.users`, and
    profile rows are created by a trigger on auth-user insert. Google sign-ins
    land in auth.users via OAuth, so their profiles appear automatically —
    manual registrations never touched Supabase at all, so their emails never
    showed up. Mirroring the account here makes both paths identical.

    Uses the service-role admin API (POST /auth/v1/admin/users). Returns the
    created auth user dict, or None when Supabase is not configured. Failure
    is non-fatal: the local SQLite account remains the source of truth for
    sign-in, and Supabase mirroring is best-effort — the caller logs and
    continues so registration never breaks because of the mirror.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "password": password,
        "email_confirm": email_confirm,
        "user_metadata": {"full_name": full_name},
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("Supabase auth-user create for %s failed: %s", email, exc)
        return None
    if resp.status_code not in (200, 201):
        logger.warning("Supabase auth-user create for %s returned HTTP %s: %s", email, resp.status_code, resp.text[:200])
        return None
    return resp.json()


async def update_auth_user_role(local_user_id: str, email: str, role: str) -> None:
    """Best-effort role mirror onto the Supabase auth user's metadata + profile.

    Called after an invite-code elevation so Supabase reflects the promoted
    role the way it does for native authorities. Never raises.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return

    # Resolve the Supabase auth user id by email (admin list endpoint).
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    auth_user_id: str | None = None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params={"email": email}, headers=headers)
            if resp.status_code == 200:
                for u in resp.json().get("users", []):
                    if (u.get("email") or "").lower() == email.lower():
                        auth_user_id = u.get("id")
                        break
    except httpx.HTTPError:
        return
    if not auth_user_id:
        return

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            await client.put(
                f"{url}/{auth_user_id}",
                json={"user_metadata": {"full_name": email.split("@")[0], "role": role, "local_user_id": local_user_id}},
                headers={**headers, "Content-Type": "application/json"},
            )
        except httpx.HTTPError:
            pass
        try:
            await client.patch(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles",
                params={"id": f"eq.{auth_user_id}"},
                json={"role": role},
                headers={
                    "apikey": settings.supabase_service_role_key,
                    "Authorization": f"Bearer {settings.supabase_service_role_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
            )
        except httpx.HTTPError:
            pass


async def verify_supabase_access_token(access_token: str) -> dict[str, Any]:
    """Validate a Supabase Auth token via Supabase and return the identity.

    Returns a dict with sub, email, full_name on success.
    Raises SupabaseAuthError on any failure.
    """
    settings = get_settings()
    if not settings.supabase_url:
        raise SupabaseAuthError("Supabase is not configured on the server.")

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "apikey": settings.supabase_anon_key or settings.supabase_key,
        "Authorization": f"Bearer {access_token}",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise SupabaseAuthError(f"Could not reach Supabase to verify the token: {exc}") from exc

    if resp.status_code == 401:
        raise SupabaseAuthError("Supabase rejected this sign-in token (expired or invalid).")
    if resp.status_code != 200:
        raise SupabaseAuthError(f"Supabase token check failed with HTTP {resp.status_code}.")

    user = resp.json()
    user_metadata = user.get("user_metadata") or {}
    email = user.get("email") or user_metadata.get("email")
    full_name = (
        user_metadata.get("full_name")
        or user_metadata.get("name")
        or (email.split("@")[0] if email else "Google User")
    )
    return {
        "sub": user.get("id") or user.get("sub") or "",
        "email": email,
        "full_name": full_name,
    }


# ── Service-role data sync ───────────────────────────────────────────────────


async def upsert_rows(table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
    """Upsert rows into a Supabase table with the service-role key.

    Returns the number of rows sent, or 0 when Supabase is not configured.
    Raises nothing: callers treat archival as best-effort.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key or not rows:
        return 0

    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"
    params = {"on_conflict": on_conflict}
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=rows, params=params, headers=headers)
            resp.raise_for_status()
            return len(rows)
    except httpx.HTTPError as exc:
        logger.warning("Supabase upsert to %s failed: %s", table, exc)
        return 0
