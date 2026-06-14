// Vercel serverless function: receive a "report an error" submission and store it in Redis.
// Storage: Upstash Redis REST (Vercel Marketplace). Set env vars KV_REST_API_URL + KV_REST_API_TOKEN.
// Reads back with: redis-cli LRANGE gesso:reports 0 -1   (or the Upstash console).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  // accept either the Vercel-KV or the Upstash naming the integration may set
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).json({ error: 'storage not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
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
    const r = await fetch(`${url}/lpush/gesso:reports/${encodeURIComponent(JSON.stringify(rec))}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'store failed' });
  }
}
