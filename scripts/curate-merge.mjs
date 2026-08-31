#!/usr/bin/env node
// Reusable merge for the comprehensive curate pass. Applies ONLY safe fixes; queues the risky ones.
//   node scripts/curate-merge.mjs <out1.json> [out2.json ...]
// SAFE (auto-applied): style/styleKind (with the MOVEMENTS guard), medium (bucket-validated), notes + pins
//   (only when image.ok===true), noPins. RISKY (queued, never applied): image, title, place/region/lat/lng, date.
// MOVEMENTS GUARD: a proposed style is applied only if it's already a MOVEMENTS key, OR the agent supplied
//   movementMeta so we can register it first. Otherwise the style is QUEUED (style-unmapped) — never silently
//   applied, because a famous work with an unmapped style hard-fails check-pool.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { simplifyMedium } from "./lib/domain.mjs";
import { verifyApproval, SCHEMA_VERSION, visionPassStatus, imageTrusted, ledgerTransition, workStateSha, acquireLock, releaseLock } from "./lib/vision-run.mjs";

// G-03: this merge NEVER consumes raw model/agent output. It applies ONLY a human-reviewed approved.json, bound to
// the run's sanitized-image sha + completion sha + prompt/schema/policy/model headers, and it validates the WHOLE
// batch before mutating any file (reject-before-write). Usage: curate-merge.mjs --run <runDir>
const runArgIdx = process.argv.indexOf("--run");
const runDir = runArgIdx >= 0 ? process.argv[runArgIdx + 1] : null;
if (!runDir) { console.error("usage: curate-merge.mjs --run <runDir>  — applies ONLY a human-approved, hash-bound approved.json; raw model/agent output is never accepted (G-03)"); process.exit(1); }

// EXCLUSIVE MERGE LOCK — acquired BEFORE reading any canonical state and held through every write + ledger record.
// Without it, two concurrent merges can both validate the same base state and the second clobbers the first (losing
// ledger / applied-run updates). Released on exit.
const LOCK = "data/incoming/vision/.curate-merge.lock";
mkdirSync("data/incoming/vision", { recursive: true });
if (!acquireLock(LOCK)) { console.error(`❌ curate-merge REJECT — another merge holds ${LOCK} (concurrent merge in progress). If none is running, remove that file.`); process.exit(1); }
process.on("exit", () => releaseLock(LOCK));
process.on("SIGINT", () => { releaseLock(LOCK); process.exit(1); });

let html = readFileSync("index.html", "utf8");
const movStart = html.indexOf("const MOVEMENTS={");
const movEnd = html.indexOf("const MOV_FAMILY=");
const movKeys = new Set([...html.slice(movStart, movEnd).matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]));
// Canonicalize a proposed style to an EXISTING key that differs only by case/diacritics/spacing, so Codex
// can't re-introduce variants like "Naive Art" / "Naive art" / "Naïve Art" as separate movements.
const normStyle = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[\s-]+/g," ").replace(/\b(art|movement)$/,"").trim();
const normToKey = new Map([...movKeys].map(k => [normStyle(k), k]));
const canonStyle = s => normToKey.get(normStyle(s)) || s;

let psrc = readFileSync("data/pool.js", "utf8");
const pi = psrc.indexOf("["), pj = psrc.lastIndexOf("]");
const pool = JSON.parse(psrc.slice(pi, pj + 1));
const byId = Object.fromEntries(pool.map(p => [p.id, p]));

let ttxt = readFileSync("data/teach-works.js", "utf8");
const teach = JSON.parse(ttxt.slice(ttxt.indexOf("{", ttxt.indexOf(".work")), ttxt.lastIndexOf("}") + 1));
let htxt = readFileSync("data/hotspots.js", "utf8");
const hot = JSON.parse(htxt.slice(htxt.indexOf("{"), htxt.lastIndexOf("}") + 1));
let reviewedNoPins = []; try { reviewedNoPins = JSON.parse(readFileSync("data/no-pins-reviewed.json", "utf8")); } catch {}

