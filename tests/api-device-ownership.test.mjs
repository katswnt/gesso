// PR 3 device-ownership authorization tests — network-free, in test:ci.
// Drives the REAL api/* handlers with mock req/res and a single stubbed globalThis.fetch over an in-memory
// Supabase model (the one network boundary, via server/api/supabaseAdmin.js). Proves the CAP_MODE state machine
// and the hostile matrix. Each case asserts the fixed behavior; the pre-fix handlers would fail these.
//   node tests/api-device-ownership.test.mjs
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

process.env.SUPABASE_SECRET_KEY = 'test-secret';
const URL_ = 'https://jmrpqmejupouqfergyyg.supabase.co';
const ANON = 'sb_publishable_ZUSDLvzDYbD222i_ycdezQ_j7IB7Xp_';
const sha = s => createHash('sha256').update(String(s)).digest('hex');

// ---- in-memory model -----------------------------------------------------------------------------
let DB;
function reset() {
  DB = { devices: new Map(), profiles: new Map(), saves: [], scores: [], events: [], user_state: new Map(),
         tokens: new Map(/* accessToken -> uid */), deletedUsers: [], tombstones: new Set(),
         failDevicesGet: false, eraseFail: null, authDeleteStatus: 200, finalizeStatus: 200, finalizeForce: undefined };
}
const R = (status, data, headers) => ({ ok: status < 400, status,
  json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  headers: { get: k => (headers && headers[k.toLowerCase()]) || null } });

function eqParam(sp, col) { const v = sp.get(col); return v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; }
function inParam(sp, col) { const v = sp.get(col); if (!v || !v.startsWith('in.(')) return null; return v.slice(4, -1).split(',').map(decodeURIComponent); }

