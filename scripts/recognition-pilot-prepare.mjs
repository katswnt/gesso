// Offline-only preparation for the recognition/inference pilot protocol freeze.
//
// Selects a deterministic 36-work DRAFT under the approved hard quotas and soft diversity
// objective, builds the exact 671-cell schedule, and snapshots the site's style vocabulary. It does
// not fetch images, call a model, annotate outcomes, or modify any game/runtime data.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  PILOT_VERSION, PILOT_FREEZE_ID, PILOT_WORKS, FAME_BANDS, ANCHORS, FACETS, fameBand, rngFor, seededShuffle,
  disclosureMask, opaqueSham, buildCallManifest, canonicalJson, sha256,
} from './lib/recognition-pilot.mjs';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'docs/research/recognition-pilot');
const SELECTION_SEED = 'gesso-recognition-pilot-selection-2026-08-31-v1';
const CALL_SEED = 'gesso-recognition-pilot-calls-2026-08-31-v1';
const GENERIC = new Set(['mask','vessel','head','jar','bowl','figure','figurine','plate','dish','cup','vase','bottle','fragment','fragments','statuette','statue','relief','panel','tile','box','ring','pendant','bead','beads','coin','seal','stele','stela','sculpture','painting','drawing','portrait','untitled','amulet','plaque','jug','ewer','flask','censer','mirror','comb','buckle','brooch','necklace','earring','bracelet','textile','tapestry','teapot','candlestick','altarpiece']);

// Once any curation begins, this deterministic generator must not silently erase it. Subsequent
// normalization/hashing uses recognition-pilot-seal-curation.mjs.
const existingManifestPath = join(OUT_DIR, 'pilot-manifest.draft.json');
const existingStylePath = join(OUT_DIR, 'style-taxonomy.snapshot.json');
if (existsSync(existingManifestPath)) {
  const existing = JSON.parse(readFileSync(existingManifestPath, 'utf8'));
  const curated = (existing.works || []).some(w => Object.entries(w.curatorChecks || {})
    .some(([key, value]) => value === true && !(key === 'alternateIdentity' && !w.studyC)));
  const styleCurated = existsSync(existingStylePath) && JSON.parse(readFileSync(existingStylePath, 'utf8')).curatorReview?.complete === true;
  if (curated || styleCurated) {
    console.error('REFUSED: curation has begun; preparation will not overwrite it. Use recognition-pilot-seal-curation.mjs after edits.');
    process.exit(2);
  }
}

function loadWindow(file, key) {
  const w = {};
  new Function('window', readFileSync(file, 'utf8'))(w);
  return w[key];
}

function extractObject(source, name) {
  const marker = `const ${name}=`;
  const start = source.indexOf(marker);
  if (start < 0) return {};
  const brace = source.indexOf('{', start + marker.length);
  let depth = 0, quote = null, escaped = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return new Function(`return (${source.slice(brace, i + 1)})`)();
  }
  throw new Error(`unterminated ${name}`);
}

const normalizeTitle = t => String(t || '').toLowerCase().replace(/[.,;:!?"'`’()]/g, '').trim();
const isGeneric = t => GENERIC.has(normalizeTitle(t)) || normalizeTitle(t).split(/\s+/).length <= 1;
const sourceHost = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return 'invalid'; } };
const broadEra = y => y < 0 ? 'bce' : y < 1000 ? 'pre-1000' : y < 1500 ? '1000-1499' : y < 1800 ? '1500-1799' : y < 1900 ? '1800s' : y < 1946 ? '1900-1945' : 'post-1945';
const broadMedium = p => {
  const m = String(p.medium || '').toLowerCase();
  if (/oil|tempera|acrylic|paint|fresco|gouache|watercolor/.test(m)) return 'painting';
  if (/print|etch|lithograph|woodblock|engraving|screenprint/.test(m)) return 'print';
  if (/photograph|albumen|gelatin silver/.test(m)) return 'photograph';
  if (/drawing|ink|charcoal|graphite|pastel/.test(m)) return 'drawing';
  if (/textile|silk|wool|cotton|tapestry|carpet/.test(m)) return 'textile';
  if (/ceramic|porcelain|stoneware|earthenware|terracotta|clay/.test(m)) return 'ceramic';
  if (/bronze|marble|stone|wood|ivory|sculpt/.test(m)) return 'sculpture';
  return 'other';
};

