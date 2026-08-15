// Shared native-dimension reader (Phase 3 efficiency). The committed fingerprint baseline
// (data/image-fingerprints.json) stores native w×h per pool id AT the url it was fingerprinted. Resolution
// audits don't need to re-fetch an image whose url is unchanged since then — the baseline w×h is the same
// master, so it's authoritative. A missing entry, missing dim, or a changed url falls back to a live fetch
// (the caller's job). Silent upstream size changes at an UNCHANGED url are the drift-watch's concern
// (check-image-drift), not this reader's — so a resolution audit stays fast and a drift is caught separately.
import { readFileSync } from "node:fs";

let _fp = null;
export function loadFingerprints(path = "data/image-fingerprints.json") {
  if (_fp) return _fp;
  try { _fp = JSON.parse(readFileSync(path, "utf8")); } catch { _fp = {}; }
  return _fp;
}

// {w,h} from the baseline when it's a trustworthy same-image hit (id present, dims known, url unchanged),
// else null → the caller should fetch. Pass useCache=false (e.g. a --refresh flag) to force a full re-fetch.
export function baselineDim(work, { fp = loadFingerprints(), useCache = true } = {}) {
  if (!useCache) return null;
  const e = fp[work.id];
  if (e && e.w && e.h && e.url === work.img) return { w: e.w, h: e.h };
  return null;
}

const UA = { "User-Agent": "GessoImgDims/1.0 (kathryn.swint@gmail.com)" };
const commonsFile = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o + 9 < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { o += 2; continue; } o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The ONE correct way to resolve native dims for a set of works — so no audit reimplements it wrongly.
// Order: (1) fingerprint baseline (no fetch, ~92%); (2) Commons misses → imageinfo (the NATIVE master, NOT
// a Range read of the ?width= URL, which would return the SERVED/scaled size); (3) museum misses → Range
// header. Returns Map(id → {w,h} | {err}). Batches Commons imageinfo 40/call; Range fetches at concurrency 12.
export async function resolveDims(works, { useCache = true, fp = loadFingerprints() } = {}) {
  const out = new Map();
  const misses = [];
  for (const p of works) { const d = baselineDim(p, { fp, useCache }); if (d) out.set(p.id, d); else misses.push(p); }
  // Commons misses → imageinfo (native), batched + canonical-filename join (redirects=1)
  const commons = misses.filter(p => commonsFile(p.img));
  const files = [...new Set(commons.map(p => commonsFile(p.img)))];
  const cSizes = {};
  for (let i = 0; i < files.length; i += 40) {
    const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(files.slice(i, i + 40).map(f => "File:" + f).join("|"));
    try { const pages = (await (await fetch(u, { headers: UA })).json()).query?.pages || {}; for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; if (ii) cSizes[t] = { w: ii.width, h: ii.height }; } } catch {}
    await sleep(60);
  }
  for (const p of commons) { const s = cSizes[canon(commonsFile(p.img))]; out.set(p.id, s || { err: "commons-missing" }); }
  // museum misses → Range header (this is what actually renders; museum URLs aren't width-scaled like Commons)
  const museum = misses.filter(p => !commonsFile(p.img));
  for (let i = 0; i < museum.length; i += 12) {
    await Promise.all(museum.slice(i, i + 12).map(async p => {
      try { const r = await fetch(p.img, { headers: { ...UA, Range: "bytes=0-65535" } }); if (!r.ok && r.status !== 206) return out.set(p.id, { err: r.status }); const s = sizeFromBytes(Buffer.from(await r.arrayBuffer())); out.set(p.id, s || { err: "unparsed" }); }
      catch (e) { out.set(p.id, { err: String(e.message).slice(0, 40) }); }
    }));
  }
  return out;
}

// Single resolution judgment, shared by every resolution audit so they can't disagree or mis-flag.
// The reveal renders an image FIT-TO-CONTAIN, which scales by the LONGER dimension — so the long (max) side
// is what determines on-screen sharpness, uniformly for landscapes, portraits, AND panoramas/handscrolls
// (whose small short side is a FORMAT, not low quality — the sliver problem is owned by audit-image-ratio).
// Judging by the short side (the old heuristic) wrongly flagged wide/tall high-res works as "blurry".
// Returns "LOW" | "borderline" | "ok".
export function classifyRes({ w, h }, { low = 700, borderline = 1000 } = {}) {
  if (!w || !h) return "ok"; // unknown dims → don't flag (caller handles genuine fetch errors separately)
  const long = Math.max(w, h);
  if (long >= borderline) return "ok";
  if (long < low) return "LOW";
  return "borderline";
}
