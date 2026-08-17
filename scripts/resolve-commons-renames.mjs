// Commons files get RENAMED (a maintainer moves File:Old.jpg -> File:New.jpg, leaving a redirect). Our stored
// Special:FilePath URL keeps the old name; it still resolves via the redirect UNTIL the redirect is ever broken
// or a strict fetch path stops following it — at which point the work reads as "image unavailable" to players.
// This sweep asks Commons (redirects=1) for the CURRENT canonical title of every Commons-hosted work and
// rewrites any stale filename to the canonical one, preserving the ?width query. Report-only with --dry.
//   node scripts/resolve-commons-renames.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
const DRY = process.argv.includes("--dry");
const UA = { "User-Agent": "Gesso/1.0 (https://gesso.katswint.com; kathryn.swint@gmail.com) commons-rename-resolver" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const raw = readFileSync("data/pool.js", "utf8");
const head = raw.slice(0, raw.indexOf("[")), tail = raw.slice(raw.lastIndexOf("]") + 1);
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

const fileOf = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

// works with a Commons FilePath url, keyed by their current (possibly stale) filename
const commonsWorks = pool.filter(p => fileOf(p.img));
const byFile = new Map();                                   // canon(name) -> [works]
for (const p of commonsWorks) { const f = canon(fileOf(p.img)); if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(p); }
const files = [...byFile.keys()];
console.log(`commons works ${commonsWorks.length} · unique files ${files.length}${DRY ? " · DRY" : ""}`);

const renamed = [], gone = [];
for (let i = 0; i < files.length; i += 40) {
  const batch = files.slice(i, i + 40);
  const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=info&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|"));
  try {
    const j = await (await fetch(u, { headers: UA })).json();
    const q = j.query || {};
    // redirects[]: {from:"File:Old", to:"File:New"} — the rename map for this batch
    const redir = Object.fromEntries((q.redirects || []).map(r => [canon(r.from.replace(/^File:/, "")), canon(r.to.replace(/^File:/, ""))]));
    const missing = new Set((q.pages ? Object.values(q.pages) : []).filter(p => p.missing !== undefined).map(p => canon((p.title || "").replace(/^File:/, ""))));
    for (const f of batch) {
      const to = redir[f];
      if (to && to !== f) { for (const p of byFile.get(f)) renamed.push({ p, from: f, to }); }
      else if (missing.has(f)) { for (const p of byFile.get(f)) gone.push({ p, from: f }); }
    }
  } catch (e) { console.error("  batch err", e.message); }
  if (i % 400 === 0) process.stderr.write(`  ${i}/${files.length}\n`);
  await sleep(80);
}

console.log(`\nRENAMED (stale filename → canonical): ${renamed.length}`);
for (const { p, from, to } of renamed) console.log(`  ${p.id}  "${(p.title || "").slice(0, 34)}"  ${from}  ->  ${to}`);
if (gone.length) { console.log(`\nGONE (no redirect, file missing) — needs manual re-source: ${gone.length}`); for (const { p, from } of gone) console.log(`  ${p.id}  "${(p.title || "").slice(0, 34)}"  ${from}`); }

if (!DRY && renamed.length) {
  for (const { p, to } of renamed) {
    const width = (String(p.img).match(/[?&]width=(\d+)/) || [])[1];
    p.img = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(to) + (width ? "?width=" + width : "");
  }
  writeFileSync("data/pool.js", head + JSON.stringify(pool) + tail);
  console.log(`\nrewrote ${renamed.length} stale filenames in data/pool.js. NEXT: re-fingerprint changed works, gate, commit.`);
} else if (renamed.length) {
  console.log(`\n--dry: no writes. Re-run without --dry to apply.`);
}
