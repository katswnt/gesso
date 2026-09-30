// PROPOSAL-ONLY (offline; NO model calls, NO production write, NO activation write, NO effective owner
// decisions/resolutions, NO ownerApproved). For each of the two works it presents to the owner: the exact
// corrected copy (why/cues/notes/guide) proposed as owner edits, the coupled hotspots -> [] change (notes and
// hotspots must be approved together), the authoritative spans that ground it, and an UNRESOLVED owner-review
// template enumerating every component decision, conflict, and sealed blocked claim the owner would have to
// make/resolve. NOTHING here creates an effective decision; that happens only when the owner explicitly
// approves this exact artifact. The active reconciliation pointers remain on the empty-decision/blocked sets.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './lib/vision-legacy.mjs';
import { projectToProduction, surfaceCouplingViolation } from './lib/pass-b-approval.mjs';
import { loadReconciliationSources, buildClaimBundle, validateClaimBundle, buildDecisionArtifact, auditReconciliation, claimBundleSha256 } from './lib/pass-b-reconciliation.mjs';
import { loadCanonicalFindings, findingsForWork } from './lib/pass-b-blocked-findings.mjs';

const RUN_ID = 'cr2-af3d6ed79c1c';
const RUN_DIR = join('data/incoming/vision-calibration', RUN_ID);
const OUT_DIR = join(RUN_DIR, 'owner-review');
const APPROVED_FIELDS = ['why', 'cues', 'guide', 'notes', 'hotspots']; // notes+hotspots coupled; hotspots cleared to []

