// VSD-034 item 1 regressions: content-blocked findings (pure) + mandatory fail-closed approval enforcement.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../scripts/lib/vision-legacy.mjs';
import { completionKey } from '../scripts/lib/vision-content-capture.mjs';
import {
  buildFinding, sealFindings, verifyFindingsArtifact, matchFinding, evaluateApproval, contentFingerprint,
  loadCanonicalFindings, CANONICAL_FINDINGS_PATH, CONTENT_BLOCKED_VERSION,
} from '../scripts/lib/pass-b-blocked-findings.mjs';
import { buildApproval, applyApproval, APPROVAL_VERSION } from '../scripts/lib/pass-b-approval.mjs';

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const H = (s) => sha256(s);

// ---- pure: fingerprint + build ----
ok(contentFingerprint({ id: 'wikidata:Q1', rawDelta: { a: 1, b: [2, 3] } }).rawDeltaSha256
  === contentFingerprint({ id: 'wikidata:Q1', rawDelta: { b: [2, 3], a: 1 } }).rawDeltaSha256, 'fingerprint key-order stable');
assert.throws(() => contentFingerprint({ id: 'x' }), /rawDelta/); n++;
const fA = buildFinding({ workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA'), rawResponseSha256: H('respA'), imgSha256: H('img'), blockedClaims: ['c1', 'c2'], reason: 'r' });
ok(fA.findingId.startsWith('cb-'), 'finding id prefixed');
assert.throws(() => buildFinding({ workId: 'x', rawDeltaSha256: 'nothex', blockedClaims: ['c'] }), /rawDeltaSha256/); n++;
assert.throws(() => buildFinding({ workId: 'x', rawDeltaSha256: H('d'), blockedClaims: [] }), /blockedClaim/); n++;

// ---- E2 fix: the seal covers the COMPLETE finding (every field) ----
const sealed = sealFindings([fA], 'note');
ok(verifyFindingsArtifact(sealed).ok, 'seal verifies');
for (const mut of [(a) => { a.findings[0].findingId = 'cb-X'; }, (a) => { a.findings[0].imgSha256 = H('z'); }, (a) => { a.findings[0].reason = 'innocuous'; }, (a) => { a.findings[0].provenance = { spoof: 1 }; }, (a) => { a.findings[0].blockedClaims.push('x'); }, (a) => { a.findings[0].rawResponseSha256 = H('q'); }]) {
  const t = JSON.parse(JSON.stringify(sealed)); mut(t);
  ok(!verifyFindingsArtifact(t).ok, 'full-finding tamper detected');
}

// ---- pure: matching + evaluateApproval ----
const F = [fA];
ok(matchFinding(F, { workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA') }) === fA, 'match by delta');
ok(matchFinding(F, { workId: 'http://www.wikidata.org/entity/Q1', rawDeltaSha256: H('deltaA') }) === fA, 'Wikidata URL/id aliases cannot bypass a blocked finding');
ok(matchFinding(F, { workId: 'wikidata:Q1', rawResponseSha256: H('respA') }) === fA, 'match by raw response');
ok(matchFinding(F, { workId: 'wikidata:Q1', rawDeltaSha256: H('other') }) === null, 'no match different content');
ok(evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q9', rawDeltaSha256: H('z') } }).allowed, 'unrelated work allowed');
ok(evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA') } }).reason === 'content-blocked-descendant', 'exact content blocked');
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('fresh') } }).allowed, 'fresh run of blocked work refused without resolution');

// ---- Resolution contract (approval accepts it only through a verified reconciliation artifact) ----
const goodRes = { findingId: fA.findingId, authority: 'owner', freshRun: true, resolvedClaims: [{ claim: 'c1' }, { claim: 'c2' }] };
ok(evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('fresh') }, resolution: goodRes }).allowed, 'pure contract: valid resolution clears a fresh run');
const fB = buildFinding({ workId: 'wikidata:Q1', rawDeltaSha256: H('deltaB'), rawResponseSha256: H('respB'), imgSha256: H('img'), blockedClaims: ['c3'], reason: 'r2' });
const goodResB = { findingId: fB.findingId, authority: 'owner', freshRun: true, resolvedClaims: [{ claim: 'c3' }] };
ok(evaluateApproval({ findings: [fA, fB], candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('fresh') }, resolution: [goodRes, goodResB] }).allowed, 'one bound resolution per finding clears a fresh run with multiple findings');
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('deltaA') }, resolution: goodRes }).allowed, 'pure contract: exact content never cleared');
ok(!evaluateApproval({ findings: F, candidate: { workId: 'wikidata:Q1', rawDeltaSha256: H('fresh') }, resolution: { ...goodRes, authority: 'model' } }).allowed, 'pure contract: model authority never clears');

