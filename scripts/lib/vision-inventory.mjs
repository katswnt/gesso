import { auditedOracle, evidenceVerified, notesComplete, SCHEMA_VERSION } from './vision-ledger.mjs';

export const COVERAGE_VERSION = 'contentVisionCoverage/1';
export const COMPONENTS = Object.freeze([
  'imageEligibility', 'richVisualRecord', 'teachingNotes',
  'guideQuestions', 'hotspots', 'researchFacts',
]);
export const COMPONENT_STATES = Object.freeze(['complete', 'missing', 'blocked', 'stale', 'notApplicable']);
export const GUIDE_STATES = Object.freeze(['missing', 'templateThin', 'legacyCandidate', 'specificReviewed']);
export const HOTSPOT_STATES = Object.freeze(['missing', 'present', 'reviewedNoPins']);

const WIKIDATA_ID = /^(?:(?:https?:\/\/www\.wikidata\.org\/entity\/)|(?:wikidata:)|(?:wd:))(Q\d+)$/i;
export function normalizeVisionWorkId(id) {
  const text = String(id ?? '');
  const match = text.match(WIKIDATA_ID);
  return match ? `wikidata:${match[1].toUpperCase()}` : text;
}

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const nonBlank = value => typeof value === 'string' && value.trim().length > 0;
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseWindowAssignment(text, assignment) {
  let start = -1;
  let cursor = 0;
  while ((start = text.indexOf(assignment, cursor)) >= 0) {
    cursor = start + assignment.length;
    while (/\s/.test(text[cursor] || '')) cursor++;
    if (text[cursor] === '=') break;
  }
  if (start < 0 || text[cursor] !== '=') throw new Error(`missing assignment ${assignment}`);
  cursor++;
  let value = text.slice(cursor).trim();
  if (value.endsWith(';')) value = value.slice(0, -1).trim();
  return JSON.parse(value);
}

function entriesOf(source) {
  if (Array.isArray(source)) return source.map(id => [id, true]);
  if (plainObject(source)) return Object.entries(source);
  return [];
}

export function buildArtifactIndex(source, poolIds) {
  const poolNorm = new Set(poolIds.map(normalizeVisionWorkId));
  const byNorm = new Map();
  for (const [id, value] of entriesOf(source)) {
    const normalized = normalizeVisionWorkId(id);
    const rows = byNorm.get(normalized) || [];
    rows.push({ id, value });
    byNorm.set(normalized, rows);
  }
  for (const rows of byNorm.values()) rows.sort((a, b) => a.id.localeCompare(b.id));
  return {
    byNorm,
    collisions: [...byNorm.entries()].filter(([, rows]) => rows.length > 1)
      .map(([canonicalId, rows]) => ({ canonicalId, ids: rows.map(row => row.id) })),
    orphans: [...byNorm.entries()].filter(([normalized]) => !poolNorm.has(normalized))
      .flatMap(([canonicalId, rows]) => rows.map(row => ({ canonicalId, id: row.id }))),
  };
}

function artifactValue(index, poolId) {
  const rows = index.byNorm.get(normalizeVisionWorkId(poolId)) || [];
  return rows.find(row => row.id === poolId) || rows[0] || null;
}

const GENERIC_GUIDE = /^(?:why (?:does|is|was|were|do|did|should|would|can|could)|what (?:technique|medium|material|should i|makes this|is the significance)|who made it|how (?:do we|can we|was it made)|what should i (?:look for|notice))/i;
export function guideStatus(record, reviewed = false) {
  const guide = Array.isArray(record?.guide) ? record.guide.filter(item => nonBlank(item?.q) && nonBlank(item?.a)) : [];
  if (guide.length < 5) return 'missing';
  if (reviewed) return 'specificReviewed';
  const specificLike = guide.filter(item => !GENERIC_GUIDE.test(item.q.trim())).length;
  return specificLike < 3 ? 'templateThin' : 'legacyCandidate';
}

function scheduleIndex(daily, asOf) {
  if (!validDate(asOf)) throw new Error(`invalid --as-of date: ${asOf}`);
  const tierById = new Map();
  for (const tier of ['easy', 'medium', 'hard', 'impossible']) {
    for (const id of (Array.isArray(daily?.[tier]) ? daily[tier] : [])) {
      const normalized = normalizeVisionWorkId(id);
      if (tierById.has(normalized) && tierById.get(normalized) !== tier) throw new Error(`${id}: appears in multiple tiers`);
      tierById.set(normalized, tier);
    }
  }
  const datesById = new Map();
  for (const [date, tiers] of Object.entries(daily?.byDate || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!validDate(date)) throw new Error(`invalid daily date: ${date}`);
    for (const tier of ['easy', 'medium', 'hard', 'impossible']) for (const id of (tiers?.[tier] || [])) {
      const normalized = normalizeVisionWorkId(id);
      const rows = datesById.get(normalized) || [];
      rows.push({ date, tier });
      datesById.set(normalized, rows);
    }
  }
  return function forWork(id) {
    const normalized = normalizeVisionWorkId(id);
    const future = (datesById.get(normalized) || []).filter(row => row.date >= asOf);
    const next = future[0] || null;
    const days = next ? daysBetween(asOf, next.date) : null;
    return {
      tier: tierById.get(normalized) || null,
      nextDate: next?.date || null,
      nextTier: next?.tier || null,
      daysUntil: days,
      priority: days == null ? 'unscheduled' : days <= 7 ? 'next7' : days <= 30 ? 'next30' : 'future',
    };
  };
}

