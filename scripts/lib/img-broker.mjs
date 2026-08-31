// Hardened, dependency-injected corpus-image fetch broker (G-03). ALL untrusted corpus-image fetches route
// through this. It fetches over HTTPS only, refuses any non-public resolved address (SSRF), pins the socket to
// the exact vetted IP (defeats DNS-rebinding/TOCTOU), verifies the connected peer, follows redirects only after
// re-vetting every hop, streams under a hard byte + wall-clock cap, cross-checks Content-Type against the file
// signature, then FULLY DECODES the image and re-encodes it to a metadata-stripped, resolution-capped derivative
// (kills EXIF/ICC/XMP prompt-injection + decompression bombs). Nothing here executes a shell or takes model
// actions. Callers hand the sanitized derivative + text metadata to a TOOL-LESS model completion; URLs never
// enter model context.
//
// DI: createBroker({ lookup, request }) — the default export wires real node:dns lookup + node:https request;
// tests inject deterministic fakes to exercise the transport offline. There are NO runtime bypass flags.
import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { openSync, writeSync, closeSync, renameSync, rmSync, mkdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

// ---------------- limits / policy version ----------------
export const BROKER_POLICY_VERSION = 'img-broker/1';
const DEFAULTS = {
  maxBytes: 40 * 1024 * 1024,    // hard streamed byte cap (model path)
  maxProbeBytes: 128 * 1024,     // probe reads at most this
  timeoutMs: 30_000,             // per-request AND per-chain wall clock (incl. DNS)
  maxRedirects: 4,
  maxPixels: 100_000_000,        // decode/decompression-bomb guard
  maxDim: 30_000,
  modelCapPx: 1568,              // re-encode longest-side cap for the model derivative
  allowMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  allowAnimated: false,
};
// Referer is only attached for these hosts (narrow allowlist), and never forwarded across origins.
const REFERER_HOSTS = { 'www.artic.edu': 'https://www.artic.edu/', 'artic.edu': 'https://www.artic.edu/' };

const err = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// ---------------- pure IP classification (IPv4 + IPv6) ----------------
function v4Class(o) { // o = [a,b,c,d]
  const [a, b] = o;
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (o[0] === 169 && o[1] === 254 && o[2] === 169 && o[3] === 254) return 'metadata';
  if (a === 169 && b === 254) return 'linklocal';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';                 // 100.64.0.0/10
  if (a === 192 && b === 0 && o[2] === 0) return 'reserved';            // 192.0.0.0/24 IETF protocol (incl 192.0.0.170/171 NAT64/DNS64 discovery)
  if (a === 192 && b === 0 && o[2] === 2) return 'reserved';            // TEST-NET-1
  if (a === 192 && b === 88 && o[2] === 99) return 'reserved';         // 192.88.99.0/24 6to4-relay anycast (deprecated)
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';           // benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return 'reserved';         // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return 'reserved';          // TEST-NET-3
  if (a >= 224) return 'reserved';                                      // multicast + 240/4 + 255.255.255.255
  return 'public';
}
function parseV4(ip) { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip); if (!m) return null; const o = m.slice(1).map(Number); return o.every(n => n <= 255) ? o : null; }
function ipv6ToBytes(ip) {
  let s = ip; let v4tail = null;
  const dot = s.lastIndexOf(':');
  if (s.includes('.')) { const tail = s.slice(dot + 1); const o = parseV4(tail); if (!o) return null; v4tail = o; s = s.slice(0, dot + 1) + ((o[0] << 8 | o[1]).toString(16)) + ':' + ((o[2] << 8 | o[3]).toString(16)); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups;
  if (tail === null) { if (head.length !== 8) return null; groups = head; }
  else { const fill = 8 - head.length - tail.length; if (fill < 0) return null; groups = [...head, ...Array(fill).fill('0'), ...tail]; }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) { const g = groups[i]; if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null; const v = parseInt(g, 16); bytes[i * 2] = v >> 8; bytes[i * 2 + 1] = v & 0xff; }
  return { bytes, v4tail };
}
// DEFAULT-DENY IPv6: only global-unicast (2000::/3) is eligible for `public`, and even there the transition/
// translation ranges (6to4, Teredo, NAT64) are decoded to their embedded IPv4 and re-classified. Everything else
// (loopback, unspecified, link-local, ULA, multicast, doc, deprecated, IPv4-compatible, local-use NAT64) is blocked.
export function classifyIp(ip) {
  const fam = isIP(ip);
  if (fam === 4) { const o = parseV4(ip); return o ? v4Class(o) : 'reserved'; }
  if (fam !== 6) return 'reserved';
  const p = ipv6ToBytes(ip);
  if (!p) return 'reserved';
  const b = p.bytes;
  const zero = (s, e) => { for (let i = s; i < e; i++) if (b[i] !== 0) return false; return true; };
  const emb4 = (s) => v4Class([b[s], b[s + 1], b[s + 2], b[s + 3]]);
  if (zero(0, 16)) return 'unspecified';                                            // ::
  if (zero(0, 15) && b[15] === 1) return 'loopback';                                // ::1
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return emb4(12);             // ::ffff:0:0/96 IPv4-mapped
  // NAT64 well-known 64:ff9b::/96 → embedded v4; local-use 64:ff9b:1::/48 is local by definition → blocked
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    if (zero(4, 12)) return emb4(12);
    if (b[4] === 0x00 && b[5] === 0x01) return 'reserved';                          // 64:ff9b:1::/48
    return 'reserved';
  }
  if (zero(0, 12)) return 'reserved';                                               // ::/96 IPv4-compatible (deprecated)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'linklocal';                  // fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return 'reserved';                   // fec0::/10 deprecated site-local
  if ((b[0] & 0xfe) === 0xfc) return 'ula';                                         // fc00::/7
  if (b[0] === 0xff) return 'reserved';                                             // ff00::/8 multicast
  if ((b[0] & 0xe0) !== 0x20) return 'reserved';                                    // outside 2000::/3 global-unicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return 'reserved';           // 2001:db8::/32 doc
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return v4Class([b[12] ^ 0xff, b[13] ^ 0xff, b[14] ^ 0xff, b[15] ^ 0xff]); // 2001::/32 Teredo (inverted client v4)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x02 && b[4] === 0 && b[5] === 0) return 'reserved'; // 2001:2::/48 benchmarking
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && (b[3] & 0xf0) === 0x10) return 'reserved';  // 2001:10::/28 ORCHID (deprecated)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && (b[3] & 0xf0) === 0x20) return 'reserved';  // 2001:20::/28 ORCHIDv2
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0x00) return 'reserved';                   // 3fff::/20 documentation
  if (b[0] === 0x20 && b[1] === 0x02) return emb4(2);                               // 2002::/16 6to4 embedded v4
  return 'public';
}
export const isBlockedIp = (ip) => classifyIp(ip) !== 'public';
// normalize for peer-verify (::ffff:1.2.3.4 ≡ 1.2.3.4)
export function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  const s = ip.trim().toLowerCase();
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  return m ? m[1] : s;
}

