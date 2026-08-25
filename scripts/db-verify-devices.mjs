#!/usr/bin/env node
// Real Supabase integration verification for db/devices.sql (PR 3, Part 3A).
// Plain Postgres can't prove auth.uid()/RPC grants, so this runs against an ACTUAL Supabase-compatible
// target (PostgREST + GoTrue Auth + roles) using two real user JWTs. NOT part of network-free CI;
// run manually against a SCRATCH/branch project — never production.
//
//   SCRATCH_SUPABASE_URL=https://<ref>.supabase.co \
//   SCRATCH_SUPABASE_ANON_KEY=... SCRATCH_SUPABASE_SERVICE_KEY=... \
//   SCRATCH_SUPABASE_DB_URL='postgresql://postgres:<pw>@<host>:5432/postgres' \
//   npm run db:verify
//
// Prereqs on the target: db/devices.sql already applied. psql (libpq) available.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const PROD_REF = "jmrpqmejupouqfergyyg";
const URL_  = process.env.SCRATCH_SUPABASE_URL || "";
const ANON  = process.env.SCRATCH_SUPABASE_ANON_KEY || "";
const SVC   = process.env.SCRATCH_SUPABASE_SERVICE_KEY || "";
const DBURL = process.env.SCRATCH_SUPABASE_DB_URL || "";
const PSQL  = process.env.PSQL_BIN || "/opt/homebrew/opt/libpq/bin/psql";

function die(msg){ console.error("✗ " + msg); process.exit(1); }
if (!URL_ || !ANON || !SVC || !DBURL) die(
  "not configured — set SCRATCH_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY / _DB_URL to a scratch project.\n" +
  "  This test MUST NOT run against production; it creates and deletes test users + devices rows.");
// Permanent production guard. It is NEVER removed. A deliberate exact-ref override
// (ALLOW_PROD_VERIFY set to the exact prod ref) is the only way to run against production — e.g. the
// approved additive-migration verification when no isolated scratch project is available. A careless or
// mismatched value still refuses.
const targetIsProd = URL_.includes(PROD_REF) || DBURL.includes(PROD_REF);
const prodOverride = (process.env.ALLOW_PROD_VERIFY || "") === PROD_REF;
if (targetIsProd && !prodOverride) die("refusing to run against production — set ALLOW_PROD_VERIFY to the EXACT prod ref to deliberately override");
if (targetIsProd && prodOverride) console.warn(`⚠ PRODUCTION verification mode (deliberate exact-ref override for ${PROD_REF}) — additive migration only; test users + device rows will be created and deleted`);

// per-run random prefix so a killed/concurrent run can't collide or contaminate another run
const RUN = randomBytes(4).toString("hex");                 // 8 hex chars
const devId = tag => `dv${RUN}${tag}`;                       // [A-Za-z0-9_-], 10–16 chars → passes the shape CHECK

