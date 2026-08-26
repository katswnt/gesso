#!/usr/bin/env node
// Real Supabase integration verification for db/erase-account.sql (PR 4, Part 4A). NOT in CI. Run against a
// SCRATCH project, or at the approved prod-apply gate with the exact-ref override.
//
//   SCRATCH_SUPABASE_URL=... SCRATCH_SUPABASE_ANON_KEY=... SCRATCH_SUPABASE_SERVICE_KEY=... \
//   SCRATCH_SUPABASE_DB_URL='postgresql://...' [ALLOW_PROD_VERIFY=<ref>] [ERASE_ROLLBACK_TEST=1] npm run db:verify-erase
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PROD_REF = 'jmrpqmejupouqfergyyg';
const URL_  = process.env.SCRATCH_SUPABASE_URL || '';
const ANON  = process.env.SCRATCH_SUPABASE_ANON_KEY || '';
const SVC   = process.env.SCRATCH_SUPABASE_SERVICE_KEY || '';
const DBURL = process.env.SCRATCH_SUPABASE_DB_URL || '';
const PSQL  = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const die = m => { console.error('✗ ' + m); process.exit(1); };
if (!URL_ || !ANON || !SVC || !DBURL) die('not configured — set SCRATCH_SUPABASE_URL/_ANON_KEY/_SERVICE_KEY/_DB_URL (scratch project; never prod data)');
const targetIsProd = URL_.includes(PROD_REF) || DBURL.includes(PROD_REF);
if (targetIsProd && (process.env.ALLOW_PROD_VERIFY || '') !== PROD_REF) die('refusing prod without ALLOW_PROD_VERIFY=<exact prod ref>');
if (targetIsProd) console.warn(`⚠ PRODUCTION erase verification (override for ${PROD_REF}); rollback injection ${process.env.ERASE_ROLLBACK_TEST==='1'?'ENABLED':'off'}`);

const RUN = randomBytes(4).toString('hex');
const dev = tag => `dv${RUN}${tag}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let PG; try { const u = new URL(DBURL); PG = { host:u.hostname, port:u.port||'5432', user:decodeURIComponent(u.username), db:(u.pathname||'/postgres').slice(1)||'postgres', pass:decodeURIComponent(u.password||'') }; } catch { die('bad SCRATCH_SUPABASE_DB_URL'); }
const pgEnv = { ...process.env, PGPASSWORD: PG.pass, PGSSLMODE: 'require' };
const pgArgs = x => ['-h',PG.host,'-p',PG.port,'-U',PG.user,'-d',PG.db,'--no-psqlrc','-v','ON_ERROR_STOP=1',...x];
const sql    = q => execFileSync(PSQL, pgArgs(['-tAqc', q]), { encoding:'utf8', env:pgEnv }).trim();
const sqlTry = q => { try { execFileSync(PSQL, pgArgs(['-qc', q]), { stdio:'pipe', env:pgEnv }); return null; } catch(e){ return String(e.stderr||e.message).split('\n')[0]; } };
const seed   = q => { const e = sqlTry(q); if (e) throw new Error('SETUP FAILED: ' + e); };

const isJwt = s => /^eyJ/.test(s);
const svcH  = () => ({ apikey:SVC, ...(isJwt(SVC)?{Authorization:`Bearer ${SVC}`}:{}), 'Content-Type':'application/json' });
const userH = jwt => { if(!jwt) throw new Error('user JWT required'); return { apikey:ANON, Authorization:`Bearer ${jwt}`, 'Content-Type':'application/json' }; };
const rpcSvc  = (fn,a)   => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method:'POST', headers:svcH(), body:JSON.stringify(a||{}) });
const rpcUser = (fn,a,j) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method:'POST', headers:userH(j), body:JSON.stringify(a||{}) });
const scalar  = async r => { try { return JSON.parse(await r.text()); } catch { return undefined; } };
const rnd = () => sql("select md5(random()::text)||md5(random()::text)");
const cnt = (tbl, col, val) => Number(sql(`select count(*) from public.${tbl} where ${col}='${val}'`));

const madeUsers = new Set(), madeDevices = new Set(), madeTombstones = new Set(), madeObjects = [];
async function mkUser(tag){ const email=`erasetest_${tag}_${RUN}@example.test`, pw='Pw!'+rnd().slice(0,20);
  const c=await fetch(`${URL_}/auth/v1/admin/users`,{method:'POST',headers:svcH(),body:JSON.stringify({email,password:pw,email_confirm:true})}); if(!c.ok)throw new Error('create user '+c.status+' '+await c.text()); const uid=(await c.json()).id; if(uid)madeUsers.add(uid);
  const t=await fetch(`${URL_}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); if(!t.ok)throw new Error('token '+t.status); return { uid, token:(await t.json()).access_token }; }
