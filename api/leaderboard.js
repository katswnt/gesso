// Vercel serverless function: read the daily leaderboard (Accounts+Leaderboards Phase 1).
// GET /api/leaderboard?date=YYYY-MM-DD&tier=easy[&me=<deviceId>]  → top 50 + caller rank/percentile.
// Storage: Supabase (Postgres via PostgREST), server-side SECRET key. Read-only. No auth.
import { SUPABASE_URL } from './_supabase.js';
import { isBlockedName } from '../server/api/moderation.js';
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

// Supabase's PostgREST caps a response at 1000 rows by default, so read the day+tier in 1000-row pages;
// otherwise a busy board silently truncates and ranks/counts go wrong.
async function allScores(rest, date, tier, select) {
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    const r = await rest(`scores?date=eq.${date}&tier=eq.${tier}&order=total.desc&select=${select}`, { headers: { Range: `${from}-${from + 999}` } });
    const page = await r.json();
    if (!Array.isArray(page)) return from === 0 ? null : out; // e.g. the `cold` column missing → caller retries
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
// Ranking reads every score for the day+tier, so remember the ranked board for 30s per warm instance.
// A caller who is missing from the remembered board (they just submitted) always gets a fresh computation.
const MEMO_MS = 30000;
const memo = new Map();
async function rankedBoard(rest, date, tier, me) {
  const k = `${date}|${tier}`, hit = memo.get(k);
  if (hit && Date.now() - hit.at < MEMO_MS && (!me || hit.devices.has(me))) return hit;
  let all = await allScores(rest, date, tier, 'device_id,total,perfects,masterpieces,cold');
  if (!Array.isArray(all)) all = await allScores(rest, date, tier, 'device_id,total,perfects,masterpieces'); // `cold` may not exist yet
  all = Array.isArray(all) ? all : [];
  const devIds = [...new Set(all.map(r => r.device_id))];
  // profiles carry the account link (user_id) + display name/color; batch to keep URLs short, fetch in parallel
  const profByDev = {};
  const chunks = [];
  for (let i = 0; i < devIds.length; i += 100) chunks.push(devIds.slice(i, i + 100));
  const pages = await Promise.all(chunks.map(chunk => rest(`profiles?device_id=in.(${chunk.map(encodeURIComponent).join(',')})&select=device_id,user_id,name,color`).then(r => r.json()).catch(() => [])));
  for (const ps of pages) for (const p of (Array.isArray(ps) ? ps : [])) profByDev[p.device_id] = p;
  // group key = account when signed in, else the device. Keep each group's best score, so one signed-in
  // player on several devices occupies ONE rank instead of several.
  const keyOf = dev => { const p = profByDev[dev]; return p && p.user_id ? 'u:' + p.user_id : 'd:' + dev; };
  const groups = new Map();
  for (const r of all) { const key = keyOf(r.device_id); const prev = groups.get(key);
    if (!prev || r.total > prev.total) groups.set(key, { ...r, _key: key }); }
  const ranked = [...groups.values()].sort((a, b) => b.total - a.total);
  const board = { at: Date.now(), ranked, profByDev, keyOf, devices: new Set(devIds) };
  memo.set(k, board);
  if (memo.size > 200) memo.delete(memo.keys().next().value);
  return board;
}

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
    const board = await rankedBoard(rest, date, tier, me);
    const { ranked, profByDev, keyOf } = board;
    const count = ranked.length;
    const page = ranked.slice(offset, offset + TOP_N);
    const meKey = me ? keyOf(me) : null;

    const rows = page.map((r, i) => {
      const p = profByDev[r.device_id] || {};
      return { rank: offset + i + 1, name: (p.name && !isBlockedName(p.name)) ? p.name : fbName(r.device_id), color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : fbColor(r.device_id),
        score: r.total, perfects: r.perfects || 0, masterpieces: r.masterpieces || 0, cold: !!r.cold, isYou: !!meKey && r._key === meKey };
    });

    let you = null;
    if (meKey) { const idx = ranked.findIndex(r => r._key === meKey);
      if (idx >= 0) { const rank = idx + 1; you = { rank, score: ranked[idx].total, count, percentile: count ? Math.round(((count - rank + 1) / count) * 100) : null }; } }
    // A board without a caller is identical for everyone, so let the CDN serve it; personal views never cache.
    res.setHeader('Cache-Control', me ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=300');
    return res.status(200).json({ date, tier, count, offset, rows, you });
  } catch (e) {
    return res.status(500).json({ error: 'read failed' });
  }
}
