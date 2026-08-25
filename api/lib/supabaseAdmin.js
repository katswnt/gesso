// Confines all service-role (RLS-bypassing) Supabase access + the user-JWT RPC path to one reviewed module.
// This is also the single network boundary the api-device-ownership tests stub (globalThis.fetch).
import { SUPABASE_URL, SUPA_ANON } from '../_supabase.js';

export function secretKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

// Service-role request headers. Modern sb_secret_… (and sb_publishable_…) keys belong in `apikey` ONLY —
// putting them in Authorization: Bearer can be rejected. Only legacy JWT service-role keys (eyJ…) also go in
// the bearer. Exported for header-contract tests. See Supabase key-migration + auth-headers docs.
export function svcHeaders(key, extra) {
  const isJwt = /^eyJ/.test(key || '');
  return { apikey: key, ...(isJwt ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...(extra || {}) };
}

// Service-role client. Returns null when the key is absent (handlers should 503).
export function admin() {
  const key = secretKey();
  if (!key) return null;
  const hdr = extra => svcHeaders(key, extra);
  return {
    rest: (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: hdr(opts.headers) }),
    rpc:  (fn, args)        => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(), body: JSON.stringify(args || {}) }),
    auth: (path, opts = {}) => fetch(`${SUPABASE_URL}/${path}`, { ...opts, headers: hdr(opts.headers) }),
  };
}

// RPC executed UNDER the user's JWT (anon apikey + user bearer) so auth.uid() resolves inside the
// SECURITY DEFINER function — never a caller-supplied uid. Used for claim_device.
export function userRpc(fn, args, accessToken) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
}
