// Publication preview (Codex plan item 1, owner 2026-10-01: today's easy dailies). Takes finished claim-first copy
// from the private evidence repo and writes it into a TARGET game checkout (a preview branch off main), replacing
// that work's legacy teaching content entirely (no legacy survives by omission):
//   teach-works.js  work[id] = { why, notes: [pinned hotspots (x/y %), then unpinned notes] }  -- cues/guide removed
//   hotspots.js     legacy look-closer pins for the work removed (they titled themselves from legacy cues)
//   vision.js       a legacy vision record for the work is removed, if any
// Writes a publication manifest (before/after per work, file hashes) and a rollback file (exact prior entries), then
// rebuilds the note shards in the target. Fail-closed: every touched file must round-trip byte-identically first.
// Never touches production: the owner reviews the preview deployment of the target branch.
//   node scripts/pass-b-publish-preview.mjs --target ../artguessr-preview --date 2026-10-01 [--only id1,id2] [--apply]
// --only applies a later batch without re-applying (and overwriting the rollback of) works already published.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2), opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const TARGET = resolve(opt('--target') || '../artguessr-preview'), DATE = opt('--date');
const EV = resolve(opt('--evidence') || '../gesso-pass-b-evidence'), COPY = join(EV, 'incoming', 'vision-calibration', 'claim-first-nightly', 'copy', DATE || '');
if (!DATE) throw new Error('--date required');
const sha = s => createHash('sha256').update(s).digest('hex');
const FILES = {
  teach: { path: 'data/teach-works.js', name: 'ARTEFACTUM_CUES', ser: o => `window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work=${JSON.stringify(o)};\n`, get: w => w.ARTEFACTUM_CUES.work },
  hotspots: { path: 'data/hotspots.js', name: 'ARTEFACTUM_HOTSPOTS', ser: o => `window.ARTEFACTUM_HOTSPOTS = ${JSON.stringify(o)};\n`, get: w => w.ARTEFACTUM_HOTSPOTS },
  vision: { path: 'data/vision.js', name: 'ARTEFACTUM_VISION', ser: null, get: w => w.ARTEFACTUM_VISION },
};
const load = key => { const text = readFileSync(join(TARGET, FILES[key].path), 'utf8'), w = {}; new Function('window', text)(w); return { text, obj: FILES[key].get(w) }; };

export function toGame(copy) {
  const pct = v => Math.round(v * 1000) / 10;
  const pinned = (copy.hotspots || []).map(h => ({ head: h.head, body: h.body, x: pct(h.x), y: pct(h.y) }));
  const plain = (copy.notes || []).map(n => ({ head: n.head, body: n.body }));
  return { src: 'claim-first', why: copy.why, notes: [...pinned, ...plain] }; // src: the game shows every note (none is filler)
}

const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const copies = (existsSync(COPY) ? readdirSync(COPY).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(COPY, f), 'utf8'))) : []).filter(c => !ONLY || ONLY.has(c.workId));
const TAG = ONLY ? `${DATE}-${sha([...ONLY].sort().join(',')).slice(0, 8)}` : DATE;
if (!copies.length) throw new Error(`no finished copy for ${DATE} in ${COPY}`);
const teach = load('teach'), hot = load('hotspots'), vis = load('vision');
for (const [k, f] of [['teach', teach], ['hotspots', hot]]) if (FILES[k].ser(f.obj) !== f.text) throw new Error(`${FILES[k].path} does not round-trip byte-identically; refusing`);

const manifest = { version: 'passBPublicationPreview/1', date: DATE, target: TARGET, createdAt: new Date().toISOString(), works: [],
  filesBefore: Object.fromEntries(['teach', 'hotspots'].map(k => [FILES[k].path, sha(k === 'teach' ? teach.text : hot.text)])) };
const rollback = { version: 'passBPublicationRollback/1', date: DATE, entries: [] };
for (const c of copies) {
  const id = c.workId, before = { teach: teach.obj[id] ?? null, hotspots: hot.obj[id] ?? null, vision: vis.obj?.[id] ?? null };
  if (before.vision) throw new Error(`${id} has a legacy vision record; vision.js removal not implemented in this preview`);
  const after = { teach: toGame(c), hotspots: null };
  manifest.works.push({ workId: id, removed: { cues: before.teach?.cues?.length || 0, guide: before.teach?.guide?.length || 0, legacyNotes: before.teach?.notes?.length || 0, legacyPins: before.hotspots?.length || 0 },
    after: { why: !!after.teach.why, pinnedNotes: after.teach.notes.filter(n => n.x != null).length, notes: after.teach.notes.filter(n => n.x == null).length }, before, afterTeach: after.teach });
  rollback.entries.push({ workId: id, teach: before.teach, hotspots: before.hotspots });
  teach.obj[id] = after.teach; delete hot.obj[id];
}
const out = join(TARGET, 'data', 'publication'); mkdirSync(out, { recursive: true });
console.log(manifest.works.map(w => `${w.workId}: removes ${w.removed.cues} cues, ${w.removed.guide} guide Qs, ${w.removed.legacyNotes} legacy notes, ${w.removed.legacyPins} legacy pins -> why + ${w.after.pinnedNotes} hotspots + ${w.after.notes} notes`).join('\n'));
if (!args.includes('--apply')) { console.log('DRY RUN: nothing written. Add --apply.'); process.exit(0); }
if (existsSync(join(out, `manifest-${TAG}.json`))) throw new Error(`manifest-${TAG}.json exists; refusing to overwrite a rollback`);
writeFileSync(join(TARGET, FILES.teach.path), FILES.teach.ser(teach.obj));
writeFileSync(join(TARGET, FILES.hotspots.path), FILES.hotspots.ser(hot.obj));
manifest.filesAfter = { [FILES.teach.path]: sha(FILES.teach.ser(teach.obj)), [FILES.hotspots.path]: sha(FILES.hotspots.ser(hot.obj)) };
writeFileSync(join(out, `manifest-${TAG}.json`), `${JSON.stringify(manifest, null, 1)}\n`);
writeFileSync(join(out, `rollback-${TAG}.json`), `${JSON.stringify(rollback, null, 1)}\n`);
execFileSync('node', ['scripts/build-teach-shards.mjs'], { cwd: TARGET, stdio: 'inherit' });
console.log(`applied ${copies.length} works to ${TARGET}; manifest + rollback in data/publication/`);
