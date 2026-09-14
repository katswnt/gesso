// READ-ONLY approval-candidate preparation for a Pass B calibration run (VSD-023). It NEVER mutates the
// quarantined B4 completion/raw/transcript. It builds candidate APPROVED records (the B4 body with any
// owner why-edit applied to the OUTPUT only), verifies each against the current strict schema, and reports
// per-component readiness, deferred/rejected fields, the mandatory why-edits, and the exact proposed
// production changes vs data/teach-works.js + data/hotspots.js. It does NOT approve and does NOT merge.
// Usage: node scripts/pass-b-approval-prep.mjs [<run-dir>]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './lib/vision-legacy.mjs';
import { validateStageBody } from './lib/vision-content-schema.mjs';
import { completionKey } from './lib/vision-content-capture.mjs';

const RUN = process.argv[2] || 'data/incoming/vision-calibration/cal50-0a47b6f7f332';

// Owner-proposed editor edits, applied ONLY to the approved output (never the preserved B4 completion).
// These trim the two whys that exceed the restored 500-char player-copy cap; meaning preserved, provenance
// and flourishes dropped, no em-dashes.
const WHY_EDITS = {
  cleveland120847: "A small bronze plaque, probably once gilded to resemble solid gold, shows an unnamed saint in the severe frontal style of sixth-century Byzantine Syria. Rigid symmetry and enlarged, unblinking eyes convey spiritual authority rather than lifelike naturalism. Its mottled green and rust surface is corrosion; originally, this devotional or protective object would have looked luminous.",
  cleveland170810: "A Persian calligraphy page made around 1550 by Faqir Ali, copying a ghazal (lyric poem) by Badr al-Din Hilali Jaghata'i. The flowing nastaliq script runs diagonally through diamond-shaped panels, a virtuoso design intended for an album. About 150 years later, a collector added the decorative borders and remounted the page upside down, showing how the object continued to change as it passed between owners.",
};

const loadGlobal = (path, name) => { const w = {}; new Function('window', readFileSync(path, 'utf8'))(w); return w[name]; };
const teach = (loadGlobal('data/teach-works.js', 'ARTEFACTUM_CUES') || {}).work || {};
const hotspots = loadGlobal('data/hotspots.js', 'ARTEFACTUM_HOTSPOTS') || {};

const manifest = JSON.parse(readFileSync(join(RUN, 'run-manifest.json'), 'utf8'));
const ids = (manifest.selection || []).map(w => w.id);
const COMPONENTS = ['why', 'cues', 'notes', 'hotspots', 'guide'];

const report = {
  runId: manifest.runId, generatedNote: 'read-only approval-candidate prep; nothing approved or merged',
  works: ids.length,
  approvalCandidateByComponent: Object.fromEntries(COMPONENTS.map(c => [c, { present: 0, strictValidRecord: 0 }])),
  strictValidRecords: 0, rejected: [], deferredResolved: [], mandatoryWhyEdits: [],
  proposedProductionChanges: { newTeachEntries: 0, changedTeachEntries: 0, newHotspotEntries: 0, changedHotspotEntries: 0, perWork: [] },
};

for (const id of ids) {
  const dir = join(RUN, 'works', sha256(id).slice(0, 24));
  const cpath = join(dir, 'completions', `b4-${completionKey('B4', id)}.json`);
  const b4 = JSON.parse(readFileSync(cpath, 'utf8')).body; // READ ONLY
  // Candidate approved record = the B4 body with any owner why-edit applied to the OUTPUT only.
  const candidate = JSON.parse(JSON.stringify(b4));
  const edited = Object.prototype.hasOwnProperty.call(WHY_EDITS, id);
  if (edited) {
    report.mandatoryWhyEdits.push({ id, originalLength: (b4.proposedWhy || '').length, trimmedLength: WHY_EDITS[id].length, trimmedWhy: WHY_EDITS[id] });
    report.deferredResolved.push({ id, field: 'proposedWhy', reason: `over ${500}-char player cap (${(b4.proposedWhy || '').length}); resolved by owner why-edit to ${WHY_EDITS[id].length}` });
    candidate.proposedWhy = WHY_EDITS[id];
  }
  const val = validateStageBody('B4', candidate);
  if (val.ok) {
    report.strictValidRecords++;
    for (const c of COMPONENTS) {
      const present = c === 'why' ? typeof candidate.proposedWhy === 'string'
        : c === 'cues' ? Array.isArray(candidate.proposedCues) && candidate.proposedCues.length > 0
          : Array.isArray(candidate[c]) && candidate[c].length > 0;
      if (present) report.approvalCandidateByComponent[c].present++;
      if (present) report.approvalCandidateByComponent[c].strictValidRecord++;
    }
  } else {
    report.rejected.push({ id, reasons: val.errors || [] });
  }
  // Proposed production changes: teach-works entry {why,cues,notes,guide} + hotspots entry.
  const teachEntry = { why: candidate.proposedWhy, cues: candidate.proposedCues, notes: candidate.notes, guide: candidate.guide };
  const curTeach = teach[id];
  const teachStatus = !curTeach ? 'new' : (sha256(JSON.stringify([curTeach.why, curTeach.cues, curTeach.notes, curTeach.guide])) !== sha256(JSON.stringify([teachEntry.why, teachEntry.cues, teachEntry.notes, teachEntry.guide])) ? 'changed' : 'same');
  const curHot = hotspots[id];
  const hotStatus = !curHot ? 'new' : (sha256(JSON.stringify(curHot)) !== sha256(JSON.stringify(candidate.hotspots)) ? 'changed' : 'same');
  if (teachStatus === 'new') report.proposedProductionChanges.newTeachEntries++; else if (teachStatus === 'changed') report.proposedProductionChanges.changedTeachEntries++;
  if (hotStatus === 'new') report.proposedProductionChanges.newHotspotEntries++; else if (hotStatus === 'changed') report.proposedProductionChanges.changedHotspotEntries++;
  report.proposedProductionChanges.perWork.push({ id, teach: teachStatus, hotspots: hotStatus, edited, strictValid: val.ok });
}

const outPath = join(RUN, 'approval-candidate.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
console.log(`Approval-candidate prep: ${report.works} works`);
console.log(`  strict-valid candidate records: ${report.strictValidRecords}/${report.works} | rejected: ${report.rejected.length}`);
console.log(`  by component (present / strict-valid): ${COMPONENTS.map(c => `${c} ${report.approvalCandidateByComponent[c].present}`).join(' | ')}`);
console.log(`  mandatory why-edits: ${report.mandatoryWhyEdits.map(e => `${e.id} ${e.originalLength}->${e.trimmedLength}`).join(', ')}`);
console.log(`  proposed production: teach new ${report.proposedProductionChanges.newTeachEntries}/changed ${report.proposedProductionChanges.changedTeachEntries} | hotspots new ${report.proposedProductionChanges.newHotspotEntries}/changed ${report.proposedProductionChanges.changedHotspotEntries}`);
if (report.rejected.length) console.log('  REJECTED:', JSON.stringify(report.rejected.slice(0, 20)));
console.log(`report: ${outPath}`);
