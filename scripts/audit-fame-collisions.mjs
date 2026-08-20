// Fame TITLE-COLLISION cleanup. fame-score matches accession works (no Wikidata QID of their own) to Wikidata by
// exact English TITLE. Generic/ambiguous titles hit the WRONG high-traffic item ("Ma" -> a 2000-view concept,
// "Self-Portrait"/"Untitled"/"Tunic") and inherit its fame, floating obscure works into Easy/Medium. This checks
// each title-matched item's P31 on Wikidata: if it is NOT an artwork (and has no creator), the match is a
// collision -> zero that work's fame in data/fame.json (sitelinks/pageviews -> 0, collision flag set). make-fame-js
// then produces fame 0, and resync-fame + a re-freeze drop them out of the tiers.
// Run LOCALLY (network). Then: make-fame-js -> resync-fame -> freeze.
//   node scripts/audit-fame-collisions.mjs [--write]
import { readFileSync, writeFileSync } from "node:fs";
const UA = "GessoBot/1.0 (kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pool = JSON.parse(readFileSync("data/pool.js", "utf8").replace("window.ARTEFACTUM_POOL = ", "").replace(/;\s*$/, ""));
const fame = JSON.parse(readFileSync("data/fame.json", "utf8"));
const ov = JSON.parse(readFileSync("data/fame.js", "utf8").replace("window.ARTEFACTUM_FAME=", "").replace(/;\s*$/, ""));
const isQID = id => /Q\d+$/.test(id);
const eff = p => ov[p.id] != null ? ov[p.id] : (p.fame || 0); // EFFECTIVE fame (overlay wins) — catches "Ma"-type
// works whose collision fame lives in pool.fame with no fame.json sitelinks (make-fame-js falls back to pool.fame).
// suspects: accession work (no own QID) with a title-matched wikidata QID AND non-trivial effective fame.
const suspects = pool.filter(p => !isQID(p.id) && fame[p.id]?.wikidata && eff(p) >= 50);
console.log(`title-matched accession works to verify: ${suspects.length}`);

// artwork-ish P31 classes; presence of any (or a creator P170) = the match is plausibly the real artwork
const ARTWORK = new Set(["Q3305213","Q860861","Q125191","Q11060274","Q93184","Q838948","Q18761202","Q1229071","Q2020417","Q11835431","Q18811686","Q106857709","Q4502142","Q15709879","Q2864737","Q184754","Q133067","Q179700"]);
async function claims(qids) {
  const j = await (async () => { for (let a = 0; a < 5; a++) { if (a) await sleep(1500 * a);
    try { const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=claims&format=json`, { headers: { "User-Agent": UA } }); if (r.ok) return await r.json(); } catch {} } return null; })();
  return j?.entities || {};
}
const p31 = e => (e?.claims?.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const hasCreator = e => (e?.claims?.P170 || []).length > 0;

const collisions = [];
for (let i = 0; i < suspects.length; i += 40) {
  const batch = suspects.slice(i, i + 40);
  const ents = await claims([...new Set(batch.map(p => fame[p.id].wikidata))]);
  for (const p of batch) {
    const e = ents[fame[p.id].wikidata];
    const isArtwork = p31(e).some(x => ARTWORK.has(x)) || hasCreator(e);
    if (!isArtwork) collisions.push({ id: p.id, title: p.title, artist: p.artist, matched: fame[p.id].wikidata, fame: Math.round(fame[p.id].fame || 0) });
  }
  process.stdout.write(`\r  checked ${Math.min(i + 40, suspects.length)}/${suspects.length}, collisions ${collisions.length}`);
  await sleep(300);
}
console.log("");
collisions.sort((a, b) => b.fame - a.fame);
console.log(`\nTITLE-COLLISIONS (matched item is not an artwork) — ${collisions.length}:`);
for (const c of collisions.slice(0, 30)) console.log(`  fame ${String(c.fame).padStart(4)}  "${c.title}" — ${c.artist || "anon"}  → wrong item ${c.matched}`);
if (collisions.length > 30) console.log(`  …and ${collisions.length - 30} more`);

if (process.argv.includes("--write")) {
  for (const c of collisions) { fame[c.id].sitelinks = 0; fame[c.id].pageviews = 0; fame[c.id].collision = true; }
  writeFileSync("data/fame.json", JSON.stringify(fame));
  console.log(`\n✔ zeroed ${collisions.length} collisions in data/fame.json — now run: make-fame-js -> resync-fame -> freeze`);
} else console.log("\n(dry run — pass --write)");