const CANDIDATES = {
  'wikidata:Q16467705': {
    name: 'La Gloire',
    why: "A plaster maquette (1906) by Frédéric Brou for an unrealized monument to the writer Villiers de l'Isle-Adam. The allegory of Glory — a draped woman, below — draws the sleeping writer from the coffin above.",
    cues: ['A plaster model, not bronze or wood', 'An allegory of literary glory'],
    notes: [
      { head: 'Who the two figures are', body: "The Musée Carnavalet record describes it plainly: Glory is the nude, draped woman below; Villiers de l'Isle-Adam is the man above, asleep, with a coffin. Glory draws the writer from his eternal sleep — the act the title names.", x: null, y: null },
      { head: 'An unrealized monument', body: 'This plaster (Carnavalet, inv. S 3490) is a model for a funerary monument to Villiers that was never built; the attribution to Frédéric Brou rests on Salon and monument-committee documents.', x: null, y: null },
    ],
    guide: [{ q: 'What is this, and what is it made of?', a: "A plaster maquette by Frédéric Brou for an unbuilt monument to the writer Villiers de l'Isle-Adam; the material is plaster with a patina, not carved wood." }],
    hotspots: [],
    spanArtifact: 'owner-review/lagloire-authoritative-spans.json',
    spanSummary: 'Carnavalet primary (authoritative): SUPPORTS Glory=woman/nude/draped, Villiers=asleep, coffin present; refutes figure-role-inversion. Skull/wings are only NOT MENTIONED (silence, not entailed absence) — their absence rests on the sealed audit cb-273b4c707b9c + owner adjudication. Plaster: Wikidata P186 + sealed audit (tertiary + audit; the Carnavalet public record lists no material field).',
  },
  'wikidata:Q1211814': {
    name: 'St. John Chrysostom',
    why: "An engraving (c. 1497) by Albrecht Dürer, 'The Penance of St. John Chrysostom.' It illustrates a medieval legend in which the penitent atones by crawling on the ground and refusing to look at the sky until he is absolved.",
    cues: ['A Renaissance engraving', 'A penitent-hermit legend'],
    notes: [
      { head: 'The crawling figure is a man', body: 'The figure on the ground is the human penitent of the legend, crawling on all fours as atonement — the subject of the scene, not an animal.', x: null, y: null },
      { head: "Dürer's engraved line", body: 'Fine burin crosshatching builds continuous tone and a deep landscape entirely without color, characteristic of Dürer’s mature printmaking.', x: null, y: null },
    ],
    guide: [{ q: 'Who is the figure crawling on the ground?', a: 'The human penitent of the legend, atoning by crawling on all fours — not an animal. The subject is established by the Cleveland Museum of Art record (acc. 1934.339).' }],
    hotspots: [],
    spanArtifact: 'in-run B2 span src-01 (Cleveland Museum of Art, acc. 1934.339)',
    spanSummary: 'Cleveland Museum (authoritative): establishes maker/medium/subject (Dürer engraving, The Penance of St. John Chrysostom). The human-penitent identity + no-animal also rests on the sealed audit cb-d4c407b953ac + owner adjudication. Cleveland does not localize the figure (unpinned).',
  },
};

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const findings = loadCanonicalFindings();
  const proposals = [];
  const coupling = surfaceCouplingViolation(APPROVED_FIELDS);
  if (coupling) throw new Error(`proposal violates coupling: ${coupling}`); // sanity: notes+hotspots present together

  for (const [workId, cand] of Object.entries(CANDIDATES)) {
    const sources = loadReconciliationSources(RUN_DIR, workId);
    const ownerEditsProposed = { why: cand.why, cues: cand.cues, guide: cand.guide, notes: cand.notes, hotspots: cand.hotspots };
    const projected = projectToProduction(sources.b4, ownerEditsProposed);

    // Reference bundle over the proposed corrected record (in-memory only; NOT activated, NOT written as active).
    const bundle = buildClaimBundle({ sources, projectedRecord: projected, sourceSpans: [] });
    if (!validateClaimBundle(bundle).ok) throw new Error(`${cand.name} bundle invalid`);
    // Readiness UNDER EMPTY DECISIONS (what the owner faces before deciding anything): everything unready.
    const emptyDecisions = buildDecisionArtifact({ workId, claimBundleSha256: claimBundleSha256(bundle), decisions: [] });
    const report = auditReconciliation(bundle, emptyDecisions).report;
    const sealed = findingsForWork(findings, workId);

    const template = {
      version: 'passBOwnerProposal/1', status: 'UNRESOLVED — awaiting explicit owner approval of this exact artifact',
      workId, name: cand.name, runId: RUN_ID,
      proposedCopy: { why: cand.why, cues: cand.cues, notes: cand.notes, guide: cand.guide, hotspots: cand.hotspots },
      pinning: { treatment: 'UNPINNED', hotspots: '[] (cleared)', couplingRule: 'notes and hotspots must be approved together; clearing hotspots requires an explicit owner acceptance of the hotspot-set:empty component' },
      authoritativeGrounding: { spanArtifact: cand.spanArtifact, summary: cand.spanSummary },
      ownerDecisionsRequired: report.componentReadiness
        .filter(c => APPROVED_FIELDS.includes(c.surface))
        .map(c => ({ componentId: c.componentId, surface: c.surface, currentReadiness: c.contentReadiness, ownerDecision: '' })),
      conflictsToResolve: bundle.conflicts.map(c => ({ conflictId: c.conflictId, workScope: c.workScope, left: c.left, right: c.right, modelStatus: c.modelStatus, ownerResolution: '' })),
      sealedBlockedClaimsToResolve: sealed.flatMap(f => f.blockedClaims.map(claim => ({ findingId: f.findingId, claim, ownerResolved: false, evidence: '' }))),
      effectiveDecisionsCreated: 'NONE — no authority:owner decision, no blocked-finding resolution, no activation written by this step',
    };
    const outPath = join(OUT_DIR, `${sha256(workId).slice(0, 12)}.owner-proposal.json`);
    writeFileSync(outPath, `${JSON.stringify(template, null, 1)}\n`, { mode: 0o600 });
    proposals.push({ ...cand, workId, report, template, outPath });

    console.log(`\n=== ${cand.name} (${workId}) — PROPOSAL (unresolved) ===`);
    console.log(`  WHY: ${cand.why}`);
    console.log(`  CUES: ${cand.cues.join(' | ')}`);
    cand.notes.forEach(nn => console.log(`  NOTE [${nn.head}] (UNPINNED): ${nn.body}`));
    cand.guide.forEach(g => console.log(`  GUIDE Q: ${g.q}\n         A: ${g.a}`));
    console.log(`  HOTSPOTS: [] (cleared; coupled with notes — must be approved together)`);
    console.log(`  grounding: ${cand.spanSummary}`);
    console.log(`  owner must decide ${template.ownerDecisionsRequired.length} components, resolve ${bundle.conflicts.length} conflict(s), resolve ${template.sealedBlockedClaimsToResolve.length} sealed claim(s) — ALL currently empty.`);
    console.log(`  wrote ${outPath}`);
  }
  console.log('\nNo effective owner decisions, resolutions, activations, approvals, or production writes were created.');
  console.log('Active reconciliation pointers remain on the empty-decision/blocked sets.');
  console.log('Next: owner explicitly approves an exact artifact before any effective decision is created.');
}

main();
