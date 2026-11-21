// Teaching-v2 Phase A 20-work coordinate diagnostic harness (VSD-093; design draft 2 §5). DEFAULT = DRY RUN.
//   node scripts/teaching-v2-pin-diagnostic.mjs --run <tv2a-runId>          # dry run: prompts + hashes, no calls
//   node scripts/teaching-v2-pin-diagnostic.mjs --run <tv2a-runId> --live   # TEACHING_V2_LIVE=1, after review + owner OK
// Uses plan.pinDiagnostic (frozen, the first 20 of the plan order). A work needs a valid W draft with at least
// one dot; others are reported, not replaced. Experiment calls (B3D + 2 fresh V) are counted separately.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execToFile } from './lib/pass-b-exec-to-file.mjs';
import { makePacer } from './lib/pass-b-pacing.mjs';
import { loadGoldBundle, LOCALIZATION_WIRE, VERIFICATION_NO_REPLACEMENT_WIRE, verificationOutcome } from './lib/teaching-v2-contract.mjs';
import { buildLocalizePrompt, promptDigest } from './lib/teaching-v2-prompts.mjs';
import { buildConfinedCommand, runConfined } from './lib/teaching-v2-stage.mjs';
import { workContext, verifierPromptFor } from './lib/teaching-v2-controller.mjs';
import { projectLesson, renderPreviewPage } from './lib/teaching-v2-projection.mjs';
import { diagnosticRequests, validateLocalization, b3Lesson, compareMethods, blindOrder, EXPERIMENT_CALLS_PER_WORK, PIN_DIAGNOSTIC_VERSION } from './lib/teaching-v2-pins.mjs';
import { loadCalibrationWork, workKey, PLAN_FILE } from './lib/teaching-v2-inputs.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OUT = val('--out', 'data/incoming/teaching-v2'), EVIDENCE = val('--evidence-root', 'data/incoming/vision-calibration');
const RUN = val('--run'); if (!RUN) { console.error('need --run <tv2a-runId>'); process.exit(2); }
const RUN_DIR = join(OUT, 'phase-a', 'runs', RUN), DIAG = join(RUN_DIR, 'pin-diagnostic');
const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
const readJson = p => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o600 }); };
const loadPacket = id => { const p = readJson(join(OUT, 'phase-a', 'packets', `${workKey(id)}.json`)); if (!p) throw new Error(`${id}: no packet`); return p; };

