// Find higher-res replacements for the blurry daily images that audit-dailies flags. STAGES proposals to
// data/incoming/lowres-swaps.json (id, title, oldImg/oldW, newImg/newW, how) — does NOT touch pool.js, so a
// wrong candidate can't reach prod. Deterministic size-bumps for museum CDNs (Met/Cleveland/NGA); higher-res
// same-work search for Commons. Apply with: node scripts/apply-lowres-swaps.mjs (after review).
//   node scripts/fix-lowres-dailies.mjs [days]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const UA = { "User-Agent": "GessoLowresFix/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 1000;                 // accept a replacement only if native width >= this
const DAYS = process.argv.find(a => /^\d+$/.test(a)) || "42";

// read the flagged works from the audit JSON (generate first with:
//   node scripts/audit-dailies.mjs 42 --json > data/incoming/daily-audit.json )
const audit = JSON.parse(readFileSync("data/incoming/daily-audit.json", "utf8"));
const flagged = audit.findings.filter(f => f.status === "LOW" || f.status === "unreachable");
console.log(`flagged blurry/broken dailies: ${flagged.length} (window ${audit.window.days}d)`);

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const byId = Object.fromEntries((w.ARTEFACTUM_POOL || []).map(p => [p.id, p]));

function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
async function urlSize(url) { try { const r = await fetch(url, { headers: UA }); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); const s = sizeFromBytes(b); return (s && s.w) ? s : null; } catch { return null; } }
async function commonsNative(file) { try { const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=size|url|extmetadata&titles=" + encodeURIComponent("File:" + file); const r = await fetch(u, { headers: UA }); const j = await r.json(); const p = Object.values(j.query?.pages || {})[0]; const ii = p?.imageinfo?.[0]; if (!ii) return null; return { w: ii.width, h: ii.height, lic: ii.extmetadata?.LicenseShortName?.value || "" }; } catch { return null; } }

// try progressively larger variants of a museum-CDN URL; return the first that resolves >= MIN
async function bumpMuseum(url) {
  const tries = [];
  if (/images\.metmuseum\.org/.test(url)) tries.push(url.replace("/web-large/", "/original/"));               // Met: web-large -> original
  if (/clevelandart\.org/.test(url)) { tries.push(url.replace("_web.jpg", "_print.jpg")); tries.push(url.replace("_web.jpg", "_full.tif").replace(".tif", ".jpg")); } // Cleveland: _web -> _print
  if (/api\.nga\.gov\/iiif/.test(url)) tries.push(url.replace(/\/full\/[^/]+\//, "/full/!2000,2000/"));         // NGA IIIF: bump size
  for (const t of tries) { const s = await urlSize(t); await sleep(60); if (s && s.w >= MIN) return { newImg: t, newW: s.w, how: "same-source-bump" }; }
  return null;
}

// search Commons for a higher-res file of the SAME work (title + artist surname must appear in the filename)
async function commonsHigher(p) {
  const surname = String(p.artist || "").trim().split(/\s+/).pop() || "";
  const titleToks = String(p.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 4);
  const q = [p.title, surname].filter(Boolean).join(" ");
  try {
    const s = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=8&srsearch=" + encodeURIComponent(q), { headers: UA });
    const hits = ((await s.json()).query?.search || []).map(x => x.title.replace(/^File:/, "")).filter(f => /\.(jpe?g|png|tiff?)$/i.test(f));
    let best = null;
    for (const f of hits) {
      const fl = f.toLowerCase();
      // guard against grabbing the wrong picture: filename must share the artist surname OR a distinctive title token
      const matches = (surname && fl.includes(surname.toLowerCase())) || titleToks.some(t => fl.includes(t));
      if (!matches) continue;
      const inf = await commonsNative(f); await sleep(80);
      if (inf && inf.w >= MIN && /public domain|cc0|pd-|no known/i.test(inf.lic || "public domain") && (!best || inf.w > best.w)) best = { file: f, w: inf.w };
    }
    if (best) return { newImg: "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(best.file) + "?width=1600", newW: best.w, how: "commons-higher-res" };
  } catch {}
  return null;
}

const swaps = [], unfixable = [];
let i = 0;
for (const f of flagged) {
  i++; const p = byId[f.id]; if (!p) continue;
  let res = null;
  if (/metmuseum|clevelandart|api\.nga\.gov/.test(p.img)) res = await bumpMuseum(p.img);
  if (!res) res = await commonsHigher(p);
  if (res) { swaps.push({ id: p.id, title: p.title, artist: p.artist, oldImg: p.img, oldW: f.nativeW, ...res }); process.stdout.write(`  [${i}/${flagged.length}] ✓ ${p.title.slice(0,40)} ${f.nativeW}→${res.newW} (${res.how})\n`); }
  else { unfixable.push({ id: p.id, title: p.title, artist: p.artist, oldW: f.nativeW, img: p.img }); process.stdout.write(`  [${i}/${flagged.length}] ✗ no better source: ${p.title.slice(0,40)} (${f.nativeW||f.err})\n`); }
  await sleep(80);
}

mkdirSync("data/incoming", { recursive: true });
writeFileSync("data/incoming/lowres-swaps.json", JSON.stringify({ swaps, unfixable }, null, 1));
console.log(`\nSTAGED ${swaps.length} swaps · ${unfixable.length} unfixable (no better source) -> data/incoming/lowres-swaps.json`);
console.log("Review, then apply with: node scripts/apply-lowres-swaps.mjs");
