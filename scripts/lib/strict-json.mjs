// A strict RFC 8259 JSON parser for transcript evidence (VSD-093, Codex review R7-A1).
// JSON.parse keeps only the LAST of duplicate member names, so an earlier copy of a value (a Read's `input`, an
// envelope's `content`) silently disappears before anything can check it. This parser accepts exactly the JSON
// grammar and REPORTS every duplicate member name, at any depth, comparing names after their escapes are decoded
// ("input" and "input" are the same name; a surrogate-pair escape equals the literal character).
//
// parseStrictJson(text, { onObject }) -> { value, duplicates, strings }
//   value      : the parsed value with JSON.parse's object shape (last duplicate wins, `__proto__` is an own key).
//                It is only safe to use when `duplicates` is empty.
//   duplicates : [{ name, at }] every repeated member name (decoded) and the source offset of the repeat.
//   strings    : every decoded string token, keys and values, of every copy, in source order: [{ text, key }].
//   onObject   : optional (object, sourceText) callback, called for every object as it is closed.
// Throws SyntaxError on anything that is not exactly one JSON value surrounded by JSON whitespace.
const WS = new Set([' ', '\t', '\n', '\r']);
const SIMPLE_ESC = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

export function parseStrictJson(text, { onObject = null } = {}) {
  if (typeof text !== 'string') throw new TypeError('parseStrictJson needs a string');
  let i = 0;
  const duplicates = [], strings = [];
  const fail = why => { throw new SyntaxError(`strict JSON: ${why} at ${i}`); };
  const ws = () => { while (i < text.length && WS.has(text[i])) i++; };
  const str = key => {
    if (text[i] !== '"') fail('expected a string');
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i];
      if (c === '"') { i++; break; }
      if (c < ' ') fail('unescaped control character in string');
      if (c !== '\\') { out += c; i++; continue; }
      const e = text[i + 1];
      if (e === 'u') {
        const h = text.slice(i + 2, i + 6);
        if (!HEX4.test(h)) fail('bad \\u escape');
        out += String.fromCharCode(parseInt(h, 16)); i += 6; // code units: a surrogate pair decodes to one character
      } else if (e !== undefined && Object.hasOwn(SIMPLE_ESC, e)) { out += SIMPLE_ESC[e]; i += 2; }
      else fail('bad escape');
    }
    strings.push({ text: out, key });
    return out;
  };
  const value = depth => {
    if (depth > 512) fail('nesting too deep');
    ws();
    const c = text[i], s = i;
    if (c === '"') return str(false);
    if (c === '{') {
      i++; const o = {}, seen = new Set(); ws();
      if (text[i] === '}') i++;
      else for (;;) {
        ws(); const at = i, k = str(true); ws();
        if (text[i] !== ':') fail('expected :');
        i++;
        if (seen.has(k)) duplicates.push({ name: k, at }); else seen.add(k);
        Object.defineProperty(o, k, { value: value(depth + 1), writable: true, enumerable: true, configurable: true });
        ws(); const d = text[i++];
        if (d === '}') break;
        if (d !== ',') { i--; fail('expected , or }'); }
      }
      onObject?.(o, text.slice(s, i));
      return o;
    }
    if (c === '[') {
      i++; const a = []; ws();
      if (text[i] === ']') i++;
      else for (;;) {
        a.push(value(depth + 1)); ws(); const d = text[i++];
        if (d === ']') break;
        if (d !== ',') { i--; fail('expected , or ]'); }
      }
      return a;
    }
    for (const [w, v] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(w, i)) { i += w.length; return v; }
    NUM.lastIndex = i; const m = NUM.exec(text);
    if (!m || !m[0]) fail('unexpected token');
    i = NUM.lastIndex;
    return Number(m[0]);
  };
  const v = value(0); ws();
  if (i !== text.length) fail('trailing data');
  return { value: v, duplicates, strings };
}
