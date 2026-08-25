// Vercel serverless function: permanently delete a player's account + data (Accounts).
// POST { accessToken } (+ deviceId is IGNORED for authority). Verifies the JWT, then deletes the account's
// rows for the devices it OWNS (resolved only from devices.user_id — never the caller body deviceId, never
// the contaminated profiles.user_id), the account's user_state, its devices bindings, and the auth user.
// PR 3 (3B) scope: kills the foreign-device-deletion exploit + adds saves. Full transactional erasure incl.
// `events`, response-checking, and atomicity/rollback remain PR 4 (SEC-4/SEC-5).
import { allowedOrigin, parseBody } from './lib/http.js';
import { admin } from './lib/supabaseAdmin.js';
import { verifyJwt } from './lib/auth.js';
import { ownedDevices } from './lib/device-ownership.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });

  const body = parseBody(req);
  const accessToken = String(body.accessToken || '');
  const who = await verifyJwt(accessToken);
  if (!who) return res.status(401).json({ error: 'invalid session' });
  const uid = who.uid;

  try {
    const enc = encodeURIComponent;
    // AUTHORITY: only the devices this account actually owns (devices.user_id). A caller-supplied deviceId or a
    // historical/contaminated profiles.user_id must never make a foreign device's rows destructible.
    const devices = await ownedDevices(a, uid);
    for (const d of devices) {
      await a.rest(`scores?device_id=eq.${enc(d)}`, { method: 'DELETE' });
      await a.rest(`saves?device_id=eq.${enc(d)}`, { method: 'DELETE' });
      await a.rest(`profiles?device_id=eq.${enc(d)}`, { method: 'DELETE' });
    }
    await a.rest(`user_state?user_id=eq.${uid}`, { method: 'DELETE' });
    // remove the account's device bindings so a deleted user leaves no permanently-bound device
    await a.rest(`devices?user_id=eq.${uid}`, { method: 'DELETE' });
    // finally delete the auth user (admin endpoint)
    await a.auth(`auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'delete failed' });
  }
}
