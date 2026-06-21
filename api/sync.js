// Vercel serverless function: cross-device sync (Accounts Phase 2b). On login, merge this device's local
// identity + streak UP into the account, and return the account's canonical identity + merged streak to
// pull DOWN — so progress follows you to any device. POST { deviceId, accessToken, streak, name, color }.
// Storage: Supabase. Server verifies the JWT (proves identity), then uses the SECRET key for reads/writes.
// Requires a user_state table:
//   create table if not exists public.user_state (user_id uuid primary key, streak jsonb, updated_at timestamptz default now());
import { SUPABASE_URL, SUPA_ANON } from './_supabase.js';
function allowedOrigin(o){ if(!o)return true; try{const h=new URL(o).hostname;return h==='gesso.katswint.com'||h==='localhost'||h.endsWith('.vercel.app');}catch{return false;} }

// merge two streak objects, taking the better of each (max counts, union of played dates, max per-date score)
function mergeStreak(a, b){
  a=a||{}; b=b||{}; const out={
    current: Math.max(+a.current||0, +b.current||0),
    longest: Math.max(+a.longest||0, +b.longest||0),
    lastPlayed: (a.lastPlayed||'') > (b.lastPlayed||'') ? a.lastPlayed : b.lastPlayed,
    playedDates: [...new Set([...(a.playedDates||[]), ...(b.playedDates||[])])].sort(),
    scores: { ...(a.scores||{}) }, byDay: { ...(a.byDay||{}) },
  };
  for(const [d,v] of Object.entries(b.scores||{})) out.scores[d] = Math.max(+out.scores[d]||0, +v||0);
  for(const [d,tiers] of Object.entries(b.byDay||{})){ out.byDay[d]={...(out.byDay[d]||{})}; for(const [t,v] of Object.entries(tiers||{})) out.byDay[d][t]=Math.max(+out.byDay[d][t]||0, +v||0); }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (p, opts={}) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type':'application/json', ...(opts.headers||{}) } });

  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } } body = body || {};
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const accessToken = String(body.accessToken || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!accessToken) return res.status(400).json({ error: 'missing token' });

  try {
    // verify JWT → user id
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}` } });
    if (!ures.ok) return res.status(401).json({ error: 'invalid session' });
    const user = await ures.json(); if (!user || !user.id) return res.status(401).json({ error: 'invalid session' });
    const uid = user.id;

    // bind this device to the account
    await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid }) });

    // CANONICAL IDENTITY: prefer a name/color already on any of the account's profiles; else adopt this device's local one
    const profs = await (await rest(`profiles?user_id=eq.${uid}&select=name,color,device_id`)).json();
    let name='', color='';
    for (const p of (profs||[])) { if (p.name && !name) name=p.name; if (p.color && !color) color=p.color; }
    if (!name && body.name) name=String(body.name).slice(0,16);
    if (!color && /^#[0-9a-fA-F]{6}$/.test(body.color||'')) color=body.color;
    // write the canonical identity onto THIS device's profile so the board shows it
    await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid, name, color }) });

    // STREAK: merge account state with the device's local streak
    let serverStreak=null;
    try { const st = await (await rest(`user_state?user_id=eq.${uid}&select=streak`)).json(); serverStreak = Array.isArray(st)&&st[0]?st[0].streak:null; } catch {}
    const merged = mergeStreak(serverStreak, body.streak);
    try { await rest('user_state?on_conflict=user_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: uid, streak: merged, updated_at: new Date().toISOString() }) }); } catch {}

    return res.status(200).json({ ok: true, name, color, streak: merged });
  } catch (e) {
    return res.status(500).json({ error: 'sync failed' });
  }
}
