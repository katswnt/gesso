-- devices.sql — PR 3 (device-ownership authorization), Part 3A
-- ============================================================================
-- MIGRATION — APPLY ONCE to production; this is NOT a snapshot.
-- Tracked DELTA on top of db/production-schema-baseline.sql (a dated PRE-migration snapshot).
--
-- Adds the device-ownership relation + capability register/claim functions. A per-device
-- capability is 32 random bytes minted client-side; only its lowercase-hex SHA-256 is stored.
-- The capability proves device possession; ownership (devices.user_id) is the SOLE authorization
-- source (profiles.user_id authorizes nothing).
--
-- SECURITY NOTES
--  * A new public table INHERITS `GRANT ALL ... TO anon/authenticated` from the schema's default
--    privileges (see baseline), and the `ensure_rls` event trigger only RAISE LOGs on failure — so
--    this migration EXPLICITLY enables RLS and REVOKEs ALL from public/anon/authenticated.
--  * register_device is SERVICE-ROLE-ONLY (pre-auth first contact; no user binding).
--  * claim_device is called under the USER's JWT so auth.uid() is the authenticated subject — a
--    caller-supplied user id is NEVER trusted.
--  * Both functions are SECURITY DEFINER with search_path='' and schema-qualify every identifier;
--    their default PUBLIC execute is revoked in the same transaction that creates them.
--  * Revocation/rotation recovery is deferred to PR 4; the reject-on-revoked checks are present now
--    for forward-safety (revoked_at is never set in 3A).
-- ============================================================================

begin;

create table public.devices (
  device_id       text primary key check (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),      -- matches API/client shape
  capability_hash text not null unique check (capability_hash ~ '^[0-9a-f]{64}$'),   -- sha256 hex; one cap ⇒ one device
  user_id         uuid,                                                              -- nullable; FK to auth.users deferred to PR 4
  created_at      timestamptz not null default pg_catalog.now(),
  claimed_at      timestamptz,
  revoked_at      timestamptz
);

alter table public.devices enable row level security;                     -- explicit; never rely on ensure_rls
revoke all on table public.devices from public, anon, authenticated;      -- undo inherited default GRANT ALL
grant all on table public.devices to service_role;                        -- service-role-only (RLS-bypassing server key)

-- ---- register_device: service-only first-contact hash store (no user binding; the app hashes the
--      client-minted capability and passes the digest — this function stores it, it does not mint) ----
create function public.register_device(p_device_id text, p_capability_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v public.devices%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return 'bad_device'; end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return 'bad_capability'; end if;

  select * into v from public.devices where device_id = p_device_id;
  if found then
    if v.revoked_at is not null then return 'revoked'; end if;
    if v.capability_hash = p_capability_hash then return 'ok'; end if;   -- idempotent same-device re-register
    return 'bad_capability';                                            -- different hash for existing device
  end if;

  begin
    insert into public.devices (device_id, capability_hash) values (p_device_id, p_capability_hash);
    return 'ok';
  exception when unique_violation then                                   -- concurrent insert or hash reused
    select * into v from public.devices where device_id = p_device_id;
    if found then
      if v.revoked_at is not null then return 'revoked'; end if;
      if v.capability_hash = p_capability_hash then return 'ok'; end if;
      return 'bad_capability';
    end if;
    return 'hash_in_use';                                               -- capability_hash collided with another device
  end;
end;
$$;

revoke all on function public.register_device(text, text) from public, anon, authenticated;
grant execute on function public.register_device(text, text) to service_role;

-- ---- claim_device: authenticated bind; identity derived from auth.uid() -----------------------
create function public.claim_device(p_device_id text, p_capability_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v public.devices%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then return 'no_auth'; end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' then return 'bad_device'; end if;
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then return 'bad_capability'; end if;

  select * into v from public.devices where device_id = p_device_id for update;
  if not found then return 'unregistered'; end if;                       -- must register (service path) first
  if v.revoked_at is not null then return 'revoked'; end if;
  if v.capability_hash <> p_capability_hash then return 'bad_capability'; end if;

  if v.user_id is null then
    update public.devices set user_id = v_uid, claimed_at = pg_catalog.now() where device_id = p_device_id;
    return 'bound';
  elsif v.user_id = v_uid then
    return 'already_bound_same_user';                                    -- idempotent retry
  else
    return 'conflict_other_user';                                        -- never rebind across users
  end if;
end;
$$;

-- NB: schema default privileges GRANT new functions to service_role too, so revoke it explicitly —
-- claim_device is authenticated-only (service-role callers have no auth.uid() and must never bind).
revoke all on function public.claim_device(text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_device(text, text) to authenticated;

commit;
