// Vercel serverless function: register a device's capability (PR 3, first-contact mint).
// POST { deviceId } + header x-gesso-cap:<raw 43-char base64url capability>. The server hashes the raw
// (SHA-256) and stores ONLY the hash via the service-role register_device() function. Idempotent; a second
// registration of the same device with a DIFFERENT cap is rejected. Conflict responses conceal the conflict
// TYPE and owner identity (bad_capability/hash_in_use both → generic 409); existence is not fully hidden
// (ok→200 vs conflict→409 vs revoked→403 are distinguishable — acceptable). Best-effort per-IP rate limit.
import { allowedOrigin, parseBody, clientIp } from './lib/http.js';
import { admin } from './lib/supabaseAdmin.js';
import { readCap, registerDevice, capMode, logAdoption } from './lib/device-ownership.js';

const RATE_MAX = 60, RATE_WINDOW = 3600; // registrations per IP per hour (best-effort)

async function underRateLimit(req) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return true; // limiter unavailable -> don't block (matches report.js posture)
  const ip = clientIp(req);
  const redis = p => fetch(`${url}/${p}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  try {
    const n = (await (await redis(`incr/gesso:rl:regdev:${encodeURIComponent(ip)}`)).json()).result;
    if (n === 1) await redis(`expire/gesso:rl:regdev:${encodeURIComponent(ip)}/${RATE_WINDOW}`);
    return n <= RATE_MAX;
  } catch { return true; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });

  const body = parseBody(req);
  const deviceId = String(body.deviceId || '').slice(0, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  const cap = readCap(req);
  if (!cap.present || cap.malformed) return res.status(400).json({ error: 'bad capability' });

  if (!(await underRateLimit(req))) return res.status(429).json({ error: 'rate limited' });

  const result = await registerDevice(a, deviceId, cap.hash);
  logAdoption('register-device', capMode(), result || 'error');
  if (result === null) return res.status(502).json({ error: 'register failed' });
  if (result === 'ok') return res.status(200).json({ ok: true });
  if (result === 'revoked') return res.status(403).json({ ok: false });
  // 'bad_capability' (device exists with a different hash) and 'hash_in_use' (hash used elsewhere) collapse
  // to one generic 409 so the response conceals WHICH conflict occurred and any ownership identity. (It does
  // not fully hide existence — ok→200, conflict→409, revoked→403 remain distinguishable; that's acceptable,
  // only the conflict type and owner identity are hidden.)
  return res.status(409).json({ ok: false });
}