async function delUser(uid){ return fetch(`${URL_}/auth/v1/admin/users/${uid}`,{method:'DELETE',headers:svcH()}); }

// controllable psql session that HOLDS a FOR UPDATE row lock until released — real readiness handshake
function openLockSession(){
  const child = spawn(PSQL, pgArgs(['-q','-A','-t']), { env:pgEnv, stdio:['pipe','pipe','pipe'] });
  let buf=''; child.stdout.on('data', d => buf += d); let pid=null;
  return {
    async lock(uid){ child.stdin.write(`begin;\nselect id from auth.users where id='${uid}' for update;\n`);
      for (let i=0;i<50;i++){ if (buf.includes(uid)) return true; await sleep(100); } return false; },  // SELECT returned the id ⇒ row locked
    async lockDevice(deviceId){ child.stdin.write(`begin;\nselect device_id from public.devices where device_id='${deviceId}' for update;\nselect 'PIDIS='||pg_backend_pid();\n`);
      for (let i=0;i<50;i++){ const m=buf.match(/PIDIS=(\d+)/); if (buf.includes(deviceId) && m){ pid=m[1]; return true; } await sleep(100); } return false; },  // simulates a guarded writer holding the device-row lock; captures its backend pid
    pid(){ return pid; },
    release(){ return new Promise(res=>{ child.on('exit', c=>res(c)); child.stdin.write('commit;\n'); child.stdin.end(); }); },
  };
}
const settledFlag = p => { const s={done:false,val:undefined}; p.then(v=>{s.done=true;s.val=v;},()=>{s.done=true;}); return s; };
// drop ONLY objects this run created, in REVERSE creation order (trigger before its function). Used by both
// the inline teardown and finally so a create-time race can never drop a pre-existing/colliding object.
function dropCreatedObjects(){ const errs=[];
  for (const o of [...madeObjects].reverse()) { const e = o.kind==='tg' ? sqlTry(`drop trigger if exists ${o.name} on public.scores;`) : sqlTry(`drop function if exists public.${o.name}();`); if (e) errs.push(`drop ${o.kind} ${o.name}: ${e}`); }
  return errs; }

const fails=[], notes=[]; const ok=(c,m)=>{ if(c)notes.push('✓ '+m); else fails.push(m); };

