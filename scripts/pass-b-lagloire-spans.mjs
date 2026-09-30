// Step 1: retrieve + bind the authoritative source spans for La Gloire (wikidata:Q16467705).
// Fetches the Musée Carnavalet (Paris Musées) primary record and the Wikidata entity, binds each supporting
// excerpt to {sourceId, url, retrievedContentSha256, retrievedAt, tier, atomicClaimsSupported}. Plain-node
// network (no model calls, no corpus image, no tool-capable agent). Page text is treated as DATA, not
// instructions. Writes a bound span artifact under the run's owner-review dir.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = 'data/incoming/vision-calibration/cr2-af3d6ed79c1c/owner-review/lagloire-authoritative-spans.json';
const CARNAVALET = 'https://www.parismuseescollections.paris.fr/fr/musee-carnavalet/oeuvres/la-gloire-tirant-auguste-de-villiers-de-l-isle-adam-1838-1889-de-son';
const WIKIDATA = 'https://www.wikidata.org/wiki/Special:EntityData/Q16467705.json';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchBytes(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (gesso-source-span-fetch)' } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, text: buf.toString('utf8'), retrievedContentSha256: sha(buf) };
}
// Extract the exact iconographic-description passage verbatim from the Carnavalet HTML.
function carnavaletDescription(html) {
  const m = html.match(/Description iconographique[\s\S]{0,200}?<p>([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

async function main() {
  const now = new Date().toISOString();
  const carn = await fetchBytes(CARNAVALET);
  if (carn.status !== 200) throw new Error(`Carnavalet fetch ${carn.status}`);
  const desc = carnavaletDescription(carn.text);
  if (!desc || !/Allégorie/.test(desc)) throw new Error('Carnavalet iconographic description not found in bytes');

  const wd = await fetchBytes(WIKIDATA);
  if (wd.status !== 200) throw new Error(`Wikidata fetch ${wd.status}`);
  const ent = JSON.parse(wd.text).entities.Q16467705;
  const mats = (ent.claims.P186 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
  const inv = (ent.claims.P217 || []).map((c) => c.mainsnak?.datavalue?.value);

  const spans = [
    {
      spanId: 'span-carnavalet-iconography', sourceId: 'carnavalet-S3490', url: CARNAVALET,
      tier: 'authoritative-museum-primary', retrievedAt: now, retrievedContentSha256: carn.retrievedContentSha256,
      field: 'Description iconographique', excerpt: desc,
      atomicClaimsSupported: [
        'The allegorical figure is Glory, a nude/draped WOMAN (femme, nu, drapé)',
        'Villiers de l\'Isle-Adam is the figure shown asleep (sommeil)',
        'A coffin is present in the composition (cerceuil)',
      ],
      // What the span POSITIVELY establishes vs what it merely does NOT mention are different things.
      establishesBySilence: [
        'The iconographic description does NOT mention a skull / memento-mori / vanitas — this is SILENCE, not an entailed absence',
        'The iconographic description does NOT mention wings — silence, not an entailed absence',
      ],
      refutes: ['figure-role-inversion'],
      absenceNote: 'The absence of a skull and of wings is NOT entailed by this span (a catalogue description need not enumerate everything absent). Their absence remains grounded in the sealed audit finding cb-273b4c707b9c and eventual owner adjudication.',
    },
    {
      spanId: 'span-wikidata-material', sourceId: 'wikidata-Q16467705', url: WIKIDATA,
      tier: 'tertiary-corroborating', retrievedAt: now, retrievedContentSha256: wd.retrievedContentSha256,
      field: 'P186 material / P217 inventory',
      excerpt: `P186 material = ${JSON.stringify(mats)} (Q274988=plaster/plâtre, Q428352=patina); P217 inventory = ${JSON.stringify(inv)}; P195 collection = Musée Carnavalet.`,
      atomicClaimsSupported: ['The material is plaster (plâtre) with a patina — not carved wood'],
      refutes: ['wrong-medium'],
      tierNote: 'Wikidata is tertiary/UGC; the plaster claim is also established by the sealed audit finding cb-273b4c707b9c. Not a museum primary span — the Carnavalet public record lists technique (Ronde-Bosse) but no material field.',
    },
  ];
  mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ version: 'passBAuthoritativeSpans/1', workId: 'wikidata:Q16467705', retrievedAt: now, spans }, null, 1)}\n`, { mode: 0o600 });
  console.log('Carnavalet (authoritative-museum-primary):');
  console.log('  sha256:', carn.retrievedContentSha256.slice(0, 16), 'bytes:', carn.buf.length);
  console.log('  Description iconographique:', desc);
  console.log('Wikidata (tertiary-corroborating):');
  console.log('  sha256:', wd.retrievedContentSha256.slice(0, 16), 'material:', JSON.stringify(mats), 'inventory:', JSON.stringify(inv));
  console.log('\nwrote', OUT);
}
main().catch((e) => { console.error('FAIL-CLOSED:', e.message); process.exit(1); });
