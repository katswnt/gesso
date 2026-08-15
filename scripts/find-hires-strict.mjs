// Strict higher-res finder for the visible-tier (easy/medium) blurry works. The v2 finder matched on artist
// surname OR one title token, which pulled in different works by the same artist. This one REQUIRES a strong
// title match: it ranks Commons candidates by title-token overlap (not just size) and only accepts a strong
// title hit, so "Pink and Blue" can't be replaced by another Renoir. Still vision-verified after.
// Reads data/incoming/em-blurry.json → stages data/incoming/em-hires.json.
//   node scripts/find-hires-strict.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "GessoHiResStrict/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 1000;

const works = JSON.parse(readFileSync("data/incoming/em-blurry.json", "utf8"));
const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const byId = Object.fromEntries((w.ARTEFACTUM_POOL || []).map(p => [p.id, p]));
console.log(`easy/medium blurry to search: ${works.length}`);

const toks = s => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 4);
async function imageinfo(file) {
  try { const r = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size|extmetadata&titles=" + encodeURIComponent("File:" + file), { headers: UA });
    const p = Object.values((await r.json()).query?.pages || {})[0]; const ii = p?.imageinfo?.[0];
    return ii ? { w: ii.width, lic: ii.extmetadata?.LicenseShortName?.value || "" } : null; } catch { return null; }
}
async function search(q) {
  try { const r = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=30&srsearch=" + encodeURIComponent(q), { headers: UA });
    return ((await r.json()).query?.search || []).map(x => x.title.replace(/^File:/, "")).filter(f => /\.(jpe?g|png|tiff?)$/i.test(f)); } catch { return []; }
}

const found = [], stuck = [];
let i = 0;
for (const f of works) {
  i++;
  const p = byId[f.id]; const title = f.title || p?.title || "";
  const surname = String(f.artist || p?.artist || "").trim().split(/\s+/).pop().toLowerCase();
  const tTok = toks(title);
  const seen = new Set(); const cands = [];
  for (const q of [`${title} ${surname}`, title, `${surname} ${title}`]) {
    for (const file of await search(q)) {
      if (seen.has(file)) continue; seen.add(file);
      const fl = file.toLowerCase();
      const titleHits = tTok.length ? tTok.filter(t => fl.includes(t)).length / tTok.length : 0;
      const hasSurname = surname.length >= 4 && fl.includes(surname);
      // STRICT gate: strong title match required (surname + half the title, or 80%+ of the title alone)
      if (!((hasSurname && titleHits >= 0.5) || titleHits >= 0.8)) continue;
      cands.push({ file, titleHits, hasSurname });
    }
    await sleep(80);
  }
  // rank by title match, then surname, then resolution; take the biggest that clears MIN
  cands.sort((a, b) => b.titleHits - a.titleHits || (b.hasSurname - a.hasSurname));
  let best = null;
  for (const c of cands.slice(0, 8)) { const inf = await imageinfo(c.file); await sleep(70);
    if (inf && inf.w >= MIN && /public domain|cc0|pd-|no known/i.test(inf.lic || "public domain") && (!best || inf.w > best.w)) best = { file: c.file, w: inf.w, titleHits: c.titleHits }; }
  if (best) { found.push({ id: f.id, title, artist: f.artist, tier: f.tier, oldImg: p.img, oldW: f.nativeW, newImg: "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(best.file) + "?width=1600", newW: best.w, titleHits: best.titleHits });
    process.stdout.write(`  [${i}/${works.length}] ✓ ${title.slice(0,38)} ${f.nativeW}→${best.w} (title ${(best.titleHits*100).toFixed(0)}%)\n`); }
  else { stuck.push({ id: f.id, title, tier: f.tier, oldW: f.nativeW }); process.stdout.write(`  [${i}/${works.length}] ✗ ${title.slice(0,38)}\n`); }
  await sleep(60);
}
writeFileSync("data/incoming/em-hires.json", JSON.stringify({ found, stuck }, null, 1));
console.log(`\nDONE: ${found.length} candidates (need vision check) · ${stuck.length} stuck -> data/incoming/em-hires.json`);