// ---------------- pure URL / MIME policy ----------------
export function checkUrl(raw) {
  let u; try { u = new URL(raw); } catch { return err('bad-url'); }
  if (u.username || u.password) return err('bad-url');
  if (u.protocol !== 'https:') return err('scheme-not-https');
  if (u.port && u.port !== '443') return err('port-not-allowed');
  return { ok: true, url: u };
}
export function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}
export const mimeMatches = (declared, sniffed) => !!sniffed && !!declared && declared.split(';')[0].trim().toLowerCase() === sniffed;

// Decide the next hop from a 3xx: re-run URL policy on the (possibly relative) Location; strip sensitive headers
// when the origin changes.
export function redirectDecision(fromUrl, location, hop, maxRedirects) {
  if (hop >= maxRedirects) return err('too-many-redirects');
  if (!location || !String(location).trim()) return err('redirect-no-location');
  let target; try { target = new URL(location, fromUrl); } catch { return err('bad-url'); }
  if (target.protocol !== 'https:') return err('redirect-not-https');
  const c = checkUrl(target.href); if (!c.ok) return c;
  const sameOrigin = target.origin === new URL(fromUrl).origin;
  return { ok: true, url: c.url, stripSensitive: !sameOrigin };
}

// ---------------- decode + strip + resolution-cap re-encode (pure, byte-driven; unit-tested offline) ----------------
export async function validateAndReencode(buf, declaredCT, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const sniffed = sniffMime(buf);
  const declared = (declaredCT || '').split(';')[0].trim().toLowerCase();
  if (!o.allowMime.includes(declared)) return err('mime-not-allowed', { declaredMime: declared });
  if (!sniffed || !mimeMatches(declared, sniffed)) return err('mime-signature-mismatch', { declaredMime: declared, sniffed });
  let md;
  try { md = await sharp(buf, { limitInputPixels: o.maxPixels, failOn: 'warning', animated: true }).metadata(); }
  catch { return err('decode-failed'); }
  if (md.pages && md.pages > 1 && !o.allowAnimated) return err('animated-rejected');
  const w = md.width || 0, h = md.height || 0;
  if (!w || !h) return err('decode-failed');
  if (w * h > o.maxPixels || Math.max(w, h) > o.maxDim) return err('pixel-limit', { width: w, height: h });
  // Full raster decode + strip (no withMetadata) + downscale to the model cap. Output PNG if alpha, else JPEG.
  let pipe;
  try {
    pipe = sharp(buf, { limitInputPixels: o.maxPixels, failOn: 'warning', animated: false }).rotate();
    if (Math.max(w, h) > o.modelCapPx) pipe = pipe.resize({ width: o.modelCapPx, height: o.modelCapPx, fit: 'inside', withoutEnlargement: true });
    const png = !!md.hasAlpha;
    const outBuf = await (png ? pipe.png({ compressionLevel: 9 }) : pipe.jpeg({ quality: 90 })).toBuffer();
    const out = await sharp(outBuf).metadata();
    return { ok: true, buffer: outBuf, ext: png ? 'png' : 'jpg', mime: png ? 'image/png' : 'image/jpeg', width: out.width, height: out.height };
  } catch { return err('decode-failed'); }
}

