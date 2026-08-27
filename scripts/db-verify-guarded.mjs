#!/usr/bin/env node
// Real-DB verification for db/guarded-writes.sql (Stage A). Proves the guarded write functions serialize
// against the REAL erase_account in both orderings (captured backend PIDs + pg_blocking_pids), the score
// best-decision + contract, projection/unsave semantics, and rejects. Owner-run against a scratch project, or
// prod with the exact-ref override. Cleanup runs in finally, terminates every session, checks every delete,
// and asserts zero residual across ALL affected tables + Auth users; PASS is printed only with zero residue.
//   SCRATCH_SUPABASE_URL=... SCRATCH_SUPABASE_ANON_KEY=... SCRATCH_SUPABASE_SERVICE_KEY=... \
//   SCRATCH_SUPABASE_DB_URL='postgresql://...' [ALLOW_PROD_VERIFY=<ref>] npm run db:verify-guarded
import { execFileSync, spawn } from 'node:child_process';

const PROD_REF = 'jmrpqmejupouqfergyyg';
const URL_  = process.env.SCRATCH_SUPABASE_URL || '';
const ANON  = process.env.SCRATCH_SUPABASE_ANON_KEY || '';
const SVC   = process.env.SCRATCH_SUPABASE_SERVICE_KEY || '';
const DBURL = process.env.SCRATCH_SUPABASE_DB_URL || '';
const PSQL  = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const die = m => { console.error('✗ ' + m); process.exit(1); };
if (!URL_ || !ANON || !SVC || !DBURL) die('not configured — set SCRATCH_SUPABASE_URL/_ANON_KEY/_SERVICE_KEY/_DB_URL');
const targetIsProd = URL_.includes(PROD_REF) || DBURL.includes(PROD_REF);
if (targetIsProd && (process.env.ALLOW_PROD_VERIFY || '') !== PROD_REF) die('refusing prod without ALLOW_PROD_VERIFY=<exact prod ref>');
if (targetIsProd) console.warn(`⚠ PRODUCTION guarded-writes verification (override for ${PROD_REF})`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let PG; try { const u = new URL(DBURL); PG = { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: (u.pathname || '/postgres').slice(1) || 'postgres', pass: decodeURIComponent(u.password || '') }; } catch { die('bad SCRATCH_SUPABASE_DB_URL'); }
const pgEnv = { ...process.env, PGPASSWORD: PG.pass, PGSSLMODE: 'require' };
const pgArgs = x => ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.db, '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', ...x];
const sql    = q => execFileSync(PSQL, pgArgs(['-tAqc', q]), { encoding: 'utf8', env: pgEnv }).trim();
const sqlTry = q => { try { execFileSync(PSQL, pgArgs(['-qc', q]), { stdio: 'pipe', env: pgEnv }); return null; } catch (e) { return String(e.stderr || e.message).split('\n')[0]; } };
const seed   = q => { const e = sqlTry(q); if (e) throw new Error('SETUP FAILED: ' + e); };

const isJwt = s => /^eyJ/.test(s);
const svcH  = () => ({ apikey: SVC, ...(isJwt(SVC) ? { Authorization: `Bearer ${SVC}` } : {}), 'Content-Type': 'application/json' });
const userH = jwt => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });
const rpcSvc  = (fn, a)    => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: svcH(), body: JSON.stringify(a || {}) });
const rpcUser = (fn, a, j) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: userH(j), body: JSON.stringify(a || {}) });
const scalar  = async r => { try { return JSON.parse(await r.text()); } catch { return undefined; } };
const rnd = () => sql('select md5(random()::text)||md5(random()::text)');

const RUN = sql("select substr(md5(random()::text),1,12)");   // long run id → collision-resistant
const dev = tag => `gd${RUN}${tag}`;
const EMAIL_LIKE = `guardtest\\_%\\_${RUN}@example.test`;

