// Vercel serverless function: submit a finished DAILY run to the leaderboard (Accounts+Leaderboards Phase 1).
// Storage: Supabase (Postgres via PostgREST). Server-side uses the SECRET key (bypasses RLS) — set it in
// Vercel as SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY). The project URL is public, hardcoded below.
// Anonymous — keyed by a client-generated deviceId. Best-score-per-day guarded. Raw guesses stored for
// later server re-scoring (Phase 4). Abuse controls mirror report.js: origin allowlist, honeypot.
import { SUPABASE_URL } from './_supabase.js';
const TIERS = ['easy', 'medium', 'hard', 'impossible'];
const ROUNDS = 5, MAX_CAT = 2500, MAX_TOTAL = ROUNDS * (4 + 1) * MAX_CAT;

function allowedOrigin(origin) {
  if (!origin) return true;
  try { const h = new URL(origin).hostname; return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app'); }
  catch { return false; }
}
const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });

  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'storage not configured' });
  const rest = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
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

  const name = String(body.name || '').slice(0, 16);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#2230b8';
  const perfects = Math.max(0, Math.min(ROUNDS, parseInt(body.perfects, 10) || 0));
  const masterpieces = Math.max(0, Math.min(ROUNDS, parseInt(body.masterpieces, 10) || 0));

  try {
    // name reservation: don't let this device take a name an OTHER account has claimed
    let useName = name;
    if (name) {
      const claimants = await (await rest(`profiles?name=ilike.${encodeURIComponent(name)}&user_id=not.is.null&select=user_id,device_id`)).json();
      if (Array.isArray(claimants) && claimants.length) {
        const me = await (await rest(`profiles?device_id=eq.${encodeURIComponent(deviceId)}&select=user_id`)).json();
        const myUserId = Array.isArray(me) && me[0] ? me[0].user_id : null;
        if (claimants.some(c => c.user_id && c.user_id !== myUserId)) useName = ''; // reserved → drop it
      }
    }
    // upsert display profile (unique on device_id)
    await rest('profiles?on_conflict=device_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ device_id: deviceId, name: useName, color }) });

    // best-score guard: read existing, only write if this run is higher
    const cur = await (await rest(`scores?device_id=eq.${encodeURIComponent(deviceId)}&date=eq.${date}&tier=eq.${tier}&select=total`)).json();
    const prev = Array.isArray(cur) && cur[0] ? Number(cur[0].total) : null;
    const isBest = prev == null || total > prev;
    if (isBest) {
      // cold = achieved on the FIRST attempt (prev==null); a later run that BEATS it means retries were used → cold:false.
      // The `cold` column may not exist yet: try with it, and self-heal by retrying without it so score writes never break.
      // One-time migration: alter table scores add column if not exists cold boolean not null default false;
      const payload = { device_id: deviceId, date, tier, total, perfects, masterpieces, cold: prev == null, rounds: body.rounds || null, updated_at: new Date().toISOString() };
      const put = () => rest('scores?on_conflict=device_id,date,tier', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(payload) });
      let w = await put();
      if (!w.ok) { delete payload.cold; w = await put(); } // graceful fallback until the cold column is added
      if (!w.ok) { const detail = await w.text().catch(() => ''); return res.status(502).json({ error: 'write failed', status: w.status, detail: detail.slice(0, 200) }); }
    }

    // rank/count must match the leaderboard, which collapses an account's devices to its single best score.
    // Compute it that way here so the recap ("#7 of 30") never disagrees with the board. Wrapped in its own
    // try/catch: the score WRITE already happened above, so a rank-display failure must NEVER 500 the submit —
    // it falls back to the raw per-device count.
    let rank, count;
    try {
      const all = await (await rest(`scores?date=eq.${date}&tier=eq.${tier}&select=device_id,total`)).json();
      const devIds = [...new Set((all || []).map(r => r.device_id))];
      const profByDev = {};
      for (let i = 0; i < devIds.length; i += 100) {
        const chunk = devIds.slice(i, i + 100);
        const ps = await (await rest(`profiles?device_id=in.(${chunk.map(encodeURIComponent).join(',')})&select=device_id,user_id`)).json();
        for (const p of (ps || [])) profByDev[p.device_id] = p;
      }
      const keyOf = dev => { const p = profByDev[dev]; return p && p.user_id ? 'u:' + p.user_id : 'd:' + dev; };
      const best = new Map();
      for (const r of (all || [])) { const k = keyOf(r.device_id); const t = Number(r.total); if (!best.has(k) || t > best.get(k)) best.set(k, t); }
      const myTotal = best.get(keyOf(deviceId)) ?? (isBest ? total : prev);
      count = best.size;
      rank = [...best.values()].filter(t => t > myTotal).length + 1;
    } catch {
      const rankRes = await rest(`scores?date=eq.${date}&tier=eq.${tier}&total=gt.${isBest ? total : prev}&select=device_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      const cntRes = await rest(`scores?date=eq.${date}&tier=eq.${tier}&select=device_id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      const parseCount = r => { const cr = r.headers.get('content-range') || '*/0'; return parseInt(cr.split('/')[1], 10) || 0; };
      rank = parseCount(rankRes) + 1; count = parseCount(cntRes);
    }
    return res.status(200).json({ ok: true, isBest, rank, count });
  } catch (e) {
    return res.status(500).json({ error: 'store failed' });
  }
}
