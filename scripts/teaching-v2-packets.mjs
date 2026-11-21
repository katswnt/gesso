// Teaching-v2 Phase A literal source packets (VSD-093). NO model calls. Steps are separate on purpose:
//   node scripts/teaching-v2-packets.mjs                 # plan: freeze plan.json + vetted-urls.json (no network)
//   node scripts/teaching-v2-packets.mjs --import-regressions --audit-inputs <dir> --research-evidence <dir>
//                                                        # copy known regression evidence into the local store
//   node scripts/teaching-v2-packets.mjs --fetch          # the ONLY networked step: capture vetted URLs (C)
//   node scripts/teaching-v2-packets.mjs --build          # offline: packets + exact-substring checks + coverage
// Options: --evidence-root <dir> (default data/incoming/vision-calibration), --out <dir> (default data/incoming/teaching-v2).
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { createSourceCapture, persistSnapshot, readSnapshot, vetUrls, assemblePacket, lexicalKeywordHits, KEYWORD_GROUPS, CAPTURE_POLICY_VERSION } from './lib/teaching-v2-capture.mjs';
import { validatePacketIntegrity, sha256Bytes } from './lib/teaching-v2-contract.mjs';
import { loadCalibrationWork, loadRegressionWork, derivePlan, b2Sources, workKey, PLAN_FILE, SELECTION_FILE, REGRESSIONS } from './lib/teaching-v2-inputs.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const EVIDENCE = val('--evidence-root', 'data/incoming/vision-calibration');
const OUT = val('--out', 'data/incoming/teaching-v2');
const SNAP = join(OUT, 'snapshots'), PACKETS = join(OUT, 'phase-a', 'packets'), REG = join(OUT, 'regressions');
const VETTED_FILE = 'tasks/teaching-v2-phase-a/vetted-urls.json';
const COVERAGE_FILE = 'tasks/teaching-v2-phase-a/packet-coverage.json';
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`); };


function loadAllWorks(plan) {
  const cal = plan.order.map(id => loadCalibrationWork(id, { evidenceRoot: EVIDENCE }));
  const reg = plan.regressions.filter(r => !plan.order.includes(r.id)).flatMap(r => {
    const dir = join(REG, r.label);
    return existsSync(dir) ? [loadRegressionWork(dir, r)] : [];
  });
  return { cal, reg };
}
function planOrDerive() {
  const sel = JSON.parse(readFileSync(SELECTION_FILE, 'utf8'));
  const derived = derivePlan(sel, { regressions: REGRESSIONS });
  if (existsSync(PLAN_FILE)) {
    const frozen = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
    if (stableJson({ ...frozen, frozenAt: null }) !== stableJson({ ...derived, frozenAt: null })) throw new Error(`${PLAN_FILE} differs from the deterministic derivation; changes must be logged as a new plan version`);
    return frozen;
  }
  const plan = { ...derived, frozenAt: '2026-11-20' };
  writeJson(PLAN_FILE, plan);
  console.log(`froze ${PLAN_FILE}`);
  return plan;
}

function importRegressions() {
  const audit = val('--audit-inputs'), research = val('--research-evidence');
  if (!audit || !research) throw new Error('--import-regressions needs --audit-inputs and --research-evidence');
  let n = 0;
  for (const r of REGRESSIONS) {
    const src = r.set === 'editorial-audit' ? join(audit, r.caseNo) : join(research, r.caseNo);
    if (!existsSync(src)) { console.log(`missing ${r.label} at ${src}`); continue; }
    const dst = join(REG, r.label); mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const f of ['b0.json', 'catalog.json', 'b1.json', 'b2.json', 'b3.json', 'b3-boxes.json', 'image.jpg', 'manifest.json', 'image-receipt.json']) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dst, f));
    const m = existsSync(join(src, 'manifest.json')) ? JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')) : {};
    const got = m.id || (existsSync(join(src, 'catalog.json')) ? JSON.parse(readFileSync(join(src, 'catalog.json'), 'utf8')).id : null);
    if (got !== r.id) throw new Error(`${r.label}: imported evidence binds ${got}, expected ${r.id}`);
    writeJson(join(dst, 'import-receipt.json'), { label: r.label, id: r.id, from: src, evidenceBranchTree: m.treeSha ?? null, files: readdirSync(dst).filter(f => f !== 'import-receipt.json').map(f => ({ f, sha256: sha256Bytes(readFileSync(join(dst, f))) })) });
    n++;
  }
  console.log(`imported ${n}/${REGRESSIONS.length} regression cases into ${REG}`);
}

function vetAll(plan) {
  const { cal, reg } = loadAllWorks(plan);
  const works = [...cal, ...reg].map(w => ({ id: w.id, origin: w.origin, title: w.catalog?.title ?? '', ...vetUrls({ workId: w.id, b2Sources: b2Sources(w.b2) }) }));
  const out = { version: 'teachingV2VettedUrls/1', rules: works[0]?.rules, note: 'Deterministic host rules over the catalog-id holding record and the URLs an earlier B2 actually fetched. Commercial, aggregator and Wikidata entity pages are leads, never captured. Labels never grant authority. Owner/Codex may strike any URL here before --fetch.', works: works.map(w => ({ id: w.id, origin: w.origin, title: w.title, vetted: w.vetted, decisions: w.decisions })) };
  writeJson(VETTED_FILE, out);
  const n = out.works.reduce((k, w) => k + w.vetted.length, 0);
  console.log(`vetted ${n} URLs across ${out.works.length} works -> ${VETTED_FILE}`);
  return out;
}

async function fetchAll() {
  const vet = JSON.parse(readFileSync(VETTED_FILE, 'utf8'));
  const { captureUrl } = createSourceCapture();
  const urls = [...new Set(vet.works.flatMap(w => w.vetted.map(v => v.url)))];
  let ok = 0, skipped = 0; const failures = [];
  for (const url of urls) {
    if (readSnapshot(SNAP, url)) { skipped++; continue; }
    await new Promise(r => setTimeout(r, Number(val('--delay-ms', '700')))); // gentle on museum hosts (429s retry on a later, slower run)
    const cap = await captureUrl(url);
    const meta = persistSnapshot(SNAP, cap);
    if (meta.ok) ok++; else failures.push(`${meta.error} ${url}`);
    console.log(`${meta.ok ? 'ok  ' : 'FAIL'} ${meta.ok ? meta.bytes + 'B' : meta.error} ${url}`);
  }
  console.log(`capture ${CAPTURE_POLICY_VERSION}: ${ok} new, ${skipped} already snapshotted, ${failures.length} failed of ${urls.length}`);
}

function buildAll(plan) {
  const vet = JSON.parse(readFileSync(VETTED_FILE, 'utf8'));
  const byId = new Map(vet.works.map(w => [w.id, w]));
  const { cal, reg } = loadAllWorks(plan);
  const rows = []; mkdirSync(PACKETS, { recursive: true, mode: 0o700 });
  for (const w of [...cal, ...reg]) {
    const v = byId.get(w.id); if (!v) throw new Error(`${w.id}: not in ${VETTED_FILE}; re-run the plan step`);
    const snapshots = {}; for (const u of v.vetted) { const s = readSnapshot(SNAP, u.url); if (s) snapshots[u.url] = s; }
    const { packet, texts } = assemblePacket({ workId: w.id, catalogId: w.catalog?.catalogId ?? w.id, vetted: v.vetted, snapshots });
    const integ = validatePacketIntegrity(packet, texts);
    if (!integ.ok) throw new Error(`${w.id}: packet integrity failed: ${integ.errors.slice(0, 3).join('; ')}`);
    writeJson(join(PACKETS, `${workKey(w.id)}.json`), packet);
    writeJson(join(PACKETS, `${workKey(w.id)}.texts.json`), { workId: w.id, packetSha256: packet.packetSha256, texts });
    const lex = lexicalKeywordHits(packet, w.catalog);
    const captured = packet.sources.filter(s => s.status === 'captured');
    rows.push({ id: w.id, origin: w.origin, flags: plan.flags[w.id] || null, sources: packet.sources.length, captured: captured.length, chars: integ.chars, sections: packet.sources.reduce((n, s) => n + s.sections.length, 0), holdingRecordCaptured: captured.some(s => s.kind === 'holdingInstitution'), onlyReferenceCaptured: captured.length > 0 && captured.every(s => s.kind === 'reference'), extractionGaps: packet.gaps.filter(g => /extraction left out/.test(g.reason)).length, lexicalKeywordHits: lex, packetSha256: packet.packetSha256 });
  }
  // Review finding 17: report the all-50 operational set, the gold-contaminated works and the non-gold evaluation
  // works separately; keyword hits are renamed and are never coverage.
  const ALL_FOUR = ['titleWord', 'depictionWords', 'useWords', 'makingWords'];
  const stats = rs => ({ works: rs.length, withAnyCapturedText: rs.filter(r => r.captured > 0).length, withHoldingRecord: rs.filter(r => r.holdingRecordCaptured).length, onlyReferenceCaptured: rs.filter(r => r.onlyReferenceCaptured).length,
    withExtractionGaps: rs.filter(r => r.extractionGaps).length, totalChars: rs.reduce((n, r) => n + r.chars, 0),
    worksWithKeywordHits: Object.fromEntries(['titleWord', ...Object.keys(KEYWORD_GROUPS)].map(g => [g, rs.filter(r => r.lexicalKeywordHits[g] > 0).length])),
    worksWithAllFourKeywordGroups: rs.filter(r => ALL_FOUR.every(g => r.lexicalKeywordHits[g] > 0)).length });
  const calRows = rows.filter(r => r.origin.startsWith('calibration'));
  const gold = calRows.filter(r => r.flags?.goldOverlap), nonGold = calRows.filter(r => !r.flags?.goldOverlap);
  const summary = {
    version: 'teachingV2PacketCoverage/2',
    caveat: 'Capture and keyword counts only. A keyword hit means a captured section contains a word from a group (titleWord = a title word of 5+ letters; allFour = titleWord, depictionWords, useWords, makingWords); it is NOT identity, subject, function, context or mechanism coverage. W must establish each essential from the text and V checks it. onlyReferenceCaptured packets (e.g. Wikipedia alone) cannot be sole evidence for substantive historical teaching (design §3.2).',
    calibration: { all50: stats(calRows), goldContaminated: { ids: gold.map(r => r.id), ...stats(gold) }, nonGold: stats(nonGold) },
    regressions: stats(rows.filter(r => !r.origin.startsWith('calibration'))),
    rows,
  };
  writeJson(COVERAGE_FILE, summary);
  console.log(JSON.stringify({ calibration: summary.calibration, regressions: summary.regressions }, null, 1));
  console.log(`packets -> ${PACKETS}; coverage -> ${COVERAGE_FILE}`);
}

async function main() {
  if (has('--import-regressions')) { importRegressions(); return; }
  const plan = planOrDerive();
  if (has('--fetch')) { await fetchAll(); return; }
  if (has('--build')) { buildAll(plan); return; }
  vetAll(plan);
}
main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
