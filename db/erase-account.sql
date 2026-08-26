-- erase-account.sql — PR 4 Part 4A (account erasure of authoritatively-registered device data)
-- ============================================================================
-- MIGRATION — APPLY ONCE to production; FORWARD-COMPATIBLE / NON-DESTRUCTIVE (it also CREATE OR REPLACEs
-- claim_device). Tracked delta on db/devices.sql. Do NOT run against production without the separate
-- approval + preflight (erase_account/finalize_erasure/purge_stale_tombstones/account_tombstones absent;
-- claim_device present; Storage-object inventory).
--
-- Erases the account's auth.users row (done by the API afterwards) + all public data for its
-- AUTHORITATIVELY-registered devices (devices.user_id = auth.uid()) + user_state. Authority is NEVER a
-- caller-supplied deviceId and NEVER profiles.user_id. Legacy profile-only devices (profiles.user_id set,
-- no devices row) are deliberately preserved — see SEC-4 (partial) + the legacy-gap metric.
--
-- Concurrency / stale-JWT / replay: both claim_device and erase_account lock the auth.users row FOR UPDATE
-- in the SAME order (auth row → tombstone → work), so an in-flight claim serializes behind erasure and a
-- post-deletion JWT replay is rejected (no_user). A transient tombstone additionally blocks binding during
-- the erase→auth-delete window; it is removed by the service-only finalizer after auth deletion (or GC'd by
-- purge_stale_tombstones) so no raw-UUID account marker is retained.
-- ============================================================================

begin;

-- transient erasure marker (NOT retained: finalized after auth deletion; GC'd if finalize is lost)
create table public.account_tombstones (
  user_id   uuid primary key,
  erased_at timestamptz not null default pg_catalog.now()
);
alter table public.account_tombstones enable row level security;
-- schema default privileges GRANT new tables ALL to service_role too — revoke it FIRST, then grant SELECT only
-- (metrics/debug). All mutation is via the SECURITY DEFINER functions, which run as the owner.
revoke all on table public.account_tombstones from public, anon, authenticated, service_role;
grant select on table public.account_tombstones to service_role;

-- ---- claim_device (CREATE OR REPLACE): + auth-row lock, tombstone/no_user guards -----------------------
create or replace function public.claim_device(p_device_id text, p_capability_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v public.devices%rowtype; v_uid uuid := auth.uid(); v_auth uuid;
begin
  if v_uid is null then return 'no_auth'; end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return 'bad_device'; end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return 'bad_capability'; end if;

  -- lock the auth row FIRST (same order as erase_account): serializes claims/erasure and blocks replay
  select id into v_auth from auth.users where id = v_uid for update;
  if v_auth is null then return 'no_user'; end if;                        -- post-deletion JWT replay
  if exists (select 1 from public.account_tombstones where user_id = v_uid) then return 'erased'; end if;

  select * into v from public.devices where device_id = p_device_id for update;
  if not found then return 'unregistered'; end if;
  if v.revoked_at is not null then return 'revoked'; end if;
  if v.capability_hash <> p_capability_hash then return 'bad_capability'; end if;

  if v.user_id is null then
    update public.devices set user_id = v_uid, claimed_at = pg_catalog.now() where device_id = p_device_id;
    return 'bound';
  elsif v.user_id = v_uid then
    return 'already_bound_same_user';
  else
    return 'conflict_other_user';
  end if;
end;
$$;
revoke all on function public.claim_device(text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_device(text, text) to authenticated;

-- ---- erase_account: authenticated, transactional public-data erasure ------------------------------------
create function public.erase_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_auth uuid; v_devs text[];
  c_events int; c_saves int; c_scores int; c_profiles int; c_user_state int; c_devices int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select id into v_auth from auth.users where id = v_uid for update;    -- same lock order as claim_device
  if v_auth is null then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;

  insert into public.account_tombstones (user_id) values (v_uid) on conflict (user_id) do nothing;
  select coalesce(array_agg(device_id), '{}') into v_devs from public.devices where user_id = v_uid;  -- authoritative

  delete from public.events     where device_id = any(v_devs); get diagnostics c_events     = row_count;
  delete from public.saves      where device_id = any(v_devs); get diagnostics c_saves      = row_count;
  delete from public.scores     where device_id = any(v_devs); get diagnostics c_scores     = row_count;
  delete from public.profiles   where device_id = any(v_devs); get diagnostics c_profiles   = row_count;  -- by device, NOT profiles.user_id
  delete from public.user_state where user_id   = v_uid;       get diagnostics c_user_state = row_count;
  delete from public.devices    where user_id   = v_uid;       get diagnostics c_devices    = row_count;

  return jsonb_build_object('ok', true, 'counts', jsonb_build_object(
    'events', c_events, 'saves', c_saves, 'scores', c_scores,
    'profiles', c_profiles, 'user_state', c_user_state, 'devices', c_devices));
exception when others then
  raise log 'erase_account rollback: SQLSTATE %', sqlstate;    -- sanitized: SQLSTATE only, no uid / row data
  return jsonb_build_object('ok', false, 'error', 'erase_failed');   -- EXCEPTION block rolls back all deletes above
end;
$$;
revoke all on function public.erase_account() from public, anon, authenticated, service_role;
grant execute on function public.erase_account() to authenticated;

-- ---- finalize_erasure: service-only; removes the tombstone ONLY after the auth user is truly gone --------
create function public.finalize_erasure(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then return false; end if;
  if exists (select 1 from auth.users where id = p_user_id) then return false; end if;  -- never finalize a live account
  delete from public.account_tombstones where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.finalize_erasure(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_erasure(uuid) to service_role;

-- ---- purge_stale_tombstones: service-only GC for tombstones whose auth.users row is gone -----------------
create function public.purge_stale_tombstones()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  delete from public.account_tombstones t where not exists (select 1 from auth.users u where u.id = t.user_id);
  get diagnostics n = row_count; return n;
end;
$$;
revoke all on function public.purge_stale_tombstones() from public, anon, authenticated, service_role;
grant execute on function public.purge_stale_tombstones() to service_role;

commit;