// run-owned tracking for safe teardown (exact IDs, not just a prefix)
const madeUsers = new Set();       // auth user uuids
const madeDevices = new Set();     // device_ids created by this run
const sessions = [];               // live psql sessions
async function mkUser(tag) {
  const email = `guardtest_${tag}_${RUN}@example.test`, pw = 'Pw!' + rnd().slice(0, 20);
  const c = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: svcH(), body: JSON.stringify({ email, password: pw, email_confirm: true }) });
  if (!c.ok) throw new Error('create user ' + c.status); const uid = (await c.json()).id; if (uid) madeUsers.add(uid);
  const t = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  if (!t.ok) throw new Error('token ' + t.status); return { uid, token: (await t.json()).access_token };
}
const seedDevice = (d, uid, cap) => { seed(`insert into public.devices(device_id,capability_hash,user_id) values ('${d}','${cap}',${uid ? `'${uid}'` : 'null'})`); madeDevices.add(d); };  // track only AFTER a successful insert

// Controllable psql session: begin, optionally set JWT claims, run a statement (holding its locks), capture pid
// AND the statement's own output (so we read a guarded function's result inside its OWNING transaction).
function openSession() {
  const child = spawn(PSQL, pgArgs(['-q', '-A', '-t']), { env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; child.stdout.on('data', d => buf += d); let pid = null; let ended = false;
  const waitFor = async (needle, tries = 80) => { for (let i = 0; i < tries; i++) { if (buf.includes(needle)) return true; await sleep(100); } return false; };
  const s = {
    async begin() { child.stdin.write("begin;\nselect 'PIDIS='||pg_backend_pid();\n"); for (let i = 0; i < 80; i++) { const m = buf.match(/PIDIS=(\d+)/); if (m) { pid = m[1]; return true; } await sleep(100); } return false; },
    pid() { return pid; },
    async setClaims(uid) { return s.run(`select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true)`, 'CLAIMSET'); },
    async run(stmt, marker) { const before = buf.length; child.stdin.write(stmt.replace(/\n/g, ' ') + `;\nselect '${marker}';\n`); const okm = await waitFor(marker); const out = buf.slice(before); return okm ? out : null; },  // returns the stmt's own output
    async close() { if (ended) return; ended = true; return new Promise(res => { const to = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} res(); }, 4000); child.on('exit', () => { clearTimeout(to); res(); }); try { child.stdin.write('rollback;\n\\q\n'); child.stdin.end(); } catch { try { child.kill('SIGKILL'); } catch {} } }); },
    async release() { if (ended) return 0; ended = true; return new Promise(res => { child.on('exit', c => res(c)); child.stdin.write('commit;\n'); child.stdin.end(); }); },
  };
  sessions.push(s); return s;
}
const jsonIn = out => { const m = out && out.match(/\{[\s\S]*?\}/); return m ? JSON.parse(m[0]) : null; };
const settledFlag = p => { const st = { done: false, val: undefined }; p.then(v => { st.done = true; st.val = v; }, () => { st.done = true; }); return st; };
const blockedBy = (holderPid, like) => Number(sql(`select count(*) from pg_stat_activity a where '${holderPid}'::int = any(pg_blocking_pids(a.pid)) and a.state='active' and a.wait_event_type='Lock' and a.query ilike '%${like}%'`));
async function waitBlocked(holderPid, like, tries = 80) { for (let i = 0; i < tries; i++) { if (blockedBy(holderPid, like) > 0) return true; await sleep(100); } return false; }
const cnt = (tbl, col, val) => Number(sql(`select count(*) from public.${tbl} where ${col}='${val}'`));

const fails = [], notes = []; const ok = (c, m) => { if (c) notes.push('✓ ' + m); else fails.push(m); };

