#!/usr/bin/env node
/**
 * Supabase keep-alive. Free-tier projects auto-pause after ~7 days with no
 * activity; a single database query resets that clock. Makes one harmless
 * read against PostgREST so the project never pauses.
 *
 * Reads SUPABASE_URL + SUPABASE_ANON_KEY from the environment (or, locally,
 * from .env.local). Runs in CI via .github/workflows/supabase-keepalive.yml,
 * or by hand: `node scripts/supabase-keepalive.mjs`.
 *
 * Uses the ANON key (public — already shipped in the web bundle), never the
 * service-role key, so there's nothing sensitive to leak.
 */
import { readFileSync, existsSync } from 'node:fs';

function loadEnvLocal() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvLocal();

// Fall back to the PUBLIC project URL + publishable (anon) key — identical to api/_supabase.js and already
// shipped in the web bundle, so nothing secret here. Makes the keep-alive work even when the (optional)
// repo secrets aren't set, which is exactly why the Action was failing.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://jmrpqmejupouqfergyyg.supabase.co';
const key =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'sb_publishable_ZUSDLvzDYbD222i_ycdezQ_j7IB7Xp_';

if (!url || !key) {
  console.error('keep-alive: missing SUPABASE_URL / SUPABASE_ANON_KEY');
  process.exit(1);
}

// A read against any table hits PostgREST → the database, which is what
// registers activity. RLS may return [] or 401 — either still touches the
// DB, so we treat any HTTP response (except a 5xx server error) as success.
// `profiles` exists in this project; any real table works.
const target = `${url.replace(/\/$/, '')}/rest/v1/profiles?select=id&limit=1`;

try {
  const res = await fetch(target, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  console.log(`keep-alive: HTTP ${res.status} from ${url.replace(/\/\/.*?\./, '//***.')}`);
  if (res.status >= 500) {
    console.error('keep-alive: server error — not counted as a successful ping');
    process.exit(1);
  }
  console.log('keep-alive: database touched — inactivity clock reset.');
} catch (e) {
  console.error(`keep-alive: request failed — ${e.message}`);
  process.exit(1);
}
