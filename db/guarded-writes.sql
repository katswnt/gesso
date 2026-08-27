-- guarded-writes.sql — PR guarded writes, Stage A (SEC-4 write/erase serialization; ADDITIVE)
-- ============================================================================
-- FORWARD MIGRATION — APPLY ONCE. Purely ADDITIVE: creates six narrow SECURITY DEFINER write functions and
-- nothing else. It does NOT alter claim_device or erase_account, so applying it is behavior-neutral until the
-- API handlers are switched over in Stage B. Every function serializes against erase_account by taking the
-- SAME lock the erasure holds, in the SAME order (auth.users -> devices -> children), so a guarded write either
-- commits before erasure's sweep (and is deleted by it) or blocks and then rejects after the device/tombstone
-- disappears.
--
-- Lock discipline:
--   * device-scoped (save/unsave/score/profile): lock ONLY the calling devices row FOR UPDATE, then non-locking
--     tombstone + owner-existence reads. Never acquire auth.users after devices -> no reverse-order deadlock.
--   * account-scoped (user_state): lock auth.users[auth.uid()] FOR UPDATE first (matches erasure/claim order).
--   * guarded_claim_device: thin wrapper over the unchanged claim_device (its auth.users+devices locks are held
--     for the whole outer transaction), adding only the profiles.user_id projection on a successful bind.
--
-- Contract: every function returns structured jsonb — {"ok":true, ...} on success, {"ok":false,"error":<code>}
-- on rejection. Authority is the devices row + capability hash (device-scoped) or auth.uid()+auth.users
-- (account-scoped); profiles.user_id is NEVER read for authority and NEVER overwritten except by the claim
-- projection. Grants: save/unsave/score/profile -> service_role; user_state/claim -> authenticated.
-- ============================================================================

begin;

