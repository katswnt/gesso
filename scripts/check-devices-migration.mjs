#!/usr/bin/env node
// Offline gate for db/devices.sql (PR 3, Part 3A). Asserts the migration TEXT encodes the required
// security posture — RLS explicit, privileges revoked from public/anon/authenticated, hardened
// SECURITY DEFINER functions with a locked search_path, the right execute grants, and the shape
// constraints. It NEVER connects to a database and NEVER modifies files. Read-only. The live
// RLS/grants/auth.uid() behavior is proven separately by the real Supabase integration test.
//   node scripts/check-devices-migration.mjs
import { readFileSync } from "node:fs";

const SQL_PATH = new URL("../db/devices.sql", import.meta.url);
const fails = [];
const fail = m => fails.push(m);
const need = (cond, m) => { if (!cond) fail(m); };

let raw = "";
try { raw = readFileSync(SQL_PATH, "utf8"); } catch { fail("missing db/devices.sql"); }
// Strip -- line comments so prose mentioning SQL keywords can't trip the assertions (no '--' appears
// inside this migration's string literals). All checks below run on executable SQL only.
const sql = raw.replace(/--[^\n]*/g, "");

if (sql) {
  const lc = sql.toLowerCase();
  const count = re => (sql.match(re) || []).length;

  // ---- single transaction wrapper -------------------------------------------
  need(count(/^\s*begin\s*;/gim) === 1, "must open exactly one transaction (begin;)");
  need(count(/^\s*commit\s*;/gim) === 1, "must close exactly one transaction (commit;)");
  need(lc.indexOf("begin") < lc.indexOf("create table"), "begin; must precede the table creation");
  need(lc.lastIndexOf("commit") > lc.lastIndexOf("grant execute"), "commit; must follow all grants");

  // ---- security-critical migration hygiene ----------------------------------
  need(!/\bif\s+not\s+exists\b/i.test(sql), "must NOT use IF NOT EXISTS (fail loudly on a mis-shaped table)");
  need(!/pgcrypto/i.test(sql), "must NOT depend on pgcrypto (hashing is app-side)");

  // ---- table + constraints --------------------------------------------------
  need(/create table public\.devices\s*\(/i.test(sql), "must create table public.devices");
  need(/device_id\s+text\s+primary key\s+check\s*\(device_id\s*~\s*'\^\[A-Za-z0-9_-\]\{8,64\}\$'\)/i.test(sql),
    "devices.device_id must be text PK with the ^[A-Za-z0-9_-]{8,64}$ CHECK (match API shape)");
  need(/capability_hash\s+text\s+not null\s+unique\s+check\s*\(capability_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/i.test(sql),
    "devices.capability_hash must be NOT NULL UNIQUE with the ^[0-9a-f]{64}$ CHECK");
  need(/revoked_at\s+timestamptz/i.test(sql), "devices must carry revoked_at (forward-safety)");

  // ---- RLS + table privileges -----------------------------------------------
  need(/alter table public\.devices enable row level security/i.test(sql), "must explicitly ENABLE ROW LEVEL SECURITY on devices");
  need(!/force row level security/i.test(sql), "must not FORCE RLS (baseline has none)");
  need(/revoke all on table public\.devices from public,\s*anon,\s*authenticated/i.test(sql),
    "must REVOKE ALL on public.devices FROM public, anon, authenticated");
  need(/grant all on table public\.devices to service_role/i.test(sql), "must GRANT ALL on public.devices TO service_role");

  // ---- exactly two functions, both hardened ---------------------------------
  const fns = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(/gi)].map(m => m[1]).sort();
  need(JSON.stringify(fns) === JSON.stringify(["claim_device", "register_device"]),
    `must define exactly [claim_device, register_device], found [${fns}]`);
  need(count(/security definer/gi) === 2, "both functions must be SECURITY DEFINER");
  need(count(/set search_path\s*=\s*''/gi) === 2, "both functions must pin search_path = '' (empty)");
  need(!/security invoker/i.test(sql), "must not declare SECURITY INVOKER");

  // ---- register_device: service-only, no user binding -----------------------
  need(/revoke all on function public\.register_device\(text,\s*text\) from public,\s*anon,\s*authenticated/i.test(sql),
    "register_device execute must be revoked from public, anon, authenticated");
  need(/grant execute on function public\.register_device\(text,\s*text\) to service_role/i.test(sql),
    "register_device execute must be granted to service_role only");

  // ---- claim_device: authenticated, auth.uid()-derived (no caller uid) ------
  need(/create function public\.claim_device\(p_device_id text,\s*p_capability_hash text\)/i.test(sql),
    "claim_device must take exactly (p_device_id text, p_capability_hash text) — no caller-supplied uid");
  need(/auth\.uid\(\)/i.test(sql), "claim_device must derive identity from auth.uid()");
  need(/revoke all on function public\.claim_device\(text,\s*text\) from public,\s*anon,\s*authenticated,\s*service_role/i.test(sql),
    "claim_device execute must be revoked from public, anon, authenticated, service_role (default privileges grant service_role too)");
  need(/grant execute on function public\.claim_device\(text,\s*text\) to authenticated/i.test(sql),
    "claim_device execute must be granted to authenticated");
  need(/for update/i.test(sql), "claim_device must lock the device row FOR UPDATE (atomic check-and-bind)");
  need(/conflict_other_user/i.test(sql), "claim_device must return conflict_other_user (never rebind across users)");

  // ---- no credentials / connection strings leaked ---------------------------
  for (const [re, label] of [
    [/sb_secret_/, "secret key"], [/sbp_[A-Za-z0-9_-]{20,}/, "access token"],
    [/postgres(ql)?:\/\/[^\s]/i, "connection string"], [/PGPASSWORD/, "PGPASSWORD"],
  ]) if (re.test(sql)) fail(`forbidden content in db/devices.sql: ${label}`);
}

if (fails.length) {
  console.error(`❌ FAIL — devices migration (${fails.length} problem${fails.length > 1 ? "s" : ""}):`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log("✅ PASS — devices migration: single txn, RLS explicit, privileges revoked from public/anon/authenticated, 2 hardened SECURITY DEFINER fns (search_path=''), service-role register + authenticated auth.uid()-derived claim, shape CHECKs, no pgcrypto/IF NOT EXISTS/credentials");
