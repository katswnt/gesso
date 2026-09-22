// Offline-only Pass B B4 hydration repair (VSD-027).
//
// Rehydrates the preserved B4 deltas with the current deterministic assembler, writes a NEW quarantined
// comparison run, and proves every byte under the source B1-B3 and B4 evidence roots stayed unchanged.
// It makes no network/model call and has no authoritative production writer.
//
//   /opt/homebrew/bin/node scripts/pass-b-b4-offline-repair.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assembleAndValidateB4, LEGACY_B4_DELTA_VERSION, HOTSPOT_MAX_BBOX_AREA, HOTSPOT_MIN_DISTANCE, b4Lineage } from './lib/pass-b-b4-delta.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';
import { VALIDATION_CONTRACT_VERSION } from './lib/pass-b-calibration.mjs';
import { sha256, stableJson } from './lib/vision-legacy.mjs';

const REPAIR_VERSION = 'passBB4OfflineHydrationRepair/1';
const ROOT = 'data/incoming/vision-calibration';
const UPSTREAM = join(ROOT, 'cal50-0a47b6f7f332');
const SOURCE = join(ROOT, 'b4c-f45fac18da2e');
const wd = id => sha256(id).slice(0, 24);
const bytesSha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function filesUnder(dir) {
  const out = [];
  const visit = path => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name); const st = statSync(child);
      if (st.isDirectory()) visit(child);
      else if (st.isFile()) out.push(child);
    }
  };
  visit(dir);
  return out;
}

function snapshotEvidence() {
  const files = [...filesUnder(UPSTREAM), ...filesUnder(SOURCE)].sort();
  return files.map(path => ({ path: relative('.', path), bytes: statSync(path).size, sha256: fileSha(path) }));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
}

function loadStage(id, stage) {
  const path = join(UPSTREAM, 'works', wd(id), 'completions', `${stage.toLowerCase()}-${completionKey(stage, id)}.json`);
  return { path, bytes: readFileSync(path), body: JSON.parse(readFileSync(path, 'utf8')).body };
}

function nearPairs(hotspots) {
  const points = (hotspots || []).filter(h => Number.isFinite(h.x) && Number.isFinite(h.y));
  let count = 0;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < HOTSPOT_MIN_DISTANCE) count++;
  }
  return count;
}

const before = snapshotEvidence();
const evidenceManifestSha256 = sha256(stableJson(before));
const binding = {
  repairVersion: REPAIR_VERSION,
  sourceRun: relative('.', SOURCE),
  upstreamRun: relative('.', UPSTREAM),
  evidenceManifestSha256,
  assemblerVersion: LEGACY_B4_DELTA_VERSION,
  validationContractVersion: VALIDATION_CONTRACT_VERSION,
  hotspotPolicy: { maxBboxArea: HOTSPOT_MAX_BBOX_AREA, minDistance: HOTSPOT_MIN_DISTANCE },
};
const runId = `b4r-${sha256(stableJson(binding)).slice(0, 12)}`;
const OUT = join(ROOT, runId);
if (existsSync(OUT)) throw new Error(`refusing to overwrite existing derived run: ${OUT}`);
mkdirSync(join(OUT, 'works'), { recursive: true, mode: 0o700 });
writeJson(join(OUT, 'evidence-manifest.json'), { ...binding, version: 'passBB4SourceEvidenceManifest/1', files: before });
writeJson(join(OUT, 'run-manifest.json'), { ...binding, version: REPAIR_VERSION, runId });