function evidenceItemFor(id, entry, evidence) {
  const run = entry?.run;
  const items = run && Array.isArray(evidence?.[run]?.items) ? evidence[run].items : [];
  return items.find(item => item?.id === id) || null;
}

function counts(values, allowed) {
  const out = Object.fromEntries(allowed.map(value => [value, 0]));
  for (const value of values) out[value] = (out[value] || 0) + 1;
  return out;
}

function rotateByDiversity(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.region || 'unknown', row.sourceHost || 'unknown', row.medium || 'unknown'].join('\u0000');
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((a, b) => (b.fame - a.fame) || a.id.localeCompare(b.id));
  const keys = [...groups.keys()].sort();
  const out = [];
  while (keys.some(key => groups.get(key).length)) for (const key of keys) {
    const row = groups.get(key).shift();
    if (row) out.push(row);
  }
  return out;
}

function buildPriorityQueue(rows) {
  const pending = new Map(rows.filter(row => row.overallStatus !== 'complete').map(row => [row.id, row]));
  const take = predicate => {
    const selected = rotateByDiversity([...pending.values()].filter(predicate));
    for (const row of selected) pending.delete(row.id);
    return selected;
  };
  const cohorts = [
    take(row => row.schedule.priority === 'next7'),
    take(row => row.schedule.priority === 'next30'),
    take(row => row.schedule.tier === 'easy'),
  ];
  const highFame = new Set();
  for (const tier of ['medium', 'hard', 'impossible']) {
    const tierRows = [...pending.values()].filter(row => row.schedule.tier === tier)
      .sort((a, b) => (b.fame - a.fame) || a.id.localeCompare(b.id));
    for (const row of tierRows.slice(0, Math.ceil(tierRows.length * 0.2))) highFame.add(row.id);
  }
  cohorts.push(take(row => highFame.has(row.id)));
  cohorts.push(take(row => row.schedule.tier === 'medium'));
  cohorts.push(take(row => row.schedule.tier === 'hard'));
  cohorts.push(take(row => row.schedule.tier === 'impossible'));
  cohorts.push(take(() => true));
  return cohorts.flat().map(row => row.id);
}

export function validateCoverage(coverage, expectedPoolCount = null) {
  const errors = [];
  if (!plainObject(coverage) || coverage.version !== COVERAGE_VERSION) return { ok: false, errors: ['coverage version'] };
  if (!Array.isArray(coverage.rows)) return { ok: false, errors: ['rows'] };
  if (expectedPoolCount != null && coverage.rows.length !== expectedPoolCount) errors.push(`row count ${coverage.rows.length} != ${expectedPoolCount}`);
  const seen = new Set();
  for (const row of coverage.rows || []) {
    const id = normalizeVisionWorkId(row?.id);
    if (!id) errors.push('row id');
    else if (seen.has(id)) errors.push(`duplicate row ${id}`);
    else seen.add(id);
    if (!COMPONENT_STATES.includes(row?.overallStatus)) errors.push(`${row?.id}: unknown overall status ${row?.overallStatus}`);
    if (!plainObject(row?.components) || Object.keys(row.components).sort().join(',') !== [...COMPONENTS].sort().join(',')) errors.push(`${row?.id}: component keys`);
    else for (const [component, state] of Object.entries(row.components)) if (!COMPONENT_STATES.includes(state)) errors.push(`${row.id}: ${component} unknown status ${state}`);
    if (!GUIDE_STATES.includes(row?.guideStatus)) errors.push(`${row?.id}: guideStatus`);
    if (!HOTSPOT_STATES.includes(row?.hotspotStatus)) errors.push(`${row?.id}: hotspotStatus`);
  }
  const known = new Set((coverage.rows || []).map(row => row.id));
  for (const [name, ids] of Object.entries(coverage.queues || {})) {
    if (name === 'researchCoverage') continue;
    if (!Array.isArray(ids)) { errors.push(`queue ${name} not array`); continue; }
    if (new Set(ids).size !== ids.length) errors.push(`queue ${name} duplicates`);
    for (const id of ids) if (!known.has(id)) errors.push(`queue ${name} unknown id ${id}`);
  }
  const rows = coverage.rows || [];
  const incomplete = rows.filter(row => row.overallStatus !== 'complete').map(row => row.id).sort();
  const priority = Array.isArray(coverage.queues?.priority) ? [...coverage.queues.priority].sort() : [];
  if (stableStringList(incomplete) !== stableStringList(priority)) errors.push('priority queue must contain every incomplete row exactly once');
  if (coverage.summary?.poolWorks !== rows.length) errors.push('summary poolWorks');
  if (coverage.summary?.provablyComplete !== rows.length - incomplete.length) errors.push('summary provablyComplete');
  return { ok: errors.length === 0, errors };
}

