// Resolution-check the shaped shortlist (drop anything that would promote NEW blur), then balance-select to
// per-category targets with a preference for works that carry a guessable style. STAGES data/incoming/
// promote-final.json + a review summary. Does NOT write pool.js.
//   node scripts/finalize-coverage.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "GessoFinalize/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 1000;
const TARGET = { oceania: 80, "middle-east": 60, "canonical-prints": 60, "early-medieval-europe": 50, "euro-sculpture-1400-1700": 40, "south-america": 40 };
const STYLELESS_FRAC = 0.4; // cap style-less works per category so the pool isn't flooded

const { ready } = JSON.parse(readFileSync("data/incoming/promote-ready.json", "utf8"));
const commonsFile = u => { const m = String(u).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function sizeFromBytes(buf) { if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(16);
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return buf.readUInt16BE(o + 7); o += 2 + buf.readUInt16BE(o + 2); } } return null; }
async function museumW(url) { try { const r = await fetch(url, { headers: { ...UA, Range: "bytes=0-65535" } }); if (!r.ok && r.status !== 206) return null; return sizeFromBytes(Buffer.from(await r.arrayBuffer())); } catch { return null; } }

// batch Commons widths
const cf = ready.map(r => commonsFile(r.img)).filter(Boolean);
const cW = {};
for (let i = 0; i < cf.length; i += 40) { const batch = cf.slice(i, i + 40);
  try { const r = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|")), { headers: UA });
    const pages = (await r.json()).query?.pages || {}; for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; cW[t] = ii ? ii.width : 0; } } catch {}
  await sleep(60);
}
process.stderr.write(`commons widths: ${Object.keys(cW).length}\n`);

// attach width, drop blurry
const withW = [];
let n = 0;
for (const r of ready) { n++; const c = commonsFile(r.img); let width;
  if (c) width = cW[canon(c)]; else { width = await museumW(r.img); await sleep(25); }
  if (width && width >= MIN) withW.push({ ...r, _w: width });
  if (n % 100 === 0) process.stderr.write(`  checked ${n}/${ready.length}\n`);
}

// global balance: keep all valid-style works (the good targets), then fill with the best style-less
// (prints/sculpture guessable by artist) up to a fraction cap so the pool isn't flooded with style-less entries
const styled = withW.filter(r => r.style), styleless = withW.filter(r => !r.style);
const pick = [];
// take all valid-style works up to a soft global cap, then fill with the best style-less (prints/sculpture)
const STYLE_CAP = Object.values(TARGET).reduce((a, b) => a + b, 0);
styled.sort((a, b) => b.cats.length - a.cats.length || b._w - a._w);
styleless.sort((a, b) => b.cats.length - a.cats.length || b._w - a._w);
const PER_STYLE_CAP = 40;                                                  // no single style floods the pool
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
