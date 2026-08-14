// Deeper higher-res finder for blurry pool images — goes beyond v1's shallow Commons search.
// Strategy per blurry work:
//   1. MUSEUM IIIF FULL — if the image is a museum CDN (Met/Cleveland/AIC/NGA/generic IIIF), request the
//      full-size master. This is the same image at max resolution → NO vision check needed (how:"iiif-full").
//   2. DEEPER COMMONS — search Commons with several query variants, imageinfo the top candidates, keep the
//      largest that plausibly matches (surname/title token) → needs vision check (how:"commons-deep").
// Reads data/incoming/pool-image-audit.json (real-LOW works) → stages data/incoming/hires-v2.json.
//   node scripts/find-hires-v2.mjs [maxWorks]
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "GessoHiResV2/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 1200;
const MAX = parseInt(process.argv.find(a => /^\d+$/.test(a)) || "9999", 10);

const audit = JSON.parse(readFileSync("data/incoming/pool-image-audit.json", "utf8"));
const works = audit.hard.filter(f => f.status === "LOW").slice(0, MAX);
console.log(`blurry works to search: ${works.length}`);

function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(16);
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return buf.readUInt16BE(o + 7); o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
async function urlWidth(url) { try { const r = await fetch(url, { headers: UA }); if (!r.ok) return null; return sizeFromBytes(Buffer.from(await r.arrayBuffer())); } catch { return null; } }

// museum-CDN → list of larger-master URL candidates to try (biggest first)
function iiifFullVariants(url) {
  const out = [];
  if (/images\.metmuseum\.org/.test(url)) out.push(url.replace("/web-large/", "/original/"));
  if (/clevelandart\.org/.test(url)) { out.push(url.replace("_web.jpg", "_print.jpg")); out.push(url.replace(/_web\.jpg$/, "_full.jpg")); }
  if (/artic\.edu\/iiif/.test(url)) { out.push(url.replace(/\/full\/[^/]+\//, "/full/1686,/")); out.push(url.replace(/\/full\/[^/]+\//, "/full/full/")); }
  if (/api\.nga\.gov\/iiif/.test(url)) { out.push(url.replace(/\/full\/[^/]+\//, "/full/!3000,3000/")); out.push(url.replace(/\/full\/[^/]+\//, "/full/full/")); }
  // generic IIIF (path has /full/<size>/<rot>/default.<ext>)
  if (/\/full\/[^/]+\/\d+\/default\.\w+/.test(url) && !out.length) { out.push(url.replace(/\/full\/[^/]+\//, "/full/!3000,3000/")); out.push(url.replace(/\/full\/[^/]+\//, "/full/full/")); }
  return out;
}
async function commonsSearch(title, artist) {
  const surname = String(artist || "").trim().split(/\s+/).pop() || "";
  const titleToks = String(title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length >= 5);
  const queries = [title, [title, surname].filter(Boolean).join(" "), surname].filter(Boolean);
  const seen = new Set(); let best = null;
  for (const q of queries) {
    try {
      const s = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=20&srsearch=" + encodeURIComponent(q), { headers: UA });
      const hits = ((await s.json()).query?.search || []).map(x => x.title.replace(/^File:/, "")).filter(f => /\.(jpe?g|png|tiff?)$/i.test(f));
      for (const f of hits) {
        if (seen.has(f)) continue; seen.add(f);
        const fl = f.toLowerCase();
        const matches = (surname.length >= 4 && fl.includes(surname.toLowerCase())) || titleToks.filter(t => fl.includes(t)).length >= 1;
        if (!matches) continue;
        const inf = await fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=size|extmetadata&titles=" + encodeURIComponent("File:" + f), { headers: UA }).then(r => r.json()).catch(() => null);
        await sleep(70);
        const ii = inf && Object.values(inf.query?.pages || {})[0]?.imageinfo?.[0];
        if (ii && ii.width >= MIN && (!best || ii.width > best.w)) best = { file: f, w: ii.width };
      }
    } catch {}
    await sleep(90);
  }
  if (best) return { newImg: "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(best.file) + "?width=1600", newW: best.w };
  return null;
}

const iiif = [], commons = [], stuck = [];
let i = 0;
for (const f of works) {
  i++;
  let done = false;
  for (const v of iiifFullVariants(f.img)) { const wd = await urlWidth(v); await sleep(50); if (wd && wd >= MIN) { iiif.push({ ...f, newImg: v, newW: wd, how: "iiif-full" }); done = true; break; } }
  if (!done) { const c = await commonsSearch(f.title, f.artist); if (c) { commons.push({ ...f, ...c, how: "commons-deep" }); done = true; } }
  if (!done) stuck.push(f);
  if (i % 20 === 0) process.stdout.write(`  ${i}/${works.length} · iiif ${iiif.length} · commons ${commons.length} · stuck ${stuck.length}\n`);
  await sleep(40);
}
writeFileSync("data/incoming/hires-v2.json", JSON.stringify({ iiif, commons, stuck }, null, 1));
console.log(`\nDONE: iiif-full ${iiif.length} (safe, same image) · commons-deep ${commons.length} (needs vision check) · stuck ${stuck.length} (no source found)`);
console.log("-> data/incoming/hires-v2.json");