async function main() {
  // ---- preflight: the run prefix must be unused (never delete another run's rows) ----
  for (const t of ['devices', 'saves', 'scores', 'profiles', 'events'])
    if (Number(sql(`select count(*) from public.${t} where device_id like 'gd${RUN}%'`)) !== 0) throw new Error(`run prefix gd${RUN} already present in ${t} — aborting to avoid cross-run deletion`);

  // ---- catalog ----
  const sp = sig => sql(`select coalesce((select c from unnest(proconfig) c where c like 'search_path=%'),'') from pg_proc where oid='public.${sig}'::regprocedure`);
  const hasFn = (role, sig) => sql(`select has_function_privilege('${role}','public.${sig}','EXECUTE')`);
  const SIGS = {
    'guarded_save(text,text,text)': 'service_role', 'guarded_unsave(text,text,text)': 'service_role',
    'guarded_score(text,text,date,text,int,int,int,jsonb,text,text)': 'service_role', 'guarded_profile(text,text,text,text)': 'service_role',
    'guarded_user_state(jsonb,jsonb,jsonb,jsonb)': 'authenticated', 'guarded_claim_device(text,text)': 'authenticated',
  };
  for (const [sig, role] of Object.entries(SIGS)) {
    ok(sql(`select prosecdef from pg_proc where oid='public.${sig}'::regprocedure`) === 't', `${sig} SECURITY DEFINER`);
    ok(sp(sig) === 'search_path=""', `${sig} search_path exactly empty`);
    const other = role === 'service_role' ? 'authenticated' : 'service_role';
    ok(hasFn(role, sig) === 't' && hasFn(other, sig) === 'f' && hasFn('anon', sig) === 'f', `${sig} granted to ${role} only`);
  }

  // ---- WRITER-FIRST (saves): real guarded_save held in an open txn; result captured IN-SESSION ----
  { const A = await mkUser('wf'); const d = dev('wf'); const cap = rnd(); seedDevice(d, A.uid, cap);
    const S = openSession(); ok(await S.begin(), 'saves writer session began');
    const out = await S.run(`select public.guarded_save('${d}','${cap}','workwf')`, 'SAVED');
    const jr = jsonIn(out); ok(jr && jr.ok === true, 'guarded_save returned {ok:true} inside its own transaction');
    const cntOut = await S.run(`select 'CNT='||count(*) from public.saves where device_id='${d}' and work_id='workwf'`, 'CNTM');
    ok(/CNT=1\b/.test(cntOut || ''), 'guarded_save inserted EXACTLY one row (verified inside the owning transaction, not just post-erasure)');
    const p = rpcUser('erase_account', {}, A.token); const st = settledFlag(p);
    ok(await waitBlocked(S.pid(), 'erase_account'), 'erase_account BLOCKED by the saves-writer session');
    ok(!st.done, 'erase unsettled while writer holds the device lock');
    ok(await S.release() === 0, 'writer committed');
    const jj = await scalar(await p); ok(jj && jj.ok === true, 'erase completes after writer release');
    ok(cnt('saves', 'device_id', d) === 0 && cnt('devices', 'device_id', d) === 0, 'erase swept the writer-first save + device (no orphan)'); }

  // ---- ERASURE-FIRST (saves) via a real child-row blocker ----
  { const A = await mkUser('ef'); const d = dev('ef'); const cap = rnd(); seedDevice(d, A.uid, cap);
    seed(`insert into public.saves(device_id,work_id) values ('${d}','childrow')`);
    const child = openSession(); await child.begin();
    await child.run(`select 1 from public.saves where device_id='${d}' and work_id='childrow' for update`, 'HELD');
    const pe = rpcUser('erase_account', {}, A.token); const ste = settledFlag(pe);
    ok(await waitBlocked(child.pid(), 'erase_account'), 'real erase_account holds the device lock and is BLOCKED on the child saves row');
    ok(cnt('devices', 'device_id', d) === 1, 'device still present while erase blocked');
    const epid = sql(`select pid from pg_stat_activity where '${child.pid()}'::int = any(pg_blocking_pids(pid)) and query ilike '%erase_account%' limit 1`);
    const pw = rpcSvc('guarded_save', { p_device_id: d, p_capability_hash: cap, p_work_id: 'raced' }); const stw = settledFlag(pw);
    ok(await waitBlocked(epid, 'guarded_save'), 'guarded_save BLOCKED specifically by the erasure backend');
    ok(!ste.done && !stw.done, 'erase + writer both unsettled before release');
    await child.release();
    ok((await scalar(await pe)).ok === true, 'erase completes after child release');
    const jw = await scalar(await pw); ok(jw && jw.ok === false && ['unregistered', 'erased'].includes(jw.error), 'erasure-first: guarded_save returns unregistered/erased, wrote nothing');
    ok(cnt('saves', 'device_id', d) === 0, 'no raced save persisted'); }

  // ---- user_state WRITER-FIRST (auth.users lock via JWT-claims GUC) ----
  { const A = await mkUser('uw'); const d = dev('uw'); seedDevice(d, A.uid, rnd());
    const S = openSession(); await S.begin(); await S.setClaims(A.uid);
    const out = await S.run(`select public.guarded_user_state('{}','{}','{}','[]')`, 'USW');
    ok((jsonIn(out) || {}).ok === true, 'guarded_user_state ran under JWT claims + holds auth.users lock');
    const p = rpcUser('erase_account', {}, A.token); const st = settledFlag(p);
    ok(await waitBlocked(S.pid(), 'erase_account'), 'erase BLOCKED by the user_state writer (auth.users)');
    ok(!st.done, 'erase unsettled while writer holds auth.users');
    ok(await S.release() === 0, 'user_state writer committed (exit 0, not a rollback)');
    ok((await scalar(await p)).ok === true, 'erase completes ok:true after release');
    ok(cnt('user_state', 'user_id', A.uid) === 0, 'erase swept the writer-first user_state (no orphan)'); }

  // ---- user_state ERASURE-FIRST via child blocker ----
  { const A = await mkUser('ue'); const d = dev('ue'); seedDevice(d, A.uid, rnd());
    seed(`insert into public.user_state(user_id,streak) values ('${A.uid}','{}')`);
    const child = openSession(); await child.begin();
    await child.run(`select 1 from public.user_state where user_id='${A.uid}' for update`, 'HELD');
    const pe = rpcUser('erase_account', {}, A.token); const ste = settledFlag(pe);
    ok(await waitBlocked(child.pid(), 'erase_account'), 'erase blocked on the user_state child row');
    const epid = sql(`select pid from pg_stat_activity where '${child.pid()}'::int = any(pg_blocking_pids(pid)) and query ilike '%erase_account%' limit 1`);
    const pw = rpcUser('guarded_user_state', { p_streak: {}, p_mastery: {}, p_glossary: {}, p_seen: [] }, A.token); const stw = settledFlag(pw);
    ok(await waitBlocked(epid, 'guarded_user_state'), 'guarded_user_state BLOCKED by the erasure backend (auth.users)');
    await child.release();
    ok((await scalar(await pe)).ok === true, 'erase completes ok:true (user_state erasure-first)');
    const jw = await scalar(await pw); ok(jw && jw.ok === false && ['no_user', 'erased'].includes(jw.error), 'erasure-first: guarded_user_state returns no_user/erased, wrote nothing');
    ok(cnt('user_state', 'user_id', A.uid) === 0, 'no user_state row persisted after erasure-first race'); }

  // ---- user_state SUCCESS: all four columns stored ----
  { const A = await mkUser('uok'); const d = dev('uok'); seedDevice(d, A.uid, rnd());
    const r = await scalar(await rpcUser('guarded_user_state', { p_streak: { current: 3 }, p_mastery: { b: { k: { correct: 1, total: 2 } } }, p_glossary: { met: { a: '2020' } }, p_seen: ['w1'] }, A.token));
    ok(r && r.ok === true, 'guarded_user_state success');
    ok(sql(`select streak->>'current' from public.user_state where user_id='${A.uid}'`) === '3'
      && sql(`select seen::text from public.user_state where user_id='${A.uid}'`) === '["w1"]'
      && sql(`select glossary->'met'->>'a' from public.user_state where user_id='${A.uid}'`) === '2020'
      && sql(`select mastery->'b'->'k'->>'total' from public.user_state where user_id='${A.uid}'`) === '2', 'all four user_state columns stored correctly'); }

  // ---- score concurrency: both orders; final=max, per-tx isBest/storedTotal captured, cold rule ----
  for (const [firstTotal, secondTotal] of [[100, 500], [500, 100]]) {
    const A = await mkUser('sc' + firstTotal); const d = dev('sc' + firstTotal); const cap = rnd(); seedDevice(d, A.uid, cap);
    const S = openSession(); await S.begin();
    const out1 = await S.run(`select public.guarded_score('${d}','${cap}','2026-08-01','easy',${firstTotal},0,0,null,'n','#2230b8')`, 'SC1');
    const j1 = jsonIn(out1);
    ok(j1 && j1.ok === true && j1.isBest === true && Number(j1.storedTotal) === firstTotal, `first score(${firstTotal}) ok + isBest true, storedTotal=${firstTotal}`);
    const p2 = rpcSvc('guarded_score', { p_device_id: d, p_capability_hash: cap, p_date: '2026-08-01', p_tier: 'easy', p_total: secondTotal, p_perfects: 0, p_masterpieces: 0, p_rounds: null, p_name: 'n', p_color: '#2230b8' });
    ok(await waitBlocked(S.pid(), 'guarded_score'), `score(${secondTotal}) blocked by score(${firstTotal})`);
    await S.release();
    const j2 = await scalar(await p2);
    const finalTotal = Number(sql(`select total from public.scores where device_id='${d}' and date='2026-08-01' and tier='easy'`));
    ok(finalTotal === Math.max(firstTotal, secondTotal), `final stored total is the max (${finalTotal})`);
    ok(j2 && j2.ok === true && j2.isBest === (secondTotal > firstTotal), `second score ok + isBest correct at its serialization point (${j2 && j2.isBest})`);
    ok(j2 && Number(j2.storedTotal) === finalTotal, 'second storedTotal equals final observed value');
    ok(sql(`select cold from public.scores where device_id='${d}' and date='2026-08-01' and tier='easy'`) === (secondTotal > firstTotal ? 'f' : 't'), 'cold reflects first-attempt/retry rule');
  }

  // ---- score stores perfects/masterpieces/rounds + preserves projected profiles.user_id ----
  { const A = await mkUser('sf'); const d = dev('sf'); const cap = rnd(); seedDevice(d, A.uid, cap);
    await rpcUser('guarded_claim_device', { p_device_id: d, p_capability_hash: cap }, A.token);   // sets projection user_id
    const jsf = await scalar(await rpcSvc('guarded_score', { p_device_id: d, p_capability_hash: cap, p_date: '2026-08-02', p_tier: 'hard', p_total: 999, p_perfects: 2, p_masterpieces: 1, p_rounds: [1, 2], p_name: 'Zed', p_color: '#334455' }));
    ok(jsf && jsf.ok === true, 'guarded_score (field storage) returned ok:true');
    ok(sql(`select perfects||'/'||masterpieces||'/'||coalesce(rounds::text,'null') from public.scores where device_id='${d}' and date='2026-08-02' and tier='hard'`) === '2/1/[1, 2]', 'score stored perfects/masterpieces/rounds');
    ok(sql(`select cold from public.scores where device_id='${d}' and date='2026-08-02' and tier='hard'`) === 't', 'first-attempt score is cold=true');
    ok(sql(`select user_id from public.profiles where device_id='${d}'`) === A.uid && sql(`select name from public.profiles where device_id='${d}'`) === 'Zed', 'score projection preserved user_id + wrote name'); }

  // ---- guarded_profile: changes name/color, preserves a pre-existing projected user_id ----
  { const A = await mkUser('gp'); const d = dev('gp'); const cap = rnd(); seedDevice(d, A.uid, cap);
    seed(`insert into public.profiles(device_id,user_id,name,color) values ('${d}','${A.uid}','Old','#000000')`);
    const r = await scalar(await rpcSvc('guarded_profile', { p_device_id: d, p_capability_hash: cap, p_name: 'New', p_color: '#ffffff' }));
    ok(r && r.ok === true, 'guarded_profile success');
    ok(sql(`select name from public.profiles where device_id='${d}'`) === 'New' && sql(`select color from public.profiles where device_id='${d}'`) === '#ffffff', 'guarded_profile changed name + color');
    ok(sql(`select user_id from public.profiles where device_id='${d}'`) === A.uid, 'guarded_profile preserved the pre-existing user_id'); }

  // ---- claim wrapper: preserves pre-existing name/color; result set (bound / conflict / unregistered / bad_device) ----
  { const A = await mkUser('ca'); const B = await mkUser('cb'); const d = dev('ca'); const cap = rnd(); seedDevice(d, null, cap);
    seed(`insert into public.profiles(device_id,name,color) values ('${d}','Pre','#abcdef')`);
    const j = await scalar(await rpcUser('guarded_claim_device', { p_device_id: d, p_capability_hash: cap }, A.token));
    ok(j && j.ok === true && j.result === 'bound', 'guarded_claim_device bound');
    ok(sql(`select name from public.profiles where device_id='${d}'`) === 'Pre' && sql(`select color from public.profiles where device_id='${d}'`) === '#abcdef' && sql(`select user_id from public.profiles where device_id='${d}'`) === A.uid, 'claim preserved pre-existing name/color, set user_id');
    const jc = await scalar(await rpcUser('guarded_claim_device', { p_device_id: d, p_capability_hash: cap }, B.token));
    ok(jc && jc.ok === false && jc.result === 'conflict_other_user' && jc.error === 'conflict_other_user', 'cross-account claim → {ok:false, result+error: conflict_other_user}');
    ok(sql(`select user_id from public.devices where device_id='${d}'`) === A.uid, 'authoritative devices.user_id unchanged by the conflicting claim');
    const ju = await scalar(await rpcUser('guarded_claim_device', { p_device_id: dev('cNope'), p_capability_hash: cap }, A.token));
    ok(ju && ju.ok === false && ju.result === 'unregistered' && ju.error === 'unregistered', 'unregistered device claim → {ok:false, result+error: unregistered}');
    const jb = await scalar(await rpcUser('guarded_claim_device', { p_device_id: 'short', p_capability_hash: cap }, A.token));
    ok(jb && jb.ok === false && jb.result === 'bad_device' && jb.error === 'bad_device', 'malformed device claim → {ok:false, result+error: bad_device}'); }

  // ---- anonymous unsave affects ONLY its own device ----
  { const d1 = dev('an1'), d2 = dev('an2'); const c1 = rnd(); seedDevice(d1, null, c1); seedDevice(d2, null, rnd());
    seed(`insert into public.saves(device_id,work_id) values ('${d1}','shared'),('${d2}','shared')`);
    const r = await scalar(await rpcSvc('guarded_unsave', { p_device_id: d1, p_capability_hash: c1, p_work_id: 'shared' }));
    ok(r && r.ok === true && r.deleted === 1, 'anonymous unsave deleted only its own row (deleted=1)');
    ok(cnt('saves', 'device_id', d2) === 1, "other anonymous device's save untouched"); }

  // ---- account-wide unsave across bound devices + deletion count ----
  { const A = await mkUser('un'); const d1 = dev('un1'), d2 = dev('un2'); const cap = rnd(); seedDevice(d1, A.uid, cap); seedDevice(d2, A.uid, rnd());
    seed(`insert into public.saves(device_id,work_id) values ('${d1}','w'),('${d2}','w')`);
    const r = await scalar(await rpcSvc('guarded_unsave', { p_device_id: d1, p_capability_hash: cap, p_work_id: 'w' }));
    ok(r && r.ok === true && r.deleted === 2, 'account-wide unsave removed both devices (deleted=2)'); }

  // ---- contaminated profiles.user_id cannot drive authority ----
  { const A = await mkUser('kA'); const B = await mkUser('kB'); const d = dev('k'); const cap = rnd(); seedDevice(d, B.uid, cap);  // device OWNED by B
    seed(`insert into public.profiles(device_id,user_id) values ('${d}','${A.uid}')`);                                             // contaminated projection = A
    seed(`insert into public.account_tombstones(user_id) values ('${A.uid}') on conflict do nothing`);                            // tombstone the CONTAMINATED id (A)
    const r1 = await scalar(await rpcSvc('guarded_save', { p_device_id: d, p_capability_hash: cap, p_work_id: 'w' }));
    ok(r1 && r1.ok === true, 'tombstoning the contaminated profiles.user_id (A) does NOT block the B-owned device (authority = devices.user_id)');
    seed(`delete from public.account_tombstones where user_id='${A.uid}'`);
    seed(`insert into public.account_tombstones(user_id) values ('${B.uid}') on conflict do nothing`);                            // tombstone the REAL owner (B)
    const r2 = await scalar(await rpcSvc('guarded_save', { p_device_id: d, p_capability_hash: cap, p_work_id: 'w2' }));
    ok(r2 && r2.ok === false && r2.error === 'erased', 'tombstoning the real owner (devices.user_id=B) DOES block the device');
    seed(`delete from public.account_tombstones where user_id='${B.uid}'`); }

  // ---- rejects: revoked / wrong cap / unregistered / owner-missing / structured bad_device ----
  { const A = await mkUser('rj'); const d = dev('rj'); const cap = rnd(); seedDevice(d, A.uid, cap);
    seed(`update public.devices set revoked_at=pg_catalog.now() where device_id='${d}'`);
    ok((await scalar(await rpcSvc('guarded_save', { p_device_id: d, p_capability_hash: cap, p_work_id: 'w' }))).error === 'revoked', 'revoked rejected');
    seed(`update public.devices set revoked_at=null where device_id='${d}'`);
    ok((await scalar(await rpcSvc('guarded_save', { p_device_id: d, p_capability_hash: rnd(), p_work_id: 'w' }))).error === 'bad_capability', 'wrong cap rejected');
    ok((await scalar(await rpcSvc('guarded_save', { p_device_id: dev('none'), p_capability_hash: cap, p_work_id: 'w' }))).error === 'unregistered', 'unregistered rejected');
    const ghost = sql('select gen_random_uuid()'); seed(`update public.devices set user_id='${ghost}' where device_id='${d}'`);
    ok((await scalar(await rpcSvc('guarded_save', { p_device_id: d, p_capability_hash: cap, p_work_id: 'w' }))).error === 'no_user', 'owner-missing-from-auth.users rejected');
    seed(`update public.devices set user_id='${A.uid}' where device_id='${d}'`);
    const bd = await scalar(await rpcSvc('guarded_save', { p_device_id: 'short', p_capability_hash: rnd(), p_work_id: 'w' }));
    ok(bd && bd.ok === false && bd.error === 'bad_device', 'malformed input returns structured {ok:false,error:bad_device}'); }
}

