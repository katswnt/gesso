// check-language.mjs — flags harmful/dated language in the pool.
// POLICY (from the our-voice pass, commits b706175 + 6c9c4ca):
//   • Inherited museum TITLES are kept verbatim — but a work whose title carries a slur/dated ethnonym
//     should have a historical-context note so we frame it, not endorse it. Flagged as NEEDS-CONTEXT (warn).
//   • OUR voice (the `why` line and note bodies) must NOT use these terms. Flagged as OUR-VOICE (harder — reword).
// Read-only. Run standalone (`node scripts/check-language.mjs [file.json]`) or imported by check-pool.
import { readFileSync } from "node:fs";

// Clear slurs / dated ethnonyms that must never appear in OUR voice. Word-boundary matched, case-insensitive.
// Deliberately conservative to avoid false positives (e.g. "primitive"/"idol"/"exotic" have legit art-historical
// uses and were handled case-by-case in the manual pass, so they're WARN-only via titles, not hard our-voice hits).
const SLURS = ["negro","negress","negroes","savage","savages","redskin","squaw","half-caste","halfcaste",
  "mulatto","hottentot","pygmy","pigmy","bushman","mahometan","mohammedan","gypsy","gipsy","eskimo","oriental"];
const RE = new RegExp("\\b(" + SLURS.join("|") + ")\\b", "i");

export function scanLanguage(pool, cues) {
  cues = cues || {};
  const ourVoice = [], needsContext = [];
  for (const p of pool) {
    const c = cues[p.id] || {};
    const why = c.why || "";
    const noteText = (c.notes || []).map(n => (n.head || "") + " " + (n.body || "")).join(" ");
    const guideText = (c.guide || []).map(g => (g.q || "") + " " + (g.a || "")).join(" ");
    // OUR voice: why + note bodies + guide — these are ours to write, so a hit here is a real problem.
    // Skip matches that are just the artist's surname (e.g. Augusta/Edward "Savage") — not a slur.
    const artist = String(p.artist || "").toLowerCase();
    const voiceHit = [why, noteText, guideText].map(t => (t.match(RE) || [])[0]).find(Boolean);
    if (voiceHit && !artist.includes(voiceHit.toLowerCase())) ourVoice.push({ id: p.id, title: p.title, term: voiceHit });
    // TITLE hit without any contextualizing note → we're surfacing a harmful title with no framing.
    const titleHit = (String(p.title || "").match(RE) || [])[0];
    if (titleHit && !(c.notes && c.notes.length)) needsContext.push({ id: p.id, title: p.title, term: titleHit });
  }
  return { ourVoice, needsContext };
}

// standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  let pool, cues = {};
  if (file) { pool = JSON.parse(readFileSync(file, "utf8")); }
  else {
    global.window = {}; new Function(readFileSync("data/pool.js", "utf8"))(); pool = window.ARTEFACTUM_POOL;
    try { new Function(readFileSync("data/teach-works.js", "utf8"))(); cues = window.ARTEFACTUM_CUES.work || {}; } catch {}
  }
  const { ourVoice, needsContext } = scanLanguage(pool, cues);
  console.log(`OUR-VOICE hits (reword — ${ourVoice.length}):`);
  ourVoice.slice(0, 30).forEach(h => console.log(`  "${h.term}"  ${(h.title || h.id).slice(0, 55)}`));
  console.log(`\nTITLE needs-context (harmful title, no note — ${needsContext.length}):`);
  needsContext.slice(0, 30).forEach(h => console.log(`  "${h.term}"  ${(h.title || "").slice(0, 55)}`));
}
