// Teaching-v2 deterministic source capture "C" (VSD-093; design draft 2 §3.2). NO model calls.
// Two separate halves:
//   1. captureUrl(): the only networked function. Hardened public-source GET for VETTED URLs only, using the
//      §3.2 limits: HTTPS through every redirect, no credentials/ports, every hop re-resolved and refused when any
//      address is non-public (IANA classes from the G-03 broker), the socket pinned to the vetted IP and the peer
//      re-checked (DNS-rebinding), a streaming byte cap enforced BEFORE buffering, a hard wall-clock deadline, a
//      redirect limit and explicit failures. Raw bytes + meta are kept separately as immutable snapshots
//      (same on-disk key/format as the shadow-audit snapshot helper, scripts/pass-b-audit-evidence.mjs).
//   2. Pure offline packet assembly: deterministic HTML/JSON/PDF -> normalized text, boilerplate stripping,
//      paragraph-preserving sections with exact offsets, the 40,000-character packet budget with recorded
//      selection (never a mid-passage cut), URL vetting rules, and a lexical slot-candidate coverage triage.
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyIp, normalizeIp, checkUrl, redirectDecision } from './img-broker.mjs';
import { extractTextV2, extractJsonText } from '../pass-b-audit-evidence.mjs';
import { sha256, stableJson } from './vision-legacy.mjs';
import { LIMITS, SOURCE_KINDS, sha256Bytes } from './teaching-v2-contract.mjs';

export const CAPTURE_POLICY_VERSION = 'teachingV2Capture/1';
export const EXTRACTION_VERSION = 'teachingV2SourceText/1'; // passBSourceText/2 HTML + filtered JSON + pdftotext
export const SECTION_VERSION = 'teachingV2Sections/1';
export const CAPTURE_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, timeoutMs: 20000, maxRedirects: 4 });
const UA = 'Mozilla/5.0 (compatible; GessoSourceSnapshot/2; +https://gesso.katswint.com)';
const ACCEPT = 'text/html,application/xhtml+xml,application/json,application/pdf;q=0.9';
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

// ---------------- 1. networked capture (DI for offline tests: resolve + request) ----------------
export function createSourceCapture({ resolve = dnsLookup, request = httpsRequest, now = () => new Date() } = {}) {
  const resolveAll = (host, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('dns-timeout')), Math.max(1, ms));
    resolve(host, { all: true, verbatim: true }, (e, a) => { clearTimeout(t); e ? rej(e) : res(Array.isArray(a) ? a : [a]); });
  });
  function hop(u, deadlineAt, cap) {
    return new Promise(async done0 => {
      let settled = false, timer = null; const done = v => { if (settled) return; settled = true; clearTimeout(timer); done0(v); };
      let addrs;
      try { addrs = await resolveAll(u.hostname, deadlineAt - Date.now()); } catch { return done(fail('dns-failed', { host: u.hostname })); }
      addrs = (addrs || []).filter(a => Number(a.family) === 4); // G-03 phase-1 policy: IPv4 only
      if (!addrs.length) return done(fail('no-ipv4', { host: u.hostname }));
      for (const a of addrs) { const c = classifyIp(a.address); if (c !== 'public') return done(fail('blocked-ip', { host: u.hostname, detail: c })); }
      const pinned = addrs[0];
      const pin = (_h, o, cb) => (o && o.all) ? cb(null, [{ address: pinned.address, family: 4 }]) : cb(null, pinned.address, 4);
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return done(fail('timeout', { host: u.hostname }));
      let req;
      try {
        req = request({ protocol: 'https:', hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', agent: false,
          servername: u.hostname, lookup: pin, family: 4, timeout: remaining, headers: { 'User-Agent': UA, Accept: ACCEPT } }, res => {
          const peer = normalizeIp(res.socket && res.socket.remoteAddress);
          if (!peer || peer !== normalizeIp(pinned.address)) { req.destroy(); return done(fail('remote-addr-mismatch', { host: u.hostname })); }
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400) { res.resume(); return done({ ok: true, redirect: true, status, location: res.headers.location }); }
          if (status !== 200) { res.resume(); return done(fail(`http ${status}`, { status })); }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > cap) { req.destroy(); return done(fail('too-large', { status })); }
          const chunks = []; let n = 0;
          res.on('data', d => { n += d.length; if (n > cap) { req.destroy(); return done(fail('too-large', { status })); } chunks.push(d); });
          res.on('end', () => { if (!n) return done(fail('empty-body', { status })); done({ ok: true, redirect: false, status, buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '') }); });
          res.on('error', () => done(fail('network-error')));
        });
      } catch { return done(fail('network-error')); }
      timer = setTimeout(() => { try { req.destroy(); } catch { /* ignore */ } done(fail('timeout', { host: u.hostname })); }, Math.max(1, deadlineAt - Date.now()));
      req.on('timeout', () => { req.destroy(); done(fail('timeout')); });
      req.on('error', () => done(fail('network-error')));
      req.end();
    });
  }
  async function captureUrl(url, { limits = CAPTURE_LIMITS } = {}) {
    const retrievedAt = now().toISOString();
    const c0 = checkUrl(url); if (!c0.ok) return { url, retrievedAt, ...fail(c0.reason) };
    const deadlineAt = Date.now() + limits.timeoutMs;
    let u = c0.url; const chain = [u.href];
    for (let hops = 0; ; ) {
      const r = await hop(u, deadlineAt, limits.maxBytes);
      if (!r.ok) return { url, retrievedAt, chain, ...r };
      if (!r.redirect) return { ok: true, url, finalUrl: u.href, chain, retrievedAt, status: r.status, contentType: r.contentType, buffer: r.buffer, hops };
      const d = redirectDecision(u.href, r.location, hops, limits.maxRedirects);
      if (!d.ok) return { url, retrievedAt, chain, ...fail(d.reason) };
      hops += 1; u = d.url; chain.push(u.href);
    }
  }
  return { captureUrl };
}

