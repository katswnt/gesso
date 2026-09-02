import { createHash } from 'node:crypto';

export const LEGACY_VISION_VERSION = 'contentVisionEnrichment-legacy/1';

// Every historical top-level field must remain listed here. The audit fails when a
// new/forgotten field appears, even though the untouched raw record is also retained.
export const LEGACY_VISION_FIELD_MAP = Object.freeze({
  seen: 'passB.visible.seen',
  evidence: 'passB.visible.evidence',
  pins: 'passB.teaching.hotspotCandidates',
  palette: 'passB.visible.palette',
  format: 'passB.visible.format',
  figures: 'passB.visible.figures',
  pose: 'passB.visible.pose',
  delights: 'passB.visible.delights',
  signature: 'passB.visible.signature',
  condition: 'passB.visible.condition',
  artifacts: 'passB.visible.photoArtifacts',
  image_quality: 'passB.imageFitness.legacyQualityDescription',
  movement_suggestion: 'passB.researchCandidates.movementSuggestion',
  notes: 'passB.teaching.legacyBundle',
  recognized: 'passA.legacy.modelRecognizedFull',
  guessability: 'passA.legacy.guessability',
});

export const LEGACY_EVIDENCE_AXES = Object.freeze([
  'when', 'where', 'medium', 'style', 'artist', 'format',
]);

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

export function legacyEvidenceId(workId, field, index = 0) {
  return `legacy_${sha256({ workId, field, index }).slice(0, 24)}`;
}

export function legacyValueShape(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (plainObject(value)) return `object{${Object.keys(value).sort().join(',')}}`;
  return typeof value;
}

function normalizeEvidence(workId, evidence) {
  const out = {};
  for (const axis of LEGACY_EVIDENCE_AXES) {
    out[axis] = (Array.isArray(evidence?.[axis]) ? evidence[axis] : []).map((item, index) => ({
      id: legacyEvidenceId(workId, `evidence.${axis}`, index),
      feature: item.feature,
      why: item.why,
      bbox: clone(item.bbox),
      confidence: null,
      legacyRaw: clone(item),
    }));
  }
  return out;
}

function normalizePalette(value) {
  if (Array.isArray(value)) return { colors: clone(value), character: null, legacyShape: 'array' };
  if (plainObject(value)) return {
    colors: Array.isArray(value.hex) ? clone(value.hex) : [],
    character: typeof value.tone === 'string' ? value.tone : null,
    legacyShape: 'object',
  };
  return { colors: [], character: null, legacyShape: legacyValueShape(value) };
}

function normalizeFigures(value) {
  if (plainObject(value)) return {
    count: typeof value.count === 'number' ? value.count : null,
    description: typeof value.who === 'string' ? value.who : null,
    legacyShape: 'object',
  };
  if (typeof value === 'number') return { count: value, description: null, legacyShape: 'number' };
  if (typeof value === 'string') return { count: null, description: value, legacyShape: 'string' };
  return { count: null, description: null, legacyShape: legacyValueShape(value) };
}

export function normalizeLegacyVisionRecord(workId, record) {
  if (typeof workId !== 'string' || !workId) throw new Error('legacy vision workId must be non-empty');
  if (!plainObject(record)) throw new Error(`${workId}: legacy vision record must be an object`);

  const raw = clone(record);
  const pins = (Array.isArray(record.pins) ? record.pins : []).map((pin, index) => ({
    id: legacyEvidenceId(workId, 'pins', index),
    x: typeof pin.x === 'number' ? pin.x * 100 : null,
    y: typeof pin.y === 'number' ? pin.y * 100 : null,
    rank: index + 1,
    conciseText: pin.label,
    role: null,
    confidence: null,
    legacyRaw: clone(pin),
  }));
  const delights = (Array.isArray(record.delights) ? record.delights : []).map((item, index) => ({
    id: legacyEvidenceId(workId, 'delights', index),
    note: item.label,
    bbox: clone(item.bbox),
    confidence: null,
    legacyRaw: clone(item),
  }));

  return {
    version: LEGACY_VISION_VERSION,
    workId,
    source: {
      artifact: 'data/vision.js',
      recordSha256: sha256(raw),
      status: 'legacyEvidence',
      evidenceAxes: Object.keys(record.evidence || {}),
    },
    shapes: Object.fromEntries(Object.entries(record).map(([field, value]) => [field, legacyValueShape(value)])),
    passB: {
      visible: {
        seen: record.seen ?? null,
        evidence: normalizeEvidence(workId, record.evidence),
        palette: normalizePalette(record.palette),
        format: record.format ?? null,
        figures: normalizeFigures(record.figures),
        pose: record.pose ?? null,
        delights,
        signature: clone(record.signature ?? null),
        condition: record.condition ?? null,
        photoArtifacts: record.artifacts ?? null,
      },
      imageFitness: { legacyQualityDescription: record.image_quality ?? null },
      teaching: {
        hotspotCandidates: pins,
        // Historical `notes` is an object {why,cues,guide} on 12 records. It is
        // deliberately not coerced into noteCandidates[].
        legacyBundle: clone(record.notes ?? null),
      },
      researchCandidates: { movementSuggestion: record.movement_suggestion ?? null },
    },
    passA: {
      legacy: {
        modelRecognizedFull: record.recognized ?? null,
        guessability: clone(record.guessability ?? null),
      },
    },
    // This is the lossless rollback source. Projections above are queryable migration
    // aids; they never replace or reinterpret the historical value in-place.
    raw,
  };
}

