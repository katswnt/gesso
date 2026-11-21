// Unit tests for scripts/lib/strict-json.mjs (VSD-093, Codex review R7-A1): the strict whole-line JSON parser the
// teaching-v2 classifier uses so a duplicate member name can never hide an earlier copy of transcript evidence.
// Pure: no model call, network, git or file I/O.
import assert from 'node:assert/strict';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const load = async () => (await import('../scripts/lib/strict-json.mjs')).parseStrictJson;
const names = r => r.duplicates.map(d => d.name);

test('agrees with JSON.parse on ordinary JSON (values, nesting, arrays, numbers, literals, unicode)', async () => {
  const parse = await load();
  for (const t of ['{}', '[]', '0', '-0', '1.5e-3', '-12E+4', 'true', 'false', 'null', '""', '"a\\"b\\\\c\\/d\\b\\f\\n\\r\\t"',
    '{"a":[1,{"b":[{"c":null}]},"x"],"d":{"e":{"f":true}}}', '[[[]],[{}],[1,[2,[3]]]]', '"\\u00e9\\u4e2d"', '"😀"', '"\\ud83d\\ude00"', '{"__proto__":1}']) {
    const r = parse(t);
    assert.deepEqual(r.value, JSON.parse(t), t); assert.deepEqual(r.duplicates, [], t);
  }
  assert.ok(Object.hasOwn(parse('{"__proto__":{"x":1}}').value, '__proto__'), '__proto__ is an own key, as with JSON.parse');
});
test('whitespace: only space, tab, LF and CR are insignificant; anything else is rejected', async () => {
  const parse = await load();
  assert.deepEqual(parse(' \t\r\n{ "a" :\t[ 1 ,\n2 ] }\r\n ').value, { a: [1, 2] });
  for (const t of [' {}', '{} ', '{ "a":1}', '\v{}', '\f[]']) assert.throws(() => parse(t), SyntaxError, JSON.stringify(t));
});
test('rejects everything that is not exactly one JSON value', async () => {
  const parse = await load();
  for (const t of ['', ' ', '{', '}', '{"a"}', '{"a":}', '{"a":1,}', '[1,]', '[,1]', "{'a':1}", '{a:1}', '01', '1.', '.5', '+1', '-', '1e', 'NaN', 'Infinity',
    'tru', 'nul', '"abc', '"\\x41"', '"\\u12"', '"\\u12G4"', '"a\u0001b"', '"tab\there"', '{"a":1}{"b":2}', '{"a":1} x', '[1 2]', '{"a" 1}', '{"a":1 "b":2}', '"\\"']) {
    assert.throws(() => parse(t), SyntaxError, JSON.stringify(t));
    let jp = true; try { JSON.parse(t); } catch { jp = false; }
    assert.equal(jp, false, `JSON.parse should also reject ${JSON.stringify(t)}`);
  }
});
test('reports a duplicate member name at the top level, in nested objects, and inside arrays', async () => {
  const parse = await load();
  assert.deepEqual(names(parse('{"a":1,"a":2}')), ['a']);
  assert.deepEqual(names(parse('{"x":{"y":{"a":1,"b":2,"a":3}}}')), ['a']);
  assert.deepEqual(names(parse('[{"k":1},{"k":2},[{"z":1,"z":1}]]')), ['z'], 'the same name in SIBLING objects is not a duplicate');
  assert.deepEqual(names(parse('{"a":{"a":{"a":1}}}')), [], 'the same name at different depths is not a duplicate');
  assert.deepEqual(names(parse('{"a":1,"a":2,"a":3}')), ['a', 'a']);
  const r = parse('{"input":{"file_path":"/etc/passwd"},"input":{"file_path":"/ok"}}');
  assert.deepEqual(names(r), ['input']); assert.deepEqual(r.value, { input: { file_path: '/ok' } }, 'value keeps JSON.parse last-wins shape');
  assert.equal(r.duplicates[0].at, '{"input":{"file_path":"/etc/passwd"},'.length, 'offset of the repeated name');
});
test('compares names AFTER decoding escapes: \\u escapes, simple escapes and surrogate pairs', async () => {
  const parse = await load();
  assert.deepEqual(names(parse('{"input":1,"in\\u0070ut":2}')), ['input']);
  assert.deepEqual(names(parse('{"in\\u0070ut":1,"input":2}')), ['input']);
  assert.deepEqual(names(parse('{"\\u0069\\u006E\\u0070\\u0075\\u0074":1,"input":2}')), ['input'], 'upper- and lower-case hex');
  assert.deepEqual(names(parse('{"a/b":1,"a\\/b":2}')), ['a/b'], 'escaped solidus');
  assert.deepEqual(names(parse('{"a\\nb":1,"a\\u000ab":2}')), ['a\nb']);
  assert.deepEqual(names(parse('{"😀":1,"\\ud83d\\ude00":2}')), ['😀'], 'a surrogate-pair escape equals the literal character');
  assert.deepEqual(names(parse('{"\\uD83D\\uDE00":1,"\\ud83d\\ude00":2}')), ['😀']);
  assert.deepEqual(names(parse('{"\\ud83d":1,"\\ud83d\\ude00":2}')), [], 'a lone surrogate is a different name');
  assert.deepEqual(names(parse('{"é":1,"e\\u0301":2}')), [], 'no Unicode normalization: NFC and NFD spellings differ, as in JSON.parse');
});
test('collects every decoded string token of every copy (keys and values) in source order', async () => {
  const parse = await load();
  const r = parse('{"in\\u0070ut":{"file_path":"\\/etc\\/passwd"},"input":["x",{"k":"v"}]}');
  assert.deepEqual(r.strings, [{ text: 'input', key: true }, { text: 'file_path', key: true }, { text: '/etc/passwd', key: false },
    { text: 'input', key: true }, { text: 'x', key: false }, { text: 'k', key: true }, { text: 'v', key: false }]);
});
test('onObject receives every object with its exact source text, including earlier duplicate copies', async () => {
  const parse = await load();
  const seen = [];
  const t = '{ "a" : { "b" : 1 } , "a" : {"c":2} }';
  parse(t, { onObject: (o, raw) => seen.push([JSON.stringify(o), raw]) });
  assert.deepEqual(seen, [['{"b":1}', '{ "b" : 1 }'], ['{"c":2}', '{"c":2}'], ['{"a":{"c":2}}', t.trim()]]);
});

let pass = 0; const failed = [];
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { failed.push(name); console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0].slice(0, 300)}`); }
}
console.log(`strict-json.test: ${pass}/${tests.length} checks passed`);
if (failed.length) process.exit(1);
