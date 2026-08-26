// Verify a Supabase access token → the authenticated user id. Deduped from claim/sync/delete-account.
import { SUPABASE_URL, SUPA_ANON } from '../../api/_supabase.js';

export async function verifyJwt(accessToken) {
  if (!accessToken) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? { uid: u.id } : null;
  } catch { return null; }
}
