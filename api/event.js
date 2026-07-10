// Vercel serverless function: record an anonymous product-analytics event to Supabase (own-your-data,
// no third-party tracker). Server-side uses the SECRET key (bypasses RLS). Keyed by the client deviceId.
// Fire-and-forget from the client via window.__sink → fetch(keepalive). Privacy-first: no PII, small props.
//
// One-time table migration (run in the Supabase SQL editor):
//   create table if not exists events (
//     id bigint generated always as identity primary key,
//     ts timestamptz not null default now(),
//     device_id text not null,
//     event text not null,
//     props jsonb not null default '{}'::jsonb
//   );
//   create index if not exists events_event_ts on events (event, ts);
//   create index if not exists events_device on events (device_id);
//   -- RLS stays ON with no anon policy; only this function (secret key) writes.
import { SUPABASE_URL } from './_supabase.js';

const EVENT_RE = /^[a-z][a-z0-9_]{1,39}$/; // snake_case, short
function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(200).json({ ok: false, note: 'storage not configured' }); // never error the client

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const deviceId = String(body.deviceId || '').slice(0, 64);
  const event = String(body.event || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!EVENT_RE.test(event)) return res.status(400).json({ error: 'bad event' });

  // props: shallow, small, scalar values only (no PII, no nested payloads)
  const props = {};
  const src = (body.props && typeof body.props === 'object') ? body.props : {};
  let n = 0;
  for (const k of Object.keys(src)) {
    if (n++ >= 12) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) continue;
    const v = src[k];
    if (v == null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) props[k] = v;
    else if (typeof v === 'boolean') props[k] = v;
    else if (typeof v === 'string') props[k] = v.slice(0, 64);
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ device_id: deviceId, event, props }),
    });
    if (!r.ok) return res.status(200).json({ ok: false }); // swallow — analytics must never break the app
    return res.status(200).json({ ok: true });
  } catch { return res.status(200).json({ ok: false }); }
}