// Verify + load the approved batch BEFORE any file is mutated. Any provenance/hash/schema failure → reject, exit.
const _v = verifyApproval(runDir);
if (!_v.ok) { console.error("❌ curate-merge REJECT before write — approval/provenance failed:"); for (const e of _v.errors) console.error("  - " + e); process.exit(1); }
const out = _v.batch.map(b => ({ id: b.id, imgSha256: b.imgSha256, completionSha256: b.completionSha256, baseSha: b.baseSha, ...b.approved }));

// SINGLE-USE RUNS (reject replay before any write): a run's approval binds to its OWN manifest, not to CURRENT pool/
// notes state — so re-applying an OLD approved run could silently overwrite LATER corrections. The tracked ledger
// records every applied runId; a run already applied is refused. (Load the ledger here so the check is reject-before-write.)
const RUN_ID = _v.runId;
const led = JSON.parse(readFileSync("data/vision-audit.json", "utf8"));
led.entries = led.entries || {}; led.appliedRuns = led.appliedRuns || {};
if (!RUN_ID) { console.error("❌ curate-merge REJECT — approval header has no runId"); process.exit(1); }
if (led.appliedRuns[RUN_ID]) { console.error(`❌ curate-merge REJECT — run ${RUN_ID} was already applied on ${led.appliedRuns[RUN_ID].at} (single-use; re-applying an old run would overwrite newer corrections)`); process.exit(1); }

// LOAD + VALIDATE the durable evidence store UNDER THE LOCK, BEFORE any canonical mutation. A malformed/array-shaped/
// unreadable store must REJECT here — never be silently replaced with {} at write time (which, happening after the
// canonical writes, would discard all prior evidence while leaving a partially-applied merge). A missing file is OK
// (first run) → start from {}. This same object is mutated + written (evidence-first) below.
let evStore;
try { evStore = JSON.parse(readFileSync("data/vision-evidence.json", "utf8")); }
catch (e) { if (e.code === "ENOENT") evStore = {}; else { console.error("❌ curate-merge REJECT — data/vision-evidence.json unreadable/malformed (fix or remove it):", e.message); process.exit(1); } }
if (!evStore || typeof evStore !== "object" || Array.isArray(evStore)) { console.error("❌ curate-merge REJECT — data/vision-evidence.json is not a JSON object"); process.exit(1); }
if (evStore[RUN_ID]) { console.error(`❌ curate-merge REJECT — evidence for run ${RUN_ID} already exists (single-use)`); process.exit(1); }

// BASE-STATE GUARD (reject-before-write): each approved work carries the authoritative work-state hash the run was
// BUILT from (baseSha). If the LIVE state has drifted — a NEWER run already changed this work, or a crash left a
// half-applied earlier run — applying this (now-stale) run would clobber the newer data. Recompute the live hash and
// refuse the WHOLE batch on any drift or a missing baseSha (an old run built before this guard). This closes the
// "approve A → merge newer B → first-apply A overwrites B" hole AND the write-then-crash re-apply window.
{ const reviewedNoPinsSet = new Set(reviewedNoPins); const drift = [];
  for (const w of out) { const p = byId[w.id]; if (!p) continue;
    if (!w.baseSha) { drift.push(`${w.id} (no baseSha — rebuild the run)`); continue; }
    // hash the SAME authoritative state vision-next hashed at build: pool + notes + hotspots + the work's ledger
    // entry + no-pins membership — so an older run whose art-content matches but whose ledger status a NEWER run
    // already advanced is still caught here.
    const live = workStateSha(p, teach[w.id] || {}, hot[w.id] || null, led.entries[w.id] || null, reviewedNoPinsSet.has(w.id));
    if (live !== w.baseSha) drift.push(`${w.id} (work/ledger state changed since the run was built)`);
  }
  if (drift.length) { console.error("❌ curate-merge REJECT before write — stale run (base-state drift); rebuild vision-next for these works:"); for (const d of drift) console.error("  - " + d); process.exit(1); }
}

