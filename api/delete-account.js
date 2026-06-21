// Vercel serverless function: permanently delete a player's account + data (Accounts).
// POST { deviceId, accessToken }. Verifies the JWT, then deletes the Supabase auth user and removes their
// profiles / scores / user_state rows. Uses the SECRET key (admin). Irreversible.
import { SUPABASE_URL, SUPA_ANON } from './_supabase.js';
function allowedOrigin(o){ if(!o)return true; try{const h=new URL(o).hostname;return h==='gesso.katswint.com'||h==='localhost'||h.endsWith('.vercel.app');}catch{return false;} }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const admin = (path, opts={}) => fetch(`${SUPABASE_URL}/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type':'application/json', ...(opts.headers||{}) } });

  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } } body = body || {};
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const accessToken = String(body.accessToken || '');
  if (!accessToken) return res.status(400).json({ error: 'missing token' });

  try {
    // verify the JWT → the user deleting is themselves
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}` } });
    if (!ures.ok) return res.status(401).json({ error: 'invalid session' });
    const user = await ures.json(); if (!user || !user.id) return res.status(401).json({ error: 'invalid session' });
    const uid = user.id;

    // remove all of the account's data: profiles + scores (by every device bound to this account) + user_state
    const profs = await (await admin(`rest/v1/profiles?user_id=eq.${uid}&select=device_id`)).json();
    const devices = [...new Set([deviceId, ...((profs||[]).map(p=>p.device_id).filter(Boolean))])];
    for (const d of devices) {
      await admin(`rest/v1/scores?device_id=eq.${encodeURIComponent(d)}`, { method:'DELETE' });
      await admin(`rest/v1/profiles?device_id=eq.${encodeURIComponent(d)}`, { method:'DELETE' });
    }
    await admin(`rest/v1/user_state?user_id=eq.${uid}`, { method:'DELETE' });
    // finally delete the auth user (admin endpoint)
    await admin(`auth/v1/admin/users/${uid}`, { method:'DELETE' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'delete failed' });
  }
}