-- ---- guarded_save: insert one saves row for the calling device (device-scoped) ------------------------------
create function public.guarded_save(p_device_id text, p_capability_hash text, p_work_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.devices%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_device'); end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if p_work_id is null or length(p_work_id) = 0 or length(p_work_id) > 200 then return jsonb_build_object('ok', false, 'error', 'bad_work'); end if;
  select * into v from public.devices where device_id = p_device_id for update;           -- authoritative lock
  if not found then return jsonb_build_object('ok', false, 'error', 'unregistered'); end if;
  if v.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if v.capability_hash <> p_capability_hash then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if v.user_id is not null then                                                            -- non-locking owner checks
    if exists (select 1 from public.account_tombstones where user_id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'erased'); end if;
    if not exists (select 1 from auth.users where id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
  end if;
  if (select count(*) from public.saves where device_id = p_device_id) >= 1000 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  if not exists (select 1 from public.saves where device_id = p_device_id and work_id = p_work_id) then          -- idempotent under the device lock
    insert into public.saves (device_id, work_id) values (p_device_id, p_work_id);
  end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.guarded_save(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.guarded_save(text, text, text) to service_role;

-- ---- guarded_unsave: remove a work across the account's devices (single calling-device lock) ---------------
create function public.guarded_unsave(p_device_id text, p_capability_hash text, p_work_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.devices%rowtype; n int;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_device'); end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if p_work_id is null or length(p_work_id) = 0 or length(p_work_id) > 200 then return jsonb_build_object('ok', false, 'error', 'bad_work'); end if;
  select * into v from public.devices where device_id = p_device_id for update;           -- lock ONLY the caller
  if not found then return jsonb_build_object('ok', false, 'error', 'unregistered'); end if;
  if v.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if v.capability_hash <> p_capability_hash then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if v.user_id is not null then
    if exists (select 1 from public.account_tombstones where user_id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'erased'); end if;
    if not exists (select 1 from auth.users where id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
    -- account-wide scope: delete across all this account's devices (resolved from authoritative devices.user_id,
    -- not locked — an unsave is a delete and cannot orphan; concurrent erasure delete-vs-delete is harmless).
    delete from public.saves where work_id = p_work_id and device_id in (select device_id from public.devices where user_id = v.user_id);
  else
    delete from public.saves where work_id = p_work_id and device_id = p_device_id;       -- anonymous device: itself only
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end; $$;
revoke all on function public.guarded_unsave(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.guarded_unsave(text, text, text) to service_role;

-- ---- guarded_score: best-score decided UNDER the device lock + name/color projection ------------------------
create function public.guarded_score(p_device_id text, p_capability_hash text, p_date date, p_tier text,
  p_total int, p_perfects int, p_masterpieces int, p_rounds jsonb, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.devices%rowtype; v_stored int; v_best boolean;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_device'); end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if p_total is null or p_total < 0 then return jsonb_build_object('ok', false, 'error', 'bad_total'); end if;
  select * into v from public.devices where device_id = p_device_id for update;           -- serializes score writes for this device
  if not found then return jsonb_build_object('ok', false, 'error', 'unregistered'); end if;
  if v.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if v.capability_hash <> p_capability_hash then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if v.user_id is not null then
    if exists (select 1 from public.account_tombstones where user_id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'erased'); end if;
    if not exists (select 1 from auth.users where id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
  end if;
  select total into v_stored from public.scores where device_id = p_device_id and date = p_date and tier = p_tier;  -- read under the device lock
  v_best := (v_stored is null) or (p_total > v_stored);
  if v_best then
    insert into public.scores (device_id, date, tier, total, perfects, masterpieces, cold, rounds, updated_at)
      values (p_device_id, p_date, p_tier, p_total, p_perfects, p_masterpieces, (v_stored is null), p_rounds, pg_catalog.now())
      on conflict (device_id, date, tier) do update set
        total = excluded.total, perfects = excluded.perfects, masterpieces = excluded.masterpieces,
        cold = excluded.cold, rounds = excluded.rounds, updated_at = excluded.updated_at;   -- cold = first-attempt (no prior row)
  end if;
  insert into public.profiles (device_id, name, color) values (p_device_id, p_name, p_color)  -- projection: name/color only
    on conflict (device_id) do update set name = excluded.name, color = excluded.color;       -- preserves profiles.user_id
  return jsonb_build_object('ok', true, 'isBest', v_best, 'storedTotal', case when v_best then p_total else v_stored end);
end; $$;
revoke all on function public.guarded_score(text, text, date, text, int, int, int, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.guarded_score(text, text, date, text, int, int, int, jsonb, text, text) to service_role;

-- ---- guarded_profile: name/color projection only (device-scoped) -------------------------------------------
create function public.guarded_profile(p_device_id text, p_capability_hash text, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.devices%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_device'); end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  select * into v from public.devices where device_id = p_device_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unregistered'); end if;
  if v.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if v.capability_hash <> p_capability_hash then return jsonb_build_object('ok', false, 'error', 'bad_capability'); end if;
  if v.user_id is not null then
    if exists (select 1 from public.account_tombstones where user_id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'erased'); end if;
    if not exists (select 1 from auth.users where id = v.user_id) then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
  end if;
  insert into public.profiles (device_id, name, color) values (p_device_id, p_name, p_color)
    on conflict (device_id) do update set name = excluded.name, color = excluded.color;       -- preserves profiles.user_id
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.guarded_profile(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.guarded_profile(text, text, text, text) to service_role;

-- ---- guarded_user_state: account-scoped, auth.users lock first (same order as erasure) ---------------------
create function public.guarded_user_state(p_streak jsonb, p_mastery jsonb, p_glossary jsonb, p_seen jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_auth uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select id into v_auth from auth.users where id = v_uid for update;                       -- same first lock as erase_account
  if v_auth is null then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
  if exists (select 1 from public.account_tombstones where user_id = v_uid) then return jsonb_build_object('ok', false, 'error', 'erased'); end if;
  insert into public.user_state (user_id, streak, mastery, glossary, seen, updated_at)
    values (v_uid, p_streak, p_mastery, p_glossary, p_seen, pg_catalog.now())
    on conflict (user_id) do update set
      streak = excluded.streak, mastery = excluded.mastery, glossary = excluded.glossary,
      seen = excluded.seen, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.guarded_user_state(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.guarded_user_state(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ---- guarded_claim_device: wrapper over the UNCHANGED claim_device + profiles.user_id projection -----------
-- Preserves the COMPLETE claim outcome set verbatim in `result` (bound / already_bound_same_user /
-- conflict_other_user / unregistered / revoked / bad_capability / bad_device / no_auth / no_user / erased) so
-- the handler keeps its existing HTTP mapping. The inner claim_device holds its auth.users + devices locks for
-- this whole transaction, so the projection upsert runs under them. `ok` = a successful bind only.
create function public.guarded_claim_device(p_device_id text, p_capability_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result text; v_uid uuid := auth.uid();
begin
  v_result := public.claim_device(p_device_id, p_capability_hash);          -- unchanged hardened bind (locks held in this txn)
  if v_result in ('bound', 'already_bound_same_user') then
    insert into public.profiles (device_id, user_id) values (p_device_id, v_uid)
      on conflict (device_id) do update set user_id = excluded.user_id;      -- projection only; preserves name/color
    return jsonb_build_object('ok', true, 'result', v_result);
  end if;
  -- rejection: keep `result` (existing claimResultToHttp mapping) AND provide `error` to match the JSON contract
  return jsonb_build_object('ok', false, 'result', v_result, 'error', v_result);
end; $$;
revoke all on function public.guarded_claim_device(text, text) from public, anon, authenticated, service_role;
grant execute on function public.guarded_claim_device(text, text) to authenticated;

commit;