// exact run-owned teardown: close sessions, delete only this run's rows/users, assert zero residual everywhere
async function cleanup() {
  for (const s of sessions) { try { await s.close(); } catch (e) { fails.push('session close: ' + (e && e.message)); } }
  const uids = [...madeUsers];
  const devs = [...madeDevices];
  const inUids = uids.length ? `(${uids.map(u => `'${u}'`).join(',')})` : `('00000000-0000-0000-0000-000000000000')`;
  const inDevs = devs.length ? `(${devs.map(d => `'${d}'`).join(',')})` : `('__none__')`;
  // delete EXACT run-owned rows (tracked device IDs + tracked user IDs), not a broad prefix
  for (const tbl of ['saves', 'scores', 'events', 'profiles', 'devices']) { const e = sqlTry(`delete from public.${tbl} where device_id in ${inDevs}`); if (e) fails.push(`cleanup ${tbl}: ${e}`); }
  for (const tbl of ['user_state', 'account_tombstones']) { const e = sqlTry(`delete from public.${tbl} where user_id in ${inUids}`); if (e) fails.push(`cleanup ${tbl}: ${e}`); }
  for (const u of uids) { try { const r = await fetch(`${URL_}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: svcH() }); if (!r.ok && r.status !== 404) fails.push(`auth delete ${u}: ${r.status}`); } catch (e) { fails.push('auth delete: ' + (e && e.message)); } }
  // independent zero-residual: by exact tracked IDs AND by the run prefix (belt-and-suspenders)
  for (const tbl of ['saves', 'scores', 'events', 'profiles', 'devices']) {
    ok(Number(sql(`select count(*) from public.${tbl} where device_id in ${inDevs}`)) === 0, `zero residual (exact devices) in ${tbl}`);
    ok(Number(sql(`select count(*) from public.${tbl} where device_id like 'gd${RUN}%'`)) === 0, `zero residual (run prefix) in ${tbl}`);
  }
  for (const tbl of ['user_state', 'account_tombstones']) ok(Number(sql(`select count(*) from public.${tbl} where user_id in ${inUids}`)) === 0, `zero residual in ${tbl}`);
  ok(Number(sql(`select count(*) from auth.users where email like '${EMAIL_LIKE}'`)) === 0, 'zero residual Auth users');
}

(async () => {
  let threw = null;
  try { await main(); } catch (e) { threw = e; fails.push('EXCEPTION: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e)); }
  try { await cleanup(); } catch (e) { fails.push('CLEANUP EXCEPTION: ' + (e && e.message)); }
  if (fails.length) { console.error(notes.join('\n')); console.error(`\n❌ db:verify-guarded FAIL (${fails.length}):`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
  console.log(notes.join('\n'));
  console.log(`\n✅ db:verify-guarded PASS — ${notes.filter(n => n.startsWith('✓')).length} assertions (catalog/grants; writer-first + erasure-first-via-real-erase for saves AND user_state [commit-exit + ok:true + zero-residual both orderings]; score concurrency invariants + field storage; guarded_profile name/color-change with user_id preserved; claim name/color preservation + result set bound/conflict_other_user/unregistered/bad_device; anonymous vs account-wide unsave; contaminated-projection no-authority; rejects; exact run-owned teardown with zero residual across all tables + Auth. NOTE: the MAX_SAVES 'full' branch is structurally present in the migration but is NOT independently tested here (a 1,000-row fixture is deliberately not run); it lacks live coverage until a dedicated limit test or handler-level test is added.)`);
})();
