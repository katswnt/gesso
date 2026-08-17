// For AIC works whose stored IIIF url is DEAD (rehost-blob left them on artic.edu), ask the AIC API for the
// object's CURRENT image_id, rebuild the IIIF url, and re-host to Blob. AIC sometimes re-uploads an image
// under a new id, orphaning the old url. Run VPN-OFF (AIC's Cloudflare blocks datacenter IPs).
//   node scripts/reresolve-aic.mjs [--dry]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
const env = (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "") + "\n" + (existsSync(".env") ? readFileSync(".env", "utf8") : "");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || (env.match(/BLOB_READ_WRITE_TOKEN=(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const DRY = process.argv.includes("--dry");
if (!TOKEN && !DRY) { console.error("✗ BLOB_READ_WRITE_TOKEN not found"); process.exit(1); }
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raw = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const targets = pool.filter(p => /artic\.edu\/iiif/.test(p.img || ""));
console.log(`AIC works still on artic.edu (dead): ${targets.length}`);

const save = () => writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(pool) + raw.slice(raw.lastIndexOf("]") + 1));
let fixed = 0, dead = 0; const stillDead = [];
for (const p of targets) {
  const num = (String(p.id).match(/aic(\d+)/) || [])[1]; if (!num) { dead++; stillDead.push(p.id); continue; }
  try {
    const j = await (await fetch(`https://api.artic.edu/api/v1/artworks/${num}?fields=image_id`, { headers: { "User-Agent": UA } })).json();
    const imgId = j?.data?.image_id;
    if (!imgId) { dead++; stillDead.push(p.id + " (no image_id)"); await sleep(80); continue; }
    const url = `https://www.artic.edu/iiif/2/${imgId}/full/1686,/0/default.jpg`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*", Referer: "https://www.artic.edu/" } });
    if (!r.ok) { dead++; stillDead.push(p.id + " (iiif " + r.status + ")"); await sleep(80); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000) { dead++; stillDead.push(p.id + " (tiny)"); continue; }
    console.log(`  ${DRY ? "would fix" : "FIX"} ${p.id} -> image_id ${imgId}`);
    if (DRY) { fixed++; await sleep(80); continue; }
    const { url: blobUrl } = await put(`aic/${p.id}.jpg`, buf, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", token: TOKEN });
    if (!p.origImg) p.origImg = p.img;
    p.img = blobUrl; p.src = "aic-blob";
    fixed++;
    if (fixed % 10 === 0) save();
  } catch (e) { dead++; stillDead.push(p.id + " — " + e.message); }
  await sleep(100);
}
if (!DRY) save();
writeFileSync("data/incoming/aic-reresolve-dead.json", JSON.stringify(stillDead, null, 1));
console.log(`\nre-resolved ${fixed} · still dead ${dead} -> data/incoming/aic-reresolve-dead.json`);
