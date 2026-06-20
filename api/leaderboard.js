// Vercel serverless function: read the daily leaderboard (Accounts+Leaderboards Phase 1).
// GET /api/leaderboard?date=YYYY-MM-DD&tier=easy[&me=<deviceId>]
// Returns top 50 rows (rank/name/color/score) + the caller's own rank/percentile if me= is passed.
// Read-only; same Upstash Redis as score.js. No auth.
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

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).json({ error: 'storage not configured' });
  const redis = (path) => fetch(`${url}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const enc = encodeURIComponent;

  const date = String(req.query.date || '');
  const tier = String(req.query.tier || '');
  const me = String(req.query.me || '').slice(0, 64);
  if (!isDateStr(date)) return res.status(400).json({ error: 'bad date' });
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'bad tier' });

  const lbKey = `gesso:lb:${date}:${tier}`;
  try {
    // top N with scores: Upstash returns a flat [member, score, member, score, ...]
    const flat = (await (await redis(`zrevrange/${lbKey}/0/${TOP_N - 1}/withscores`)).json()).result || [];
    const ids = [], scores = [];
    for (let i = 0; i < flat.length; i += 2) { ids.push(flat[i]); scores.push(Number(flat[i + 1])); }

    // batch-fetch display names/colours
    const rows = [];
    for (let i = 0; i < ids.length; i++) {
      const p = (await (await redis(`hgetall/gesso:player:${enc(ids[i])}`)).json()).result || [];
      const h = {}; for (let k = 0; k < p.length; k += 2) h[p[k]] = p[k + 1];
      rows.push({ rank: i + 1, name: h.name || '', color: h.color || '#2230b8', score: scores[i], tier, isYou: me && ids[i] === me });
    }

    const count = (await (await redis(`zcard/${lbKey}`)).json()).result || 0;
    let you = null;
    if (me) {
      const r = (await (await redis(`zrevrank/${lbKey}/${enc(me)}`)).json()).result;
      const s = (await (await redis(`zscore/${lbKey}/${enc(me)}`)).json()).result;
      if (r != null) you = { rank: r + 1, score: Number(s), count, percentile: count ? Math.round(((count - r) / count) * 100) : null };
    }
    return res.status(200).json({ date, tier, count, rows, you });
  } catch (e) {
    return res.status(500).json({ error: 'read failed' });
  }
}
