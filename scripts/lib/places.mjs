// Canonical place names — single source of truth shared by promote-shortlist (entry) + check-pool (gate) so
// the "United States" vs "United States of America" class of dup can't recur. Canonicalizes PURE SPELLING /
// abbreviation variants of a modern country to the data/countries.js name; deliberately LEAVES historical or
// political names (Korea, Ottoman Empire, Soviet Union, Sumer…) alone — those are legit display names for
// historical works, not dups. Preserves any "(City)" / "/region" suffix.
import { readFileSync } from "node:fs";
const win = {}; new Function("window", readFileSync(new URL("../../data/countries.js", import.meta.url), "utf8"))(win);
const byLower = {}; for (const c of (win.ARTEFACTUM_COUNTRIES || [])) byLower[c.n.toLowerCase()] = c.n;
// pure spelling/abbreviation variants ONLY (NOT historical/political renames)
const SPELLING_ALIAS = {
  "united states":"United States of America","usa":"United States of America","u.s.":"United States of America",
  "u.s.a.":"United States of America","america":"United States of America","uk":"United Kingdom","u.k.":"United Kingdom",
  "great britain":"United Kingdom","britain":"United Kingdom","holland":"Netherlands","czech republic":"Czechia",
  "côte d'ivoire":"Ivory Coast","cote d'ivoire":"Ivory Coast","türkiye":"Turkey",
};
export function canonicalizePlace(place){
  const raw = String(place||"").trim(); if(!raw) return "";
  const m = raw.match(/^([^(\/]+)(.*)$/);
  const base = (m?m[1]:raw).trim(), rest = m?m[2]:"";
  const canon = SPELLING_ALIAS[base.toLowerCase()] || byLower[base.toLowerCase()];
  if(canon && canon!==base) return (canon+rest).trim(); // only rewrites recognized country spelling-variants
  return raw;
}
export const isPlaceCanonical = place => canonicalizePlace(place) === String(place||"").trim();
