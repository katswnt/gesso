// Capture a per-work image FINGERPRINT baseline so we can detect when a hot-linked source image changes
// out from under us (Commons revert/replace/crop/downsize/delete, museum CDN reorg). We don't store the
// images (they're served live by URL), so the fingerprint IS the stored state we diff against.
//   Commons  → sha1 content hash + width×height (imageinfo, no download)
//   museum   → width×height + byte size (Range header fetch, no full download)
// Writes data/image-fingerprints.json keyed by work id. Commit it — it's the known-good baseline.
//   node scripts/fingerprint-images.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "GessoFingerprint/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];
const commonsFile = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}

// Commons: batched imageinfo → sha1 + size (no image download)
async function commonsFp(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size|sha1&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|"));
    try { const r = await fetch(u, { headers: UA }); const j = await r.json(); const pages = j.query?.pages || {};
      for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; out[t] = ii ? { w: ii.width, h: ii.height, sha1: ii.sha1 } : null; }
    } catch {}
    if (i % 400 === 0) process.stderr.write(`  commons ${i}/${files.length}\n`);
    await sleep(60);
  }
  return out;
}
// museum CDN: Range GET → dims from header bytes + total byte size from Content-Range
async function museumFp(url) {
  try { let r = await fetch(url, { headers: { ...UA, Range: "bytes=0-65535" } });
    // Some museum CDNs (e.g. Te Papa /full masters) 500 on Range requests. Fall back to a full GET so those
    // works still get a fingerprint baseline instead of a silent null (which would leave them undrift-watched).
    if (!r.ok && r.status !== 206) r = await fetch(url, { headers: UA });
    if (!r.ok && r.status !== 206) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const s = sizeFromBytes(buf);
    const cr = r.headers.get("content-range");
    const bytes = cr ? parseInt(cr.split("/")[1], 10) : (parseInt(r.headers.get("content-length"), 10) || buf.length || null);
    return s ? { w: s.w, h: s.h, bytes } : (bytes ? { bytes } : null);
  } catch { return null; }
}

const commonsFiles = [...new Set(POOL.map(p => commonsFile(p.img)).filter(Boolean))];
process.stderr.write(`pool ${POOL.length} · commons ${commonsFiles.length} · fingerprinting…\n`);
const cFp = await commonsFp(commonsFiles);

const fp = {}; let n = 0, ok = 0;
for (const p of POOL) {
  n++; const cf = commonsFile(p.img);
  let rec = null;
  if (cf) { const s = cFp[canon(cf)]; if (s) rec = { src: "commons", ...s }; }
  else { const s = await museumFp(p.img); if (s) rec = { src: "url", ...s }; await sleep(20); }
  if (rec) { rec.url = p.img; fp[p.id] = rec; ok++; }
  if (n % 500 === 0) process.stderr.write(`  ${n}/${POOL.length} · ${ok} fingerprinted\n`);
}
writeFileSync("data/image-fingerprints.json", JSON.stringify(fp, null, 0));
console.log(`fingerprinted ${ok}/${POOL.length} works -> data/image-fingerprints.json`);
