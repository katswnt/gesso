// Offline recompute of the B2 v1-vs-v2 comparison metrics from PRESERVED transcripts (no model call).
// Corrects two things Codex flagged: (1) fetch counts now reflect genuine retrievals, not attempts
// (verifyB2WebEvents fix); (2) v1 telemetry is traced to the ACCEPTED completion's transcript SHA, and an
// input digest is bound per row. Rewrites each *.compare.json in place, then re-render with the card script.
// Usage: node scripts/pass-b-b2-v2-recompute.mjs <compare-run-dir> [<source-run-dir>]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseStreamTranscript, verifyB2WebEvents } from './lib/pass-b-calibration.mjs';
import { isCorroboratingSource } from './lib/vision-content-schema.mjs';

// Same shape as the harness's bodyMetrics, kept here so a recompute refreshes metric KEYS too (the harness
// runs main() on import, so it can't be imported for this one helper).
function bodyMetrics(body) {
  if (!body) return null;
  const fcs = body.factChecks || [];
  const verd = {};
  for (const f of fcs) verd[f.verdict] = (verd[f.verdict] || 0) + 1;
  const srcUrls = new Set();
  for (const f of fcs) for (const s of (f.sources || [])) if (s && s.url) srcUrls.add(String(s.url));
  const corroborating = [...srcUrls].filter((u) => isCorroboratingSource(u)).length;
  const hiRefNoCorrob = fcs.filter((f) => f.verdict === 'refuted' && (f.confidence || 0) >= 0.8 && !(f.sources || []).some((s) => isCorroboratingSource(s.url))).length;
  return { factChecks: fcs.length, verdicts: verd, distinctSources: srcUrls.size, corroboratingSources: corroborating,
    guideAnswers: (body.guideAnswers || []).length, b3Requests: (body.targetedVerificationRequests || []).length, hiConfRefutedWithoutCorroboratingSource: hiRefNoCorrob };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const dir = process.argv[2];
const SRC = process.argv[3] || 'data/incoming/vision-calibration/cal50-3445a229789f';
if (!dir) { console.error('usage: node scripts/pass-b-b2-v2-recompute.mjs <compare-run-dir> [<source-run-dir>]'); process.exit(2); }

// index the source run: workId -> { b1Body, catalog, legacy, v1Sha, attemptsDir }
function sourceIndex() {
  const idx = new Map();
  const worksRoot = join(SRC, 'works');
  for (const wd of readdirSync(worksRoot)) {
    const cdir = join(worksRoot, wd, 'completions');
    if (!existsSync(cdir)) continue;
    const files = readdirSync(cdir);
    const b1f = files.find((f) => /^b1-/.test(f)); if (!b1f) continue;
    const b1 = JSON.parse(readFileSync(join(cdir, b1f), 'utf8'));
    const b2f = files.find((f) => /^b2-/.test(f));
    const b2 = b2f ? JSON.parse(readFileSync(join(cdir, b2f), 'utf8')) : null;
    const prep = JSON.parse(readFileSync(join(worksRoot, wd, 'b0-prep.json'), 'utf8'));
    idx.set(b1.workId, { b1Body: b1.body, catalog: prep.trustedCatalog, legacy: prep.legacy, v1Sha: b2 ? b2.transcriptSha256 : null, attemptsDir: join(worksRoot, wd, 'attempts') });
  }
  return idx;
}
// Find the B2 attempt whose transcript SHA matches the accepted completion — searching EVERY calibration run
// dir, because B1/B2 checkpoints were migrated across runId forks and the accepted transcript may live in a
// predecessor run. Match by SHA only (identity is the SHA, not the location).
function v1WebFromSha(v1Sha) {
  if (!v1Sha) return null;
  const runsRoot = 'data/incoming/vision-calibration';
  for (const run of readdirSync(runsRoot).filter((d) => /^cal50-/.test(d))) {
    const worksRoot = join(runsRoot, run, 'works');
    if (!existsSync(worksRoot)) continue;
    for (const wd of readdirSync(worksRoot)) {
      const adir = join(worksRoot, wd, 'attempts');
      if (!existsSync(adir)) continue;
      for (const af of readdirSync(adir).filter((f) => /^b2-.*\.attempt\.json$/.test(f))) {
        const a = JSON.parse(readFileSync(join(adir, af), 'utf8'));
        if (a.transcriptSha256 !== v1Sha) continue;
        const tf = join(adir, a.transcriptFile);
        if (!existsSync(tf)) continue;
        const w = verifyB2WebEvents(parseStreamTranscript(readFileSync(tf, 'utf8')));
        return { searches: w.searches, fetches: w.fetches, fetchAttempts: w.fetchAttempts, fetchFailed: w.fetchFailed, durationMs: a.durationMs, matchedBy: 'accepted-transcript-sha', foundInRun: run };
      }
    }
  }
  return null;
}

const idx = sourceIndex();
for (const f of readdirSync(dir).filter((f) => /\.compare\.json$/.test(f))) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const safe = r.workId.replace(/[^a-z0-9]+/gi, '_');
  // v2: re-parse the saved transcript with the corrected verifier
  const tf = join(dir, `${safe}.v2.transcript.jsonl`);
  if (existsSync(tf) && r.v2 && r.v2.exec) {
    const w = verifyB2WebEvents(parseStreamTranscript(readFileSync(tf, 'utf8')));
    r.v2.exec.b2WebEvents = { ok: w.ok, searches: w.searches, fetches: w.fetches, fetchAttempts: w.fetchAttempts, fetchFailed: w.fetchFailed };
  }
  // v1: trace accepted completion transcript SHA; bind input digest
  const src = idx.get(r.workId);
  if (src) {
    r.v1 = r.v1 || {};
    r.v1.web = v1WebFromSha(src.v1Sha);
    r.inputDigest = sha256(JSON.stringify([src.b1Body, src.catalog, src.legacy]));
    r.acceptedV1TranscriptSha = src.v1Sha;
  }
  // Refresh body metrics with the corroborating-source classifier (keys the current card reads).
  if (r.v1?.body) r.v1.metrics = bodyMetrics(r.v1.body);
  if (r.v2?.body) r.v2.metrics = bodyMetrics(r.v2.body);
  r.recomputedAt = 'offline-from-preserved-transcripts';
  writeFileSync(join(dir, f), `${JSON.stringify(r, null, 1)}\n`);
  const v = r.v2?.exec?.b2WebEvents, u = r.v1?.web;
  console.log(`${r.workId.padEnd(22)} v1 ${u ? `${u.searches}s/${u.fetches}f(of ${u.fetchAttempts})` : 'n/a'}  ->  v2 ${v ? `${v.searches}s/${v.fetches}f(of ${v.fetchAttempts})` : 'n/a'}  digest=${(r.inputDigest || '').slice(0, 10)}`);
}
console.log('\nrewrote compare.json files. Re-render: node scripts/pass-b-b2-v2-card.mjs ' + dir);
