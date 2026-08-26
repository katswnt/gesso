// Vercel serverless function: "My Gallery" — save/unsave artworks for a device.
//   GET    /api/saves?me=<deviceId>        -> { ids: [...] }   (header x-gesso-cap)
//   POST   /api/saves { deviceId, workId }  -> upsert (idempotent)
//   DELETE /api/saves { deviceId, workId }  -> remove across the account's devices
// A device's gallery is private, so every method is capability-gated (CAP_MODE observe grandfathers a
// MISSING cap only). Account devices are resolved from devices.user_id (authoritative); the legacy
// profiles-based resolution is used only for grandfathered missing-cap requests during the observe window.
import { allowedOrigin, parseBody } from '../server/api/http.js';
import { admin } from '../server/api/supabaseAdmin.js';
import { requireDeviceCap, ownedDevices, legacyOwnedDevices } from '../server/api/device-ownership.js';

const MAX_SAVES = 1000;
const okDevice = d => /^[A-Za-z0-9_-]{8,64}$/.test(d);
const okWork = w => typeof w === 'string' && w.length > 0 && w.length <= 200;

export default async function handler(req, res) {
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });
  const rest = a.rest;

  // account devices: verified → devices.user_id; unbound-but-verified → just this device; legacy → old profiles path
  async function resolveDevs(gate, dev) {
    if (gate.legacy) return await legacyOwnedDevices(a, dev);
    if (gate.user_id) return [...new Set([dev, ...await ownedDevices(a, gate.user_id)])];
    return [dev];
  }

  // ---- GET ----
  if (req.method === 'GET') {
    const me = String(req.query.me || '').slice(0, 64);
    if (!okDevice(me)) return res.status(400).json({ error: 'bad deviceId' });
    const gate = await requireDeviceCap(req, a, me, 'saves.get');
    if (!gate.ok) return res.status(gate.status).json({ error: gate.reason });
    try {
      const devs = await resolveDevs(gate, me);
      const r = await rest(`saves?device_id=in.(${devs.map(encodeURIComponent).join(',')})&order=created_at.desc&select=work_id`);
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      const rows = await r.json();
      const seen = new Set(), ids = [];
      for (const x of (Array.isArray(rows) ? rows : [])) if (x.work_id && !seen.has(x.work_id)) { seen.add(x.work_id); ids.push(x.work_id); }
      return res.status(200).json({ ids });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  // ---- POST / DELETE ----
  const body = parseBody(req);
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const workId = String(body.workId || '');
  if (!okDevice(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!okWork(workId)) return res.status(400).json({ error: 'bad workId' });
  const gate = await requireDeviceCap(req, a, deviceId, 'saves.write');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.reason });

  if (req.method === 'POST') {
    try {
      const cnt = await (await rest(`saves?device_id=eq.${encodeURIComponent(deviceId)}&select=work_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } })).headers.get('content-range');
      const total = cnt ? parseInt(String(cnt).split('/')[1], 10) || 0 : 0;
      if (total >= MAX_SAVES) return res.status(409).json({ error: 'gallery full', max: MAX_SAVES });
      const r = await rest('saves', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ device_id: deviceId, work_id: workId }) });
      if (!r.ok && r.status !== 409) return res.status(502).json({ error: 'upstream' });
      return res.status(200).json({ ok: true, saved: true });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  if (req.method === 'DELETE') {
    try {
      const devs = await resolveDevs(gate, deviceId);
      const r = await rest(`saves?device_id=in.(${devs.map(encodeURIComponent).join(',')})&work_id=eq.${encodeURIComponent(workId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      return res.status(200).json({ ok: true, saved: false });
    } catch { return res.status(502).json({ error: 'upstream' }); }
  }

  return res.status(405).json({ error: 'GET, POST, or DELETE only' });
}
