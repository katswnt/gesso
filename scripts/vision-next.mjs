// vision-next.mjs — select the next works to vision-audit (in daily-schedule order, upcoming first; skipping the
// vision-audit ledger) and BUILD A RUN: download each image through the hardened broker (G-03) into a fresh,
// run-scoped dir as a sanitized, metadata-stripped derivative, and write a provenance manifest. The model-facing
// records carry ONLY text metadata + the local derivative — never a URL. The tool-less runner
// (scripts/vision-audit-run.mjs) then reads this run; nothing here calls a model or a shell.
//   node scripts/vision-next.mjs [count=20] [mode=schedule|easy]
// Output: data/incoming/vision/runs/<runId>/{manifest.json, imgs/<sha>.<ext>}
import { readFileSync, writeFileSync } from "node:fs";
import broker from "./lib/img-broker.mjs";
import { createRunDir, promptHashOf, runHeader, workStateSha } from "./lib/vision-run.mjs";
import { auditedOracle, blockedIds, isTransientFail, SCHEMA_VERSION } from "./lib/vision-ledger.mjs";   // dependency-free; shared with check-pool

const COUNT = parseInt(process.argv[2] || "20", 10);
const MODE = (process.argv[3] || "schedule").toLowerCase(); // "easy" = audit the easy tier first, then schedule order
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const MAX_FETCH_ATTEMPTS = 3;   // after this many STABLE broker failures on the SAME url, back off (skip) until the url changes
const FAILS_PATH = "data/vision-fetch-failures.json";   // TRACKED record of failing image fetches (stable → backoff; transient → retried)
// isTransientFail (shared, in vision-ledger) decides stable-vs-transient; ONLY stable failures count toward backoff.

const load = (path, varName) => { const g = {}; global.window = g; new Function(readFileSync(path, "utf8"))(); return g[varName]; };
const DAILY = load("data/daily-order.js", "ARTEFACTUM_DAILY");
const POOL = load("data/pool.js", "ARTEFACTUM_POOL");
const CUES = load("data/teach-works.js", "ARTEFACTUM_CUES").work || {};
const HOT = (() => { try { return load("data/hotspots.js", "ARTEFACTUM_HOTSPOTS") || {}; } catch { return {}; } })();
let NOPINS = new Set(); try { NOPINS = new Set(JSON.parse(readFileSync("data/no-pins-reviewed.json", "utf8"))); } catch {}
const byId = new Map(POOL.map(p => [p.id, p]));
let fails = {}; try { fails = JSON.parse(readFileSync(FAILS_PATH, "utf8")); } catch {}
// a work is BACKED OFF when it has failed the broker MAX_FETCH_ATTEMPTS times on its CURRENT (unchanged) url — skip it
// in selection so a permanently-broken image (blocked IP / MIME / size / decode / stable 404) doesn't loop every run.
const backedOff = id => { const f = fails[id]; const p = byId.get(id); return !!(f && p && f.url === p.img && (f.stableAttempts || 0) >= MAX_FETCH_ATTEMPTS); };
const ledger = JSON.parse(readFileSync("data/vision-audit.json", "utf8"));
// ELIGIBILITY comes from the ONE shared, tested oracle (auditedOracle), also used by check-pool — a single source of
// truth for "terminally audited at the CURRENT pass". A work is AUDITED (skipped) IFF it has a current-pass
// complete/unplayable entry. Bare legacy (pre-G-03) ids are NEVER audited — they are unverified legacy evidence and
// remain fully eligible for a secure re-audit. A 'needs-image' blocker is NOT audited either — it is handled below.
let evidence = {}; try { evidence = JSON.parse(readFileSync("data/vision-evidence.json", "utf8")); } catch {}
const audited = auditedOracle(ledger, evidence);   // cross-verifies each terminal entry against the committed evidence store
const blocked = blockedIds(ledger);   // current-pass needs-image works, re-audited ahead of the calendar

const byDate = DAILY.byDate || {};
const today = new Date().toISOString().slice(0, 10);
const tiers = ["easy", "medium", "hard", "impossible"];
const dates = Object.keys(byDate).sort().filter(d => d > today); // upcoming only

