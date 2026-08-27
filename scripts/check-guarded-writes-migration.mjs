#!/usr/bin/env node
// Offline gate for db/guarded-writes.sql (guarded writes, Stage A). Parses each function body and asserts its
// locks, rejects, projection rules, structured returns, and grants — plus that the migration is purely additive
// (does NOT redefine claim_device or erase_account). NEVER connects to a DB. Live locking/serialization is
// proven by scripts/db-verify-guarded.mjs at the apply gate.
//   node scripts/check-guarded-writes-migration.mjs
import { readFileSync } from 'node:fs';

const raw = (() => { try { return readFileSync(new URL('../db/guarded-writes.sql', import.meta.url), 'utf8'); } catch { return ''; } })();
const sql = raw.replace(/--[^\n]*/g, '');            // strip line comments before matching
const fails = [];
const need = (c, m) => { if (!c) fails.push(m); };
const count = re => (sql.match(re) || []).length;
if (!raw) fails.push('missing db/guarded-writes.sql');

// split into per-function blocks: name -> body text (from its CREATE to the next CREATE/COMMIT)
const blocks = {};
if (raw) {
  const re = /create function public\.(guarded_\w+)\s*\(([\s\S]*?)\$\$;/gi;
  let m; while ((m = re.exec(sql))) blocks[m[1]] = m[0];
}
const bodyNeed = (fn, cond, msg) => { if (!blocks[fn]) { fails.push(`missing function ${fn}`); return; } if (!cond(blocks[fn])) fails.push(`${fn}: ${msg}`); };

if (raw) {
  // transaction + apply-once hygiene
  need(count(/^\s*begin\s*;/gim) === 1 && count(/^\s*commit\s*;/gim) === 1, 'must be wrapped in exactly one transaction');
  need(!/if\s+not\s+exists(?!\s*\()/i.test(sql), 'must NOT use DDL IF NOT EXISTS');

  // exact six-function inventory, all CREATE FUNCTION (not OR REPLACE)
  const EXPECT = ['guarded_save', 'guarded_unsave', 'guarded_score', 'guarded_profile', 'guarded_user_state', 'guarded_claim_device'].sort();
  need(JSON.stringify(Object.keys(blocks).sort()) === JSON.stringify(EXPECT), `must define EXACTLY these guarded fns (got ${JSON.stringify(Object.keys(blocks).sort())})`);
  need(count(/create function public\./gi) === 6, 'must contain EXACTLY 6 CREATE FUNCTION statements (no extra function, any dollar-quote tag)');
  need(!/\bcreate or replace function\b/i.test(sql), 'all functions must be CREATE FUNCTION, not OR REPLACE');

  // ADDITIVE: never (re)define claim_device or erase_account
  need(!/create\s+(or\s+replace\s+)?function\s+public\.claim_device/i.test(sql), 'must NOT (re)define claim_device');
  need(!/create\s+(or\s+replace\s+)?function\s+public\.erase_account/i.test(sql), 'must NOT (re)define erase_account');

  // per-function hardening + structured contract
  for (const fn of EXPECT) {
    bodyNeed(fn, b => /security definer/i.test(b), 'must be SECURITY DEFINER');
    bodyNeed(fn, b => /set search_path\s*=\s*''/i.test(b), "must pin search_path = ''");
    bodyNeed(fn, b => /returns jsonb/i.test(b), 'must return jsonb');
    bodyNeed(fn, b => /jsonb_build_object\('ok', true/i.test(b), 'must return {ok:true,...} on success');
    bodyNeed(fn, b => /jsonb_build_object\('ok', false,[^)]*'error'/i.test(b), 'must return {ok:false,...,error:...} on rejection');
  }
  need(!/security invoker/i.test(sql), 'no SECURITY INVOKER');

  // device-scoped: lock ONLY the calling devices row + tombstone-present AND owner-missing rejects; NO auth.users lock
  for (const fn of ['guarded_save', 'guarded_unsave', 'guarded_score', 'guarded_profile']) {
    bodyNeed(fn, b => /select \* into v from public\.devices where device_id = p_device_id for update/i.test(b), 'must lock its devices row FOR UPDATE');
    bodyNeed(fn, b => /exists \(select 1 from public\.account_tombstones where user_id = v\.user_id\) then return jsonb_build_object\('ok', false, 'error', 'erased'\)/i.test(b), 'must reject tombstoned owner (erased)');
    bodyNeed(fn, b => /not exists \(select 1 from auth\.users where id = v\.user_id\) then return jsonb_build_object\('ok', false, 'error', 'no_user'\)/i.test(b), 'must reject owner-missing-from-auth.users (no_user)');
    for (const code of ['unregistered', 'revoked', 'bad_capability']) bodyNeed(fn, b => new RegExp(`'error', '${code}'`).test(b), `must reject '${code}'`);
    bodyNeed(fn, b => !/from auth\.users where id = v\.user_id for update/i.test(b), 'device-scoped fn must NOT lock auth.users (deadlock-safety)');
  }

  // guarded_score: date param type, best-score under lock, cold rule, isBest/storedTotal, projection preserves user_id
  bodyNeed('guarded_score', b => /p_date date\b/i.test(b), 'p_date must be typed `date`, not text');
  bodyNeed('guarded_score', b => /v_best := \(v_stored is null\) or \(p_total > v_stored\)/i.test(b), 'best-score must be (v_stored is null) or (p_total > v_stored)');
  bodyNeed('guarded_score', b => /'isBest', v_best, 'storedTotal', case when v_best then p_total else v_stored end/i.test(b), 'must return isBest + final storedTotal');
  bodyNeed('guarded_score', b => /\(v_stored is null\)/.test(b) && /cold/i.test(b), 'cold must be (v_stored is null) = first attempt');
  bodyNeed('guarded_score', b => /on conflict \(device_id, date, tier\)/i.test(b), 'must upsert scores on (device_id,date,tier)');
  bodyNeed('guarded_score', b => /on conflict \(device_id\) do update set name = excluded\.name, color = excluded\.color;/i.test(b), 'projection must set EXACTLY name/color (semicolon-terminated; no user_id)');

  // guarded_profile: name/color only, exactly (no trailing user_id write)
  bodyNeed('guarded_profile', b => /on conflict \(device_id\) do update set name = excluded\.name, color = excluded\.color;/i.test(b), 'must upsert EXACTLY name/color (semicolon-terminated; preserve user_id)');
  need(count(/on conflict \(device_id\) do update set name = excluded\.name, color = excluded\.color;/gi) === 2, 'exactly score+profile do the name/color projection (and set nothing else)');
  need(!/do update set name = excluded\.name, color = excluded\.color,/i.test(sql), 'name/color projection must not also set another column (e.g. user_id)');

  // guarded_unsave: account-wide via devices.user_id (unlocked) + deletion count
  bodyNeed('guarded_unsave', b => /delete from public\.saves where work_id = p_work_id and device_id in \(select device_id from public\.devices where user_id = v\.user_id\)/i.test(b), 'must delete account-wide via devices.user_id');
  bodyNeed('guarded_unsave', b => /'deleted', n/.test(b) && /get diagnostics n = row_count/i.test(b), 'must return the deletion count');

  // guarded_user_state: auth.users FOR UPDATE first, tombstone reject, explicit columns, no device lock
  bodyNeed('guarded_user_state', b => /select id into v_auth from auth\.users where id = v_uid for update/i.test(b), 'must lock auth.users FOR UPDATE first');
  bodyNeed('guarded_user_state', b => /exists \(select 1 from public\.account_tombstones where user_id = v_uid\) then return jsonb_build_object\('ok', false, 'error', 'erased'\)/i.test(b), 'must reject tombstoned account (erased)');
  bodyNeed('guarded_user_state', b => /'error', 'no_auth'/.test(b) && /'error', 'no_user'/.test(b), 'must reject no_auth + no_user');
  bodyNeed('guarded_user_state', b => /insert into public\.user_state \(user_id, streak, mastery, glossary, seen, updated_at\)/i.test(b), 'must write explicit columns streak/mastery/glossary/seen');
  bodyNeed('guarded_user_state', b => !/public\.devices/i.test(b), 'must not touch devices (account-scoped only)');

  // guarded_claim_device: wrapper over unchanged claim_device; full result set + error on rejection
  bodyNeed('guarded_claim_device', b => /v_result := public\.claim_device\(p_device_id, p_capability_hash\)/i.test(b), 'must call the unchanged public.claim_device');
  bodyNeed('guarded_claim_device', b => /in \('bound', 'already_bound_same_user'\)/i.test(b), 'must project only on a successful bind');
  bodyNeed('guarded_claim_device', b => /jsonb_build_object\('ok', true, 'result', v_result\)/i.test(b), 'success must carry result verbatim');
  bodyNeed('guarded_claim_device', b => /jsonb_build_object\('ok', false, 'result', v_result, 'error', v_result\)/i.test(b), 'rejection must carry BOTH result (for the mapping) and error (contract)');
  bodyNeed('guarded_claim_device', b => /on conflict \(device_id\) do update set user_id = excluded\.user_id;/i.test(b), 'projection must set EXACTLY user_id (semicolon-terminated; preserve name/color)');

  // never read profiles.user_id for authority; no generic/dynamic writer
  need(!/from public\.profiles where user_id/i.test(sql), 'must NOT read profiles.user_id for authority');
  need(!/\bexecute\s+format\b/i.test(sql) && !/\bexecute\s+'/i.test(sql), 'no dynamic-SQL generic writer');
  need(!/p_table\b/i.test(sql), 'no table-name parameter (narrow functions only)');

  // grants: device fns -> service_role, account/claim fns -> authenticated; each revoke-all first
  const GRANTS = {
    'guarded_save\\(text, text, text\\)': 'service_role', 'guarded_unsave\\(text, text, text\\)': 'service_role',
    'guarded_score\\(text, text, date, text, int, int, int, jsonb, text, text\\)': 'service_role',
    'guarded_profile\\(text, text, text, text\\)': 'service_role',
    'guarded_user_state\\(jsonb, jsonb, jsonb, jsonb\\)': 'authenticated', 'guarded_claim_device\\(text, text\\)': 'authenticated',
  };
  for (const [sig, role] of Object.entries(GRANTS)) {
    need(new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated, service_role`, 'i').test(sql), `${sig} must revoke-all first`);
    need(new RegExp(`grant execute on function public\\.${sig} to ${role}`, 'i').test(sql), `${sig} must grant ${role}`);
  }
  need(!/grant execute on function public\.guarded_save[^;]*to authenticated/i.test(sql), 'guarded_save must NOT be granted to authenticated');

  // no credentials
  for (const [re, label] of [[/sb_secret_/, 'secret key'], [/sbp_[A-Za-z0-9_-]{20,}/, 'access token'], [/postgres(ql)?:\/\/[^\s]/i, 'connection string'], [/PGPASSWORD/, 'PGPASSWORD']])
    if (re.test(sql)) fails.push(`forbidden content: ${label}`);
}

if (fails.length) {
  console.error(`❌ FAIL — guarded-writes migration (${fails.length} problem${fails.length > 1 ? 's' : ''}):`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('✅ PASS — guarded-writes migration: exactly 6 additive SECURITY DEFINER fns (per-function verified), date-typed score, device-row FOR UPDATE + tombstone/no_user rejects, best-score under lock, name/color vs user_id projections, auth.users-first user_state (tombstone + explicit columns), claim wrapper full-result-set + error contract, structured jsonb, correct grants, no claim_device/erase_account redefinition, no generic writer, no profiles.user_id authority, no credentials');