async function main(){
  // ---- 6/8. live catalog: SECURITY DEFINER, exact search_path="", fn grants, full table privilege set ----
  const sp = fn => sql(`select coalesce((select c from unnest(proconfig) c where c like 'search_path=%'),'') from pg_proc where oid='public.${fn}'::regprocedure`);
  const hasFn = (role,fn) => sql(`select has_function_privilege('${role}','public.${fn}','EXECUTE')`);
  for (const fn of ['erase_account()','finalize_erasure(uuid)','purge_stale_tombstones()','claim_device(text,text)']) {
    ok(sql(`select prosecdef from pg_proc where oid='public.${fn}'::regprocedure`)==='t', `${fn} SECURITY DEFINER`);
    ok(sp(fn)==='search_path=""', `${fn} search_path exactly empty (${JSON.stringify(sp(fn))})`);
  }
  ok(hasFn('authenticated','erase_account()')==='t' && hasFn('service_role','erase_account()')==='f' && hasFn('anon','erase_account()')==='f', 'erase_account authenticated-only');
  ok(hasFn('authenticated','claim_device(text,text)')==='t' && hasFn('service_role','claim_device(text,text)')==='f' && hasFn('anon','claim_device(text,text)')==='f', 'claim_device authenticated-only (updated)');
  ok(hasFn('service_role','finalize_erasure(uuid)')==='t' && hasFn('authenticated','finalize_erasure(uuid)')==='f' && hasFn('anon','finalize_erasure(uuid)')==='f', 'finalize_erasure service-only');
  ok(hasFn('service_role','purge_stale_tombstones()')==='t' && hasFn('authenticated','purge_stale_tombstones()')==='f', 'purge_stale_tombstones service-only');
  ok(sql("select relrowsecurity from pg_class where oid='public.account_tombstones'::regclass")==='t', 'account_tombstones RLS enabled');
  const PRIVS = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  for (const role of ['anon','authenticated']) for (const p of PRIVS)
    ok(sql(`select has_table_privilege('${role}','public.account_tombstones','${p}')`)==='f', `${role} no ${p} on account_tombstones`);
  ok(sql("select has_table_privilege('service_role','public.account_tombstones','SELECT')")==='t', 'service_role SELECT on account_tombstones');
  for (const p of PRIVS.filter(x=>x!=='SELECT'))
    ok(sql(`select has_table_privilege('service_role','public.account_tombstones','${p}')`)==='f', `service_role no ${p} on account_tombstones`);

  // ---- seed A (registered), B (registered, full rows), B-owned contaminated device, A legacy profile-only ----
  const A=await mkUser('a'), B=await mkUser('b');
  const dA=dev('a'), dB=dev('b'), dContam=dev('c'), dLegacy=dev('l'); [dA,dB,dContam,dLegacy].forEach(d=>madeDevices.add(d));
  seed(`insert into public.devices(device_id,capability_hash,user_id) values ('${dA}','${rnd()}','${A.uid}'),('${dB}','${rnd()}','${B.uid}'),('${dContam}','${rnd()}','${B.uid}')`);
  seed(`insert into public.profiles(device_id,user_id,name) values ('${dA}','${A.uid}','A'),('${dB}','${B.uid}','B'),('${dContam}','${A.uid}','contam'),('${dLegacy}','${A.uid}','legacy')`);
  seed(`insert into public.scores(device_id,date,tier,total) values ('${dA}','2026-08-01','easy',100),('${dB}','2026-08-01','easy',50),('${dContam}','2026-08-01','easy',77),('${dLegacy}','2026-08-01','easy',88)`);
  seed(`insert into public.saves(device_id,work_id) values ('${dA}','w'),('${dB}','w'),('${dLegacy}','w')`);
  seed(`insert into public.events(device_id,event) values ('${dA}','x'),('${dB}','x'),('${dLegacy}','x')`);
  seed(`insert into public.user_state(user_id,streak) values ('${A.uid}','{}'),('${B.uid}','{}')`);

  // ---- erase A ----
  let r=await rpcUser('erase_account',{},A.token); let j=await scalar(r);
  ok(r.status===200 && j && j.ok===true, 'erase_account(A) → 200 ok');
  ok(cnt('scores','device_id',dA)===0 && cnt('saves','device_id',dA)===0 && cnt('events','device_id',dA)===0 && cnt('profiles','device_id',dA)===0 && cnt('devices','user_id',A.uid)===0 && cnt('user_state','user_id',A.uid)===0, 'A registered rows across ALL tables erased');
  // 7. account B fully untouched (every table + device binding)
  ok(cnt('scores','device_id',dB)===1 && cnt('saves','device_id',dB)===1 && cnt('events','device_id',dB)===1 && cnt('profiles','device_id',dB)===1 && cnt('devices','device_id',dB)===1 && cnt('user_state','user_id',B.uid)===1, 'account B untouched across all tables + binding');
  // 5. B-owned device with contaminated profiles.user_id=A: binding + all rows survive
  ok(cnt('devices','device_id',dContam)===1 && sql(`select user_id from public.devices where device_id='${dContam}'`)===B.uid && cnt('scores','device_id',dContam)===1 && cnt('profiles','device_id',dContam)===1, 'B-owned contaminated device fully preserved');
  ok(cnt('profiles','device_id',dLegacy)===1 && cnt('saves','device_id',dLegacy)===1 && cnt('events','device_id',dLegacy)===1, 'legacy profile-only device rows preserved (SEC-4 gap)');
  ok(cnt('account_tombstones','user_id',A.uid)===1, 'tombstone recorded for A');

  r=await rpcUser('erase_account',{},A.token); j=await scalar(r);
  ok(r.status===200 && j && j.ok===true && j.counts && Object.values(j.counts).every(n=>n===0), 'idempotent re-erase (auth user exists) → 200 ok, counts all 0');
  ok(await scalar(await rpcUser('claim_device',{p_device_id:dev('n'),p_capability_hash:rnd()},A.token))==='erased', 'tombstoned account → claim_device erased');

  // ---- 2. REAL serialization via a confirmed held lock (fire → confirm blocked → release → assert) ----
  const C=await mkUser('c');
  { const S=openLockSession(); ok(await S.lock(C.uid), 'lock session holds C auth.users row (SELECT FOR UPDATE returned)');
    const p=rpcUser('erase_account',{},C.token); const st=settledFlag(p); await sleep(1200);
    ok(!st.done, 'erase_account BLOCKED while C auth-row lock held'); const code=await S.release(); ok(code===0, 'lock session committed + exited 0');
    const rr=await p; const jj=await scalar(rr); ok(rr.status===200 && jj && jj.ok===true, 'erase_account completes 200 ok after release'); }

  const D=await mkUser('d'); const dD=dev('d'); madeDevices.add(dD); const capD=rnd(); seed(`insert into public.devices(device_id,capability_hash) values ('${dD}','${capD}')`);
  { const S=openLockSession(); ok(await S.lock(D.uid), 'lock session holds D auth.users row');
    const p=rpcUser('claim_device',{p_device_id:dD,p_capability_hash:capD},D.token); const st=settledFlag(p); await sleep(1200);
    ok(!st.done, 'claim_device BLOCKED while D auth-row lock held'); const code=await S.release(); ok(code===0, 'lock session exited 0');
    const rr=await p; ok(rr.status===200 && await scalar(rr)==='bound', 'claim_device completes → bound after release'); }

  // ---- Finding-1: DEVICE-ROW lock serializes erase (erase-side serialization primitive from
  // db/erase-account-serialize.sql). A writer holding a device-row FOR UPDATE lock blocks erase's pre-sweep
  // device lock; on release erase completes and sweeps the device + its rows. (Fails until that migration is
  // applied — erase must lock devices FOR UPDATE before deleting children.)
  // Live ordering assertion (falsifiable vs the OLD fn): the applied definition must lock devices FOR UPDATE
  // BEFORE the child sweep. Against the pre-migration function this fails.
  { const def=sql(`select pg_get_functiondef('public.erase_account()'::regprocedure)`);
    const lockPos=def.search(/from public\.devices where user_id = v_uid for update/i);
    const sweepPos=def.search(/delete from public\.saves/i);
    ok(lockPos>-1 && sweepPos>-1 && lockPos<sweepPos, 'live erase_account def: device FOR UPDATE precedes the child sweep'); }
  const SRu=await mkUser('sr'); const dSR=dev('sr'); madeDevices.add(dSR);
  seed(`insert into public.devices(device_id,capability_hash,user_id) values ('${dSR}','${rnd()}','${SRu.uid}')`);
  seed(`insert into public.saves(device_id,work_id) values ('${dSR}','w')`);
  { const S=openLockSession(); ok(await S.lockDevice(dSR), 'lock session holds a device row (FOR UPDATE returned)');
    const holderPid=S.pid(); ok(!!holderPid, 'captured device-lock holder backend pid');
    const p=rpcUser('erase_account',{},SRu.token); const st=settledFlag(p);
    // DETERMINISTIC: poll pg_blocking_pids() until some backend (the erase RPC) is confirmed WAITING on the
    // holder pid. Fail closed on timeout (10s). No fixed sleep — the block is observed, not assumed.
    let waiting=false; for(let i=0;i<100 && !st.done;i++){
      // require the blocked backend to be ACTIVE, waiting on a LOCK, and running an erase_account query — so we
      // confirm the erase RPC specifically, not merely any backend blocked by the holder.
      if (Number(sql(`select count(*) from pg_stat_activity a where '${holderPid}'::int = any(pg_blocking_pids(a.pid)) and a.state='active' and a.wait_event_type='Lock' and a.query ilike '%erase_account%'`)) > 0){ waiting=true; break; }
      await sleep(100); }
    ok(waiting && !st.done, 'erase_account RPC confirmed WAITING on a lock held by the device-lock holder (pg_blocking_pids + active/Lock/query), still unsettled');
    // FALSIFIABLE: with the pre-sweep device lock, erase blocks BEFORE any child delete, so the seeded save row
    // is still lockable by a THIRD txn. Against the OLD fn, erase would have already locked+deleted the save
    // (the DELETE runs before the device-delete that blocks), so this NOWAIT probe would fail.
    ok(!sqlTry(`select work_id from public.saves where device_id='${dSR}' for update nowait`), 'seeded child save still lockable while erase blocked (pre-sweep lock proven; fails vs old erase)');
    const code=await S.release(); ok(code===0, 'device lock session committed + exited 0');
    const rr=await p; const jj=await scalar(rr); ok(rr.status===200 && jj && jj.ok===true, 'erase_account completes 200 ok after device-lock release');
    ok(cnt('devices','device_id',dSR)===0 && cnt('saves','device_id',dSR)===0, 'device + its saves swept after serialized erase'); }

  // concurrent erase+claim: exact allowed outcomes + no device left bound
  const E=await mkUser('e'); const dE=dev('e'); madeDevices.add(dE); const capE=rnd(); seed(`insert into public.devices(device_id,capability_hash) values ('${dE}','${capE}')`);
  { const [er,cr]=await Promise.all([rpcUser('erase_account',{},E.token), rpcUser('claim_device',{p_device_id:dE,p_capability_hash:capE},E.token)]);
    const ej=await scalar(er), cj=await scalar(cr);
    ok(er.status===200 && ej && ej.ok===true, 'concurrent erase → 200 ok');
    ok(cr.status===200 && ['erased','bound','already_bound_same_user'].includes(cj), `concurrent claim → allowed outcome (${cj})`);
    ok(Number(sql(`select count(*) from public.devices where user_id='${E.uid}'`))===0, 'no device bound to the erased account'); }

  // ---- 4/6. finalize + purge exact assertions ----
  seed(`insert into public.account_tombstones(user_id) values ('${B.uid}') on conflict do nothing`); madeTombstones.add(B.uid);
  { const fr=await rpcSvc('finalize_erasure',{p_user_id:B.uid}); ok(fr.status===200 && await scalar(fr)===false && cnt('account_tombstones','user_id',B.uid)===1, 'finalize_erasure(live user) → 200 false, tombstone retained'); }
  sqlTry(`delete from public.account_tombstones where user_id='${B.uid}'`); madeTombstones.delete(B.uid);
  const orphan=sql('select gen_random_uuid()'); seed(`insert into public.account_tombstones(user_id) values ('${orphan}')`); madeTombstones.add(orphan);
  { const pr=await rpcSvc('purge_stale_tombstones',{}); const pj=await scalar(pr); const gone=cnt('account_tombstones','user_id',orphan)===0;
    ok(pr.status===200 && Number(pj)>=1 && gone, `purge → 200, count ${pj} incl. orphan, orphan removed`);
    if (gone) madeTombstones.delete(orphan); } // keep tracked for cleanup unless independently confirmed gone

  // ---- auth deletion + ACTUAL second-delete contract (fail on 5xx) ----
  const d1=await delUser(A.uid); ok(d1.ok, `auth delete A → ${d1.status}`);
  const d2=await delUser(A.uid); ok(d2.status < 500, `second auth-delete of A must not be a server error (got ${d2.status})`); notes.push(`ℹ second auth-delete contract: status ${d2.status}`);
  ok(await scalar(await rpcUser('claim_device',{p_device_id:dev('m'),p_capability_hash:rnd()},A.token))==='no_user', 'post-deletion claim (valid JWT) → no_user');
  { const fr=await rpcSvc('finalize_erasure',{p_user_id:A.uid}); ok(fr.status===200 && await scalar(fr)===true && cnt('account_tombstones','user_id',A.uid)===0, 'finalize_erasure(deleted user) → 200 true, tombstone removed'); }

  notes.push(`ℹ legacy-gap metric: ${sql("select count(*) from public.profiles p where p.user_id is not null and not exists (select 1 from public.devices d where d.device_id=p.device_id and d.user_id=p.user_id)")} profile rows bound without an authoritative devices row (SEC-4 partial while > 0)`);

  // ---- 1/3/4. rollback injection (opt-in): seed ALL tables, per-run probe, verify complete rollback ----
  if (process.env.ERASE_ROLLBACK_TEST==='1'){
    const F=await mkUser('f'); const dF=dev('f'); madeDevices.add(dF);
    const fn=`__erase_probe_${RUN}`, tg=`__erase_probe_tg_${RUN}`;
    seed(`insert into public.devices(device_id,capability_hash,user_id) values ('${dF}','${rnd()}','${F.uid}')`);
    seed(`insert into public.profiles(device_id,user_id,name) values ('${dF}','${F.uid}','F')`);
    seed(`insert into public.scores(device_id,date,tier,total) values ('${dF}','2026-08-03','easy',9)`);
    seed(`insert into public.saves(device_id,work_id) values ('${dF}','w')`);
    seed(`insert into public.events(device_id,event) values ('${dF}','x')`);
    seed(`insert into public.user_state(user_id,streak) values ('${F.uid}','{}')`);
    // preflight BOTH names before creating either; abort on ANY pre-existing object so cleanup never drops one we didn't make
    if (sql(`select count(*) from pg_proc where proname='${fn}'`) !== '0' || sql(`select count(*) from pg_trigger where tgname='${tg}'`) !== '0') { fails.push('rollback probe name collision — aborting injection (pre-existing object)'); }
    else {
      const e1=sqlTry(`create function public.${fn}() returns trigger language plpgsql as $fn$ begin if old.device_id='${dF}' then raise exception 'rollback probe'; end if; return old; end $fn$;`);
      if (!e1) madeObjects.push({ kind:'fn', name:fn });   // track ONLY objects this run created
      const e2=e1 || sqlTry(`create trigger ${tg} before delete on public.scores for each row execute function public.${fn}();`);
      if (!e1 && !e2) madeObjects.push({ kind:'tg', name:tg });
      if (e2) { fails.push('rollback injection install failed (fail-closed): ' + e2); }
      else {
        const rr=await scalar(await rpcUser('erase_account',{},F.token));
        const allPresent = cnt('devices','user_id',F.uid)===1 && cnt('profiles','device_id',dF)===1 && cnt('scores','device_id',dF)===1 && cnt('saves','device_id',dF)===1 && cnt('events','device_id',dF)===1 && cnt('user_state','user_id',F.uid)===1;
        ok(rr && rr.ok===false && allPresent, 'rollback: erase_account → ok:false and EVERY table rolled back');
        ok(cnt('account_tombstones','user_id',F.uid)===0, 'rollback: no tombstone left');
        ok(sql(`select count(*) from auth.users where id='${F.uid}'`)==='1', 'rollback: auth user remains');
      }
      for (const e of dropCreatedObjects()) fails.push('probe teardown: ' + e);   // drops only tracked, trigger→function
      ok(sql(`select count(*) from pg_trigger where tgname='${tg}'`)==='0' && sql(`select count(*) from pg_proc where proname='${fn}'`)==='0', 'rollback probe trigger + function verified absent');
    }
  } else notes.push('ℹ rollback injection skipped (ERASE_ROLLBACK_TEST=1 + separate approval to run it)');
}

