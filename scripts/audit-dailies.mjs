// Daily image audit — the gate that stops low-res images (and unreachable images) from reaching a daily.
// Why this is separate from check-pool: check-pool validates the whole pool's fields; THIS replays the actual
// daily rotation for the next N days x 4 tiers, resolves each work's native image resolution, and flags any
// that would render blurry (native width below threshold, or a URL requesting a bigger width than the source
// has = upscaling — exactly the "La Belle Nani was 312px upscaled to 1600" bug).
//   node scripts/audit-dailies.mjs [days]      # default 28 days (4 weeks)
//   node scripts/audit-dailies.mjs 28 --json
import { readFileSync } from "node:fs";
import { baselineDim, classifyRes } from "./lib/img-dimensions.mjs";

const DAYS = parseInt(process.argv.find(a => /^\d+$/.test(a)) || "28", 10);
const JSON_OUT = process.argv.includes("--json");
const useCache = !process.argv.includes("--refresh"); // --refresh = re-fetch every image, ignore the fingerprint baseline
const ROUNDS = 5;                 // works per day per tier (matches index.html)
const LOW = 700;                  // native width below this = blurry on the reveal
const BORDERLINE = 1000;          // 700..1000 = warn
const UA = { "User-Agent": "GessoDailyAudit/1.0 (kathryn.swint@gmail.com)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL || [];
const byId = Object.fromEntries(POOL.map(p => [p.id, p]));
// load the daily-order + history globals cleanly
const g = {}; new Function("window", readFileSync("data/daily-order.js", "utf8"))(g);
let hist = {}; try { const gh = {}; new Function("window", readFileSync("data/daily-history.js", "utf8"))(gh); hist = gh.ARTEFACTUM_DAILY_HISTORY || {}; } catch {}
const DAILY = g.ARTEFACTUM_DAILY || {};

// movement completeness (mirrors freeze/index workComplete) so we replay the SAME perm the app builds
const html = readFileSync("index.html", "utf8");
const a = html.indexOf("const MOVEMENTS={"), b = html.indexOf("const MOV_FAMILY=");
const movKeys = new Set([...html.slice(a, b).matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]));
const workComplete = p => !!(p && ((p.medium && String(p.medium).trim()) || (p.style && (movKeys.has(p.style) || p.styleKind === "culture" || p.styleKind === "movement"))));

const TIERS = ["easy", "medium", "hard", "impossible"];
const parseLocalDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseLocalDate(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// replay dailyItems(key,date) exactly as index.html does (pinned -> ledger -> frozen rotation)
function dailyItems(key, dateStr) {
  const pinned = (DAILY.byDate || {})[dateStr];
  if (pinned && Array.isArray(pinned[key]) && pinned[key].length) {
    const got = pinned[key].map(id => byId[id]).filter(Boolean).filter(workComplete);
    if (got.length >= ROUNDS) return got.slice(0, ROUNDS);
  }
  const led = (hist.byDate || {})[dateStr];
  if (led && Array.isArray(led[key]) && led[key].length) {
    const got = led[key].map(id => byId[id]).filter(Boolean).filter(workComplete);
    if (got.length >= ROUNDS) return got.slice(0, ROUNDS);
  }
  const frozen = DAILY[key]; if (!frozen || frozen.length < ROUNDS) return [];
  const perm = frozen.map(id => byId[id]).filter(Boolean).filter(workComplete);
  const len = perm.length; if (!len) return [];
  const day = Math.floor(parseLocalDate(dateStr).getTime() / 86400000);
  const start = ((day * ROUNDS) % len + len) % len;
  const out = [], seen = new Set(), seenArt = new Set();
  const tkey = p => String(p && p.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const akey = p => { const x = String(p && p.artist || "").trim().toLowerCase(); return (x && !/^(unknown|anon|unidentified)/.test(x)) ? x : ""; };
  for (let k = 0; k < len && out.length < ROUNDS; k++) { const p = perm[(start + k) % len]; if (!p) continue; const tk = tkey(p), ak = akey(p); if (seen.has(tk) || (ak && seenArt.has(ak))) continue; seen.add(tk); if (ak) seenArt.add(ak); out.push(p); }
  while (out.length < ROUNDS && len) out.push(perm[(start + out.length) % len]);
  return out;
}

// figure out today (local) without Date.now sensitivity in the report — read the arg or use system date
const today = new Date().toISOString().slice(0, 10);

// collect the unique daily works over the window, tagging which date/tier surfaced them
const scheduled = new Map(); // id -> {work, hits:[{date,tier}]}
for (let d = 0; d < DAYS; d++) {
  const date = addDays(today, d);
  for (const tier of TIERS) for (const p of dailyItems(tier, date)) {
    const e = scheduled.get(p.id) || (scheduled.set(p.id, { work: p, hits: [] }), scheduled.get(p.id));
    e.hits.push({ date, tier });
  }
}

// --- resolution resolvers ---
const reqWidth = url => { const m = String(url).match(/[?&]width=(\d+)/); return m ? +m[1] : null; };
const commonsFile = url => { const m = String(url).match(/Special:FilePath\/([^?]+)/); return m ? decodeURIComponent(m[1]) : null; };
// canonical Commons filename (underscores→spaces, first char uppercased) so the URL-derived name and the
// API-normalized title join — without this, famous works fell through as false "commons-missing".
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

// parse width/height from JPEG/PNG bytes (for non-Commons museum CDNs)
function sizeFromBytes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8) { // JPEG: scan SOF markers
    let o = 2;
    while (o < buf.length) {
      if (buf[o] !== 0xFF) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

// Commons native res via imageinfo (batch 40 titles/call) — no image download
async function commonsSizes(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" +
      encodeURIComponent(batch.map(f => "File:" + f).join("|"));
    try { const r = await fetch(u, { headers: UA }); const j = await r.json(); const pages = j.query?.pages || {};
      for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); const ii = pages[k].imageinfo?.[0]; if (ii) out[t] = { w: ii.width, h: ii.height }; else out[t] = null; }
    } catch {}
    await sleep(120);
  }
  return out;
}
async function fetchSize(url) {
  try { const r = await fetch(url, { headers: UA }); if (!r.ok) return { err: r.status }; const buf = Buffer.from(await r.arrayBuffer()); return sizeFromBytes(buf) || { err: "unparsed" }; }
  catch (e) { return { err: e.message }; }
}