// register_device / claim_device emulate db/devices.sql exactly.
function register_device(p_device_id, p_capability_hash) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p_device_id || '')) return 'bad_device';
  if (!/^[0-9a-f]{64}$/.test(p_capability_hash || '')) return 'bad_capability';
  const row = DB.devices.get(p_device_id);
  if (row) { if (row.revoked_at) return 'revoked'; return row.capability_hash === p_capability_hash ? 'ok' : 'bad_capability'; }
  for (const r of DB.devices.values()) if (r.capability_hash === p_capability_hash) return 'hash_in_use';
  DB.devices.set(p_device_id, { device_id: p_device_id, capability_hash: p_capability_hash, user_id: null, revoked_at: null });
  return 'ok';
}
function claim_device(uid, p_device_id, p_capability_hash) {
  if (!uid) return 'no_auth';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p_device_id || '')) return 'bad_device';
  if (!/^[0-9a-f]{64}$/.test(p_capability_hash || '')) return 'bad_capability';
  // SQL order: lock auth.users FOR UPDATE (absent → no_user), then reject tombstoned accounts (erased)
  if (userGone(uid)) return 'no_user';
  if (DB.tombstones.has(uid)) return 'erased';
  const row = DB.devices.get(p_device_id);
  if (!row) return 'unregistered';
  if (row.revoked_at) return 'revoked';
  if (row.capability_hash !== p_capability_hash) return 'bad_capability';
  if (row.user_id == null) { row.user_id = uid; return 'bound'; }
  return row.user_id === uid ? 'already_bound_same_user' : 'conflict_other_user';
}
// erase_account / finalize_erasure emulate db/erase-account.sql. deletedUsers models auth.users absence.
const userGone = uid => DB.deletedUsers.includes(uid);
function erase_account(uid) {
  if (!uid) return { ok: false, error: 'no_auth' };
  if (DB.eraseFail) return { ok: false, error: DB.eraseFail };        // simulated in-DB failure (rolled back → no tombstone)
  if (userGone(uid)) return { ok: false, error: 'no_user' };          // auth row already gone (stale-JWT replay)
  DB.tombstones.add(uid);                                             // transient marker (blocks rebind until finalize)
  const devs = [...DB.devices.values()].filter(r => r.user_id === uid).map(r => r.device_id);  // authority: devices.user_id only
  const c = { events: 0, saves: 0, scores: 0, profiles: 0, user_state: 0, devices: 0 };
  DB.events = DB.events.filter(e => { const h = devs.includes(e.device_id); if (h) c.events++; return !h; });
  DB.saves  = DB.saves.filter(s => { const h = devs.includes(s.device_id); if (h) c.saves++; return !h; });
  DB.scores = DB.scores.filter(s => { const h = devs.includes(s.device_id); if (h) c.scores++; return !h; });
  for (const d of devs) { if (DB.profiles.delete(d)) c.profiles++; }   // profiles by device_id, NOT profiles.user_id
  if (DB.user_state.delete(uid)) c.user_state++;
  for (const [k, r] of DB.devices) { if (r.user_id === uid) { DB.devices.delete(k); c.devices++; } }
  return { ok: true, counts: c };
}
function finalize_erasure(uid) { if (!uid || !userGone(uid)) return false; DB.tombstones.delete(uid); return true; }  // only after auth user truly gone

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const p = u.pathname; const sp = u.searchParams; const m = (opts.method || 'GET').toUpperCase();
  const hdr = opts.headers || {}; const body = opts.body ? JSON.parse(opts.body) : {};
  DB.lastHeaders = hdr; DB.lastUrl = url; (DB.reqs || (DB.reqs = [])).push({ path: p, headers: hdr });
  // auth: verify user
  if (p === '/auth/v1/user') { const t = (hdr.Authorization || '').replace('Bearer ', ''); const uid = DB.tokens.get(t); return uid ? R(200, { id: uid }) : R(401, {}); }
  if (p.startsWith('/auth/v1/admin/users/')) { if (m === 'DELETE') { const id = p.split('/').pop(); const st = DB.authDeleteStatus; if (st < 400 || st === 404) DB.deletedUsers.push(id); return R(st, {}); } }
  // RPC
  if (p === '/rest/v1/rpc/register_device') return R(200, register_device(body.p_device_id, body.p_capability_hash));
  if (p === '/rest/v1/rpc/claim_device') { const t = (hdr.Authorization || '').replace('Bearer ', ''); const uid = DB.tokens.get(t) || null; return R(200, claim_device(uid, body.p_device_id, body.p_capability_hash)); }
  if (p === '/rest/v1/rpc/erase_account') { const t = (hdr.Authorization || '').replace('Bearer ', ''); const uid = DB.tokens.get(t) || null; return R(200, erase_account(uid)); }  // under USER JWT
  if (p === '/rest/v1/rpc/finalize_erasure') { const st = DB.finalizeStatus || 200;
    if (st >= 400) return R(st, {});   // transport/non-2xx: the function did not complete → NO side effect (tombstone untouched)
    const val = DB.finalizeForce !== undefined ? DB.finalizeForce : finalize_erasure(body.p_user_id); return R(st, val); }   // service role
  // devices
  if (p === '/rest/v1/devices') {
    if (DB.failDevicesGet && m === 'GET') return R(502, {});
    if (m === 'GET') {
      const byDev = eqParam(sp, 'device_id'); if (byDev) { const row = DB.devices.get(byDev); return R(200, row ? [row] : []); }
      const byUser = eqParam(sp, 'user_id'); if (byUser != null) return R(200, [...DB.devices.values()].filter(r => r.user_id === byUser).map(r => ({ device_id: r.device_id })));
      return R(200, []);
    }
    if (m === 'DELETE') { const byUser = eqParam(sp, 'user_id'); for (const [k, r] of DB.devices) if (r.user_id === byUser) DB.devices.delete(k); return R(200, {}); }
  }
  // profiles
  if (p === '/rest/v1/profiles') {
    if (m === 'POST') { const d = body.device_id; const cur = DB.profiles.get(d) || { device_id: d }; DB.profiles.set(d, { ...cur, ...body }); return R(201, {}); }
    if (m === 'GET') {
      const byDev = eqParam(sp, 'device_id'); if (byDev) { const r = DB.profiles.get(byDev); return R(200, r ? [r] : []); }
      const byUser = eqParam(sp, 'user_id'); if (byUser != null) return R(200, [...DB.profiles.values()].filter(r => r.user_id === byUser));
      const nameIlike = sp.get('name'); if (nameIlike) { const nm = decodeURIComponent(nameIlike.replace('ilike.', '')).toLowerCase(); return R(200, [...DB.profiles.values()].filter(r => (r.name || '').toLowerCase() === nm && r.user_id)); }
      return R(200, []);
    }
    if (m === 'DELETE') { const byDev = eqParam(sp, 'device_id'); if (byDev) DB.profiles.delete(byDev); return R(200, {}); }
  }
  // saves
  if (p === '/rest/v1/saves') {
    if (m === 'GET') {
      const range = (hdr.Prefer || '').includes('count=exact');
      const byDev = eqParam(sp, 'device_id'); const devs = inParam(sp, 'device_id') || (byDev ? [byDev] : []);
      const rows = DB.saves.filter(s => devs.includes(s.device_id));
      if (range) return R(200, [], { 'content-range': `0-0/${rows.length}` });
      return R(200, rows.map(s => ({ work_id: s.work_id })));
    }
    if (m === 'POST') { if (!DB.saves.find(s => s.device_id === body.device_id && s.work_id === body.work_id)) DB.saves.push({ ...body }); return R(201, {}); }
    if (m === 'DELETE') { const byDev = eqParam(sp, 'device_id'); const inDev = inParam(sp, 'device_id'); const w = eqParam(sp, 'work_id');
      DB.saves = DB.saves.filter(s => { const hit = byDev ? s.device_id === byDev : (inDev ? inDev.includes(s.device_id) : false); if (!hit) return true; return w ? s.work_id !== w : false; }); return R(200, {}); }
  }
  // scores
  if (p === '/rest/v1/scores') {
    if (m === 'GET') { const byDev = eqParam(sp, 'device_id'); const rows = DB.scores.filter(s => !byDev || s.device_id === byDev); return R(200, rows.map(s => ({ device_id: s.device_id, total: s.total }))); }
    if (m === 'POST') { DB.scores.push({ ...body }); return R(201, {}); }
    if (m === 'DELETE') { const byDev = eqParam(sp, 'device_id'); DB.scores = DB.scores.filter(s => s.device_id !== byDev); return R(200, {}); }
  }
  // user_state
  if (p === '/rest/v1/user_state') {
    if (m === 'GET') { const uid = eqParam(sp, 'user_id'); const r = DB.user_state.get(uid); return R(200, r ? [r] : []); }
    if (m === 'POST') { DB.user_state.set(body.user_id, { ...(DB.user_state.get(body.user_id) || {}), ...body }); return R(201, {}); }
    if (m === 'DELETE') { const uid = eqParam(sp, 'user_id'); DB.user_state.delete(uid); return R(200, {}); }
  }
  return R(404, {});
};

