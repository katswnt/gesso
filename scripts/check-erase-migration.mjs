#!/usr/bin/env node
// Offline gate for db/erase-account.sql (PR 4, Part 4A). Asserts the migration TEXT encodes the required
// erasure semantics + concurrency guards + privilege posture. NEVER connects to a database or modifies files.
// The live locking / rollback / grants are proven separately by the real-DB erase verification.
//   node scripts/check-erase-migration.mjs
import { readFileSync } from 'node:fs';

const raw = (() => { try { return readFileSync(new URL('../db/erase-account.sql', import.meta.url), 'utf8'); } catch { return ''; } })();
const sql = raw.replace(/--[^\n]*/g, '');            // strip line comments (no '--' in this migration's string literals)
const fails = [];
const need = (c, m) => { if (!c) fails.push(m); };
const count = re => (sql.match(re) || []).length;
if (!raw) fails.push('missing db/erase-account.sql');

if (raw) {
  // transaction + apply-once hygiene
  need(count(/^\s*begin\s*;/gim) === 1 && count(/^\s*commit\s*;/gim) === 1, 'must be wrapped in exactly one transaction');
  need(!/\bif\s+not\s+exists\b/i.test(sql), 'must NOT use IF NOT EXISTS');
  need(!/pgcrypto/i.test(sql), 'must not depend on pgcrypto');

  // tombstone table: RLS + revoke + service-role only
  need(/create table public\.account_tombstones\s*\(/i.test(sql), 'must CREATE TABLE public.account_tombstones (apply-once)');
  need(/user_id\s+uuid\s+primary key/i.test(sql), 'account_tombstones.user_id must be uuid PK');
  need(/alter table public\.account_tombstones enable row level security/i.test(sql), 'account_tombstones must enable RLS');
  need(/revoke all on table public\.account_tombstones from public,\s*anon,\s*authenticated,\s*service_role/i.test(sql), 'account_tombstones must REVOKE ALL from public/anon/authenticated/service_role (default grants service_role ALL)');
  need(/grant select on table public\.account_tombstones to service_role/i.test(sql), 'account_tombstones must grant service_role SELECT only (mutation via definer fns)');
  need(!/grant all on table public\.account_tombstones/i.test(sql), 'account_tombstones must NOT grant ALL (SELECT only)');

  // exactly the four functions; new ones are CREATE FUNCTION (fail-if-exists), claim_device is OR REPLACE
  need(/create function public\.erase_account\(\)/i.test(sql), 'erase_account must be CREATE FUNCTION (apply-once), no args');
  need(!/create or replace function public\.erase_account/i.test(sql), 'erase_account must NOT be CREATE OR REPLACE');
  need(/create function public\.finalize_erasure\([^)]*uuid[^)]*\)/i.test(sql), 'finalize_erasure must be CREATE FUNCTION with a uuid arg');
  need(/create function public\.purge_stale_tombstones\(\)/i.test(sql), 'purge_stale_tombstones must be CREATE FUNCTION');
  need(/create or replace function public\.claim_device\(/i.test(sql), 'claim_device must be CREATE OR REPLACE (intentional update)');

  // all four functions hardened
  need(count(/security definer/gi) === 4, 'all 4 functions must be SECURITY DEFINER');
  need(count(/set search_path\s*=\s*''/gi) === 4, "all 4 functions must pin search_path = ''");
  need(!/security invoker/i.test(sql), 'no SECURITY INVOKER');

  // concurrency: auth.users FOR UPDATE in BOTH claim_device and erase_account (same lock order)
  need(count(/from auth\.users where id = v_uid for update/gi) === 2, 'claim_device AND erase_account must lock auth.users FOR UPDATE (same order)');

  // erase_account body
  need(/insert into public\.account_tombstones\s*\(user_id\)\s*values\s*\(v_uid\)\s*on conflict/i.test(sql), 'erase_account must insert the tombstone (on conflict do nothing)');
  for (const t of ['events','saves','scores','profiles','user_state','devices'])
    need(new RegExp(`delete from public\\.${t}\\b`, 'i').test(sql), `erase_account must delete from public.${t}`);
  need(/delete from public\.profiles\s+where device_id = any\(v_devs\)/i.test(sql), 'profiles must be deleted BY device_id (authoritative), from the devices.user_id set');
  need(!/delete from public\.profiles\s+where user_id/i.test(sql), 'profiles must NOT be deleted by profiles.user_id (contamination-unsafe)');
  need(/select coalesce\(array_agg\(device_id\), '\{\}'\) into v_devs from public\.devices where user_id = v_uid/i.test(sql), 'device set must come only from devices.user_id = auth.uid()');
  need(/'counts'/.test(sql) && /get diagnostics/i.test(sql), 'erase_account must return per-table deletion counts');
  need(/raise log 'erase_account rollback: SQLSTATE %', sqlstate/i.test(sql), 'rollback must RAISE LOG a sanitized SQLSTATE (no uid/row data)');
  need(/revoke all on function public\.erase_account\(\) from public,\s*anon,\s*authenticated,\s*service_role/i.test(sql), 'erase_account execute must be revoked from public/anon/authenticated/service_role');
  need(/grant execute on function public\.erase_account\(\) to authenticated/i.test(sql), 'erase_account granted to authenticated only');

  // claim_device new guards
  need(/return 'no_user'/i.test(sql), "claim_device must return 'no_user' when the auth row is gone");
  need(/from public\.account_tombstones where user_id = v_uid\)\s*then return 'erased'/i.test(sql), "claim_device must reject tombstoned accounts ('erased')");
  // claim_device REPLACEMENT must retain the 3A device-row lock, result contract, and authenticated-only grant
  need(/select \* into v from public\.devices where device_id = p_device_id for update/i.test(sql), 'replacement claim_device must retain the device-row FOR UPDATE lock');
  for (const res of ['bound', 'already_bound_same_user', 'conflict_other_user', 'unregistered', 'revoked', 'bad_capability'])
    need(new RegExp(`return '${res}'`).test(sql), `replacement claim_device must retain the '${res}' result`);
  need(/revoke all on function public\.claim_device\(text,\s*text\) from public,\s*anon,\s*authenticated,\s*service_role/i.test(sql), 'replacement claim_device must re-revoke execute from public/anon/authenticated/service_role');
  need(/grant execute on function public\.claim_device\(text,\s*text\) to authenticated/i.test(sql), 'replacement claim_device must be granted to authenticated only');

  // finalize + purge are service-role only, finalize guarded to truly-deleted accounts
  need(/if exists \(select 1 from auth\.users where id = p_user_id\) then return false/i.test(sql), 'finalize_erasure must refuse to finalize a still-existing account');
  for (const fn of ['finalize_erasure\\(uuid\\)','purge_stale_tombstones\\(\\)']) {
    need(new RegExp(`revoke all on function public\\.${fn} from public,\\s*anon,\\s*authenticated,\\s*service_role`, 'i').test(sql), `${fn} must revoke all incl. service_role first`);
    need(new RegExp(`grant execute on function public\\.${fn} to service_role`, 'i').test(sql), `${fn} must grant execute to service_role`);
  }

  // no credentials
  for (const [re, label] of [[/sb_secret_/, 'secret key'], [/sbp_[A-Za-z0-9_-]{20,}/, 'access token'], [/postgres(ql)?:\/\/[^\s]/i, 'connection string'], [/PGPASSWORD/, 'PGPASSWORD']])
    if (re.test(sql)) fails.push(`forbidden content: ${label}`);
}

if (fails.length) {
  console.error(`❌ FAIL — erase migration (${fails.length} problem${fails.length>1?'s':''}):`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log("✅ PASS — erase migration: single txn, tombstone table (RLS/service-role), erase_account (authenticated, auth.users FOR UPDATE, tombstone, deletes 6 tables by authoritative device/uid, counts, sanitized rollback), claim_device no_user/erased guards, finalize/purge service-only, no profiles.user_id authority, no credentials");
