# Authority access — invite codes & demo accounts

**Share only with trusted teammates.** Every invite code is single-use. This
file exists so the team can find working credentials without asking the
operator each time; rotate codes by generating new ones and updating this file.

## Operator console (the easy way — built into the website)

Click the **key icon** in the header (top right, next to the bell) → enter the
operator password (`OPERATOR_PASSWORD` in `.env`; current value is known to the
operator only) → you get a 30-minute session where you can:

- **Create** a code of your own choosing — the format is taught inline and the
  database is checked **in real time as you type** (duplicates rejected).
- **Generate** a cryptographically random code (recommended).
- **Revoke** any unused code; **see** every code with USED/UNUSED + who used it.

Codes live in **Supabase** (`authority_invite_codes` table, RLS-locked,
service-role-only) once `supabase/invite_codes.sql` has been run in the
Supabase SQL editor; until then they live in local SQLite — the console header
shows which store is active.

## How authority access works

There are **two ways** to become an authority account:

1. **Register form (email + password):** Register tab → pick **Authority** →
   enter your single-use invite code → create the account. Done.
2. **Google sign-in:** Register tab → pick **Authority** → enter the invite
   code → click **Continue with Google**. After Google verifies you, the code
   is redeemed automatically and your account is created as authority.

Citizens never need a code. Authority access **always** requires a valid,
unused, operator-issued code — that is the whole security model.

## Unused invite codes (single-use!)

| Code | Label | Status |
|---|---|---|
| `NCR72-122F0BF5` | Team handout — see AUTHORITY_ACCESS.md | **UNUSED** |
| `NCR72-3CE9F9F9` | Team handout spare — see AUTHORITY_ACCESS.md | **UNUSED** |

## Demo accounts (ready to sign in)

| Account | Email | Password | Role |
|---|---|---|---|
| UI Test User | `uitest1@example.com` | `TestPass123` | citizen |
| Demo Authority Officer | `authority.demo@example.com` | `AuthPass123` | authority |
| Elevate UI Test | `elev.ui@x.com` | `StrongPass123` | authority (elevated via UI test) |
| T Five B | `t5b@x.com` | `StrongPass123` | authority (elevated via API test) |

The first two use the older 8-character policy and are grandfathered; all
**new** registrations require 12+ chars with upper + lower + digit.

## Operator commands (terminal alternative to the website console)

```bash
# Generate a new single-use code
.venv/Scripts/python.exe scripts/create_invite_code.py "label"

# List all codes and which are used
.venv/Scripts/python.exe -c "import sqlite3;c=sqlite3.connect('backend/app/data/users.db');[print(r) for r in c.execute('SELECT code,label,used_by FROM authority_invite_codes')]"

# Revoke a leaked code (before it is used)
.venv/Scripts/python.exe -c "import sqlite3;c=sqlite3.connect('backend/app/data/users.db');c.execute(\"DELETE FROM authority_invite_codes WHERE code='THE-CODE'\");c.commit()"
```
