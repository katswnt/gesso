// Vercel serverless function: bind a device to a logged-in account (Accounts Phase 2).
// POST { deviceId, accessToken } + header x-gesso-cap. Binding now goes through the hardened
// claim_device() SECURITY DEFINER function under the USER's JWT (identity from auth.uid(), ownership from
// devices.user_id) — a device is bound only if unclaimed or already same-user; another user's device → 409.
// CAP_MODE=observe grandfathers a MISSING capability via the legacy profiles bind; enforce requires it.
import { allowedOrigin, parseBody } from '../server/api/http.js';
import { admin, userRpc } from '../server/api/supabaseAdmin.js';
import { verifyJwt } from '../server/api/auth.js';
import { bindDecision, logAdoption, callGuarded, guardedClaimToHttp } from '../server/api/device-ownership.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });

  const body = parseBody(req);
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const accessToken = String(body.accessToken || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  const who = await verifyJwt(accessToken);
  if (!who) return res.status(401).json({ error: 'invalid session' });
  const uid = who.uid;

  try {
    const d = bindDecision(req, 'claim');
    if (d.action === 'reject') return res.status(d.status).json({ error: d.reason });

    if (d.action === 'claim') {
      // VERIFIED-CAP: bind + profiles.user_id projection under the held locks (erasure-serialized). j.result
      // carries the full claim outcome; a transport/malformed reply → undefined → claimResultToHttp → 502 (no raw write).
      const j = await callGuarded(userRpc('guarded_claim_device', { p_device_id: deviceId, p_capability_hash: d.hash }, accessToken));
      logAdoption('claim', d.mode, (j && j.result) || (j && j.error) || 'error');
      const http = guardedClaimToHttp(j);   // rejects contradictory/absent envelopes as 502; never trusts result over ok
      if (!http.ok) return res.status(http.status).json({ error: http.reason });
      return res.status(200).json({ ok: true, userId: uid });
    }

    // legacy (observe + missing cap): the OLD profiles bind, kept working until enforce
    logAdoption('claim', d.mode, 'legacy');
    const w = await a.rest('profiles?on_conflict=device_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid }) });
    if (!w.ok) { const t = await w.text().catch(() => ''); return res.status(502).json({ error: 'bind failed', detail: t.slice(0, 200) }); }
    return res.status(200).json({ ok: true, userId: uid, legacy: true });
  } catch (e) {
    return res.status(500).json({ error: 'claim failed' });
  }
}
