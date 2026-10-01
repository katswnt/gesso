// VSD-057 parity audit: the capped B1–B3 wire schemas must accept EVERY accepted (captured) corpus body, so the
// in-call schema can never bounce output the validator would keep. Also reports how many rejected/uncaptured
// bodies the schema would have bounced in-call. Exit 1 on any false rejection.
//   node scripts/pass-b-wire-parity.mjs [runDir]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const A = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const { wireSchemaFor, validateAgainstWire } = await import(`${A}/lib/pass-b-wire-schema.mjs`);
const { validateStageBody } = await import(`${A}/lib/vision-content-schema.mjs`);
const { parseStreamTranscript, transcriptFinal, b2InputFor } = await import(`${A}/lib/pass-b-calibration.mjs`);
const R = join(process.argv[2] || 'data/incoming/vision-calibration/corpus-b3-6401bc543ead', 'works');
const sha = t => createHash('sha256').update(t).digest('hex');
let ok = 0, falseRej = [], unc = 0, caught = 0, missed = {};
for (const w of readdirSync(R)) {
  const cdir = join(R, w, 'completions'), adir = join(R, w, 'attempts');
  const comps = existsSync(cdir) ? readdirSync(cdir).map(f => ({ st: f.slice(0, 2).toUpperCase(), c: JSON.parse(readFileSync(join(cdir, f), 'utf8')) })) : [];
  if (!existsSync(join(R, w, 'b0-prep.json'))) continue; const b0 = JSON.parse(readFileSync(join(R, w, 'b0-prep.json'), 'utf8'));
  const b1 = comps.find(x => x.st === 'B1')?.c.body;
  const ctx = st => st === 'B2' && b1 ? { evidenceIds: b2InputFor(b0.workId || b0.id, b0.trustedCatalog, b1).visibleSignals.map(s => s.evidenceId) } : {};
  const accepted = new Set(comps.map(x => x.c.transcriptSha256));
  for (const { st, c } of comps) { ok++; const e = validateAgainstWire(wireSchemaFor(st, ctx(st)), c.body); if (e.length) falseRej.push(`${w} ${st} ${e.slice(0, 2)}`); }
  if (!existsSync(adir)) continue;
  for (const f of readdirSync(adir).filter(n => n.endsWith('.transcript.jsonl'))) {
    const st = f.slice(0, 2).toUpperCase(), text = readFileSync(join(adir, f), 'utf8');
    if (accepted.has(sha(text))) continue;
    const body = transcriptFinal(parseStreamTranscript(text))?.structured_output; if (!body) continue;
    unc++;
    if (validateAgainstWire(wireSchemaFor(st, ctx(st)), body).length) { caught++; continue; }
    let v; try { v = validateStageBody(st, body, ctx(st)); } catch { v = { ok: false, errors: ['throw'] }; }
    const k = `${st}:${v.ok ? 'VALID (uncaptured for other reasons)' : v.errors.join(',')}`; missed[k] = (missed[k] || 0) + 1;
  }
}
console.log(`accepted ${ok}, falsely rejected ${falseRej.length}`, falseRej.slice(0, 5));
console.log(`uncaptured ${unc}, caught in-call by capped wire ${caught}`); console.log(missed);
if (falseRej.length) process.exit(1);
