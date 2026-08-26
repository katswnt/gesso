-- erase-account-serialize.sql — PR 4 Part 4B (erase-side write/erase serialization primitive)
-- ============================================================================
-- FORWARD MIGRATION — APPLY ONCE, after db/erase-account.sql. Non-destructive: CREATE OR REPLACEs erase_account
-- to LOCK the account's device rows (FOR UPDATE) BEFORE deleting child rows. This establishes the DB-level
-- serialization primitive for account erasure: a writer that takes a device-row lock either commits BEFORE this
-- lock — and is swept by the deletes below — or blocks until the device is deleted and then observes it gone.
-- Lock order stays auth.users -> devices -> children (auth.users lock matches claim_device), so no new deadlock
-- class. FOR UPDATE cannot be combined with array_agg, so the rows are locked via PERFORM, then collected.
--
-- SCOPE (SEC-4 PARTIAL): 4B ships ONLY the erase side of the invariant. The capability-gated writers
-- (saves/scores/profiles) still write via raw PostgREST inserts and do NOT yet take the device-row lock, so an
-- unguarded write can still race the sweep. Closing that end-to-end requires routing every capability write
-- through a device-row-locking SECURITY DEFINER function under enforce — deferred to the guarded-writes
-- follow-up. Until then the client deletion-lease is an ADVISORY (best-effort) mitigation, not a guarantee.
-- ============================================================================

begin;

create or replace function public.erase_account()
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

  -- SERIALIZATION PRIMITIVE: lock this account's device rows BEFORE the child-table sweep. FOR UPDATE cannot be
  -- combined with array_agg, so lock the rows via PERFORM, then collect the (now-locked) ids.
  perform device_id from public.devices where user_id = v_uid for update;
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

commit;
