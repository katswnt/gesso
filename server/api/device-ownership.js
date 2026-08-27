// The single device-authorization boundary for PR 3. Implements the CAP_MODE observe/enforce state
// machine, capability verification against the `devices` table, the bind decision for claim/sync, and
// owned-device resolution from `devices.user_id` (the SOLE authority — never profiles.user_id).
//
// State machine (per gated endpoint):
//   valid matching cap        -> allow          (both modes)
//   missing cap               -> legacy+log     (observe) | reject (enforce)
//   malformed cap             -> reject         (both modes)
//   wrong cap (hash mismatch) -> reject         (both modes)
//   unregistered (cap present)-> reject         (both modes)
//   revoked device            -> reject         (both modes)
import { createHash } from 'node:crypto';

const CAP_HEADER = 'x-gesso-cap';
// Client mints 32 random bytes -> base64url (43 chars, no padding). Server stores only its SHA-256 (64-hex).
const RAW_RE = /^[A-Za-z0-9_-]{43}$/;
const ENFORCE_AFTER = Date.parse('2026-09-24T00:00:00Z');

const sha256hex = s => createHash('sha256').update(String(s)).digest('hex');

// CAP_MODE precedence: explicit observe overrides the deadline (rollback); explicit enforce forces it;
// unset -> deadline decides; ANY other value fails closed (enforce).
export function capMode() {
  const m = String(process.env.CAP_MODE || '').trim().toLowerCase();
  if (m === 'observe') return 'observe';
  if (m === 'enforce') return 'enforce';
  if (m === '') return Date.now() >= ENFORCE_AFTER ? 'enforce' : 'observe';
  return 'enforce'; // invalid value -> fail closed
}

// Classify the capability header. { present:false } | { present:true, malformed:true } | { present:true, hash }
export function readCap(req) {
  const raw = req && req.headers ? req.headers[CAP_HEADER] : undefined;
  if (raw == null || raw === '') return { present: false };
  if (typeof raw !== 'string' || !RAW_RE.test(raw)) return { present: true, malformed: true };
  return { present: true, hash: sha256hex(raw) };
}

// Server-side adoption metric at the authorization boundary (non-enumerating: no device ids / hashes).
export function logAdoption(endpoint, mode, state) {
  try { console.log(JSON.stringify({ t: 'cap', ep: endpoint, mode, state })); } catch {}
}

// Read-only ownership check via the service role (anon/authenticated cannot read devices).
export async function verifyDeviceCap(admin, deviceId, hash) {
  try {
    const r = await admin.rest(`devices?device_id=eq.${encodeURIComponent(deviceId)}&select=capability_hash,revoked_at,user_id`);
    if (!r.ok) return { state: 'error' };
    const rows = await r.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row) return { state: 'unregistered' };
    if (row.revoked_at) return { state: 'revoked' };
    if (row.capability_hash !== hash) return { state: 'bad_capability' };
    return { state: 'ok', user_id: row.user_id };
  } catch { return { state: 'error' }; }
}

// Gate for device-scoped endpoints (saves/profile/score). Returns {ok:true, legacy|verified, user_id} or
// {ok:false, status, reason}. Only a MISSING cap is grandfathered, and only in observe.
export async function requireDeviceCap(req, admin, deviceId, endpoint) {
  const mode = capMode();
  const cap = readCap(req);
  if (cap.malformed) { logAdoption(endpoint, mode, 'malformed'); return { ok: false, status: 400, reason: 'malformed capability', mode }; }
  if (!cap.present) {
    logAdoption(endpoint, mode, 'missing');
    if (mode === 'enforce') return { ok: false, status: 401, reason: 'capability required', mode };
    return { ok: true, legacy: true, mode };
  }
  const v = await verifyDeviceCap(admin, deviceId, cap.hash);
  logAdoption(endpoint, mode, v.state);
  if (v.state === 'ok') return { ok: true, verified: true, hash: cap.hash, user_id: v.user_id, mode };
  if (v.state === 'unregistered') return { ok: false, status: 401, reason: 'unregistered device', mode };
  if (v.state === 'revoked') return { ok: false, status: 403, reason: 'device revoked', mode };
  if (v.state === 'bad_capability') return { ok: false, status: 401, reason: 'bad capability', mode };
  return { ok: false, status: 502, reason: 'ownership check failed', mode };
}

// Bind decision for claim/sync. Returns {action:'reject',status,reason} | {action:'legacy'} (observe+missing)
// | {action:'claim', hash} (present+well-formed -> caller runs claim_device RPC which does the real checks).
export function bindDecision(req, endpoint) {
  const mode = capMode();
  const cap = readCap(req);
  if (cap.malformed) { logAdoption(endpoint, mode, 'malformed'); return { action: 'reject', status: 400, reason: 'malformed capability', mode }; }
  if (!cap.present) {
    logAdoption(endpoint, mode, 'missing');
    if (mode === 'enforce') return { action: 'reject', status: 401, reason: 'capability required', mode };
    return { action: 'legacy', mode };
  }
  return { action: 'claim', hash: cap.hash, mode };
}

