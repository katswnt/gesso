// Hand-built PDF fixtures for the source-text regressions (VSD-092 review fix 6). Deterministic, no dependencies.
import { deflateSync } from 'node:zlib';

// objects: array of { dict, stream?: Buffer } (object numbers start at 1; object 1 must be the catalog).
export function buildPdf(objects) {
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')]; const offsets = []; let at = parts[0].length;
  objects.forEach((o, i) => {
    const head = o.stream ? `${i + 1} 0 obj\n${o.dict.replace(/>>\s*$/, ` /Length ${o.stream.length} >>`)}\nstream\n` : `${i + 1} 0 obj\n${o.dict}\nendobj\n`;
    const chunk = o.stream ? Buffer.concat([Buffer.from(head, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]) : Buffer.from(head, 'latin1');
    offsets.push(at); parts.push(chunk); at += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
const pdfStr = s => `(${String(s).replace(/[\\()]/g, m => `\\${m}`)})`;
// Lines 40pt apart (separate paragraphs) in font `font`, starting at `y`.
export const textOps = (lines, y = 720, font = 'F1') => `BT /${font} 12 Tf 72 ${y} Td ${lines.map((l, i) => `${i ? '0 -40 Td ' : ''}${pdfStr(l)} Tj`).join(' ')} ET`;
export const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
// A composite (Type0, Identity-H) font with NO ToUnicode map: its codes cannot be decoded to text honestly.
export const UNMAPPED_TYPE0 = '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Unknown /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Unknown /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor << /Type /FontDescriptor /FontName /ABCDEF+Unknown /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >> >>] >>';
// A simple font whose /Differences use subset glyph names with no Unicode meaning and no ToUnicode map.
export const UNMAPPED_DIFFERENCES = '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Custom /Encoding << /Type /Encoding /Differences [65 /g17 /g18 /g19] >> >>';
const asciiHex = b => Buffer.from(`${Buffer.from(b).toString('hex')}>`, 'latin1');
// One page; `streams` = [{ text: content-stream string, filter: 'flate'|'hex'|'none'|'<any /Name>' }]; fonts by resource name.
export function pagePdf(streams, { fonts = { F1: HELVETICA } } = {}) {
  const names = Object.keys(fonts), fontRefs = names.map((k, i) => `/${k} ${4 + i} 0 R`).join(' ');
  const first = 4 + names.length, contents = streams.map((_, i) => `${first + i} 0 R`).join(' ');
  return buildPdf([
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << ${fontRefs} >> >> /Contents [${contents}] >>` },
    ...names.map(k => ({ dict: fonts[k] })),
    ...streams.map(s => {
      const raw = Buffer.from(s.text, 'latin1');
      if (s.filter === 'hex') return { dict: '<< /Filter /ASCIIHexDecode >>', stream: asciiHex(raw) };
      if (s.filter === 'none') return { dict: '<< >>', stream: raw };
      if (s.filter && s.filter.startsWith('/')) return { dict: `<< /Filter ${s.filter} >>`, stream: raw };
      return { dict: '<< /Filter /FlateDecode >>', stream: deflateSync(raw) };
    }),
  ]);
}
// A page whose only content stream inflates to `inflatedBytes` of spaces (compressed-size amplification).
export function bombPdf(inflatedBytes) {
  return buildPdf([
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>' },
    { dict: HELVETICA },
    { dict: '<< /Filter /FlateDecode >>', stream: deflateSync(Buffer.alloc(inflatedBytes, 0x20), { level: 9 }) },
  ]);
}
