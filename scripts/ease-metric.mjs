// Ease metric = how well a real player is expected to do, combining RECOGNITION and pure-visual GUESSABILITY.
//
// Kat's insight (and the Creation-of-Adam / Mona-Lisa problem): neither signal alone predicts human performance.
// The blinded probe's pure-visual g under-credits famous works (a player who SEES the real Mona Lisa recognizes
// it and knows Leonardo/~1500), while raw recognition over-credits the date (knowing the Sistine ceiling ≠
// knowing "1512"). So per facet:
//
//     Ease_f = R · REC_f  +  (1 − R) · g_f
//
//   R    = probability a typical player RECOGNIZES the work. Best human proxy = fame (all-language pageviews),
//          shaped by a logistic so only the canon is "widely recognized". If a work has enough HUMAN plays
//          (study-aggregate's recognizedRate), that measured value OVERRIDES the fame estimate — the calibration
//          path that kicks in once friends play.
//   REC_f= what a recognizer scores on facet f: ~full for place/medium/style, DISCOUNTED for date (you know the
//          work, not the exact year). Placeholder until human data refines it.
//   g_f  = pure-visual guessability from data/guessability/scores.json (the defeated-rung blinded grade).
//
// ALL of PARAMS is a calibratable placeholder — the STRUCTURE is the point; friend-play data tunes the numbers.
// Writes data/guessability/ease.json + backtests A(day)=mean Ease over the frozen easy dailies.
//   node scripts/ease-metric.mjs [--tier=easy]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TIER = (process.argv.find(a => a.startsWith("--tier=")) || "--tier=easy").split("=")[1];

// ─── PARAMS (placeholders — recalibrate from human study data) ──────────────────────────────────────────────
const PARAMS = {
  REC: { when: 0.70, where: 1.0, medium: 1.0, style: 1.0 }, // a recognizer's per-facet score; date stays fuzzy
  REC_artist: 0.90,                                         // a recognizer usually names a famous work's artist
  // BLIND (unrecognized) human accuracy per facet, anchored to Kat's measured COLD play (0-prior-exposure transfer):
  // the model's own g is a superhuman style-reader (it dates a Sumerian relief perfectly), so we don't trust it as a
  // human estimate. We take the cold-human floor + a small bonus for how visually legible the model finds the work.
  // (Interim calibration from one player's Euro-heavy history; the retuned-probe re-run replaces g with per-work layPct.)
  humanBlind: { when: 0.24, where: 0.65, medium: 0.95, style: 0.80 },
  modelTrust: { when: 0.15, where: 0.25, medium: 0.50, style: 0.25 }, // how much the model's per-work g adds atop the floor
  R_fame: { p50: 0.90, steep: 0.05 },                       // fame-percentile at which familiarity=0.5 (conservative)
  R_vis: { floor: 0.40, span: 0.60 },                       // visual-recognizability from the probe's stopRung: floor + span*(stopRung/4)
  maxRung: 4,                                                // ladder depth (full→…→crop45); higher stopRung = more robustly recognized
  humanMinPlays: 3,                                          // works with ≥ this many human plays use MEASURED recognition for R
};
const CORE = ["when", "where", "medium", "style"];
const logistic = (x, x0, s) => 1 / (1 + Math.exp(-(x - x0) / s));

// ─── data ───────────────────────────────────────────────────────────────────────────────────────────────────
const scores = JSON.parse(readFileSync("data/guessability/scores.json", "utf8")).works;
const pool = (() => { const raw = readFileSync("data/pool.js", "utf8"); return JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)); })();
const byId = Object.fromEntries(pool.map(p => [p.id, p]));
const fame = JSON.parse(readFileSync("data/fame.js", "utf8").replace("window.ARTEFACTUM_FAME=", "").replace(/;\s*$/, ""));
const fameOf = id => fame[id] != null ? fame[id] : (byId[id]?.fame || 0);
// human recognition (from study-aggregate), keyed by resolved id — used to OVERRIDE R where we have real plays
const human = {};
if (existsSync("data/incoming/study-human-difficulty.json")) {
  try { for (const w of JSON.parse(readFileSync("data/incoming/study-human-difficulty.json", "utf8")).works || []) human[w.id] = w; } catch {}
}

// fame → percentile in [0,1] over the playable pool (so R is a recognizability rank, not a raw magnitude)
const fameSorted = pool.filter(p => p.play !== false).map(p => fameOf(p.id)).sort((a, b) => a - b);
const famePct = f => { let lo = 0, hi = fameSorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (fameSorted[m] < f) lo = m + 1; else hi = m; } return fameSorted.length ? lo / fameSorted.length : 0; };

// R = probability a typical player recognizes the work. Recognition needs BOTH cultural familiarity (fame,
// all-language pageviews) AND visual distinctiveness (the probe's stopRung — how much you can destroy the image
// before recognition breaks). A work huge in notoriety but visually generic, or vice versa, is not reliably
// recognized — so multiply the two. Measured human recognition (once we have enough plays) overrides the estimate.
function recognitionR(id, stopRung) {
  const h = human[id];
  if (h && h.plays >= PARAMS.humanMinPlays && h.recognizedRate != null) return { R: h.recognizedRate / 100, src: "human" };
  const fam = logistic(famePct(fameOf(id)), PARAMS.R_fame.p50, PARAMS.R_fame.steep);
  const vis = PARAMS.R_vis.floor + PARAMS.R_vis.span * (Math.max(0, Math.min(PARAMS.maxRung, stopRung ?? PARAMS.maxRung)) / PARAMS.maxRung);
  return { R: fam * vis, src: "fame×vis" };
}

