// Regressions for the player-copy production-language leak detector (VSD-024). Uses the ACTUAL cleveland170810
// leak and the historical Neck Amphora "the prompt" leak, and guards against ordinary-language false positives.
import assert from 'node:assert';
import { detectLeaks, hasLeak, scanTeachEntry } from '../scripts/lib/public-output-leak.mjs';

const tests = []; const t = (n, fn) => tests.push({ n, fn });

// --- real leaks that MUST be caught ---
t('catches the actual cleveland170810 "B3 visual verification confirms" leak', () => {
  const real = "Nastaliq is the flowing cursive script developed in Persia. B3 visual verification confirms all four diagnostic markers: descending diagonal baseline, extended horizontal strokes, dramatic size contrast, and rounded fluid letterforms.";
  assert.ok(hasLeak(real), 'must flag the B3 visual-verification leak');
  const labels = detectLeaks(real).map((l) => l.label);
  assert.ok(labels.includes('visual-verification') || labels.includes('stage-verification'), 'labels the leak');
});
t('catches the historical Neck Amphora "the prompt does not give" leak', () => {
  const real = "The prompt does not give a secure name, so it is best to describe what is visible on the vase.";
  assert.ok(hasLeak(real), 'must flag "the prompt does not give"');
  assert.ok(detectLeaks(real).some((l) => l.label === 'the-prompt'), 'labels the-prompt');
});
t('catches the metadata/record/catalog/title-as-input family', () => {
  for (const s of [
    'The metadata does not give a physical medium.',
    'The record does not give a specific material.',
    'The title does not give us a name.',
    'Based on the catalog, the work is undated.',
  ]) assert.ok(hasLeak(s), `must flag: ${s}`);
});
t('catches "in the catalog" and catalog/record/metadata data-source verbs (VSD-025)', () => {
  for (const s of [
    'This form appears twice in the catalog under different numbers.',
    'The catalog says the medium is ink.',
    'The catalogue calls it a votive plaque.',
    'The record says the work is undated.',
    'The metadata says the sitter is unknown.',
  ]) assert.ok(hasLeak(s), `must flag: ${s}`);
});
t('catches museum-record/museum-as-source, using the exact Door Plaque phrases (VSD-026)', () => {
  for (const s of [
    'The museum record indicates the object was probably once fire-gilded.',   // exact Door Plaque Q3
    'The original function — a question the museum explicitly leaves open — depends on the edge.', // exact Door Plaque Q4
    "The museum's catalogue lists the medium as bronze.",
    'The museum does not specify a findspot.',
  ]) assert.ok(hasLeak(s), `must flag: ${s}`);
});
t('preserves legitimate museum/record/title/model prose (VSD-026)', () => {
  for (const s of [
    'The plaque entered the museum in 2013 and is displayed in the Byzantine gallery.',
    "It is held in the museum's permanent collection.",
    'The museum acquired the roundel from a private collection.',
    'The historical record of the reign is fragmentary.',
    'The title suggests a mythological subject.',
    'The model wears a laurel wreath.',
  ]) assert.ok(!hasLeak(s), `must NOT flag: ${s}`);
});
t('preserves legitimate title/record/model phrases (VSD-025)', () => {
  for (const s of [
    'The title suggests a mythological subject.',
    'The model wears a laurel wreath.',
    'The historical record of the reign is fragmentary.',
    'It appears in the catalogue raisonné tradition of the 1970s.',
  ]) assert.ok(!hasLeak(s), `must NOT flag: ${s}`);
});
t('catches AI/pipeline references', () => {
  for (const s of ['The vision model identified a saint.', 'the language model was asked to infer the date', 'confirmed in the synthesis stage', 'after hydration of the delta']) assert.ok(hasLeak(s), `must flag: ${s}`);
});

// --- ordinary art language that MUST NOT false-positive ---
t('does NOT flag ordinary art language', () => {
  for (const s of [
    'The model wears a laurel wreath and gazes to the left.',      // "model" = sitter
    'The title suggests a mythological subject.',                   // "title suggests" is legal
    'The record of Christ’s life unfolds across the panels.',  // "the record of" is legal
    'A prompt gesture of the hand directs the eye downward.',       // "prompt" as adjective
    'Scholars sought verification of the sitter’s identity.',  // "verification of" (not "visual"/"confirms")
    'Red figures against a glossy black ground point to Athenian red-figure ware.',
    'The catalogue raisonné tradition places this near 1550.', // "catalogue raisonné" not "the catalog does not give"
  ]) assert.ok(!hasLeak(s), `must NOT flag: ${s}`);
});

// --- scanTeachEntry across fields ---
t('scanTeachEntry finds leaks in why/cues/notes/guide and reports the field', () => {
  const entry = {
    why: 'A calm portrait.',
    cues: ['Soft shadows → sfumato'],
    notes: [{ head: 'Nastaliq', body: 'B3 visual verification confirms the diagonal baseline.' }],
    guide: [{ q: 'What is this?', a: 'The metadata does not give a maker.' }],
  };
  const hits = scanTeachEntry(entry);
  const fields = hits.map((h) => h.field);
  assert.ok(fields.some((f) => f.startsWith('notes[0]')), 'flags the note body');
  assert.ok(fields.some((f) => f.startsWith('guide[0]')), 'flags the guide answer');
  assert.equal(scanTeachEntry({ why: 'A calm portrait.', cues: [], notes: [], guide: [] }).length, 0, 'clean entry has no hits');
});

let pass = 0;
for (const { n, fn } of tests) { try { fn(); pass++; console.log('ok -', n); } catch (e) { console.error('FAIL -', n, '\n   ', e.message); process.exitCode = 1; } }
console.log(`\n${pass} checks passed`);
