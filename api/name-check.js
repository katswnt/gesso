// Vercel serverless function: is a leaderboard name available? (Accounts+Leaderboards)
// GET /api/name-check?name=X&device=Y → { available }. A name is RESERVED only if an ACCOUNT (a profile
// row with user_id set) has claimed it; names not tied to an account are fair game. Your own account's
// name is always available to you. Storage: Supabase (server SECRET key).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jmrpqmejupouqfergyyg.supabase.co';
function allowedOrigin(o){ if(!o)return true; try{const h=new URL(o).hostname;return h==='gesso.katswint.com'||h==='localhost'||h.endsWith('.vercel.app');}catch{return false;} }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (p) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });

  const name = String(req.query.name || '').trim();
  const device = String(req.query.device || '').slice(0, 64);
  if (!name) return res.status(200).json({ available: true });

  try {
    // who (if anyone) has claimed this name with an ACCOUNT? (case-insensitive)
    const claimants = await (await rest(`profiles?name=ilike.${encodeURIComponent(name)}&user_id=not.is.null&select=user_id,device_id`)).json();
    if (!Array.isArray(claimants) || claimants.length === 0) return res.status(200).json({ available: true });
    // available iff the only claimant is THIS device's own account
    let myUserId = null;
    if (device) { const me = await (await rest(`profiles?device_id=eq.${encodeURIComponent(device)}&select=user_id`)).json(); myUserId = Array.isArray(me) && me[0] ? me[0].user_id : null; }
    const reservedByOther = claimants.some(c => c.user_id && c.user_id !== myUserId);
    return res.status(200).json({ available: !reservedByOther });
  } catch (e) {
    return res.status(200).json({ available: true }); // never block a save on a check failure
  }
}
