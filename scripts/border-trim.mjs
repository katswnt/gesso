// Conservative framing fix: trim ONLY a solid near-black / near-white mounting border (the black scroll
// backing, white museum matting) and re-host the result to Blob. Two independent guards, both must pass:
//   1. COLOR GATE — sample all 4 corners; the background must be near-uniform across corners AND itself
//      near-black (every channel <= DARK) or near-white (every channel >= LIGHT). A neutral-grey studio
//      backdrop (e.g. the Nefertiti bust), a colored ground, or a decorated/brocade mount FAILS this gate and
//      is left untouched — this is what stops the over-cropping the naive threshold-only version caused.
//   2. SIZE GATE — the detected border must be 4%..35% per side: smaller = nothing worth trimming; larger =
//      probably not a border (skip rather than risk cutting content).
// sharp.trim() itself removes only edge pixels matching the corner background within a tight threshold, so it
// never crops into non-uniform artwork. Selection: --dailies scans scheduled works, or border-trim-ids.json.
//   node scripts/border-trim.mjs [--dailies] [--dry]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
import sharp from "sharp";
const env = (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "") + "\n" + (existsSync(".env") ? readFileSync(".env", "utf8") : "");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || (env.match(/BLOB_READ_WRITE_TOKEN=(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const DRY = process.argv.includes("--dry");
if (!TOKEN && !DRY) { console.error("✗ BLOB_READ_WRITE_TOKEN not found (add to .env.local). --dry previews without it."); process.exit(1); }
// Wikimedia Commons throttles (429) browser-spoof UAs — its policy wants a descriptive UA with contact.
// Museum CDNs, conversely, often block non-browser UAs. So pick per-host + back off on 429/503.
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const COMMONS_UA = "Gesso/1.0 (https://gesso.katswint.com; kathryn.swint@gmail.com) border-trim";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchImage(url) {                                    // Commons-aware fetch with 429/503 backoff
  const commons = /wikimedia\.org|wikipedia\.org/.test(url);
  const h = { "User-Agent": commons ? COMMONS_UA : BROWSER_UA, Accept: "image/*" };
  if (/artic\.edu/.test(url)) h.Referer = "https://www.artic.edu/";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: h });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 429 || r.status === 503) {                     // rate-limited → respect Retry-After, back off
      const ra = parseInt(r.headers.get("retry-after") || "", 10);
      await sleep(Number.isFinite(ra) ? ra * 1000 : 800 * (attempt + 1) ** 2);
      continue;
    }
    throw new Error("HTTP " + r.status);                            // hard error (403/404/5xx-non-503) → give up
  }
  throw new Error("rate-limited after retries");
}
const MIN_FRAC = 0.04, MAX_FRAC = 0.35;   // trim only a real, bounded border
const DARK = 40, LIGHT = 215;             // near-black: all channels <= DARK · near-white: all channels >= LIGHT
const CORNER_UNIFORM = 16;                // per-corner stdev ceiling (the corner block must itself be flat)
const CORNER_AGREE = 20;                  // corners must agree with each other within this per-channel spread
const TRIM_THRESHOLD = 10;                // tight: only pixels genuinely matching the solid mount get shaved

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
console.log(`border-trim: scanning ${works.length} works · color gate (<=${DARK} dark | >=${LIGHT} light, uniform) + ${MIN_FRAC * 100}%..${MAX_FRAC * 100}% border`);

// Sample the 4 corners; return {kind:'dark'|'light', color:[r,g,b]} only if the mount is a solid near-black or
// near-white uniform backdrop, else null. This is the guard that spares studio-grey / colored grounds.
async function cornerMount(buf, W, H) {
  const S = Math.max(8, Math.round(Math.min(W, H) * 0.04));   // ~4% corner probe, clamped
  const spots = [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]];
  const means = [];
  for (const [left, top] of spots) {
    const st = await sharp(buf).extract({ left, top, width: S, height: S }).stats();
    const ch = st.channels.slice(0, 3);
    if (ch.some(c => c.stdev > CORNER_UNIFORM)) return null;   // this corner isn't flat → not a solid mount
    means.push(ch.map(c => c.mean));
  }
  for (let c = 0; c < 3; c++) {                                // corners must agree with one another
    const vals = means.map(m => m[c]);
    if (Math.max(...vals) - Math.min(...vals) > CORNER_AGREE) return null;
  }
  const avg = [0, 1, 2].map(c => means.reduce((s, m) => s + m[c], 0) / means.length);
  if (avg.every(v => v <= DARK)) return { kind: "dark", color: avg };
  if (avg.every(v => v >= LIGHT)) return { kind: "light", color: avg };
  return null;                                                 // uniform but mid-tone/colored → leave alone
}

const save = () => writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(pool) + raw.slice(raw.lastIndexOf("]") + 1));
let trimmed = 0, skipped = 0, failed = 0, noMount = 0; const fails = [];
for (const p of works) {
  try {
    await sleep(/wikimedia\.org/.test(p.img || "") ? 350 : 120);                    // throttle Commons to dodge 429
    const buf = await fetchImage(p.img);
    const meta = await sharp(buf).metadata();
    const mount = await cornerMount(buf, meta.width, meta.height);
    if (!mount) { noMount++; continue; }                                             // COLOR GATE: not a solid B/W mount
    const { data, info } = await sharp(buf).trim({ threshold: TRIM_THRESHOLD }).toBuffer({ resolveWithObject: true });
    const fracW = (meta.width - info.width) / meta.width, fracH = (meta.height - info.height) / meta.height;
    const maxF = Math.max(fracW, fracH);
    if (maxF < MIN_FRAC) { skipped++; continue; }                                    // SIZE GATE: no meaningful border
    if (maxF > MAX_FRAC) { console.log(`  skip ${p.id} — trim ${(maxF * 100).toFixed(0)}% too aggressive (likely not a border)`); skipped++; continue; }
    const col = mount.color.map(v => Math.round(v)).join(",");
    console.log(`  ${DRY ? "would trim" : "TRIM"} "${(p.title || "").slice(0, 30)}" ${meta.width}x${meta.height} -> ${info.width}x${info.height} (${(maxF * 100).toFixed(0)}% ${mount.kind} border rgb[${col}])`);
    if (DRY) continue;
    const jpg = await sharp(data).jpeg({ quality: 90 }).toBuffer();
    const { url } = await put(`trim/${p.id}.jpg`, jpg, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", token: TOKEN });
    if (!p.origImg) p.origImg = p.img;                                               // keep the untrimmed original
    p.img = url;
    trimmed++;
    if (trimmed % 10 === 0) save();
  } catch (e) { failed++; fails.push(p.id + " — " + e.message); }
}
if (!DRY) save();
if (fails.length) writeFileSync("data/incoming/border-trim-fails.json", JSON.stringify(fails, null, 1));
console.log(`\ntrimmed ${trimmed} · skipped ${skipped} (no/oversized border) · no-mount ${noMount} (color gate) · failed ${failed}${fails.length ? " -> data/incoming/border-trim-fails.json" : ""}`);
if (!DRY && trimmed) console.log("NEXT: re-fingerprint the trimmed works, gate, commit.");