const picked = [];
const seen = new Set();
// FETCHABLE = has an https image the hardened broker can actually retrieve. A non-https (or missing) image can NEVER
// pass the HTTPS-only broker, so selecting it just loops — skip it everywhere here; check-pool surfaces the offenders
// (non-https-image) so the pool image gets rehosted. This is the tracked status for the class Codex flagged.
const fetchable = p => typeof p?.img === "string" && /^https:\/\//i.test(p.img);
const ledgerEntries = ledger.entries || {};
// PRIORITY 1 — TRACKED BLOCKERS: works marked 'needs-image' in the committed ledger. Select ONLY a blocker whose pool
// image URL actually CHANGED since it was blocked (entry.img !== p.img) — an unchanged-URL blocker is almost certainly
// still the same bad image, so selecting+fetching it every run would waste capacity and repeat fetches (it's held out
// here, costing nothing). A same-URL in-place content fix is the rare case: trigger it explicitly via priority.json
// (below), which bypasses this skip. The build loop is a final belt: it drops a selected blocker whose re-fetched
// derivative is byte-identical to the recorded blocked imgSha.
for (const id of blocked) {
  if (picked.length >= COUNT) break;
  const p = byId.get(id); if (!p || seen.has(id) || !fetchable(p) || backedOff(id)) continue;
  const e = ledgerEntries[id];
  if (e && e.img != null && e.img === p.img) continue;   // URL unchanged → not fixed yet → don't consume capacity
  seen.add(id); picked.push({ id, firstDate: "blocked", tier: "priority" });
}
// PRIORITY 2 — EXPLICIT OPERATOR OVERRIDE: an optional data/incoming/vision/priority.json lets an operator force a
// re-audit even of an already-audited work (explicit priority overrides old completion). Ephemeral/local by design.
try {
  const pri = JSON.parse(readFileSync("data/incoming/vision/priority.json", "utf8"));
  for (const id of pri) {
    if (picked.length >= COUNT) break;
    if (byId.has(id) && !seen.has(id)) { seen.add(id); picked.push({ id, firstDate: "priority", tier: "priority" }); }
  }
} catch {}
// EASY-FIRST: the easy tier is what beginners see most and recurs ~monthly, so verify it to completion first.
// D.easy is the rotation [4 icons, 1 recognizable, ...] so iterating in order front-loads the most-seen icons.
if (MODE === "easy") {
  for (const id of (DAILY.easy || [])) {
    if (audited(id) || seen.has(id) || !fetchable(byId.get(id)) || backedOff(id)) continue;
    seen.add(id); picked.push({ id, firstDate: "easy-tier", tier: "easy" });
    if (picked.length >= COUNT) break;
  }
}
// Fill the remainder (or the whole batch, in schedule mode) by upcoming daily date, de-duped.
outer: for (const d of dates) {
  if (picked.length >= COUNT) break;
  for (const t of tiers) for (const id of (byDate[d][t] || [])) {
    if (audited(id) || seen.has(id) || !fetchable(byId.get(id)) || backedOff(id)) continue;
    seen.add(id); picked.push({ id, firstDate: d, tier: t });
    if (picked.length >= COUNT) break outer;
  }
}

// DEEP-POOL fallback: once the scheduled + easy-tier works are exhausted (the high-traffic set is
// audited), keep the burn-down going by filling from the rest of the un-audited pool, most-famous-first.
// This carries coverage past 100% of the calendar toward 100% of the pool.
// NOTE: we do NOT skip p.play===false here. A play:false decision made by the LEGACY (pre-G-03) pipeline is
// unverified and must be re-auditable — !audited(p.id) already excludes only works the SECURE pass confirmed
// unplayable (a current-pass 'unplayable' entry), so a legacy play:false work is still eligible for re-audit.
// (Human/ancestral remains are never sent to the model.)
if (picked.length < COUNT) {
  const rest = POOL.filter(p => p && p.sensitive !== "remains" && fetchable(p) && !audited(p.id) && !seen.has(p.id) && !backedOff(p.id))
    .sort((a, b) => (b.fame || 0) - (a.fame || 0));
  for (const p of rest) { if (picked.length >= COUNT) break; seen.add(p.id); picked.push({ id: p.id, firstDate: "deep-pool", tier: "deep" }); }
}

