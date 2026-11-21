// Teaching-v2 Phase A 20-work coordinate diagnostic harness (VSD-093; design draft 2 §5). DEFAULT = DRY RUN.
//   node scripts/teaching-v2-pin-diagnostic.mjs --run <tv2a-runId>          # dry run: prompts + hashes, no calls
//   node scripts/teaching-v2-pin-diagnostic.mjs --run <tv2a-runId> --live   # REFUSED (review findings 11/16 open)
// Uses plan.pinDiagnostic (frozen, the first 20 of the plan order). A work needs a valid W draft with at least
// one dot; others are reported, not replaced. Experiment calls (B3D + 2 fresh V) are counted separately.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocalizePrompt, promptDigest } from './lib/teaching-v2-prompts.mjs';
import { diagnosticRequests, EXPERIMENT_CALLS_PER_WORK, PIN_DIAGNOSTIC_VERSION } from './lib/teaching-v2-pins.mjs';
import { loadCalibrationWork, workKey, PLAN_FILE } from './lib/teaching-v2-inputs.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
// Review findings 11 and 16 (2026-11-20) are not fixed here: the harness has no durable per-arm reservations or
// resume, records no usage observations, does not use the shared lease/pacer/fatal latch, derives its "secret" A/B
// order from a public constant, may score a V replacement as the W arm, leaves W's anchor boxes under B3 points,
// and its pages expose verdicts. Fixing that needs a Codex-owned external blinding/mapping and review bundle, which
// is outside this branch. So it REFUSES to spend calls; the offline dry run below still writes prompts only.
const LIVE_REFUSAL = 'REFUSED: the pin diagnostic cannot run live. Review findings 11 and 16 are open: no durable per-arm reservations or resume, no usage observations or shared lease/pacer/fatal latch, and no independent blinding (public A/B seed, possible V-replacement arm, inconsistent B3 anchor boxes, verdicts visible). It needs a reworked harness with Codex-owned blinding before any experiment call.';
if (has('--live')) { console.error(LIVE_REFUSAL); process.exit(2); }
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OUT = val('--out', 'data/incoming/teaching-v2'), EVIDENCE = val('--evidence-root', 'data/incoming/vision-calibration');
const RUN = val('--run'); if (!RUN) { console.error('need --run <tv2a-runId>'); process.exit(2); }
const RUN_DIR = join(OUT, 'phase-a', 'runs', RUN), DIAG = join(RUN_DIR, 'pin-diagnostic');
const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
const readJson = p => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o600 }); };

async function main() {
  const rows = [];
  for (const id of plan.pinDiagnostic) {
    const s = readJson(join(RUN_DIR, 'works', workKey(id), 'state.json'));
    const wr = s?.artifacts?.writer?.valid ? s.artifacts.writer.result : null;
    const draft = wr && wr.draft.status === 'candidate' ? wr.draft : null; // the W arm is W's own draft, never a V replacement
    if (!draft) { rows.push({ id, status: s ? `no valid W candidate draft (${s.status})` : 'W not run yet' }); console.log(`${id}: ${rows.at(-1).status}`); continue; }
    const requests = diagnosticRequests(draft);
    if (!requests.length) { rows.push({ id, status: 'no dots (nothing to localize)' }); console.log(`${id}: no dots`); continue; }
    const work = loadCalibrationWork(id, { evidenceRoot: EVIDENCE });
    const imageFile = `${work.image.sha256}.${work.image.ext}`;
    const p = buildLocalizePrompt({ requests, imageFile }); const d = promptDigest(p);
    console.log(`${id}: ${requests.length} dot(s)\n  B3D sha256=${d.sha256} bytes=${d.bytes}`);
    const wdir = join(DIAG, work.key); mkdirSync(wdir, { recursive: true, mode: 0o700 }); writeFileSync(join(wdir, 'B3D.prompt.txt'), p);
    rows.push({ id, status: 'dry-run', dots: requests.length, b3dPrompt: d });
  }
  writeJson(join(DIAG, 'report.json'), { version: PIN_DIAGNOSTIC_VERSION, run: RUN, live: false, works: plan.pinDiagnostic.length, experimentCallCap: plan.pinDiagnostic.length * EXPERIMENT_CALLS_PER_WORK, refusal: LIVE_REFUSAL, rows });
  console.log(`DRY RUN pin diagnostic -> ${join(DIAG, 'report.json')} (no model calls; live runs are refused)`);
}
main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
