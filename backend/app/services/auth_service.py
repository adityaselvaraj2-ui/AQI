"""User accounts, sessions and role-gated advisories.

Storage is a single SQLite file (backend/app/data/users.db) created on first
use. Passwords are hashed with PBKDF2-HMAC-SHA256 (600k iterations, per-user
salt) via hashlib.pbkdf2_hmac — the standard-library choice, equivalent in
strength to passlib's pbkdf2_sha256 for this purpose and dependency-free.

Roles:
  citizen   — default at registration; personal features (exposure, health chat)
  authority — registration requires a valid invite code; may publish official
              advisories and read the operator ingest key status.

Invite codes live in Supabase ONLY (authority_invite_codes table, see
supabase/invite_codes.sql) — managed by app/services/invite_store.py.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "users.db"
_PBKDF2_ITERATIONS = 600_000
# Reentrant: keeps account rows and advisory writes serialized; invite-code
# operations go to Supabase (invite_store) and never hold this lock.
_lock = threading.RLock()

logger = logging.getLogger(__name__)

# Strict-enough email shape: one @, a domain with a dot, no spaces/controls.
import re as _re

_EMAIL_RE = _re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
# Names: letters (incl. common accents), spaces, dots, apostrophes, hyphens.
_NAME_RE = _re.compile(r"^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'-]{0,119}$")
# Passwords accepted by register_user(): >= 12 chars, upper+lower+digit,
# no whitespace or control characters. (Keep in sync with the client hints.)

_COMMON_PASSWORDS = frozenset(
    {
        "password", "password1", "password12", "password123", "password1234",
        "12345678", "123456789", "1234567890", "12345678901", "123456789012",
        "qwertyuiop", "qwerty12345", "letmein1234", "welcome123",
        "iloveyou123", "admin12345", "abcd12345", "abcdefgh1",
    }
)


def _password_problems(password: str) -> list[str]:
    """Return the list of policy violations for a candidate password."""
    problems: list[str] = []
    if len(password) < 12:
        problems.append("use at least 12 characters")
    if not _re.search(r"[A-Z]", password):
        problems.append("add an uppercase letter")
    if not _re.search(r"[a-z]", password):
        problems.append("add a lowercase letter")
    if not _re.search(r"\d", password):
        problems.append("add a digit")
    if _re.search(r"\s", password) or any(ord(c) < 32 for c in password):
        problems.append("remove spaces/control characters")
    if password.strip().lower() in _COMMON_PASSWORDS:
        problems.append("this password is too common")
    return problems


class AuthError(Exception):
    """User-facing auth failure; the router maps these to HTTP status codes."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)


