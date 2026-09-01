// Offline structural gate for pilot protocol-freeze preparation. Passing this gate means the DRAFT is
// internally consistent; it does NOT mean the pilot is frozen or authorize data collection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PILOT_WORKS, PILOT_CALLS, FACETS, buildCallManifest, disclosureMask, opaqueSham, canonicalJson, sha256, buildModelPrompt,
  validateWorkShape, validateCuratorChecks, curatorChecksAllTrue, applicableEligibleFacets,
  disclosedFacetList, buildWorksheet, unresolvedBlockingIssues, styleDedupFromSnapshot, gradeStyle, normalizedWorkId,
} from './lib/recognition-pilot.mjs';

const DIR = 'docs/research/recognition-pilot';
const manifest = JSON.parse(readFileSync(join(DIR, 'pilot-manifest.draft.json'), 'utf8'));
const calls = JSON.parse(readFileSync(join(DIR, 'call-manifest.draft.json'), 'utf8'));
const styles = JSON.parse(readFileSync(join(DIR, 'style-taxonomy.snapshot.json'), 'utf8'));
const legacy = JSON.parse(readFileSync(join(DIR, 'legacy-comparison.snapshot.json'), 'utf8'));
const failures = [], blockers = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(manifest.status === 'DRAFT_NOT_FROZEN_NO_COLLECTION', 'manifest must remain visibly unfrozen (draft)');
check(manifest.works?.length === PILOT_WORKS, 'exactly 36 works');
check(new Set(manifest.works?.map(w => w.id)).size === PILOT_WORKS, 'work ids unique');
check(new Set(manifest.works?.map(w => normalizedWorkId(w.id))).size === PILOT_WORKS, 'normalized (conceptual) work ids unique');
check(calls.calls?.length === PILOT_CALLS && calls.counts?.total === PILOT_CALLS, 'exactly 671 calls');
check(canonicalJson(buildCallManifest(manifest.works, calls.seed)) === canonicalJson(calls), 'call manifest reproducible from frozen works+seed');
const cells = {};
for (const w of manifest.works || []) cells[`${w.strata?.fameBand}:${w.strata?.regionGroup}`] = (cells[`${w.strata?.fameBand}:${w.strata?.regionGroup}`] || 0) + 1;
check(Object.keys(cells).length === 10 && Object.values(cells).every(n => n === 3 || n === 4), 'hard fame×region cells all contain 3–4 works');
check(Object.values(cells).reduce((a, b) => a + b, 0) === 36, 'hard quota totals 36');
check(manifest.works.filter(w => w.studyC).length === 6, 'six Study C works');
check(manifest.works.filter(w => w.promptOrder).length === 12, 'twelve prompt-order works');
check(manifest.works.filter(w => w.evidenceBoxes).length === 12, 'twelve evidence-box works');
check(manifest.works.filter(w => w.strata?.lowDocumentationStress).length === 6, 'six low-documentation works');

for (const w of manifest.works || []) {
  const shape = validateWorkShape(w);
  if (!shape.ok) shape.errors.forEach(e => failures.push(`work shape: ${e}`));
  const cc = validateCuratorChecks(w.curatorChecks);
  if (!cc.ok) cc.errors.forEach(e => failures.push(`${w.id}: ${e}`));
  const mask = disclosureMask(w.cue?.correct, w.cue?.acceptedAliasesByFacet);
  check(canonicalJson(mask) === canonicalJson({ disclosedFacets: w.cue?.disclosedFacets, eligibleFacets: w.cue?.eligibleFacets }), `literal mask reproducible: ${w.id}`);
  check(w.cue?.sham === opaqueSham(w.cue?.correct, w.id), `sham reproducible: ${w.id}`);
  check([...w.cue.disclosedFacets, ...w.cue.eligibleFacets].sort().join(',') === [...FACETS].sort().join(','), `mask partitions facets: ${w.id}`);
  check(applicableEligibleFacets(w).length > 0, `has an applicable eligible Study B facet: ${w.id}`);
  // Granular remaining curator checks (one line per missing check, not one per work).
  if (cc.ok) for (const key of ['imageFitness', 'regionOrigin', 'recognitionKey', 'cueAndMask', 'truthHierarchy', 'rights']) {
    if (w.curatorChecks[key] !== true) blockers.push(`curator-check:${key} ${w.id}`);
  }
  if (!w.source?.sanitizedSha256 || !w.source?.canonicalViewSha256 || Object.keys(w.transform?.views || {}).length !== 7) blockers.push(`image-hashes ${w.id}`);
  if (w.studyC && !w.alternate?.sameObjectOwnerApproved) blockers.push(`studyc-alternate-approval ${w.id}`);
  if (w.studyC && w.curatorChecks?.alternateIdentity !== true) blockers.push(`studyc-alternate-identity ${w.id}`);
  if (w.studyC && (!w.alternate?.source || !w.alternate?.license || !w.alternate?.comparability)) blockers.push(`studyc-alternate-provenance ${w.id}`);
  for (const it of unresolvedBlockingIssues(w)) blockers.push(`unresolved-blocking-issue:${it.code} ${w.id}`);
}

