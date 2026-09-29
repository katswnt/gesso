// Audit evidence: deterministic HTML extraction and budgeted, context-windowed passage selection. Offline.
import assert from 'node:assert/strict';
import { extractText, selectPassages, buildEvidence } from '../scripts/pass-b-audit-evidence.mjs';

let n = 0; const check = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
check('extraction drops scripts, nav, comments and citation markers; decodes entities; is deterministic', () => {
  const html = '<html><head><style>x{}</style><script>alert(1)</script></head><body><nav>Menu</nav><!-- c --><p>Klee&#8217;s <b>Angelus&nbsp;Novus</b><sup class="reference">[1]</sup> (1920).</p><footer>foot</footer></body></html>';
  const t = extractText(html);
  assert.equal(t, 'Klee’s Angelus Novus (1920).');
  assert.equal(extractText(html), t);
});
const page = { sourceId: 's1', text: 'Intro line here. Benjamin bought the print in 1921. He called it the angel of history in his essay. It hung in his study.\nUnrelated paragraph about weather and trains.' };
check('selection keeps one sentence of context on each side, within the paragraph', () => {
  const p = selectPassages({ componentId: 'why', text: 'Benjamin saw an angel of history in the essay' }, [page]);
  assert.ok(p.length >= 1);
  assert.equal(p[0].text, 'Benjamin bought the print in 1921. He called it the angel of history in his essay. It hung in his study.');
  assert.ok(!p.some(x => /weather/.test(x.text)));
});
check('no passage below the minimum overlap; budget caps total characters; ids are stable', () => {
  assert.deepEqual(selectPassages({ componentId: 'x', text: 'completely different vocabulary' }, [page]), []);
  const input = { components: [{ componentId: 'a', text: 'Benjamin angel history essay' }, { componentId: 'b', text: 'Benjamin print 1921 study' }] };
  const e1 = buildEvidence(input, [page], { perComponent: 3, perWorkChars: 120, minScore: 2 });
  assert.ok(e1.chars <= 120);
  const e2 = buildEvidence(input, [page], { perComponent: 3, perWorkChars: 120, minScore: 2 });
  assert.deepEqual(e1, e2);
});
console.log(`pass-b-audit-evidence.test: ${n} checks passed`);
