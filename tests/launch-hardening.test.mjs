// Launch-week hardening regressions: display-name moderation and batched analytics ingestion.
import assert from 'node:assert';
import { isBlockedName } from '../server/api/moderation.js';

let n = 0; const ok = (v, m) => { assert(v, m); n++; };

// Moderation: art and place names must survive; obvious abuse and staff impersonation must not.
for (const name of ['Canaletto', 'Dickens', 'Hitchcock', 'Shitao', 'Peacock', 'Scarlett', 'Titian', 'Cassatt', 'Assisi', 'Dürer', 'Cézanne', 'Kat'])
  ok(!isBlockedName(name), `innocent name blocked: ${name}`);
for (const name of ['F.u.c.k', 'fuuuuck', 'sh1thead', 'fück', 'admin', 'G e s s o', 'Hitler', 'P0rnstar', 'bitch99'])
  ok(isBlockedName(name), `abusive/impersonating name allowed: ${name}`);

// Analytics: one request carries a batch; malformed entries are dropped, the rest stored in ONE insert.
process.env.SUPABASE_SECRET_KEY = 'test-secret';
const { default: handler } = await import('../api/event.js');
const calls = [];
globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
const run = async body => { let status = 0, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://gesso.katswint.com' }, body }, res); return { status, json }; };

const events = Array.from({ length: 60 }, (_, i) => ({ event: i === 3 ? 'Bad Event!' : 'round_start', props: { idx: i, nested: { x: 1 } } }));
let r = await run({ deviceId: 'device-1234', events });
ok(r.status === 200 && r.json.ok, 'batch accepted');
ok(calls.length === 1, 'a batch is ONE database insert');
ok(Array.isArray(calls[0].body) && calls[0].body.length === 49, 'batch capped at 50 with the malformed entry dropped');
ok(calls[0].body.every(row => row.device_id === 'device-1234' && !('nested' in row.props)), 'rows keyed by device with scalar-only props');

calls.length = 0;
r = await run({ deviceId: 'device-1234', event: 'daily_start', props: { tier: 'easy' } });
ok(r.status === 200 && calls.length === 1 && calls[0].body.length === 1 && calls[0].body[0].event === 'daily_start', 'legacy single-event body still works');

calls.length = 0;
r = await run({ deviceId: 'device-1234', events: [{ event: 'BAD' }] });
ok(r.status === 400 && calls.length === 0, 'a batch with no valid events is rejected without a write');

console.log(`launch-hardening.test: ${n} checks passed`);
