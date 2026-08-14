// Vision-guessability PoC. Shows a BLINDED model only the pixels of each artwork (no title/artist/date/source,
// neutral in-memory bytes) and asks it to INFER the five scorecard fields as a knowledgeable non-expert would,
// from visible evidence alone — then we compare that to the humans' study data (scripts/study-aggregate.mjs).
//
// AIRTIGHT "no web": this makes a RAW model completion — image + text, and NO `tools` field in the request.
// A completion with no tools has no channel to search or fetch anything; the model can only emit text. The only
// network here is US fetching the image and calling the API; the MODEL gets bytes, never a browser. Read the
// request body below and confirm there is no tool wiring. This is why we do NOT use an agent (Codex / a Claude
// subagent) — an agent has a shell it can escape with; a bare completion has none.
//
// Run:  ANTHROPIC_API_KEY=sk-ant-... node scripts/vision-guess.mjs
//   MODEL=claude-haiku-4-5-20251001 node scripts/vision-guess.mjs   # the weaker-model arm of the A/B
// Adaptive: per work it climbs a transform ladder (full → flip → +rotate → +crop) and stops at the LEAST
// composition-destroying rung that defeats recognition, then reads guessability there. Output:
// data/incoming/vision-guessability-<model>-adaptive.json.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Missing ANTHROPIC_API_KEY. Get one at console.anthropic.com, then:\n  ANTHROPIC_API_KEY=sk-ant-... node scripts/vision-guess.mjs"); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
// ADAPTIVE ESCALATION: apply the LEAST composition-destroying transform that still defeats recognition, per work.
// Rungs are ordered by how much guessability signal they cost. flip + rotate leave the whole composition intact
// (they only scramble the "I've seen this exact image" recall); crop is the only lever that sacrifices composition,
// so it sits last and is reached only for works the model stubbornly recognizes. The rung where recognition finally
// breaks is itself a signal (how hard the work is to un-recognize ≈ fame); the read AT that rung is guessability.
const LADDER = [
  { label: "full" },                                                 // 0: composition intact — baseline
  { label: "flip", flip: true },                                     // 1: mirror — composition intact
  { label: "flip+rot", flip: true, rotate: 90 },                     // 2: + rotate — composition intact, orientation scrambled
  { label: "flip+rot+crop60", flip: true, rotate: 90, crop: 0.6 },   // 3: loose detail crop — last resort
  { label: "flip+rot+crop45", flip: true, rotate: 90, crop: 0.45 },  // 4: tight detail crop
];
const MAXR = LADDER.length - 1;
const noteFor = xf => (xf.flip || xf.rotate || xf.crop)
  ? `Note: this image has been ${[xf.flip && "mirrored left-to-right", xf.rotate && "rotated", xf.crop && "cropped to a partial detail"].filter(Boolean).join(", ")}. Infer from the visible brushwork, materials, colour, and forms; don't worry about orientation or missing composition.`
  : "";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the study works = the exact dailies friends are playing, so vision vs human is apples-to-apples
const STUDY = [["2026-07-11", "easy"], ["2026-07-11", "medium"], ["2026-07-25", "easy"], ["2026-07-25", "hard"], ["2026-08-05", "easy"], ["2026-08-05", "medium"]];
const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const idx = {}; for (const p of w.ARTEFACTUM_POOL) { idx[p.id] = p; const m = String(p.id).match(/Q\d+/); if (m) { idx["wikidata:" + m[0]] = p; idx["http://www.wikidata.org/entity/" + m[0]] = p; } }
const res = id => idx[id] || (String(id).match(/Q\d+/) && idx["wikidata:" + String(id).match(/Q\d+/)[0]]) || null;
const L = {}; new Function("window", readFileSync("data/daily-history.js", "utf8"))(L);
const led = (L.ARTEFACTUM_DAILY_HISTORY || {}).byDate || {};

// collect the distinct works across the study dailies
const ids = new Set();
for (const [d, t] of STUDY) for (const id of ((led[d] || {})[t] || [])) ids.add(id);
const works = [...ids].map(res).filter(Boolean);
console.log(`vision PoC · model=${MODEL} · ${works.length} study works (blinded, no tools) · adaptive escalation [${LADDER.map(x => x.label).join(" → ")}]\n`);

const PROMPT = `You are shown ONLY an image of an artwork — no title, caption, artist, date, or any metadata. Role-play a museum-goer with general art-history literacy but NO memorized knowledge of THIS specific work. Reason only from what is visually present: style, technique, materials, palette, subject, iconography, condition, framing. Do not try to recall this work's catalog facts; infer as a person standing in front of it would.

For each field give your best inference, a confidence 0.0-1.0, and the concrete visual cues you used. Also honestly report whether you nonetheless recognize the specific work.

Respond with ONLY this JSON, no prose:
{"recognized": true|false,
 "when":   {"year": <integer, negative = BCE>, "confidence": <0-1>, "cues": "<short>"},
 "where":  {"country": "<modern country or region>", "confidence": <0-1>, "cues": "<short>"},
 "medium": {"guess": "<e.g. Oil paint, Marble, Woodblock print, Bronze>", "confidence": <0-1>, "cues": "<short>"},
 "style":  {"guess": "<movement or culture, e.g. Impressionism, Edo ukiyo-e, Chola bronze>", "confidence": <0-1>, "cues": "<short>"},
 "artist": {"guess": "<name, or 'unknown'>", "confidence": <0-1>, "cues": "<short>"}}`;

