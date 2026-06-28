#!/usr/bin/env node
// Reusable merge for the comprehensive curate pass. Applies ONLY safe fixes; queues the risky ones.
//   node scripts/curate-merge.mjs <out1.json> [out2.json ...]
// SAFE (auto-applied): style/styleKind (with the MOVEMENTS guard), medium (bucket-validated), notes + pins
//   (only when image.ok===true), noPins. RISKY (queued, never applied): image, title, place/region/lat/lng, date.
// MOVEMENTS GUARD: a proposed style is applied only if it's already a MOVEMENTS key, OR the agent supplied
//   movementMeta so we can register it first. Otherwise the style is QUEUED (style-unmapped) — never silently
//   applied, because a famous work with an unmapped style hard-fails check-pool.
import { readFileSync, writeFileSync } from "node:fs";
import { simplifyMedium } from "./lib/domain.mjs";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: curate-merge.mjs <out.json...>"); process.exit(1); }

let html = readFileSync("index.html", "utf8");
const movStart = html.indexOf("const MOVEMENTS={");
const movEnd = html.indexOf("const MOV_FAMILY=");
const movKeys = new Set([...html.slice(movStart, movEnd).matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]));

let psrc = readFileSync("data/pool.js", "utf8");
const pi = psrc.indexOf("["), pj = psrc.lastIndexOf("]");
const pool = JSON.parse(psrc.slice(pi, pj + 1));
const byId = Object.fromEntries(pool.map(p => [p.id, p]));

let ttxt = readFileSync("data/teach-works.js", "utf8");
const teach = JSON.parse(ttxt.slice(ttxt.indexOf("{", ttxt.indexOf(".work")), ttxt.lastIndexOf("}") + 1));
let htxt = readFileSync("data/hotspots.js", "utf8");
const hot = JSON.parse(htxt.slice(htxt.indexOf("{"), htxt.lastIndexOf("}") + 1));
let reviewedNoPins = []; try { reviewedNoPins = JSON.parse(readFileSync("data/incoming/no-pins-reviewed.json", "utf8")); } catch {}

const out = files.flatMap(f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.error("bad", f, e.message); return []; } });

const newMovements = []; // {key,dates,region,palette} to insert into MOVEMENTS
const queue = [];
const stat = { style: 0, medium: 0, notesPins: 0, movAdded: 0, styleQueued: 0, skipped: 0 };
const DEFAULT_PALETTE = ["#7a3e24", "#a98244", "#1f6f5b", "#e8ddc3"];
const validBucket = m => { const s = simplifyMedium(m); return s && s.split(" ").length <= 2 && !/album|scroll|folio|sheet|page|untitled|fragment|reformatted/i.test(s); };

for (const w of out) {
  const p = byId[w.id]; const c = teach[w.id]; if (!p) { stat.skipped++; continue; }
  const f = w.fields || {};

  // ---- STYLE (with MOVEMENTS guard) ----
  if (f.style) {
    if (movKeys.has(f.style)) { p.style = f.style; if (f.styleKind) p.styleKind = f.styleKind; stat.style++; }
    else if (w.movementMeta && w.movementMeta.dates) {
      const region = w.movementMeta.region || p.region || p.place || "";
      const palette = Array.isArray(w.movementMeta.palette) && w.movementMeta.palette.length === 4 ? w.movementMeta.palette : DEFAULT_PALETTE;
      newMovements.push({ key: f.style, dates: w.movementMeta.dates, region, palette });
      movKeys.add(f.style); p.style = f.style; if (f.styleKind) p.styleKind = f.styleKind; stat.style++; stat.movAdded++;
    } else { queue.push({ id: w.id, title: p.title, type: "style-unmapped", suggested: f.style }); stat.styleQueued++; }
  }

  // ---- MEDIUM (bucket-validated) ----
  if (f.medium && validBucket(f.medium)) { p.medium = f.medium.charAt(0).toUpperCase() + f.medium.slice(1); stat.medium++; }

  // ---- RISKY -> queue ----
  for (const k of ["title", "place", "region", "lat", "lng", "date"]) if (f[k] != null && f[k] !== p[k] && !(k === "date")) queue.push({ id: w.id, title: p.title, type: k, from: p[k], to: f[k] });
  if (f.date != null && f.date !== p.y) queue.push({ id: w.id, title: p.title, type: "date", from: p.y, to: f.date });
  if (w.image && (w.image.ok === false || (w.image.issue && w.image.issue !== "none")))
    queue.push({ id: w.id, title: p.title, type: "image", issue: w.image.issue, reason: w.image.reason, suggestedUrl: w.image.suggestedUrl || null });

  // ---- NOTES + PINS (only when the agent saw a trustworthy image) ----
  if (c && w.image && w.image.ok === true && Array.isArray(w.notes) && w.notes.length && w.notes.every(n => n.head && n.body)) {
    if (w.noPins) { c.notes = w.notes.map(n => ({ head: n.head, body: n.body })); delete hot[w.id]; if (!reviewedNoPins.includes(w.id)) reviewedNoPins.push(w.id); }
    else {
      const pinned = w.notes.filter(n => typeof n.x === "number"), unp = w.notes.filter(n => typeof n.x !== "number");
      c.notes = [...pinned, ...unp].map(n => { const o = { head: n.head, body: n.body }; if (typeof n.x === "number") { o.x = n.x; o.y = n.y; } return o; });
      hot[w.id] = pinned.map((n, i) => ({ n: i + 1, x: n.x, y: n.y }));
    }
    stat.notesPins++;
  }
}

// insert any new MOVEMENTS entries right after the opening brace (idempotent — movKeys already deduped)
if (newMovements.length) {
  const anchor = "const MOVEMENTS={";
  const ins = newMovements.map(m => `\n  ${JSON.stringify(m.key)}:{dates:${JSON.stringify(m.dates)},region:${JSON.stringify(m.region)},palette:${JSON.stringify(m.palette)}},`).join("");
  html = html.replace(anchor, anchor + ins);
  writeFileSync("index.html", html);
}
writeFileSync("data/pool.js", psrc.slice(0, pi) + JSON.stringify(pool) + psrc.slice(pj + 1));
writeFileSync("data/teach-works.js", "window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=" + JSON.stringify(teach) + ";\n");
writeFileSync("data/hotspots.js", "window.ARTEFACTUM_HOTSPOTS=" + JSON.stringify(hot) + ";\n");
writeFileSync("data/incoming/no-pins-reviewed.json", JSON.stringify(reviewedNoPins, null, 1));
// ACCUMULATE the review queue across batches (dedupe by id+type) so bulk triage sees everything.
let priorQ = []; try { priorQ = JSON.parse(readFileSync("data/incoming/curate/review-queue.json", "utf8")); } catch {}
const qseen = new Set(); const mergedQ = [];
for (const q of [...priorQ, ...queue]) { const k = q.id + "|" + q.type; if (qseen.has(k)) continue; qseen.add(k); mergedQ.push(q); }
writeFileSync("data/incoming/curate/review-queue.json", JSON.stringify(mergedQ, null, 1));
console.error(`curate-merge: ${out.length} works | style ${stat.style} (+${stat.movAdded} new movements) | medium ${stat.medium} | notes+pins ${stat.notesPins} | style-queued ${stat.styleQueued} | risky queued ${queue.length}`);
if (newMovements.length) console.error("  new MOVEMENTS:", newMovements.map(m => m.key).join(", "));