const totals = {
  sourceRecords: 0, rehydrated: 0, quarantinedCarried: 0, strictFailures: 0,
  hotspotsBefore: 0, hotspotsPublished: 0, coordinateChanges: 0,
  nearDuplicatePairsBefore: 0, nearDuplicatePairsAfter: 0,
  placementMethods: {}, suppressedReasons: {}, worksWithSuppressed: 0,
};
const works = [];
const sourceFiles = readdirSync(join(SOURCE, 'works')).filter(f => f.endsWith('.b4.json')).sort();
for (const file of sourceFiles) {
  const sourcePath = join(SOURCE, 'works', file);
  const sourceBytes = readFileSync(sourcePath);
  const record = JSON.parse(sourceBytes.toString('utf8'));
  totals.sourceRecords++;
  if (!record.ok) {
    totals.quarantinedCarried++;
    writeJson(join(OUT, 'works', file), { ...record, derivedOffline: true, sourceB4Sha256: bytesSha(sourceBytes) });
    works.push({ id: record.id, ok: false, sourceB4Sha256: bytesSha(sourceBytes), reason: record.why || 'source-quarantined' });
    continue;
  }

  const b1 = loadStage(record.id, 'B1'); const b2 = loadStage(record.id, 'B2'); const b3 = loadStage(record.id, 'B3');
  const b0Path = join(UPSTREAM, 'works', wd(record.id), 'b0-prep.json');
  const b0Bytes = readFileSync(b0Path); const b0 = JSON.parse(b0Bytes.toString('utf8'));
  const assembled = assembleAndValidateB4({ delta: record.rawDelta, b1: b1.body, b2: b2.body, b3: b3.body, legacy: b0.legacy });
  if (!assembled.ok) {
    totals.strictFailures++;
    throw new Error(`${record.id}: repaired hydration failed ${assembled.stage}: ${(assembled.errors || []).join('; ')}`);
  }

  const oldHotspots = record.body?.hotspots || [];
  const newHotspots = assembled.body.hotspots || [];
  const surviving = b4Lineage(record.rawDelta).hotspots.filter(x => x.survives);
  const oldByDeltaIndex = new Map(surviving.map((row, i) => [row.deltaIndex, oldHotspots[i]]));
  let coordinateChanges = 0;
  for (const placement of assembled.hydration.hotspots.placements) {
    const old = oldByDeltaIndex.get(placement.deltaIndex);
    if (!old || !Number.isFinite(old.x) || !Number.isFinite(old.y)
      || Math.abs(old.x - placement.x) > 1e-9 || Math.abs(old.y - placement.y) > 1e-9) coordinateChanges++;
    totals.placementMethods[placement.method] = (totals.placementMethods[placement.method] || 0) + 1;
  }
  for (const row of assembled.hydration.hotspots.suppressed) totals.suppressedReasons[row.reason] = (totals.suppressedReasons[row.reason] || 0) + 1;
  if (assembled.hydration.hotspots.suppressed.length) totals.worksWithSuppressed++;
  totals.hotspotsBefore += oldHotspots.length;
  totals.hotspotsPublished += newHotspots.length;
  totals.coordinateChanges += coordinateChanges;
  totals.nearDuplicatePairsBefore += nearPairs(oldHotspots);
  totals.nearDuplicatePairsAfter += nearPairs(newHotspots);
  totals.rehydrated++;

  const derived = {
    id: record.id, ok: true, reused: record.reused, derivedOffline: true, why: null,
    evidence: record.evidence, rawDelta: record.rawDelta, body: assembled.body, hydration: assembled.hydration,
    source: {
      b4RecordSha256: bytesSha(sourceBytes), b0PrepSha256: bytesSha(b0Bytes),
      B1CompletionSha256: bytesSha(b1.bytes), B2CompletionSha256: bytesSha(b2.bytes), B3CompletionSha256: bytesSha(b3.bytes),
    },
  };
  writeJson(join(OUT, 'works', file), derived);
  works.push({ id: record.id, ok: true, sourceB4Sha256: derived.source.b4RecordSha256, bodySha256: assembled.bodySha256, coordinateChanges, hotspotsBefore: oldHotspots.length, hotspotsPublished: newHotspots.length, suppressed: assembled.hydration.hotspots.suppressed });
}

const after = snapshotEvidence();
if (stableJson(after) !== stableJson(before)) throw new Error('source evidence changed during offline repair');
const report = { ...binding, version: 'passBB4OfflineHydrationRepairReport/1', runId, sourceEvidenceUnchanged: true, totals, works };
writeJson(join(OUT, 'repair-report.json'), report);
console.log(`PASS: ${runId}`);
console.log(`source evidence unchanged: ${before.length}/${after.length} files`);
console.log(`rehydrated ${totals.rehydrated}; carried ${totals.quarantinedCarried} quarantined; strict failures ${totals.strictFailures}`);
console.log(`hotspots ${totals.hotspotsBefore} -> ${totals.hotspotsPublished}; coordinate changes ${totals.coordinateChanges}; near pairs ${totals.nearDuplicatePairsBefore} -> ${totals.nearDuplicatePairsAfter}`);
console.log(`suppressed ${JSON.stringify(totals.suppressedReasons)}; output ${OUT}`);
