// Locks the shared harvest place rule (scripts/lib/wd-fields.mjs → pickPlace): place = where the work was MADE,
// never the artist's nationality. Regression guard for the P495-leak class (a Titian painted in Augsburg must
// not come back "Italy" from the artist's country-of-origin). Run: node tests/wd-fields.test.mjs
import { pickPlace } from "../scripts/lib/wd-fields.mjs";

let pass = 0; const fail = m => { console.error("❌ wd-fields:", m); process.exit(1); };
const eq = (got, want, msg) => { if (got !== want) fail(`${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); pass++; };

// P1071/P276 location-of-creation always wins, even over a conflicting origin
eq(pickPlace({ locCountry: "France", origCountry: "Italy", hasNamedCreator: true }), "France", "loc wins over orig (named)");
eq(pickPlace({ locCountry: "Egypt", origCountry: "Iran", hasNamedCreator: false }), "Egypt", "loc wins over orig (anon)");
// named artist + no creation location → BLANK, never the P495 nationality (the trap)
eq(pickPlace({ locCountry: "", origCountry: "Italy", hasNamedCreator: true }), "", "named artist, no loc → blank not nationality");
eq(pickPlace({ locCountry: " ", origCountry: "Netherlands", hasNamedCreator: true }), "", "whitespace loc treated as empty");
// anonymous/cultural work → P495 origin IS the geographic signal
eq(pickPlace({ locCountry: "", origCountry: "Iran", hasNamedCreator: false }), "Iran", "anon, no loc → use origin");
// nothing resolvable → blank
eq(pickPlace({ locCountry: "", origCountry: "", hasNamedCreator: false }), "", "nothing → blank");
eq(pickPlace({ locCountry: null, origCountry: null, hasNamedCreator: true }), "", "null-safe → blank");

console.log(`✅ wd-fields: ${pass} checks — place rule (loc wins; P495 only for anonymous works) locked`);
process.exit(0);