try { await main(); }
catch(e){ fails.push('crashed: '+(e&&e.stack||e)); }
finally {
  for (const d of madeDevices) for (const t of ['events','saves','scores','profiles','devices']) { const e=sqlTry(`delete from public.${t} where device_id='${d}'`); if(e) fails.push(`cleanup ${t} ${d}: ${e}`); }
  for (const u of madeUsers) { const e=sqlTry(`delete from public.user_state where user_id='${u}'`); if(e) fails.push(`cleanup user_state ${u}: ${e}`); }
  for (const u of [...madeUsers, ...madeTombstones]) { const e=sqlTry(`delete from public.account_tombstones where user_id='${u}'`); if(e) fails.push(`cleanup tombstone ${u}: ${e}`); }
  for (const e of dropCreatedObjects()) fails.push('cleanup ' + e);   // same helper: only tracked objects, trigger→function
  for (const u of madeUsers) { try { const rr=await delUser(u); if(!rr.ok && rr.status!==404) fails.push(`cleanup auth user ${u} → ${rr.status}`); } catch(e){ fails.push(`cleanup auth user ${u}: ${e.message}`); } }
  // read-only zero-leak verification (no destructive probing)
  try {
    if (Number(sql(`select count(*) from public.devices where device_id like 'dv${RUN}%'`))>0) fails.push('LEAK: test devices remain');
    if (Number(sql(`select (select count(*) from public.scores where device_id like 'dv${RUN}%')+(select count(*) from public.saves where device_id like 'dv${RUN}%')+(select count(*) from public.events where device_id like 'dv${RUN}%')+(select count(*) from public.profiles where device_id like 'dv${RUN}%')`))>0) fails.push('LEAK: test public rows remain');
    const ids=[...new Set([...madeUsers, ...madeTombstones])];
    if (ids.length && Number(sql(`select count(*) from public.account_tombstones where user_id in (${ids.map(u=>`'${u}'`).join(',')})`))>0) fails.push('LEAK: test tombstones remain');
    if (madeUsers.size && Number(sql(`select count(*) from auth.users where id in (${[...madeUsers].map(u=>`'${u}'`).join(',')})`))>0) fails.push('LEAK: test auth users remain (read-only catalog count)');
    for (const o of madeObjects) { if (o.kind==='tg' && sql(`select count(*) from pg_trigger where tgname='${o.name}'`)!=='0') fails.push(`LEAK: probe trigger ${o.name}`); if (o.kind==='fn' && sql(`select count(*) from pg_proc where proname='${o.name}'`)!=='0') fails.push(`LEAK: probe fn ${o.name}`); }
  } catch(e){ fails.push('leftover check failed: '+e.message); }
}

for(const n of notes) console.log('  '+n);
if(fails.length){ console.error(`\n❌ db:verify-erase FAIL (${fails.length}):`); fails.forEach(f=>console.error('  - '+f)); process.exit(1); }
console.log(`\n✅ db:verify-erase PASS — ${notes.filter(n=>n.startsWith('✓')).length} assertions (catalog/grants+TRUNCATE/REFERENCES/TRIGGER, transactional erasure, authority, contaminated-B + full-B + legacy preservation, idempotency, confirmed-lock serialization, concurrent no-bind, finalize/purge true-positives, second-delete contract, rollback${process.env.ERASE_ROLLBACK_TEST==='1'?' all-tables injected':' skipped'}; read-only zero-leak verified)`);