// Review-artifact drift: the worksheet must equal its deterministic regeneration from the sealed manifest.
check(readFileSync(join(DIR, 'pilot-curation-worksheet.md'), 'utf8') === buildWorksheet(manifest), 'curation worksheet is current (regenerate via seal-curation)');

// Behavioral disclosure list (derived from the manifest, never a hardcoded prose count).
const disclosures = disclosedFacetList(manifest);
for (const w of manifest.works) {
  const stored = [...(w.cue.disclosedFacets || [])].sort().join(',');
  const derived = disclosures.filter(d => d.id === w.id).map(d => d.facet).sort().join(',');
  check(stored === derived, `disclosure list consistent: ${w.id}`);
}

// The style dedup map is an actual grading dependency: prove the grader consumes it.
const styleDedup = styleDedupFromSnapshot(styles);
check(styles.curatorReview?.complete !== true || Object.keys(styleDedup).length > 0, 'a completed style review carries a non-empty dedup map');
check(gradeStyle('Rapa Nui', { exact: ['Rapa Nui people'], family: [], related: [] }, styleDedup).credit
   === gradeStyle('Rapa Nui people', { exact: ['Rapa Nui people'], family: [], related: [] }, styleDedup).credit,
  'grader consumes dedup map: Rapa Nui ≡ Rapa Nui people earn identical credit');
check(gradeStyle('Qing dynasty', { exact: ['Qin dynasty'], family: [], related: [] }, styleDedup).credit === 0, 'grader keeps Qin dynasty vs Qing dynasty distinct');

const styleHash = sha256(canonicalJson(Object.fromEntries(Object.entries(styles).filter(([k]) => k !== 'sha256'))));
check(styles.sha256 === styleHash, 'style snapshot hash');
check(Array.isArray(styles.labels) && styles.labels.length > 0, 'style snapshot nonempty');
if (styles.curatorReview?.complete !== true) blockers.push('style taxonomy near-duplicate review incomplete');

// Isolated multilingual-fame prerequisite: present, well-formed, and covering exactly the current 36 works.
const mfPath = join('data/incoming/recognition-pilot', manifest.freezeCandidateId, 'multilingual-fame.json');
let mfValid = false;
try {
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
  const mfIds = new Set((mf.rows || []).map(r => r.id));
  mfValid = mf.version === 'recognition-multilingual-fame/1'
    && Array.isArray(mf.rows) && mf.rows.length === PILOT_WORKS && mfIds.size === PILOT_WORKS
    && manifest.works.every(w => mfIds.has(w.id))
    && mf.rows.every(r => r.languages && Object.keys(r.languages).length === (mf.languages || []).length
      // linked rows must be numerically scored; missingQid (unknown linkage) rows must be explicitly unscored (null).
      && (r.missingQid ? r.languageBalancedPilot === null : typeof r.languageBalancedPilot === 'number'));
} catch { mfValid = false; }
if (!mfValid) blockers.push('multilingual-fame-missing-or-invalid');
check(/NOT MODEL-FACING/.test(legacy.warning || '') && Object.keys(legacy.works || {}).length === PILOT_WORKS, 'legacy comparison isolated and complete');
// The legacy baseline must describe the EXACT final sample, not a stale pre-replacement one.
const legacyIds = new Set(Object.keys(legacy.works || {}));
const manifestIds = new Set(manifest.works.map(w => w.id));
const legacyQ = new Set([...legacyIds].map(normalizedWorkId)), manifestQ = new Set([...manifestIds].map(normalizedWorkId));
check(legacyIds.size === manifestIds.size && [...manifestIds].every(id => legacyIds.has(id)), 'legacy comparison ids exactly match the final manifest works');
check(legacyQ.size === manifestQ.size && [...manifestQ].every(q => legacyQ.has(q)), 'legacy comparison normalized (QID) id-set matches the manifest');
check(legacy.sha256 === sha256(canonicalJson(Object.fromEntries(Object.entries(legacy).filter(([k]) => k !== 'sha256')))), 'legacy comparison hash');

