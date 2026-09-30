// One-off: write the consolidated conflict-resolution ledger for the b4c run. Data-only; nothing applied/merged.
import { writeFileSync } from 'node:fs';
const RUN = 'data/incoming/vision-calibration/b4c-f45fac18da2e';

const researched = [
  { work: 'met247010', field: 'red pigment identification (cinnabar vs red ochre)', ruling: 'adopt', resolution: 'Red is cinnabar (natural vermilion, HgS).', visibleVsResearch: 'research', source: { url: 'https://www.metmuseum.org/perspectives/cinnabar-vermilion', tier: 'holding-museum publication (Met)' } },
  { work: 'met256169', field: 'kantharos iconographic association with Dionysos', ruling: 'adopt', resolution: "The kantharos is Dionysos's attribute (iconographic association) — not that this cup depicts him.", visibleVsResearch: 'research', source: { url: 'https://harvardartmuseums.org/collections/object/287350', tier: 'holding-museum object record (Harvard, "Dionysos Holding a Kantharos")' } },
  { work: 'met57329', field: 'school', ruling: 'deprioritize', resolution: 'Zeshin trained in the Maruyama-Shijo school; cut from player copy unless load-bearing (biography).', visibleVsResearch: 'research', source: { url: 'https://en.wikipedia.org/wiki/Shibata_Zeshin', tier: 'tertiary (needs museum/scholarly upgrade if retained)' } },
  { work: 'wd:Q7166365', field: 'location / where made', ruling: 'deprioritize', resolution: 'Made in Carmel, California; cut unless load-bearing (location fact).', visibleVsResearch: 'research', source: { url: 'https://en.wikipedia.org/wiki/Pepper_No._30', tier: 'tertiary (needs upgrade if retained)' } },
  { work: 'wikidata:Q17021261', field: 'secondAttribute', ruling: 'adopt', resolution: 'Sickle (harpe) in the right hand, mace in the left — known iconography, not a visible label.', visibleVsResearch: 'research', source: { url: 'https://www.britishmuseum.org/collection/object/W_1851-0902-507', tier: 'holding-museum record cited but page Cloudflare-blocked; confirmed via BM snippet + Wikipedia' } },
  { work: 'wikidata:Q48881623', field: 'production context — imperial kiln', ruling: 'drop-imperial-claim (exceeds owner hedge; primary record does not support)', resolution: "Drop 'imperial kiln'. Keep: Guangxu-reign (1875-1908) marked porcelain, cong/zong form. NPM record shows only the reign mark; no imperial-kiln / Jingdezhen.", visibleVsResearch: 'research', source: { url: 'https://digitalarchive.npm.gov.tw/Antique/Content?uid=33169&Dept=U', tier: 'holding-museum object record (National Palace Museum, 故瓷014726)' } },
  { work: 'wikidata:Q4950181', field: 'redCoatIdentity', ruling: 'adopt', resolution: 'Red-coated figures are postmen (GPO postal carriers), not soldiers.', visibleVsResearch: 'research', source: { url: 'https://www.emelbourne.net.au/biogs/EM00220b.htm', tier: 'reference encyclopedia (NGA holding record 403-blocked)' } },
  { work: 'wikidata:Q56825917', field: 'relocationYear', ruling: 'adopt', resolution: 'Sculpture relocated to Vladslo in 1956 (with the graves); 1954 is tertiary confusion.', visibleVsResearch: 'research', source: { url: 'https://kriegsgraeberstaetten.volksbund.de/friedhof/vladslo', tier: 'official cemetery authority (Volksbund)' } },
  { work: 'http://www.wikidata.org/entity/Q63247474', field: 'divine beard type', ruling: 'hedge+correct (refines owner ruling)', resolution: 'Museum identifies it as Amenemhat III DIVINIZED (deified king). Beard is PRESERVED (not a stub) but type not characterized — do not assert straight vs curved; divinity comes from the catalog, not the beard.', visibleVsResearch: 'research', source: { url: 'https://www.mahmah.ch/collection/oeuvres/statue-fragment/eg-04', tier: 'holding-museum object record (MAHG Geneva)' } },
  { work: 'aic124043', field: 'Inscription application method', ruling: 'drop', resolution: "Do not assert stylus-vs-pencil in player copy. Atget used both (negative-scratched numbers + verso pencil). Call it Atget's catalogue number.", visibleVsResearch: 'research', source: { url: 'https://artblart.com/tag/petits-metiers/', tier: 'tertiary (dropped from player copy anyway)' } },
];

const ledger = {
  version: 'passBConflictResolutions/1', runId: 'b4c-f45fac18da2e',
  generatedNote: 'Consolidated conflict resolutions — NOT applied/merged. Owner humanReview decisions + fresh research (upgraded source tiers). When applied, tag every retained fact visible-in-image vs established-by-research.',
  ownerRulingSummary: { adopt: ['cinnabar', 'kantharos-Dionysos', 'sickle/harpe', 'postmen', 'Kollwitz 1956'], hedgeOrCorrect: ['imperial-kiln -> DROP per NPM record', 'Egyptian head -> deified Amenemhat III; beard type unstated'], deprioritize: ['Zeshin school', 'Weston location'], drop: ['Atget inscription method'], standingRule: 'every retained fact tags visible-in-image vs established-by-research' },
  researched,
  refinementsForOwnerConfirmation: [
    'Q48881623: primary NPM record lacks imperial-kiln -> recommend DROP the claim (stronger than your hedge).',
    'Q63247474: MAHG record says deified Amenemhat III and the beard is PRESERVED (not a stub); beard type unstated.',
  ],
  sourceTierNote: 'Primary holding-museum/official reached for: cinnabar(Met), kantharos(Harvard), imperial-kiln(NPM), Kollwitz(Volksbund), Egyptian head(MAHG). Confirmed-but-primary-blocked: sickle(BM Cloudflare), postmen(NGA 403 -> eMelbourne reference). Tertiary/deprioritized/dropped: Zeshin, Weston, Atget.',
  companionInput: 'The 30-item humanReview decision set you submitted (across 27 works) is the companion; the 10 above are the ones deferred to research. Apply both together on authorization.',
};
writeFileSync(`${RUN}/conflict-resolutions.json`, `${JSON.stringify(ledger, null, 1)}\n`);
console.log(`wrote ${RUN}/conflict-resolutions.json — ${researched.length} researched (${researched.filter((r) => r.ruling === 'adopt').length} adopt)`);
