// Vercel serverless function: receive a "report an error" submission and store it in Redis.
// Storage: Upstash Redis REST (Vercel Marketplace). Set env vars KV_REST_API_URL + KV_REST_API_TOKEN.
// Reads back with: redis-cli LRANGE gesso:reports 0 -1   (or the Upstash console).
// Abuse controls (it's a public anonymous endpoint): same-origin allowlist, a hidden honeypot field,
// and a per-IP hourly rate limit — enough to keep casual spam from running up KV usage. The client
// keeps a localStorage fallback, so a rejection here never blocks the user.
const RATE_MAX = 20, RATE_WINDOW = 3600; // max reports per IP per hour

function allowedOrigin(origin) {
  if (!origin) return true; // same-origin fetches may omit it; don't hard-block
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  // accept either the Vercel-KV or the Upstash naming the integration may set
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).json({ error: 'storage not configured' });
  const redis = (path) => fetch(`${url}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  // honeypot: a real user never fills this; bots that POST every field do. Silently accept + drop.
  if (body.hp) return res.status(200).json({ ok: true });

  // per-IP hourly rate limit (INCR + EXPIRE on first hit of the window)
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  try {
    const n = (await (await redis(`incr/gesso:rl:${encodeURIComponent(ip)}`)).json()).result;
    if (n === 1) await redis(`expire/gesso:rl:${encodeURIComponent(ip)}/${RATE_WINDOW}`);
    if (n > RATE_MAX) return res.status(429).json({ error: 'rate limited' });
  } catch { /* if the limiter call fails, don't block a legit report */ }

  const rec = {
    workId: String(body.workId || '').slice(0, 80),
    reason: String(body.reason || '').slice(0, 40),
    detail: String(body.detail || '').slice(0, 200),
    note:   String(body.note   || '').slice(0, 400),
    ua:     String(req.headers['user-agent'] || '').slice(0, 160),
    ts:     new Date().toISOString(),
  };
  if (!rec.workId) return res.status(400).json({ error: 'missing workId' });

  try {
    const r = await redis(`lpush/gesso:reports/${encodeURIComponent(JSON.stringify(rec))}`);
    if (!r.ok) throw new Error('redis ' + r.status);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'store failed' });
  }
}
