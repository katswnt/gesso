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

// Continent of a place of creation → the work's `region`. Single source of truth so region always follows
// place (the museum harvester used to default unknown regions to "Africa", giving French/Italian works
// region:"Africa"). Keyed by the base country (suffixes like "(Rome)" / "/Tibet" stripped).
const CONTINENT = {
  // Europe
  austria:"Europe","austria–hungary":"Europe","austria-hungary":"Europe",belgium:"Europe",cyprus:"Europe",czechia:"Europe",denmark:"Europe",france:"Europe",germany:"Europe",greece:"Europe",hungary:"Europe",italy:"Europe",netherlands:"Europe",norway:"Europe",poland:"Europe",portugal:"Europe",romania:"Europe",russia:"Europe","russian empire":"Europe",spain:"Europe",sweden:"Europe",switzerland:"Europe","united kingdom":"Europe","holy roman empire":"Europe",
  // North America
  "united states of america":"North America",mexico:"North America",guatemala:"North America","north america":"North America",canada:"North America",
  // South America
  brazil:"South America",bolivia:"South America",chile:"South America",colombia:"South America",ecuador:"South America",peru:"South America",argentina:"South America",venezuela:"South America",uruguay:"South America",
  // Asia (incl. Near East / Mesopotamia / Anatolia)
  afghanistan:"Asia",cambodia:"Asia",china:"Asia",india:"Asia",indonesia:"Asia",iran:"Asia",iraq:"Asia",japan:"Asia",korea:"Asia","south korea":"Asia",nepal:"Asia",pakistan:"Asia","saudi arabia":"Asia","sri lanka":"Asia",sumer:"Asia",syria:"Asia",thailand:"Asia",vietnam:"Asia",turkey:"Asia",
  // Africa
  angola:"Africa",cameroon:"Africa","central africa":"Africa","dr congo":"Africa","democratic republic of the congo":"Africa","east africa":"Africa",egypt:"Africa",ethiopia:"Africa",gabon:"Africa",ghana:"Africa",guinea:"Africa","ivory coast":"Africa",kenya:"Africa",mali:"Africa",morocco:"Africa",nigeria:"Africa","sierra leone":"Africa","south africa":"Africa",sudan:"Africa",tanzania:"Africa",tunisia:"Africa",uganda:"Africa",
  // Oceania
  australia:"Oceania","french polynesia":"Oceania","papua new guinea":"Oceania",polynesia:"Oceania",vanuatu:"Oceania","new zealand":"Oceania",
};
export function continentOf(place){
  const base = String(place||"").replace(/\s*\(.*$/,"").split("/")[0].trim().toLowerCase();
  return CONTINENT[base] || "";
}
