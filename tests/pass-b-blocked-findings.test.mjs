// VSD-034 item 1 regressions: content-blocked findings (pure logic) + approval enforcement (integration).
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { completionKey } from '../scripts/lib/vision-content-capture.mjs';
import {
  buildFinding, sealFindings, verifyFindingsArtifact, matchFinding, evaluateApproval, contentFingerprint, CONTENT_BLOCKED_VERSION,
} from '../scripts/lib/pass-b-blocked-findings.mjs';
import { buildApproval, applyApproval, APPROVAL_VERSION, CONTENT_BLOCKED_PATH } from '../scripts/lib/pass-b-approval.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const H = (s) => sha256(s); // 64-hex helper for fixtures

// ---- pure: fingerprint + build + seal/verify ----
const rec = { id: 'wikidata:Q1', rawDelta: { a: 1, b: [2, 3] } };
ok(contentFingerprint(rec).rawDeltaSha256 === contentFingerprint({ id: 'wikidata:Q1', rawDelta: { b: [2, 3], a: 1 } }).rawDeltaSha256, 'fingerprint is key-order stable');
assert.throws(() => contentFingerprint({ id: 'x' }), /rawDelta/, 'no rawDelta -> throw'); n++;

const fA = buildFinding({ workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA'), rawResponseSha256: H('respA'), imgSha256: H('img'), blockedClaims: ['c1', 'c2'], reason: 'r' });
ok(fA.findingId.startsWith('cb-'), 'finding id prefixed');
assert.throws(() => buildFinding({ workId: 'x', rawDeltaSha256: 'nothex', blockedClaims: ['c'] }), /rawDeltaSha256/); n++;
assert.throws(() => buildFinding({ workId: 'x', rawDeltaSha256: H('d'), blockedClaims: [] }), /blockedClaim/); n++;

const sealed = sealFindings([fA], 'note');
ok(sealed.version === CONTENT_BLOCKED_VERSION, 'sealed version');
ok(verifyFindingsArtifact(sealed).ok, 'seal verifies');
const tampered = JSON.parse(JSON.stringify(sealed)); tampered.findings[0].blockedClaims.push('sneaked-in');
ok(!verifyFindingsArtifact(tampered).ok, 'tamper detected'); // findingsSha no longer matches

// ---- pure: matching on either hash-base ----
const F = [fA];
ok(matchFinding(F, { workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA') }) === fA, 'match by delta');
ok(matchFinding(F, { workId: 'wikidata:Q1', rawResponseSha256: H('respA') }) === fA, 'match by raw response');
ok(matchFinding(F, { workId: 'wikidata:Q1', rawDeltaSha256: H('other') }) === null, 'no match different content');
ok(matchFinding(F, { workId: 'wikidata:Q2', rawDeltaSha256: H('deltaA') }) === null, 'no match different work');

// ---- pure: evaluateApproval ----
ok(evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q9', rawDeltaSha256: H('z') } }).allowed, 'unrelated work allowed');
const exact = evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA') } });
ok(!exact.allowed && exact.reason === 'content-blocked-descendant', 'exact blocked content refused');
const freshNoRes = evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('freshDelta') } });
ok(!freshNoRes.allowed && freshNoRes.reason === 'content-blocked-work-needs-resolution', 'fresh run of blocked work needs resolution');

const goodRes = { findingId: fA.findingId, authority: 'owner', freshRun: true, resolvedClaims: [{ claim: 'c1' }, { claim: 'c2' }] };
ok(evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('freshDelta') }, resolution: goodRes }).allowed, 'valid resolution on fresh run clears');
// resolution cannot clear the EXACT blocked content, even if well-formed
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA') }, resolution: goodRes }).allowed, 'resolution never clears the exact blocked content');
// resolution missing a claim does not clear
const partialRes = { findingId: fA.findingId, authority: 'owner', freshRun: true, resolvedClaims: [{ claim: 'c1' }] };
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('freshDelta') }, resolution: partialRes }).allowed, 'partial resolution does not clear');
// resolution without freshRun attestation does not clear
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('freshDelta') }, resolution: { ...goodRes, freshRun: false } }).allowed, 'no-freshRun does not clear');
// self-inferred (wrong findingId / bad authority) does not clear
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('freshDelta') }, resolution: { ...goodRes, authority: 'model' } }).allowed, 'model authority does not clear');

// ---- integration: real sealed artifact blocks the real approval path ----
if (existsSync(CONTENT_BLOCKED_PATH)) {
  const artifact = verifyFindingsArtifact(JSON.parse(readFileSync(CONTENT_BLOCKED_PATH, 'utf8')));
  ok(artifact.ok, 'on-disk findings artifact integrity');
  const runDir = 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
  const teachPath = 'data/teach-works.js';
  const hotspotsPath = 'data/hotspots.js';
  const blocked = 'wikidata:Q16467705';

  // buildApproval refuses to even stage a blocked work.
  assert.throws(() => buildApproval({ runDir, workId: blocked, teachPath, hotspotsPath }), /content-blocked/, 'buildApproval refuses blocked work'); n++;

  // applyApproval hard-rejects a hand-crafted owner-approved approval for the blocked work, before any write.
  const cpath = join(runDir, 'works', sha256(blocked).slice(0, 24), 'completions', `b4-${completionKey('B4', blocked)}.json`);
  if (existsSync(cpath)) {
    const rawC = readFileSync(cpath, 'utf8');
    const forged = {
      version: APPROVAL_VERSION, ownerApproved: true, runId: JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8')).runId,
      workId: blocked, imgSha256: JSON.parse(rawC).imgSha256, b4CompletionSha256: sha256(rawC),
      validationContractVersion: 'x', approvedFields: ['why'], ownerEdits: {}, fileGuards: { teach: 'x', hotspots: 'x' }, approvedRecord: { teach: {}, hotspots: [] },
    };
    const res = applyApproval({ approval: forged, runDir, teachPath, hotspotsPath, apply: false });
    ok(!res.ok && res.errors.some((e) => e.startsWith('content-blocked:')), 'applyApproval rejects blocked work before write');
    ok(!res.wrote, 'nothing written for blocked work');
  }
} else {
  console.log('  (skipped integration: findings artifact not generated)');
}

console.log(`ok - pass-b blocked findings: ${n} checks passed`);