// Persist one capture as an immutable snapshot (raw + meta). Failures are reported, never persisted as success.
export function snapshotKey(url) { return sha256(url).slice(0, 24); }
export function persistSnapshot(snapDir, cap) {
  mkdirSync(snapDir, { recursive: true, mode: 0o700 });
  const key = snapshotKey(cap.url), metaPath = join(snapDir, `${key}.meta.json`);
  const meta = { version: CAPTURE_POLICY_VERSION, url: cap.url, finalUrl: cap.finalUrl ?? null, chain: cap.chain ?? [], status: cap.status ?? null,
    contentType: cap.contentType ?? null, retrievedAt: cap.retrievedAt, ok: !!cap.ok, error: cap.ok ? null : cap.error, key };
  if (cap.ok) {
    meta.bytes = cap.buffer.length; meta.rawSha256 = sha256Bytes(cap.buffer);
    if (existsSync(metaPath)) return JSON.parse(readFileSync(metaPath, 'utf8')); // immutable: first success wins
    writeFileSync(join(snapDir, `${key}.raw`), cap.buffer, { flag: 'wx', mode: 0o600 });
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  } else writeFileSync(join(snapDir, `${key}.fail-${sha256(cap.retrievedAt).slice(0, 8)}.json`), `${JSON.stringify(meta, null, 1)}\n`, { mode: 0o600 });
  return meta;
}
export function readSnapshot(snapDir, url) {
  const key = snapshotKey(url), metaPath = join(snapDir, `${key}.meta.json`);
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const raw = readFileSync(join(snapDir, `${key}.raw`));
  if (sha256Bytes(raw) !== meta.rawSha256) throw new Error(`${url}: raw snapshot changed`);
  return { meta, raw };
}