// fetch the image ONCE (script fetches; the MODEL never does), to a temp file we re-render per rung.
async function download(url, i) {
  let u = url;
  if (/Special:FilePath/i.test(u) && !/[?&]width=/.test(u)) u += (u.includes("?") ? "&" : "?") + "width=1200";
  const r = await fetch(u, { headers: { "User-Agent": "GessoVisionPoC/1.0 (kathryn.swint@gmail.com)" } });
  if (!r.ok) throw new Error("img " + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  const path = `${tmpdir()}/gesso-vis-${i}-orig`;
  writeFileSync(path, b);
  return path;
}

// render one rung's image via `sips` (always emit jpeg). flip/rotate preserve all content; crop takes an off-centre
// per-work detail patch. Returns base64 for the API.
function render(orig, i, xf) {
  const f = `${tmpdir()}/gesso-vis-${i}-r.jpg`;
  execFileSync("sips", ["-s", "format", "jpeg", orig, "--out", f], { stdio: "ignore" });
  if (xf.flip) execFileSync("sips", ["-f", "horizontal", f, "--out", f], { stdio: "ignore" });
  if (xf.rotate) execFileSync("sips", ["-r", String(xf.rotate), f, "--out", f], { stdio: "ignore" });
  if (xf.crop) {
    const g = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f]).toString();
    const W = +(g.match(/pixelWidth:\s*(\d+)/)?.[1] || 0), H = +(g.match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
    if (W && H) { const cw = Math.round(W * xf.crop), ch = Math.round(H * xf.crop), q = i % 4;
      // per-work quadrant so patches sample different regions, not always the recognizable centre
      const ox = Math.round((q === 1 || q === 3 ? 0.85 : 0.15) * (W - cw)), oy = Math.round((q >= 2 ? 0.85 : 0.15) * (H - ch));
      execFileSync("sips", ["-c", String(ch), String(cw), "--cropOffset", String(oy), String(ox), f, "--out", f], { stdio: "ignore" });
    }
  }
  const b = readFileSync(f); unlinkSync(f);
  if (b.length > 4.8 * 1024 * 1024) throw new Error("img too large " + b.length);
  return { media: "image/jpeg", data: b.toString("base64") };
}

async function ask(img, note) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700,
      // NOTE: no `tools` key — the model has NO way to browse, search, or fetch. Image bytes + text only.
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
        { type: "text", text: PROMPT + (note ? `\n\n${note}` : "") }] }]
    })
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
    const orig = await download(p.img, i);
    let picked = null; const trace = [];
    // climb the ladder until recognition breaks (or we exhaust it), then keep THAT rung's read
    for (let rung = 0; rung < LADDER.length; rung++) {
      const xf = LADDER[rung];
      const v = await ask(render(orig, i, xf), noteFor(xf));
      trace.push({ rung, label: xf.label, recognized: !!v.recognized });
      await sleep(300);
      if (!v.recognized || rung === MAXR) { picked = { rung, label: xf.label, v }; break; }
    }
    unlinkSync(orig);
    const v = picked.v, dy = (v.when && v.when.year != null && p.y != null) ? Math.abs(v.when.year - p.y) : "?";
    out.push({ id: p.id, title: p.title, stopRung: picked.rung, stopLabel: picked.label, recognizedTrace: trace,
      truth: { y: p.y, place: p.place, region: p.region, medium: p.medSimple || p.medium, style: p.style, artist: p.artist },
      vision: v });
    console.log(`${String(i + 1).padStart(2)}/${works.length} ${p.title.slice(0, 24).padEnd(24)} broke@${picked.label.padEnd(15)} ${v.recognized ? "[STILL rec] " : "           "}Δyr=${dy}  where→${(v.where?.country || "?").slice(0, 14)}(${p.place.slice(0, 12)})  style→${(v.style?.guess || "?").slice(0, 22)}(${p.style || "—"})`);
  } catch (e) {
    console.log(`${String(i + 1).padStart(2)}/${works.length} ${p.title.slice(0, 24).padEnd(24)} SKIP (${e.message})`);
    out.push({ id: p.id, title: p.title, error: String(e.message) });
  }
}

try { mkdirSync("data/incoming", { recursive: true }); } catch {}
const slug = MODEL.replace(/[^a-z0-9]+/gi, "-");
const outPath = `data/incoming/vision-guessability-${slug}-adaptive.json`;
writeFileSync(outPath, JSON.stringify({ model: MODEL, ladder: LADDER.map(x => x.label), works: out }, null, 1));
const ok = out.filter(x => x.vision);
const stubborn = ok.filter(x => x.vision.recognized).length;    // still recognized even at the tightest crop
const rungHist = LADDER.map((x, r) => `${x.label}:${ok.filter(w => w.stopRung === r).length}`).join("  ");
console.log(`\nwrote ${outPath} · ${ok.length}/${works.length} scored`);
console.log(`recognition broke at rung →  ${rungHist}   (still-recognized-at-max: ${stubborn})`);
console.log("reads are taken at the LEAST-destructive rung that defeated recognition. next: compare vs data/incoming/study-human-difficulty.json.");

