// FULL-SITE image resolution audit — checks the NATIVE resolution of every pool image (not just dailies),
// since infinite mode, training, and collections all pull from the whole pool. Reports blurry (<700px) and
// soft (700–1000px) works grouped by daily tier, and stages the blurry list for a higher-res fix pass.
//   node scripts/audit-images-pool.mjs            # human report
//   node scripts/audit-images-pool.mjs --json     # -> data/incoming/pool-image-audit.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { classifyRes } from "./lib/img-dimensions.mjs";
const LOW = 700, BORDERLINE = 1000;
const UA = { "User-Agent": "GessoPoolImgAudit/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const JSON_OUT = process.argv.includes("--json");

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];
// tier membership from the frozen daily order (a work can headline a daily only in its tier)
const g = {}; new Function("window", readFileSync("data/daily-order.js", "utf8"))(g);
const DAILY = g.ARTEFACTUM_DAILY || {};
const tierOf = {}; for (const t of ["easy", "medium", "hard", "impossible"]) for (const id of (DAILY[t] || [])) if (!(id in tierOf)) tierOf[id] = t;

const reqWidth = url => { const m = String(url).match(/[?&]width=(\d+)/); return m ? +m[1] : null; };
const commonsFile = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) { let o = 2; while (o < buf.length) { if (buf[o] !== 0xFF) { o++; continue; } const m = buf[o + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }; o += 2 + buf.readUInt16BE(o + 2); } }
  return null;
}
// canonical Commons filename: underscores→spaces, first char uppercased (matches how the API normalizes titles)
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
async function commonsSizes(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(batch.map(f => "File:" + f).join("|"));
    try { const r = await fetch(u, { headers: UA }); const j = await r.json(); const pages = j.query?.pages || {};
      for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; out[t] = ii ? { w: ii.width, h: ii.height } : null; }
    } catch {}
    if (i % 400 === 0) process.stderr.write(`  commons ${i}/${files.length}\n`);
    await sleep(60);
  }
  return out;
}
// Range-only fetch: read the first 64KB and parse the JPEG/PNG header — avoids downloading whole images.
async function fetchSize(url) {
  try { const r = await fetch(url, { headers: { ...UA, Range: "bytes=0-65535" } });
    if (!r.ok && r.status !== 206) return { err: r.status };
    const s = sizeFromBytes(Buffer.from(await r.arrayBuffer()));
    return s ? { w: s.w, h: s.h } : { unknown: true }; // couldn't parse (deep header) — treat as unknown, don't flag
  } catch (e) { return { err: e.message }; }
}

const commonsFiles = [...new Set(POOL.map(p => commonsFile(p.img)).filter(Boolean))];
process.stderr.write(`pool ${POOL.length} · commons files ${commonsFiles.length} · fetching…\n`);
const cSizes = await commonsSizes(commonsFiles);

const findings = [];
let n = 0;
for (const p of POOL) {
  n++; const cf = commonsFile(p.img); let native = null, err = null, unknown = false;
  if (cf) { const s = cSizes[canon(cf)]; if (s) native = s; else err = "commons-missing"; }
  else { const s = await fetchSize(p.img); if (s.w) native = s; else if (s.unknown) unknown = true; else err = s.err; await sleep(20); }
  let status = "ok";
  if (unknown) status = "ok";                          // size unparseable — don't false-flag
  else if (err) status = "unreachable";
  else status = classifyRes(native, { low: LOW, borderline: BORDERLINE }); // aspect-aware long-side metric (shared)
  if (status !== "ok") findings.push({ id: p.id, title: p.title, artist: p.artist, tier: tierOf[p.id] || "(not in any tier)", fame: p.fame || 0, nativeW: native?.w || null, reqW: reqWidth(p.img), status, err, img: p.img });
  if (n % 500 === 0) process.stderr.write(`  scanned ${n}/${POOL.length} · ${findings.length} flagged\n`);
}

const hard = findings.filter(f => f.status === "LOW" || f.status === "unreachable");
const soft = findings.filter(f => f.status === "borderline");
mkdirSync("data/incoming", { recursive: true });
writeFileSync("data/incoming/pool-image-audit.json", JSON.stringify({ checked: POOL.length, hard, soft }, null, 1));

const byTier = {}; for (const f of hard) { const t = f.tier; (byTier[t] = byTier[t] || { count: 0 }).count++; }
if (JSON_OUT) { console.log(JSON.stringify({ checked: POOL.length, hardCount: hard.length, softCount: soft.length, byTier }, null, 1)); process.exit(0); }
console.log(`\nFULL-SITE IMAGE AUDIT — ${POOL.length} works`);
console.log(`\n🔴 BLURRY / BROKEN (native < ${LOW}px): ${hard.length}`);
console.log("   by tier: " + Object.entries(byTier).map(([t, v]) => `${t} ${v.count}`).join(" · "));
console.log(`\n🟡 SOFT (${LOW}–${BORDERLINE}px): ${soft.length}`);
console.log(`\nworst 25 blurry:`);
for (const f of hard.sort((a, b) => (a.nativeW || 0) - (b.nativeW || 0)).slice(0, 25)) console.log(`   [${f.tier}] ${f.nativeW ?? f.err}px · "${f.title}" — ${f.artist || "anon"}`);
console.log(`\n-> full list: data/incoming/pool-image-audit.json`);