// ---- E1 fix: canonical loader is mandatory + cwd-independent ----
ok(CANONICAL_FINDINGS_PATH.startsWith('/'), 'canonical path absolute (cwd-independent)');
if (existsSync(CANONICAL_FINDINGS_PATH)) {
  const findings = loadCanonicalFindings();
  ok(findings.length >= 2, 'canonical findings load + verify');

  const runDir = 'data/incoming/vision-calibration/cal50-0a47b6f7f332';
  const teachPath = 'data/teach-works.js', hotspotsPath = 'data/hotspots.js';
  const blocked = 'wikidata:Q16467705';

  // buildApproval refuses a blocked work using the MANDATORY canonical set (no path/injection bypass).
  assert.throws(() => buildApproval({ runDir, workId: blocked, teachPath, hotspotsPath }), /content-blocked/, 'buildApproval refuses blocked via canonical'); n++;
  // findings:[] as an extra prop cannot bypass — the exported API ignores caller-supplied findings entirely.
  assert.throws(() => buildApproval({ runDir, workId: blocked, teachPath, hotspotsPath, findings: [] }), /content-blocked/, 'findings:[] cannot bypass La Gloire'); n++;

  // A non-blocked work is NOT rejected by the content-block guard (guard does not over-block).
  try { buildApproval({ runDir, workId: 'harvard303416', teachPath, hotspotsPath }); ok(true, 'non-blocked work not content-blocked'); }
  catch (e) { ok(!/content-blocked/.test(e.message), `non-blocked work threw non-content-blocked (${e.message.slice(0, 40)})`); }

  // applyApproval rejects a forged owner-approved approval for the exact blocked content, EVEN if it carries
  // a resolution field (the approval path ignores approval.resolution; exact blocked bytes never clear).
  const cpath = join(runDir, 'works', sha256(blocked).slice(0, 24), 'completions', `b4-${completionKey('B4', blocked)}.json`);
  if (existsSync(cpath)) {
    const rawC = readFileSync(cpath, 'utf8');
    const forged = {
      version: APPROVAL_VERSION, ownerApproved: true, runId: JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8')).runId,
      workId: blocked, imgSha256: JSON.parse(rawC).imgSha256, b4CompletionSha256: sha256(rawC), validationContractVersion: 'x',
      approvedFields: ['why'], ownerEdits: {}, fileGuards: { teach: 'x', hotspots: 'x' }, approvedRecord: { teach: {}, hotspots: [] },
      resolution: { findingId: 'anything', authority: 'owner', freshRun: true, resolvedClaims: [] }, // must be ignored
    };
    const res = applyApproval({ approval: forged, runDir, teachPath, hotspotsPath, apply: false });
    ok(!res.ok && res.errors.some((e) => e.startsWith('content-blocked:')), 'applyApproval blocks despite a forged resolution field');
    ok(!res.wrote, 'nothing written');
  }
} else {
  console.log('  (skipped integration: canonical findings not generated)');
}

console.log(`ok - pass-b blocked findings: ${n} checks passed`);
