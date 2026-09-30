// Better audit evidence for the four shadow-audit works (offline except plain HTTP GETs; no model calls).
// 1. Snapshot every cited B2 source page: raw bytes + deterministic extracted text, both hashed, never rewritten.
// 2. For each component, select the most relevant passages (matching sentences with one sentence of context on each
//    side) under a per-work character budget, so the auditor gets relevant context rather than whole pages.
// Page content is untrusted data. Output is quarantined: data/incoming/vision-calibration/audit-evidence-v1/.
//   node scripts/pass-b-audit-evidence.mjs            # fetch missing snapshots, then select passages
//   node scripts/pass-b-audit-evidence.mjs --offline  # select from existing snapshots only
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, stableJson } from './lib/vision-legacy.mjs';
import { RUN_ROOT } from './lib/pass-b-calibration.mjs';
import { AUDIT_WORKS, buildWorkInput } from './pass-b-shadow-audit.mjs';

export const EXTRACTION_VERSION = 'passBSourceText/1';
export const SELECTION_VERSION = 'passBAuditPassages/1';
const OUT = join(RUN_ROOT, 'audit-evidence-v1'), SNAP = join(OUT, 'snapshots'), SNAPSHOT_DIR = SNAP;
const MAX_BYTES = 5 * 1024 * 1024, TIMEOUT_MS = 20000;
export const BUDGET = { perComponent: 3, perWorkChars: 9000, minScore: 2 };

