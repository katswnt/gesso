import { readFileSync } from 'node:fs';
import {
  LEGACY_VISION_FIELD_MAP, auditLegacyVisionRecords, normalizeLegacyVisionRecord,
  restoreLegacyVisionProjection, restoreLegacyVisionRecord, stableJson,
} from '../scripts/lib/vision-legacy.mjs';
import { parseWindowAssignment } from '../scripts/lib/vision-inventory.mjs';

let passed = 0;
function ok(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`ok - ${name}`);
}

const records = parseWindowAssignment(readFileSync('data/vision.js', 'utf8'), 'window.ARTEFACTUM_VISION');
const audit = auditLegacyVisionRecords(records);
ok('all 202 historical rich records are present', audit.recordCount === 202);
ok('every observed top-level field has an explicit destination', audit.unknownFields.length === 0);
ok('all six historical evidence axes are recognized, including format', audit.unknownEvidenceAxes.length === 0 && audit.observedEvidenceAxes.includes('format'));
ok('all 202 records round-trip without value or type loss', audit.roundTripFailures.length === 0);
ok('audit passes', audit.ok);

ok('palette shapes are frozen accurately', audit.shapeCounts.palette['array'] === 109 && audit.shapeCounts.palette['object{hex,tone}'] === 93);
ok('figure shapes are frozen accurately', audit.shapeCounts.figures.number === 13 && audit.shapeCounts.figures.string === 87 && audit.shapeCounts.figures['object{count,who}'] === 102);
ok('signatures are objects on all records', audit.shapeCounts.signature['object{location,present,reads}'] === 202);
ok('embedded notes are 12 teaching bundles, not note arrays', audit.shapeCounts.notes['object{cues,guide,why}'] === 12);

ok('each record independently restores from its normalized envelope', Object.entries(records).every(([id, record]) => {
  const envelope = normalizeLegacyVisionRecord(id, record);
  const withoutRaw = structuredClone(envelope);
  delete withoutRaw.raw;
  return stableJson(restoreLegacyVisionRecord(envelope)) === stableJson(record)
    && stableJson(restoreLegacyVisionProjection(withoutRaw)) === stableJson(record);
}));

const first = Object.entries(records)[0];
const withForgottenField = { [first[0]]: { ...first[1], forgottenField: 'must fail' } };
ok('falsifiability: an unmapped historical field fails the audit', auditLegacyVisionRecords(withForgottenField).unknownFields.includes('forgottenField'));
const withForgottenAxis = { [first[0]]: { ...first[1], evidence: { ...first[1].evidence, costume: [] } } };
ok('falsifiability: an unmapped evidence axis fails the audit', auditLegacyVisionRecords(withForgottenAxis).unknownEvidenceAxes.includes('costume'));
ok('recognized and guessability are explicitly preserved under Pass A legacy evidence', LEGACY_VISION_FIELD_MAP.recognized.startsWith('passA.') && LEGACY_VISION_FIELD_MAP.guessability.startsWith('passA.'));
ok('historical notes map to a teaching bundle, never noteCandidates', LEGACY_VISION_FIELD_MAP.notes.endsWith('legacyBundle'));

console.log(`\nvision-legacy.test: ${passed} checks passed`);
