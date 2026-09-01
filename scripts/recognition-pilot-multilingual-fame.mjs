// Approval-gated, resumable pilot-only metadata harvest. This is NOT a model call and never mutates
// data/fame.* or tiers. It freezes ten language components over 2025-08..2026-07 for the selected 36.
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PILOT_FREEZE_ID, canonicalJson, sha256, aggregateMultilingualFame } from './lib/recognition-pilot.mjs';

if (!process.argv.includes('--fetch') || process.env.RECOGNITION_PILOT_FAME_FETCH !== '1') {
  console.error('REFUSED: metadata harvest needs --fetch and RECOGNITION_PILOT_FAME_FETCH=1'); process.exit(2);
}
if (process.env.CI) { console.error('REFUSED: never harvest in CI'); process.exit(2); }
const LANGS = ['en','ja','zh','es','fr','de','ar','hi','ru','pt'];
const START = '2025080100', END = '2026073100';
const manifest = JSON.parse(readFileSync('docs/research/recognition-pilot/pilot-manifest.draft.json', 'utf8'));
if (manifest.freezeCandidateId !== PILOT_FREEZE_ID) throw new Error('draft freeze id drift');
const outDir = join('data/incoming/recognition-pilot', PILOT_FREEZE_ID);
const jsonl = join(outDir, 'multilingual-fame.jsonl');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const done = new Set();
if (existsSync(jsonl)) for (const line of readFileSync(jsonl, 'utf8').split('\n')) { try { if (line.trim()) done.add(JSON.parse(line).id); } catch {} }
const UA = 'GessoRecognitionResearch/1.0 (kathryn.swint@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 0) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if ((r.status === 429 || r.status >= 500) && tries < 5) { await sleep(1000 * 2 ** tries); return get(url, tries + 1); }
    if (r.status === 404) return { missing: true };
    if (!r.ok) throw new Error(`http ${r.status}`);
    return { value: await r.json() };
  } catch (e) { if (tries < 4) { await sleep(1000 * 2 ** tries); return get(url, tries + 1); } throw e; }
}

const qidOf = w => String(w.catalog?.wikidataId || w.id || '').match(/Q\d+/)?.[0] || null;
for (const w of manifest.works) {
  if (done.has(w.id)) continue;
  const qid = qidOf(w);
  const row = { id: w.id, qid, window: { start: START, end: END }, languages: {}, missingQid: !qid };
  if (qid) {
    const entity = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&format=json&origin=*`);
    const sl = entity.value?.entities?.[qid]?.sitelinks || {};
    for (const lang of LANGS) {
      const title = sl[`${lang}wiki`]?.title || null;
      if (!title) { row.languages[lang] = { title: null, canonicalTitle: null, views: 0, missing: true, articleCreatedAt: null }; continue; }
      // MediaWiki redirects=1 returns a canonical title and first revision timestamp.
      const info = await get(`https://${lang}.wikipedia.org/w/api.php?action=query&redirects=1&prop=revisions&rvdir=newer&rvlimit=1&rvprop=timestamp&titles=${encodeURIComponent(title)}&format=json&origin=*`);
      const page = Object.values(info.value?.query?.pages || {})[0] || {};
      const canonicalTitle = page.title || title;
      const pv = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${encodeURIComponent(canonicalTitle.replace(/ /g, '_'))}/monthly/${START}/${END}`);
      const views = pv.missing ? 0 : (pv.value?.items || []).reduce((n, x) => n + Number(x.views || 0), 0);
      row.languages[lang] = { title, canonicalTitle, views, missing: !!pv.missing, articleCreatedAt: page.revisions?.[0]?.timestamp || null };
      await sleep(80);
    }
  }
  // Backfill only genuine absent sitelinks on LINKED works as measured zero. Works with no mapped QID
  // (unknown linkage) are left for aggregateMultilingualFame to mark unlinked + unscored.
  if (qid) for (const lang of LANGS) if (!row.languages[lang]) row.languages[lang] = { title: null, canonicalTitle: null, views: 0, missing: true, articleCreatedAt: null };
  row.rawTotal = qid ? Object.values(row.languages).reduce((n, x) => n + Number(x.views || 0), 0) : null;
  appendFileSync(jsonl, JSON.stringify(row) + '\n', { mode: 0o600 });
  console.log(`${done.size + 1}/${manifest.works.length} ${w.id} multilingual=${row.rawTotal}`);
}

// Final isolated snapshot. Language-balanced percentile is deliberately computed only within this
// pilot and is not a replacement fame metric.
const rows = readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
// Linked works: backfill genuine absent sitelinks as measured zero. missingQid works: aggregateMultilingualFame
// marks them unlinked + unscored (unknown linkage is NOT measured zero exposure) and excludes them from the
// percentile reference distributions. Deterministic rebuild from the existing JSONL (no re-harvest).
for (const row of rows) if (!row.missingQid) { row.languages = row.languages || {}; for (const lang of LANGS) if (!row.languages[lang]) row.languages[lang] = { title: null, canonicalTitle: null, views: 0, missing: true, articleCreatedAt: null }; }
aggregateMultilingualFame(rows, LANGS);
const snapshot = { version: 'recognition-multilingual-fame/1', languages: LANGS, window: { start: START, end: END }, rows };
snapshot.sha256 = sha256(canonicalJson({ ...snapshot, sha256: undefined }));
writeFileSync(join(outDir, 'multilingual-fame.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`wrote isolated multilingual snapshot ${snapshot.sha256}; existing fame/tiers untouched`);
