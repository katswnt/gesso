// Conservative framing fix: trim SOLID uniform mounting borders (the black scroll background, museum matting)
// and re-host the result to Blob. Uses sharp.trim(), which removes ONLY edge pixels matching the corner
// background within a threshold — it will NOT crop into the artwork (a decorated/brocade mount isn't uniform,
// so it's left alone). Extra safety: apply only when a border of 3%..40% per side is detected — smaller means
// nothing to trim; larger means it's probably not a border (skip rather than risk cutting content).
// Selection: --dailies scans the next-28d scheduled works, or pass data/incoming/border-trim-ids.json.
//   node scripts/border-trim.mjs [--dailies] [--dry]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
import sharp from "sharp";
const env = (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "") + "\n" + (existsSync(".env") ? readFileSync(".env", "utf8") : "");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || (env.match(/BLOB_READ_WRITE_TOKEN=(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const DRY = process.argv.includes("--dry");
if (!TOKEN && !DRY) { console.error("✗ BLOB_READ_WRITE_TOKEN not found (add to .env.local). --dry previews without it."); process.exit(1); }
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MIN_FRAC = 0.03, MAX_FRAC = 0.40; // trim only a real, bounded border

const raw = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const byId = Object.fromEntries(pool.map(p => [p.id, p]));

let ids = [];
if (process.argv.includes("--dailies")) {
  const g = {}; try { new Function("window", readFileSync("data/daily-order.js", "utf8"))(g); } catch {}
  const bd = (g.ARTEFACTUM_DAILY || {}).byDate || {}; const today = new Date().toISOString().slice(0, 10); const seen = new Set();
  for (const [d, day] of Object.entries(bd)) { if (d < today) continue; for (const t of ["easy", "medium", "hard", "impossible"]) for (const id of (day[t] || [])) seen.add(id); }
  ids = [...seen];
} else { try { ids = JSON.parse(readFileSync("data/incoming/border-trim-ids.json", "utf8")); } catch { console.error("provide data/incoming/border-trim-ids.json (an array of ids) or use --dailies"); process.exit(1); } }
const works = ids.map(id => byId[id]).filter(p => p && p.img);
console.log(`border-trim: scanning ${works.length} works (min ${MIN_FRAC * 100}% .. max ${MAX_FRAC * 100}% border)`);

const save = () => writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(pool) + raw.slice(raw.lastIndexOf("]") + 1));
let trimmed = 0, skipped = 0, failed = 0;
for (const p of works) {
  try {
    const r = await fetch(p.img, { headers: { "User-Agent": UA } }); if (!r.ok) { failed++; continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const { data, info } = await sharp(buf).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    const fracW = (meta.width - info.width) / meta.width, fracH = (meta.height - info.height) / meta.height;
    const maxF = Math.max(fracW, fracH);
    if (maxF < MIN_FRAC) { skipped++; continue; }                                  // no meaningful border
    if (maxF > MAX_FRAC) { console.log(`  skip ${p.id} — trim ${(maxF * 100).toFixed(0)}% too aggressive (likely not a border)`); skipped++; continue; }
    console.log(`  ${DRY ? "would trim" : "TRIM"} "${(p.title || "").slice(0, 30)}" ${meta.width}x${meta.height} -> ${info.width}x${info.height} (${(maxF * 100).toFixed(0)}% border)`);
    if (DRY) continue;
    const jpg = await sharp(data).jpeg({ quality: 90 }).toBuffer();
    const { url } = await put(`trim/${p.id}.jpg`, jpg, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", token: TOKEN });
    if (!p.origImg) p.origImg = p.img;                                              // keep the untrimmed original
    p.img = url;
    trimmed++;
    if (trimmed % 10 === 0) save();
  } catch (e) { failed++; }
}
if (!DRY) save();
console.log(`\ntrimmed ${trimmed} · skipped ${skipped} (no/oversized border) · failed ${failed}`);
if (!DRY && trimmed) console.log("NEXT: re-fingerprint the trimmed works, gate, commit.");
