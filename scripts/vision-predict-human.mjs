// Vision-guessability, TRACK 2: predict-the-human. The adaptive-blinding run (vision-guess.mjs) showed image
// degradation can't cleanly measure guessability on FAMOUS works — recognition and inference draw on the same
// evidence, so you get recall (=fame) or crop-degraded noise. So for those, stop fighting recognition: USE it.
// Here the model is shown the FULL image, allowed to identify the work, and asked — as an expert simulating a
// typical non-expert museum-goer — to PREDICT how well such a person would score each of the 5 fields. Its
// knowledge of what's famous/typical/guessable becomes the asset. Output is on the SAME 0-100 per-field scale as
// the friends' study data (scripts/study-aggregate.mjs), so the three signals line up: blinded-inference (clean on
// obscure works), this human-prediction (for famous ones), and the friends' actual scores.
//
// AIRTIGHT "no web": a RAW completion, image + text, NO `tools` field — the model can recall from training but has
// no channel to fetch/search. Not an agent; nothing to escape.
//
// Run:  ANTHROPIC_API_KEY=sk-ant-... node scripts/vision-predict-human.mjs
//   MODEL=claude-haiku-4-5-20251001 node scripts/vision-predict-human.mjs
// Output: data/incoming/vision-predict-human-<model>.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Missing ANTHROPIC_API_KEY. Get one at console.anthropic.com, then:\n  ANTHROPIC_API_KEY=sk-ant-... node scripts/vision-predict-human.mjs"); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the study works = the exact dailies friends are playing, so all three signals land on identical works
const STUDY = [["2026-07-11", "easy"], ["2026-07-11", "medium"], ["2026-07-25", "easy"], ["2026-07-25", "hard"], ["2026-08-05", "easy"], ["2026-08-05", "medium"]];
const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const idx = {}; for (const p of w.ARTEFACTUM_POOL) { idx[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) { idx["wikidata:" + m[0]] = p; idx["http://www.wikidata.org/entity/" + m[0]] = p; } }
const res = id => idx[id] || (String(id).match(/Q\d+/) && idx["wikidata:" + String(id).match(/Q\d+/)[0]]) || null;
const L = {}; new Function("window", readFileSync("data/daily-history.js", "utf8"))(L);
const led = (L.ARTEFACTUM_DAILY_HISTORY || {}).byDate || {};
const ids = new Set();
for (const [d, t] of STUDY) for (const id of ((led[d] || {})[t] || [])) ids.add(id);
const works = [...ids].map(res).filter(Boolean);
console.log(`predict-the-human · model=${MODEL} · ${works.length} study works (full image, recognition allowed, no tools)\n`);

const FIELDS = ["when", "where", "medium", "style", "artist"];
const PROMPT = `You are an expert art historian running a difficulty model for an art-guessing game. A player is shown ONLY this image (no title/artist/date) and guesses five things: the DATE it was made, the PLACE/region it was made, the MEDIUM, the art MOVEMENT or culture, and the ARTIST.

Model the player as a TYPICAL art-curious adult / lapsed museum-goer: general visual literacy, some exposure to famous art, but NOT an expert and has NOT memorized this specific work. Use your own knowledge of the piece and of what such people typically know to predict how they'd do.

For each field, give the EXPECTED SCORE as a percentage 0-100 of the maximum, WITH partial credit the way the game scores it:
- when: 100 if within ~a decade, scaling down; ~50 for the right century; low if centuries off.
- where: 100 for the right country; partial for the right continent/region; low if wrong continent.
- medium: 100 for the right material (oil/marble/bronze/woodblock/ink…); partial for the right family.
- style: 100 for the right movement/culture; partial for an adjacent one; low if unrelated.
- artist: 100 only if they'd name the correct artist (rare unless iconic); usually low; 0 for anonymous works.
Base each number on what a non-expert would actually infer from the VISIBLE cues, tempered by how famous/recognizable the work is.

Respond with ONLY this JSON, no prose:
{"work": "<your identification of the piece, or 'unfamiliar'>",
 "when":   {"exply": <0-100>, "why": "<short>"},
 "where":  {"exply": <0-100>, "why": "<short>"},
 "medium": {"exply": <0-100>, "why": "<short>"},
 "style":  {"exply": <0-100>, "why": "<short>"},
 "artist": {"exply": <0-100>, "why": "<short>"}}`;

async function grab(url) {
  let u = url;
  if (/Special:FilePath/i.test(u) && !/[?&]width=/.test(u)) u += (u.includes("?") ? "&" : "?") + "width=1200";
  const r = await fetch(u, { headers: { "User-Agent": "GessoPredictHuman/1.0 (kathryn.swint@gmail.com)" } });
  if (!r.ok) throw new Error("img " + r.status);
  let media = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media)) media = "image/jpeg";
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 4.8 * 1024 * 1024) throw new Error("img too large " + b.length);
  return { media, data: b.toString("base64") };
}

async function ask(img) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    // no `tools` key — recall-from-training only, no fetch/search
    body: JSON.stringify({ model: MODEL, max_tokens: 700,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
        { type: "text", text: PROMPT }] }] })
  });
  if (!r.ok) throw new Error("api " + r.status + " " + (await r.text()).slice(0, 160));
  const j = await r.json();
  const txt = (j.content || []).map(c => c.text || "").join("");
  const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error("no json in reply");
  return JSON.parse(m[0]);
}

const out = [];
for (let i = 0; i < works.length; i++) {
  const p = works[i];
  try {
    const v = await ask(await grab(p.img));
    out.push({ id: p.id, title: p.title, identified: v.work,
      truth: { y: p.y, place: p.place, region: p.region, medium: p.medSimple || p.medium, style: p.style, artist: p.artist },
      predict: Object.fromEntries(FIELDS.map(f => [f, v[f]])) });
    const line = FIELDS.map(f => `${f[0]}${v[f]?.exply ?? "?"}`).join(" ");
    console.log(`${String(i + 1).padStart(2)}/${works.length} ${p.title.slice(0, 26).padEnd(26)} [${line}]  id:${String(v.work || "?").slice(0, 28)}`);
  } catch (e) {
    console.log(`${String(i + 1).padStart(2)}/${works.length} ${p.title.slice(0, 26).padEnd(26)} SKIP (${e.message})`);
    out.push({ id: p.id, title: p.title, error: String(e.message) });
  }
  await sleep(350);
}

try { mkdirSync("data/incoming", { recursive: true }); } catch {}
const slug = MODEL.replace(/[^a-z0-9]+/gi, "-");
const outPath = `data/incoming/vision-predict-human-${slug}.json`;
writeFileSync(outPath, JSON.stringify({ model: MODEL, works: out }, null, 1));
const ok = out.filter(x => x.predict);
const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
console.log(`\nwrote ${outPath} · ${ok.length}/${works.length} predicted`);
console.log("predicted non-expert score per field (mean, 0-100):");
for (const f of FIELDS) console.log(`  ${f.padEnd(7)} ${mean(ok.map(x => x.predict[f]?.exply).filter(n => typeof n === "number"))}%`);
console.log("compare vs friends' actual (study-aggregate) + blinded reads (vision-guess) on the same works.");