const mkReq = (o = {}) => ({ method: o.method || 'POST', headers: { origin: 'https://gesso.katswint.com', ...(o.cap ? { 'x-gesso-cap': o.cap } : {}), ...(o.headers || {}) }, body: o.body || {}, query: o.query || {} });
function mkRes() { const r = { _s: 0, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; } }; return r; }
async function call(handler, reqOpts) { const res = mkRes(); await handler(mkReq(reqOpts), res); return res; }

// dynamic import AFTER fetch is stubbed
const claim = (await import('../api/claim.js')).default;
const sync = (await import('../api/sync.js')).default;
const saves = (await import('../api/saves.js')).default;
const score = (await import('../api/score.js')).default;
const del = (await import('../api/delete-account.js')).default;
const register = (await import('../api/register-device.js')).default;
const profile = (await import('../api/profile.js')).default;
const { capMode, claimResultToHttp } = await import('../server/api/device-ownership.js');
const { svcHeaders, admin: mkAdmin, userRpc: uRpc } = await import('../server/api/supabaseAdmin.js');

// helpers to seed
const RAW = tag => (tag + 'A'.repeat(43)).slice(0, 43);          // 43-char base64url-ish raw cap
function seedDevice(dev, rawCap, uid = null, revoked = false) { DB.devices.set(dev, { device_id: dev, capability_hash: sha(rawCap), user_id: uid, revoked_at: revoked ? 'now' : null }); }
function seedUser(tok, uid) { DB.tokens.set(tok, uid); }

