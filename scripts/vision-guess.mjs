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
// Default model is the blinded capable arm (claude-sonnet-4-6). Output: data/incoming/vision-guessability.json.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Missing ANTHROPIC_API_KEY. Get one at console.anthropic.com, then:\n  ANTHROPIC_API_KEY=sk-ant-... node scripts/vision-guess.mjs"); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
// anti-recognition transforms (macOS `sips`): crop to an off-centre DETAIL patch and/or mirror left-right. Style,
// medium, palette, brushwork all survive these; the recognizable overall composition/orientation does not. This is
// how we force INFERENCE over recall on famous works — and by A/B-ing the transforms we can MEASURE the effect.
const CROP = parseFloat(process.env.CROP || "0") || 0;   // 0 = full image; e.g. CROP=0.5 → a half-size detail patch
const FLIP = process.env.FLIP === "1";                    // mirror left-to-right
const XF = [CROP ? `crop${Math.round(CROP * 100)}` : "", FLIP ? "flip" : ""].filter(Boolean).join("-"); // label + filename suffix
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
console.log(`vision PoC · model=${MODEL} · ${works.length} study works (blinded, no tools)${XF ? " · transform=" + XF : ""}\n`);

const PROMPT = `You are shown ONLY an image of an artwork — no title, caption, artist, date, or any metadata. Role-play a museum-goer with general art-history literacy but NO memorized knowledge of THIS specific work. Reason only from what is visually present: style, technique, materials, palette, subject, iconography, condition, framing. Do not try to recall this work's catalog facts; infer as a person standing in front of it would.

For each field give your best inference, a confidence 0.0-1.0, and the concrete visual cues you used. Also honestly report whether you nonetheless recognize the specific work.

Respond with ONLY this JSON, no prose:
{"recognized": true|false,
 "when":   {"year": <integer, negative = BCE>, "confidence": <0-1>, "cues": "<short>"},
 "where":  {"country": "<modern country or region>", "confidence": <0-1>, "cues": "<short>"},
 "medium": {"guess": "<e.g. Oil paint, Marble, Woodblock print, Bronze>", "confidence": <0-1>, "cues": "<short>"},
 "style":  {"guess": "<movement or culture, e.g. Impressionism, Edo ukiyo-e, Chola bronze>", "confidence": <0-1>, "cues": "<short>"},
 "artist": {"guess": "<name, or 'unknown'>", "confidence": <0-1>, "cues": "<short>"}}` + ((CROP || FLIP) ? `\n\nNote: you may be seeing only a cropped detail of the work${FLIP ? ", mirrored left-to-right" : ""}. Infer from the visible brushwork, materials, colour, and forms; don't worry about the missing overall composition.` : "");

// fetch the image (script fetches; the MODEL never does). Optionally mirror and/or crop to an off-centre detail
// patch via `sips` before sending, to defeat recognition while preserving every style/medium/era cue.
async function grab(url, i) {
  let u = url;
  if (/Special:FilePath/i.test(u) && !/[?&]width=/.test(u)) u += (u.includes("?") ? "&" : "?") + "width=1200";
  const r = await fetch(u, { headers: { "User-Agent": "GessoVisionPoC/1.0 (kathryn.swint@gmail.com)" } });
  if (!r.ok) throw new Error("img " + r.status);
  let media = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media)) media = "image/jpeg";
  let b = Buffer.from(await r.arrayBuffer());
  if (CROP || FLIP) {
    const tmp = `${tmpdir()}/gesso-vis-${i}.jpg`, cut = `${tmpdir()}/gesso-vis-${i}-x.jpg`;
    writeFileSync(tmp, b);
    if (FLIP) execFileSync("sips", ["-f", "horizontal", tmp, "--out", tmp], { stdio: "ignore" });
    if (CROP) {
      const g = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmp]).toString();
      const W = +(g.match(/pixelWidth:\s*(\d+)/)?.[1] || 0), H = +(g.match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
      if (W && H) { const cw = Math.round(W * CROP), ch = Math.round(H * CROP), q = i % 4;
        // per-work quadrant so patches sample different regions, not always the recognizable centre
        const ox = Math.round((q === 1 || q === 3 ? 0.85 : 0.15) * (W - cw)), oy = Math.round((q >= 2 ? 0.85 : 0.15) * (H - ch));
        execFileSync("sips", ["-c", String(ch), String(cw), "--cropOffset", String(oy), String(ox), tmp, "--out", cut], { stdio: "ignore" });
        b = readFileSync(cut); unlinkSync(cut);
      } else b = readFileSync(tmp);
    } else b = readFileSync(tmp);
    unlinkSync(tmp); media = "image/jpeg";
  }
  if (b.length > 4.8 * 1024 * 1024) throw new Error("img too large " + b.length);
  return { media, data: b.toString("base64") };
}

async function ask(img) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700,
      // NOTE: no `tools` key — the model has NO way to browse, search, or fetch. Image bytes + text only.
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
        { type: "text", text: PROMPT }] }]
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
    const img = await grab(p.img, i);
    const v = await ask(img);
    out.push({ id: p.id, title: p.title,
      truth: { y: p.y, place: p.place, region: p.region, medium: p.medSimple || p.medium, style: p.style, artist: p.artist },
      vision: v });
    const dy = (v.when && v.when.year != null && p.y != null) ? Math.abs(v.when.year - p.y) : "?";
    console.log(`${String(i + 1).padStart(2)}/${works.length} ${p.title.slice(0, 26).padEnd(26)} ${v.recognized ? "[recognized] " : ""}Δyr=${dy}  where→${v.where?.country || "?"} (true ${p.place})  style→${v.style?.guess || "?"} (true ${p.style || "—"})`);
  } catch (e) {
    console.log(`${String(i + 1).padStart(2)}/${works.length} ${p.title.slice(0, 26).padEnd(26)} SKIP (${e.message})`);
    out.push({ id: p.id, title: p.title, error: String(e.message) });
  }
  await sleep(400);
}

try { mkdirSync("data/incoming", { recursive: true }); } catch {}
const slug = MODEL.replace(/[^a-z0-9]+/gi, "-"); // per-model + per-transform file so arms don't clobber each other
const outPath = `data/incoming/vision-guessability-${slug}${XF ? "-" + XF : ""}.json`;
writeFileSync(outPath, JSON.stringify({ model: MODEL, works: out }, null, 1));
const ok = out.filter(x => x.vision).length, rec = out.filter(x => x.vision?.recognized).length;
console.log(`\nwrote ${outPath} · ${ok}/${works.length} scored · ${rec} the model recognized (leakage — flagged, analyzed separately).`);
console.log("next: a compare step joins this with data/incoming/study-human-difficulty.json to test the correlation.");
