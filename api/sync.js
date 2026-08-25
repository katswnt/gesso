// Vercel serverless function: cross-device sync (Accounts Phase 2b). On login, merge this device's local
// identity + streak/mastery/glossary/seen UP into the account, and return the account's canonical state to
// pull DOWN. POST { deviceId, accessToken, streak, mastery, glossary, seen, name, color } + header x-gesso-cap.
// Binding now goes through claim_device() (ownership from devices.user_id via auth.uid()); a device bound to
// another account → 409 with NO merge. CAP_MODE=observe grandfathers a MISSING cap via the legacy bind.
import { allowedOrigin, parseBody } from './lib/http.js';
import { admin, userRpc } from './lib/supabaseAdmin.js';
import { verifyJwt } from './lib/auth.js';
import { bindDecision, claimDevice, claimResultToHttp, logAdoption } from './lib/device-ownership.js';

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
    if (d.action === 'claim') {
      const result = await claimDevice(userRpc, deviceId, d.hash, accessToken);
      logAdoption('sync', d.mode, result || 'error');
      const http = claimResultToHttp(result);
      if (!http.ok) return res.status(http.status).json({ error: http.reason }); // e.g. conflict_other_user → 409, no merge
      await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid }) });
    } else {
      // legacy (observe + missing cap): OLD unowned profiles bind, kept until enforce
      logAdoption('sync', d.mode, 'legacy');
      await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid }) });
    }

    // ---- state merge (all uid-keyed; identity from the verified JWT, never the body deviceId) ----
    // CANONICAL IDENTITY: prefer a name/color already on any of the account's profiles; else adopt this device's local one
    const profs = await (await rest(`profiles?user_id=eq.${uid}&select=name,color,device_id`)).json();
    let name='', color='';
    for (const p of (profs||[])) { if (p.name && !name) name=p.name; if (p.color && !color) color=p.color; }
    if (!name && body.name) name=String(body.name).slice(0,16);
    if (!color && /^#[0-9a-fA-F]{6}$/.test(body.color||'')) color=body.color;
    await rest('profiles?on_conflict=device_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ device_id: deviceId, user_id: uid, name, color }) });

    // STREAK
    let serverStreak=null;
    try { const st = await (await rest(`user_state?user_id=eq.${uid}&select=streak`)).json(); serverStreak = Array.isArray(st)&&st[0]?st[0].streak:null; } catch {}
    const merged = mergeStreak(serverStreak, body.streak);
    try { await rest('user_state?on_conflict=user_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: uid, streak: merged, updated_at: new Date().toISOString() }) }); } catch {}

    // MASTERY ("Your Eye") — own try/catch so a not-yet-migrated column no-ops
    let mergedMastery = body.mastery || null;
    try {
      const ms = await (await rest(`user_state?user_id=eq.${uid}&select=mastery`)).json();
      const serverMastery = Array.isArray(ms) && ms[0] ? ms[0].mastery : null;
      mergedMastery = mergeMastery(serverMastery, body.mastery);
      await rest('user_state?on_conflict=user_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: uid, mastery: mergedMastery, updated_at: new Date().toISOString() }) });
    } catch { mergedMastery = body.mastery || null; }

    // GLOSSARY + SEEN — own try/catch (columns added by db/user_state-glossary-seen.sql)
    let mergedGlossary = body.glossary || null, mergedSeen = Array.isArray(body.seen) ? body.seen : null;
    try {
      const gs = await (await rest(`user_state?user_id=eq.${uid}&select=glossary,seen`)).json();
      const row = Array.isArray(gs) && gs[0] ? gs[0] : {};
      mergedGlossary = mergeGlossary(row.glossary, body.glossary);
      mergedSeen = mergeSeen(row.seen, body.seen);
      await rest('user_state?on_conflict=user_id', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: uid, glossary: mergedGlossary, seen: mergedSeen, updated_at: new Date().toISOString() }) });
    } catch { mergedGlossary = body.glossary || null; mergedSeen = Array.isArray(body.seen) ? body.seen : null; }

    return res.status(200).json({ ok: true, name, color, streak: merged, mastery: mergedMastery, glossary: mergedGlossary, seen: mergedSeen });
  } catch (e) {
    return res.status(500).json({ error: 'sync failed' });
  }
}
