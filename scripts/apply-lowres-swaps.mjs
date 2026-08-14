// Apply the reviewed higher-res image swaps staged by fix-lowres-dailies.mjs. Field-scoped: only the `img`
// field changes, one work at a time, and only if the old URL appears exactly once. Re-verifies each new URL
// resolves >= 1000px before writing, so a candidate that 404s or is still small can't slip in.
//   node scripts/apply-lowres-swaps.mjs           # apply all staged swaps
//   node scripts/apply-lowres-swaps.mjs --dry     # verify only, write nothing
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "GessoLowresApply/1.0 (kathryn.swint@gmail.com)" };
const DRY = process.argv.includes("--dry");
const MIN = 1000;

function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
async function verify(url) { try { const r = await fetch(url, { headers: UA }); if (!r.ok) return null; const s = sizeFromBytes(Buffer.from(await r.arrayBuffer())); return (s && s.w) ? s.w : null; } catch { return null; } }

const inFile = process.argv.find(a => a.endsWith(".json")) || "data/incoming/lowres-swaps.json";
const onlyHow = (process.argv.find(a => a.startsWith("--how=")) || "").split("=")[1] || null;
let { swaps } = JSON.parse(readFileSync(inFile, "utf8"));
if (onlyHow) swaps = swaps.filter(s => s.how === onlyHow);
let src = readFileSync("data/pool.js", "utf8");
let applied = 0, skipped = [];
for (const s of swaps) {
  const nw = await verify(s.newImg);
  if (!nw || nw < MIN) { skipped.push([s.title, `new url ${nw || "unreachable"}`]); continue; }
  const needle = '"img":"' + s.oldImg + '"';
  const occ = src.split(needle).length - 1;
  if (occ !== 1) { skipped.push([s.title, `old img appears ${occ}x`]); continue; }
  if (!DRY) src = src.replace(needle, '"img":"' + s.newImg + '"');
  applied++; console.log(`  ✓ ${s.title.slice(0, 44)} ${s.oldW}→${nw}`);
}
if (!DRY) writeFileSync("data/pool.js", src);
console.log(`\n${DRY ? "[DRY] " : ""}applied ${applied}/${swaps.length} swaps · skipped ${skipped.length}`);
for (const [t, why] of skipped) console.log(`   skip: ${t.slice(0, 44)} — ${why}`);
if (!DRY) console.log("\nNext: node scripts/audit-dailies.mjs (confirm the blurry count dropped), then check-pool + commit.");