let pass = 0; const ok = (c, m) => { if (c) pass++; else { console.error('  ✗ ' + m); throw new Error('assertion failed: ' + m); } };

// =================================================================================================
async function main() {
  // ---- OBSERVE mode ----
  process.env.CAP_MODE = 'observe';

  // 1. hostile-device claim: B claims a device already bound to A → 409, binding unchanged
  reset(); seedUser('tokB', 'userB'); const rawA = RAW('a'); seedDevice('deviceAAAA', rawA, 'userA');
  let r = await call(claim, { cap: rawA, body: { deviceId: 'deviceAAAA', accessToken: 'tokB' } });
  ok(r._s === 409, 'hostile claim → 409'); ok(DB.devices.get('deviceAAAA').user_id === 'userA', 'binding unchanged after hostile claim');

  // 2. hostile-device sync: B syncs A's device → 409, no state merge
  reset(); seedUser('tokB', 'userB'); seedDevice('deviceAAAA', rawA, 'userA');
  r = await call(sync, { cap: rawA, body: { deviceId: 'deviceAAAA', accessToken: 'tokB', streak: { current: 9 } } });
  ok(r._s === 409, 'hostile sync → 409'); ok(!DB.user_state.get('userB'), 'no merge onto foreign device');

  // 3. wrong cap rejected EVEN IN OBSERVE (saves)
  reset(); const rawR = RAW('r'); seedDevice('deviceRRRR', rawR);
  r = await call(saves, { method: 'POST', cap: RAW('x'), body: { deviceId: 'deviceRRRR', workId: 'w1' } });
  ok(r._s === 401, 'wrong cap → 401 even in observe');

  // 4. malformed cap rejected (both modes)
  reset(); seedDevice('deviceRRRR', rawR);
  r = await call(saves, { method: 'POST', cap: 'tooshort', body: { deviceId: 'deviceRRRR', workId: 'w1' } });
  ok(r._s === 400, 'malformed cap → 400');

  // 5. missing cap grandfathered ONLY in observe (saves POST succeeds)
  reset();
  r = await call(saves, { method: 'POST', body: { deviceId: 'legacydevice1', workId: 'w1' } });
  ok(r._s === 200, 'missing cap grandfathered in observe');

  // 6. unregistered-with-cap rejected in both modes
  reset();
  r = await call(saves, { method: 'POST', cap: RAW('u'), body: { deviceId: 'unregdevice1', workId: 'w1' } });
  ok(r._s === 401, 'unregistered device with cap → 401');

  // 7. revoked device rejected
  reset(); const rawV = RAW('v'); seedDevice('deviceVVVV', rawV, null, true);
  r = await call(saves, { method: 'POST', cap: rawV, body: { deviceId: 'deviceVVVV', workId: 'w1' } });
  ok(r._s === 403, 'revoked device → 403');

  // 8. replay a cap for a DIFFERENT device → hash_in_use → 409 (register-device)
  reset(); const rawS = RAW('s'); seedDevice('deviceSSSS', rawS);
  r = await call(register, { cap: rawS, body: { deviceId: 'otherdevice1' } });
  ok(r._s === 409, 'reused cap for another device → 409');

  // 9. valid register + valid claim
  reset(); seedUser('tokA', 'userA'); const rawN = RAW('n');
  r = await call(register, { cap: rawN, body: { deviceId: 'devicenew01' } });
  ok(r._s === 200, 'register new device → 200');
  r = await call(claim, { cap: rawN, body: { deviceId: 'devicenew01', accessToken: 'tokA' } });
  ok(r._s === 200, 'valid claim → 200'); ok(DB.devices.get('devicenew01').user_id === 'userA', 'device bound to userA');
  r = await call(claim, { cap: rawN, body: { deviceId: 'devicenew01', accessToken: 'tokA' } });
  ok(r._s === 200, 'same-user re-claim idempotent → 200');

  // 10. cross-user saves READ: reading A's gallery without A's cap → denied
  reset(); seedDevice('deviceAAAA', rawA, 'userA');
  r = await call(saves, { method: 'GET', query: { me: 'deviceAAAA' }, cap: RAW('z') });
  ok(r._s === 401, 'cross-user saves read (wrong cap) → 401');

  // 11. foreign-device delete: B passes A's deviceId in the body, but authority is the JWT only → A untouched
  reset(); seedUser('tokB', 'userB'); seedDevice('deviceBBBB', RAW('b'), 'userB');
  seedDevice('deviceAAAA', rawA, 'userA'); DB.scores.push({ device_id: 'deviceAAAA', total: 100 }); DB.profiles.set('deviceAAAA', { device_id: 'deviceAAAA', user_id: 'userA' });
  r = await call(del, { body: { deviceId: 'deviceAAAA', accessToken: 'tokB' } });   // hostile body deviceId — must be ignored
  ok(r._s === 200, 'delete-account → 200');
  ok(DB.scores.find(s => s.device_id === 'deviceAAAA'), "foreign device's scores untouched (body deviceId ignored)");
  ok(DB.profiles.get('deviceAAAA'), "foreign device's profile untouched");
  ok(DB.devices.get('deviceAAAA'), "foreign device binding untouched");
  ok(!DB.devices.get('deviceBBBB'), "own device binding removed");

  // ---- ENFORCE mode ----
  process.env.CAP_MODE = 'enforce';

  // 12. bare-deviceId score write rejected in enforce
  reset();
  r = await call(score, { body: { deviceId: 'legacydevice1', date: '2026-08-01', tier: 'easy', total: 5000 } });
  ok(r._s === 401, 'bare-deviceId score in enforce → 401');

  // 13. missing cap on saves rejected in enforce
  reset();
  r = await call(saves, { method: 'POST', body: { deviceId: 'legacydevice1', workId: 'w1' } });
  ok(r._s === 401, 'missing cap saves in enforce → 401');

  // 14. valid cap score write allowed in enforce
  reset(); const rawG = RAW('g'); seedDevice('devicegood1', rawG);
  r = await call(score, { cap: rawG, body: { deviceId: 'devicegood1', date: '2026-08-01', tier: 'easy', total: 5000 } });
  ok(r._s === 200, 'valid-cap score in enforce → 200');

  // ---- profile.js (was untested) ----
  process.env.CAP_MODE = 'observe';
  const rawP = RAW('p');
  reset(); seedDevice('devicePPPP', rawP);
  r = await call(profile, { cap: rawP, body: { deviceId: 'devicePPPP', name: 'Alice', color: '#123456' } });
  ok(r._s === 200, 'profile valid cap → 200');
  reset(); seedDevice('devicePPPP', rawP);
  r = await call(profile, { cap: RAW('q'), body: { deviceId: 'devicePPPP', name: 'Alice' } });
  ok(r._s === 401, 'profile wrong cap → 401 (even in observe)');
  // authority proof: device bound to userY in devices, but a CONTAMINATED profiles.user_id=userX; the reserved
  // name is held by userX. Correct code treats the caller as userY (≠userX) → reserved → reject. The PRE-FIX
  // code (reading profiles.user_id=userX == claimant userX) would have ALLOWED it. So this reproduces the bug.
  reset(); seedDevice('devicePPPP', rawP, 'userY');
  DB.profiles.set('devicePPPP', { device_id: 'devicePPPP', user_id: 'userX' });                 // contaminated projection
  DB.profiles.set('otherdev', { device_id: 'otherdev', user_id: 'userX', name: 'Taken' });        // claimant = userX
  r = await call(profile, { cap: rawP, body: { deviceId: 'devicePPPP', name: 'Taken' } });
  ok(r._s === 409, 'profile: caller = devices.user_id(userY), not profiles(userX) → name reserved by userX → 409');
  // score equivalent: reserved name must be dropped (written empty) for the same contaminated setup
  reset(); seedDevice('devicePPPP', rawP, 'userY');
  DB.profiles.set('devicePPPP', { device_id: 'devicePPPP', user_id: 'userX' });
  DB.profiles.set('otherdev', { device_id: 'otherdev', user_id: 'userX', name: 'Taken' });
  r = await call(score, { cap: rawP, body: { deviceId: 'devicePPPP', date: '2026-08-01', tier: 'easy', total: 5000, name: 'Taken' } });
  ok(r._s === 200 && (DB.profiles.get('devicePPPP').name || '') === '', 'score: reserved name dropped (caller=devices.user_id userY ≠ claimant userX)');
  reset();
  r = await call(profile, { body: { deviceId: 'legacydevice1', name: 'Bob' } });
  ok(r._s === 200, 'profile missing cap in observe → 200 (legacy)');

  // ---- delete-account (PR 4B: erase_account RPC under the user JWT; SEC-4 completeness + SEC-5 checked steps) ----
  // happy path: every owned table erased (incl. events), tombstone finalized, auth user gone, counts returned;
  // contaminated profiles.user_id (no devices row) is NOT destructible; a foreign body deviceId is ignored.
  reset(); seedUser('tokB', 'userB'); seedDevice('ownedBBBB', RAW('ob'), 'userB');
  DB.scores.push({ device_id: 'ownedBBBB', total: 50 }); DB.saves.push({ device_id: 'ownedBBBB', work_id: 'w' });
  DB.events.push({ device_id: 'ownedBBBB', event: 'x' }); DB.profiles.set('ownedBBBB', { device_id: 'ownedBBBB', user_id: 'userB' });
  DB.user_state.set('userB', { user_id: 'userB' });
  DB.profiles.set('contamdev1', { device_id: 'contamdev1', user_id: 'userB' }); DB.scores.push({ device_id: 'contamdev1', total: 99 }); // profiles.user_id=userB but NOT in devices.user_id
  r = await call(del, { body: { deviceId: 'contamdev1', accessToken: 'tokB' } });   // even naming contamdev1 must not delete it
  ok(r._s === 200 && r._j && r._j.ok === true, 'delete → 200 { ok:true }');
  ok(r._j.counts && r._j.counts.events === 1 && r._j.counts.saves === 1 && r._j.counts.scores === 1 && r._j.counts.profiles === 1 && r._j.counts.user_state === 1 && r._j.counts.devices === 1, 'per-table counts returned');
  ok(!DB.events.find(e => e.device_id === 'ownedBBBB'), 'owned events removed (SEC-4)');
  ok(!DB.saves.find(s => s.device_id === 'ownedBBBB'), 'owned saves removed');
  ok(!DB.scores.find(s => s.device_id === 'ownedBBBB'), 'owned scores removed');
  ok(!DB.profiles.get('ownedBBBB'), 'owned profile removed');
  ok(!DB.user_state.get('userB'), 'owned user_state removed');
  ok(!DB.devices.get('ownedBBBB'), 'owned device binding removed');
  ok(DB.scores.find(s => s.device_id === 'contamdev1'), 'contaminated-profile device scores NOT removed');
  ok(DB.profiles.get('contamdev1'), 'contaminated profile NOT removed (unauthorized by devices.user_id)');
  ok(DB.deletedUsers.includes('userB'), 'auth user deleted');
  ok(!DB.tombstones.has('userB'), 'tombstone finalized (removed after auth deletion)');
  // erase_account ran under the USER JWT (Bearer=user token), not the service key
  ok((DB.reqs || []).some(q => q.path === '/rest/v1/rpc/erase_account' && (q.headers.Authorization || '') === 'Bearer tokB'), 'erase_account called under the user JWT');

  // finalize scalar false (auth user still present after delete) → 500, client must NOT wipe
  reset(); seedUser('tokF', 'userF'); seedDevice('ownedFFFF', RAW('of'), 'userF'); DB.finalizeForce = false;
  r = await call(del, { body: { accessToken: 'tokF' } });
  ok(r._s === 500, 'finalize scalar false → 500 (deletion incomplete, no client wipe)');
  ok(DB.deletedUsers.includes('userF'), 'auth delete was attempted before finalize');
  ok(DB.tombstones.has('userF'), 'tombstone RETAINED on scalar false (finalize did not remove it)');

  // finalize transport failure (non-2xx) → 200 { cleanupPending:true }, tombstone retained for the cron backstop
  reset(); seedUser('tokP', 'userP'); seedDevice('ownedPPPP', RAW('op'), 'userP'); DB.finalizeStatus = 502;
  r = await call(del, { body: { accessToken: 'tokP' } });
  ok(r._s === 200 && r._j && r._j.ok === true && r._j.cleanupPending === true, 'finalize non-2xx → 200 cleanupPending');
  ok(DB.tombstones.has('userP'), 'tombstone retained on finalize transport failure');

  // finalize malformed body (not a boolean) → 200 cleanupPending (unknown; backstop reconciles)
  reset(); seedUser('tokM', 'userM'); seedDevice('ownedMMMM', RAW('om'), 'userM'); DB.finalizeForce = 'weird';
  r = await call(del, { body: { accessToken: 'tokM' } });
  ok(r._s === 200 && r._j.cleanupPending === true, 'finalize malformed → 200 cleanupPending');

  // finalize true → 200 with NO cleanupPending (clean happy finish)
  reset(); seedUser('tokN', 'userN'); seedDevice('ownedNNNN', RAW('on'), 'userN');
  r = await call(del, { body: { accessToken: 'tokN' } });
  ok(r._s === 200 && r._j.ok === true && !('cleanupPending' in r._j), 'finalize true → 200, no cleanupPending');

  // SEC-5: erase_account in-DB failure → 500, NOTHING deleted, no auth deletion, no tombstone (rolled back)
  reset(); seedUser('tokE', 'userE'); seedDevice('ownedEEEE', RAW('oe'), 'userE'); DB.scores.push({ device_id: 'ownedEEEE', total: 7 }); DB.eraseFail = 'erase_failed';
  r = await call(del, { body: { accessToken: 'tokE' } });
  ok(r._s === 500, 'erase failure → 500');
  ok(DB.scores.find(s => s.device_id === 'ownedEEEE'), 'no rows deleted on erase failure');
  ok(!DB.deletedUsers.includes('userE'), 'auth user NOT deleted on erase failure');
  ok(!DB.tombstones.has('userE'), 'no tombstone left on erase failure');

  // stale JWT for an already-deleted account → erase returns no_user → 401, no second auth deletion
  reset(); seedUser('tokG', 'userG'); DB.deletedUsers.push('userG');
  r = await call(del, { body: { accessToken: 'tokG' } });
  ok(r._s === 401, 'erase no_user (deleted account) → 401');

  // SEC-5: auth-user deletion fails (5xx) → 500, tombstone RETAINED (blocks rebind), finalize not reached
  reset(); seedUser('tokH', 'userH'); seedDevice('ownedHHHH', RAW('oh'), 'userH'); DB.authDeleteStatus = 500;
  r = await call(del, { body: { accessToken: 'tokH' } });
  ok(r._s === 500, 'auth-delete 5xx → 500');
  ok(DB.tombstones.has('userH'), 'tombstone retained when auth deletion fails (rebind stays blocked)');
  ok(!DB.deletedUsers.includes('userH'), 'auth user not marked deleted on 5xx');

  // idempotent retry: auth user already absent (404) → treated as gone → 200 + tombstone finalized
  reset(); seedUser('tokI', 'userI'); seedDevice('ownedIIII', RAW('oi'), 'userI'); DB.authDeleteStatus = 404;
  r = await call(del, { body: { accessToken: 'tokI' } });
  ok(r._s === 200, 'auth-delete 404 (already gone) → 200 (idempotent)');
  ok(!DB.tombstones.has('userI'), 'tombstone finalized on 404 path');

  // invalid JWT → 401 before any RPC/admin call
  reset();
  r = await call(del, { body: { accessToken: 'not-a-token' } });
  ok(r._s === 401, 'invalid JWT → 401');
  ok(!(DB.reqs || []).some(q => q.path === '/rest/v1/rpc/erase_account'), 'no erase_account call on invalid JWT');

  // claimResultToHttp: post-erasure claim_device results (tombstoned / deleted account)
  { const e = claimResultToHttp('erased'); ok(e.ok === false && e.status === 410, "claimResultToHttp('erased') → 410");
    const n = claimResultToHttp('no_user'); ok(n.ok === false && n.status === 401, "claimResultToHttp('no_user') → 401"); }
  // real claim/sync handlers reject a stale JWT for a deleted (no_user→401) or tombstoned (erased→410) account
  { const rawS = RAW('s');
    reset(); seedUser('tokS', 'userS'); seedDevice('deviceSSSS', rawS); DB.deletedUsers.push('userS');
    r = await call(claim, { cap: rawS, body: { deviceId: 'deviceSSSS', accessToken: 'tokS' } });
    ok(r._s === 401, 'claim: deleted account (no_user) → 401');
    r = await call(sync, { cap: rawS, body: { deviceId: 'deviceSSSS', accessToken: 'tokS' } });
    ok(r._s === 401, 'sync: deleted account (no_user) → 401');
    reset(); seedUser('tokT', 'userT'); seedDevice('deviceTTTT', rawS); DB.tombstones.add('userT');
    r = await call(claim, { cap: rawS, body: { deviceId: 'deviceTTTT', accessToken: 'tokT' } });
    ok(r._s === 410, 'claim: tombstoned account (erased) → 410'); }

  // ---- header contract (finding 3): pure helper AND actual admin()/userRpc() requests through the boundary ----
  { const h1 = svcHeaders('eyJhbGci.payload.sig'); ok(h1.apikey === 'eyJhbGci.payload.sig' && h1.Authorization === 'Bearer eyJhbGci.payload.sig', 'svcHeaders legacy JWT → apikey + Bearer');
    const h2 = svcHeaders('sb_secret_abc123'); ok(h2.apikey === 'sb_secret_abc123' && !h2.Authorization, 'svcHeaders modern secret → apikey only, NO Bearer'); }
  { reset();
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_reqtest';
    await mkAdmin().rest('devices?device_id=eq.zzzzzzzz&select=capability_hash');
    ok(DB.lastHeaders.apikey === 'sb_secret_reqtest' && !DB.lastHeaders.Authorization, 'admin() request with sb_secret → apikey only');
    process.env.SUPABASE_SECRET_KEY = 'eyJhbGci.payload.sig';
    await mkAdmin().rpc('register_device', { p_device_id: 'zzzzzzzz', p_capability_hash: 'x' });
    ok(DB.lastHeaders.apikey === 'eyJhbGci.payload.sig' && DB.lastHeaders.Authorization === 'Bearer eyJhbGci.payload.sig', 'admin() request with eyJ → apikey + Bearer');
    await uRpc('claim_device', { p_device_id: 'zzzzzzzz' }, 'usertok123');
    ok(DB.lastHeaders.apikey === ANON && DB.lastHeaders.Authorization === 'Bearer usertok123', 'userRpc() → anon apikey + user JWT bearer');
    process.env.SUPABASE_SECRET_KEY = 'test-secret'; } // restore for any later use

  // ---- CAP_MODE precedence + DEADLINE (Date.now stubbed at the boundary) ----
  process.env.CAP_MODE = 'observe'; ok(capMode() === 'observe', 'CAP_MODE=observe');
  process.env.CAP_MODE = 'enforce'; ok(capMode() === 'enforce', 'CAP_MODE=enforce');
  process.env.CAP_MODE = 'bogus';   ok(capMode() === 'enforce', 'invalid CAP_MODE fails closed → enforce');
  { const realNow = Date.now; const AT = Date.parse('2026-09-24T00:00:00Z'); process.env.CAP_MODE = '';
    Date.now = () => AT - 1000; ok(capMode() === 'observe', 'unset CAP_MODE before deadline → observe');
    Date.now = () => AT;        ok(capMode() === 'enforce', 'unset CAP_MODE at deadline → enforce');
    Date.now = realNow; }
  process.env.CAP_MODE = 'observe';

  console.log(`api-device-ownership.test: ${pass} assertions passed (observe/enforce state machine + hostile matrix + profile/header/CAP_MODE/deletion regressions)`);
}
main().catch(e => { console.error('❌ api-device-ownership.test FAILED'); console.error(e); process.exit(1); });