const newMovements = []; // {key,dates,region,palette} to insert into MOVEMENTS
const queue = [];
const stat = { style: 0, medium: 0, notesPins: 0, movAdded: 0, styleQueued: 0, skipped: 0, unplayable: 0, mediumHidden: 0 };
const DEFAULT_PALETTE = ["#7a3e24", "#a98244", "#1f6f5b", "#e8ddc3"];
const validBucket = m => { const s = simplifyMedium(m); return s && s.split(" ").length <= 2 && !/album|scroll|folio|sheet|page|untitled|fragment|reformatted/i.test(s); };

for (const w of out) {
  const p = byId[w.id]; const c = teach[w.id]; if (!p) { stat.skipped++; continue; }
  const f = w.fields || {};

  // ---- IMAGE TRUST GATE (computed FIRST, gates EVERY authoritative mutation) ----
  // Every field in a vision approval is IMAGE-DERIVED (the model judged style/medium/playability/legibility/notes
  // from the picture). If the image is not EXPLICITLY affirmed trustworthy (image.ok:true + imageQuality:'good' +
  // framing:'ok', all present in the approved subset), NOTHING it derived may mutate pool.js / index.html /
  // teach-works.js / hotspots.js — a wrong-image approval that still carried fields must not change any authoritative
  // file. The work is flagged for review (queue) and sent back for a better image (ledger 'needs-image' below).
  const trusted = imageTrusted(w);

  // ---- STYLE (with MOVEMENTS guard) — trusted image only ----
  if (trusted && f.style) {
    f.style = canonStyle(f.style); // fold case/diacritic variants onto the existing key
    if (movKeys.has(f.style)) { p.style = f.style; if (f.styleKind) p.styleKind = f.styleKind; stat.style++; }
    else if (w.movementMeta && w.movementMeta.dates) {
      const region = w.movementMeta.region || p.region || p.place || "";
      const palette = Array.isArray(w.movementMeta.palette) && w.movementMeta.palette.length === 4 ? w.movementMeta.palette : DEFAULT_PALETTE;
      newMovements.push({ key: f.style, dates: w.movementMeta.dates, region, palette });
      movKeys.add(f.style); p.style = f.style; if (f.styleKind) p.styleKind = f.styleKind; stat.style++; stat.movAdded++;
    } else { queue.push({ id: w.id, title: p.title, type: "style-unmapped", suggested: f.style }); stat.styleQueued++; }
  }

  // ---- MEDIUM (bucket-validated) — trusted image only ----
  if (trusted && f.medium && validBucket(f.medium)) { p.medium = f.medium.charAt(0).toUpperCase() + f.medium.slice(1); stat.medium++; }

  // ---- RISKY -> queue (review flags; NOT gated on trust — a bad image is exactly what we want surfaced) ----
  for (const k of ["title", "place", "region", "lat", "lng", "date"]) if (f[k] != null && f[k] !== p[k] && !(k === "date")) queue.push({ id: w.id, title: p.title, type: k, from: p[k], to: f[k] });
  if (f.date != null && f.date !== p.y) queue.push({ id: w.id, title: p.title, type: "date", from: p.y, to: f.date });
  if (w.image && (w.image.ok === false || (w.image.issue && w.image.issue !== "none")))
    queue.push({ id: w.id, title: p.title, type: "image", issue: w.image.issue, reason: w.image.reason, suggestedUrl: w.image.suggestedUrl || null });

  // ---- PLAYABILITY (vision quality verdicts) — trusted image only ----
  // playable:false → featureless object with no visual signal to guess from (a plain sphere/sherd). Applied only
  // when the image is trusted: sets p.play=false so freeze-daily + workComplete never SCHEDULE it (stays visible in
  // Collections). A defective / not-affirmed image can never terminally exclude a work.
  if (trusted) {
    if (w.playable === false) { p.play = false; stat.unplayable = (stat.unplayable||0)+1; }
    else if (w.playable === true && p.play === false) { delete p.play; } // re-audited as playable → un-exclude
    // medium not legibly judgeable from the (trusted) image (B&W/monochrome/unfinished) → drop 'medium' from
    // scoring so a player isn't marked wrong on a medium they can't see.
    if (w.mediumLegible === false && Array.isArray(p.cats) && p.cats.includes("medium")) { p.cats = p.cats.filter(c => c !== "medium"); stat.mediumHidden = (stat.mediumHidden||0)+1; }
  }
  // poor image quality / bad framing (blurry/dark/cropped/detail-only/lost-in-gallery) → queue a better image
  if (w.imageQuality === "poor" || (w.framing && w.framing !== "ok"))
    queue.push({ id: w.id, title: p.title, type: "image", issue: w.framing && w.framing !== "ok" ? w.framing : "low-quality", reason: w.qualityReason || w.image?.reason || "", suggestedUrl: w.image?.suggestedUrl || null });

  // ---- NOTES + PINS — trusted image only ----
  // seed a teach entry if the work is newly audited (had none) — vision-auditing a new work should create it
  if (trusted && Array.isArray(w.notes) && w.notes.length && w.notes.every(n => n.head && n.body)) {
    const tc = c || (teach[w.id] = {});
    if (w.noPins) { tc.notes = w.notes.map(n => ({ head: n.head, body: n.body })); delete hot[w.id]; if (!reviewedNoPins.includes(w.id)) reviewedNoPins.push(w.id); }
    else {
      // Pins render as CSS percentages (top:${y}%). Agents often emit 0–1 fractions; normalize ×100 so a
      // 0.62 doesn't become 0.62% (top-left cluster). Values >1 are already percentages, left as-is.
      const pc = v => (typeof v === "number" && v <= 1) ? Math.round(v * 1000) / 10 : v;
      const pinned = w.notes.filter(n => typeof n.x === "number"), unp = w.notes.filter(n => typeof n.x !== "number");
      tc.notes = [...pinned, ...unp].map(n => { const o = { head: n.head, body: n.body }; if (typeof n.x === "number") { o.x = pc(n.x); o.y = pc(n.y); } return o; });
      hot[w.id] = pinned.map((n, i) => ({ n: i + 1, x: pc(n.x), y: pc(n.y) }));
      // a later PINNED pass supersedes an earlier no-pins verdict: drop the stale no-pins exemption so the work
      // isn't treated as intentionally pinless anymore.
      if (pinned.length) reviewedNoPins = reviewedNoPins.filter(x => x !== w.id);
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
writeFileSync("data/no-pins-reviewed.json", JSON.stringify(reviewedNoPins, null, 1) + "\n");   // TRACKED (reproducible across clean checkouts)
// APPROVED-ONLY, COMPONENT-LEVEL, PASS-VERSIONED audited ledger (replaces the retired vision-mark) — the SOLE
// audited-ledger writer. Completion status is derived by visionPassStatus (shared contract, lib/vision-run.mjs),
// which requires EVERY narrow-pass component to be present + good (image.ok, playable:true, imageQuality 'good',
// framing 'ok', a boolean mediumLegible, real notes, and a notes/pins verdict) before a work counts 'complete'.
// 'unplayable' (playable:false) is a separate terminal outcome. 'needs-image' works (wrong / poor / cropped /
// detail / lost image) are persisted as BLOCKED in the TRACKED ledger (data/vision-audit.json entries[]) — NOT the
// gitignored data/incoming/vision/priority.json — so a better-image re-audit is scheduled from committed state and
// vision-next can prioritize them. A thin partial ('incomplete', e.g. only {playable:false→true}) neither completes
// nor blocks; it stays selectable. Every entry is stamped with the current pass (SCHEMA_VERSION) so a future richer
// pass can re-audit works completed under an older schema; an explicit re-audit at the current pass overrides a
// prior completion. Runs AFTER the canonical writes and does NOT swallow: if the ledger cannot be committed the
// merge FAILS (non-zero exit) — a work stays un-audited (safely re-selected), never audited-without-its-data.
// (led + led.entries + led.appliedRuns were loaded up-front for the single-use replay check.)
const ids = new Set(led.ids || []);   // bare LEGACY evidence (pre-G-03); current terminal state lives in led.entries
const now = new Date().toISOString().slice(0, 10);
const ledStat = { complete: 0, unplayable: 0, blocked: 0, invalidated: 0 };
for (const w of out) {
  const status = visionPassStatus(w);
  // One shared, tested transition. It PRESERVES a current-pass needs-image blocker across an incomplete retry (only
  // a trusted pass resolves it), DEMOTES a current-pass terminal on an incomplete re-audit (so a {playable:true}-only
  // flip can't leave a stale 'unplayable'), and drops a bare legacy id from ids once the work earns a real entry.
  const t = ledgerTransition(led.entries[w.id], status, SCHEMA_VERSION, now);
  // DURABLE PROVENANCE: every written entry references its run + the reviewed image/completion hashes, so a clean
  // checkout can trace an "audited" work back to committed evidence (data/vision-evidence.json). auditedOracle
  // REQUIRES these on a terminal entry — an evidence-less entry never counts as securely audited.
  if (t.setEntry) { t.setEntry.run = RUN_ID; if (w.imgSha256) t.setEntry.imgSha = w.imgSha256; if (w.completionSha256) t.setEntry.completionSha = w.completionSha256; }
  // BLOCKED works ALSO record the failing image URL (a cheap change hint alongside the derivative hash imgSha).
  if (t.setEntry && status === "needs-image") { const bp = byId[w.id]; if (bp && bp.img != null) t.setEntry.img = bp.img; }
  if (t.setEntry) led.entries[w.id] = t.setEntry;
  if (t.removeEntry) delete led.entries[w.id];
  if (t.removeFromIds) ids.delete(w.id);
  if (status === "complete" || status === "unplayable") ledStat[status]++;
  else if (status === "needs-image") ledStat.blocked++;
  else if (t.invalidated) ledStat.invalidated++;
}
led.appliedRuns[RUN_ID] = { at: now, n: out.length };   // record this run as APPLIED (single-use) — replay refused above
led.ids = [...ids];
// WRITE ORDER: DURABLE EVIDENCE FIRST, then the ledger. If the evidence write fails, the process exits non-zero
// BEFORE the ledger is written → no terminal entry exists → nothing appears audited (safe). An orphan evidence
// record (evidence written, ledger not) is harmless — auditedOracle keys off the ledger. The reverse (a terminal
// ledger entry with no evidence) would be an untraceable false-audited, which this ordering makes impossible.
// (auditedOracle ALSO fails closed on any evidence-less/orphaned terminal entry, so this is order + oracle in depth.)
{ evStore[RUN_ID] = { at: now, header: { promptHash: _v.header.promptHash, schemaVersion: _v.header.schemaVersion, brokerPolicyVersion: _v.header.brokerPolicyVersion, modelId: _v.header.modelId },
    items: _v.batch.map(b => ({ id: b.id, imgSha: b.imgSha256, completionSha: b.completionSha256, baseSha: b.baseSha, approved: b.approved })) };
  writeFileSync("data/vision-evidence.json", JSON.stringify(evStore, null, 1) + "\n"); }   // ← evidence committed BEFORE the ledger (evStore validated up-front under the lock)
writeFileSync("data/vision-audit.json", JSON.stringify(led, null, 1) + "\n");
console.error(`curate-merge: audited-ledger +${ledStat.complete} complete, +${ledStat.unplayable} unplayable, ${ledStat.blocked} blocked (needs-image), ${ledStat.invalidated} re-audit-invalidated — all in tracked data/vision-audit.json`);
// ACCUMULATE the review queue across batches (dedupe by id+type) so bulk triage sees everything.
let priorQ = []; try { priorQ = JSON.parse(readFileSync("data/incoming/curate/review-queue.json", "utf8")); } catch {}
const qseen = new Set(); const mergedQ = [];
for (const q of [...priorQ, ...queue]) { const k = q.id + "|" + q.type; if (qseen.has(k)) continue; qseen.add(k); mergedQ.push(q); }
writeFileSync("data/incoming/curate/review-queue.json", JSON.stringify(mergedQ, null, 1));
console.error(`curate-merge: ${out.length} works | style ${stat.style} (+${stat.movAdded} new movements) | medium ${stat.medium} | notes+pins ${stat.notesPins} | style-queued ${stat.styleQueued} | unplayable ${stat.unplayable} | medium-hidden ${stat.mediumHidden} | risky queued ${queue.length}`);
if (newMovements.length) console.error("  new MOVEMENTS:", newMovements.map(m => m.key).join(", "));