// ---------------- broker factory ----------------
export function createBroker({ lookup = dnsLookup, request = httpsRequest } = {}) {
  const resolveAll = (host, deadlineMs) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error('dns-timeout'), { code: 'DNS_TIMEOUT' })), deadlineMs);
    lookup(host, { all: true, verbatim: true }, (e, addrs) => { clearTimeout(t); e ? rej(e) : res(Array.isArray(addrs) ? addrs : [addrs]); });
  });

  // resolve+vet a URL, connect pinned, return a single hop's response (no redirect follow here)
  function oneHop(u, headers, deadlineAt, cap) {
    return new Promise(async (resolve) => {
      const host = u.hostname;
      let addrs;
      try { addrs = await resolveAll(host, Math.max(1, deadlineAt - Date.now())); }
      catch { return resolve(err('dns-failed', { host })); }
      if (!addrs.length) return resolve(err('dns-failed', { host }));
      // Phase 1: IPv4-only resolution. RFC 6052 permits org-specific NAT64 prefixes (/32../96) that can embed a
      // private v4 undetectably, so rather than trust IPv6, we resolve v4 only (museum/Commons hosts are all v4-
      // reachable) and refuse a v6-only host until an environment-aware IPv6 policy exists.
      addrs = addrs.filter(a => Number(a.family) === 4);
      // A v6-only host is a STABLE unsupported-host condition under the Phase-1 IPv4-only policy (NOT a transient DNS
      // hiccup) — return a DISTINCT reason so the selector backs it off instead of retrying it forever.
      if (!addrs.length) return resolve(err('no-ipv4', { host }));
      for (const a of addrs) { const cls = classifyIp(a.address); if (cls !== 'public') return resolve(err('blocked-ip', { host, resolvedIp: a.address, detail: cls })); }
      const pinned = addrs[0];
      // pin the socket to the vetted IP — honor BOTH lookup callback forms (Node may pass {all:true} at connect)
      const pinLookup = (_h, o, cb) => (o && o.all) ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family);
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return resolve(err('timeout', { host }));
      let settled = false, dTimer = null;
      const done = (v) => { if (settled) return; settled = true; if (dTimer) clearTimeout(dTimer); resolve(v); };
      let req;
      try {
        req = request({
          protocol: 'https:', hostname: host, port: 443, path: u.pathname + u.search, method: 'GET',
          headers, lookup: pinLookup, family: pinned.family, agent: false, servername: host, timeout: remaining,
        }, (res) => {
          const peer = normalizeIp(res.socket && res.socket.remoteAddress);
          // FAIL CLOSED: require a non-empty peer that matches the pinned IP (a missing peer must NOT pass)
          if (!peer || peer !== normalizeIp(pinned.address)) { req.destroy(); return done(err('remote-addr-mismatch', { host, resolvedIp: pinned.address, detail: peer || 'none' })); }
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400) { res.resume(); return done({ ok: true, redirect: true, status, location: res.headers.location, host, resolvedIp: pinned.address, finalUrl: u.href }); }
          if (status < 200 || status >= 300) { res.resume(); return done(err('http-status', { status, host })); }
          const declaredMime = res.headers['content-type'] || '';
          const chunks = []; let n = 0;
          res.on('data', (d) => { n += d.length; if (n > cap) { req.destroy(); return done(err('too-large', { host })); } chunks.push(d); });
          res.on('end', () => { if (settled) return; if (!n) return done(err('empty-body', { host })); done({ ok: true, redirect: false, status, buffer: Buffer.concat(chunks), declaredMime, host, resolvedIp: pinned.address, finalUrl: u.href }); });
          res.on('error', () => done(err('network-error', { host })));
        });
      } catch { return done(err('network-error', { host })); }
      // HARD chain deadline: destroy the request at deadlineAt even under a slow drip (not just idle inactivity)
      dTimer = setTimeout(() => { try { req.destroy(); } catch {} done(err('timeout', { host })); }, Math.max(1, deadlineAt - Date.now()));
      req.on('timeout', () => { req.destroy(); done(err('timeout', { host })); });
      req.on('error', () => done(err('network-error', { host })));
      req.end();
    });
  }

  // follow the redirect chain under one shared deadline, re-vetting every hop
  async function stream(rawUrl, { cap, timeoutMs, maxRedirects, userAgent, referer } = {}) {
    const c0 = checkUrl(rawUrl); if (!c0.ok) return c0;
    const deadlineAt = Date.now() + (timeoutMs ?? DEFAULTS.timeoutMs);
    let u = c0.url, hop = 0;
    let headers = baseHeaders(u, userAgent, referer, false);
    while (true) {
      if (Date.now() > deadlineAt) return err('timeout', { host: u.hostname });
      const r = await oneHop(u, headers, deadlineAt, cap);
      if (!r.ok) return r;
      if (!r.redirect) return { ok: true, buffer: r.buffer, declaredMime: r.declaredMime, finalUrl: r.finalUrl, host: r.host, resolvedIp: r.resolvedIp, hops: hop };
      const d = redirectDecision(u.href, r.location, hop, maxRedirects ?? DEFAULTS.maxRedirects);
      if (!d.ok) return d;
      hop += 1; u = d.url;
      headers = baseHeaders(u, userAgent, referer, d.stripSensitive);
    }
  }

  async function fetchImageToModelFile(rawUrl, runImgsDir, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    // request a BOUNDED upstream derivative (Commons ?width, IIIF !size) so a giant master isn't streamed to the cap
    const s = await stream(boundedDerivativeUrl(rawUrl, o.modelCapPx), { cap: o.maxBytes, timeoutMs: o.timeoutMs, maxRedirects: o.maxRedirects, userAgent: o.userAgent, referer: o.referer });
    if (!s.ok) return { ...s, requestedUrl: rawUrl };
    const v = await validateAndReencode(s.buffer, s.declaredMime, o);
    if (!v.ok) return { ...v, requestedUrl: rawUrl, host: s.host };
    const sha256 = createHash('sha256').update(v.buffer).digest('hex');
    const saved = writeExclusive(runImgsDir, `${sha256}.${v.ext}`, v.buffer);
    if (!saved.ok) return { ...saved, requestedUrl: rawUrl };
    return { ok: true, requestedUrl: rawUrl, finalUrl: s.finalUrl, host: s.host, resolvedIp: s.resolvedIp, bytes: v.buffer.length, mime: v.mime, ext: v.ext, declaredMime: s.declaredMime, sha256, width: v.width, height: v.height, savedPath: saved.path, hops: s.hops };
  }

  // `stream` stays PRIVATE (never returned): callers must go through fetchImageToModelFile so raw bytes can't skip
  // MIME/decode/re-encode. (probeImage removed until Phase 2 — it needs a real early-close success mode.)
  return { fetchImageToModelFile, classifyIp, isBlockedIp, checkUrl, sniffMime, mimeMatches, redirectDecision, validateAndReencode };
}

