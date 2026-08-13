// #1 CHEAP swap triage (no model). Every work that an image-swap pass touched kept its original in prevImg.
// This checks each: (a) if the CURRENT image is dead but the saved original is live → auto-restore (safe win);
// (b) a filename-vs-(title+artist) token overlap heuristic — if the original filename matched the work better
// than the current one, flag it as a suspect swap for the vision detector (#2) to look at. Polite: gentle liveness
// with 429 backoff. Only auto-changes the unambiguous dead→live case; everything else is just flagged, never touched.
//   node scripts/verify-swaps.mjs        → data/pool.js (restores only) + data/incoming/swap-suspects.json
import { readFileSync, writeFileSync } from "node:fs";

const UA = { "User-Agent": "GessoSwapVerify/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function live(url, t = 0) {
  try { const r = await fetch(url + (url.includes("?") ? "&" : "?") + "width=800", { headers: UA, redirect: "follow" });
    r.body?.cancel?.(); if (r.status === 429 && t < 3) { await sleep(4000 * (t + 1)); return live(url, t + 1); } return r.status; }
  catch { if (t < 2) { await sleep(1500); return live(url, t + 1); } return 0; }
}
const toks = s => new Set(String(s || "").toLowerCase().match(/[a-z]{4,}/g) || []);
const fileToks = u => { const m = decodeURIComponent(String(u || "")).match(/([^/]+)\.(jpg|jpeg|png)/i); return toks(m ? m[1].replace(/[_%\-]/g, " ") : ""); };
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const swapped = w.ARTEFACTUM_POOL.filter(p => p.prevImg && p.prevImg !== p.img);
console.log(`works with a saved pre-swap image: ${swapped.length}\n`);

const restores = [], suspects = [];
for (let i = 0; i < swapped.length; i++) {
  const p = swapped[i];
  const cur = await live(p.img); await sleep(900);
  if (cur !== 200) {                              // current is dead — is the original alive?
    const prev = await live(p.prevImg); await sleep(900);
    if (prev === 200) { restores.push({ id: p.id, title: p.title, from: p.img, to: p.prevImg }); console.log(`RESTORE  ${p.title.slice(0, 34).padEnd(34)} (current ${cur} dead, original live)`); continue; }
  }
  // heuristic: did the original filename match the work better than the current one?
  const want = toks((p.title || "") + " " + (p.artist || ""));
  const curM = overlap(fileToks(p.img), want), prevM = overlap(fileToks(p.prevImg), want);
  if (prevM > curM && prevM >= 2) { suspects.push({ id: p.id, title: p.title, curMatch: curM, prevMatch: prevM, img: p.img, prevImg: p.prevImg }); console.log(`SUSPECT  ${p.title.slice(0, 34).padEnd(34)} (orig filename matches better: ${prevM} vs ${curM})`); }
}

if (restores.length) { let txt = readFileSync("data/pool.js", "utf8");
  for (const r of restores) if (txt.includes(r.from)) txt = txt.split(r.from).join(r.to);
  writeFileSync("data/pool.js", txt);
  const chk = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(chk);
  console.log(`\nrestored ${restores.length} dead swaps from prevImg · pool re-parses (${chk.ARTEFACTUM_POOL.length} works)`); }
writeFileSync("data/incoming/swap-suspects.json", JSON.stringify({ restored: restores, suspects }, null, 1));
console.log(`\nsummary: ${restores.length} auto-restored (dead→live) · ${suspects.length} filename-heuristic suspects → data/incoming/swap-suspects.json`);
console.log("note: live-but-WRONG swaps (e.g. Bodhidharma) can't be caught by filename/liveness — that's what the vision detector (#2) is for.");
