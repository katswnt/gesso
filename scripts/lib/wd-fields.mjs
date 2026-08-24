// Shared Wikidata→game field rules, so every harvest script picks fields the SAME way and the class of bug
// that let P495 (country-of-origin) leak as `place` into ONE harvester (pull-wd-collection) but not another
// (fetch-harvest) can't recur. Import this instead of re-deriving the rule per script.
// Tested by tests/wd-fields.test.mjs.

// PLACE = where the work was MADE, never the artist's nationality/birthplace.
//   1. P1071 location-of-creation (→P17 country) always wins.        [fetch-harvest also accepts P276 here]
//   2. P495 country-of-origin is used ONLY for anonymous/cultural works (no named creator) — for those it IS
//      the geographic signal; for a NAMED artist WD routinely sets P495 to the creator's nationality (a Titian
//      painted in Augsburg comes back "Italy"), the exact nationality trap, so we DROP it and leave place blank
//      (blank-not-wrong: a reviewer/backfill can fill it, but we never assert a wrong country).
// Inputs are already-resolved modern country strings (caller does the QID→P17→label / SPARQL resolution).
export function pickPlace({ locCountry, origCountry, hasNamedCreator }){
  const loc = String(locCountry || "").trim();
  if (loc) return loc;
  const orig = String(origCountry || "").trim();
  if (orig && !hasNamedCreator) return orig;
  return "";
}
