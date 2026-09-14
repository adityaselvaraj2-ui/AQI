"""Create an authority invite code in the Supabase store.

Usage:
    python scripts/create_invite_code.py "CPCB officer batch"
    python scripts/create_invite_code.py            # unlabelled code

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env and the
authority_invite_codes table to exist (run supabase/invite_codes.sql once).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services import invite_store  # noqa: E402


def main() -> None:
    label = sys.argv[1] if len(sys.argv) > 1 else ""
    result = invite_store.generate_code(label)
    print(f"Authority invite code: {result['code']}")
    print("Single-use. Share only through a trusted channel.")


if __name__ == "__main__":
    main()
