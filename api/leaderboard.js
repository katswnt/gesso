// Vercel serverless function: read the daily leaderboard (Accounts+Leaderboards Phase 1).
// GET /api/leaderboard?date=YYYY-MM-DD&tier=easy[&me=<deviceId>]  → top 50 + caller rank/percentile.
// Storage: Supabase (Postgres via PostgREST), server-side SECRET key. Read-only. No auth.
import { SUPABASE_URL } from './_supabase.js';
const TIERS = ['easy', 'medium', 'hard', 'impossible'];
const TOP_N = 50;

function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}
const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
// Deterministic fallback identity for rows whose profile has no name yet (e.g. submitted before client
// auto-names shipped). MUST match the client's defaultName/defaultColor so a device reads the same everywhere.
const SWATCHES=['#2230b8','#1b2570','#3f4cbe','#5663d4','#7480d4','#9aa3e0','#0f5b63','#166b6b','#1f7a8c','#2a9d9d','#3aa6a0','#5cc0b6','#1f6b45','#2f8f5b','#3a9d4f','#5a8f3a','#6b9e3f','#86ab57','#a7741f','#b5852a','#c9962f','#cf9f3a','#d9a441','#e0b14a','#a13526','#b33d2e','#c14b3a','#cf5b45','#d97150','#e08c6a','#a83a5c','#b8466b','#c4577a','#d06b8a','#d98ba3','#e0a0b5','#4d3590','#5a3fa0','#6b4fb8','#7d5fc4','#8e6fd0','#a487da','#1b1916','#3a362d','#4a4640','#6b6557','#7d7866','#8a8472'];
const ARTIST_HANDLES=['Rembrandt','Vermeer','Monet','Degas','Cézanne','Matisse','Picasso','Klimt','Goya','Turner','Hokusai','Hiroshige','Kahlo','Rivera','O’Keeffe','Hopper','Rothko','Pollock','Basquiat','Warhol','Dürer','Bosch','Bruegel','Caravaggio','Titian','Raphael','Botticelli','Donatello','Michelangelo','Gentileschi','Cassatt','Morisot','Sargent','Whistler','Constable','Gainsborough','Delacroix','Courbet','Manet','Renoir','Seurat','Munch','Schiele','Mondrian','Kandinsky','Klee','Magritte','Dalí','Miró','Rodin','Brancusi','Hepworth','Sisley','Pissarro','Gauguin','Bonheur','Vigée','Tintoretto','Veronese','Hals'];
const fbColor = d => { let h=0; d=String(d); for(let i=0;i<d.length;i++)h=(h*31+d.charCodeAt(i))>>>0; return SWATCHES[h%SWATCHES.length]; };
const fbName = d => { let h=5381; d=String(d); for(let i=0;i<d.length;i++)h=((h<<5)+h+d.charCodeAt(i))>>>0; return ARTIST_HANDLES[h%ARTIST_HANDLES.length]; };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) } });

  const date = String(req.query.date || ''), tier = String(req.query.tier || ''), me = String(req.query.me || '').slice(0, 64);
  const offset = Math.max(0, Math.min(5000, parseInt(req.query.offset, 10) || 0)); // pagination beyond the top 50
  if (!isDateStr(date)) return res.status(400).json({ error: 'bad date' });
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'bad tier' });

  try {
    // Fire the three INDEPENDENT queries together (was sequential → ~3 round-trips of latency): the score page,
    // the exact total count, and (if a caller is given) the caller's own score. Dependent follow-ups parallelize too.
    // Fetch ALL of the day+tier's scores, then collapse by ACCOUNT so one signed-in player on several
    // devices occupies ONE rank (their best score) instead of several. Anonymous devices (no user_id)
    // stay per-device. Small at current scale; a Postgres RPC/view is the answer if this ever gets large.
    let all = await (await rest(`scores?date=eq.${date}&tier=eq.${tier}&order=total.desc&limit=5000&select=device_id,total,perfects,masterpieces,cold`)).json();
    if (!Array.isArray(all)) { // `cold` column may not exist yet — self-heal by re-selecting without it
      all = await (await rest(`scores?date=eq.${date}&tier=eq.${tier}&order=total.desc&limit=5000&select=device_id,total,perfects,masterpieces`)).json();
    }
    all = Array.isArray(all) ? all : [];
    const devIds = [...new Set(all.map(r => r.device_id))];

    // profiles carry the account link (user_id) + display name/color; batch to keep URLs short
    const profByDev = {};
    for (let i = 0; i < devIds.length; i += 100) {
      const chunk = devIds.slice(i, i + 100);
      const ps = await (await rest(`profiles?device_id=in.(${chunk.map(encodeURIComponent).join(',')})&select=device_id,user_id,name,color`)).json();
      for (const p of (ps || [])) profByDev[p.device_id] = p;
    }
    // group key = account when signed in, else the device. Keep each group's best score.
    const keyOf = dev => { const p = profByDev[dev]; return p && p.user_id ? 'u:' + p.user_id : 'd:' + dev; };
    const groups = new Map();
    for (const r of all) { const key = keyOf(r.device_id); const prev = groups.get(key);
      if (!prev || r.total > prev.total) groups.set(key, { ...r, _key: key }); }
    const ranked = [...groups.values()].sort((a, b) => b.total - a.total);
    const count = ranked.length;
    const page = ranked.slice(offset, offset + TOP_N);
    const meKey = me ? keyOf(me) : null;

    const rows = page.map((r, i) => {
      const p = profByDev[r.device_id] || {};
      return { rank: offset + i + 1, name: p.name || fbName(r.device_id), color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : fbColor(r.device_id),
        score: r.total, perfects: r.perfects || 0, masterpieces: r.masterpieces || 0, cold: !!r.cold, isYou: !!meKey && r._key === meKey };
    });

    let you = null;
    if (meKey) { const idx = ranked.findIndex(r => r._key === meKey);
      if (idx >= 0) { const rank = idx + 1; you = { rank, score: ranked[idx].total, count, percentile: count ? Math.round(((count - rank + 1) / count) * 100) : null }; } }
    return res.status(200).json({ date, tier, count, offset, rows, you });
  } catch (e) {
    return res.status(500).json({ error: 'read failed' });
  }
}