// Build the run: broker-download each image into the run dir, record provenance, write URL-free model metadata.
const PROMPT_HASH = promptHashOf(readFileSync("scripts/vision-audit-prompt.md", "utf8"));
const run = createRunDir();
const items = [];
let okN = 0, skippedUnchanged = 0;
for (const { id, firstDate, tier } of picked) {
  const p = byId.get(id) || {}; const c = CUES[id] || {};
  // model-facing text ONLY — no URL, no path
  const meta = {
    title: p.title || "", artist: p.artist || "", place: p.place || "", date: p.y ?? null,
    medium: p.medium || "", style: p.style || "", why: c.why || "",
    notes: (c.notes || []).map(n => ({ head: n.head, body: n.body, ...(n.x != null ? { x: n.x, y: n.y } : {}) })),
  };
  // baseSha binds the authoritative work-state this run is built from (pool + notes + hotspots + ledger entry +
  // no-pins membership); curate-merge refuses to apply if any of it drifted.
  const baseSha = workStateSha(p, c, HOT[id] || null, ledgerEntries[id] || null, NOPINS.has(id));
  let prov = { imgStatus: "no-img" };
  if (p.img) {
    const r = await broker.fetchImageToModelFile(p.img, run.imgsDir, { userAgent: BROWSER, referer: true });
    if (r.ok) {
      delete fails[id];   // a successful fetch clears any backoff record
      // BLOCKED-work identity: if this is a needs-image blocker and the re-fetched sanitized derivative is byte-
      // identical to the one that was blocked (imgSha), the image content has NOT changed — skip it (no model call).
      if (firstDate === "blocked" && ledgerEntries[id] && ledgerEntries[id].imgSha === r.sha256) { skippedUnchanged++; continue; }
      okN++; prov = { imgStatus: "ok", requestedUrl: r.requestedUrl, finalUrl: r.finalUrl, host: r.host, resolvedIp: r.resolvedIp, sha256: r.sha256, ext: r.ext, bytes: r.bytes, w: r.width, h: r.height, mime: r.mime, imgFile: `imgs/${r.sha256}.${r.ext}` };
    } else {
      // record the broker rejection with SEPARATE counters so transient noise can't trip the permanent backoff:
      // ONLY stable failures increment stableAttempts (→ backedOff); transient failures bump transientCount only
      // (telemetry, always retried). Same url → accumulate; changed url → reset both.
      const prev = fails[id]; const sameUrl = prev && prev.url === p.img;
      const transient = isTransientFail(r.reason, r.status);
      fails[id] = {
        url: p.img, reason: r.reason, status: r.status ?? null, transient,
        stableAttempts: (sameUrl ? (prev.stableAttempts || 0) : 0) + (transient ? 0 : 1),
        transientCount: (sameUrl ? (prev.transientCount || 0) : 0) + (transient ? 1 : 0),
        at: today,
      };
      prov = { imgStatus: r.reason };
    }
  }
  items.push({ id, firstDate, tier, meta, baseSha, ...prov });
}
writeFileSync(run.manifestPath, JSON.stringify({ header: runHeader(run.runId, PROMPT_HASH), items }, null, 1));
writeFileSync(FAILS_PATH, JSON.stringify(fails, null, 1) + "\n");   // TRACKED backoff record

const span = items.length ? `${items[0].firstDate} .. ${items[items.length - 1].firstDate}` : "(none)";
const backedOffNow = Object.keys(fails).filter(id => backedOff(id));
console.log(`vision-next: run ${run.runId} — ${items.length} works selected (${span}), ${okN} images broker-sanitized, ${items.length - okN} rejected/absent, ${skippedUnchanged} blocked-unchanged skipped (image content not fixed)`);
if (backedOffNow.length) console.log(`  ${backedOffNow.length} works BACKED OFF (permanent broker failure, unchanged url — fix the image): ${backedOffNow.slice(0, 8).join(", ")}${backedOffNow.length > 8 ? " …" : ""}`);
console.log(`  next: node scripts/vision-audit-run.mjs ${run.dir}   (tool-less, cost-gated) → vision-review → curate-merge --run ${run.dir}`);
const knownIds = new Set([...(ledger.ids || []), ...Object.keys(ledger.entries || {})]);
let auditedCount = 0; for (const id of knownIds) if (audited(id)) auditedCount++;
console.log(`ledger: ${auditedCount} secure-pass audited (current ${SCHEMA_VERSION}), ${(ledger.ids || []).length} legacy-evidence ids (NOT counted as verified), ${blocked.length} blocked (needs-image); ${dates.length} upcoming dates scanned`);