// ---------------- 2. deterministic extraction ----------------
// JSON museum API records: drop machinery keys (ids/urls/images/timestamps) deterministically before the
// shared passBSourceText/2 key: value extraction. Substantive text fields are never filtered.
const JSON_DROP = /(^|_)(id|ids|uuid|url|urls|uri|href|link|links|image|images|iiif|thumbnail|thumbnails|lqip|alt_image|color|colour|timestamp|updated|modified|last_updated|source_updated_at|api_model|api_link|suggest_autocomplete_all|config|info|pagination|license_text|license_links|copyright_notice|width|height|image_id|accession_date|is_|has_)/i;
function filterJson(v) {
  if (Array.isArray(v)) return v.map(filterJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !JSON_DROP.test(k)).map(([k, x]) => [k, filterJson(x)]));
  return v;
}
export function extractPdfText(buf, { bin = 'pdftotext' } = {}) {
  // Deterministic external extractor; an absent tool is an explicit failure, never a silent empty text.
  const out = execFileSync(bin, ['-enc', 'UTF-8', '-nopgbrk', '-', '-'], { input: buf, maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  return String(out).split(/\n{2,}/).map(p => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim()).filter(p => p.length >= 3).join('\n').normalize('NFC');
}
export function titleOf(html) { const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? extractTextV2(m[1]).replace(/\s+/g, ' ').trim().slice(0, 300) : ''; }
export function extractSnapshotText({ meta, raw }, { pdf = extractPdfText } = {}) {
  const type = String(meta.contentType || '').toLowerCase();
  if (/json/.test(type)) return { ok: true, text: extractJsonText(JSON.stringify(filterJson(JSON.parse(raw.toString('utf8'))))), title: '', format: 'json' };
  if (/html|xml/.test(type)) { const h = raw.toString('utf8'); return { ok: true, text: extractTextV2(h), title: titleOf(h), format: 'html' }; }
  if (/pdf/.test(type)) { try { return { ok: true, text: pdf(raw), title: '', format: 'pdf' }; } catch (e) { return { ok: false, error: `pdf extraction failed: ${String(e.message).slice(0, 80)}` }; } }
  return { ok: false, error: `unsupported content-type ${type || 'none'}` };
}

// ---------------- sections + packet budget ----------------
const WIKI_TAIL = /^(References|See also|Notes|External links|Further reading|Bibliography|Sources|Citations|Footnotes)$/;
// Boilerplate = navigation/menus/shop lists: short lines with no sentence punctuation. Substantive sentences and
// "key: value" record fields are always kept (qualifications live there).
export function keepLine(line, format) {
  const words = line.split(/\s+/).filter(Boolean).length;
  if (format === 'json') return /^[a-z_]+: /i.test(line) && line.length >= 12;
  if (words >= 8) return true;
  return words >= 4 && /[.!?;:]["”’)]?$/.test(line);
}
export function buildSections(sourceId, text, format, { maxSectionChars = 2000 } = {}) {
  const lines = []; let at = 0;
  for (const line of text.split('\n')) { lines.push({ line, start: at, end: at + line.length }); at += line.length + 1; }
  let cut = lines.length;
  if (format === 'html') { const i = lines.findIndex(l => WIKI_TAIL.test(l.line.trim())); if (i > 0) cut = i; }
  const kept = lines.slice(0, cut).map((l, i) => ({ ...l, i })).filter(l => keepLine(l.line, format));
  const sections = []; let cur = null;
  for (const l of kept) {
    const contiguous = cur && l.i === cur.lastI + 1 && (l.end - cur.start) <= maxSectionChars;
    if (contiguous) { cur.end = l.end; cur.lastI = l.i; }
    else { if (cur) sections.push(cur); cur = { start: l.start, end: l.end, lastI: l.i }; }
  }
  if (cur) sections.push(cur);
  return sections.map((s, n) => ({ id: `${sourceId}.s${String(n + 1).padStart(3, '0')}`, text: text.slice(s.start, s.end), start: s.start, end: s.end }));
}
// Fair-share budget in source priority order; whole sections only; every omission recorded.
export function applyBudget(sources, total = LIMITS.packetChars) {
  let remaining = total; const captured = sources.filter(s => s.status === 'captured');
  captured.forEach((s, idx) => {
    const share = Math.floor(remaining / (captured.length - idx));
    const keep = [], omitted = []; let used = 0;
    for (const sec of s.allSections) { if (used + sec.text.length <= share && !omitted.length) { keep.push(sec); used += sec.text.length; } else omitted.push({ id: sec.id, start: sec.start, end: sec.end, chars: sec.text.length }); }
    s.sections = keep; remaining -= used;
    s.selection = { rule: 'source-order-fair-share/1', shareChars: share, includedChars: used, totalSectionChars: s.allSections.reduce((n, x) => n + x.text.length, 0), omittedSections: omitted.length, omitted };
  });
  for (const s of sources) delete s.allSections;
  return sources;
}

// ---------------- URL vetting (deterministic host rules; labels never grant authority) ----------------
const HOST_KIND = [
  [/(^|\.)wikipedia\.org$|(^|\.)britannica\.com$|(^|\.)worldhistory\.org$|(^|\.)smarthistory\.org$/, 'reference'],
  [/(^|\.)wikidata\.org$/, 'reference'],
  [/\.edu$|\.ac\.[a-z]{2}$|(^|\.)jstor\.org$|(^|\.)19thc-artworldwide\.org$|(^|\.)culturalheritage\.org$|(^|\.)doaks\.org$|(^|\.)press\.princeton\.edu$|(^|\.)persee\.fr$|(^|\.)openedition\.org$|(^|\.)academia\.edu$/, 'scholarly'],
  [/artsandculture\.google\.com$|thecollector\.com$|arthistoryproject\.com$|artrenewal\.org$|wikiart\.org$|commons\.wikimedia\.org$|blogspot\.|wordpress\.com$|medium\.com$|pinterest\.|(^|\.)artsy\.net$/, 'aggregator'],
  [/artelino\.com$|rugrabbit\.com$|galeria|auction|christies\.com$|sothebys\.com$|bonhams\.com$|ebay\.|etsy\.com$|amazon\.|shop|store|gallery\.com$/, 'commercial'],
  [/museum|museo|musee|musée|collections?\.|clevelandart\.org$|metmuseum\.org$|artic\.edu$|harvardartmuseums\.org$|vam\.ac\.uk$|louvre\.fr$|nga\.gov$|si\.edu$|rijksmuseum\.nl$|ashmolean\.org$|artgallery\.|tate\.org\.uk$|nationalgallery\.org\.uk$|paris\.fr$/, 'museum'],
];
export function hostKind(url) {
  let h; try { h = new URL(url).hostname.toLowerCase(); } catch { return 'invalid'; }
  for (const [re, k] of HOST_KIND) if (re.test(h)) return k;
  return 'other';
}
// Known exact holding-institution records derived from the catalog id (straight to C; no discovery call).
export function holdingRecordUrl(id) {
  let m;
  if ((m = /^cleveland(\d+)$/.exec(id))) return { url: `https://openaccess-api.clevelandart.org/api/artworks/${m[1]}`, objectId: m[1], institution: 'clevelandart.org' };
  if ((m = /^met(\d+)$/.exec(id))) return { url: `https://collectionapi.metmuseum.org/public/collection/v1/objects/${m[1]}`, objectId: m[1], institution: 'metmuseum.org' };
  if ((m = /^aic(\d+)$/.exec(id))) return { url: `https://api.artic.edu/api/v1/artworks/${m[1]}`, objectId: m[1], institution: 'artic.edu' };
  if ((m = /^harvard(\d+)$/.exec(id))) return { url: `https://harvardartmuseums.org/collections/object/${m[1]}`, objectId: m[1], institution: 'harvardartmuseums.org' };
  return null;
}
const PRIORITY = { holdingInstitution: 0, scholarly: 1, artistFoundation: 1, primaryDocument: 1, reference: 3, other: 4 };
// Vet candidate URLs for one work. Excluded: non-https, commercial, aggregator, Wikidata entity pages (structured
// metadata, no teaching text), and the shadow/old B2 sources beyond the four-source cap. Every decision is recorded.
export function vetUrls({ workId, b2Sources = [] }) {
  const decisions = []; const take = [];
  const hold = holdingRecordUrl(workId);
  const holdHost = hold?.institution;
  if (hold) take.push({ url: hold.url, kind: 'holdingInstitution', relationshipToWork: 'thisObject (catalog id)', origin: 'catalog-id', objectIds: [hold.objectId] });
  for (const s of b2Sources) {
    const url = String(s.url || '');
    const k = hostKind(url);
    const base = { url, origin: 'b2-fetched-source', b2SourceId: s.sourceId ?? null, title: s.title ?? null };
    if (!/^https:\/\//.test(url)) { decisions.push({ ...base, vetted: false, reason: 'not https' }); continue; }
    if (k === 'commercial' || k === 'aggregator') { decisions.push({ ...base, vetted: false, reason: `${k} (lead only, not captured)` }); continue; }
    if (/wikidata\.org$/.test(new URL(url).hostname)) { decisions.push({ ...base, vetted: false, reason: 'wikidata entity page (no teaching text)' }); continue; }
    const kind = k === 'museum' ? ((holdHost && new URL(url).hostname.endsWith(holdHost)) ? 'holdingInstitution' : 'other') : (SOURCE_KINDS.includes(k) ? k : 'other');
    if (take.some(t => t.url === url)) { decisions.push({ ...base, vetted: false, reason: 'duplicate' }); continue; }
    take.push({ ...base, kind, relationshipToWork: 'undeclared (B2 lead)', objectIds: [] });
  }
  const ranked = take.map((t, i) => ({ t, i })).sort((a, b) => (PRIORITY[a.t.kind] ?? 5) - (PRIORITY[b.t.kind] ?? 5) || a.i - b.i).map(x => x.t);
  const vetted = ranked.slice(0, LIMITS.sources);
  for (const t of ranked.slice(LIMITS.sources)) decisions.push({ url: t.url, origin: t.origin, vetted: false, reason: 'beyond the four-source cap' });
  for (const t of vetted) decisions.push({ url: t.url, origin: t.origin, vetted: true, kind: t.kind });
  return { vetted, decisions, rules: 'teachingV2Vetting/1-host-rules' };
}

// ---------------- packet assembly (pure given snapshots) ----------------
export function assemblePacket({ workId, catalogId, vetted, snapshots }) {
  const sources = []; const gaps = []; const captureReceipts = []; const texts = {};
  vetted.forEach((v, n) => {
    const id = `S${n + 1}`; const snap = snapshots[v.url] || null;
    const base = { id, url: v.url, kind: v.kind, relationshipToWork: v.relationshipToWork, objectIds: [catalogId, ...(v.objectIds || [])] };
    if (!snap) { sources.push({ ...base, finalUrl: null, title: v.title || '', retrievedAt: null, bytesHash: null, textHash: null, extractionVersion: EXTRACTION_VERSION, status: 'unavailable', sections: [] }); gaps.push({ sourceId: id, url: v.url, reason: 'no successful snapshot' }); captureReceipts.push({ url: v.url, ok: false, error: 'not captured' }); return; }
    const ex = extractSnapshotText(snap);
    captureReceipts.push({ url: v.url, ok: ex.ok, error: ex.ok ? null : ex.error, status: snap.meta.status, contentType: snap.meta.contentType, bytes: snap.meta.bytes, rawSha256: snap.meta.rawSha256, retrievedAt: snap.meta.retrievedAt, finalUrl: snap.meta.finalUrl, chain: snap.meta.chain });
    if (!ex.ok || !ex.text.trim()) { sources.push({ ...base, finalUrl: snap.meta.finalUrl, title: v.title || '', retrievedAt: snap.meta.retrievedAt, bytesHash: snap.meta.rawSha256, textHash: null, extractionVersion: EXTRACTION_VERSION, status: 'unavailable', sections: [] }); gaps.push({ sourceId: id, url: v.url, reason: ex.error || 'empty text' }); return; }
    texts[id] = ex.text;
    sources.push({ ...base, finalUrl: snap.meta.finalUrl, title: ex.title || v.title || '', retrievedAt: snap.meta.retrievedAt, bytesHash: snap.meta.rawSha256, textHash: sha256(ex.text), extractionVersion: EXTRACTION_VERSION, format: ex.format, status: 'captured', allSections: buildSections(id, ex.text, ex.format) });
  });
  for (const s of sources) if (!s.allSections) s.allSections = [];
  applyBudget(sources);
  for (const s of sources) if (s.selection?.omittedSections) gaps.push({ sourceId: s.id, url: s.url, reason: `section selection omitted ${s.selection.omittedSections} section(s) beyond the ${LIMITS.packetChars}-character packet budget` });
  const packet = { version: 'teachingV2SourcePacket/1', namespace: 'teaching-v2/2', workId, capturePolicy: CAPTURE_POLICY_VERSION, sectionVersion: SECTION_VERSION, sources, gaps, captureReceipts };
  packet.packetSha256 = sha256(stableJson(packet));
  return { packet, texts };
}

// ---------------- lexical slot-candidate triage (NOT semantic coverage; W/V decide that) ----------------
export const SLOT_LEXICON = Object.freeze({
  subjectAction: /\b(depict|depicts|depicting|shows|showing|scene|story|represent|represents|portrait of|subject|narrat|episode|myth|legend|figure of)\w*/i,
  functionContext: /\b(used (for|as|in)|made for|commission|ritual|ceremon|funer|burial|tomb|altar|worship|devotion|served|function|purpose|patron|display(ed)? in|offering|temple|church|court|household|daily use)\w*/i,
  makingMechanism: /\b(technique|carved|carving|paint|slip|cast|woven|weav|glaze|brush|printed|engrav|incis|pigment|layer|fired|modell?ed|inlay|gilded|gilding|woodblock|etch|lacquer|relief|chisel|mold|mould|stroke)\w*/i,
  significance: /\b(important|influential|famous|first|celebrated|innovat|significant|masterpiece|renowned|landmark|pioneer|notable|best[- ]known|iconic|admired)\w*/i,
});
export function lexicalSlotCandidates(packet, catalog) {
  const tokens = String(catalog?.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]{5,}/g) || [];
  const out = { identity: 0, subjectAction: 0, functionContext: 0, makingMechanism: 0, significance: 0, transfer: null };
  for (const s of packet.sources) for (const sec of s.sections || []) {
    const t = sec.text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (tokens.length && tokens.some(k => t.includes(k))) out.identity++;
    for (const slot of Object.keys(SLOT_LEXICON)) if (SLOT_LEXICON[slot].test(sec.text)) out[slot]++;
  }
  return out; // transfer is image-grounded by W; no lexical source proxy
}
