"""Shared slowapi rate limiter.

One process-wide Limiter instance, created here so any router module can apply
`@limiter.limit(...)` without importing api/v1/endpoints.py (which imports the
routers — a cycle). main.py attaches this instance to app.state; endpoints.py
re-exports it for backward compatibility with its existing importers.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
