// VSD-034 item 1: generate the immutable, ancestry-bound content-blocked findings artifact.
// Reads the two canonical failing B4 records (source unchanged), computes the stable content fingerprint,
// and writes a self-hashed findings artifact. No model call, no image read, no production write.
//   node scripts/pass-b-content-blocked-findings.mjs            # write (refuses to overwrite a changed artifact)
//   node scripts/pass-b-content-blocked-findings.mjs --check    # verify the on-disk artifact only
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';
import { buildFinding, sealFindings, verifyFindingsArtifact, contentFingerprint, CONTENT_BLOCKED_VERSION } from './lib/pass-b-blocked-findings.mjs';

const SRC_RUN = 'data/incoming/vision-calibration/b4r-8f1f74ddc30f';
const UPSTREAM = 'cal50-0a47b6f7f332';
// Durable, TRACKED enforcement artifact (data/ root is tracked; data/incoming/ is gitignored). The source
// records it is generated from live under the gitignored calibration dir, but the sealed output must persist
// in every checkout so approval enforcement and the --check gate work without the calibration runs present.
const OUT_DIR = 'data';
const OUT = join(OUT_DIR, 'vision-content-blocked.json');
const safe = (id) => id.replace(/[^a-z0-9]+/gi, '_');

// The two owner-confirmed content failures from the forensic audit (VSD-034). blockedClaims are the exact
// false propositions; a future resolution must clear each by name.
const SPECS = [
  {
    workId: 'wikidata:Q16467705',
    reason: 'Figure inversion + invented iconography (audit-confirmed against Musee Carnavalet record). Glory is the nude woman below; Villiers is the clothed man in the coffin above.',
    blockedClaims: [
      'figure-role-inversion: player copy makes Villiers the lower/nude figure and Glory the upper/winged figure; correct binding is Glory=nude woman below, Villiers=clothed man in coffin above',
      'invented-wings: player copy asserts wings on Glory; no wings exist (uncertainty admits no visual confirmation; catalog has no "ailee")',
      'invented-skull: rich index/tags assert a skull / memento-mori / vanitas program not present in the work',
      'wrong-medium: rich index asserts carved wood; the work is plaster',
    ],
  },
  {
    workId: 'wikidata:Q1211814',
    reason: 'Intra-record entity aliasing (audit-confirmed against NGA description). The lower-left crawling human penitent (St. John Chrysostom) is also described as a separate crouching lion, with no declared conflict.',
    blockedClaims: [
      'entity-aliasing: one lower-left region is assigned two incompatible identities (crawling human penitent AND crouching lion) with conflicts:[]; the figure is a crawling man',
    ],
  },
];

function loadRecord(workId) {
  const recPath = join(SRC_RUN, 'works', `${safe(workId)}.b4.json`);
  const record = JSON.parse(readFileSync(recPath, 'utf8'));
  const hash = sha256(workId).slice(0, 24);
  const b0 = JSON.parse(readFileSync(join('data/incoming/vision-calibration', UPSTREAM, 'works', hash, 'b0-prep.json'), 'utf8'));
  // Upstream cal50 B4 completion carries the raw B4 response hash (no parsed delta) — bind it so the source
  // completion is caught alongside the b4r derivative (which carries the parsed delta).
  const cpath = join('data/incoming/vision-calibration', UPSTREAM, 'works', hash, 'completions', `b4-${completionKey('B4', workId)}.json`);
  const completion = JSON.parse(readFileSync(cpath, 'utf8'));
  const fp = contentFingerprint(record);
  return {
    fp,
    rawResponseSha256: completion.rawResponseSha256 ?? null,
    imgSha256: b0.image?.imgSha256 ?? null,
    provenance: {
      sourceRuns: ['b4c-f45fac18da2e', 'b4r-8f1f74ddc30f'],
      upstreamRun: UPSTREAM,
      upstreamCompletionRawResponseSha256: completion.rawResponseSha256 ?? null,
      sourceRecordSha256: sha256(readFileSync(recPath, 'utf8')),
      bodySha256: sha256(stableJson(record.body)),
      auditRef: 'VSD-034 forensic audit 2026-09-15',
    },
  };
}

const check = process.argv.includes('--check');

if (check) {
  if (!existsSync(OUT)) { console.error(`missing ${OUT}`); process.exit(1); }
  const v = verifyFindingsArtifact(JSON.parse(readFileSync(OUT, 'utf8')));
  console.log(v.ok ? `OK ${OUT}: ${v.findings.length} sealed findings, integrity verified` : `FAIL ${OUT}: ${v.error}`);
  process.exit(v.ok ? 0 : 1);
}

const findings = SPECS.map((s) => {
  const r = loadRecord(s.workId);
  return buildFinding({ workId: s.workId, rawDeltaSha256: r.fp.rawDeltaSha256, rawResponseSha256: r.rawResponseSha256, imgSha256: r.imgSha256, blockedClaims: s.blockedClaims, reason: s.reason, provenance: r.provenance });
});
const artifact = sealFindings(findings, `Content-blocked findings (VSD-034 item 1). Immutable + ancestry-bound (workId + rawDeltaSha256). ${CONTENT_BLOCKED_VERSION}.`);

// Immutability: refuse to overwrite an existing artifact whose sealed content differs (never silently mutate evidence).
if (existsSync(OUT)) {
  const cur = JSON.parse(readFileSync(OUT, 'utf8'));
  if (cur.findingsSha256 === artifact.findingsSha256) { console.log(`unchanged: ${OUT} (${findings.length} findings)`); process.exit(0); }
  console.error(`REFUSING to overwrite ${OUT}: sealed content changed (cur ${cur.findingsSha256?.slice(0, 12)} vs new ${artifact.findingsSha256.slice(0, 12)}). Delete deliberately if intended.`);
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
console.log(`wrote ${OUT}: ${findings.length} sealed findings`);
for (const f of findings) console.log(`  ${f.findingId} ${f.workId} delta=${f.rawDeltaSha256.slice(0, 12)} claims=${f.blockedClaims.length}`);