export function restoreLegacyVisionRecord(envelope) {
  if (!plainObject(envelope) || envelope.version !== LEGACY_VISION_VERSION || !plainObject(envelope.raw)) {
    throw new Error('invalid legacy vision envelope');
  }
  if (envelope.source?.recordSha256 !== sha256(envelope.raw)) throw new Error(`${envelope.workId}: legacy raw hash mismatch`);
  return clone(envelope.raw);
}

// Rebuild the historical record from the normalized envelope (not the top-level `raw`
// rollback copy), to prove the round-trip independently of that copy. Honest scope: this
// is a LOSSLESS round-trip, not a full shape-aware migration. Only `palette` and `figures`
// are reconstructed from decomposed parts below; `evidence`, `pins`, and `delights` are
// rebuilt from per-item retained raw copies (`legacyRaw`), and the remaining fields are
// whole-value projections. A migration that understands every legacy shape well enough to
// drop the retained raw copies is not yet built.
export function restoreLegacyVisionProjection(envelope) {
  if (!plainObject(envelope) || envelope.version !== LEGACY_VISION_VERSION || !plainObject(envelope.shapes)) {
    throw new Error('invalid legacy vision envelope');
  }
  const has = field => Object.prototype.hasOwnProperty.call(envelope.shapes, field);
  const visible = envelope.passB?.visible || {};
  const teaching = envelope.passB?.teaching || {};
  const out = {};

  if (has('seen')) out.seen = clone(visible.seen);
  if (has('evidence')) {
    out.evidence = {};
    for (const axis of envelope.source?.evidenceAxes || []) {
      if (!LEGACY_EVIDENCE_AXES.includes(axis)) throw new Error(`${envelope.workId}: unknown projected evidence axis ${axis}`);
      out.evidence[axis] = (visible.evidence?.[axis] || []).map(item => clone(item.legacyRaw));
    }
  }
  if (has('pins')) out.pins = (teaching.hotspotCandidates || []).map(item => clone(item.legacyRaw));
  if (has('palette')) {
    const palette = visible.palette || {};
    out.palette = palette.legacyShape === 'array'
      ? clone(palette.colors || [])
      : { hex: clone(palette.colors || []), tone: palette.character };
  }
  if (has('format')) out.format = clone(visible.format);
  if (has('figures')) {
    const figures = visible.figures || {};
    if (figures.legacyShape === 'number') out.figures = figures.count;
    else if (figures.legacyShape === 'string') out.figures = figures.description;
    else out.figures = { count: figures.count, who: figures.description };
  }
  if (has('pose')) out.pose = clone(visible.pose);
  if (has('delights')) out.delights = (visible.delights || []).map(item => clone(item.legacyRaw));
  if (has('signature')) out.signature = clone(visible.signature);
  if (has('condition')) out.condition = clone(visible.condition);
  if (has('artifacts')) out.artifacts = clone(visible.photoArtifacts);
  if (has('image_quality')) out.image_quality = clone(envelope.passB?.imageFitness?.legacyQualityDescription);
  if (has('movement_suggestion')) out.movement_suggestion = clone(envelope.passB?.researchCandidates?.movementSuggestion);
  if (has('notes')) out.notes = clone(teaching.legacyBundle);
  if (has('recognized')) out.recognized = clone(envelope.passA?.legacy?.modelRecognizedFull);
  if (has('guessability')) out.guessability = clone(envelope.passA?.legacy?.guessability);
  return out;
}

export function auditLegacyVisionRecords(records) {
  if (!plainObject(records)) throw new Error('legacy vision collection must be an object');
  const mappedFields = new Set(Object.keys(LEGACY_VISION_FIELD_MAP));
  const seenFields = new Set();
  const evidenceAxes = new Set();
  const shapeCounts = {};
  const roundTripFailures = [];

  for (const [workId, record] of Object.entries(records)) {
    if (!plainObject(record)) { roundTripFailures.push(workId); continue; }
    for (const [field, value] of Object.entries(record)) {
      seenFields.add(field);
      const shape = legacyValueShape(value);
      shapeCounts[field] ||= {};
      shapeCounts[field][shape] = (shapeCounts[field][shape] || 0) + 1;
    }
    for (const axis of Object.keys(record.evidence || {})) evidenceAxes.add(axis);
    try {
      const normalized = normalizeLegacyVisionRecord(workId, record);
      const restoredRaw = restoreLegacyVisionRecord(normalized);
      const restoredProjection = restoreLegacyVisionProjection(normalized);
      if (stableJson(restoredRaw) !== stableJson(record) || stableJson(restoredProjection) !== stableJson(record)) {
        roundTripFailures.push(workId);
      }
    } catch {
      roundTripFailures.push(workId);
    }
  }

  const unknownFields = [...seenFields].filter(field => !mappedFields.has(field)).sort();
  const missingMappedFields = [...mappedFields].filter(field => !seenFields.has(field)).sort();
  const unknownEvidenceAxes = [...evidenceAxes].filter(axis => !LEGACY_EVIDENCE_AXES.includes(axis)).sort();
  return {
    version: 'vision-legacy-audit/1',
    recordCount: Object.keys(records).length,
    mappedFields: [...mappedFields].sort(),
    observedFields: [...seenFields].sort(),
    unknownFields,
    missingMappedFields,
    observedEvidenceAxes: [...evidenceAxes].sort(),
    unknownEvidenceAxes,
    shapeCounts,
    roundTripFailures: [...new Set(roundTripFailures)].sort(),
    ok: unknownFields.length === 0 && unknownEvidenceAxes.length === 0 && roundTripFailures.length === 0,
  };
}
