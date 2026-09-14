"""Minimal HS256 JSON Web Tokens using only the standard library.

The project deliberately carries no python-jose/pyjwt dependency (see the
comment in config.py about removed keys), and adding one here would break the
"no new dependencies for auth" constraint this file was written under. HS256 is
twenty lines of hmac + base64; anything fancier (RS256, JWE, key rotation) is
out of scope for a local deployment and should come with a real dependency.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Any

# Signing secret: persisted beside the ML artifacts so sessions survive a
# backend restart. Generated on first use. For a multi-instance deployment this
# must move to a shared secret manager — a per-instance key breaks sessions
# behind a round-robin load balancer.
_SECRET_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "jwt_secret.key"


def _load_secret() -> bytes:
    if _SECRET_PATH.is_file():
        return _SECRET_PATH.read_bytes()
    secret = secrets.token_bytes(48)
    _SECRET_PATH.write_bytes(secret)
    try:
        _SECRET_PATH.chmod(0o600)
    except OSError:
        pass  # best effort on platforms without POSIX permissions
    return secret


_SECRET = _load_secret()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def create_token(subject: str, role: str, expires_seconds: int = 60 * 60 * 24 * 7) -> str:
    """Mint a signed token for a user id with an embedded role claim."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + expires_seconds,
    }
    signing_input = (
        _b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64url(json.dumps(payload, separators=(",", ":")).encode())
    )
    signature = hmac.new(_SECRET, signing_input.encode("ascii"), hashlib.sha256).digest()
    return signing_input + "." + _b64url(signature)


def _verify_signed(token: str) -> dict[str, Any] | None:
    """Shared signature/expiry check; callers enforce their own role claim."""
    try:
        header_segment, payload_segment, signature_segment = token.split(".")
        signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
        expected = hmac.new(_SECRET, signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64url_decode(signature_segment)):
            return None
        header = json.loads(_b64url_decode(header_segment))
        if header.get("alg") != "HS256":
            return None
        payload = json.loads(_b64url_decode(payload_segment))
        if not isinstance(payload.get("exp"), (int, float)) or payload["exp"] < time.time():
            return None
        if not isinstance(payload.get("sub"), str):
            return None
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def verify_token(token: str) -> dict[str, Any] | None:
    """Return the payload if the signature and expiry check out, else None."""
    payload = _verify_signed(token)
    if payload is None or payload.get("role") not in ("citizen", "authority"):
        return None
    return payload


# ── Operator console tokens (short-lived, separate role — never accepted by
#    verify_token, so an operator token can never act as a user account) ──────

OPERATOR_TOKEN_SECONDS = 60 * 30  # 30 minutes


def create_operator_token(expires_seconds: int = OPERATOR_TOKEN_SECONDS) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": "operator-console",
        "role": "operator",
        "iat": now,
        "exp": now + expires_seconds,
    }
    signing_input = (
        _b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64url(json.dumps(payload, separators=(",", ":")).encode())
    )
    signature = hmac.new(_SECRET, signing_input.encode("ascii"), hashlib.sha256).digest()
    return signing_input + "." + _b64url(signature)


def verify_operator_token(token: str) -> bool:
    payload = _verify_signed(token)
    return payload is not None and payload.get("role") == "operator"
