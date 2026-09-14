-- ═════════════════════════════════════════════════════════════════════════════
-- AUTHORITY INVITE CODES — your idea, as SQL (run ONCE)
-- Where: Supabase Dashboard → SQL Editor → New query → paste this whole file → Run
--
-- THE IDEA THIS IMPLEMENTS
-- ------------------------
-- * A separate Supabase table holding every invite key.
-- * Each key is marked UNUSED when the operator (you) creates it, and flipped
--   to USED — with who used it and when — in the database itself when an
--   authority redeems it.
-- * You manage keys from the website's key-icon tab, behind a password only
--   you know (OPERATOR_PASSWORD in the backend .env). That tab shows the
--   real-time used/unused state and warns live if a code you type already
--   exists.
--
-- SECURITY MODEL (why this is safe)
-- ---------------------------------
-- * RLS is ENABLED with ZERO policies, and every grant to the browser roles
--   (anon / authenticated) is REVOKED. Someone holding the public anon key
--   (it ships in the JS bundle) can neither read nor write a single code —
--   every query returns empty/error. Verifiable: try reading the table with
--   the anon key after running this; it fails.
-- * The ONLY writer is your backend's SERVICE_ROLE key, which lives in the
--   server-side .env and never reaches the browser. The browser talks to the
--   backend; the backend talks to Supabase. The operator password itself is
--   never stored in any database — it is compared server-side only.
-- * Redemption is ATOMIC without a stored function: the backend issues ONE
--   UPDATE restricted to rows where used_by IS NULL. Postgres evaluates the
--   filter and the write as a single statement, so two authorities racing on
--   the same code cannot both win — exactly one gets the row back.
-- * Format is enforced at the DATABASE level too (CHECK constraint): even a
--   bug or a manual dashboard edit cannot insert a malformed code.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────────────
create table if not exists public.authority_invite_codes (
    code          text primary key,
    label         text not null default '',
    created_by    text not null default 'operator',
    created_at    timestamptz not null default now(),
    used_by       text,            -- local account id that consumed the code
    used_by_email text,            -- convenience copy for the operator console
    used_at       timestamptz,

    -- Format guard: NCR72- followed by 6–20 uppercase letters/digits.
    -- Mirrors the backend regex, so even out-of-band writes stay valid.
    constraint invite_code_format check (code ~ '^NCR72-[A-Z0-9]{6,20}$'),

    -- Consistency guard: a USED code must say who and when; an UNUSED code
    -- must not carry stale usage fields.
    constraint invite_code_usage_consistent check (
        (used_by is null) = (used_at is null)
    )
);

comment on table public.authority_invite_codes is
  'Single-use authority invite codes. Written only by the backend service-role key.';

comment on constraint invite_code_format on public.authority_invite_codes is
  'Codes look like NCR72-XXXXXXXX: uppercase letters and digits after the dash.';

-- Helpful for the operator console's listing (newest first) and the
-- redemption lookup (by code + unused).
create index if not exists invite_codes_created_at_idx
    on public.authority_invite_codes (created_at desc);

-- ── 2. Lock it down ──────────────────────────────────────────────────────────
alter table public.authority_invite_codes enable row level security;

-- Zero policies = deny by default for anon AND authenticated. The explicit
-- revokes below also strip the default table grants, so even direct
-- PostgREST calls with the anon key fail at the privilege level.
revoke all on public.authority_invite_codes from anon;
revoke all on public.authority_invite_codes from authenticated;

-- ── 3. (Optional) seed a first code by hand ──────────────────────────────────
-- You normally create codes from the website's key-icon console, but if you
-- want one ready immediately, uncomment and edit:
--
-- insert into public.authority_invite_codes (code, label, created_by)
-- values ('NCR72-MYFIRST1', 'hand-seeded example', 'operator')
-- on conflict (code) do nothing;

-- Done. After running this, the operator console on the website reports
-- "Supabase (live database)" instead of "Local SQLite" — that is your
-- confirmation the switch happened. Codes created earlier while on SQLite do
-- NOT migrate automatically; recreate the ones you still need from the
-- console (takes seconds) or keep using SQLite by simply not running this.