for (const file of ['identify.md','facets.md','facets-cued.md','identity-first.md']) {
  const text = readFileSync(join(DIR, 'prompts', file), 'utf8');
  check(!/https?:\/\//i.test(text), `${file} contains no URL`);
  check(!/\bcurl\b|\bwget\b|\btools?\b\s*:/i.test(text), `${file} contains no fetch/tool instruction`);
}
for (const file of ['identification.schema.json','facets.schema.json','identity-first.schema.json']) {
  const schema = JSON.parse(readFileSync(join(DIR, 'schemas', file), 'utf8'));
  check(schema.additionalProperties === false, `${file} fail-closed top-level properties`);
}
check(JSON.parse(readFileSync(join(DIR, 'schemas/identification.schema.json'), 'utf8')).required.includes('specificWorkClaim'), 'identification distinguishes a specific-work claim from generic description');
const promptAssets = Object.fromEntries([
  ['identify','identify.md'], ['facets','facets.md'], ['facets-cued','facets-cued.md'], ['identity-first','identity-first.md'],
].map(([k, f]) => [k, readFileSync(join(DIR, 'prompts', f), 'utf8')]));
const schemaAssets = {
  identification: JSON.parse(readFileSync(join(DIR, 'schemas/identification.schema.json'), 'utf8')),
  facets: JSON.parse(readFileSync(join(DIR, 'schemas/facets.schema.json'), 'utf8')),
};
const byWork = new Map(manifest.works.map(w => [w.id, w]));
for (const call of calls.calls) {
  const modelText = buildModelPrompt(call, byWork.get(call.workId), promptAssets, schemaAssets);
  check(!/https?:\/\//i.test(modelText), `assembled model prompt URL-free: ${call.callId}`);
}
const prepSource = readFileSync('scripts/recognition-pilot-prepare.mjs', 'utf8');
check(!/api\.anthropic\.com|ANTHROPIC_API_KEY|fetch\s*\(/.test(prepSource), 'preparation script has no model/network path');
check(!/writeFileSync\(['"]data\/(?:pool|fame|daily|teach|hotspots|vision)/.test(prepSource), 'preparation script cannot write authoritative game data');
const runnerSource = readFileSync('scripts/recognition-pilot-run.mjs', 'utf8');
check(/PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION/.test(runnerSource) && /verifyGitFreeze/.test(runnerSource), 'runner requires a verified frozen git protocol-freeze');
check(!/externalId/.test(runnerSource), 'runner has no external-registration dependency');
check(!/\btools\s*:/.test(runnerSource), 'model request has no tools field');
check(/terminal-api-error/.test(runnerSource), 'non-retryable API errors are terminal across resume');
check(/AbortSignal\.timeout\(REQUEST_POLICY\.requestTimeoutMs\)/.test(runnerSource) && /maxCollectionHours/.test(runnerSource), 'runner has hard request and collection-window deadlines');
check(/artifactHashes/.test(runnerSource) && /git freeze is not intact/.test(runnerSource), 'runner verifies frozen hashes and dedicated commit');
const imageSource = readFileSync('scripts/lib/recognition-pilot-images.mjs', 'utf8');
check(/maxVisualTokens:\s*1568/.test(imageSource) && /patchSize:\s*28/.test(imageSource), 'images are locally normalized to the provider native patch limit');
const freezeSource = readFileSync('scripts/recognition-pilot-freeze.mjs', 'utf8');
check(!/api\.anthropic\.com|ANTHROPIC_API_KEY|fetch\s*\(/.test(freezeSource), 'freeze finalizer has no model/network path');
check(/PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION/.test(freezeSource) && /dedicated-git-commit/.test(freezeSource), 'finalizer creates git-only frozen artifacts');
const sealSource = readFileSync('scripts/recognition-pilot-seal-curation.mjs', 'utf8');
check(!/api\.anthropic\.com|ANTHROPIC_API_KEY|fetch\s*\(/.test(sealSource) && /explicit --seal required/.test(sealSource), 'curation seal is explicit and offline-only');

if (failures.length) {
  console.error('❌ recognition pilot preparation gate');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ recognition pilot preparation gate PASS (${manifest.works.length} works / ${calls.calls.length} calls)`);
console.log(`ℹ️  derived disclosure list (${disclosures.length}): ${disclosures.map(d => `${d.id}:${d.facet}`).join(', ')}`);
const category = b => b.split(' ')[0];
const byCategory = {};
for (const b of blockers) byCategory[category(b)] = (byCategory[category(b)] || 0) + 1;
console.log(`ℹ️  DRAFT ONLY — ${blockers.length} protocol-freeze blockers remain (no collection authorized):`);
for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) console.log(`      ${n.toString().padStart(3)}  ${cat}`);
