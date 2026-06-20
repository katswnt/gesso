// Vercel serverless function: read the daily leaderboard (Accounts+Leaderboards Phase 1).
// GET /api/leaderboard?date=YYYY-MM-DD&tier=easy[&me=<deviceId>]  → top 50 + caller rank/percentile.
// Storage: Supabase (Postgres via PostgREST), server-side SECRET key. Read-only. No auth.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jmrpqmejupouqfergyyg.supabase.co';
const TIERS = ['easy', 'medium', 'hard', 'impossible'];
const TOP_N = 50;

function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}
const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) } });

  const date = String(req.query.date || ''), tier = String(req.query.tier || ''), me = String(req.query.me || '').slice(0, 64);
  if (!isDateStr(date)) return res.status(400).json({ error: 'bad date' });
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'bad tier' });

  try {
    // top N scores (desc)
    const top = await (await rest(`scores?date=eq.${date}&tier=eq.${tier}&order=total.desc&limit=${TOP_N}&select=device_id,total,perfects,masterpieces`)).json();
    const ids = (top || []).map(r => r.device_id);
    // names/colours for those device ids
    let profByDev = {};
    if (ids.length) {
      const list = ids.map(encodeURIComponent).join(',');
      const profs = await (await rest(`profiles?device_id=in.(${list})&select=device_id,name,color`)).json();
      for (const p of (profs || [])) profByDev[p.device_id] = p;
    }
    const rows = (top || []).map((r, i) => {
      const p = profByDev[r.device_id] || {};
      return { rank: i + 1, name: p.name || '', color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#2230b8',
        score: r.total, perfects: r.perfects || 0, masterpieces: r.masterpieces || 0, isYou: !!me && r.device_id === me };
    });

    // total count
    const cntRes = await rest(`scores?date=eq.${date}&tier=eq.${tier}&select=device_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    const count = parseInt((cntRes.headers.get('content-range') || '*/0').split('/')[1], 10) || 0;

    let you = null;
    if (me) {
      const mine = await (await rest(`scores?device_id=eq.${encodeURIComponent(me)}&date=eq.${date}&tier=eq.${tier}&select=total`)).json();
      if (Array.isArray(mine) && mine[0]) {
        const myTotal = Number(mine[0].total);
        const hr = await rest(`scores?date=eq.${date}&tier=eq.${tier}&total=gt.${myTotal}&select=device_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
        const higher = parseInt((hr.headers.get('content-range') || '*/0').split('/')[1], 10) || 0;
        const rank = higher + 1;
        you = { rank, score: myTotal, count, percentile: count ? Math.round(((count - rank + 1) / count) * 100) : null };
      }
    }
    return res.status(200).json({ date, tier, count, rows, you });
  } catch (e) {
    return res.status(500).json({ error: 'read failed' });
  }
}
