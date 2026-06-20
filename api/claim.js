// Vercel serverless function: bind a device's leaderboard rows to a logged-in account (Accounts Phase 2).
// POST { deviceId, accessToken }. Verifies the Supabase JWT by calling auth/v1/user, then stamps
// profiles.user_id for that device_id so the account owns its board identity/history across devices.
// Storage: Supabase. Server uses the SECRET key for the write; the user's accessToken proves identity.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jmrpqmejupouqfergyyg.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_ZUSDLvzDYbD222i_ycdezQ_j7IB7Xp_';

function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const accessToken = String(body.accessToken || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!accessToken) return res.status(400).json({ error: 'missing token' });

  try {
    // verify the JWT → get the authenticated user id
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}` } });
    if (!ures.ok) return res.status(401).json({ error: 'invalid session' });
    const user = await ures.json();
    if (!user || !user.id) return res.status(401).json({ error: 'invalid session' });

    // stamp this device's profile with the account id (secret key bypasses RLS)
    const w = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=device_id`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ device_id: deviceId, user_id: user.id }) });
    if (!w.ok) { const d = await w.text().catch(() => ''); return res.status(502).json({ error: 'bind failed', detail: d.slice(0, 200) }); }
    return res.status(200).json({ ok: true, userId: user.id });
  } catch (e) {
    return res.status(500).json({ error: 'claim failed' });
  }
}
