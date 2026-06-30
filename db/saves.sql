-- "My Gallery" saves — run once in the Supabase SQL editor.
-- A saved item is just (device_id, work_id). Server writes use the SECRET key (bypasses RLS).
create table if not exists public.saves (
  device_id  text        not null,
  work_id    text        not null,
  created_at timestamptz not null default now(),
  primary key (device_id, work_id)
);
create index if not exists saves_device_idx on public.saves (device_id, created_at desc);

-- RLS on, no public policies: only the server SECRET key (service role) can read/write. Matches scores/profiles.
alter table public.saves enable row level security;
