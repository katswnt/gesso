// Vercel serverless function: submit a finished DAILY run to the leaderboard (Accounts+Leaderboards Phase 1).
// Storage: Supabase (Postgres via PostgREST). Server-side uses the SECRET key (bypasses RLS) — set it in
// Vercel as SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY). The project URL is public, hardcoded below.
// Anonymous — keyed by a client-generated deviceId. Best-score-per-day guarded. Raw guesses stored for
// later server re-scoring (Phase 4). Abuse controls mirror report.js: origin allowlist, honeypot.
import { allowedOrigin, parseBody } from '../server/api/http.js';
import { isBlockedName } from '../server/api/moderation.js';
import { admin } from '../server/api/supabaseAdmin.js';
import { requireDeviceCap, callGuarded, guardedWriteToHttp } from '../server/api/device-ownership.js';
const TIERS = ['easy', 'medium', 'hard', 'impossible'];
const ROUNDS = 5, MAX_CAT = 2500, MAX_TOTAL = ROUNDS * (4 + 1) * MAX_CAT;
const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });
  const rest = a.rest;

  const body = parseBody(req);
  if (body.hp) return res.status(200).json({ ok: true }); // honeypot

  const deviceId = String(body.deviceId || '').slice(0, 64);
  const date = String(body.date || ''), tier = String(body.tier || ''), total = Number(body.total);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  if (!isDateStr(date)) return res.status(400).json({ error: 'bad date' });
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'bad tier' });
  if (!Number.isFinite(total) || total < 0 || total > MAX_TOTAL) return res.status(400).json({ error: 'bad total' });
  // Allow any non-future daily (covers backfill of pre-account history). tomorrow-UTC ceiling absorbs
  // client-timezone skew; floor guards junk. The model already trusts client totals (raw guesses stored
  // for Phase-4 re-scoring) and the best-score guard prevents inflation, so opening past dates is safe.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (date > tomorrow) return res.status(400).json({ error: 'date in future' });
  if (date < '2025-01-01') return res.status(400).json({ error: 'date too old' });

  // score writes the device's profile + scores → capability-gated (kills bare-deviceId score/profile writes).
  const gate = await requireDeviceCap(req, a, deviceId, 'score');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.reason });

  const rawName = String(body.name || '').slice(0, 16);
  const name = isBlockedName(rawName) ? '' : rawName; // blocked names fall back to the default handle
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#2230b8';
  const perfects = Math.max(0, Math.min(ROUNDS, parseInt(body.perfects, 10) || 0));
  const masterpieces = Math.max(0, Math.min(ROUNDS, parseInt(body.masterpieces, 10) || 0));

  try {
    // name reservation: don't let this device take a name an OTHER account has claimed
    let useName = name;
    if (name) {
      const claimants = await (await rest(`profiles?name=ilike.${encodeURIComponent(name)}&user_id=not.is.null&select=user_id,device_id`)).json();
      if (Array.isArray(claimants) && claimants.length) {
        // caller identity from the authoritative devices.user_id (verified); profiles projection only on the legacy path
        let myUserId = gate.user_id || null;
        if (gate.legacy) { const me = await (await rest(`profiles?device_id=eq.${encodeURIComponent(deviceId)}&select=user_id`)).json(); myUserId = Array.isArray(me) && me[0] ? me[0].user_id : null; }
        if (claimants.some(c => c.user_id && c.user_id !== myUserId)) useName = ''; // reserved → drop it
      }
    }
    let isBest, finalTotal;
    if (gate.verified) {   // VERIFIED-CAP: scores + name/color projection, best decided UNDER the device lock (erasure-serialized)
      const j = await callGuarded(a.rpc('guarded_score', { p_device_id: deviceId, p_capability_hash: gate.hash, p_date: date, p_tier: tier, p_total: total, p_perfects: perfects, p_masterpieces: masterpieces, p_rounds: body.rounds || null, p_name: useName, p_color: color }), jj => typeof jj.isBest === 'boolean' && typeof jj.storedTotal === 'number' && Number.isFinite(jj.storedTotal));
      const h = guardedWriteToHttp(j);
      if (!h.ok) return res.status(h.status).json({ error: h.reason });
      isBest = j.isBest === true; finalTotal = Number(j.storedTotal);
    } else {
      // LEGACY (observe + missing cap): raw projection + best-score guard — temporary until enforce
      await rest('profiles?on_conflict=device_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ device_id: deviceId, name: useName, color }) });
      const cur = await (await rest(`scores?device_id=eq.${encodeURIComponent(deviceId)}&date=eq.${date}&tier=eq.${tier}&select=total`)).json();
      const prev = Array.isArray(cur) && cur[0] ? Number(cur[0].total) : null;
      isBest = prev == null || total > prev; finalTotal = isBest ? total : prev;
      if (isBest) {
        const payload = { device_id: deviceId, date, tier, total, perfects, masterpieces, cold: prev == null, rounds: body.rounds || null, updated_at: new Date().toISOString() };
        const put = () => rest('scores?on_conflict=device_id,date,tier', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(payload) });
        let w = await put();
        if (!w.ok) { delete payload.cold; w = await put(); } // graceful fallback until the cold column is added
        if (!w.ok) { const detail = await w.text().catch(() => ''); return res.status(502).json({ error: 'write failed', status: w.status, detail: detail.slice(0, 200) }); }
      }
    }

    // Rank/count via two exact COUNT queries instead of reading every score on each submit (that was O(n) per
    // submission and would not survive a traffic spike). The board collapses a signed-in account's devices to
    // its best score; this per-device count can differ from the board only for an account that played the same
    // day+tier on several devices, by at most its extra devices. Display-only — the score WRITE already happened,
    // so a count failure must never 500 the submit.
    let rank = null, count = null;
    try {
      const rankRes = await rest(`scores?date=eq.${date}&tier=eq.${tier}&total=gt.${finalTotal}&select=device_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      const cntRes = await rest(`scores?date=eq.${date}&tier=eq.${tier}&select=device_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      const parseCount = r => { const cr = r.headers.get('content-range') || '*/0'; return parseInt(cr.split('/')[1], 10) || 0; };
      rank = parseCount(rankRes) + 1; count = parseCount(cntRes);
    } catch { /* display-only */ }
    return res.status(200).json({ ok: true, isBest, rank, count });
  } catch (e) {
    return res.status(500).json({ error: 'store failed' });
  }
}
