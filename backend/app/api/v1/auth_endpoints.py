"""Authentication, Supabase Google sign-in, & role-gated advisories routes.

Mounted under /api/v1 via the main router (see api/v1/endpoints.py). Sessions
are stateless JWTs carried in the Authorization: Bearer header; nothing
server-side needs invalidating on logout because the client discards the token.

Design notes (REST discipline):
- Every route is rate-limited; credential routes get the tightest budgets
  because they are the ones worth brute-forcing.
- Collections are plural nouns, offset/limit paginated, and responses have
  explicit response_model schemas so /docs shows real types.
- DELETE returns 204 No Content — the client asked for removal, there is
  nothing to say back.
- Sync triggering is modelled as creating a sync cycle (POST /sync/cycles),
  not a verb endpoint.

No `from __future__ import annotations` here: string annotations combined with
the slowapi decorator sitting between router.post and the handler break
pydantic's forward-ref resolution (it loses the defining module's namespace).
Every annotation below is valid runtime syntax on Python 3.11, so the future
import buys nothing.
"""

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core import jwt_utils
from app.core.config import get_settings
from app.core.jwt_utils import create_token, verify_operator_token, verify_token
from app.core.rate_limit import limiter
from app.services import auth_service, invite_store, supabase_service, sync_service
from app.services.auth_service import AuthError
from app.services.invite_store import InviteStoreError
from app.services.supabase_service import SupabaseAuthError

router = APIRouter(prefix="/auth", tags=["Auth"])
_bearer = HTTPBearer(auto_error=False)


# ── Dependencies ─────────────────────────────────────────────────────────────


def _auth_error(exc: AuthError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any] | None:
    """Resolve the caller when a token is present; None for anonymous visitors."""
    if credentials is None or not credentials.credentials:
        return None
    payload = verify_token(credentials.credentials)
    if payload is None:
        return None
    return auth_service.get_user_by_id(payload["sub"])


def require_user(user: dict[str, Any] | None = Depends(optional_user)) -> dict[str, Any]:
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


