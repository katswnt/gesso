// Generalized image re-host to Vercel Blob — the systemic fix + CHECK for CDNs that gatekeep or break:
//   - AIC (artic.edu/iiif): Cloudflare blocks proxies / challenges mobile IPs
//   - Te Papa (media.tepapa.govt.nz): /full intermittently 500s
// Such images break for phone players AND can't be fetched by our fingerprint/drift audits, so they stay
// unfingerprinted (no drift-watch) and un-fixable by the vision pass (which can't see a broken image).
// Downloading here (this machine's residential IP is allowed) and serving from Blob fixes ALL of that.
// Idempotent + resumable: skips anything already on Blob. Run after ANY harvest that adds such works — this
// IS the "does every image that needs Blob hosting have it?" check. Preview with --dry (no token needed).
//   node scripts/rehost-blob.mjs [--dry]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
const env = (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "") + "\n" + (existsSync(".env") ? readFileSync(".env", "utf8") : "");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || (env.match(/BLOB_READ_WRITE_TOKEN=(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const DRY = process.argv.includes("--dry");
if (!TOKEN && !DRY) { console.error("✗ BLOB_READ_WRITE_TOKEN not found (add to .env.local). Use --dry to preview the target set without it."); process.exit(1); }
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raw = readFileSync("data/pool.js", "utf8");
const pool = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));

// THE CHECK: which pool images live on a gatekeeping/breaking CDN and are NOT already on Blob?
function needsBlob(p) {
  const u = p.img || "";
  if (/public\.blob\.vercel-storage\.com/.test(u)) return null;                 // already on Blob
  if (/artic\.edu\/iiif/.test(u)) return { prefix: "aic", urls: [u] };
  if (/media\.tepapa\.govt\.nz/.test(u)) {                                       // try /full (best) then /preview (reliable)
    const base = u.replace(/\/(full|preview)$/, "");
    return { prefix: "tepapa", urls: [base + "/full", base + "/preview"] };
  }
  return null;
}
const targets = pool.map(p => ({ p, spec: needsBlob(p) })).filter(x => x.spec);
const bySrc = {}; for (const { p } of targets) bySrc[p.src || "?"] = (bySrc[p.src || "?"] || 0) + 1;
console.log(`images needing Blob re-host: ${targets.length} · by src ${JSON.stringify(bySrc)}`);
if (DRY) { console.log("--dry: no downloads/uploads. sample:"); targets.slice(0, 8).forEach(({ p }) => console.log("  " + p.id + "  " + String(p.img).slice(0, 68))); process.exit(0); }

const save = () => writeFileSync("data/pool.js", raw.slice(0, raw.indexOf("[")) + JSON.stringify(pool) + raw.slice(raw.lastIndexOf("]") + 1));
let done = 0, fail = 0; const fails = [];
for (const { p, spec } of targets) {
  try {
    let buf = null;
    for (const u of spec.urls) {
      try { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "image/*" } }); if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length >= 1000) { buf = b; break; } } } catch {}
    }
    if (!buf) throw new Error("all source urls failed/broken");
    const { url } = await put(`${spec.prefix}/${p.id}.jpg`, buf, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", token: TOKEN });
    if (!p.origImg) p.origImg = p.img;                                            // keep the museum original
    p.img = url; p.src = spec.prefix + "-blob";
    done++;
  } catch (e) { fail++; fails.push(p.id + " — " + e.message); }
  if ((done + fail) % 25 === 0) { save(); console.error(`  ${done + fail}/${targets.length} | ok ${done} fail ${fail}`); }
  await sleep(120);
}
save();
writeFileSync("data/incoming/rehost-blob-fails.json", JSON.stringify(fails, null, 1));
console.log(`\nre-hosted ${done}/${targets.length} to Blob | failed ${fail}${fails.length ? " -> data/incoming/rehost-blob-fails.json (left on the museum CDN)" : ""}`);
console.log("NEXT: re-fingerprint (npm run fingerprint) so the newly-reachable images get a drift baseline; gate; commit.");
