// Detect when a hot-linked source image has CHANGED since we fingerprinted it. Re-fetches each work's
// current fingerprint (Commons sha1+size via imageinfo — no download; museum dims+bytes via Range header)
// and diffs against data/image-fingerprints.json. Any change (content hash differs, resolution dropped,
// image gone) → flagged and queued for a fresh resolution + vision re-audit. Run weekly / in the loop.
//   node scripts/check-image-drift.mjs           # human report
//   node scripts/check-image-drift.mjs --json     # -> data/incoming/image-drift.json (+ re-audit queue)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const UA = { "User-Agent": "GessoDrift/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const JSON_OUT = process.argv.includes("--json");

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];
const byId = Object.fromEntries(POOL.map(p => [p.id, p]));
let base = {}; try { base = JSON.parse(readFileSync("data/image-fingerprints.json", "utf8")); } catch { console.error("no baseline — run fingerprint-images.mjs first"); process.exit(1); }

const commonsFile = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
async function commonsNow(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size|sha1&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|"));
    try { const r = await fetch(u, { headers: UA }); const j = await r.json(); const pages = j.query?.pages || {};
      for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; out[t] = ii ? { w: ii.width, h: ii.height, sha1: ii.sha1 } : null; }
    } catch {}
    await sleep(60);
  }
  return out;
}
async function museumNow(url) {
  try { const r = await fetch(url, { headers: { ...UA, Range: "bytes=0-65535" } });
    if (!r.ok && r.status !== 206) return { gone: r.status };
    const s = sizeFromBytes(Buffer.from(await r.arrayBuffer()));
    const cr = r.headers.get("content-range"); const bytes = cr ? parseInt(cr.split("/")[1], 10) : (parseInt(r.headers.get("content-length"), 10) || null);
    return s ? { w: s.w, h: s.h, bytes } : { bytes };
  } catch (e) { return { gone: e.message }; }
}

const cNow = await commonsNow([...new Set(POOL.map(p => commonsFile(p.img)).filter(Boolean))]);

const drift = [];
let n = 0, checked = 0;
for (const p of POOL) {
  n++; const b = base[p.id]; if (!b) continue; // no baseline for this work (added since) — skip; fingerprint run will pick it up
  // if the URL itself changed since fingerprinting, that's a definite change to re-audit
  if (b.url && b.url !== p.img) { drift.push({ id: p.id, title: p.title, kind: "url-changed", was: b.url, now: p.img }); continue; }
  const cf = commonsFile(p.img); let now = null;
  if (cf) now = cNow[canon(cf)]; else { now = await museumNow(p.img); await sleep(20); }
  checked++;
  if (!now || now.gone) { drift.push({ id: p.id, title: p.title, kind: "gone", detail: now?.gone || "no-data", img: p.img }); continue; }
  if (b.src === "commons" && b.sha1 && now.sha1) {
    if (now.sha1 !== b.sha1) drift.push({ id: p.id, title: p.title, kind: "content-changed", wasW: b.w, nowW: now.w, wasSha1: b.sha1?.slice(0, 10), nowSha1: now.sha1?.slice(0, 10), img: p.img });
  } else { // museum: dims or bytes changed
    if ((b.w && now.w && b.w !== now.w) || (b.h && now.h && b.h !== now.h) || (b.bytes && now.bytes && b.bytes !== now.bytes))
      drift.push({ id: p.id, title: p.title, kind: "size-changed", wasW: b.w, nowW: now.w, wasBytes: b.bytes, nowBytes: now.bytes, img: p.img });
  }
  if (n % 800 === 0) process.stderr.write(`  ${n}/${POOL.length} · ${drift.length} drift\n`);
}
// CONFIRM "gone" before trusting it — a single transient fetch failure (429/timeout) must not trigger a
// re-audit. Re-fetch each gone candidate once with a delay; drop the ones that come back.
const goneIdx = drift.map((d, i) => d.kind === "gone" ? i : -1).filter(i => i >= 0);
if (goneIdx.length) { process.stderr.write(`  re-verifying ${goneIdx.length} 'gone' candidates…\n`);
  const stillGone = [];
  for (const i of goneIdx) { const d = drift[i]; const p = byId[d.id]; await sleep(400);
    const cf = commonsFile(p.img); let now;
    if (cf) { const r = await commonsNow([cf]); now = r[canon(cf)]; } else now = await museumNow(p.img);
    if (now && !now.gone) drift[i] = null; else stillGone.push(d.id); }         // recovered → not drift
}
const confirmed = drift.filter(Boolean);
drift.length = 0; drift.push(...confirmed);
// works that DROPPED in resolution are the urgent ones (now blurry); content-changed also needs a visual re-check
const queue = drift.filter(d => d.kind !== "size-changed" || (d.nowW && d.wasW && d.nowW < d.wasW)).map(d => d.id);
mkdirSync("data/incoming", { recursive: true });
writeFileSync("data/incoming/image-drift.json", JSON.stringify({ checked, drift, reauditQueue: queue }, null, 1));

const byKind = {}; for (const d of drift) byKind[d.kind] = (byKind[d.kind] || 0) + 1;
if (JSON_OUT) { console.log(JSON.stringify({ checked, driftCount: drift.length, byKind, reaudit: queue.length }, null, 1)); process.exit(drift.length ? 1 : 0); }
console.log(`\nIMAGE DRIFT CHECK — ${checked} works compared to baseline`);
console.log(`\nchanged since fingerprint: ${drift.length}  ${JSON.stringify(byKind)}`);
for (const d of drift.slice(0, 40)) console.log(`  [${d.kind}] "${(d.title || "").slice(0, 44)}"${d.wasW ? ` ${d.wasW}→${d.nowW}px` : ""}`);
if (drift.length > 40) console.log(`  …and ${drift.length - 40} more`);
console.log(`\n${queue.length} queued for re-audit -> data/incoming/image-drift.json`);
console.log(drift.length ? "Run the resolution + vision audit on the queued ids, then re-fingerprint." : "No drift — all images match the baseline. ✅");
process.exit(drift.length ? 1 : 0);
