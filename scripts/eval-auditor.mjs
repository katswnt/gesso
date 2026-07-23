// Build a labeled eval set to MEASURE the vision auditor's wrong-art detection (precision/recall).
// Ground truth is unambiguous by construction:
//   CONTROLS (label "correct") — famous, previously-audited works shown with THEIR OWN image → expect image.ok=true
//   DECOYS   (label "wrong")   — real works shown with a DIFFERENT work's image (different region, so the
//                                mismatch is unmistakable) → expect image.ok=false, issue="wrong-art"
// Deterministic selection (no RNG) so the eval is reproducible. Writes blind input chunks + a truth file.
//   node scripts/eval-auditor.mjs [nEach=25]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const N = parseInt(process.argv[2] || "25", 10);
const OUT = "data/incoming/eval";
mkdirSync(OUT, { recursive: true });

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const audited = new Set(JSON.parse((await import("node:fs")).readFileSync("data/vision-audit.json", "utf8")).ids || []);
let fame = {}; try { const f = (await import("node:fs")).readFileSync("data/fame.js", "utf8"); fame = JSON.parse(f.slice(f.indexOf("{"), f.lastIndexOf("}") + 1)); } catch {}
const fa = p => fame[p.id] != null ? fame[p.id] : (p.fame || 0);

const usable = pool.filter(p => p.img && /^https?:/.test(p.img) && p.title && p.artist && !/unknown|anonymous/i.test(p.artist) && p.place && (p.y != null));
const ranked = usable.slice().sort((a, b) => fa(b) - fa(a));

// CONTROLS: most-famous works that were already vision-audited (image known to match) → shown with own image.
const controls = ranked.filter(p => audited.has(p.id)).slice(0, N);
const controlIds = new Set(controls.map(p => p.id));

// DECOYS: next most-famous distinct works; each shown with a DIFFERENT region's image so the mismatch is clear.
const decoyTargets = ranked.filter(p => !controlIds.has(p.id)).slice(0, N);
const rec = p => ({ id: p.id, title: p.title, artist: p.artist, img: p.img, place: p.place || "", date: p.y, medium: p.medium || "", style: p.style || "" });

const truth = {}; const entries = [];
for (const p of controls) { entries.push(rec(p)); truth[p.id] = { label: "correct", shownImgFrom: null }; }
for (let i = 0; i < decoyTargets.length; i++) {
  const t = decoyTargets[i];
  // pick a decoy image source of a DIFFERENT region, deterministically (walk the ranked list)
  const src = ranked.find(s => s.id !== t.id && !controlIds.has(s.id) && s.region !== t.region && s.img !== t.img) || ranked[(i + 7) % ranked.length];
  const e = rec(t); e.img = src.img; // swap in a mismatched image
  entries.push(e); truth[t.id] = { label: "wrong", shownImgFrom: src.id, shownImgTitle: src.title };
}

// deterministic interleave so each chunk mixes controls + decoys (a stable hash on id)
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
entries.sort((a, b) => hash(a.id) - hash(b.id));
const half = Math.ceil(entries.length / 2);
writeFileSync(`${OUT}/eval-in-1.json`, JSON.stringify(entries.slice(0, half), null, 1));
writeFileSync(`${OUT}/eval-in-2.json`, JSON.stringify(entries.slice(half), null, 1));
writeFileSync(`${OUT}/eval-truth.json`, JSON.stringify(truth, null, 1));
console.log(`eval set: ${controls.length} controls + ${decoyTargets.length} decoys = ${entries.length} works → 2 blind chunks`);
console.log(`truth → ${OUT}/eval-truth.json (labels hidden from the audit agents)`);
