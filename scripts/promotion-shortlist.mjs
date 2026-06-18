import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const INPUTS = [
  "data/incoming/collection-britishmuseum.json",
  "data/incoming/collection-quaibranly.json",
  "data/incoming/collection-lacma.json",
  "data/incoming/collection-brooklyn.json",
  "data/incoming/collection-walters.json",
];
const OUT = "data/incoming/promotion-shortlist.json";

function qid(value){
  const m = String(value || "").match(/Q\d+/);
  return m ? m[0] : null;
}

function fame(work){
  return Number.isFinite(Number(work?.sitelinks)) ? Number(work.sitelinks) : 0;
}

function label(value, fallback = ""){
  const s = String(value || "").trim();
  return s || fallback;
}

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL") || [];
const poolQids = new Set(pool.map((work) => qid(work.id)).filter(Boolean));

const staged = [];
for (const file of INPUTS) {
  const works = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(works)) throw new Error(`${file} must contain a JSON array`);
  staged.push(...works);
}

let alreadyLive = 0;
let exactDuplicateQids = 0;
const bestByQid = new Map();
const noQid = [];

for (const work of staged) {
  const q = qid(work.id);
  if (!q) {
    noQid.push(work);
    continue;
  }
  if (poolQids.has(q)) {
    alreadyLive++;
    continue;
  }

  const prev = bestByQid.get(q);
  if (!prev) {
    bestByQid.set(q, work);
    continue;
  }

  exactDuplicateQids++;
  if (fame(work) > fame(prev)) bestByQid.set(q, work);
}

const candidates = [...bestByQid.values(), ...noQid].sort((a, b) => fame(b) - fame(a));
const ready = candidates.filter((work) => label(work.place));
const needsOrigin = candidates.filter((work) => !label(work.place));

writeFileSync(OUT, JSON.stringify({ ready, needsOrigin }, null, 2) + "\n");

const needsOriginTop100 = candidates.slice(0, 100).filter((work) => !label(work.place)).length;
const deduped = alreadyLive + exactDuplicateQids;

console.log(`wrote ${OUT}`);
console.log(
  [
    `staged: ${staged.length}`,
    `new: ${candidates.length}`,
    `deduped: ${deduped}`,
    `alreadyLive: ${alreadyLive}`,
    `duplicateQids: ${exactDuplicateQids}`,
    `ready: ${ready.length}`,
    `needsOrigin: ${needsOrigin.length}`,
  ].join(" | "),
);
console.log(`NEEDS_ORIGIN in top-100-by-fame: ${needsOriginTop100}`);
console.log("");
console.log("TOP 40 READY");
ready.slice(0, 40).forEach((work, i) => {
  console.log(
    `${i + 1}. ${fame(work)} — ${label(work.title, "(untitled)")} — ${label(work.artist, "unknown artist")} — ${label(work.place)} [${label(work.src, "unknown")}]`,
  );
});
