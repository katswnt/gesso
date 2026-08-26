// PR 4B — api/purge-tombstones.js handler tests (network-free, in test:ci). Drives the REAL handler with a
// mock req/res and a stubbed globalThis.fetch over the service-role RPC boundary. Proves: HTTP-method
// enforcement, fail-closed auth (no secret / wrong bearer) with NO RPC call, RPC failure/throw handling,
// fail-closed on a malformed (non-integer/negative) count, and a valid nonnegative success.
//   node tests/api-purge-tombstones.test.mjs
import assert from 'node:assert/strict';

process.env.SUPABASE_SECRET_KEY = 'test-secret';

const CALLS = [];
let RPC = async () => ({ ok: true, status: 200, body: 0 });
const R = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); CALLS.push({ url: u, method: (opts.method || 'GET').toUpperCase() });
  if (u.includes('/rest/v1/rpc/purge_stale_tombstones')) return RPC();
  return R(404, {});
};

const mkReq = (o = {}) => ({ method: o.method || 'GET', headers: { ...(o.authorization ? { authorization: o.authorization } : {}) } });
function mkRes() { return { _s: 0, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; } }; }
const purge = (await import('../api/purge-tombstones.js')).default;
async function call(reqOpts) { const res = mkRes(); await purge(mkReq(reqOpts), res); return res; }
const rpcCalls = () => CALLS.filter(c => c.url.includes('/rest/v1/rpc/purge_stale_tombstones')).length;

let pass = 0; const ok = (c, m) => { if (c) pass++; else { console.error('  ✗ ' + m); throw new Error('assertion failed: ' + m); } };
const GOOD = 'Bearer test-cron-secret';

async function main() {
  process.env.CRON_SECRET = 'test-cron-secret';

  // method enforcement: non-GET rejected BEFORE any work, no RPC
  CALLS.length = 0;
  let r = await call({ method: 'POST', authorization: GOOD });
  ok(r._s === 405, 'POST → 405 (GET only)');
  ok(rpcCalls() === 0, 'no RPC on wrong method');

  // fail-closed: wrong bearer → 401, no RPC
  CALLS.length = 0;
  r = await call({ method: 'GET', authorization: 'Bearer nope' });
  ok(r._s === 401, 'wrong bearer → 401');
  ok(rpcCalls() === 0, 'no RPC on bad auth');

  // fail-closed: missing bearer → 401, no RPC
  CALLS.length = 0;
  r = await call({ method: 'GET' });
  ok(r._s === 401, 'missing bearer → 401');
  ok(rpcCalls() === 0, 'no RPC on missing auth');

  // fail-closed: CRON_SECRET unset → 401 even with a plausible header, no RPC
  { const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
    CALLS.length = 0; r = await call({ method: 'GET', authorization: 'Bearer test-cron-secret' });
    ok(r._s === 401, 'unset CRON_SECRET → 401 (fail closed)');
    ok(rpcCalls() === 0, 'no RPC when CRON_SECRET unset');
    process.env.CRON_SECRET = saved; }

  // valid success: nonnegative integer → 200 { removed }
  CALLS.length = 0; RPC = async () => R(200, 3);
  r = await call({ method: 'GET', authorization: GOOD });
  ok(r._s === 200 && r._j && r._j.ok === true && r._j.removed === 3, 'valid count → 200 removed=3');
  ok(rpcCalls() === 1, 'RPC invoked once on valid auth');

  // zero removed is still valid (nonnegative)
  RPC = async () => R(200, 0);
  r = await call({ method: 'GET', authorization: GOOD });
  ok(r._s === 200 && r._j.removed === 0, 'zero removed → 200 removed=0');

  // RPC non-2xx → 502
  RPC = async () => R(500, {});
  r = await call({ method: 'GET', authorization: GOOD });
  ok(r._s === 502, 'RPC non-2xx → 502');

  // RPC throws → 500
  RPC = async () => { throw new Error('boom'); };
  r = await call({ method: 'GET', authorization: GOOD });
  ok(r._s === 500, 'RPC throw → 500');

  // malformed success: non-integer / negative / null → 502 (fail closed)
  for (const bad of ['abc', -1, 1.5, null, true]) {
    RPC = async () => R(200, bad);
    r = await call({ method: 'GET', authorization: GOOD });
    ok(r._s === 502, `malformed count ${JSON.stringify(bad)} → 502`);
  }

  console.log(`api-purge-tombstones.test: ${pass} assertions passed (method, fail-closed auth + no-RPC, RPC failure/throw, malformed fail-closed, valid success)`);
}
main().catch(e => { console.error(e); process.exit(1); });