// Map a claim_device RPC scalar result to an HTTP outcome.
export function claimResultToHttp(result) {
  switch (result) {
    case 'bound':
    case 'already_bound_same_user': return { ok: true, result };
    case 'conflict_other_user':     return { ok: false, status: 409, reason: 'device belongs to another account' };
    case 'unregistered':            return { ok: false, status: 409, reason: 'device not registered' };
    case 'revoked':                 return { ok: false, status: 403, reason: 'device revoked' };
    case 'bad_capability':          return { ok: false, status: 401, reason: 'bad capability' };
    case 'no_auth':                 return { ok: false, status: 401, reason: 'no auth' };
    case 'no_user':                 return { ok: false, status: 401, reason: 'no user' };          // JWT for a deleted account
    case 'erased':                  return { ok: false, status: 410, reason: 'account erased' };    // tombstoned mid-erasure
    case 'bad_device':              return { ok: false, status: 400, reason: 'bad device' };
    default:                        return { ok: false, status: 502, reason: 'claim failed' };
  }
}

// Await a guarded_* RPC (fetch promise) and return its structured JSON result. Any transport/non-2xx or
// malformed (non-{ok:boolean}) response becomes {ok:false,error:'transport'|'malformed'} so the caller can map
// it to a definite non-2xx WITHOUT ever falling back to a raw write.
export async function callGuarded(fetchPromise, validateSuccess) {
  try {
    const r = await fetchPromise;
    if (!r.ok) return { ok: false, error: 'transport', status: r.status };
    const j = await r.json().catch(() => null);
    if (!j || typeof j.ok !== 'boolean') return { ok: false, error: 'malformed' };
    if (j.ok === true) {
      if (j.error != null) return { ok: false, error: 'malformed' };                                    // a success must NOT carry an error
      if (typeof validateSuccess === 'function' && !validateSuccess(j)) return { ok: false, error: 'malformed' };  // + function-specific success shape
    } else if (typeof j.error !== 'string' || j.error.length === 0) {
      return { ok: false, error: 'malformed' };                                                          // a failure MUST carry a string error
    }
    return j;
  } catch { return { ok: false, error: 'transport' }; }
}

// Map a guarded_claim_device envelope to HTTP. Requires full internal consistency — never trust `result`
// independently of `ok`: a bind result must be ok:true with no error; any other result must be ok:false with
// error === result. A contradictory/absent envelope → 502.
export function guardedClaimToHttp(j) {
  if (!j || typeof j.result !== 'string') return { ok: false, status: 502, reason: 'claim failed' };
  const bind = j.result === 'bound' || j.result === 'already_bound_same_user';
  if (bind) { if (j.ok !== true || j.error != null) return { ok: false, status: 502, reason: 'claim failed' }; }
  else { if (j.ok !== false || j.error !== j.result) return { ok: false, status: 502, reason: 'claim failed' }; }
  return claimResultToHttp(j.result);
}

// Map a guarded write result ({ok:true,...} or {ok:false,error}) to an HTTP outcome.
export function guardedWriteToHttp(j) {
  if (j && j.ok === true) return { ok: true };
  switch (j && j.error) {
    case 'full':           return { ok: false, status: 409, reason: 'gallery full' };
    case 'erased':         return { ok: false, status: 410, reason: 'account erased' };
    case 'no_user':        return { ok: false, status: 401, reason: 'no user' };
    case 'no_auth':        return { ok: false, status: 401, reason: 'no auth' };
    case 'revoked':        return { ok: false, status: 403, reason: 'device revoked' };
    case 'unregistered':   return { ok: false, status: 409, reason: 'device not registered' };
    case 'bad_capability': return { ok: false, status: 401, reason: 'bad capability' };
    case 'bad_device':     return { ok: false, status: 400, reason: 'bad device' };
    case 'bad_work':       return { ok: false, status: 400, reason: 'bad work' };
    case 'bad_total':      return { ok: false, status: 400, reason: 'bad total' };
    default:               return { ok: false, status: 502, reason: 'write failed' };   // transport/malformed
  }
}

// Run claim_device under the user's JWT. Returns the scalar result string (or null on transport error).
export async function claimDevice(userRpc, deviceId, hash, accessToken) {
  try {
    const r = await userRpc('claim_device', { p_device_id: deviceId, p_capability_hash: hash }, accessToken);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Service-role register (first-contact mint). Returns the scalar result string (or null).
export async function registerDevice(admin, deviceId, hash) {
  try {
    const r = await admin.rpc('register_device', { p_device_id: deviceId, p_capability_hash: hash });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// The account's device_ids — resolved ONLY from devices.user_id (authoritative), never profiles.user_id.
export async function ownedDevices(admin, uid) {
  try {
    const r = await admin.rest(`devices?user_id=eq.${encodeURIComponent(uid)}&select=device_id`);
    if (!r.ok) return [];
    const rows = await r.json();
    return [...new Set((Array.isArray(rows) ? rows : []).map(x => x.device_id).filter(Boolean))];
  } catch { return []; }
}

// Legacy (observe + missing-cap) account resolution via profiles.user_id — the OLD, weaker path, kept only
// so pre-capability clients keep working during the observe window. Never used in enforce mode.
export async function legacyOwnedDevices(admin, deviceId) {
  try {
    const p = await (await admin.rest(`profiles?device_id=eq.${encodeURIComponent(deviceId)}&select=user_id`)).json();
    const uid = Array.isArray(p) && p[0] && p[0].user_id;
    if (!uid) return [deviceId];
    const ds = await (await admin.rest(`profiles?user_id=eq.${encodeURIComponent(uid)}&select=device_id`)).json();
    return [...new Set([deviceId, ...((Array.isArray(ds) ? ds : []).map(x => x.device_id).filter(Boolean))])];
  } catch { return [deviceId]; }
}
