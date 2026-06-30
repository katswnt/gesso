// Vercel serverless function: "My Gallery" — save/unsave artworks to an anonymous device's profile.
// Storage: Supabase (Postgres via PostgREST), server-side SECRET key (bypasses RLS). Keyed by the
// client-generated deviceId, same identity model as the leaderboard. A saved item is just (device_id, work_id).
//   GET    /api/saves?me=<deviceId>            -> { ids: [...] }  (newest first)
//   POST   /api/saves { deviceId, workId }     -> upsert (idempotent)
//   DELETE /api/saves { deviceId, workId }     -> remove
// Table:  saves( device_id text, work_id text, created_at timestamptz default now(),
//                primary key (device_id, work_id) )   -- see db/saves.sql
import { SUPABASE_URL } from './_supabase.js';

const MAX_SAVES = 1000;           // per-device cap (abuse guard)
const okDevice = d => /^[A-Za-z0-9_-]{8,64}$/.test(d);
const okWork = w => typeof w === 'string' && w.length > 0 && w.length <= 200;
function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

  // ---- GET: list this device's saved work ids ----
  if (req.method === 'GET') {
    const me = String(req.query.me || '').slice(0, 64);
    if (!okDevice(me)) return res.status(400).json({ error: 'bad deviceId' });
    try {
      const r = await rest(`saves?device_id=eq.${encodeURIComponent(me)}&order=created_at.desc&select=work_id`);
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      const rows = await r.json();
      return res.status(200).json({ ids: (Array.isArray(rows) ? rows : []).map(x => x.work_id) });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  // ---- POST/DELETE: parse body ----
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const workId = String(body.workId || '');
  if (!okDevice(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!okWork(workId)) return res.status(400).json({ error: 'bad workId' });

  if (req.method === 'POST') {
    try {
      // cap check (cheap exact count) — ignore if already at cap unless this id already exists (idempotent upsert handles dupes)
      const cnt = await (await rest(`saves?device_id=eq.${encodeURIComponent(deviceId)}&select=work_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } })).headers.get('content-range');
      const total = cnt ? parseInt(String(cnt).split('/')[1], 10) || 0 : 0;
      if (total >= MAX_SAVES) return res.status(409).json({ error: 'gallery full', max: MAX_SAVES });
      const r = await rest('saves', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ device_id: deviceId, work_id: workId }) });
      if (!r.ok && r.status !== 409) return res.status(502).json({ error: 'upstream' });
      return res.status(200).json({ ok: true, saved: true });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  if (req.method === 'DELETE') {
    try {
      const r = await rest(`saves?device_id=eq.${encodeURIComponent(deviceId)}&work_id=eq.${encodeURIComponent(workId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      return res.status(200).json({ ok: true, saved: false });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  return res.status(405).json({ error: 'GET, POST, or DELETE only' });
}