// ---- fetch (plain GET, https only, bounded size/time, no cookies) ----
export async function snapshot(url, SNAP = SNAPSHOT_DIR) {
  const key = sha256(url).slice(0, 24), metaPath = join(SNAP, `${key}.meta.json`);
  if (existsSync(metaPath)) return JSON.parse(readFileSync(metaPath, 'utf8'));
  if (!/^https:\/\//i.test(url)) return { url, ok: false, error: 'not https' };
  let meta;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GessoSourceSnapshot/1; +https://gesso.katswint.com)', Accept: 'text/html,application/xhtml+xml,application/json' } });
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || '';
    meta = { url, finalUrl: r.url, status: r.status, contentType: type, bytes: buf.length, retrievedAt: new Date().toISOString(), rawSha256: sha256(buf) };
    if (r.status !== 200) meta.error = `http ${r.status}`;
    else if (buf.length > MAX_BYTES) meta.error = 'too large';
    else if (!/html|json/i.test(type)) meta.error = `unsupported content-type ${type}`;
    if (!meta.error) {
      writeFileSync(join(SNAP, `${key}.raw`), buf, { flag: 'wx', mode: 0o600 });
      const text = /json/i.test(type) ? extractJsonText(buf.toString('utf8')) : extractText(buf.toString('utf8'));
      writeFileSync(join(SNAP, `${key}.txt`), text, { flag: 'wx', mode: 0o600 });
      Object.assign(meta, { extraction: EXTRACTION_VERSION, textSha256: sha256(text), textChars: text.length });
    }
  } catch (e) { meta = { url, retrievedAt: new Date().toISOString(), error: `fetch failed: ${e.name}` }; }
  meta.ok = !meta.error; meta.key = key;
  // Only a successful snapshot is persisted (and never rewritten); a failure is reported and retried next run.
  if (meta.ok) writeFileSync(metaPath, `${JSON.stringify(meta, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  return meta;
}

// ---- deterministic HTML -> text ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ouml: 'ö', uuml: 'ü', auml: 'ä' };
export function extractText(html) {
  let t = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '') // Wikipedia citation markers
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote|\/dd|\/dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
  return t.split('\n').map(l => l.replace(/[ \t\r\f\v]+/g, ' ').trim()).filter(l => l.length >= 3).join('\n').normalize('NFC');
}

// passBSourceText/2: /1 replaced every tag with a space, which left spaces before punctuation and inside quotes
// ("British Museum , where", "\" Theses on ... History \""), so correct verbatim quotes failed to match. /2 is /1 plus
// that repair, re-derived from the preserved raw bytes. /1 files and the evidence built from them are unchanged.
export const EXTRACTION_VERSION_2 = 'passBSourceText/2';
export function extractTextV2(html) {
  return extractText(html).split('\n').map(l => l
    .replace(/\s+([,.;:!?)\]}»”’])/g, '$1').replace(/([(\[{«“‘])\s+/g, '$1')
    .replace(/"\s+([^"]*?)\s+"/g, '"$1"')).join('\n');
}
// Museum API records (e.g. Art Institute of Chicago) come back as JSON: keep every string field as "key: value",
// with any embedded HTML converted by the /2 extractor. Deterministic.
export function extractJsonText(raw) {
  const lines = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { const t = /<[a-z!/]/i.test(v) ? extractTextV2(v).replace(/\n+/g, ' ') : v.replace(/\s+/g, ' ').trim(); if (t.length >= 3) lines.push(`${key}: ${t}`); }
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(JSON.parse(raw), 'record');
  return lines.join('\n').normalize('NFC');
}
export function snapshotTextV2(key, snapDir = SNAP) {
  const meta = JSON.parse(readFileSync(join(snapDir, `${key}.meta.json`), 'utf8'));
  const raw = readFileSync(join(snapDir, `${key}.raw`));
  if (sha256(raw) !== meta.rawSha256) throw new Error(`${meta.url}: raw snapshot changed`);
  const text = /json/i.test(meta.contentType || '') ? extractJsonText(raw.toString('utf8')) : extractTextV2(raw.toString('utf8'));
  return { url: meta.url, rawSha256: meta.rawSha256, extraction: EXTRACTION_VERSION_2, text, textSha256: sha256(text) };
}

// ---- deterministic passage selection ----
const STOP = new Set('the and for with that this from into over under than then there their they them these those have has had was were been being are its not but also only such which what when where while whether would could should about after before between both each more most other some very much many into upon onto your you his her him she he who whom whose one two three work works image figure figures piece here just like made make makes shows show seen see looks look'.split(' '));
const words = t => new Set((String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z'-]{3,}/g) || []).map(w => w.replace(/'s$/, '').replace(/s$/, '')).filter(w => !STOP.has(w)));
const sentences = text => text.split('\n').flatMap((line, li) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(«])/).map(s => ({ s, li })));

export function selectPassages(component, pages, budget = BUDGET) {
  const cw = words(component.text), picks = [];
  for (const page of pages) {
    const sents = sentences(page.text);
    sents.forEach((x, i) => {
      const score = [...words(x.s)].filter(w => cw.has(w)).length;
      if (score < budget.minScore) return;
      const win = [i - 1, i, i + 1].filter(j => j >= 0 && j < sents.length && sents[j].li === x.li).map(j => sents[j].s).join(' ');
      picks.push({ sourceId: page.sourceId, score, text: win, at: page.text.indexOf(win) });
    });
  }
  const seen = new Set();
  return picks.sort((a, b) => b.score - a.score || a.at - b.at).filter(p => !seen.has(p.text) && seen.add(p.text)).slice(0, budget.perComponent);
}

export function buildEvidence(workInput, pages, budget = BUDGET) {
  const passages = [], byText = new Map(), perComponent = {};
  let chars = 0;
  // round-robin by rank so every component gets its best passage before any gets its third
  const ranked = workInput.components.map(c => ({ c, picks: selectPassages(c, pages, budget) }));
  for (let rank = 0; rank < budget.perComponent; rank++) for (const { c, picks } of ranked) {
    const p = picks[rank]; if (!p) continue;
    let id = byText.get(p.text);
    if (!id) {
      if (chars + p.text.length > budget.perWorkChars) continue;
      id = `sp-${p.sourceId}-${sha256(p.text).slice(0, 8)}`; byText.set(p.text, id); chars += p.text.length;
      passages.push({ passageId: id, sourceId: p.sourceId, text: p.text });
    }
    (perComponent[c.componentId] ||= []).push(id);
  }
  return { passages, perComponent, chars };
}

async function main() {
  const offline = process.argv.includes('--offline');
  mkdirSync(SNAP, { recursive: true, mode: 0o700 });
  const out = { version: SELECTION_VERSION, extraction: EXTRACTION_VERSION, budget: BUDGET, works: [] };
  for (const spec of AUDIT_WORKS) {
    const w = buildWorkInput(spec), pages = [], fetchLog = [];
    for (const s of w.input.sources) {
      const key = sha256(s.url).slice(0, 24);
      const meta = offline ? (existsSync(join(SNAP, `${key}.meta.json`)) ? JSON.parse(readFileSync(join(SNAP, `${key}.meta.json`), 'utf8')) : { url: s.url, ok: false, error: 'no snapshot (offline)' }) : await snapshot(s.url);
      fetchLog.push({ sourceId: s.sourceId, url: s.url, ok: meta.ok, error: meta.error || null, status: meta.status ?? null, textChars: meta.textChars ?? 0, rawSha256: meta.rawSha256 || null, textSha256: meta.textSha256 || null });
      if (meta.ok) {
        const text = readFileSync(join(SNAP, `${key}.txt`), 'utf8');
        if (sha256(text) !== meta.textSha256) throw new Error(`${s.url}: snapshot text changed`);
        pages.push({ sourceId: s.sourceId, text });
      }
    }
    const ev = buildEvidence(w.input, pages);
    out.works.push({ workId: spec.workId, name: spec.name, sources: fetchLog, passageChars: ev.chars, digestChars: w.input.sources.reduce((n, s) => n + s.digest.length, 0), passages: ev.passages, perComponent: ev.perComponent });
  }
  out.sha256 = sha256(stableJson(out.works));
  writeFileSync(join(OUT, 'evidence.json'), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  for (const w of out.works) console.log(`${w.name}: sources ${w.sources.filter(s => s.ok).length}/${w.sources.length} snapshotted (${w.sources.map(s => s.ok ? `${s.sourceId} ${s.textChars}ch` : `${s.sourceId} ${s.error}`).join(', ')}); passages ${w.passages.length}, ${w.passageChars} chars (digests were ${w.digestChars}); components with passages ${Object.keys(w.perComponent).length}`);
  console.log(`evidence sha ${out.sha256.slice(0, 12)} -> ${join(OUT, 'evidence.json')}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(e => { console.error(`FAIL-CLOSED: ${e.message}`); process.exit(1); });
