// Vercel serverless function: update a device's leaderboard display name/color. POST { deviceId, name, color }
// + header x-gesso-cap. Device-scoped, so capability-gated (CAP_MODE observe grandfathers a MISSING cap only).
// Honors the name-reservation rule (a name held by another ACCOUNT is dropped).
import { allowedOrigin, parseBody } from '../server/api/http.js';
import { admin } from '../server/api/supabaseAdmin.js';
import { requireDeviceCap } from '../server/api/device-ownership.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });
  const rest = a.rest;

  const body = parseBody(req);
  const deviceId = String(body.deviceId || '').slice(0, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  const gate = await requireDeviceCap(req, a, deviceId, 'profile');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.reason });

  let name = String(body.name || '').slice(0, 16);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#2230b8';
  try {
    if (name) { // drop a name another account has reserved
      const claimants = await (await rest(`profiles?name=ilike.${encodeURIComponent(name)}&user_id=not.is.null&select=user_id`)).json();
      if (Array.isArray(claimants) && claimants.length) {
        // caller identity: authoritative devices.user_id for a verified request; profiles projection only on
        // the observe-mode legacy (missing-cap) path — never let a contaminated projection grant a name.
        let myUserId = gate.user_id || null;
        if (gate.legacy) { const me = await (await rest(`profiles?device_id=eq.${encodeURIComponent(deviceId)}&select=user_id`)).json(); myUserId = Array.isArray(me) && me[0] ? me[0].user_id : null; }
        if (claimants.some(c => c.user_id && c.user_id !== myUserId)) return res.status(409).json({ error: 'name reserved' });
      }
    }
    const w = await rest('profiles?on_conflict=device_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, name, color }) });
    if (!w.ok) { const d = await w.text().catch(() => ''); return res.status(502).json({ error: 'write failed', detail: d.slice(0, 200) }); }
    return res.status(200).json({ ok: true, name, color });
  } catch (e) {
    return res.status(500).json({ error: 'update failed' });
  }
}