// --- psql: parse the URL, pass host/user/db as FLAGS, password via PGPASSWORD in the child env ------
let PG;
try {
  const u = new URL(DBURL);
  PG = { host: u.hostname, port: u.port || "5432", user: decodeURIComponent(u.username),
         db: (u.pathname || "/postgres").slice(1) || "postgres", pass: decodeURIComponent(u.password || "") };
} catch { die("SCRATCH_SUPABASE_DB_URL is not a valid postgresql:// URL"); }
const pgEnv = { ...process.env, PGPASSWORD: PG.pass, PGSSLMODE: "require" };
const pgArgs = extra => ["-h", PG.host, "-p", PG.port, "-U", PG.user, "-d", PG.db, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", ...extra];
const sql    = q => execFileSync(PSQL, pgArgs(["-tAqc", q]), { encoding: "utf8", env: pgEnv }).trim();
const sqlTry = q => { try { execFileSync(PSQL, pgArgs(["-qc", q]), { stdio: "pipe", env: pgEnv }); return null; } catch (e) { return String(e.stderr || e.message); } };

// --- HTTP: new sb_secret_ keys go in apikey (NOT bearer); legacy JWT service keys also work as bearer -
const isJwt = s => /^eyJ/.test(s);
const svcHeaders  = () => ({ apikey: SVC, ...(isJwt(SVC) ? { Authorization: `Bearer ${SVC}` } : {}), "Content-Type": "application/json" });
const userHeaders = jwt => { if (!jwt) throw new Error("user JWT required (no silent service fallback)"); return { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }; };
const post = (path, headers, body) => fetch(`${URL_}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.text() }));
const svcRpc  = (fn, args)      => post(`/rest/v1/rpc/${fn}`, svcHeaders(), args);
const userRpc = (fn, args, jwt) => post(`/rest/v1/rpc/${fn}`, userHeaders(jwt), args);
// a scalar-returning RPC gives a JSON-encoded string body, e.g. "bound" — match it EXACTLY, not via includes()
const scalar = r => { try { return JSON.parse(r.body); } catch { return undefined; } };

const fails = [], notes = [];
const ok = (c, m) => { if (c) notes.push("✓ " + m); else fails.push(m); };
const madeDevices = new Set(), madeUsers = new Set();

async function mkUser(email, password){
  const c = await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: svcHeaders(), body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!c.ok) throw new Error(`admin create user failed: ${c.status} ${await c.text()}`);
  const uid = (await c.json()).id;
  if (uid) madeUsers.add(uid);                                // record BEFORE the login step can throw
  const t = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!t.ok) throw new Error(`password grant failed: ${t.status} ${await t.text()}`);
  const token = (await t.json()).access_token;
  if (!token) throw new Error("no access_token returned");
  return { uid, token };
}

const rnd = () => sql("select md5(random()::text)||md5(random()::text)");   // 64 lowercase hex

async function main(){
  // ---- 1. Catalog: RLS, table privs, function execute grants, SECURITY DEFINER, EXACT search_path="" ----
  ok(sql("select relrowsecurity from pg_class where oid='public.devices'::regclass") === "t", "devices RLS enabled");
  ok(sql("select relforcerowsecurity from pg_class where oid='public.devices'::regclass") === "f", "devices RLS not forced");
  for (const role of ["anon", "authenticated"])
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      ok(sql(`select has_table_privilege('${role}','public.devices','${priv}')`) === "f", `${role} has no ${priv} on devices`);
  ok(sql("select has_function_privilege('service_role','public.register_device(text,text)','EXECUTE')") === "t", "service_role can execute register_device");
  ok(sql("select has_function_privilege('anon','public.register_device(text,text)','EXECUTE')") === "f", "anon cannot execute register_device");
  ok(sql("select has_function_privilege('authenticated','public.register_device(text,text)','EXECUTE')") === "f", "authenticated cannot execute register_device");
  ok(sql("select has_function_privilege('authenticated','public.claim_device(text,text)','EXECUTE')") === "t", "authenticated can execute claim_device");
  ok(sql("select has_function_privilege('anon','public.claim_device(text,text)','EXECUTE')") === "f", "anon cannot execute claim_device");
  ok(sql("select has_function_privilege('service_role','public.claim_device(text,text)','EXECUTE')") === "f", "service_role cannot execute claim_device (revoked)");
  for (const fn of ["register_device", "claim_device"]) {
    ok(sql(`select prosecdef from pg_proc where oid='public.${fn}(text,text)'::regprocedure`) === "t", `${fn} is SECURITY DEFINER`);
    const spent = sql(`select coalesce((select c from unnest(proconfig) c where c like 'search_path=%'),'') from pg_proc where oid='public.${fn}(text,text)'::regprocedure`);
    ok(spent === 'search_path=""', `${fn} pins search_path to EXACTLY empty (got ${JSON.stringify(spent)})`);
  }

  // ---- 2. Constraints: UNIQUE(capability_hash) + CHECKs reject bad input ------------------------
  ok(sqlTry(`insert into public.devices(device_id,capability_hash) values ('short','${rnd()}')`) !== null, "device_id CHECK rejects a short id");
  ok(sqlTry(`insert into public.devices(device_id,capability_hash) values ('${devId("chk")}','NOTHEX')`) !== null, "capability_hash CHECK rejects non-hex");
  const dh = devId("u1"), h1 = rnd(); madeDevices.add(dh);
  ok(sqlTry(`insert into public.devices(device_id,capability_hash) values ('${dh}','${h1}')`) === null, "valid direct insert accepted");
  const d2 = devId("u2"); madeDevices.add(d2);
  ok(sqlTry(`insert into public.devices(device_id,capability_hash) values ('${d2}','${h1}')`) !== null, "UNIQUE(capability_hash) rejects a reused hash");

  // ---- 3. Two real JWTs through PostgREST RPC (exact JSON scalar matching) -----------------------
  const A = await mkUser(`dvtest_a_${RUN}@example.test`, "Pw!" + rnd().slice(0, 24));
  const B = await mkUser(`dvtest_b_${RUN}@example.test`, "Pw!" + rnd().slice(0, 24));
  ok(!!A.token && !!B.token, "minted two user JWTs");

  const dev = devId("fn"), cap = rnd(); madeDevices.add(dev);
  let r;
  r = await userRpc("claim_device", { p_device_id: dev, p_capability_hash: cap }, A.token);
  ok(r.status === 200 && scalar(r) === "unregistered", "claim before register → unregistered");
  r = await svcRpc("register_device", { p_device_id: dev, p_capability_hash: cap });
  ok(r.status === 200 && scalar(r) === "ok", "service register_device → ok");
  r = await userRpc("register_device", { p_device_id: dev, p_capability_hash: cap }, A.token);
  ok([401, 403, 404].includes(r.status) && scalar(r) !== "ok", `authenticated CANNOT call register_device (got ${r.status})`);
  r = await userRpc("claim_device", { p_device_id: dev, p_capability_hash: rnd() }, A.token);
  ok(r.status === 200 && scalar(r) === "bad_capability", "wrong cap → bad_capability");
  r = await userRpc("claim_device", { p_device_id: dev, p_capability_hash: cap }, A.token);
  ok(r.status === 200 && scalar(r) === "bound", "JWT-A claim → bound");
  r = await userRpc("claim_device", { p_device_id: dev, p_capability_hash: cap }, B.token);
  ok(r.status === 200 && scalar(r) === "conflict_other_user", "JWT-B claim same device → conflict_other_user");
  r = await userRpc("claim_device", { p_device_id: dev, p_capability_hash: cap }, A.token);
  ok(r.status === 200 && scalar(r) === "already_bound_same_user", "JWT-A re-claim → already_bound_same_user");
  const dhu = devId("hu"); madeDevices.add(dhu);
  r = await svcRpc("register_device", { p_device_id: dhu, p_capability_hash: cap });
  ok(r.status === 200 && scalar(r) === "hash_in_use", "reused hash for a new device → hash_in_use");

  // ---- 4. Concurrent claim on a fresh device → exactly one bound AND one conflict ----------------
  const devC = devId("cc"), capC = rnd(); madeDevices.add(devC);
  await svcRpc("register_device", { p_device_id: devC, p_capability_hash: capC });
  const [rA, rB] = await Promise.all([
    userRpc("claim_device", { p_device_id: devC, p_capability_hash: capC }, A.token),
    userRpc("claim_device", { p_device_id: devC, p_capability_hash: capC }, B.token),
  ]);
  ok([rA, rB].every(x => x.status === 200), "both concurrent claims returned 200");
  ok([rA, rB].filter(x => scalar(x) === "bound").length === 1, "concurrent: exactly one bound");
  ok([rA, rB].filter(x => scalar(x) === "conflict_other_user").length === 1, "concurrent: exactly one conflict_other_user");

  // ---- 5. Revoked device rejected by BOTH functions --------------------------------------------
  const devR = devId("rv"), capR = rnd(); madeDevices.add(devR);
  await svcRpc("register_device", { p_device_id: devR, p_capability_hash: capR });
  ok(sqlTry(`update public.devices set revoked_at=now() where device_id='${devR}'`) === null, "revoked_at set for test");
  r = await userRpc("claim_device", { p_device_id: devR, p_capability_hash: capR }, A.token);
  ok(r.status === 200 && scalar(r) === "revoked", "claim_device rejects revoked device");
  r = await svcRpc("register_device", { p_device_id: devR, p_capability_hash: capR });
  ok(r.status === 200 && scalar(r) === "revoked", "register_device rejects revoked device");
}

try { await main(); }
catch (e) { fails.push("crashed: " + (e && e.stack || e)); }
finally {
  // cleanup ALWAYS — and treat any cleanup failure as a TEST failure (never PASS while leaking)
  for (const d of madeDevices) { const err = sqlTry(`delete from public.devices where device_id='${d}'`); if (err) fails.push(`cleanup: delete device ${d} failed: ${err.split("\n")[0]}`); }
  for (const u of madeUsers) {
    try { const rr = await fetch(`${URL_}/auth/v1/admin/users/${u}`, { method: "DELETE", headers: svcHeaders() }); if (!rr.ok) fails.push(`cleanup: delete user ${u} → ${rr.status}`); }
    catch (e) { fails.push(`cleanup: delete user ${u} threw: ${e.message}`); }
  }
}

for (const n of notes) console.log("  " + n);
if (fails.length) { console.error(`\n❌ db:verify FAIL (${fails.length}):`); fails.forEach(f => console.error("  - " + f)); process.exit(1); }
console.log(`\n✅ db:verify PASS — ${notes.length} live assertions (RLS/grants/execute incl. service_role∉claim, exact search_path="", UNIQUE+CHECKs, two-JWT bind/conflict, hash_in_use, concurrent one-bound-one-conflict, revoked rejected by both fns; per-run ids; cleanup enforced)`);
