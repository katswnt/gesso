#!/usr/bin/env node
// Offline gate for db/erase-account-serialize.sql (PR 4, Part 4B). Asserts the forward migration TEXT
// re-defines erase_account to LOCK the account's device rows FOR UPDATE before the child-table sweep, while
// keeping every erase_account guarantee intact. NEVER connects to a database or modifies files. The live
// serialization behavior is proven by the real-DB erase verification at the apply gate.
//   node scripts/check-erase-serialize-migration.mjs
import { readFileSync } from 'node:fs';

const raw = (() => { try { return readFileSync(new URL('../db/erase-account-serialize.sql', import.meta.url), 'utf8'); } catch { return ''; } })();
const sql = raw.replace(/--[^\n]*/g, '');            // strip line comments (no '--' in this migration's string literals)
const fails = [];
const need = (c, m) => { if (!c) fails.push(m); };
const count = re => (sql.match(re) || []).length;
if (!raw) fails.push('missing db/erase-account-serialize.sql');

if (raw) {
  // transaction + forward-migration hygiene
  need(count(/^\s*begin\s*;/gim) === 1 && count(/^\s*commit\s*;/gim) === 1, 'must be wrapped in exactly one transaction');
  need(!/\bif\s+not\s+exists\b/i.test(sql), 'must NOT use IF NOT EXISTS');

  // forward migration: CREATE OR REPLACE (this re-defines the already-applied function)
  need(/create or replace function public\.erase_account\(\)/i.test(sql), 'erase_account must be CREATE OR REPLACE (forward migration over the applied fn)');

  // hardening preserved
  need(/security definer/i.test(sql), 'erase_account must remain SECURITY DEFINER');
  need(/set search_path\s*=\s*''/i.test(sql), "erase_account must keep search_path = ''");
  need(!/security invoker/i.test(sql), 'no SECURITY INVOKER');

  // THE serialization primitive: lock device rows FOR UPDATE via PERFORM, BEFORE the child-table sweep
  need(/perform device_id from public\.devices where user_id = v_uid for update/i.test(sql), 'must lock device rows FOR UPDATE (perform … for update) before the sweep');
  // the PERFORM lock must precede the first child delete (source order)
  const lockIdx = sql.search(/perform device_id from public\.devices where user_id = v_uid for update/i);
  const firstDeleteIdx = sql.search(/delete from public\.events\b/i);
  need(lockIdx > -1 && firstDeleteIdx > -1 && lockIdx < firstDeleteIdx, 'the device-row lock must come BEFORE the first child-table delete');
  // still lock auth.users FOR UPDATE first (lock order preserved)
  need(/select id into v_auth from auth\.users where id = v_uid for update/i.test(sql), 'must keep the auth.users FOR UPDATE lock (order: auth.users → devices → children)');
  const authIdx = sql.search(/from auth\.users where id = v_uid for update/i);
  need(authIdx > -1 && authIdx < lockIdx, 'auth.users lock must precede the devices lock');

  // erase body guarantees unchanged
  need(/insert into public\.account_tombstones\s*\(user_id\)\s*values\s*\(v_uid\)\s*on conflict/i.test(sql), 'must still insert the tombstone (on conflict do nothing)');
  for (const t of ['events','saves','scores','profiles','user_state','devices'])
    need(new RegExp(`delete from public\\.${t}\\b`, 'i').test(sql), `must delete from public.${t}`);
  need(/delete from public\.profiles\s+where device_id = any\(v_devs\)/i.test(sql), 'profiles must be deleted BY device_id (authoritative)');
  need(!/delete from public\.profiles\s+where user_id/i.test(sql), 'profiles must NOT be deleted by profiles.user_id');
  need(/select coalesce\(array_agg\(device_id\), '\{\}'\) into v_devs from public\.devices where user_id = v_uid/i.test(sql), 'device set must still come from devices.user_id');
  need(/'counts'/.test(sql) && /get diagnostics/i.test(sql), 'must return per-table deletion counts');
  need(/raise log 'erase_account rollback: SQLSTATE %', sqlstate/i.test(sql), 'rollback must RAISE LOG a sanitized SQLSTATE');
  need(/revoke all on function public\.erase_account\(\) from public,\s*anon,\s*authenticated,\s*service_role/i.test(sql), 'execute must be revoked from public/anon/authenticated/service_role');
  need(/grant execute on function public\.erase_account\(\) to authenticated/i.test(sql), 'erase_account granted to authenticated only');

  // no credentials
  for (const [re, label] of [[/sb_secret_/, 'secret key'], [/sbp_[A-Za-z0-9_-]{20,}/, 'access token'], [/postgres(ql)?:\/\/[^\s]/i, 'connection string'], [/PGPASSWORD/, 'PGPASSWORD']])
    if (re.test(sql)) fails.push(`forbidden content: ${label}`);
}

if (fails.length) {
  console.error(`❌ FAIL — erase-serialize migration (${fails.length} problem${fails.length>1?'s':''}):`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('✅ PASS — erase-serialize migration: single txn, CREATE OR REPLACE erase_account, device rows locked FOR UPDATE (via PERFORM) BEFORE the child sweep, lock order auth.users→devices→children preserved, all erase guarantees intact, authenticated-only, no credentials');
