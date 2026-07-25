// Harvest AUTHORITATIVE AIC images. AIC-sourced works (id ^aic<objId>) still pointing at a Wikimedia
// Commons file are the mismatch-prone set — the harvest fuzzy-matched some prints to the wrong Commons
// image (a Hiroshige serving a Helen Hyde print, etc.). Fix deterministically at the source: re-fetch each
// work's canonical image_id from the AIC API, build the IIIF URL, download it, re-host to Vercel Blob
// (AIC's Cloudflare gatekeeps mobile), and replace img — keeping the old Commons URL in prevImg for audit.
// Idempotent + resumable (once img is a Blob URL a work is no longer a target). No agents needed.
//   node scripts/harvest-aic-images.mjs [--dry] [--limit=N]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const DRY = process.argv.includes("--dry");
const LIM = (process.argv.find(a => a.startsWith("--limit=")) || "").split("=")[1];
const env = (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "") + "\n" + (existsSync(".env") ? readFileSync(".env", "utf8") : "");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || (env.match(/BLOB_READ_WRITE_TOKEN=(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!DRY && !TOKEN) { console.error("✗ BLOB_READ_WRITE_TOKEN not found in .env.local / .env"); process.exit(1); }
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
let targets = pool.filter(p => /^aic\d+$/.test(p.id) && /commons\.wikimedia/.test(p.img || ""));
if (LIM) targets = targets.slice(0, +LIM);
console.log(`AIC works on Commons to re-source from the AIC API: ${targets.length}${DRY ? "  (DRY)" : ""}`);

let done = 0, noimg = 0, fail = 0; const fails = [], noimgs = [];
const save = () => writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool);
for (const p of targets) {
  const objId = p.id.slice(3);
  try {
    const ar = await fetch(`https://api.artic.edu/api/v1/artworks/${objId}?fields=image_id,title`, { headers: { "User-Agent": UA } });
    const j = (await ar.json()).data;
    if (!j || !j.image_id) { noimg++; noimgs.push(`${p.id} ${(p.title || "").slice(0, 34)}`); await sleep(80); continue; }
    const iiif = `https://www.artic.edu/iiif/2/${j.image_id}/full/1200,/0/default.jpg`;
    if (DRY) { done++; await sleep(60); continue; }
    const r = await fetch(iiif, { headers: { "User-Agent": UA, "Accept": "image/*", "Referer": "https://www.artic.edu/" } });
    if (!r.ok) throw new Error("download " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000) throw new Error("tiny " + buf.length);
    const { url } = await put(`aic/${p.id}.jpg`, buf, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", token: TOKEN });
    if (!p.prevImg) p.prevImg = p.img;   // keep the old Commons URL for audit / rollback
    p.aicImg = iiif; p.img = url; p.src = "aic-blob";
    done++;
  } catch (e) { fail++; fails.push(`${p.id} — ${e.message}`); }
  if ((done + fail + noimg) % 25 === 0) { if (!DRY) save(); console.error(`  ${done + fail + noimg}/${targets.length} | ok ${done} noimg ${noimg} fail ${fail}`); }
  await sleep(120);
}
if (!DRY) save();
writeFileSync("data/incoming/aic-image-harvest.json", JSON.stringify({ done, noimg, fail, fails, noimgs }, null, 1));
console.log(`\nre-sourced ${done}/${targets.length} from AIC API → Blob | no-image ${noimg} | failed ${fail}`);
if (noimgs.length) console.log("no AIC image_id (kept Commons):", noimgs.length);
if (fails.length) console.log("failures → data/incoming/aic-image-harvest.json");