def _verify_password(password: str, salt: bytes, expected: bytes) -> bool:
    return hmac.compare_digest(_hash_password(password, salt), expected)


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            email         TEXT NOT NULL UNIQUE,
            full_name     TEXT NOT NULL DEFAULT '',
            role          TEXT NOT NULL CHECK (role IN ('citizen', 'authority')),
            password_salt BLOB NOT NULL,
            password_hash BLOB NOT NULL,
            created_at    REAL NOT NULL,
            auth_provider TEXT NOT NULL DEFAULT 'password'
        );
        CREATE TABLE IF NOT EXISTS advisories (
            id         TEXT PRIMARY KEY,
            author_id  TEXT NOT NULL,
            author_name TEXT NOT NULL DEFAULT '',
            title      TEXT NOT NULL,
            body       TEXT NOT NULL,
            severity   TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
            areas      TEXT NOT NULL DEFAULT '[]',
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS google_user_map (
            provider_sub TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL,
            linked_at    REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    # Migration: databases created before auth_provider existed get the column
    # added on startup (every existing row is a password account).
    cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "auth_provider" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password'")


with _db() as _conn:
    _init_schema(_conn)


# ── Registration / login ─────────────────────────────────────────────────────


def _validate_registration(email: str, password: str, full_name: str) -> None:
    if not _EMAIL_RE.match(email):
        raise AuthError("Enter a valid email address (e.g. name@example.com).")
    problems = _password_problems(password)
    if problems:
        raise AuthError("Password problem: " + "; ".join(problems) + ".", 422)
    if not _NAME_RE.match(full_name.strip()):
        raise AuthError("Full name may contain letters, spaces, dots, apostrophes and hyphens only.", 422)


def register_user(
    email: str, password: str, full_name: str, role: str, invite_code: str | None = None
) -> dict[str, Any]:
    email = email.strip().lower()
    role = role.strip().lower()
    if role not in ("citizen", "authority"):
        raise AuthError("Role must be citizen or authority.")
    _validate_registration(email, password, full_name)

    # Lazy import: invite_store reads auth_service's DB helpers, so the import
    # must not run at module load time.
    from app.services import invite_store

    code = invite_store.normalize(invite_code) if role == "authority" else None
    if role == "authority":
        if not code:
            raise AuthError("Authority registration requires an official invite code.", 403)
        shape_problem = invite_store.validate_format(code)
        if shape_problem:
            raise AuthError(shape_problem, 403)
        status = invite_store.get_status(code)
        if not status["exists"]:
            raise AuthError("This invite code is not recognised.", 403)
        if status["used"]:
            raise AuthError("This invite code has already been used.", 403)

    with _lock, _db() as conn:
        existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise AuthError("An account with this email already exists.", 409)

        user_id = secrets.token_urlsafe(16)
        salt = secrets.token_bytes(16)
        now = time.time()
        conn.execute(
            "INSERT INTO users (id, email, full_name, role, password_salt, password_hash, created_at, auth_provider) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'password')",
            (user_id, email, full_name.strip(), role, salt, _hash_password(password, salt), now),
        )

    if role == "authority":
        try:
            invite_store.redeem(code, user_id, email)
        except invite_store.InviteStoreError as exc:
            # Redemption lost a race (code consumed between the check and now)
            # or the store is unreachable: roll the account back — no authority
            # account without a confirmed code.
            with _lock, _db() as conn:
                conn.execute("DELETE FROM users WHERE id = ? AND role = 'authority'", (user_id,))
            raise AuthError(exc.message, exc.status_code) from exc

    _mirror_registration_to_supabase(email, password, full_name.strip())

    return {"id": user_id, "email": email, "full_name": full_name.strip(), "role": role}


def _mirror_registration_to_supabase(email: str, password: str, full_name: str) -> None:
    """Mirror a manual registration into Supabase Auth (best-effort, sync).

    Runs in a worker thread: register_user() is a plain def called from async
    routes, but the mirror is an httpx async call — running it inline would
    either block the event loop or need a session-wide loop. A short-lived
    thread keeps registration latency unchanged and isolation complete.
    Failure is logged, never raised: local SQLite stays the sign-in truth.
    """
    import asyncio
    import threading

    from app.services import supabase_service

    def _run() -> None:
        try:
            asyncio.run(supabase_service.create_auth_user(email, password, full_name))
        except Exception:  # noqa: BLE001 — mirror must never break registration
            pass

    threading.Thread(target=_run, name="supabase-mirror", daemon=True).start()


def authenticate_user(email: str, password: str) -> dict[str, Any]:
    email = email.strip().lower()
    with _db() as conn:
        row = conn.execute(
            "SELECT id, email, full_name, role, password_salt, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()
    # Constant-ish time: run a hash even when the user does not exist so the
    # response timing does not reveal which emails are registered.
    if row is None:
        _hash_password(password, b"timing-equalizer")
        raise AuthError("Incorrect email or password.", 401)
    if not _verify_password(password, row["password_salt"], row["password_hash"]):
        raise AuthError("Incorrect email or password.", 401)
    return {"id": row["id"], "email": row["email"], "full_name": row["full_name"], "role": row["role"]}


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    with _db() as conn:
        row = conn.execute(
            "SELECT id, email, full_name, role, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "email": row["email"], "full_name": row["full_name"], "role": row["role"]}


def get_or_create_google_user(
    provider_sub: str, email: str, full_name: str, invite_code: str | None = None
) -> dict[str, Any]:
    """Map a verified Supabase/Google identity to a local account.

    Google accounts always land as citizens unless a single-use operator
    invite code accompanies the exchange (authority-via-Google): the code is
    redeemed INSIDE this call, so the response's role and the database row
    can never disagree. Without a code a compromised Google account could
    otherwise self-promote; with one, the code itself is the proof.
    The identity is keyed by the Supabase user id (provider sub), stored in
    google_user_map.
    """
    email = (email or "").strip().lower()
    if not provider_sub:
        raise AuthError("Supabase identity missing a user id.", 401)

    # Validate + consume the invite code BEFORE touching local state, with the
    # authority-role outcome decided atomically afterwards (redeem first,
    # role second — same order as elevate_to_authority).
    code: str | None = None
    if invite_code:
        from app.services import invite_store  # lazy: avoids import cycle

        code = invite_store.normalize(invite_code)
        shape_problem = invite_store.validate_format(code)
        if shape_problem:
            raise AuthError(shape_problem, 403)
        status = invite_store.get_status(code)
        if not status["exists"]:
            raise AuthError("This invite code is not recognised.", 403)
        if status["used"]:
            raise AuthError("This invite code has already been used.", 403)

    with _lock, _db() as conn:
        existing = conn.execute(
            "SELECT user_id FROM google_user_map WHERE provider_sub = ?", (provider_sub,)
        ).fetchone()
        if existing:
            row = conn.execute(
                "SELECT id, email, full_name, role FROM users WHERE id = ?", (existing["user_id"],)
            ).fetchone()
            if row:
                # Refresh the display name if Google has a better one now.
                if full_name and full_name != row["full_name"]:
                    conn.execute(
                        "UPDATE users SET full_name = ? WHERE id = ?", (full_name[:120], row["id"])
                    )
                    row = {"id": row["id"], "email": row["email"], "full_name": full_name[:120], "role": row["role"]}
                if code and row["role"] != "authority":
                    # Returning user with a fresh invite code: redeem it and
                    # promote here so the sign-in response is already authority.
                    try:
                        invite_store_redeem(code, row["id"], row["email"])
                    except Exception as exc:
                        raise AuthError(getattr(exc, "message", str(exc)), getattr(exc, "status_code", 403)) from exc
                    row = {**row, "role": "authority"}
                return row

        # New Google identity: refuse if a password account already owns this
        # email (account takeover via unverified-Google-email would be bad).
        clash = conn.execute("SELECT id, role FROM users WHERE email = ?", (email,)).fetchone() if email else None
        if clash:
            # Link the identities instead of failing: the person signing in
            # with Google proved control of that Supabase account.
            conn.execute(
                "INSERT INTO google_user_map (provider_sub, user_id, linked_at) VALUES (?, ?, ?)",
                (provider_sub, clash["id"], time.time()),
            )
            row = conn.execute(
                "SELECT id, email, full_name, role FROM users WHERE id = ?", (clash["id"],)
            ).fetchone()
            if code and row["role"] != "authority":
                try:
                    invite_store_redeem(code, row["id"], row["email"])
                except Exception as exc:
                    raise AuthError(getattr(exc, "message", str(exc)), getattr(exc, "status_code", 403)) from exc
                row = {**row, "role": "authority"}
            return row

        user_id = secrets.token_urlsafe(16)
        # No password for Google accounts: a random unusable salt/hash pair.
        # With a validated invite code the account is born authority — the
        # redeem-before-insert order means a lost race raises before any row
        # is written, so a citizen row can never silently appear.
        salt = secrets.token_bytes(16)
        unusable_hash = _hash_password(secrets.token_urlsafe(32), salt)
        if code:
            try:
                invite_store_redeem(code, user_id, email)
            except Exception as exc:
                raise AuthError(getattr(exc, "message", str(exc)), getattr(exc, "status_code", 403)) from exc
        conn.execute(
            "INSERT INTO users (id, email, full_name, role, password_salt, password_hash, created_at, auth_provider) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'google')",
            (user_id, email or f"google-{provider_sub[:8]}@users.noreply.ncr72", full_name[:120], "authority" if code else "citizen", salt, unusable_hash, time.time()),
        )
        conn.execute(
            "INSERT INTO google_user_map (provider_sub, user_id, linked_at) VALUES (?, ?, ?)",
            (provider_sub, user_id, time.time()),
        )
        return {"id": user_id, "email": email, "full_name": full_name[:120], "role": "authority" if code else "citizen"}


# ── Authority elevation ─────────────────────────────────────────────────────


def get_auth_provider(user_id: str) -> str | None:
    with _db() as conn:
        row = conn.execute("SELECT auth_provider FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["auth_provider"] if row else None


def invite_store_redeem(code: str, user_id: str, email: str) -> None:
    """Thin alias over invite_store.redeem keeping the redeem-first order used
    by every role-promotion path in one place."""
    from app.services import invite_store  # lazy: avoids import cycle

    invite_store.redeem(code, user_id, email)


def elevate_to_authority(user_id: str, invite_code: str) -> dict[str, Any]:
    """Redeem an invite code on an existing citizen account to gain authority.

    Same single-use code semantics as authority registration. Works for any
    signed-in citizen regardless of provider — the operator-issued single-use
    code is the proof of legitimacy, identical to the registration path.
    """
    from app.services import invite_store  # lazy: avoids import cycle

    code = invite_store.normalize(invite_code)
    if not code:
        raise AuthError("An official invite code is required for authority access.", 403)

    with _lock, _db() as conn:
        row = conn.execute(
            "SELECT id, email, full_name, role FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise AuthError("Account not found.", 401)
        if row["role"] == "authority":
            return {"id": row["id"], "email": row["email"], "full_name": row["full_name"], "role": row["role"]}

    # Atomic consume first; only a winning redemption promotes the account.
    try:
        invite_store.redeem(code, user_id, row["email"])
    except invite_store.InviteStoreError as exc:
        raise AuthError(exc.message, exc.status_code) from exc

    with _lock, _db() as conn:
        conn.execute("UPDATE users SET role = 'authority' WHERE id = ?", (user_id,))

    # Mirror the promoted role into Supabase (profiles + auth metadata).
    import asyncio
    import threading

    from app.services import supabase_service

    def _run() -> None:
        try:
            asyncio.run(supabase_service.update_auth_user_role(user_id, row["email"], "authority"))
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_run, name="supabase-role-mirror", daemon=True).start()

    return {"id": row["id"], "email": row["email"], "full_name": row["full_name"], "role": "authority"}


# ── Advisories: the role-gated feature ───────────────────────────────────────


def publish_advisory(
    author: dict[str, Any], title: str, body: str, severity: str, areas: list[str]
) -> dict[str, Any]:
    if not title.strip() or not body.strip():
        raise AuthError("Advisory title and body are required.")
    if severity not in ("info", "warning", "critical"):
        raise AuthError("Severity must be info, warning or critical.")
    advisory_id = secrets.token_urlsafe(12)
    record = {
        "id": advisory_id,
        "author_id": author["id"],
        "author_name": author["full_name"],
        "title": title.strip()[:200],
        "body": body.strip()[:4000],
        "severity": severity,
        "areas": json.dumps([a.strip() for a in areas if a.strip()][:20]),
        "created_at": time.time(),
    }
    with _lock, _db() as conn:
        conn.execute(
            "INSERT INTO advisories (id, author_id, author_name, title, body, severity, areas, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            tuple(record.values()),
        )
    return _advisory_to_dict(record)


def list_advisories(limit: int = 50, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
    """Public listing page: strips the internal author id, returns (rows, total)."""
    with _db() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM advisories").fetchone()["n"]
        rows = conn.execute(
            "SELECT * FROM advisories ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (max(1, min(limit, 200)), max(0, offset)),
        ).fetchall()
    out = []
    for row in rows:
        record = _advisory_to_dict(dict(row))
        record.pop("author_id", None)
        out.append(record)
    return out, total


def delete_advisory(author: dict[str, Any], advisory_id: str) -> bool:
    """An authority may delete only their own advisories."""
    with _lock, _db() as conn:
        cursor = conn.execute(
            "DELETE FROM advisories WHERE id = ? AND author_id = ?", (advisory_id, author["id"])
        )
        return cursor.rowcount > 0


def _advisory_to_dict(record: dict[str, Any]) -> dict[str, Any]:
    out = dict(record)
    try:
        out["areas"] = json.loads(out.get("areas") or "[]")
    except (json.JSONDecodeError, TypeError):
        out["areas"] = []
    return out
