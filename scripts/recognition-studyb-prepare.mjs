// Offline preparation of the corrected Study-B mini-pilot. Reads ONLY frozen inputs (read-only), binds
// reused values, renders the fixed model-facing schema, and writes DRAFT artifacts under
// docs/research/recognition-studyb/. No *.frozen.* file, no commit, no model call, no mutation of the
// completed pilot.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256, estimateCost, REQUEST_POLICY } from './lib/recognition-pilot.mjs';
import {
  STUDYB_PROTOCOL_ID, STUDYB_CALL_SEED, STUDYB_ARMS, STUDYB_REQUEST_POLICY,
  renderPromptSchema, buildStudyBPrompt, buildStudyBCallManifest, maxSerializedValidFacetResponse,
} from './lib/recognition-studyb.mjs';

const FROZEN = 'docs/research/recognition-pilot';
const OLD_RUN = 'data/incoming/recognition-pilot/gesso-recognition-pilot-2026-08-31-v1';
const OUT = 'docs/research/recognition-studyb';

const frozenManifest = JSON.parse(readFileSync(join(FROZEN, 'pilot-manifest.frozen.json'), 'utf8'));
if (frozenManifest.status !== 'PILOT_PROTOCOL_FROZEN_BEFORE_COLLECTION') throw new Error('frozen pilot required');
if (frozenManifest.sha256 !== sha256(canonicalJson({ ...frozenManifest, sha256: undefined }))) throw new Error('frozen manifest hash mismatch');
const imageEvidence = JSON.parse(readFileSync(join(OLD_RUN, 'image-evidence.json'), 'utf8'));
const imgItemById = new Map(imageEvidence.items.map(it => [it.id, it]));

const researchSchema = JSON.parse(readFileSync(join(FROZEN, 'schemas/facets.schema.json'), 'utf8'));
const renderedSchema = renderPromptSchema(researchSchema);
const promptFacets = readFileSync(join(FROZEN, 'prompts/facets.md'), 'utf8');
const promptFacetsCued = readFileSync(join(FROZEN, 'prompts/facets-cued.md'), 'utf8');
const styleTaxonomy = readFileSync(join(FROZEN, 'style-taxonomy.frozen.json'));
const promptAssets = { facets: promptFacets, facetsCued: promptFacetsCued };
const researchSchemaSha256 = sha256(canonicalJson(researchSchema));
const promptSchemaSha256 = sha256(canonicalJson(renderedSchema));

const works = frozenManifest.works.map(w => {
  const item = imgItemById.get(w.id), canon = item?.canonical, full = item?.views?.full;
  if (!canon?.ok || !/^[0-9a-f]{64}$/.test(canon.sha256 || '')) throw new Error(`missing source canonical hash: ${w.id}`);
  if (!full || !/^[0-9a-f]{64}$/.test(full.sha256 || '') || full.view !== 'full') throw new Error(`missing canonical full-view hash: ${w.id}`);
  const cue = w.cue || {};
  if (!cue.correct || !cue.sham) throw new Error(`missing cue/sham: ${w.id}`);
  if (!Array.isArray(cue.eligibleFacets)) throw new Error(`missing applicable-facet mask: ${w.id}`);
  if (!w.truth || typeof w.truth !== 'object') throw new Error(`missing truth: ${w.id}`);
  return {
    id: w.id,
    cue: { correct: cue.correct, sham: cue.sham, cueType: cue.cueType, eligibleFacets: cue.eligibleFacets, disclosedFacets: cue.disclosedFacets || [], acceptedAliasesByFacet: cue.acceptedAliasesByFacet },
    // ONE identical applicable-facet mask across all three arms = facets the CORRECT cue does not disclose.
    primaryApplicable: cue.eligibleFacets,
    truth: w.truth,
    strata: w.strata,
    image: { fullViewSha256: full.sha256, width: full.width, height: full.height, mime: full.mime, sourceCanonicalSha256: canon.sha256 },
  };
});
if (works.length !== 36) throw new Error(`expected 36 works, got ${works.length}`);

const callManifest = buildStudyBCallManifest(works, { protocolId: STUDYB_PROTOCOL_ID, seed: STUDYB_CALL_SEED });