// ─── compute ease per work ──────────────────────────────────────────────────────────────────────────────────
const out = {};
for (const [id, s] of Object.entries(scores)) {
  if (!s.g) continue;
  const { R, src } = recognitionR(id, s.stopRung);
  const facets = {}; const eF = {};
  for (const f of CORE) { if (s.g[f] == null) continue; const rec = PARAMS.REC[f] ?? 1;
    // blind human guessability: cold floor + small legibility bonus, NOT the model's superhuman g
    const hb = PARAMS.humanBlind[f] ?? 0.5, tr = PARAMS.modelTrust[f] ?? 0.3;
    const blindG = Math.max(0, Math.min(1, hb + (s.g[f] - hb) * tr));
    eF[f] = +(R * rec + (1 - R) * blindG).toFixed(3); facets[f] = s.g[f]; }
  const vals = Object.values(eF); if (!vals.length) continue;
  // ARTIST FEEL-GOOD (Kat): recognition-conditioned artist payoff — the "I know this, it's Leonardo!" hit. NOT in
  // the difficulty gate (ease), so a diverse work is never penalized for an unknowable artist; a separate lever
  // composition uses to make sure each easy day has a few artist-gettable works. ~0.9·R on famous, ~0 on obscure.
  const feelGood = (s.g.artist != null) ? +(R * PARAMS.REC_artist + (1 - R) * s.g.artist).toFixed(3) : null;
  out[id] = { title: s.title, R: +R.toFixed(3), Rsrc: src, gG: s.G, ease: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3), feelGood, easeFacets: eF };
}
writeFileSync("data/guessability/ease.json", JSON.stringify({ tier: TIER, params: PARAMS, note: "ease = mean over 4 core facets of R*REC_f+(1-R)*g_f (artist NOT in the difficulty gate). feelGood = recognition-conditioned artist payoff, a composition lever. R from human recognizedRate where available (>=3 plays) else fame×vis estimate. Placeholders — recalibrate from friend play.", works: out }, null, 1));
console.log(`computed ease for ${Object.keys(out).length} works -> data/guessability/ease.json (R src: human=${Object.values(out).filter(o => o.Rsrc === "human").length}, estimated=${Object.values(out).filter(o => o.Rsrc !== "human").length})`);

// ─── distributions + backtest ───────────────────────────────────────────────────────────────────────────────
const pctl = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const dist = (arr, label) => { if (!arr.length) return console.log("  " + label + ": (none)"); const a = [...arr].sort((x, y) => x - y); console.log(`  ${label} (n=${a.length}): min ${a[0].toFixed(2)} · p10 ${pctl(a, 10).toFixed(2)} · p25 ${pctl(a, 25).toFixed(2)} · median ${pctl(a, 50).toFixed(2)} · p75 ${pctl(a, 75).toFixed(2)} · max ${a[a.length - 1].toFixed(2)}`); };

console.log("\n=== per-work: pure-visual G vs blended Ease vs artist feel-good ===");
dist(Object.values(out).map(o => o.gG).filter(v => v != null), "G        (pure visual)");
dist(Object.values(out).map(o => o.ease), "Ease     (difficulty, 4 core facets)");
dist(Object.values(out).map(o => o.feelGood).filter(v => v != null), "feelGood (artist payoff)");

// how much does recognition lift the famous works? show the biggest movers
const movers = Object.entries(out).map(([id, o]) => ({ id, title: o.title, gG: o.gG, ease: o.ease, R: o.R, lift: +(o.ease - (o.gG ?? o.ease)).toFixed(2) })).filter(m => m.gG != null).sort((a, b) => b.lift - a.lift);
console.log("\nbiggest recognition lifts (Ease − G):");
for (const m of movers.slice(0, 6)) console.log(`  +${m.lift.toFixed(2)}  R=${m.R.toFixed(2)}  G ${m.gG.toFixed(2)} -> Ease ${m.ease.toFixed(2)}  ${m.title.slice(0, 34)}`);

// per-puzzle backtest over the frozen easy dailies
const g = {}; new Function("window", readFileSync("data/daily-order.js", "utf8"))(g);
const bd = (g.ARTEFACTUM_DAILY || {}).byDate || {};
const puzzles = [];
for (const [date, day] of Object.entries(bd)) { const ids = day[TIER] || []; if (!ids.length) continue;
  const es = ids.map(id => out[id]?.ease).filter(v => v != null); if (es.length < ids.length) continue;
  puzzles.push({ date, A: +(es.reduce((a, b) => a + b, 0) / es.length).toFixed(3), floor: +Math.min(...es).toFixed(3) }); }
console.log(`\n=== per-puzzle backtest over ${puzzles.length} frozen ${TIER} dailies (Ease) ===`);
dist(puzzles.map(p => p.A), "A(day) = mean Ease");
dist(puzzles.map(p => p.floor), "floor = min Ease");

// artist feel-good per day: does each easy day have a few "I know this!" works? (composition target, not a gate)
const fgHits = [];
for (const [date, day] of Object.entries(bd)) { const ids = day[TIER] || []; if (!ids.length) continue;
  const n = ids.filter(id => (out[id]?.feelGood ?? 0) >= 0.6).length; fgHits.push(n); }
const hcount = {}; for (const n of fgHits) hcount[n] = (hcount[n] || 0) + 1;
console.log(`\nartist feel-good per easy day (# works with feelGood>=0.6, a "I know the artist" hit):`);
console.log("  " + Object.entries(hcount).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k} hits: ${v} days`).join(" · ") + `  (composition target: >=1-2/day)`);
const A = puzzles.map(p => p.A);
console.log("\nCANDIDATE EASE BANDS (from percentiles — provisional until friend play):");
console.log(`  easy ease-floor @ p10 = ${pctl(A, 10).toFixed(2)}  ·  p25 = ${pctl(A, 25).toFixed(2)}  ·  median day = ${pctl(A, 50).toFixed(2)}`);