def require_authority(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    if user["role"] != "authority":
        raise HTTPException(
            status_code=403,
            detail="Authority role required. This action is restricted to official accounts.",
        )
    return user


def require_operator(
    authorization: str | None = Header(default=None),
) -> None:
    """Validate the short-lived operator JWT minted by POST /auth/operator/session."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Operator session required.")
    if not verify_operator_token(authorization.split(" ", 1)[1].strip()):
        raise HTTPException(status_code=401, detail="Operator session expired — sign in again.")


# ── Schemas ──────────────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    # Policy (enforced precisely by auth_service): >= 12 chars, upper+lower+digit,
    # no whitespace/controls. The low min_length here only produces the right
    # 422 shape; the service returns the human-readable violations.
    password: str = Field(min_length=1, max_length=128)
    full_name: str = Field(min_length=1, max_length=120)
    role: Literal["citizen", "authority"] = "citizen"
    invite_code: str | None = None


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class SupabaseLoginRequest(BaseModel):
    """Access token minted by Supabase Auth (Google OAuth) on the client."""

    access_token: str = Field(min_length=20, max_length=4096)


class ElevateRequest(BaseModel):
    """Invite-code elevation for Google-signed-in accounts."""

    invite_code: str = Field(min_length=4, max_length=64)


class OperatorSessionRequest(BaseModel):
    """Operator-console password (value lives only in the server's .env)."""

    password: str = Field(min_length=1, max_length=128)


class OperatorCodeCreate(BaseModel):
    """A custom operator-chosen invite code."""

    code: str = Field(min_length=6, max_length=32)
    label: str = Field(default="", max_length=120)


class AdvisoryRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    severity: Literal["info", "warning", "critical"] = "info"
    areas: list[str] = Field(default_factory=list, max_length=20)


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: Literal["citizen", "authority"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MeResponse(BaseModel):
    user: UserOut


class AdvisoryOut(BaseModel):
    id: str
    author_name: str
    title: str
    body: str
    severity: Literal["info", "warning", "critical"]
    areas: list[str]
    created_at: float


class AdvisoryListResponse(BaseModel):
    advisories: list[AdvisoryOut]
    total: int
    limit: int
    offset: int


class OperatorSessionResponse(BaseModel):
    token: str
    expires_in: int
    store: str


class InviteCodeOut(BaseModel):
    code: str
    label: str
    created_by: str
    created_at: str | float | None = None
    used_by: str | None = None
    used_by_email: str | None = None
    used_at: str | float | None = None


class InviteCodeListResponse(BaseModel):
    store: str
    codes: list[InviteCodeOut]


class InviteStatusResponse(BaseModel):
    code: str
    format_ok: bool
    exists: bool
    used: bool
    message: str


def _token_response(user: dict[str, Any]) -> TokenResponse:
    token = create_token(user["id"], user["role"])
    return TokenResponse(access_token=token, user=UserOut(**user))


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("10/minute")
async def register(request: Request, payload: RegisterRequest) -> TokenResponse:
    """Create a citizen or authority account. Authority signup needs an invite code."""
    try:
        user = auth_service.register_user(
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role=payload.role,
            invite_code=payload.invite_code,
        )
    except AuthError as exc:
        raise _auth_error(exc) from exc
    return _token_response(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest) -> TokenResponse:
    try:
        user = auth_service.authenticate_user(payload.email, payload.password)
    except AuthError as exc:
        raise _auth_error(exc) from exc
    return _token_response(user)


@router.post("/supabase", response_model=TokenResponse)
@limiter.limit("10/minute")
async def supabase_login(request: Request, payload: SupabaseLoginRequest) -> TokenResponse:
    """Exchange a Supabase Auth (Google OAuth) access token for a local JWT.

    The token is verified against Supabase itself; the mapped local account is
    created on first sign-in (role=citizen, provider=google) and reused after.
    """
    try:
        identity = await supabase_service.verify_supabase_access_token(payload.access_token)
    except SupabaseAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = auth_service.get_or_create_google_user(
        provider_sub=identity["sub"],
        email=identity["email"] or "",
        full_name=identity["full_name"],
    )
    return _token_response(user)


@router.post("/elevate", response_model=TokenResponse)
@limiter.limit("5/minute")
async def elevate(
    request: Request,
    payload: ElevateRequest,
    user: dict[str, Any] = Depends(require_user),
) -> TokenResponse:
    """Redeem an authority invite code on the signed-in account.

    Exists for Google sign-ins: Google accounts are always created as citizens
    (a compromised Google account must not self-promote), so the only path to
    the authority role is redeeming a single-use operator-issued code.
    """
    try:
        updated = auth_service.elevate_to_authority(user["id"], payload.invite_code)
    except AuthError as exc:
        raise _auth_error(exc) from exc
    return _token_response(updated)


@router.get("/me", response_model=MeResponse)
@limiter.limit("60/minute")
async def me(request: Request, user: dict[str, Any] = Depends(require_user)) -> MeResponse:
    return MeResponse(user=UserOut(**user))


@router.get("/advisories", response_model=AdvisoryListResponse)
@limiter.limit("60/minute")
async def advisories(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> AdvisoryListResponse:
    """Public: everyone (including anonymous visitors) reads official advisories."""
    page, total = auth_service.list_advisories(limit=limit, offset=offset)
    return AdvisoryListResponse(advisories=page, total=total, limit=limit, offset=offset)


@router.post("/advisories", response_model=AdvisoryOut, status_code=201)
@limiter.limit("20/minute")
async def publish(
    request: Request,
    payload: AdvisoryRequest,
    authority: dict[str, Any] = Depends(require_authority),
) -> AdvisoryOut:
    """Authority-only: publish an official public advisory."""
    record = auth_service.publish_advisory(
        author=authority,
        title=payload.title,
        body=payload.body,
        severity=payload.severity,
        areas=payload.areas,
    )
    return AdvisoryOut(**record)


@router.delete("/advisories/{advisory_id}", status_code=204)
@limiter.limit("20/minute")
async def retract(
    request: Request,
    advisory_id: str,
    authority: dict[str, Any] = Depends(require_authority),
) -> Response:
    deleted = auth_service.delete_advisory(authority, advisory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Advisory not found (or not yours).")
    return Response(status_code=204)


# ── Operator console: invite-code management (password-gated) ────────────────


def _invite_out(row: dict[str, Any]) -> InviteCodeOut:
    return InviteCodeOut(
        code=row.get("code", ""),
        label=row.get("label") or "",
        created_by=row.get("created_by") or "operator",
        created_at=row.get("created_at"),
        used_by=row.get("used_by"),
        used_by_email=row.get("used_by_email"),
        used_at=row.get("used_at"),
    )


@router.post("/operator/session", response_model=OperatorSessionResponse)
@limiter.limit("5/minute")
async def operator_session(request: Request, payload: OperatorSessionRequest) -> OperatorSessionResponse:
    """Exchange the operator password for a 30-minute operator JWT.

    The password is compared with hmac.compare_digest (timing-attack safe) and
    lives only in the server's .env — it is never stored in any database.
    """
    expected = get_settings().operator_password
    if not expected:
        raise HTTPException(status_code=503, detail="Operator console is disabled (no OPERATOR_PASSWORD configured).")
    import hmac as _hmac

    if not _hmac.compare_digest(payload.password.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Incorrect operator password.")
    return OperatorSessionResponse(
        token=jwt_utils.create_operator_token(),
        expires_in=jwt_utils.OPERATOR_TOKEN_SECONDS,
        store=invite_store.active_backend(),
    )


@router.get("/operator/codes", response_model=InviteCodeListResponse)
@limiter.limit("60/minute")
async def operator_list_codes(
    request: Request,
    _op: None = Depends(require_operator),
) -> InviteCodeListResponse:
    """All invite codes with their used/unused status (operator only)."""
    return InviteCodeListResponse(
        store=invite_store.active_backend(),
        codes=[_invite_out(r) for r in invite_store.list_codes()],
    )


@router.post("/operator/codes", response_model=InviteCodeOut, status_code=201)
@limiter.limit("20/minute")
async def operator_create_code(
    request: Request,
    payload: OperatorCodeCreate,
    _op: None = Depends(require_operator),
) -> InviteCodeOut:
    """Create an operator-chosen code. Rejects duplicates against the live database."""
    try:
        row = invite_store.create_custom_code(payload.code, payload.label)
    except InviteStoreError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return InviteCodeOut(
        code=row["code"], label=row["label"], created_by="operator",
        created_at=invite_store.get_status(row["code"]).get("created_at"),
    )


@router.post("/operator/codes/generate", response_model=InviteCodeOut, status_code=201)
@limiter.limit("20/minute")
async def operator_generate_code(
    request: Request,
    label: str = Query("", max_length=120),
    _op: None = Depends(require_operator),
) -> InviteCodeOut:
    """Mint a cryptographically random code (the recommended path)."""
    row = invite_store.generate_code(label)
    return InviteCodeOut(code=row["code"], label=row["label"], created_by="operator")


@router.get("/operator/codes/status", response_model=InviteStatusResponse)
@limiter.limit("60/minute")
async def operator_code_status(
    request: Request,
    code: str = Query(min_length=6, max_length=32),
    _op: None = Depends(require_operator),
) -> InviteStatusResponse:
    """Real-time duplicate check for the create form (operator token required —
    deliberately not public, so it can't be used to probe codes)."""
    norm = invite_store.normalize(code)
    problem = invite_store.validate_format(norm)
    if problem:
        return InviteStatusResponse(code=norm, format_ok=False, exists=False, used=False, message=problem)
    status = invite_store.get_status(norm)
    if not status["exists"]:
        return InviteStatusResponse(code=norm, format_ok=True, exists=False, used=False, message="Available — not in the database.")
    if status["used"]:
        return InviteStatusResponse(code=norm, format_ok=True, exists=True, used=True, message="Already defined AND used.")
    return InviteStatusResponse(code=norm, format_ok=True, exists=True, used=False, message="Already defined and still unused.")


@router.delete("/operator/codes/{code}", status_code=204)
@limiter.limit("20/minute")
async def operator_revoke_code(
    request: Request,
    code: str,
    _op: None = Depends(require_operator),
) -> Response:
    """Delete an UNUSED code. Used codes are history and cannot be revoked."""
    if not invite_store.revoke(invite_store.normalize(code)):
        status = invite_store.get_status(invite_store.normalize(code))
        if not status["exists"]:
            raise HTTPException(status_code=404, detail="Code not found.")
        raise HTTPException(status_code=409, detail="Code was already used — used codes cannot be revoked.")
    return Response(status_code=204)


# ── Supabase archive sync (status is public, triggering is authority-only) ───


@router.get("/sync/status")
@limiter.limit("60/minute")
async def sync_status(request: Request) -> dict[str, Any]:
    """Whether the periodic Supabase archive is configured and its last cycle."""
    return sync_service.sync_status()


@router.post("/sync/cycles", status_code=202)
@limiter.limit("5/minute")
async def create_sync_cycle(
    request: Request,
    authority: dict[str, Any] = Depends(require_authority),
) -> dict[str, Any]:
    """Authority-only: request one archive cycle now (runs before returning).

    202 Accepted-style semantics: the cycle is triggered, its result is
    reported for convenience, and the periodic schedule continues unchanged.
    """
    result = await sync_service.run_sync_once()
    return {**result, "requested_by": authority["full_name"]}
