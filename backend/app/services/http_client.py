"""Shared process-wide httpx.AsyncClient.

Previously every outbound call constructed `async with httpx.AsyncClient(...)`
32 call sites, each paying ~0.2-0.3 s to build and load a fresh SSL context
(cProfile: create_ssl_context -> load_verify_locations ~= 0.24 s per client,
measured 2026-09-25). On hot endpoints that dominated warm latency.

A single module-level client is created at startup and closed at shutdown
(wired in `main.lifespan`). Call sites keep their per-request timeout through
`shared_client_context(timeout=...)`, which yields a thin proxy that applies
the timeout to each request made inside the `async with` block, exactly like
a per-request client did. The proxy also supports `async with` itself, so
nested usage inside call sites keeps working unchanged.
"""
from __future__ import annotations

import contextlib
from typing import Any, Optional

import httpx

_client: Optional[httpx.AsyncClient] = None


def get_shared_client() -> httpx.AsyncClient:
    """Return the process-wide client, lazily creating it if needed.

    Laziness keeps import-order tests working; the lifespan hook normally
    creates it before the first request and closes it at shutdown.
    """
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
            follow_redirects=False,
        )
    return _client


async def aclose_shared_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


class _TimeoutProxy:
    """Forwards requests to the shared client while applying a per-block timeout."""

    __slots__ = ("_client", "_timeout", "_follow_redirects")

    def __init__(self, client: httpx.AsyncClient, timeout: Any, follow_redirects: bool = False) -> None:
        object.__setattr__(self, "_client", client)
        object.__setattr__(self, "_timeout", timeout)
        object.__setattr__(self, "_follow_redirects", follow_redirects)

    # Request methods used across the codebase -------------------------------
    # `_follow_redirects` mirrors httpx.AsyncClient(follow_redirects=False) default;
    # blocks that asked for redirects get them, without touching other users of
    # the shared client.
    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        kwargs.setdefault("follow_redirects", self._follow_redirects)
        return await self._client.get(url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        kwargs.setdefault("follow_redirects", self._follow_redirects)
        return await self._client.post(url, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        return await self._client.put(url, **kwargs)

    async def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        return await self._client.patch(url, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        return await self._client.delete(url, **kwargs)

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        return await self._client.request(method, url, **kwargs)

    async def stream(self, method: str, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", self._timeout)
        return self._client.stream(method, url, **kwargs)

    async def send(self, request: httpx.Request, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("timeout", self._timeout)
        return await self._client.send(request, **kwargs)

    # Attributes that call sites may touch -----------------------------------
    @property
    def base_url(self) -> httpx.URL:
        return self._client.base_url

    @property
    def timeout(self) -> Any:
        return self._timeout

    @property
    def headers(self) -> httpx.Headers:
        return self._client.headers

    @property
    def is_closed(self) -> bool:
        return self._client.is_closed

    # Nested `async with` support --------------------------------------------
    async def __aenter__(self) -> "_TimeoutProxy":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    # Pass-through for anything exotic ---------------------------------------
    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


@contextlib.asynccontextmanager
async def shared_client_context(timeout: Any = 12.0, **_ignored: Any) -> Any:
    """Drop-in replacement for `async with httpx.AsyncClient(timeout=T, ...) as client:`.

    Yields a proxy bound to the shared client that applies `T` to every request
    issued inside the block. Constructor-only options that are meaningless on a
    shared client (`follow_redirects`, `verify`, ...) are accepted and honoured
    where safe: `follow_redirects=True` switches the proxy into redirect-
    following mode for the block, matching the per-request client's default.
    No connection churn, no SSL-context rebuild.
    """
    follow = bool(_ignored.get("follow_redirects", False))
    yield _TimeoutProxy(get_shared_client(), timeout, follow)
