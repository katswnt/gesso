// Single source for the Supabase project URL + publishable (anon) key, shared by every api/* function.
// These are NOT secrets — the anon/publishable key is designed to be public, and the SECRET key is read
// from env per-function where needed. The underscore prefix keeps this file out of Vercel's routes table.
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jmrpqmejupouqfergyyg.supabase.co';
export const SUPA_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_ZUSDLvzDYbD222i_ycdezQ_j7IB7Xp_';