// host-specific bounded upstream URL so we don't download a full master just to downscale it. CLAMPS an existing
// oversized size too (a caller-supplied ?width=999999999 or IIIF !BIG,BIG is reduced to the cap, not passed through).
const clampInt = (v, max) => { const n = Number(v); return (!Number.isFinite(n) || n <= 0 || n > max) ? max : Math.round(n); };
function boundedDerivativeUrl(raw, capPx) {
  try {
    const u = new URL(raw);
    const target = Math.round(capPx * 1.3);
    if (/\/Special:FilePath\//i.test(u.pathname)) { u.searchParams.set('width', String(clampInt(u.searchParams.get('width'), target))); return u.href; }
    // IIIF size segment /{region}/{size}/{rotation}/{quality}.{fmt}. Normalize the SIZE to a hard pixel bound: an
    // explicit W,H / !W,H / W, / ,H is clamped to the cap; ANY other form (full, max, pct:N incl. pct:999999, or
    // unsupported syntax) is replaced with !cap,cap — so no IIIF size can request more than the cap.
    u.pathname = u.pathname.replace(/(\/(?:full|square|pct:[\d.]+|\d+,\d+,\d+,\d+)\/)([^/]+)(\/\d+\/(?:default|color|gray|bitonal)\.(?:jpe?g|png|webp|tif))/i,
      (m, pre, size, post) => {
        const mm = size.match(/^!?(\d*),(\d*)$/);
        const ns = (mm && (mm[1] || mm[2])) ? `!${mm[1] ? clampInt(mm[1], target) : target},${mm[2] ? clampInt(mm[2], target) : target}` : `!${target},${target}`;
        return pre + ns + post;
      });
    return u.href;
  } catch { return raw; }
}

// only UA/Accept/scoped-Referer; sensitive headers never set, never forwarded across origins. Accept advertises
// ONLY the formats the broker actually accepts (jpeg/png/webp/gif — no AVIF, which the allowlist rejects).
function baseHeaders(u, userAgent, referer, stripSensitive) {
  const h = { 'User-Agent': userAgent || `GessoImgBroker/1 (${BROKER_POLICY_VERSION})`, 'Accept': 'image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5' };
  if (!stripSensitive) { const ref = referer && REFERER_HOSTS[u.hostname]; if (ref) h['Referer'] = ref; }
  return h;
}

function writeExclusive(dir, name, buf) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) return err('write-failed', { detail: 'dir-symlink' });
  } catch { return err('write-failed', { detail: 'mkdir' }); }
  const finalPath = join(dir, name);
  const tmp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
  let fd;
  try { fd = openSync(tmp, 'wx', 0o600); writeSync(fd, buf); closeSync(fd); renameSync(tmp, finalPath); }
  catch (e) { try { rmSync(tmp, { force: true }); } catch {} return err('write-failed', { detail: e && e.code }); }
  return { ok: true, path: finalPath };
}

const broker = createBroker();
export default broker;
export const fetchImageToModelFile = broker.fetchImageToModelFile;
