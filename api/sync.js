// Vercel serverless function: cross-device sync (Accounts Phase 2b). On login, merge this device's local
// identity + streak/mastery/glossary/seen UP into the account, and return the account's canonical state to
// pull DOWN. POST { deviceId, accessToken, streak, mastery, glossary, seen, name, color } + header x-gesso-cap.
// Binding now goes through claim_device() (ownership from devices.user_id via auth.uid()); a device bound to
// another account → 409 with NO merge. CAP_MODE=observe grandfathers a MISSING cap via the legacy bind.
import { allowedOrigin, parseBody } from '../server/api/http.js';
import { admin, userRpc } from '../server/api/supabaseAdmin.js';
import { verifyJwt } from '../server/api/auth.js';
import { bindDecision, logAdoption, callGuarded, guardedWriteToHttp, guardedClaimToHttp } from '../server/api/device-ownership.js';

// merge two streak objects, taking the better of each (max counts, union of played dates, max per-date score)
function mergeStreak(a, b){
  a=a||{}; b=b||{}; const out={
    current: Math.max(+a.current||0, +b.current||0),
    longest: Math.max(+a.longest||0, +b.longest||0),
    lastPlayed: (a.lastPlayed||'') > (b.lastPlayed||'') ? a.lastPlayed : b.lastPlayed,
    playedDates: [...new Set([...(a.playedDates||[]), ...(b.playedDates||[])])].sort(),
    scores: { ...(a.scores||{}) }, byDay: { ...(a.byDay||{}) },
  };
  for(const [d,v] of Object.entries(b.scores||{})) out.scores[d] = Math.max(+out.scores[d]||0, +v||0);
  for(const [d,tiers] of Object.entries(b.byDay||{})){ out.byDay[d]={...(out.byDay[d]||{})}; for(const [t,v] of Object.entries(tiers||{})) out.byDay[d][t]=Math.max(+out.byDay[d][t]||0, +v||0); }
  return out;
}
// element-wise MAX per bucket/key — idempotent + monotonic (re-syncing never double-counts)
function mergeMastery(a, b){
  a=a&&typeof a==='object'?a:{}; b=b&&typeof b==='object'?b:{}; const out={};
  for(const bucket of new Set([...Object.keys(a), ...Object.keys(b)])){
    const A=a[bucket]||{}, B=b[bucket]||{}, ob=out[bucket]={};
    for(const k of new Set([...Object.keys(A), ...Object.keys(B)])){
      const x=A[k]||{}, y=B[k]||{};
      ob[k]={ correct: Math.max(+x.correct||0, +y.correct||0), total: Math.max(+x.total||0, +y.total||0) };
    }
  }
  return out;
}
// glossary = {met:{name->first-met date}, pending:[names]} — keep the EARLIEST first-met per name, union pending.
function mergeGlossary(a, b){
  a=a&&typeof a==='object'?a:{}; b=b&&typeof b==='object'?b:{};
  const met={...(a.met||{})};
  for(const [name,date] of Object.entries(b.met||{})){ const cur=met[name]; met[name] = (cur && cur<=date) ? cur : date; }
  const pending=[...new Set([...(Array.isArray(a.pending)?a.pending:[]), ...(Array.isArray(b.pending)?b.pending:[])])];
  return { met, pending };
}
function mergeSeen(a, b){ return [...new Set([...(Array.isArray(a)?a:[]), ...(Array.isArray(b)?b:[])])]; }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });
  const rest = a.rest;

  const body = parseBody(req);
  const deviceId = String(body.deviceId || '').slice(0, 64);
  const accessToken = String(body.accessToken || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return res.status(400).json({ error: 'bad deviceId' });
  const who = await verifyJwt(accessToken);
  if (!who) return res.status(401).json({ error: 'invalid session' });
  const uid = who.uid;

  try {
    // ---- BIND (authorized) ----
    const d = bindDecision(req, 'sync');
    if (d.action === 'reject') return res.status(d.status).json({ error: d.reason });
    const verified = d.action === 'claim';
    if (verified) {   // VERIFIED-CAP: bind + profiles.user_id projection under the held locks
      const j = await callGuarded(userRpc('guarded_claim_device', { p_device_id: deviceId, p_capability_hash: d.hash }, accessToken));
      logAdoption('sync', d.mode, (j && j.result) || (j && j.error) || 'error');
      const http = guardedClaimToHttp(j);   // consistency-checked; conflict_other_user → 409, no merge
      if (!http.ok) return res.status(http.status).json({ error: http.reason });
    } else {
      // LEGACY (observe + missing cap): OLD unowned profiles bind, kept until enforce
      logAdoption('sync', d.mode, 'legacy');
      const b = await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid }) });
      if (!b.ok) return res.status(502).json({ error: 'bind failed' });
    }

    // ---- CANONICAL IDENTITY: prefer a name/color already on any of the account's profiles; else this device's ----
    const profs = await (await rest(`profiles?user_id=eq.${uid}&select=name,color,device_id`)).json();
    let name='', color='';
    for (const p of (profs||[])) { if (p.name && !name) name=p.name; if (p.color && !color) color=p.color; }
    if (!name && body.name) name=String(body.name).slice(0,16);
    if (!color && /^#[0-9a-fA-F]{6}$/.test(body.color||'')) color=body.color;
    if (verified) {   // name/color projection through the locked, erasure-serialized fn (preserves user_id)
      const h = guardedWriteToHttp(await callGuarded(a.rpc('guarded_profile', { p_device_id: deviceId, p_capability_hash: d.hash, p_name: name, p_color: color })));
      if (!h.ok) return res.status(h.status).json({ error: h.reason });
    } else {
      const w = await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid, name, color }) });
      if (!w.ok) return res.status(502).json({ error: 'identity write failed' });
    }

    // ---- user_state: ONE checked 4-column read → ONE JS merge → ONE guarded write (no partial fallback) ----
    const usr = await rest(`user_state?user_id=eq.${uid}&select=streak,mastery,glossary,seen`);
    if (!usr.ok) return res.status(502).json({ error: 'state read failed' });
    let arr; try { arr = await usr.json(); } catch { arr = null; }
    if (!Array.isArray(arr) || arr.length > 1) return res.status(502).json({ error: 'state read malformed' });   // user_id is unique → 0 or 1 rows; >1 is malformed
    let row;
    if (arr.length === 0) { row = {}; }   // genuinely empty (first sync) → merge from nothing
    else {
      row = arr[0];
      // an existing row MUST carry all four selected columns; a partial row must NOT overwrite stored values with empty defaults
      if (!row || typeof row !== 'object' || !['streak', 'mastery', 'glossary', 'seen'].every(k => Object.prototype.hasOwnProperty.call(row, k)))
        return res.status(502).json({ error: 'state read malformed' });
    }
    const mergedStreak = mergeStreak(row.streak, body.streak);
    const mergedMastery = mergeMastery(row.mastery, body.mastery);
    const mergedGlossary = mergeGlossary(row.glossary, body.glossary);
    const mergedSeen = mergeSeen(row.seen, body.seen);
    // guarded_user_state is JWT-authenticated (auth.users lock) → used in BOTH observe branches
    const us = guardedWriteToHttp(await callGuarded(userRpc('guarded_user_state', { p_streak: mergedStreak, p_mastery: mergedMastery, p_glossary: mergedGlossary, p_seen: mergedSeen }, accessToken)));
    if (!us.ok) return res.status(us.status).json({ error: us.reason });

    return res.status(200).json({ ok: true, name, color, streak: mergedStreak, mastery: mergedMastery, glossary: mergedGlossary, seen: mergedSeen });
  } catch (e) {
    return res.status(500).json({ error: 'sync failed' });
  }
}
