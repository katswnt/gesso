// Vercel serverless function: submit a finished DAILY run to the leaderboard (Accounts+Leaderboards Phase 1).
// Storage: Upstash Redis REST (same env as report.js: KV_REST_API_URL/TOKEN, Upstash fallback).
// Anonymous — keyed by a client-generated deviceId. No login. Best-score-per-day guarded so replays
// can't inflate. Raw per-round guesses are stored so Phase 4 can re-score server-side retroactively.
// Abuse controls mirror report.js: same-origin allowlist, honeypot, per-IP hourly rate limit.
const RATE_MAX = 60, RATE_WINDOW = 3600;          // a session is a handful of submits; 60/hr is generous
const TIERS = ['easy', 'medium', 'hard', 'impossible'];
const ROUNDS = 5, MAX_CAT = 2500;
const MAX_TOTAL = ROUNDS * (4 + 1) * MAX_CAT;     // 4 core cats + artist bonus per round = 62,500 ceiling
const SCORE_TTL = 60 * 60 * 24 * 40;              // keep a submitted run ~40 days (for re-score / "your result")

function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}
const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).json({ error: 'storage not configured' });
  const redis = (path) => fetch(`${url}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const enc = encodeURIComponent;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  if (body.hp) return res.status(200).json({ ok: true }); // honeypot

  // validate the submission
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const date = String(body.date || '');
  const tier = String(body.tier || '');
  const total = Number(body.total);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!isDateStr(date)) return res.status(400).json({ error: 'bad date' });
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'bad tier' });
  if (!Number.isFinite(total) || total < 0 || total > MAX_TOTAL) return res.status(400).json({ error: 'bad total' });
  // accept today and yesterday only (timezone slack); never let a client backfill arbitrary past dates
  const today = new Date(), todayStr = today.toISOString().slice(0, 10);
  const y = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (date !== todayStr && date !== y) return res.status(400).json({ error: 'date not current' });

  const name = String(body.name || '').slice(0, 16);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#2230b8';
  const perfects = Math.max(0, Math.min(ROUNDS, parseInt(body.perfects, 10) || 0));
  const masterpieces = Math.max(0, Math.min(ROUNDS, parseInt(body.masterpieces, 10) || 0));

  // per-IP rate limit (mirror report.js)
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  try {
    const n = (await (await redis(`incr/gesso:rl:score:${enc(ip)}`)).json()).result;
    if (n === 1) await redis(`expire/gesso:rl:score:${enc(ip)}/${RATE_WINDOW}`);
    if (n > RATE_MAX) return res.status(429).json({ error: 'rate limited' });
  } catch { /* limiter failure shouldn't block a legit submit */ }

  const lbKey = `gesso:lb:${date}:${tier}`;
  try {
    // best-score guard: only replace if this run beats the player's existing score for the day+tier
    const prev = (await (await redis(`zscore/${lbKey}/${enc(deviceId)}`)).json()).result;
    const isBest = prev == null || total > Number(prev);
    if (isBest) await redis(`zadd/${lbKey}/${total}/${enc(deviceId)}`);
    await redis(`expire/${lbKey}/${SCORE_TTL}`);
    // display data + the raw run (for re-score + "your result")
    await redis(`hset/gesso:player:${enc(deviceId)}/name/${enc(name)}/color/${enc(color)}`);
    const run = { total, perfects, masterpieces, rounds: body.rounds || null, ts: new Date().toISOString() };
    await redis(`set/gesso:score:${enc(deviceId)}:${date}:${tier}/${enc(JSON.stringify(run))}/EX/${SCORE_TTL}`);

    // return the caller's rank/standing for the "#N today" moment
    const rank = (await (await redis(`zrevrank/${lbKey}/${enc(deviceId)}`)).json()).result;
    const count = (await (await redis(`zcard/${lbKey}`)).json()).result;
    return res.status(200).json({ ok: true, isBest, rank: rank == null ? null : rank + 1, count });
  } catch (e) {
    return res.status(500).json({ error: 'store failed' });
  }
}