const POOL = loadWindow(join(ROOT, 'data/pool.js'), 'ARTEFACTUM_POOL') || [];
const FAME = loadWindow(join(ROOT, 'data/fame.js'), 'ARTEFACTUM_FAME') || {};
const TEACH_ROOT = loadWindow(join(ROOT, 'data/teach-works.js'), 'ARTEFACTUM_CUES') || {};
const TEACH = TEACH_ROOT.work || {};
const HOT = loadWindow(join(ROOT, 'data/hotspots.js'), 'ARTEFACTUM_HOTSPOTS') || {};
const VISION = loadWindow(join(ROOT, 'data/vision.js'), 'ARTEFACTUM_VISION') || {};
const OLD_GUESS = JSON.parse(readFileSync(join(ROOT, 'data/guessability/scores.json'), 'utf8')).works || {};
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const RELATED_MOV = extractObject(html, 'RELATED_MOV');
const MOVEMENTS = extractObject(html, 'MOVEMENTS');

const candidates = POOL.filter(p => /^https:\/\//.test(p.img || '') && fameBand(FAME[p.id] ?? 0) && !/^Q\d+$/i.test(String(p.title || '').trim())).map(p => ({
  p,
  fame: FAME[p.id] ?? 0,
  band: fameBand(FAME[p.id] ?? 0),
  regionGroup: p.region === 'Europe' ? 'europe' : 'non-europe',
  era: broadEra(Number(p.y || 0)),
  mediumFamily: broadMedium(p),
  titleType: isGeneric(p.title) ? 'generic' : 'distinctive',
  playState: p.play === false ? 'unplayable-recorded' : (p.play === true ? 'playable-recorded' : 'unreviewed'),
  sourceHost: sourceHost(p.img),
  contentRichness: (Array.isArray(TEACH[p.id]?.notes) ? TEACH[p.id].notes.length : 0)
    + (Array.isArray(TEACH[p.id]?.guide) ? TEACH[p.id].guide.length : 0)
    + (Array.isArray(HOT[p.id]) ? HOT[p.id].length : 0),
  alternateCandidate: p.origImg || p.prevImg || p.aicImg || p.harvardOrig || null,
}));

// All ten cells receive three works. Six seeded cells receive a fourth: exact total 36.
const cellIds = FAME_BANDS.flatMap(b => ['europe', 'non-europe'].map(r => `${b.id}:${r}`));
const extraCells = new Set(seededShuffle(cellIds, `${SELECTION_SEED}:quota`).slice(0, 6));
const quota = Object.fromEntries(cellIds.map(id => [id, 3 + (extraCells.has(id) ? 1 : 0)]));

const chosen = [], counts = { era: {}, mediumFamily: {}, titleType: {}, playState: {}, sourceHost: {} };
const inc = (group, key) => { counts[group][key] = (counts[group][key] || 0) + 1; };
const diversityPenalty = c => 4 * (counts.mediumFamily[c.mediumFamily] || 0)
  + 2 * (counts.era[c.era] || 0)
  + 2 * (counts.titleType[c.titleType] || 0)
  + 1.5 * (counts.playState[c.playState] || 0)
  + 1 * (counts.sourceHost[c.sourceHost] || 0)
  - Math.min(c.contentRichness, 10) * 0.05
  - (c.alternateCandidate ? 0.25 : 0);

for (const cell of seededShuffle(cellIds, `${SELECTION_SEED}:cells`)) {
  const [band, regionGroup] = cell.split(':');
  const pool = candidates.filter(c => c.band === band && c.regionGroup === regionGroup);
  for (let n = 0; n < quota[cell]; n++) {
    const ranked = pool.filter(c => !chosen.includes(c)).map(c => ({ c, penalty: diversityPenalty(c), tie: sha256(`${SELECTION_SEED}:${c.p.id}`) }))
      .sort((a, b) => a.penalty - b.penalty || a.tie.localeCompare(b.tie));
    if (!ranked.length) throw new Error(`insufficient candidates for ${cell}`);
    const c = ranked[0].c; chosen.push(c);
    for (const group of ['era', 'mediumFamily', 'titleType', 'playState', 'sourceHost']) inc(group, c[group]);
  }
}
if (chosen.length !== PILOT_WORKS || new Set(chosen.map(c => c.p.id)).size !== PILOT_WORKS) throw new Error('selection invariant');

