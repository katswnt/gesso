// Vercel serverless function: permanently + transactionally erase a player's account (PR 4, Part 4B).
// POST { accessToken }. Authority is the JWT ONLY — any body `deviceId` is intentionally ignored (a
// caller-supplied deviceId and the contaminated profiles.user_id must never determine what gets deleted).
//
// Flow (each step response-checked — SEC-5; owned-table completeness + atomicity done in-DB — SEC-4):
//   1. verify JWT → uid.
//   2. erase_account() UNDER THE USER JWT so auth.uid() resolves inside the SECURITY DEFINER function. One
//      transaction: writes a transient tombstone, then deletes every owned table (events/saves/scores/
//      profiles-by-device/user_state/devices) resolved only from devices.user_id = auth.uid(). Any error
//      inside rolls the whole thing back and returns { ok:false }.
//   3. ONLY if erase ok → delete the auth user (admin). 404 == already gone == idempotent success.
//   4. ONLY after the auth user is truly gone → finalize_erasure(uid) removes the tombstone (best-effort;
//      purge_stale_tombstones GCs it if this ever fails, so a lost finalize never blocks the deletion).
import { allowedOrigin, parseBody } from './lib/http.js';
import { admin, userRpc } from './lib/supabaseAdmin.js';
import { verifyJwt } from './lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'forbidden origin' });
  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });

  const body = parseBody(req);
  const accessToken = String(body.accessToken || '');   // deviceId deliberately NOT read — JWT is the sole authority
  const who = await verifyJwt(accessToken);
  if (!who) return res.status(401).json({ error: 'invalid session' });
  const uid = who.uid;

  try {
    // 1. transactional public-data erasure under the user's JWT (auth.uid() inside the definer fn)
    const er = await userRpc('erase_account', {}, accessToken);
    if (!er.ok) return res.status(502).json({ error: 'erase failed' });
    const erased = await er.json().catch(() => null);
    if (!erased || erased.ok !== true) {
      const code = erased && erased.error;
      // no_auth / no_user: the account is already gone (or the JWT no longer resolves) — surface as 401
      if (code === 'no_auth' || code === 'no_user') return res.status(401).json({ error: 'invalid session' });
      return res.status(500).json({ error: 'erase failed' });   // rolled back in-DB, nothing partially deleted
    }

    // 2. delete the auth user. 404 => already deleted on a prior attempt => treat as gone (idempotent retry).
    const del = await a.auth(`auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    if (!del.ok && del.status !== 404) return res.status(500).json({ error: 'auth delete failed' }); // tombstone retained → blocks rebind; retry-safe

    // 3. auth user gone → drop the transient tombstone. finalize_erasure semantics:
    //    - body === true  → tombstone removed; done.
    //    - body === false → finalize PROVES auth.users still has this id, i.e. the auth deletion did NOT take
    //      effect. This is a real inconsistency; return non-2xx so the client NEVER wipes a still-live account.
    //    - non-2xx / transport error / malformed body → outcome unknown; the data + auth-delete already
    //      succeeded and the tombstone remains, so report success with cleanupPending (the cron purge is the
    //      independent backstop).
    let cleanupPending = false;
    try {
      const f = await a.rpc('finalize_erasure', { p_user_id: uid });
      if (f.ok) {
        const body = await f.json().catch(() => undefined);
        if (body === false) { console.error('finalize_erasure false — auth user still present after delete'); return res.status(500).json({ error: 'deletion incomplete' }); }
        if (body !== true) { cleanupPending = true; console.error('finalize_erasure malformed body'); }
      } else { cleanupPending = true; console.error('finalize_erasure status', f.status); }
    } catch (e) { cleanupPending = true; console.error('finalize_erasure error'); }

    return res.status(200).json({ ok: true, counts: erased.counts || null, ...(cleanupPending ? { cleanupPending: true } : {}) });
  } catch (e) {
    return res.status(500).json({ error: 'delete failed' });
  }
}
