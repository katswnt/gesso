// VSD-034/035: deterministic cross-stage content reconciliation.
//
// This module does not decide whether model prose is true. It turns the preserved B0-B4 bundle into
// stable claims, observations, production components, conflicts, and ordered effective decisions;
// then it computes component-level readiness. Model verdicts are proposals only. A component becomes
// eligible only through explicit grounding plus effective decisions owned by an authorized principal.
// Existing B4 records adapt conservatively: inferred/missing grounding is review-required, never approved.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './vision-legacy.mjs';
import { completionKey } from './vision-content-capture.mjs';
import { assembleAndValidateB4 } from './pass-b-b4-delta.mjs';
import { validateEntityGraph } from './pass-b-entity-contract.mjs';

export const CLAIM_BUNDLE_VERSION = 'passBClaimBundle/1';
export const CLAIM_DECISIONS_VERSION = 'passBClaimDecisions/2';
export const RECONCILIATION_REPORT_VERSION = 'passBReconciliationReport/1';
export const RECONCILIATION_POLICY_VERSION = 'passBReconciliationPolicy/1';
export const RECONCILIATION_ACTIVE_VERSION = 'passBReconciliationActive/1';
export const CONTENT_READINESS = Object.freeze(['eligible', 'review-required', 'blocked']);
export const EFFECTIVE_STATES = Object.freeze(['accepted', 'rejected', 'disputed', 'unresolved']);
export const DECISION_AUTHORITIES = Object.freeze(['owner', 'authoritative-source', 'controller']);
const COMPONENT_SURFACES = Object.freeze(['why', 'cues', 'notes', 'hotspots', 'guide']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA = /^[0-9a-f]{64}$/;
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const uniq = xs => [...new Set(xs)];
const text = (v, max = 4000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const sha = v => sha256(stableJson(v));

function stagePath(runDir, workId, stage) {
  const wdir = join(runDir, 'works', sha256(workId).slice(0, 24));
  return join(wdir, 'completions', `${stage.toLowerCase()}-${completionKey(stage, workId)}.json`);
}
const safeWorkId = workId => String(workId).replace(/[^a-z0-9]+/gi, '_');
function readJsonBound(path, required = true) {
  if (!existsSync(path)) {
    if (required) throw new Error(`missing reconciliation source: ${path}`);
    return { path, raw: null, value: null, sha256: null };
  }
  const raw = readFileSync(path, 'utf8');
  return { path, raw, value: JSON.parse(raw), sha256: sha256(raw) };
}
function bodyOf(bound) { return bound?.value?.body ?? null; }

// Reopen the exact full bundle and bind every preserved input byte available to this run. Preserved
// stages are never mutated. The local run/evidence tree is a trusted filesystem boundary (VSD-035);
// hashes detect drift and substitution inside that boundary, but do not authenticate a hostile writer.
export function loadReconciliationSources(runDir, workId) {
  const manifest = readJsonBound(join(runDir, 'run-manifest.json'));
  const standardWdir = join(runDir, 'works', sha256(workId).slice(0, 24));
  const standardB4Path = stagePath(runDir, workId, 'B4');
  const derivedB4Path = join(runDir, 'works', `${safeWorkId(workId)}.b4.json`);
  const derived = !existsSync(standardB4Path) && existsSync(derivedB4Path);
  const evidenceRunDir = derived ? manifest.value?.upstreamRun : runDir;
  if (!evidenceRunDir || (derived && !manifest.value?.sourceRun)) throw new Error('derived reconciliation run lacks sourceRun/upstreamRun ancestry');
  const evidenceManifest = derived ? readJsonBound(join(runDir, 'evidence-manifest.json')) : null;
  if (derived) {
    const declared = sha(evidenceManifest.value?.files || []);
    if (declared !== manifest.value.evidenceManifestSha256 || declared !== evidenceManifest.value?.evidenceManifestSha256) throw new Error('derived evidence manifest binding mismatch');
  }
  const evidenceWdir = join(evidenceRunDir, 'works', sha256(workId).slice(0, 24));
  const upstreamManifest = derived ? readJsonBound(join(evidenceRunDir, 'run-manifest.json')) : manifest;
  const b0 = readJsonBound(join(evidenceWdir, 'b0-prep.json'));
  const b1 = readJsonBound(stagePath(evidenceRunDir, workId, 'B1'));
  const b2 = readJsonBound(stagePath(evidenceRunDir, workId, 'B2'), false);
  const b3 = readJsonBound(stagePath(evidenceRunDir, workId, 'B3'), false);
  const b4 = readJsonBound(derived ? derivedB4Path : standardB4Path);
  const b4Body = derived ? b4.value?.body : bodyOf(b4);
  const recordWorkId = derived ? b4.value?.id : b4.value?.workId;
  if (recordWorkId && recordWorkId !== workId) throw new Error('B4 workId mismatch');
  let sourceB4 = null; let sourceB4TranscriptSha256 = null;
  if (derived) {
    const evidenceFiles = new Map((evidenceManifest.value?.files || []).map(f => [f.path, f]));
    const requireEvidenceFile = (bound, label) => {
      if (!bound?.path || !bound.sha256) return;
      const entry = evidenceFiles.get(bound.path);
      if (!entry || entry.sha256 !== bound.sha256 || (Number.isInteger(entry.bytes) && entry.bytes !== Buffer.byteLength(bound.raw))) {
        throw new Error(`derived ${label} is absent from or disagrees with evidence manifest`);
      }
    };
    const sourceRunManifest = readJsonBound(join(manifest.value.sourceRun, 'run-manifest.json'));
    sourceB4 = readJsonBound(join(manifest.value.sourceRun, 'works', `${safeWorkId(workId)}.b4.json`));
    for (const [bound, label] of [[sourceRunManifest, 'source-run manifest'], [upstreamManifest, 'upstream manifest'], [b0, 'B0'], [b1, 'B1'], [b2, 'B2'], [b3, 'B3'], [sourceB4, 'source B4']]) requireEvidenceFile(bound, label);
    const embedded = b4.value?.source || {};
    const expected = {
      b4RecordSha256: sourceB4.sha256, b0PrepSha256: b0.sha256,
      B1CompletionSha256: b1.sha256, B2CompletionSha256: b2.sha256, B3CompletionSha256: b3.sha256,
    };
    for (const [k, v] of Object.entries(expected)) if (embedded[k] !== v) throw new Error(`derived B4 ancestry mismatch: ${k}`);
    if (stableJson(sourceB4.value?.rawDelta) !== stableJson(b4.value?.rawDelta)) throw new Error('derived/source B4 delta mismatch');
    const assembled = assembleAndValidateB4({ delta: sourceB4.value.rawDelta, b1: bodyOf(b1), b2: bodyOf(b2), b3: bodyOf(b3), legacy: b0.value?.legacy });
    if (!assembled.ok || stableJson(assembled.body) !== stableJson(b4Body)) throw new Error(`derived B4 deterministic rehydration mismatch${assembled.errors?.length ? `: ${assembled.errors.join('|')}` : ''}`);
    const transcriptCandidates = [
      join(manifest.value.sourceRun, 'works', `${safeWorkId(workId)}.transcript.jsonl`),
      sourceB4.value?.from ? join('data/incoming/vision-calibration', sourceB4.value.from, 'works', `${safeWorkId(workId)}.b4.transcript.jsonl`) : null,
    ].filter(Boolean);
    const transcriptPath = transcriptCandidates.find(existsSync);
    if (sourceB4.value?.evidence?.transcriptSha256) {
      if (!transcriptPath) throw new Error('derived source B4 transcript missing');
      const transcript = readFileSync(transcriptPath, 'utf8');
      sourceB4TranscriptSha256 = sha256(transcript);
      if (sourceB4TranscriptSha256 !== sourceB4.value.evidence.transcriptSha256) throw new Error('derived source B4 transcript hash mismatch');
      if (sourceB4.value.evidence.apiKeySource !== 'none') throw new Error('derived source B4 apiKeySource must be none');
      // The transcript hash is authenticated transitively by the manifest-bound source-B4 record. Most source
      // transcripts are also direct evidence-manifest entries; the Harvard hydria transcript predates that rule.
    }
  }
  const artifactDir = derived ? join(runDir, 'reconciliation', safeWorkId(workId)) : join(standardWdir, 'reconciliation');
  return {
    runDir, workId, wdir: derived ? artifactDir : standardWdir, artifactDir, derived, evidenceRunDir, evidenceWdir,
    manifest: manifest.value, b0: b0.value, b1: bodyOf(b1), b2: bodyOf(b2), b3: bodyOf(b3), b4: b4Body,
    b4Completion: b4.value, b4Raw: b4.raw,
    sourceBindings: {
      runId: manifest.value?.runId ?? null,
      runKind: derived ? 'derived-offline' : 'stage-completion',
      workId,
      imageSha256: b0.value?.image?.imgSha256 ?? b4.value?.imgSha256 ?? null,
      manifestSha256: manifest.sha256,
      upstreamRunId: upstreamManifest.value?.runId ?? null,
      upstreamManifestSha256: upstreamManifest.sha256,
      evidenceManifestSha256: derived ? manifest.value.evidenceManifestSha256 : null,
      b0Sha256: b0.sha256,
      b1CompletionSha256: b1.sha256,
      b2CompletionSha256: b2.sha256,
      b3CompletionSha256: b3.sha256,
      b4CompletionSha256: b4.sha256,
      sourceB4RecordSha256: sourceB4?.sha256 ?? null,
      sourceB4TranscriptSha256,
      b4BodySha256: sha(b4Body),
      legacySnapshotSha256: sha(b0.value?.legacy ?? null),
    },
  };
}

function observationRows(b1, b2, b3) {
  const rows = [];
  for (const [axis, items] of Object.entries(b1?.evidence || {})) for (const item of items || []) {
    rows.push({ observationId: item.evidenceId, principal: 'B1', kind: 'visible-evidence', proposition: `${item.feature}: ${item.why}`, region: item.bbox ?? null, confidence: item.confidence, claimRefs: [] });
  }
  for (const item of b1?.visual?.delights || []) {
    rows.push({ observationId: item.delightId, principal: 'B1', kind: 'visible-detail', proposition: item.note, region: item.bbox ?? null, confidence: item.confidence, claimRefs: [] });
  }
  const requestById = new Map((b2?.targetedVerificationRequests || []).map(r => [r.requestId, r]));
  for (const item of b3?.verifications || []) {
    const request = requestById.get(item.requestId);
    rows.push({ observationId: `b3:${item.requestId}`, principal: 'B3', kind: item.found ? 'visual-confirmation' : 'visual-not-found', proposition: item.note, region: item.bbox ?? null, confidence: item.confidence, claimRefs: request?.claimId ? [request.claimId] : [] });
  }
  return rows;
}

function claimRows(b2, b4, sourceSpans) {
  const spansByClaim = new Map();
  for (const span of sourceSpans || []) {
    if (!spansByClaim.has(span.claimId)) spansByClaim.set(span.claimId, []);
    spansByClaim.get(span.claimId).push(span.sourceSpanId);
  }
  const rows = (b2?.factChecks || []).map(item => ({
    claimId: item.claimId,
    proposition: item.claim,
    kind: 'research-claim',
    entityRef: null,
    proposedVerdict: item.verdict,
    confidence: item.confidence,
    assertedBy: 'B2',
    sourceRefs: uniq((item.sources || []).map(s => s.sourceId)),
    sourceSpanRefs: spansByClaim.get(item.claimId) || [],
    observationRefs: [],
  }));
  let i = 0;
  for (const [category, corrections] of Object.entries(b4?.corrections || {})) for (const item of corrections || []) {
    const claimId = `b4-correction:${i++}`;
    rows.push({
      claimId,
      proposition: `${item.field}: replace ${JSON.stringify(item.from)} with ${JSON.stringify(item.to)}`,
      kind: 'correction-proposal', entityRef: null, proposedVerdict: category,
      confidence: item.confidence, assertedBy: 'B4',
      sourceRefs: uniq(item.sourceRefs || []), sourceSpanRefs: spansByClaim.get(claimId) || [],
      observationRefs: item.evidenceRef ? [item.evidenceRef] : [],
      correction: { field: item.field, from: item.from, to: item.to },
    });
  }
  return rows;
}

function sourceClaimIndex(claims) {
  const out = new Map();
  for (const claim of claims) for (const ref of claim.sourceRefs || []) {
    if (!out.has(ref)) out.set(ref, []);
    out.get(ref).push(claim.claimId);
  }
  return out;
}
function claimsForSources(index, refs) { return uniq((refs || []).flatMap(r => index.get(r) || [])); }
function itemGrounding(item, sourceIndex) {
  const observationRefs = item?.evidenceRef ? [item.evidenceRef] : [];
  const claimRefs = claimsForSources(sourceIndex, item?.sourceRefs || []);
  const explicit = Array.isArray(item?.claimRefs) || Array.isArray(item?.observationRefs);
  return {
    claimRefs: explicit ? uniq(item.claimRefs || []) : claimRefs,
    observationRefs: explicit ? uniq(item.observationRefs || []) : observationRefs,
    groundingMode: explicit ? 'explicit' : ((claimRefs.length || observationRefs.length) ? 'inferred' : 'unmapped'),
    groundingAuthority: explicit ? 'model-proposal' : ((claimRefs.length || observationRefs.length) ? 'controller-inference' : 'none'),
    groundingArtifactRef: null,
  };
}
function component(surface, componentId, value, grounding = {}) {
  return {
    componentId, surface,
    contentSha256: sha(value),
    claimRefs: uniq(grounding.claimRefs || []),
    observationRefs: uniq(grounding.observationRefs || []),
    groundingMode: grounding.groundingMode || 'unmapped',
    groundingAuthority: grounding.groundingAuthority || 'none',
    groundingArtifactRef: grounding.groundingArtifactRef || null,
  };
}

// Stable IDs use controller-owned B4 ids where available. Current cues lack ids; their index identity is
// recorded as unstable and therefore cannot auto-qualify under policy /1.
function componentRows(b4, projectedRecord, sourceIndex) {
  const teach = projectedRecord?.teach || {};
  const hotspots = projectedRecord?.hotspots || [];
  const rows = [];
  rows.push(component('why', teach.why == null ? 'why:empty' : 'why', teach.why ?? null));
  (teach.cues || []).forEach((v, i) => rows.push(component('cues', `cue:${i}`, v)));
  if (!(teach.cues || []).length) rows.push(component('cues', 'cue-set:empty', []));
  (teach.notes || []).forEach((v, i) => {
    const src = b4?.notes?.[i] || {};
    rows.push(component('notes', `note:${src.noteId || i}`, v, itemGrounding(src, sourceIndex)));
  });
  if (!(teach.notes || []).length) rows.push(component('notes', 'note-set:empty', []));
  (hotspots || []).forEach((v, i) => {
    const src = b4?.hotspots?.[i] || {};
    rows.push(component('hotspots', `hotspot:${src.hotspotId || i}`, v, itemGrounding(src, sourceIndex)));
  });
  if (!hotspots.length) rows.push(component('hotspots', 'hotspot-set:empty', []));
  (teach.guide || []).forEach((v, i) => {
    const src = b4?.guide?.[i] || {};
    rows.push(component('guide', `guide:${src.questionId || i}`, v, itemGrounding(src, sourceIndex)));
  });
  if (!(teach.guide || []).length) rows.push(component('guide', 'guide-set:empty', []));
  return rows;
}

function fieldComponents(field, components) {
  const tokens = String(field || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const aliases = new Map([['hotspot', 'hotspots'], ['hotspots', 'hotspots'], ['note', 'notes'], ['notes', 'notes'], ['guide', 'guide'], ['cue', 'cues'], ['cues', 'cues'], ['why', 'why']]);
  const matches = uniq(tokens.map(t => aliases.get(t)).filter(Boolean));
  const surface = matches.length === 1 ? matches[0] : null;
  return surface ? components.filter(c => c.surface === surface).map(c => c.componentId) : [];
}

export function buildClaimBundle({ sources, projectedRecord, sourceSpans = [], entityGraph = null }) {
  if (!sources?.workId || !projectedRecord) throw new Error('sources + projectedRecord required');
  if (entityGraph) {
    const ev = validateEntityGraph(entityGraph);
    if (!ev.ok) throw new Error(`invalid entity graph: ${ev.errors.join('|')}`);
  }
  const claims = claimRows(sources.b2, sources.b4, sourceSpans);
  const observations = observationRows(sources.b1, sources.b2, sources.b3);
  // Attach B3 observations to their target claim without allowing B3 to decide named identity.
  const obsByClaim = new Map();
  for (const o of observations) for (const c of o.claimRefs || []) {
    if (!obsByClaim.has(c)) obsByClaim.set(c, []);
    obsByClaim.get(c).push(o.observationId);
  }
  for (const c of claims) c.observationRefs = obsByClaim.get(c.claimId) || [];
  const components = componentRows(sources.b4, projectedRecord, sourceClaimIndex(claims));
  const conflicts = (sources.b4?.conflicts || []).map((c, i) => ({
    conflictId: `b4-conflict:${i}`,
    claimRefs: [],
    componentRefs: fieldComponents(c.field, components),
    workScope: fieldComponents(c.field, components).length === 0,
    left: c.left,
    right: c.right,
    modelStatus: c.status,
    resolutionProposal: c.resolution || '',
  }));
  const openClaims = sources.b4?.uncertainty ? [{
    openClaimId: 'b4-uncertainty:0', proposition: sources.b4.uncertainty,
    componentRefs: [], workScope: true, modelStatus: 'open',
  }] : [];
  return {
    version: CLAIM_BUNDLE_VERSION,
    policyVersion: RECONCILIATION_POLICY_VERSION,
    workId: sources.workId,
    imageSha256: sources.sourceBindings.imageSha256,
    sourceBindings: sources.sourceBindings,
    projectedRecordSha256: sha(projectedRecord),
    sourceSpans,
    entityGraphVersion: entityGraph?.version ?? null,
    entityUncertainty: entityGraph?.uncertainty ?? '',
    regions: entityGraph?.regions || [],
    entities: entityGraph?.entities || [],
    observations,
    claimAssertions: claims,
    components,
    conflicts,
    openClaims,
  };
}

export function validateClaimBundle(bundle) {
  const errors = [];
  const need = (v, m) => { if (!v) errors.push(m); };
  need(obj(bundle) && bundle.version === CLAIM_BUNDLE_VERSION, 'bad bundle version');
  if (!obj(bundle)) return { ok: false, errors };
  need(text(bundle.workId, 500), 'workId');
  need(SHA.test(bundle.imageSha256 || ''), 'imageSha256');
  need(obj(bundle.sourceBindings), 'sourceBindings');
  need(SHA.test(bundle.projectedRecordSha256 || ''), 'projectedRecordSha256');
  need(bundle.entityGraphVersion === null || typeof bundle.entityGraphVersion === 'string', 'entityGraphVersion');
  need(typeof bundle.entityUncertainty === 'string' && bundle.entityUncertainty.length <= 2000, 'entityUncertainty');
  for (const k of ['sourceSpans', 'regions', 'entities', 'observations', 'claimAssertions', 'components', 'conflicts', 'openClaims']) need(Array.isArray(bundle[k]), `${k} array`);
  const spanIds = new Set(), observationIds = new Set(), claimIds = new Set(), componentIds = new Set(), entityIds = new Set(), regionIds = new Set();
  for (const r of bundle.regions || []) { need(obj(r) && ID.test(r.regionId || ''), 'region shape'); if (r?.regionId) { need(!regionIds.has(r.regionId), `duplicate region ${r.regionId}`); regionIds.add(r.regionId); } }
  for (const e of bundle.entities || []) { need(obj(e) && ID.test(e.entityId || '') && Array.isArray(e.regionRefs), 'entity shape'); if (e?.entityId) { need(!entityIds.has(e.entityId), `duplicate entity ${e.entityId}`); entityIds.add(e.entityId); } }
  for (const s of bundle.sourceSpans || []) { need(obj(s) && ID.test(s.sourceSpanId || '') && ID.test(s.claimId || '') && ID.test(s.sourceId || '') && text(s.excerpt, 2000) && SHA.test(s.retrievedContentSha256 || ''), 'source span shape'); if (s?.sourceSpanId) { need(!spanIds.has(s.sourceSpanId), `duplicate span ${s.sourceSpanId}`); spanIds.add(s.sourceSpanId); } }
  for (const o of bundle.observations || []) { need(obj(o) && ID.test(o.observationId || '') && ['B1', 'B3', 'owner'].includes(o.principal) && text(o.proposition), 'observation shape'); if (o?.observationId) { need(!observationIds.has(o.observationId), `duplicate observation ${o.observationId}`); observationIds.add(o.observationId); } }
  for (const c of bundle.claimAssertions || []) { need(obj(c) && ID.test(c.claimId || '') && text(c.proposition) && ['B1', 'B2', 'B3', 'B4', 'owner'].includes(c.assertedBy), 'claim shape'); if (c?.claimId) { need(!claimIds.has(c.claimId), `duplicate claim ${c.claimId}`); claimIds.add(c.claimId); } }
  for (const c of bundle.components || []) {
    need(obj(c) && ID.test(c.componentId || '') && COMPONENT_SURFACES.includes(c.surface) && SHA.test(c.contentSha256 || '')
      && ['explicit', 'inferred', 'unmapped'].includes(c.groundingMode)
      && ['owner', 'controller', 'model-proposal', 'controller-inference', 'none'].includes(c.groundingAuthority), 'component shape');
    if (['owner', 'controller'].includes(c?.groundingAuthority)) need(text(c.groundingArtifactRef, 1000), `effective grounding needs artifactRef: ${c?.componentId}`);
    if (c?.componentId) { need(!componentIds.has(c.componentId), `duplicate component ${c.componentId}`); componentIds.add(c.componentId); }
  }
  for (const e of bundle.entities || []) for (const ref of e.regionRefs || []) need(regionIds.has(ref), `entity region ref missing: ${ref}`);
  if (bundle.entityGraphVersion !== null || (bundle.regions || []).length || (bundle.entities || []).length || bundle.entityUncertainty) {
    const ev = validateEntityGraph({ version: bundle.entityGraphVersion, regions: bundle.regions || [], entities: bundle.entities || [], uncertainty: bundle.entityUncertainty || '' });
    if (!ev.ok) errors.push(...ev.errors.map(e => `entity graph: ${e}`));
  }
  for (const s of bundle.sourceSpans || []) need(claimIds.has(s.claimId), `span claim ref missing: ${s.claimId}`);
  const claimById = new Map((bundle.claimAssertions || []).map(c => [c.claimId, c]));
  for (const s of bundle.sourceSpans || []) {
    const claim = claimById.get(s.claimId);
    need((claim?.sourceRefs || []).includes(s.sourceId), `span source is not cited by claim ${s.claimId}: ${s.sourceId}`);
  }
  for (const c of bundle.claimAssertions || []) {
    for (const ref of c.sourceSpanRefs || []) need(spanIds.has(ref), `claim sourceSpan ref missing: ${ref}`);
    for (const ref of c.observationRefs || []) need(observationIds.has(ref), `claim observation ref missing: ${ref}`);
    need(c.entityRef == null || entityIds.has(c.entityRef), `claim entity ref missing: ${c.entityRef}`);
    // No-image B2 may not choose a pixel entity. A later controller-carried binding must be represented by
    // an observation reference; otherwise the identity remains unbound.
    if (c.assertedBy === 'B2' && c.entityRef != null) need((c.observationRefs || []).length > 0, `B2 entity claim lacks controller-carried observation: ${c.claimId}`);
  }
  for (const c of bundle.components || []) {
    for (const ref of c.claimRefs || []) need(claimIds.has(ref), `component claim ref missing: ${ref}`);
    for (const ref of c.observationRefs || []) need(observationIds.has(ref), `component observation ref missing: ${ref}`);
  }
  for (const x of bundle.conflicts || []) {
    need(obj(x) && ID.test(x.conflictId || '') && Array.isArray(x.claimRefs) && Array.isArray(x.componentRefs) && typeof x.workScope === 'boolean', 'conflict shape');
    for (const ref of x.claimRefs || []) need(claimIds.has(ref), `conflict claim ref missing: ${ref}`);
    for (const ref of x.componentRefs || []) need(componentIds.has(ref), `conflict component ref missing: ${ref}`);
  }
  for (const x of bundle.openClaims || []) {
    need(obj(x) && ID.test(x.openClaimId || '') && text(x.proposition) && Array.isArray(x.componentRefs) && typeof x.workScope === 'boolean', 'open claim shape');
    for (const ref of x.componentRefs || []) need(componentIds.has(ref), `open claim component ref missing: ${ref}`);
  }
  return { ok: errors.length === 0, errors };
}

export function buildDecisionArtifact({ workId, claimBundleSha256, decisions = [], blockedFindingResolutions = [] }) {
  return { version: CLAIM_DECISIONS_VERSION, workId, claimBundleSha256, decisions, blockedFindingResolutions };
}
export function validateDecisionArtifact(artifact, bundle) {
  const errors = [];
  const need = (v, m) => { if (!v) errors.push(m); };
  need(obj(artifact) && artifact.version === CLAIM_DECISIONS_VERSION, 'bad decisions version');
  if (!obj(artifact)) return { ok: false, errors };
  need(artifact.workId === bundle.workId, 'decision workId mismatch');
  need(artifact.claimBundleSha256 === sha(bundle), 'decision bundle binding mismatch');
  need(Array.isArray(artifact.decisions), 'decisions array');
  need(Array.isArray(artifact.blockedFindingResolutions), 'blockedFindingResolutions array');
  const claimIds = new Set(bundle.claimAssertions.map(c => c.claimId));
  const componentIds = new Set(bundle.components.map(c => c.componentId));
  const conflictsById = new Map(bundle.conflicts.map(c => [c.conflictId, c]));
  const seen = new Map(); const decisionIds = new Set();
  const authorityRank = { controller: 0, 'authoritative-source': 1, owner: 2 };
  for (const d of artifact.decisions || []) {
    need(obj(d) && ID.test(d.decisionId || '') && ['claim', 'component'].includes(d.targetKind) && ID.test(d.targetId || '') && EFFECTIVE_STATES.includes(d.effectiveState) && DECISION_AUTHORITIES.includes(d.authority) && text(d.artifactRef, 1000), 'decision shape');
    if (!obj(d)) continue;
    need(!decisionIds.has(d.decisionId), `duplicate decisionId ${d.decisionId}`); decisionIds.add(d.decisionId);
    need(d.targetKind === 'claim' ? claimIds.has(d.targetId) : componentIds.has(d.targetId), `decision target missing ${d.targetId}`);
    if (d.authority === 'controller' && d.effectiveState === 'accepted') need(false, `controller cannot accept semantic content under policy /1: ${d.targetId}`);
    // A source adjudicates an atomic sourced claim; it does not directly approve finished player copy.
    // Direct component acceptance is an owner act. This prevents a source-looking artifactRef from becoming
    // a semantic bypass around claim grounding and exact source spans.
    if (d.authority === 'authoritative-source' && d.targetKind === 'component' && d.effectiveState === 'accepted') need(false, `authoritative source cannot directly accept a component: ${d.targetId}`);
    if (d.authority === 'authoritative-source' && d.targetKind === 'claim' && d.effectiveState === 'accepted') {
      const claim = bundle.claimAssertions.find(c => c.claimId === d.targetId);
      need((claim?.sourceSpanRefs || []).length > 0, `authoritative source acceptance requires an exact source span: ${d.targetId}`);
    }
    const resolvedConflictIds = d.resolvesConflictIds ?? [];
    need(Array.isArray(resolvedConflictIds) && resolvedConflictIds.every(id => ID.test(id) && conflictsById.has(id))
      && uniq(resolvedConflictIds).length === resolvedConflictIds.length, `decision conflict refs invalid: ${d.decisionId}`);
    if (d.authority === 'owner' && d.targetKind === 'component' && d.effectiveState === 'accepted') {
      const applicable = bundle.conflicts.filter(c => c.workScope || c.componentRefs.includes(d.targetId)).map(c => c.conflictId);
      need(applicable.every(id => resolvedConflictIds.includes(id)), `owner component acceptance does not resolve every applicable conflict: ${d.targetId}`);
    }
    const key = `${d.targetKind}:${d.targetId}`;
    if (seen.has(key)) {
      const prior = seen.get(key);
      need(d.supersedesDecisionId === prior.decisionId, `non-append transition for ${key}`);
      need(authorityRank[d.authority] >= authorityRank[prior.authority], `lower authority cannot supersede ${prior.authority} decision for ${key}`);
    }
    else need(d.supersedesDecisionId == null, `first decision cannot supersede for ${key}`);
    seen.set(key, d);
  }
  const findingIds = new Set();
  for (const r of artifact.blockedFindingResolutions || []) {
    need(obj(r) && ID.test(r.findingId || '') && ['owner', 'authoritative-source'].includes(r.authority)
      && r.freshRun === true && text(r.artifactRef, 1000) && Array.isArray(r.resolvedClaims) && r.resolvedClaims.length > 0,
    'blocked finding resolution shape');
    if (!obj(r)) continue;
    need(!findingIds.has(r.findingId), `duplicate blocked finding resolution ${r.findingId}`); findingIds.add(r.findingId);
    const claims = (r.resolvedClaims || []).map(c => c?.claim);
    need(claims.every(c => text(c, 2000)) && uniq(claims).length === claims.length, `blocked finding resolution claims invalid ${r.findingId}`);
  }
  return { ok: errors.length === 0, errors };
}

function latestDecisionMap(artifact) {
  const out = new Map();
  for (const d of artifact?.decisions || []) out.set(`${d.targetKind}:${d.targetId}`, d);
  return out;
}
function severity(rows) { return !rows.length ? 'review-required' : rows.includes('blocked') ? 'blocked' : rows.includes('review-required') ? 'review-required' : 'eligible'; }

export function auditReconciliation(bundle, decisionsArtifact = buildDecisionArtifact({ workId: bundle.workId, claimBundleSha256: sha(bundle), decisions: [] })) {
  const bv = validateClaimBundle(bundle);
  const dv = bv.ok ? validateDecisionArtifact(decisionsArtifact, bundle) : { ok: false, errors: ['bundle invalid'] };
  if (!bv.ok || !dv.ok) return { ok: false, errors: [...bv.errors, ...dv.errors], report: null };
  const decisions = latestDecisionMap(decisionsArtifact);
  const violations = [];
  const conflictBlocked = new Set(); let workBlocked = false;
  for (const x of bundle.conflicts) {
    if (x.workScope) workBlocked = true;
    x.componentRefs.forEach(id => conflictBlocked.add(id));
    violations.push({ code: x.modelStatus === 'resolved' ? 'model-self-resolution-ignored' : 'unresolved-conflict', conflictId: x.conflictId, componentRefs: x.componentRefs, severity: 'blocked' });
  }
  const concernReview = new Set(); let workReview = false;
  for (const x of bundle.openClaims) {
    if (x.workScope) workReview = true;
    x.componentRefs.forEach(id => concernReview.add(id));
    violations.push({ code: 'open-model-uncertainty', openClaimId: x.openClaimId, componentRefs: x.componentRefs, severity: 'review-required' });
  }
  const claimStates = bundle.claimAssertions.map(c => {
    const d = decisions.get(`claim:${c.claimId}`);
    const effectiveState = d?.effectiveState || 'unresolved';
    if (!c.sourceSpanRefs.length && c.proposedVerdict !== 'unresolved') violations.push({ code: 'source-entailment-unverifiable', claimId: c.claimId, severity: 'review-required' });
    if (c.entityRef == null && /identity|attribution|role/i.test(c.kind || '')) violations.push({ code: 'unbound-entity-claim', claimId: c.claimId, severity: 'review-required' });
    return { claimId: c.claimId, proposedVerdict: c.proposedVerdict, effectiveState, decidedBy: d ? { authority: d.authority, artifactRef: d.artifactRef, decisionId: d.decisionId } : null };
  });
  const stateByClaim = new Map(claimStates.map(c => [c.claimId, c.effectiveState]));
  const componentReadiness = bundle.components.map(c => {
    const explicit = decisions.get(`component:${c.componentId}`);
    const reasons = [];
    let contentReadiness;
    // An exact owner decision is allowed to adjudicate the exact bound component even when an inherited
    // B4 conflict is too coarse to map. Model/source proposals cannot do this. The conflict remains visible
    // in the report; only the reviewed component is released.
    if (explicit?.authority === 'owner' && explicit.effectiveState === 'accepted') {
      contentReadiness = 'eligible'; reasons.push('effective-component-decision:accepted');
    } else if (workBlocked || conflictBlocked.has(c.componentId)) { contentReadiness = 'blocked'; reasons.push('unresolved-conflict'); }
    else if (explicit?.authority === 'owner') {
      contentReadiness = explicit.effectiveState === 'unresolved' ? 'review-required' : 'blocked';
      reasons.push(`effective-component-decision:${explicit.effectiveState}`);
    }
    else if (workReview || concernReview.has(c.componentId)) { contentReadiness = 'review-required'; reasons.push('open-model-uncertainty'); }
    else if (explicit) {
      contentReadiness = explicit.effectiveState === 'unresolved' ? 'review-required' : 'blocked';
      reasons.push(`non-owner-component-decision:${explicit.effectiveState}`);
    } else {
      const states = c.claimRefs.map(id => stateByClaim.get(id) || 'unresolved');
      if (states.some(s => s === 'rejected' || s === 'disputed')) { contentReadiness = 'blocked'; reasons.push('rejected-or-disputed-claim'); }
      else if (c.groundingMode !== 'explicit' || !['owner', 'controller'].includes(c.groundingAuthority)) { contentReadiness = 'review-required'; reasons.push(`${c.groundingAuthority}-${c.groundingMode}-grounding`); }
      else if (!c.claimRefs.length) { contentReadiness = 'review-required'; reasons.push('no-atomic-claim'); }
      else if (states.every(s => s === 'accepted')) { contentReadiness = 'eligible'; reasons.push('all-explicit-claims-accepted'); }
      else { contentReadiness = 'review-required'; reasons.push('claim-decision-required'); }
    }
    if (!explicit && c.surface === 'cues' && /^cue:\d+$/.test(c.componentId)) { if (contentReadiness === 'eligible') contentReadiness = 'review-required'; reasons.push('component-identity-unstable'); }
    if (contentReadiness !== 'eligible') violations.push({ code: reasons[0], componentId: c.componentId, severity: contentReadiness });
    return { componentId: c.componentId, surface: c.surface, contentSha256: c.contentSha256, claimRefs: c.claimRefs, observationRefs: c.observationRefs, groundingMode: c.groundingMode, groundingAuthority: c.groundingAuthority, contentReadiness, reasons };
  });
  const contentReadiness = severity(componentReadiness.map(c => c.contentReadiness));
  const reportCore = {
    version: RECONCILIATION_REPORT_VERSION,
    policyVersion: RECONCILIATION_POLICY_VERSION,
    workId: bundle.workId,
    sourceBindings: bundle.sourceBindings,
    claimBundleSha256: sha(bundle),
    decisionsSha256: sha(decisionsArtifact),
    projectedRecordSha256: bundle.projectedRecordSha256,
    contentReadiness,
    claimStates,
    componentReadiness,
    violations,
  };
  return { ok: true, errors: [], report: { ...reportCore, reportSha256: sha(reportCore) } };
}

export function verifyReconciliationReport(report, bundle, decisionsArtifact) {
  const fresh = auditReconciliation(bundle, decisionsArtifact);
  if (!fresh.ok) return fresh;
  const ok = stableJson(report) === stableJson(fresh.report);
  return { ok, errors: ok ? [] : ['reconciliation report stale or tampered'], report: fresh.report };
}

// Bind a stored graph to the reopened preserved stages and the exact projected production record. Source spans
// and a versioned entity graph are explicit enrichment inputs; source-derived components, conflicts, claims,
// observations, corrections, and uncertainty must otherwise agree exactly. Effective owner/controller grounding
// belongs in the decision layer, never in a forged claim-bundle component.
export function verifyClaimBundleAgainstSources(bundle, sources, projectedRecord) {
  const errors = [];
  const val = validateClaimBundle(bundle);
  if (!val.ok) errors.push(...val.errors);
  if (stableJson(bundle.sourceBindings) !== stableJson(sources.sourceBindings)) errors.push('bundle source bindings stale or tampered');
  if (bundle.projectedRecordSha256 !== sha(projectedRecord)) errors.push('bundle projected record binding mismatch');
  const entityGraph = bundle.entityGraphVersion ? { version: bundle.entityGraphVersion, regions: bundle.regions || [], entities: bundle.entities || [], uncertainty: bundle.entityUncertainty || '' } : null;
  const derived = buildClaimBundle({ sources, projectedRecord, sourceSpans: bundle.sourceSpans || [], entityGraph });
  if (stableJson(bundle.components || []) !== stableJson(derived.components)) errors.push('bundle component identity/content/grounding mismatch');
  if (stableJson(bundle.conflicts || []) !== stableJson(derived.conflicts || [])) errors.push('B4 conflicts omitted or altered');
  const claimCore = c => ({
    claimId: c.claimId, proposition: c.proposition, kind: c.kind, entityRef: c.entityRef,
    proposedVerdict: c.proposedVerdict, confidence: c.confidence, assertedBy: c.assertedBy,
    sourceRefs: c.sourceRefs, sourceSpanRefs: c.sourceSpanRefs, observationRefs: c.observationRefs,
  });
  const derivedB2 = new Map(derived.claimAssertions.filter(c => c.assertedBy === 'B2').map(c => [c.claimId, c]));
  const bundledB2 = new Map((bundle.claimAssertions || []).filter(c => c.assertedBy === 'B2').map(c => [c.claimId, c]));
  for (const [id, expected] of derivedB2) if (!bundledB2.has(id) || stableJson(claimCore(bundledB2.get(id))) !== stableJson(claimCore(expected))) errors.push(`B2 claim missing or core assertion mismatch: ${id}`);
  for (const [id] of bundledB2) if (!derivedB2.has(id)) errors.push(`invented B2 claim: ${id}`);
  const derivedB4 = new Map(derived.claimAssertions.filter(c => c.assertedBy === 'B4').map(c => [c.claimId, c]));
  const bundledB4 = new Map((bundle.claimAssertions || []).filter(c => c.assertedBy === 'B4').map(c => [c.claimId, c]));
  for (const [id, expected] of derivedB4) if (!bundledB4.has(id) || stableJson(bundledB4.get(id)) !== stableJson(expected)) errors.push(`B4 correction proposal missing or core assertion mismatch: ${id}`);
  for (const [id] of bundledB4) if (!derivedB4.has(id)) errors.push(`invented B4 correction proposal: ${id}`);
  if (stableJson(bundle.openClaims || []) !== stableJson(derived.openClaims || [])) errors.push('B4 uncertainty omitted or altered');
  if (stableJson(bundle.observations || []) !== stableJson(derived.observations || [])) errors.push('preserved observations omitted, altered, or invented');
  return { ok: errors.length === 0, errors };
}

export function reconciliationPaths(sources) {
  const dir = sources.artifactDir || join(sources.wdir, 'reconciliation');
  return { dir, active: join(dir, 'active.json'), sets: join(dir, 'sets'), activations: join(dir, 'activations'), templates: join(dir, 'templates') };
}
export function reconciliationSetPaths(sources, reportSha256) {
  if (!SHA.test(reportSha256 || '')) throw new Error('report SHA required for reconciliation set');
  const base = reconciliationPaths(sources);
  const dir = join(base.sets, reportSha256);
  return { ...base, setDir: dir, bundle: join(dir, 'claim-bundle.json'), decisions: join(dir, 'decisions.json'), report: join(dir, 'report.json') };
}
export function buildReconciliationActivation(report) {
  const core = {
    version: RECONCILIATION_ACTIVE_VERSION, workId: report.workId,
    reportSha256: report.reportSha256, claimBundleSha256: report.claimBundleSha256,
    decisionsSha256: report.decisionsSha256, projectedRecordSha256: report.projectedRecordSha256,
  };
  return { ...core, activationSha256: sha(core) };
}
function validateActivation(active, sources) {
  const errors = [];
  if (!obj(active) || active.version !== RECONCILIATION_ACTIVE_VERSION) return { ok: false, errors: ['bad reconciliation activation version'] };
  if (active.workId !== sources.workId) errors.push('activation workId mismatch');
  for (const k of ['reportSha256', 'claimBundleSha256', 'decisionsSha256', 'projectedRecordSha256', 'activationSha256']) if (!SHA.test(active[k] || '')) errors.push(`activation ${k}`);
  const { activationSha256, ...core } = active;
  if (activationSha256 !== sha(core)) errors.push('activation hash mismatch');
  return { ok: errors.length === 0, errors };
}

export function loadAndVerifyReconciliation({ sources, projectedRecord }) {
  const base = reconciliationPaths(sources);
  if (!existsSync(base.active)) return { ok: false, errors: [`reconciliation activation missing: ${base.active}`], paths: base };
  let activation;
  try { activation = JSON.parse(readFileSync(base.active, 'utf8')); }
  catch (e) { return { ok: false, errors: [`reconciliation activation parse failed: ${e.message}`], paths: base }; }
  const av = validateActivation(activation, sources);
  if (!av.ok) return { ok: false, errors: av.errors, activation, paths: base };
  const activationPath = join(base.activations, `${activation.activationSha256}.json`);
  if (!existsSync(activationPath)) return { ok: false, errors: [`reconciliation activation history missing: ${activationPath}`], activation, paths: base };
  try {
    const historical = JSON.parse(readFileSync(activationPath, 'utf8'));
    if (stableJson(historical) !== stableJson(activation)) return { ok: false, errors: ['active reconciliation pointer disagrees with activation history'], activation, paths: base };
  } catch (e) { return { ok: false, errors: [`reconciliation activation history parse failed: ${e.message}`], activation, paths: base }; }
  const paths = reconciliationSetPaths(sources, activation.reportSha256);
  for (const p of [paths.bundle, paths.decisions, paths.report]) if (!existsSync(p)) return { ok: false, errors: [`reconciliation artifact missing: ${p}`], activation, paths };
  let bundle, decisions, report;
  try {
    bundle = JSON.parse(readFileSync(paths.bundle, 'utf8'));
    decisions = JSON.parse(readFileSync(paths.decisions, 'utf8'));
    report = JSON.parse(readFileSync(paths.report, 'utf8'));
  } catch (e) { return { ok: false, errors: [`reconciliation artifact parse failed: ${e.message}`], paths }; }
  const bound = verifyClaimBundleAgainstSources(bundle, sources, projectedRecord);
  const verified = bound.ok ? verifyReconciliationReport(report, bundle, decisions) : { ok: false, errors: [] };
  const activationErrors = [];
  if (report.reportSha256 !== activation.reportSha256 || report.claimBundleSha256 !== activation.claimBundleSha256
    || report.decisionsSha256 !== activation.decisionsSha256 || report.projectedRecordSha256 !== activation.projectedRecordSha256) activationErrors.push('activation/report binding mismatch');
  return { ok: bound.ok && verified.ok && !activationErrors.length, errors: [...bound.errors, ...(verified.errors || []), ...activationErrors], bundle, decisions, report, activation, paths };
}

export function eligibleComponentIds(report, approvedFields) {
  const fields = new Set(approvedFields || []);
  return report.componentReadiness.filter(c => fields.has(c.surface) && c.contentReadiness === 'eligible').map(c => c.componentId);
}
export function ineligibleApprovedComponents(report, approvedFields) {
  const fields = new Set(approvedFields || []);
  const rows = report.componentReadiness.filter(c => fields.has(c.surface) && c.contentReadiness !== 'eligible');
  for (const field of fields) if (!report.componentReadiness.some(c => c.surface === field)) rows.push({ componentId: `missing:${field}`, surface: field, contentReadiness: 'blocked', reasons: ['approved-surface-has-no-bound-component'] });
  return rows;
}

export const claimBundleSha256 = bundle => sha(bundle);
export const decisionArtifactSha256 = artifact => sha(artifact);