// Assign anchors evenly, and choose stratified methodological subsets without outcome knowledge.
const byTie = [...chosen].sort((a, b) => sha256(`${SELECTION_SEED}:subsets:${a.p.id}`).localeCompare(sha256(`${SELECTION_SEED}:subsets:${b.p.id}`)));
const promptOrder = new Set(byTie.slice(0, 12).map(c => c.p.id));
const evidenceBoxes = new Set(byTie.slice(12, 24).map(c => c.p.id));
const lowDoc = new Set([...chosen].sort((a, b) => a.fame - b.fame || sha256(a.p.id).localeCompare(sha256(b.p.id))).slice(0, 6).map(c => c.p.id));
const studyCCandidates = [...chosen].filter(c => c.alternateCandidate).sort((a, b) => sha256(`${SELECTION_SEED}:alternate:${a.p.id}`).localeCompare(sha256(`${SELECTION_SEED}:alternate:${b.p.id}`))).slice(0, 6);
if (studyCCandidates.length !== 6) throw new Error('not enough local alternate candidates for Study C draft');
const studyC = new Set(studyCCandidates.map(c => c.p.id));

const works = chosen.map((c, index) => {
  const p = c.p;
  const title = String(p.title || '').trim();
  const generic = isGeneric(title);
  const cue = generic
    ? `${title} — ${p.artist || p.style || p.place || 'unrecorded maker'}, ${p.museum || p.place || 'catalog object'}`
    : title;
  const aliases = {
    date: [String(p.y), ...(Array.isArray(p.yr) ? p.yr.map(String) : [])].filter(Boolean),
    place: [p.place, p.region].filter(Boolean),
    medium: [p.medium].filter(Boolean),
    style: [p.style].filter(Boolean),
    artist: [p.artist].filter(Boolean),
  };
  const mask = disclosureMask(cue, aliases);
  const anchor = ANCHORS[index % ANCHORS.length];
  const alt = studyC.has(p.id) ? c.alternateCandidate : null;
  return {
    id: p.id,
    draftStatus: 'CURATOR_REVIEW_REQUIRED',
    catalog: { wikidataId: p.wikidataid || String(p.id).match(/Q\d+/)?.[0] || null, title, artist: p.artist || null, place: p.place || null, style: p.style || null, styleKind: p.styleKind || null, medium: p.medium || null },
    // The legacy pool's place lineage is not uniformly creation-place-safe (some older records may
    // reflect maker biography). It is usable for a provisional balanced draft only. The protocol freeze
    // requires a curator to establish creation place or an explicit culture-region fallback.
    strata: { fameBand: c.band, fameHistoricalComposite: c.fame, regionGroup: c.regionGroup, regionSource: 'pool-region-provisional-unverified', lowDocumentationStress: lowDoc.has(p.id) },
    // Split covariates from generation: selection = the immutable values used to draw the sample;
    // analysis = the pre-outcome corrected values (identical at generation, corrected during curation).
    selectionCovariates: { era: c.era, objectType: c.mediumFamily, mediumFamily: c.mediumFamily, titleType: c.titleType, playState: c.playState, sourceHost: c.sourceHost, contentRichness: c.contentRichness, artistCluster: p.artist || null, institutionCluster: p.museum || null },
    analysisCovariates: { era: c.era, objectType: c.mediumFamily, mediumFamily: c.mediumFamily, titleType: c.titleType, playState: c.playState, sourceHost: c.sourceHost, contentRichness: c.contentRichness, artistCluster: p.artist || null, institutionCluster: p.museum || null },
    source: { requestedUrl: p.img, sanitizedSha256: null, canonicalViewSha256: null, rights: null, license: null },
    imageFitness: { state: null, reason: null, replacementUrl: null },
    transform: { anchor, views: {} },
    // Explicit per-work exact-recognition unit and rule (not inferred later from titleType).
    recognitionKey: { acceptedTitles: [title], acceptedArtists: p.artist ? [p.artist] : [], requiredQualifierGroups: generic ? [[p.artist || p.style || p.place || p.museum || 'unattributed']] : [], uniqueFacts: [], targetUnit: ({ print: 'edition', photograph: 'cataloged-work', painting: 'cataloged-work', drawing: 'cataloged-work' }[c.mediumFamily] || 'unique-object'), exactRequires: generic ? 'title+qualifier' : 'title' },
    cue: { correct: cue, sham: opaqueSham(cue, p.id), cueType: generic ? 'title-plus-qualifier' : 'title-only', acceptedAliasesByFacet: aliases, ...mask },
    truth: {
      date: { lo: Array.isArray(p.yr) ? Math.min(...p.yr) : p.y, hi: Array.isArray(p.yr) ? Math.max(...p.yr) : p.y },
      place: { exact: [p.place].filter(Boolean), parent: [p.region].filter(Boolean) },
      medium: { exact: [p.medium].filter(Boolean), family: [c.mediumFamily], broad: [] },
      style: p.style ? { exact: [p.style], family: [], related: RELATED_MOV[p.style] || [] } : { notApplicable: true },
      artist: p.artist ? { exact: [p.artist], workshop: [], circle: [], attributed: [], follower: [] } : { notApplicable: true },
    },
    promptOrder: promptOrder.has(p.id), evidenceBoxes: evidenceBoxes.has(p.id), studyC: studyC.has(p.id),
    alternate: studyC.has(p.id) ? { candidateUrl: alt, sameObjectOwnerApproved: false, source: null, license: null, sanitizedSha256: null, viewSha256: null, comparability: null } : null,
    curationIssues: [],
    curatorChecks: { imageFitness: false, regionOrigin: false, recognitionKey: false, cueAndMask: false, truthHierarchy: false, rights: false, alternateIdentity: !studyC.has(p.id) },
  };
});

