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

  // The set of device_ids belonging to the SAME account as `dev` (via the profiles device->user map, which
  // login/sync populates). An unlinked device is just [dev]. This is what makes a save on one device show up
  // on all your devices once you're logged in — the same account-dedup the leaderboard already does.
  async function accountDevices(dev) {
    try {
      const p = await (await rest(`profiles?device_id=eq.${encodeURIComponent(dev)}&select=user_id`)).json();
      const uid = Array.isArray(p) && p[0] && p[0].user_id;
      if (!uid) return [dev];
      const ds = await (await rest(`profiles?user_id=eq.${encodeURIComponent(uid)}&select=device_id`)).json();
      return [...new Set([dev, ...((Array.isArray(ds) ? ds : []).map(x => x.device_id).filter(d => okDevice(d)))])];
    } catch { return [dev]; }
  }

  // ---- GET: list saved work ids across the account's devices (newest first, deduped) ----
  if (req.method === 'GET') {
    const me = String(req.query.me || '').slice(0, 64);
    if (!okDevice(me)) return res.status(400).json({ error: 'bad deviceId' });
    try {
      const devs = await accountDevices(me);
      const r = await rest(`saves?device_id=in.(${devs.join(',')})&order=created_at.desc&select=work_id`);
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      const rows = await r.json();
      const seen = new Set(), ids = [];
      for (const x of (Array.isArray(rows) ? rows : [])) if (x.work_id && !seen.has(x.work_id)) { seen.add(x.work_id); ids.push(x.work_id); }
      return res.status(200).json({ ids });
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
      // remove the work across ALL the account's devices, so an unsave on one device sticks everywhere
      const devs = await accountDevices(deviceId);
      const r = await rest(`saves?device_id=in.(${devs.join(',')})&work_id=eq.${encodeURIComponent(workId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      return res.status(200).json({ ok: true, saved: false });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  return res.status(405).json({ error: 'GET, POST, or DELETE only' });
}
