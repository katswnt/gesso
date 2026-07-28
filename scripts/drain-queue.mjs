// Drain the DETERMINISTIC parts of the vision review queue (data/incoming/curate/review-queue.json) —
// no agents, so it's near-free vs. the vision pipeline (the expensive image-viewing already happened).
// Handles two categories:
//   WRONG-ART with a direct-image suggestedUrl → verify it downloads as a real image, then swap pool.img
//     (keeping the old one in prevImg). Only applies a URL we could actually fetch.
//   IMAGE-UNAVAILABLE / *blocked* → re-fetch the ORIGINAL image now; if it downloads, the audit-time flag
//     was a transient rate-limit → clear it from the queue (no change to the work).
// Everything else (low-quality/framing with no replacement, style-unmapped, museum-PAGE urls, date/place)
// is LEFT in the queue for its own handling. Resolved items are removed; the queue is rewritten.
//   node scripts/drain-queue.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal, writeAssignment } from "./lib/static-module.mjs";

const DRY = process.argv.includes("--dry");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIRECT = /upload\.wikimedia|Special:FilePath|\.(jpg|jpeg|png)($|\?)|iiif.*default|cdn\.loc\.gov|data\.ukiyo-e/i;

const QF = "data/incoming/curate/review-queue.json";
const queue = JSON.parse(readFileSync(QF, "utf8"));
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const byId = new Map(pool.map(p => [p.id, p]));

async function fetchImg(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "image/*", "Referer": "https://www.google.com/" } });
    if (!r.ok) return { ok: false, why: "HTTP " + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    if (buf.length < 3000 || !/image/i.test(ct)) return { ok: false, why: `${ct} ${buf.length}b` };
    return { ok: true };
  } catch (e) { return { ok: false, why: e.message }; }
}

const resolved = new Set();
let swapped = 0, cleared = 0, stillBad = 0; const swapLog = [];

for (const it of queue) {
  if (it.type !== "image") continue;
  const p = byId.get(it.id); if (!p) { resolved.add(it); continue; } // gone from pool → drop stale flag

  // (1) wrong-art with a direct-image replacement → verify + swap
  if (it.issue === "wrong-art" && it.suggestedUrl && DIRECT.test(it.suggestedUrl)) {
    await sleep(2500);
    const v = await fetchImg(it.suggestedUrl);
    if (v.ok) {
      if (!DRY) { if (!p.prevImg) p.prevImg = p.img; p.img = it.suggestedUrl; }
      swapped++; resolved.add(it); swapLog.push(`swap ${it.id} → ${it.suggestedUrl.slice(0, 50)}`);
    } else stillBad++;
    continue;
  }
  // (2) image-unavailable / blocked → re-check the original; clear if it now downloads
  if (/unavailable|inaccessible|blocked|rejected|broken-url/i.test((it.issue || "") + " " + (it.reason || ""))) {
    await sleep(2000);
    const v = await fetchImg(p.img);
    if (v.ok) { cleared++; resolved.add(it); } else stillBad++;
    continue;
  }
}

const next = queue.filter(it => !resolved.has(it));
if (!DRY) { writeFileSync(QF, JSON.stringify(next, null, 1)); writeAssignment("data/pool.js", "ARTEFACTUM_POOL", pool); }
console.log(`${DRY ? "[DRY] " : ""}wrong-art swapped: ${swapped} | image-unavailable cleared (now downloads): ${cleared} | still failing (left): ${stillBad}`);
console.log(`queue: ${queue.length} → ${next.length}`);
swapLog.slice(0, 12).forEach(l => console.log("  " + l));