const works = [...scheduled.values()];
// resolve native dims from the fingerprint baseline first (same master, no fetch); only cache-misses hit the network
const baseHit = new Map();
for (const e of works) { const d = baselineDim(e.work, { useCache }); if (d) baseHit.set(e.work.id, d); }
const misses = works.filter(e => !baseHit.has(e.work.id));
const commonsFiles = [...new Set(misses.map(e => commonsFile(e.work.img)).filter(Boolean))];
const cSizes = await commonsSizes(commonsFiles);

const findings = [];
for (const e of works) {
  const p = e.work; let native = baseHit.get(p.id) || null, err = null;
  if (!native) { const cf = commonsFile(p.img);
    if (cf) { const s = cSizes[canon(cf)]; if (s) native = s; else err = "commons-missing"; }
    else { const s = await fetchSize(p.img); if (s.w) native = s; else err = s.err; await sleep(40); } }
  const rw = reqWidth(p.img);
  // native >= BORDERLINE renders crisp even on a retina reveal, regardless of the requested width, so it's ok.
  let status = "ok";
  if (err) status = "unreachable";
  else status = classifyRes(native, { low: LOW, borderline: BORDERLINE }); // aspect-aware: a wide handscroll isn't "blurry"
  if (status !== "ok") findings.push({ id: p.id, title: p.title, tier: e.hits[0].tier, dates: [...new Set(e.hits.map(h => h.date))], nativeW: native?.w || null, reqW: rw, status, err, img: p.img });
}

const rank = { unreachable: 0, LOW: 1, borderline: 2 };
findings.sort((x, y) => (rank[x.status] - rank[y.status]) || (x.nativeW || 0) - (y.nativeW || 0));

if (JSON_OUT) { console.log(JSON.stringify({ window: { from: today, days: DAYS }, checked: works.length, findings }, null, 1)); process.exit(findings.some(f => f.status === "LOW" || f.status === "unreachable") ? 1 : 0); }

console.log(`\nDAILY IMAGE AUDIT — next ${DAYS} days x ${TIERS.length} tiers · ${works.length} unique scheduled works checked`);
const hard = findings.filter(f => f.status === "LOW" || f.status === "unreachable");
const soft = findings.filter(f => f.status === "borderline");
console.log(`\n🔴 BLURRY / BROKEN (${hard.length}) — native width < ${LOW}px or image unreachable:`);
if (!hard.length) console.log("   none 🎉");
for (const f of hard) console.log(`   [${f.tier}] ${f.dates[0]} · "${f.title}" · native ${f.nativeW ?? f.err} · ${f.img.slice(0, 70)}`);
console.log(`\n🟡 SOFT (${soft.length}) — upscaled request or 700–${BORDERLINE}px:`);
for (const f of soft.slice(0, 30)) console.log(`   [${f.tier}] "${f.title}" · native ${f.nativeW} · requests ${f.reqW} · ${f.status}`);
if (soft.length > 30) console.log(`   …and ${soft.length - 30} more`);
console.log(`\nSummary: ${hard.length} blurry/broken · ${soft.length} soft. ${hard.length ? "FAIL — fix these before they go live." : "PASS."}\n`);
process.exit(hard.length ? 1 : 0);