const idVariants = id => {
  const q = String(id).match(/Q\d+/)?.[0];
  return [...new Set([id, q && `wikidata:${q}`, q && `wd:${q}`, q && `http://www.wikidata.org/entity/${q}`].filter(Boolean))];
};
const findLegacy = (obj, id) => idVariants(id).map(k => obj[k]).find(v => v != null) ?? null;
const legacyComparison = {
  version: 'recognition-legacy-comparison/1',
  warning: 'NOT MODEL-FACING. Frozen only for post-collection comparison; never enter a blind payload.',
  poolCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  works: Object.fromEntries(works.map(w => {
    const p = POOL.find(x => x.id === w.id), teach = findLegacy(TEACH, w.id), hot = findLegacy(HOT, w.id), vision = findLegacy(VISION, w.id), oldGuess = findLegacy(OLD_GUESS, w.id);
    return [w.id, {
      pool: p ? {
        play: p.play ?? null, playableReason: p.playableReason ?? null, cats: p.cats ?? null,
        style: p.style ?? null, styleKind: p.styleKind ?? null, medium: p.medium ?? null,
        sensitive: p.sensitive ?? null, provenanceNote: p.provenanceNote ?? null,
        historicalFameComposite: FAME[w.id] ?? 0, poolFameRaw: p.fame ?? null, canon: !!p.canon,
      } : null,
      teachExact: teach || null,
      hotspotsExact: hot || null,
      richVisionExact: vision || null,
      summary: {
        guide: teach?.guide?.length || 0, notes: teach?.notes?.length || 0,
        cues: teach?.cues?.length || 0, hotspots: Array.isArray(hot) ? hot.length : 0,
        richVisionPresent: !!vision, richVisionFields: vision ? Object.keys(vision).sort() : [],
      },
      historicalGuessability: oldGuess,
    }];
  })),
};
legacyComparison.sha256 = sha256(canonicalJson({ ...legacyComparison, sha256: undefined }));