function stableStringList(values) {
  return JSON.stringify(values);
}

export function buildVisionCoverage({ pool, teach = {}, hotspots = {}, vision = {}, ledger = {}, evidence = {}, noPins = [], daily = {}, research = {}, asOf, inputHashes = {} }) {
  if (!Array.isArray(pool)) throw new Error('pool must be an array');
  const ids = pool.map(row => row?.id);
  if (ids.some(id => !nonBlank(id))) throw new Error('pool contains missing id');
  const normalized = new Set();
  for (const id of ids) {
    const key = normalizeVisionWorkId(id);
    if (normalized.has(key)) throw new Error(`duplicate normalized pool id: ${key}`);
    normalized.add(key);
  }

  const indexes = {
    teach: buildArtifactIndex(teach, ids),
    hotspots: buildArtifactIndex(hotspots, ids),
    vision: buildArtifactIndex(vision, ids),
    legacyAudit: buildArtifactIndex(ledger.ids || [], ids),
    ledgerEntries: buildArtifactIndex(ledger.entries || {}, ids),
    noPins: buildArtifactIndex(noPins, ids),
    guessability: buildArtifactIndex(research.guessability || {}, ids),
    adaptiveProbe: buildArtifactIndex(research.adaptiveProbe || [], ids),
    ease: buildArtifactIndex(research.ease || {}, ids),
  };
  const scheduleFor = scheduleIndex(daily, asOf);
  const securelyAudited = auditedOracle(ledger, evidence);

  const rows = pool.map(work => {
    const id = work.id;
    const teaching = artifactValue(indexes.teach, id)?.value || null;
    const hotspot = artifactValue(indexes.hotspots, id)?.value || null;
    const rich = artifactValue(indexes.vision, id)?.value || null;
    const ledgerRow = artifactValue(indexes.ledgerEntries, id);
    const entry = ledgerRow?.value || null;
    const currentPass = entry?.pass === SCHEMA_VERSION;
    const terminal = entry?.status === 'complete' || entry?.status === 'unplayable';
    const verified = currentPass && terminal && ledgerRow?.id === id && securelyAudited(id);
    const item = verified ? evidenceItemFor(id, entry, evidence) : null;
    const components = Object.fromEntries(COMPONENTS.map(component => [component, 'missing']));
    const blockedReasons = [];
    const staleReasons = [];

    if (currentPass && entry.status === 'needs-image') {
      components.imageEligibility = 'blocked';
      for (const component of ['richVisualRecord', 'teachingNotes', 'guideQuestions', 'hotspots']) components[component] = 'blocked';
      blockedReasons.push('current image requires repair or identity/framing review');
    } else if (entry && (!currentPass || (terminal && !verified))) {
      for (const component of ['imageEligibility', 'teachingNotes', 'hotspots']) components[component] = 'stale';
      staleReasons.push(!currentPass ? `ledger pass ${entry.pass || 'missing'} != ${SCHEMA_VERSION}` : 'terminal ledger evidence is missing, aliased, or invalid');
    } else if (verified) {
      components.imageEligibility = 'complete';
      if (notesComplete(item?.approved)) {
        components.teachingNotes = 'complete';
        components.hotspots = 'complete';
      }
    }

    const states = Object.values(components);
    const overallStatus = states.includes('blocked') ? 'blocked'
      : states.includes('stale') ? 'stale'
        : states.every(state => state === 'complete' || state === 'notApplicable') ? 'complete' : 'missing';
    const notes = Array.isArray(teaching?.notes) ? teaching.notes : [];
    const hasPins = (Array.isArray(hotspot) && hotspot.length > 0) || notes.some(note => typeof note?.x === 'number' && typeof note?.y === 'number');
    const reviewedNoPins = !!artifactValue(indexes.noPins, id);
    const sourceHost = (() => { try { return new URL(work.img).hostname; } catch { return null; } })();
    const schedule = scheduleFor(id);
    const aliases = Object.fromEntries(Object.entries(indexes).filter(([name]) => !['guessability', 'adaptiveProbe', 'ease'].includes(name)).map(([name, index]) => [name, (index.byNorm.get(normalizeVisionWorkId(id)) || []).map(row => row.id)]));

    return {
      id,
      canonicalId: normalizeVisionWorkId(id),
      title: work.title || '',
      fame: Number.isFinite(work.fame) ? work.fame : 0,
      region: work.region || null,
      medium: work.medium || null,
      sourceHost,
      img: work.img || null,
      imgSha256: entry?.imgSha || null,
      schemaVersion: SCHEMA_VERSION,
      schedule,
      overallStatus,
      components,
      guideStatus: guideStatus(teaching, false),
      hotspotStatus: reviewedNoPins ? 'reviewedNoPins' : hasPins ? 'present' : 'missing',
      legacy: {
        canonicalAudit: !!artifactValue(indexes.legacyAudit, id),
        rich: !!rich,
        teaching: !!teaching,
        why: nonBlank(teaching?.why),
        cues: Array.isArray(teaching?.cues) && teaching.cues.length > 0,
        guide: Array.isArray(teaching?.guide) && teaching.guide.length > 0,
        notes: notes.length > 0,
        hotspots: Array.isArray(hotspot) && hotspot.length > 0,
        aliases,
      },
      research: {
        verifier: false,
        guessability: !!artifactValue(indexes.guessability, id),
        adaptiveProbe: !!artifactValue(indexes.adaptiveProbe, id),
        ease: !!artifactValue(indexes.ease, id),
        predictHuman: false,
        richLegacyRecognition: typeof rich?.recognized === 'boolean',
      },
      approval: verified ? { mode: 'human', run: entry.run, completionSha: entry.completionSha } : null,
      imageState: currentPass ? entry.status : null,
      blockedReasons,
      staleReasons,
    };
  });

  const artifactDiagnostics = Object.fromEntries(Object.entries(indexes).map(([name, index]) => [name, {
    collisions: index.collisions,
    orphans: index.orphans,
  }]));
  const queues = {
    dailyOrHorizonBlockers: rows.filter(row => ['next7', 'next30'].includes(row.schedule.priority) && row.overallStatus !== 'complete').sort((a, b) => (a.schedule.nextDate || '').localeCompare(b.schedule.nextDate || '') || a.id.localeCompare(b.id)).map(row => row.id),
    missingMandatory: rows.filter(row => row.overallStatus === 'missing').map(row => row.id),
    blocked: rows.filter(row => row.overallStatus === 'blocked').map(row => row.id),
    stale: rows.filter(row => row.overallStatus === 'stale').map(row => row.id),
    legacyOnly: rows.filter(row => row.overallStatus !== 'complete' && Object.entries(row.legacy).some(([key, value]) => key !== 'aliases' && value === true)).map(row => row.id),
    priority: buildPriorityQueue(rows),
    researchCoverage: {
      guessability: rows.filter(row => row.research.guessability).map(row => row.id),
      adaptiveProbe: rows.filter(row => row.research.adaptiveProbe).map(row => row.id),
      ease: rows.filter(row => row.research.ease).map(row => row.id),
      richLegacyRecognition: rows.filter(row => row.research.richLegacyRecognition).map(row => row.id),
    },
  };
  const coverage = {
    version: COVERAGE_VERSION,
    asOf,
    policy: {
      currentNarrowSchemaVersion: SCHEMA_VERSION,
      richSchemaStatus: 'not-implemented',
      legacyEvidenceNeverCompletesCurrentPass: true,
      horizonGate: 'report-only',
    },
    inputHashes,
    summary: {
      poolWorks: rows.length,
      provablyComplete: rows.filter(row => row.overallStatus === 'complete').length,
      overall: counts(rows.map(row => row.overallStatus), COMPONENT_STATES),
      components: Object.fromEntries(COMPONENTS.map(component => [component, counts(rows.map(row => row.components[component]), COMPONENT_STATES)])),
      guides: counts(rows.map(row => row.guideStatus), GUIDE_STATES),
      hotspots: counts(rows.map(row => row.hotspotStatus), HOTSPOT_STATES),
      legacy: {
        canonicalAudit: rows.filter(row => row.legacy.canonicalAudit).length,
        rich: rows.filter(row => row.legacy.rich).length,
        teaching: rows.filter(row => row.legacy.teaching).length,
        guide: rows.filter(row => row.legacy.guide).length,
        notes: rows.filter(row => row.legacy.notes).length,
        hotspots: rows.filter(row => row.legacy.hotspots).length,
      },
      secureCurrentNarrowPass: rows.filter(row => row.approval).length,
      horizonBlockers: queues.dailyOrHorizonBlockers.length,
    },
    diagnostics: { artifacts: artifactDiagnostics },
    queues,
    rows,
  };
  const validated = validateCoverage(coverage, pool.length);
  if (!validated.ok) throw new Error(`invalid generated coverage:\n${validated.errors.join('\n')}`);
  return coverage;
}
