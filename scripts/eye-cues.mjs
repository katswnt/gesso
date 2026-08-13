// "How the eye sees it" pass. Generates {why, cues:[...]} for movements/cultures that appear in the
// pool but have no entry in data/cues.js (so the movement page shows "No eye cues available yet.").
// Writes data/cues-ext.js, which MERGES into window.ARTEFACTUM_CUES at load without touching the
// hand-written cues.js and never clobbers an existing entry. Resumable: re-running only fills gaps.
//
// Generation is via the Anthropic API (NOT this Claude session). Run with plain node:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/eye-cues.mjs
// Env: MIN_WORKS=3 (skip styles with fewer pool works), LIMIT=n (cap targets), BATCH=12,
//      MODEL=claude-sonnet-4-6, ONLY="A,B" (comma list of exact style names to (re)generate).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const MIN_WORKS = +(process.env.MIN_WORKS || 3);
const BATCH = +(process.env.BATCH || 12);
const LIMIT = process.env.LIMIT ? +process.env.LIMIT : Infinity;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(s => s.trim())) : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- load pool, MOVEMENTS, existing cues (cues.js + any prior cues-ext.js) ---
const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const POOL = w.ARTEFACTUM_POOL;
const html = readFileSync("index.html", "utf8");
function objBlock(tok) { const i = html.indexOf(tok); let d = 0, s = html.indexOf("{", i); for (let j = s; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}") { d--; if (d === 0) return html.slice(s, j + 1); } } }
const MOVEMENTS = eval("(" + objBlock("const MOVEMENTS=") + ")");

function loadCues(path) { if (!existsSync(path)) return null; const g = {}; new Function("window", readFileSync(path, "utf8"))(g); return g.ARTEFACTUM_CUES; }
const baseCues = loadCues("data/cues.js") || { style: {}, culture: {}, region: {}, medium: {} };
// prior generated entries (resume): re-exec cues-ext.js against a stub CUES to recover its G
let prior = { style: {}, culture: {} };
if (existsSync("data/cues-ext.js")) { const stub = { ARTEFACTUM_CUES: { style: {}, culture: {}, region: {}, medium: {} } }; try { new Function("window", readFileSync("data/cues-ext.js", "utf8"))(stub); prior = { style: stub.ARTEFACTUM_CUES.style || {}, culture: stub.ARTEFACTUM_CUES.culture || {} }; } catch {} }
const have = k => !!(baseCues.style && baseCues.style[k]) || !!(baseCues.culture && baseCues.culture[k]) || !!prior.style[k] || !!prior.culture[k];

// --- target set: pool styles with >= MIN_WORKS works, in MOVEMENTS, lacking cues ---
const byStyle = {};
for (const p of POOL) { if (!p.style) continue; (byStyle[p.style] = byStyle[p.style] || []).push(p); }
function kindOf(style) { const ks = byStyle[style].map(p => p.styleKind); return ks.filter(k => k === "culture").length > ks.length / 2 ? "culture" : "style"; }
let targets = Object.keys(byStyle)
  .filter(s => MOVEMENTS[s])                 // must be a known movement (has dates/region)
  .filter(s => ONLY ? ONLY.has(s) : (!have(s) && byStyle[s].length >= MIN_WORKS))
  .sort((a, b) => byStyle[b].length - byStyle[a].length);
if (LIMIT !== Infinity) targets = targets.slice(0, LIMIT);
console.log(`eye-cues · model=${MODEL} · ${targets.length} target movements (MIN_WORKS=${MIN_WORKS}, batch=${BATCH})\n`);
if (!targets.length) { console.log("nothing to generate."); process.exit(0); }

const SYSTEM = `You write the "how the eye sees it" teaching notes for an art-history guessing game. For each movement/culture you are given, produce a JSON object with:
- "why": ONE sentence that front-loads the VISUAL signature and names the movement with its rough dates/place. Match this style exactly:
    "Flat color, bold outline and floating-world subjects mark ukiyo-e — Japanese woodblock prints, 1600s–1800s."
    "Fragmented, faceted form seen from many angles at once marks Cubism, c. 1907–1920s."
- "cues": an array of EXACTLY 3 short phrases, each a concrete thing a viewer can SEE (materials, palette, brushwork, forms, motifs, composition), not historical facts. Match this style:
    ["Flat areas of color with no Western shading.","Strong, confident black contour lines.","Actors, courtesans, landscapes — the 'floating world'."]
Rules: be accurate to the actual visual character of the named period; no hedging ("often","sometimes"); no artist names; keep each cue under ~9 words; end cues with a period. Return ONLY the requested JSON, nothing else.`;

async function callAPI(items) {
  const list = items.map(s => `- "${s}" (${MOVEMENTS[s].dates}, ${MOVEMENTS[s].region})`).join("\n");
  const user = `Write eye-cues for these ${items.length} movements/cultures. Return a JSON array where each element is {"name":"<exact name>","why":"...","cues":["...","...","..."]}, in the same order:\n${list}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: "user", content: user }] }),
    });
    if (r.status === 429 || r.status === 529 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error("API " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    const txt = (j.content || []).map(c => c.text || "").join("");
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) throw new Error("no JSON array in response");
    return JSON.parse(m[0]);
  }
  throw new Error("API exhausted retries");
}

const gen = { style: { ...prior.style }, culture: { ...prior.culture } };
let ok = 0, bad = 0;
for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH);
  try {
    const arr = await callAPI(batch);
    const byName = {}; for (const e of arr) if (e && e.name) byName[e.name] = e;
    for (const s of batch) {
      const e = byName[s];
      if (!e || !e.why || !Array.isArray(e.cues) || e.cues.length < 3) { console.log("  MISS", s); bad++; continue; }
      const bucket = kindOf(s);
      gen[bucket][s] = { why: String(e.why).trim(), cues: e.cues.slice(0, 3).map(c => String(c).trim()) };
      ok++;
    }
    console.log(`[${Math.min(i + BATCH, targets.length)}/${targets.length}] batch ok (${ok} total)`);
  } catch (err) {
    console.log(`[${i}] batch ERROR ${err.message}`);
    bad += batch.length;
  }
  await sleep(800);
}

const header = "// Generated eye-cues (\"how the eye sees it\") for movements cues.js doesn't cover.\n" +
  "// By scripts/eye-cues.mjs via the Anthropic API. Merges into ARTEFACTUM_CUES at load; never\n" +
  "// clobbers a hand-written cues.js entry. Load AFTER cues.js, before the app script.\n";
const body = "(function(){var C=window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{style:{},culture:{},region:{},medium:{}};\n" +
  "var G=" + JSON.stringify(gen) + ";\n" +
  "for(var k in G){C[k]=C[k]||{};for(var m in G[k]){if(!C[k][m])C[k][m]=G[k][m];}}})();\n";
writeFileSync("data/cues-ext.js", header + body);
console.log(`\nwrote data/cues-ext.js · ${Object.keys(gen.style).length} style + ${Object.keys(gen.culture).length} culture entries (${ok} new, ${bad} missed)`);
