// Vercel serverless function: update a player's leaderboard display name/color immediately (so editing
// identity reflects on the board without waiting for the next score submit). POST { deviceId, name, color }.
// Honors the name-reservation rule (a name claimed by another ACCOUNT is dropped). Storage: Supabase SECRET key.
import { SUPABASE_URL } from './_supabase.js';
function allowedOrigin(o){ if(!o)return true; try{const h=new URL(o).hostname;return h==='gesso.katswint.com'||h==='localhost'||h.endsWith('.vercel.app');}catch{return false;} }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (p, opts={}) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type':'application/json', ...(opts.headers||{}) } });

  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } } body = body || {};
  const deviceId = String(body.deviceId || '').slice(0, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  let name = String(body.name || '').slice(0, 16);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#2230b8';

  try {
    if (name) { // drop a name another account has reserved
      const claimants = await (await rest(`profiles?name=ilike.${encodeURIComponent(name)}&user_id=not.is.null&select=user_id`)).json();
      if (Array.isArray(claimants) && claimants.length) {
        const me = await (await rest(`profiles?device_id=eq.${encodeURIComponent(deviceId)}&select=user_id`)).json();
        const myUserId = Array.isArray(me) && me[0] ? me[0].user_id : null;
        if (claimants.some(c => c.user_id && c.user_id !== myUserId)) return res.status(409).json({ error: 'name reserved' });
      }
    }
    const w = await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, name, color }) });
    if (!w.ok) { const d = await w.text().catch(()=> ''); return res.status(502).json({ error:'write failed', detail:d.slice(0,200) }); }
    return res.status(200).json({ ok: true, name, color });
  } catch (e) {
    return res.status(500).json({ error: 'update failed' });
  }
}