async function main() {
  const gold = loadGoldBundle('.');
  const LIVE = has('--live');
  if (LIVE && (process.env.TEACHING_V2_LIVE !== '1' || process.env.CI)) { console.error('REFUSED: --live needs TEACHING_V2_LIVE=1 (after Codex code review and an owner OK) and not CI.'); process.exit(2); }
  const pacer = LIVE ? makePacer({ logPath: join(OUT, 'phase-a', 'usage.jsonl'), maxCalls: plan.pinDiagnostic.length * EXPERIMENT_CALLS_PER_WORK, statePath: join(DIAG, 'call-budget.json') }) : null;
  const rows = [], pairs = [], mapping = {};
  for (const id of plan.pinDiagnostic) {
    const s = readJson(join(RUN_DIR, 'works', workKey(id), 'state.json'));
    const wr = s?.artifacts?.writer?.valid ? s.artifacts.writer.result : null;
    const draft = s?.final?.draft || (wr && wr.draft.status === 'candidate' ? wr.draft : null);
    if (!draft) { rows.push({ id, status: s ? `no valid candidate draft (${s.status})` : 'W not run yet' }); console.log(`${id}: ${rows.at(-1).status}`); continue; }
    const requests = diagnosticRequests(draft);
    if (!requests.length) { rows.push({ id, status: 'no dots (nothing to localize)' }); console.log(`${id}: no dots`); continue; }
    const work = loadCalibrationWork(id, { evidenceRoot: EVIDENCE }); const packet = loadPacket(id);
    const imageFile = `${work.image.sha256}.${work.image.ext}`;
    const p = buildLocalizePrompt({ requests, imageFile }); const d = promptDigest(p);
    console.log(`${id}: ${requests.length} dot(s)\n  B3D sha256=${d.sha256} bytes=${d.bytes}`);
    const wdir = join(DIAG, work.key); mkdirSync(wdir, { recursive: true, mode: 0o700 }); writeFileSync(join(wdir, 'B3D.prompt.txt'), p);
    if (!LIVE) { rows.push({ id, status: 'dry-run', dots: requests.length, b3dPrompt: d }); continue; }
    const call = async (stage, promptText, wireSchema) => {
      const g = pacer.check(); if (!g.go) throw new Error(`pacing: ${g.reason}`);
      const r = await runConfined(buildConfinedCommand({ stage, promptText, imageFile, wireSchema }), { imagePath: work.image.path, execute: execToFile });
      writeFileSync(join(wdir, `${stage}-${Date.now()}.transcript.jsonl`), r.stdout, { mode: 0o600 });
      if (r.kind !== 'ok') throw new Error(`${id}/${stage}: ${r.kind} ${r.reason}`); // experiment: no retries
      return r;
    };
    const loc = (await call('B3D', p, LOCALIZATION_WIRE)).structured;
    const lv = validateLocalization(loc, requests);
    if (!lv.ok) { rows.push({ id, status: 'B3D invalid', errors: lv.errors }); continue; }
    const bLesson = b3Lesson(draft.lesson, loc, requests);
    const ctx = workContext({ work, packet, gold });
    const verdicts = {};
    for (const [method, lesson] of [['W', draft.lesson], ['B3', bLesson]]) {
      const dr = { ...draft, lesson };
      const r = await call('V', verifierPromptFor(ctx, { allowReplacement: false, dossier: s.artifacts.writer.result.dossier, draft: dr }), VERIFICATION_NO_REPLACEMENT_WIRE);
      verdicts[method] = { pins: r.structured.pins, outcome: verificationOutcome(r.structured, { draft: dr, allowReplacement: false, packet, dossier: s.artifacts.writer.result.dossier }), usage: r.usage };
    }
    const cmp = compareMethods(draft.lesson, bLesson);
    rows.push({ id, status: 'measured', ...cmp, verdicts });
    const order = blindOrder(id); mapping[id] = order;
    const rel = `img/${imageFile}`; mkdirSync(join(DIAG, 'img'), { recursive: true }); if (!existsSync(join(DIAG, rel))) copyFileSync(work.image.path, join(DIAG, rel));
    order.forEach((m, k) => pairs.push({ id: `${id} · placement ${'AB'[k]}`, title: work.catalog.title, artist: work.catalog.artist, date: work.catalog.date, imageRel: rel, status: `placement ${'AB'[k]}`, projection: projectLesson(m === 'W' ? draft.lesson : bLesson) }));
  }
  writeJson(join(DIAG, 'report.json'), { version: PIN_DIAGNOSTIC_VERSION, run: RUN, live: LIVE, works: plan.pinDiagnostic.length, experimentCallCap: plan.pinDiagnostic.length * EXPERIMENT_CALLS_PER_WORK, rows });
  if (pairs.length) { writeFileSync(join(DIAG, 'blind-review.html'), renderPreviewPage({ kind: 'faithful', works: pairs, generatedFrom: 'Blind placement review: score target identity and placement for each dot; method labels are hidden.' })); writeJson(join(DIAG, 'mapping-private.json'), { seed: 'see teaching-v2-pins.mjs BLIND_SEED', mapping }); }
  console.log(`${LIVE ? 'LIVE' : 'DRY RUN'} pin diagnostic -> ${join(DIAG, 'report.json')}${LIVE ? '' : ' (no model calls)'}`);
}
main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
