// Image-URL normalizer + liveness pass. The recurring bug: works stored with a HARDCODED Commons thumbnail URL
// (upload.wikimedia.org/.../thumb/<file>/<size>px-<file>) break the moment Commons renames/deletes the file
// (that's what killed Battersea Shield on a live daily). The robust form is the Special:FilePath redirect, which
// follows renames. This converts every thumb URL → Special:FilePath, verifying liveness; dead files are re-resolved
// via Wikidata P18; anything unresolvable is written to a backlog. POLITE to Wikimedia: sequential, delays, 429
// backoff. Surgical raw-text replace of pool.js (format-preserving, img-only). Pairs with the check-pool gate rule
// that fail-closes on any remaining thumb URL, so the class can't come back.
//
// Run (network):  node scripts/normalize-images.mjs        (writes data/pool.js + data/incoming/dead-images.json)
import { readFileSync, writeFileSync } from "node:fs";

const UA = { "User-Agent": "GessoImageNormalize/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const filePath = file => "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(decodeURIComponent(file));

// gentle liveness check with 429 backoff
async function live(url, tries = 0) {
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "width=1200", { headers: UA, redirect: "follow" });
    r.body?.cancel?.();
    if (r.status === 429 && tries < 3) { await sleep(4000 * (tries + 1)); return live(url, tries + 1); }
    return r.status;
  } catch { if (tries < 2) { await sleep(2000); return live(url, tries + 1); } return 0; }
}
async function p18(qid) {
  try {
    const j = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json`, { headers: UA })).json();
    return (j.claims?.P18 || []).map(x => x.mainsnak?.datavalue?.value)[0] || null;
  } catch { return null; }
}

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const targets = w.ARTEFACTUM_POOL.filter(p => /upload\.wikimedia\.org\/wikipedia\/commons\/thumb/.test(p.img || ""));
console.log(`thumb-pattern images to normalize: ${targets.length}\n`);

const fixes = [], dead = [];
for (let i = 0; i < targets.length; i++) {
  const p = targets[i];
  const m = (p.img || "").match(/\/thumb\/[^/]+\/[^/]+\/([^/]+)\//);
  let done = false;
  if (m) { const cand = filePath(m[1]); const s = await live(cand);
    if (s === 200) { fixes.push({ id: p.id, old: p.img, new: cand }); done = true; console.log(`${String(i + 1).padStart(2)}/${targets.length} ${p.title.slice(0, 26).padEnd(26)} → FilePath (embedded) ✓`); }
  }
  if (!done) { // dead embedded filename — try Wikidata P18
    const qid = String(p.id).match(/Q\d+/)?.[0];
    if (qid) { await sleep(1200); const file = await p18(qid);
      if (file) { const cand = filePath(file); await sleep(1200); const s = await live(cand);
        if (s === 200) { fixes.push({ id: p.id, old: p.img, new: cand }); done = true; console.log(`${String(i + 1).padStart(2)}/${targets.length} ${p.title.slice(0, 26).padEnd(26)} → FilePath (P18 rescue) ✓`); } }
    }
  }
  if (!done) { dead.push({ id: p.id, title: p.title, img: p.img }); console.log(`${String(i + 1).padStart(2)}/${targets.length} ${p.title.slice(0, 26).padEnd(26)} → UNRESOLVED — backlog`); }
  await sleep(1300);
}

// apply fixes (raw-text, unique URLs) + re-verify the pool still parses
if (fixes.length) {
  let txt = readFileSync("data/pool.js", "utf8");
  for (const f of fixes) if (txt.includes(f.old)) txt = txt.split(f.old).join(f.new);
  writeFileSync("data/pool.js", txt);
  const chk = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(chk); // throws if broken
  console.log(`\napplied ${fixes.length} fixes · pool.js re-parses OK (${chk.ARTEFACTUM_POOL.length} works)`);
}
writeFileSync("data/incoming/dead-images.json", JSON.stringify(dead, null, 1));
console.log(`normalized ${fixes.length} · unresolved ${dead.length} → data/incoming/dead-images.json`);
if (dead.length) console.log("unresolved need a manual image (or removal); everything else is now Special:FilePath.");

