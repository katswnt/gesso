// Fix the "blank artist but still scores the ARTIST category" bug class.
//
// 319 pool works have artist:"" while cats includes "artist", so the reveal shows
// "Unknown / anonymous" for a work whose creator is actually known (e.g. Mona Lisa,
// the two Poussins). For each such work this looks up the real creator from the
// authoritative source record and either:
//   (a) fills artist with the real name (keeping the ARTIST scoring category), or
//   (b) if the source confirms it's genuinely anonymous, DROPS "artist" from cats
//       so the game stops presenting "anonymous" as a scored, guessable fact.
//
// Works that are already correctly anonymous (artist:"" AND no "artist" cat) are left
// untouched. Idempotent: safe to re-run (only ever looks at empty-artist works that
// still score artist). NETWORK required (Wikidata + Met APIs) — run with plain node,
// NOT inside a network-less sandbox.
//
//   node scripts/fix-blank-artists.mjs            # apply
//   DRY_RUN=1 node scripts/fix-blank-artists.mjs  # report only, no write
//
// After applying, run the gate as its OWN step:  node scripts/check-pool.mjs
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";
import { writeFileSync } from "node:fs";

const DRY = !!process.env.DRY_RUN;
const UA = "Gesso/1.0 (art-history game; data-quality pass; contact kathryn.swint@gmail.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Wikidata QIDs that mean "no known individual creator" → treat as genuinely anonymous.
const ANON_QIDS = new Set([
  "Q4233718",  // anonymous
  "Q19660746", // unknown
  "Q125191",   // (unattributed) — defensive; harmless if absent
]);
// creator strings that are non-attributions, not real names
const ANON_RE = /^(unknown|anonymous|unidentified|unattributed|not\s+known|n\/a|—|-)?$/i;

async function jget(url){
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if(!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Met object → artistDisplayName ("" for anonymous/culture pieces).
async function metCreator(objectID){
  const d = await jget(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectID}`);
  return (d.artistDisplayName || "").trim();
}

// Wikidata entity → creator (P170) label, or "" if none / explicitly anonymous.
async function wdCreator(qid){
  const d = await jget(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const ent = d.entities?.[qid];
  const claims = ent?.claims?.P170 || [];
  for(const c of claims){
    const v = c.mainsnak?.datavalue?.value;
    if(!v) continue;
    if(typeof v === "object" && v.id){
      if(ANON_QIDS.has(v.id)) return "";            // explicitly anonymous
      const cd = await jget(`https://www.wikidata.org/wiki/Special:EntityData/${v.id}.json`);
      const lbl = cd.entities?.[v.id]?.labels?.en?.value;
      if(lbl) return lbl.trim();
    }
  }
  return "";
}

function idKind(id){
  if(/^met\d+$/.test(id)) return { kind: "met", n: id.slice(3) };
  const m = String(id).match(/(Q\d+)/);
  return m ? { kind: "wd", n: m[1] } : { kind: "unknown" };
}

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const targets = pool.filter(w =>
  (!w.artist || !String(w.artist).trim()) &&
  Array.isArray(w.cats) && w.cats.includes("artist"));

console.log(`pool ${pool.length} · blank-artist-but-scores-artist: ${targets.length}${DRY ? " (DRY RUN)" : ""}`);

const report = { filled: [], descored: [], failed: [], skipped: [] };

for(let i = 0; i < targets.length; i++){
  const w = targets[i];
  const { kind, n } = idKind(w.id);
  try {
    let creator = "";
    if(kind === "met") creator = await metCreator(n);
    else if(kind === "wd") creator = await wdCreator(n);
    else { report.skipped.push({ id: w.id, title: w.title, why: "unrecognized id" }); continue; }

    if(creator && !ANON_RE.test(creator)){
      w.artist = creator;                                   // (a) fill real name
      report.filled.push({ id: w.id, title: w.title, artist: creator });
    } else {
      w.cats = w.cats.filter(c => c !== "artist");          // (b) genuinely anonymous → stop scoring artist
      report.descored.push({ id: w.id, title: w.title });
    }
  } catch(e){
    report.failed.push({ id: w.id, title: w.title, err: String(e.message).slice(0, 120) });
  }
  if((i + 1) % 25 === 0) console.log(`  ${i + 1}/${targets.length} …`);
  await sleep(120); // be polite to the APIs
}

console.log(`\nfilled: ${report.filled.length} · de-scored (truly anon): ${report.descored.length} · failed: ${report.failed.length} · skipped: ${report.skipped.length}`);
writeFileSync("data/incoming/blank-artists-report.json", JSON.stringify(report, null, 2));
console.log("report → data/incoming/blank-artists-report.json");

if(DRY){
  console.log("DRY RUN — pool NOT written.");
} else if(report.filled.length || report.descored.length){
  writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool); // spaced canonical form (node --check gated)
  console.log("wrote data/pool.js — now run:  node scripts/check-pool.mjs  (as its own step before commit)");
} else {
  console.log("no changes to write.");
}