const callManifest = buildCallManifest(works, CALL_SEED);
const poolCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const styleKinds = {};
for (const p of POOL) if (p.style) (styleKinds[p.style] ||= new Set()).add(p.styleKind || 'movement');
const styleSnapshot = {
  status: 'DRAFT_REVIEW_REQUIRED',
  generatedAt: '2026-08-31',
  sourceCommit: poolCommit,
  labels: Object.keys(styleKinds).sort().map(label => ({ label, normalized: normalizeTitle(label), kinds: [...styleKinds[label]].sort(), movementMeta: MOVEMENTS[label] || null, related: RELATED_MOV[label] || [] })),
  curatorDedupMap: {},
  curatorReview: { complete: false, reviewedAt: null, reviewer: null },
  note: 'Exact site labels and relations are frozen here. Curator must resolve audit-labels near-duplicates before the protocol freeze; raw labels are never discarded.',
};
styleSnapshot.sha256 = sha256(canonicalJson({ ...styleSnapshot, sha256: undefined }));

const manifest = {
  status: 'DRAFT_NOT_FROZEN_NO_COLLECTION',
  version: PILOT_VERSION,
  freezeCandidateId: PILOT_FREEZE_ID,
  generatedAt: '2026-08-31',
  selection: {
    seed: SELECTION_SEED, poolCommit, count: works.length,
    hardQuota: { definition: 'five fixed fame bands × Europe/non-Europe', cells: quota },
    softObjective: { order: ['medium-family', 'broad-era', 'title-type', 'play-state', 'source-host', 'content-richness', 'alternate-candidate'], tieBreaker: 'sha256(seed + work id)' },
    // JSON has no Infinity value. Preserve the open upper bound explicitly instead of silently
    // serializing Infinity as null.
    fameBands: FAME_BANDS.map(b => ({ ...b, max: Number.isFinite(b.max) ? b.max : null, maxOpenEnded: !Number.isFinite(b.max) })),
  },
  callManifest: { file: 'call-manifest.draft.json', seed: CALL_SEED, expectedCalls: callManifest.counts },
  styleTaxonomy: { file: 'style-taxonomy.snapshot.json', sha256: styleSnapshot.sha256 },
  freezeRequirements: { allCuratorChecksTrue: true, allImagesHashed: true, exactCostGatePass: true, promptsSchemasGradersHashed: true, frozenGitCommit: true },
  works,
};
manifest.sha256 = sha256(canonicalJson({ ...manifest, sha256: undefined }));

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, value] of [['pilot-manifest.draft.json', manifest], ['call-manifest.draft.json', callManifest], ['style-taxonomy.snapshot.json', styleSnapshot], ['legacy-comparison.snapshot.json', legacyComparison]]) {
  const path = join(OUT_DIR, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
const worksheet = [
  '# Pilot curation worksheet', '',
  '**DRAFT — every checkbox must be resolved before the protocol-freeze commit.** Legacy counts are',
  'review aids only and never enter a blind model payload.', '',
  '| # | Work | Cell | Cue / literal masks | Legacy | Required review |',
  '|---:|---|---|---|---|---|',
  ...works.map((w, i) => {
    const l = legacyComparison.works[w.id];
    const legacy = `guide ${l.summary.guide}; notes ${l.summary.notes}; pins ${l.summary.hotspots}; rich ${l.summary.richVisionPresent ? 'yes' : 'no'}`;
    const review = w.studyC ? 'image · origin · key · cue/mask · truth · rights · alternate' : 'image · origin · key · cue/mask · truth · rights';
    return `| ${i + 1} | ${w.catalog.title.replace(/\|/g, '\\|')}<br><code>${w.id}</code> | ${w.strata.fameBand}/${w.strata.regionGroup} | ${w.cue.correct.replace(/\|/g, '\\|')}<br>masked: ${w.cue.disclosedFacets.join(', ') || 'none'} | ${legacy} | ☐ ${review} |`;
  }), '',
  'For generic titles, verify that the qualifier identifies the physical work without mechanically',
  'disclosing unnecessary scored facets. For Study C, a local alternate-looking URL is only a lead;',
  'authoritative same-object evidence and owner approval are mandatory.', '',
].join('\n');
writeFileSync(join(OUT_DIR, 'pilot-curation-worksheet.md'), worksheet);
console.log(`prepared ${works.length}-work DRAFT + ${callManifest.calls.length} calls (NO fetch/model call)`);
console.log(`manifest ${manifest.sha256}`);
console.log('protocol freeze remains blocked on curator checks, image/view hashes, exact cost preflight, and a dedicated frozen git commit');