// Cost estimate: frozen pricing/overhead, raised facets cap; per-call prompt+image registries.
const worksById = new Map(works.map(w => [w.id, w]));
const promptRegistry = {}, imageRegistry = {};
for (const c of callManifest.calls) {
  const w = worksById.get(c.workId);
  promptRegistry[c.callId] = buildStudyBPrompt(w, c.condition, promptAssets, renderedSchema);
  imageRegistry[`${c.workId}:canonical:full`] = { width: w.image.width, height: w.image.height, sha256: w.image.fullViewSha256 };
}
const estimatePolicy = { ...REQUEST_POLICY, tokenCaps: { ...REQUEST_POLICY.tokenCaps, facets: STUDYB_REQUEST_POLICY.facetsMaxTokens } };
const cost = estimateCost(callManifest, promptRegistry, imageRegistry, estimatePolicy);
const conservativePerCallUsd = Math.max(...cost.rows.map(r => r.conservativeUsd));
const headroom = maxSerializedValidFacetResponse(researchSchema);

const draftManifest = {
  version: 'recognition-studyb-manifest/2-draft',
  status: 'STUDYB_DRAFT_NOT_FROZEN',
  protocolId: STUDYB_PROTOCOL_ID,
  note: 'Corrected Study-B-only mini-pilot (prompt-level JSON, leak fixed). Independent identity.',
  instrument: { method: STUDYB_REQUEST_POLICY.method, model: STUDYB_REQUEST_POLICY.model, facetsMaxTokens: STUDYB_REQUEST_POLICY.facetsMaxTokens, temperature: STUDYB_REQUEST_POLICY.temperature, toolsOmitted: true, outputConfigUsed: false },
  reuseBindings: {
    sourcePilotFreezeId: frozenManifest.freeze.id, sourcePilotManifestSha256: frozenManifest.sha256,
    researchSchemaSha256, promptSchemaSha256,
    promptFacetsSha256: sha256(promptFacets), promptFacetsCuedSha256: sha256(promptFacetsCued),
    styleTaxonomySha256: sha256(styleTaxonomy),
  },
  budgetUsd: 10, conservativePerCallUsd: +conservativePerCallUsd.toFixed(6),
  arms: STUDYB_ARMS, works,
  callManifest: { seed: callManifest.seed, counts: callManifest.counts, sha256: callManifest.sha256 },
};
draftManifest.sha256 = sha256(canonicalJson({ ...draftManifest, sha256: undefined }));

mkdirSync(OUT, { recursive: true });
const write = (name, obj) => writeFileSync(join(OUT, name), (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n');
write('studyb-manifest.draft.json', draftManifest);
write('studyb-call-manifest.draft.json', callManifest);
write('prompt-schema.facets.draft.json', renderedSchema);
write('cost-preflight.draft.json', { protocolId: STUDYB_PROTOCOL_ID, facetsMaxTokens: STUDYB_REQUEST_POLICY.facetsMaxTokens, plannedUsd: cost.plannedUsd, conservativePerCallUsd: +conservativePerCallUsd.toFixed(6), authorizedUpperBoundUsd: cost.authorizedUpperBoundUsd, budgetUsd: 10 });

console.log('Study-B draft prepared under', OUT);
console.log('protocolId:', STUDYB_PROTOCOL_ID, '| method:', STUDYB_REQUEST_POLICY.method, '| cap:', STUDYB_REQUEST_POLICY.facetsMaxTokens);
console.log('works:', works.length, '| calls:', callManifest.counts.total, '(base', callManifest.counts.base, '+ repeats', callManifest.counts.repeats, ') byArm(primary):', JSON.stringify(callManifest.counts.byArm));
console.log('researchSchemaSha256:', researchSchemaSha256);
console.log('promptSchemaSha256:', promptSchemaSha256, '| rendered root keys:', Object.keys(renderedSchema).join(','));
console.log('draftManifestSha256:', draftManifest.sha256, '| callManifestSha256:', callManifest.sha256);
console.log('conservative plannedUsd: $' + cost.plannedUsd, '| per-call ceiling: $' + conservativePerCallUsd.toFixed(6), '| budget: $10');
console.log('token headroom: maxValid chars=' + headroom.chars, '| conservative tokens=' + headroom.conservativeTokenEstimate, '| cap=' + STUDYB_REQUEST_POLICY.facetsMaxTokens, '| valid=' + headroom.valid);
