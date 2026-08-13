// Vision-pass-v2 PREP. Selects the target works (next 7 days of dailies + the 3 friends'-study dates),
// downloads each image LOCALLY (so an image-grounded subagent can Read the real pixels — no fabrication),
// and writes a manifest + chunk lists. Then the operator spawns subagents per chunk (see docs/vision-pass-v2.md
// runbook), and scripts/vision-v2-merge.mjs folds the results back in. Uses Max-plan subagents, not the API.
//   node scripts/vision-v2-prep.mjs [chunkSize=12]
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";

const CHUNK = parseInt(process.argv[2] || "12", 10);
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIR = "/tmp/v2", IMGS = DIR + "/imgs", OUT = DIR + "/out";
for (const d of [DIR, IMGS, OUT]) mkdirSync(d, { recursive: true });

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const idx = {}; for (const p of w.ARTEFACTUM_POOL) { idx[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) idx["wikidata:" + m[0]] = idx["http://www.wikidata.org/entity/" + m[0]] = p; }
const res = id => idx[id] || (String(id).match(/Q\d+/) && idx["wikidata:" + String(id).match(/Q\d+/)[0]]) || null;
const teach = (() => { try { const t = readFileSync("data/teach-works.js", "utf8"); return JSON.parse(t.slice(t.indexOf("{", t.indexOf(".work")), t.lastIndexOf("}") + 1)); } catch { return {}; } })();

// targets: next 7 days of dailies + the 3 study dates (from the ledger)
const ord = {}; new Function("window", readFileSync("data/daily-order.js", "utf8"))(ord);
const B = (ord.ARTEFACTUM_DAILY || {}).byDate || {};
const led = (() => { const h = {}; new Function("window", readFileSync("data/daily-history.js", "utf8"))(h); return (h.ARTEFACTUM_DAILY_HISTORY || {}).byDate || {}; })();
const today = new Date().toISOString().slice(0, 10), hz = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10); // next 7 days incl today
const ids = new Set();
for (const [d, day] of Object.entries(B)) { if (d < today || d > hz) continue; for (const t of ["easy", "medium", "hard", "impossible"]) for (const id of (day[t] || [])) ids.add(id); }
// only the specific study dailies actually sent to friends (easy + one harder per date)
const STUDY = { "2026-07-11": ["easy", "medium"], "2026-07-25": ["easy", "hard"], "2026-08-05": ["easy", "medium"] };
for (const [d, tiers] of Object.entries(STUDY)) for (const t of tiers) for (const id of ((led[d] || {})[t] || [])) ids.add(id);
const works = [...ids].map(res).filter(Boolean).filter((p, i, a) => a.findIndex(q => q.id === p.id) === i);
console.log(`targets: ${works.length} distinct works (next 7 daily-days + the 6 study dailies sent to friends)`);

const safe = id => String(id).replace(/[^a-z0-9]/gi, "_");
async function grab(url, file, t = 0) {
  let u = url; if (/Special:FilePath/i.test(u) && !/[?&]width=/.test(u)) u += (u.includes("?") ? "&" : "?") + "width=1024";
  try { const r = await fetch(u, { headers: { "User-Agent": BROWSER }, signal: AbortSignal.timeout(20000) });
    if ([403, 429, 500, 502, 503, 504].includes(r.status) && t < 3) { r.body?.cancel?.(); await sleep(3500 * (t + 1)); return grab(url, file, t + 1); }
    if (!r.ok) return "http " + r.status;
    const b = Buffer.from(await r.arrayBuffer()); if (b.length < 2000) return "tiny";
    writeFileSync(file, b); return "ok";
  } catch (e) { if (t < 3) { await sleep(2500); return grab(url, file, t + 1); } return "err"; }
}

const manifest = [];
for (let i = 0; i < works.length; i++) {
  const p = works[i], file = `${IMGS}/${safe(p.id)}.jpg`;
  const st = (existsSync(file) && statSync(file).size > 2000) ? "cached" : await grab(p.img, file);
  manifest.push({ id: p.id, imgFile: (st === "ok" || st === "cached") ? file : null, imgStatus: st,
    meta: { title: p.title, artist: p.artist || "", y: p.y, place: p.place, region: p.region, medium: p.medSimple || p.medium || "", style: p.style || "" },
    existingNote: teach[p.id]?.why || null });
  if ((i + 1) % 20 === 0) console.log(`  downloaded ${i + 1}/${works.length}`);
  await sleep(700);
}
const okN = manifest.filter(m => m.imgFile).length;
writeFileSync(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 1));
// chunk the ones with a usable image
const usable = manifest.filter(m => m.imgFile).map(m => m.id);
const chunks = []; for (let i = 0; i < usable.length; i += CHUNK) chunks.push(usable.slice(i, i + CHUNK));
chunks.forEach((c, i) => writeFileSync(`${DIR}/chunk-${i + 1}.json`, JSON.stringify(c, null, 0)));
console.log(`\nimages ok: ${okN}/${works.length} · ${chunks.length} chunks of ${CHUNK} → /tmp/v2/chunk-N.json`);
console.log(`manifest: /tmp/v2/manifest.json · images: /tmp/v2/imgs/ · subagents write to /tmp/v2/out/out-N.json`);
console.log(`next: spawn one subagent per chunk (runbook in docs/vision-pass-v2.md), then node scripts/vision-v2-merge.mjs`);
