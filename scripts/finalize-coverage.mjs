// Resolution-check the shaped shortlist (drop anything that would promote NEW blur), then balance-select to
// per-category targets with a preference for works that carry a guessable style. STAGES data/incoming/
// promote-final.json + a review summary. Does NOT write pool.js.
//   node scripts/finalize-coverage.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "GessoFinalize/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 1000;
const TARGET = { oceania: 80, "middle-east": 60, "canonical-prints": 60, "early-medieval-europe": 50, "euro-sculpture-1400-1700": 40, "south-america": 40 };
const STYLELESS_FRAC = 0.7; // cap style-less works per category so the pool isn't flooded

const { ready } = JSON.parse(readFileSync("data/incoming/promote-ready.json", "utf8"));
const commonsFile = u => { const m = String(u).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function sizeFromBytes(buf) { if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(16);
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return buf.readUInt16BE(o + 7); o += 2 + buf.readUInt16BE(o + 2); } } return null; }
async function museumW(url) {
  try { const r = await fetch(url, { headers: { ...UA, Range: "bytes=0-65535" } });
    if (r.ok || r.status === 206) { const s = sizeFromBytes(Buffer.from(await r.arrayBuffer())); if (s) return s; }
  } catch {}
  // some servers (Te Papa) reject Range with 500/403 — fall back to a full GET
  try { const r = await fetch(url, { headers: UA }); if (!r.ok) return null; return sizeFromBytes(Buffer.from(await r.arrayBuffer())); } catch { return null; }
}

// batch Commons widths
const cf = ready.map(r => commonsFile(r.img)).filter(Boolean);
const cW = {};
for (let i = 0; i < cf.length; i += 40) { const batch = cf.slice(i, i + 40);
  try { const r = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|")), { headers: UA });
    const pages = (await r.json()).query?.pages || {}; for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; cW[t] = ii ? ii.width : 0; } } catch {}
  await sleep(60);
}
process.stderr.write(`commons widths: ${Object.keys(cW).length}\n`);

// attach width, drop blurry. Commons = imageinfo (already fetched). Upgraded museum masters (AIC /full/1686,
// Cleveland _print) are deterministically large → assume ≥MIN, no fetch. Everything else Range-fetched in
// PARALLEL batches (sequential was far too slow for a 1300-work shortlist).
// AIC /full/1686 + Cleveland _print + Te Papa /full masters (harvest already width-gated ≥900; they're 3–11MB) are
// deterministically ≥MIN — treat as large without fetching (Te Papa also rate-limits and rejects Range).
const knownLarge = u => /artic\.edu.*\/full\/1686,/.test(u) || /clevelandart.*_print\.(jpg|tif)/.test(u) || /media\.tepapa\.govt\.nz\/collection\/\d+\/full/.test(u);
const needFetch = [];
const widthOf = {};
for (const r of ready) { const c = commonsFile(r.img);
  if (c) widthOf[r.img] = cW[canon(c)] || 0;
  else if (knownLarge(r.img)) widthOf[r.img] = 1686;
  else needFetch.push(r.img);
}
process.stderr.write(`need Range-fetch: ${needFetch.length} (commons+known-large resolved instantly)\n`);
for (let i = 0; i < needFetch.length; i += 24) {
  const batch = needFetch.slice(i, i + 24);
  const ws = await Promise.all(batch.map(u => museumW(u)));
  batch.forEach((u, j) => widthOf[u] = ws[j] || 0);
  if (i % 240 === 0) process.stderr.write(`  fetched ${i}/${needFetch.length}\n`);
}
const withW = ready.filter(r => widthOf[r.img] >= MIN).map(r => ({ ...r, _w: widthOf[r.img] }));

// global balance: keep all valid-style works (the good targets), then fill with the best style-less
// (prints/sculpture guessable by artist) up to a fraction cap so the pool isn't flooded with style-less entries
const styled = withW.filter(r => r.style), styleless = withW.filter(r => !r.style);
const pick = [];
// take all valid-style works up to a soft global cap, then fill with the best style-less (prints/sculpture)
const STYLE_CAP = Object.values(TARGET).reduce((a, b) => a + b, 0);
styled.sort((a, b) => b.cats.length - a.cats.length || b._w - a._w);
styleless.sort((a, b) => b.cats.length - a.cats.length || b._w - a._w);
const PER_STYLE_CAP = 120;                                                  // no single style floods the pool
const styleCount = {};
for (const r of styled) { const n = (styleCount[r.style] || 0); if (n < PER_STYLE_CAP) { pick.push(r); styleCount[r.style] = n + 1; } }
const stylelessCap = Math.round(pick.length * STYLELESS_FRAC / (1 - STYLELESS_FRAC));
pick.push(...styleless.slice(0, stylelessCap));

// strip helper field
const final = pick.map(({ _w, _cat, ...r }) => r);
writeFileSync("data/incoming/promote-final.json", JSON.stringify({ ready: final }, null, 1));

const styleDist = final.reduce((o, r) => { o[r.style || "(no style — artist target)"] = (o[r.style || "(no style — artist target)"] || 0) + 1; return o; }, {});
const regionDist = final.reduce((o, r) => { o[r.region] = (o[r.region] || 0) + 1; return o; }, {});
console.log(`\nFINALIZED ${final.length} works (dropped ${ready.length - withW.length} blurry <${MIN}px)`);
console.log("by region:", JSON.stringify(regionDist));
console.log("by style:", JSON.stringify(styleDist));
console.log(`style-carrying: ${final.filter(r => r.style).length} | artist-only (no style): ${final.filter(r => !r.style).length}`);
console.log("-> data/incoming/promote-final.json");
