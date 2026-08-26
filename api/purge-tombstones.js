// Scheduled backstop (PR 4B): GC transient account tombstones whose auth.users row is already gone — i.e. a
// finalize_erasure that never completed (the delete-account handler returned cleanupPending). This is the
// INDEPENDENT retry that makes the tombstone truly transient even if the inline finalize is lost.
//
// Invoked by a Vercel cron (see vercel.json "crons"), which issues a GET with
// `Authorization: Bearer <CRON_SECRET>`. We enforce the method, fail CLOSED when CRON_SECRET is unset or the
// header does not match (constant-time compare), and fail CLOSED unless the RPC returns a valid nonnegative
// integer count. Service-role only — purge_stale_tombstones deletes nothing that still has an auth user.
import { admin } from './lib/supabaseAdmin.js';
import { timingSafeEqual } from 'node:crypto';

function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });   // Vercel cron issues GET
  const secret = process.env.CRON_SECRET || '';
  const authz = String(req.headers.authorization || '');
  if (!secret || !safeEq(authz, `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorized' });   // fail closed

  const a = admin();
  if (!a) return res.status(503).json({ error: 'storage not configured' });
  try {
    const r = await a.rpc('purge_stale_tombstones');
    if (!r.ok) return res.status(502).json({ error: 'purge failed' });
    const removed = await r.json().catch(() => null);
    if (!Number.isInteger(removed) || removed < 0) return res.status(502).json({ error: 'malformed purge result' });   // fail closed
    return res.status(200).json({ ok: true, removed });
  } catch (e) {
    return res.status(500).json({ error: 'purge failed' });
  }
}
