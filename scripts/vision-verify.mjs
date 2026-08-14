// #2 PIXEL-GROUNDED image-consistency detector. The wrong-image class (Bodhidharma) can't be caught by liveness
// or filename — the URL returns a real image, just of the wrong artwork. So actually LOOK: show the model the real
// image (no tools → recall only, can't fetch), tell it the work's stored facts, and ask whether the picture is
// consistent with them. Flags mismatches so a wrong image (or, rarely, a fabricated note) surfaces. It reuses the
// "the model actually looked" property that caught Bodhidharma when the audit didn't.
//
// Run:  ANTHROPIC_API_KEY=... node scripts/vision-verify.mjs [swaps|dailies|both|all]
//   swaps   = works with a saved prevImg (swap-touched)          [default]
//   dailies = distinct works in the next 21 days of dailies
//   both    = union of the two   ·   all = every playable work (big/$$)
// Output: data/incoming/image-mismatch.json (verdicts, worst first).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Missing ANTHROPIC_API_KEY."); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const SCOPE = process.argv[2] || "swaps";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const pool = w.ARTEFACTUM_POOL;
const idx = {}; for (const p of pool) { idx[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) idx["wikidata:" + m[0]] = idx["http://www.wikidata.org/entity/" + m[0]] = p; }
const res = id => idx[id] || (String(id).match(/Q\d+/) && idx["wikidata:" + String(id).match(/Q\d+/)[0]]) || null;

let works = [];
if (SCOPE === "swaps" || SCOPE === "both") works.push(...pool.filter(p => p.prevImg && p.prevImg !== p.img));
if (SCOPE === "dailies" || SCOPE === "both") {
  const O = {}; new Function("window", readFileSync("data/daily-order.js", "utf8"))(O); const B = (O.ARTEFACTUM_DAILY || {}).byDate || {};
  const today = new Date().toISOString().slice(0, 10), hz = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  for (const [d, day] of Object.entries(B)) { if (d < today || d > hz) continue; for (const t of ["easy", "medium", "hard", "impossible"]) for (const id of (day[t] || [])) { const p = res(id); if (p) works.push(p); } }
}
if (SCOPE === "all") works = pool.filter(p => p.img && (p.cats || []).length);
if (SCOPE === "flagged") { try { const j = JSON.parse(readFileSync("data/incoming/image-mismatch.json", "utf8")); for (const m of (j.mismatches || [])) { const p = res(m.id); if (p) works.push(p); } } catch {} } // re-check a prior run's flags (e.g. Sonnet-confirm a Haiku screen)
works = [...new Map(works.map(p => [p.id, p])).values()];
console.log(`image-consistency check · model=${MODEL} · scope=${SCOPE} · ${works.length} works (real pixels, no tools)\n`);

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
async function grab(url, t = 0) {
  // 640px is plenty to spot a gross wrong-image (modern photo vs ceramic); keeps image tokens (and cost) ~4x lower
  let u = url; if (/Special:FilePath/i.test(u) && !/[?&]width=/.test(u)) u += (u.includes("?") ? "&" : "?") + "width=640";
  try {
    const r = await fetch(u, { headers: { "User-Agent": BROWSER } });
    if ([403, 429, 500, 502, 503, 504].includes(r.status) && t < 3) { r.body?.cancel?.(); await sleep(3500 * (t + 1)); return grab(url, t + 1); }
    if (!r.ok) return { err: "img " + r.status };
    let media = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media)) media = "image/jpeg";
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 4.8 * 1024 * 1024) return { err: "too big" };
    return { media, data: b.toString("base64") };
  } catch (e) { if (t < 3) { await sleep(2500); return grab(url, t + 1); } return { err: "fetch " + String(e.message || "").slice(0, 20) }; }
}
async function ask(img, facts) {
  const prompt = `You are shown an image and the catalog facts a museum database holds for it. Judge ONLY whether the IMAGE is plausibly consistent with those facts — you are checking for a wrong/mismatched image, not grading a guess.

Catalog facts:
- title: ${facts.title}
- artist: ${facts.artist || "anonymous"}
- date: ${facts.y}
- place/culture: ${facts.place} / ${facts.style || "?"}
- medium: ${facts.medium || "?"}

Consider era, region, medium, and subject. A modern photograph under a "19th-century ceramic" record, or a landscape under a "portrait" record, is a MISMATCH.

Respond with ONLY this JSON:
{"consistent": true|false, "confidence": <0-1>, "seen": "<one line: what the image actually shows>", "why": "<one line>"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: img.media, data: img.data } }, { type: "text", text: prompt }] }] })
  });
  if (!r.ok) throw new Error("api " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json(); const txt = (j.content || []).map(c => c.text || "").join("");
  const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error("no json"); return JSON.parse(m[0]);
}

const out = [];
for (let i = 0; i < works.length; i++) {
  const p = works[i];
  try {
    const img = await grab(p.img);
    if (img.err) { out.push({ id: p.id, title: p.title, error: img.err }); console.log(`${String(i + 1).padStart(3)}/${works.length} ${p.title.slice(0, 30).padEnd(30)} IMG ${img.err}`); await sleep(400); continue; }
    const v = await ask(img, { title: p.title, artist: p.artist, y: p.y, place: p.place, style: p.style, medium: p.medSimple || p.medium });
    out.push({ id: p.id, title: p.title, hasPrev: !!p.prevImg, consistent: v.consistent, confidence: v.confidence, seen: v.seen, why: v.why, img: p.img, prevImg: p.prevImg || null });
    if (!v.consistent) console.log(`${String(i + 1).padStart(3)}/${works.length} ⚠ MISMATCH  ${p.title.slice(0, 28).padEnd(28)} — seen: ${String(v.seen).slice(0, 44)}`);
    else if ((i + 1) % 25 === 0) console.log(`${String(i + 1).padStart(3)}/${works.length} …ok so far`);
  } catch (e) { out.push({ id: p.id, title: p.title, error: String(e.message) }); console.log(`${String(i + 1).padStart(3)}/${works.length} ${p.title.slice(0, 30).padEnd(30)} SKIP (${e.message})`); }
  await sleep(1100);
}

try { mkdirSync("data/incoming", { recursive: true }); } catch {}
const mism = out.filter(x => x.consistent === false).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
const outPath = SCOPE === "flagged" ? "data/incoming/image-mismatch-flagged.json" : "data/incoming/image-mismatch.json";
writeFileSync(outPath, JSON.stringify({ model: MODEL, scope: SCOPE, checked: out.length, mismatches: mism, all: out }, null, 1));
console.log(`\nchecked ${out.filter(x => x.consistent != null).length} · ${mism.length} flagged as image-metadata MISMATCH → ${outPath}`);
console.log(mism.length ? "review each: restore prevImg, re-resolve via source API, or drop the work." : "no mismatches found in this scope.");

