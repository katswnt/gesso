// Scoped resolution/liveness sweep of the EASY-candidate pool (top-410 by fame that head easy dailies).
// Reuses the same native-size logic as audit-images-pool.mjs (Commons imageinfo batch + museum Range header),
// but only over the easy tier — so we know which easy images need a re-fetch BEFORE spending Sonnet v2 tokens.
// Reads data/incoming/easy-candidate-ids.json (written by the g-score prep). Flags LOW <700, SOFT 700–1000,
// DEAD (fetch error / gone). Writes data/incoming/easy-image-audit.json.
//   node scripts/audit-easy-images.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { classifyRes } from "./lib/img-dimensions.mjs";
const LOW = 700, SOFT = 1000;
const UA = { "User-Agent": "GessoEasyImgAudit/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const byId = Object.fromEntries((w.ARTEFACTUM_POOL || []).map(p => [p.id, p]));
const easyIds = JSON.parse(readFileSync("data/incoming/easy-candidate-ids.json", "utf8"));
const works = easyIds.map(id => byId[id]).filter(Boolean);

const commonsFile = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
async function commonsSizes(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|"));
    try { const r = await fetch(u, { headers: UA }); const j = await r.json(); const pages = j.query?.pages || {};
      for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; out[t] = ii ? { w: ii.width, h: ii.height } : null; }
    } catch {}
    await sleep(60);
  }
  return out;
}
async function fetchSize(url) {
  try { const r = await fetch(url, { headers: { ...UA, Range: "bytes=0-65535" } });
    if (!r.ok && r.status !== 206) return { err: r.status };
    const s = sizeFromBytes(Buffer.from(await r.arrayBuffer()));
    return s ? { w: s.w, h: s.h } : { unknown: true };
  } catch (e) { return { err: String(e.message) }; }
}

const commonsFiles = [...new Set(works.map(p => commonsFile(p.img)).filter(Boolean))];
process.stderr.write(`easy works ${works.length} · commons files ${commonsFiles.length} · museum ${works.length - commonsFiles.length}\n`);
const cSizes = await commonsSizes(commonsFiles);

const findings = [];
for (const p of works) {
  const cf = commonsFile(p.img); let native = null, err = null, unknown = false;
  if (cf) { const s = cSizes[canon(cf)]; if (s) native = s; else err = "commons-missing"; }
  else { const s = await fetchSize(p.img); if (s.w) native = s; else if (s.unknown) unknown = true; else err = s.err; await sleep(20); }
  let status = "ok";
  const nw = native ? Math.min(native.w, native.h) : null; // shortest side (kept for the report display only)
  if (err != null) status = "dead";
  else if (unknown) status = "unknown";
  else { const c = classifyRes(native, { low: LOW, borderline: SOFT }); status = c === "LOW" ? "low" : c === "borderline" ? "soft" : "ok"; }
  if (status !== "ok") findings.push({ id: p.id, title: p.title, region: p.region || "", native: native ? `${native.w}x${native.h}` : null, short: nw, status, err, img: p.img });
}

const by = s => findings.filter(f => f.status === s);
mkdirSync("data/incoming", { recursive: true });
writeFileSync("data/incoming/easy-image-audit.json", JSON.stringify({ scanned: works.length, low: by("low"), soft: by("soft"), dead: by("dead"), unknown: by("unknown") }, null, 1));
console.log(`\nEASY-POOL RESOLUTION SWEEP · ${works.length} works`);
console.log(`  DEAD (fetch failed/gone): ${by("dead").length}`);
console.log(`  LOW  (<${LOW}px short side): ${by("low").length}`);
console.log(`  SOFT (${LOW}–${SOFT}px)      : ${by("soft").length}`);
console.log(`  unknown (unparseable header): ${by("unknown").length}`);
for (const g of ["dead", "low", "soft"]) { const a = by(g); if (a.length) { console.log(`\n-- ${g.toUpperCase()} --`); for (const f of a) console.log(`  ${(f.native || f.err || "?").padEnd(12)} ${(f.region || "?").padEnd(13)} ${f.title.slice(0, 40)}`); } }
console.log("\nwrote data/incoming/easy-image-audit.json");
