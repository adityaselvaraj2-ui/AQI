# Supabase Setup — Google Sign-in + Periodic Data Archive

Copy-paste these commands in order. Your project: `ulqzxbjkgiattzzrodqf.supabase.co`.

---

## 1. Create the tables (Supabase Dashboard → SQL Editor → paste → Run)

```sql
-- ── A. User profiles (mirrors Google / password accounts) ──────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique,
  full_name     text,
  role          text not null default 'citizen' check (role in ('citizen','authority')),
  created_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_self"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up (Google included)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── B. Live AQI archive (the backend sync writes here) ─────────────────────
create table if not exists public.aqi_snapshots (
  station_uid        text not null,
  station_name       text,
  observed_at        timestamptz not null,
  aqi                integer,
  category           text,
  dominant_pollutant text,
  pm25               real,
  pm10               real,
  no2                real,
  o3                 real,
  so2                real,
  co                 real,
  temperature_c      real,
  humidity_pct       real,
  wind_speed_kmh     real,
  wind_direction_deg real,
  lat                real,
  lon                real,
  primary key (station_uid, observed_at)
);

create table if not exists public.city_overview (
  observed_at   timestamptz primary key,
  aqi           integer,
  category      text,
  pm25          real,
  pm10          real,
  no2           real,
  o3            real,
  so2           real,
  co            real,
  station_count integer
);

-- Time-series helpers: the archive grows forever, so give queries a hand.
create index if not exists aqi_snapshots_time_idx
  on public.aqi_snapshots (observed_at desc);
create index if not exists aqi_snapshots_station_time_idx
  on public.aqi_snapshots (station_uid, observed_at desc);

-- Retention: keep 2 years of snapshots, prune older nightly at 03:00 UTC.
select cron.schedule(
  'prune-aqi-snapshots', '0 3 * * *',
  $$delete from public.aqi_snapshots where observed_at < now() - interval '2 years'$$
);

-- Public read for dashboards; writes happen ONLY with the service-role key
-- (no insert/update policies for anon/authenticated on purpose).
alter table public.aqi_snapshots enable row level security;
alter table public.city_overview  enable row level security;
create policy "snapshots_public_read" on public.aqi_snapshots for select using (true);
create policy "overview_public_read"  on public.city_overview  for select using (true);
```

## 2. Get the keys (Dashboard → Project Settings → API)

| Key | Where it goes |
|---|---|
| **Project URL** | already set in `.env` (`SUPABASE_URL`, `VITE_SUPABASE_URL`) |
| **anon / publishable** | already set in `.env` (`SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`) |
| **service_role** (secret) | `.env` → `SUPABASE_SERVICE_ROLE_KEY=eyJ...` ← **paste this one** |

Then restart the backend. The archive sync starts automatically and writes
every `SUPABASE_SYNC_INTERVAL_MINUTES` (default 15). Verify:

```bash
curl http://127.0.0.1:8000/api/v1/auth/sync/status
# {"enabled":true,"interval_minutes":15.0,"last":{...}}
```

Force one cycle immediately (needs an authority account):

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/sync/cycles \
  -H "Authorization: Bearer <authority-JWT>"
```

Or from the SQL editor: `select * from aqi_snapshots order by observed_at desc limit 10;`

## 3. Enable Google sign-in (Dashboard → Authentication → Providers)

1. **Authentication → Providers → Google** → enable.
2. It asks for a **Google OAuth Client ID + Secret**:
   - Go to https://console.cloud.google.com/apis/credentials
   - Create Credentials → OAuth client ID → **Web application**
   - Authorized JavaScript origins: `http://localhost:8000`
   - Authorized redirect URIs: `https://ozaxpjkmubtnotwiltfc.supabase.co/auth/v1/callback`
   - Copy the Client ID / Secret into the Supabase provider form → Save.

## 4. Test the flow

Open the console → **Sign in** → **Continue with Google**.
On return, the backend logs you in as a **citizen** (Google accounts are never
auto-promoted; authority still requires the invite code).

---

## What happens automatically once the service key is set

| Cycle | Table | Rows |
|---|---|---|
| every 15 min | `aqi_snapshots` | all ~50 live stations (AQI + 6 pollutants + weather) |
| every 15 min | `city_overview` | city aggregate |

That is **~4,800 station rows/day** building the historical dataset the ML
retraining pipeline needs — collected silently in the background.
