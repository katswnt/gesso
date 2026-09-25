// Offline regressions for the repaired corpus B0-B3 collector (no model calls, no network).
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, readdirSync, existsSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isPatchUpgrade, runIdFor, computeQueue, classifySpawn, attemptFilename, derivativeMatches, buildPriorityQueue, isUsageInterrupted, isLeaseInterrupted, heldToRequeue, acquireStageLease, pacificClock, callWindow, inspectWork, inspectCorpus, applyHistoryRepair, readLedger, persistFatal, preservedFatal, executeCorpusAttempt, effectivePromptFor, bindExecutionPolicy, executionEpochs, executionPolicy, rebindRuntime, stopForException, enforceValidationBudget, retryTransportOnce, COLLECTOR_VERSION } from '../scripts/pass-b-corpus-collect.mjs';
import { syntheticFixture, producerEvidence, trustedCatalog, runWorkStages, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION } from '../scripts/lib/pass-b-calibration.mjs';
import { captureStageCompletion } from '../scripts/lib/vision-content-capture.mjs';
import { stagePrompts } from '../scripts/lib/pass-b-prompts.mjs';
import { BROKER_POLICY_VERSION } from '../scripts/lib/img-broker.mjs';
import { sha256, stableJson } from '../scripts/lib/vision-legacy.mjs';

function tree(dir) {
  const result = {};
  const walk = (d, prefix = '') => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const key = `${prefix}${e.name}`;
    if (e.isSymbolicLink()) { result[key] = 'symlink'; continue; }
    if (e.isDirectory()) { result[key] = 'directory'; walk(join(d, e.name), `${key}/`); }
    else result[key] = sha256(readFileSync(join(d, e.name)));
  } }; walk(dir); return result;
}
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const PH = { B1: sha256('b1'), B2: sha256('b2'), B3: sha256('b3'), B4: sha256('b4') };

t('1. a model change changes run identity', () => {
  assert.notStrictEqual(runIdFor({ promptHashes: PH, model: 'claude-sonnet-4-6' }), runIdFor({ promptHashes: PH, model: 'claude-opus-5' }));
});
t('2. a B4-only change does NOT change run identity', () => {
  assert.strictEqual(runIdFor({ promptHashes: { ...PH, B4: sha256('b4-v1') } }), runIdFor({ promptHashes: { ...PH, B4: sha256('b4-v2-totally-different') } }));
});
t('2b. a B1/B2/B3 change DOES change run identity', () => {
  assert.notStrictEqual(runIdFor({ promptHashes: PH }), runIdFor({ promptHashes: { ...PH, B2: sha256('b2-changed') } }));
});
t('3. held work is excluded without requeue, included after requeue', () => {
  const order = ['a', 'b', 'c']; const eligibleSet = new Set(order); const doneSet = new Set();
  const held = new Set(['b']);
  assert.deepStrictEqual(computeQueue(order, { eligibleSet, doneSet, heldSet: held }), ['a', 'c']);
  held.delete('b'); // narrow requeue
  assert.deepStrictEqual(computeQueue(order, { eligibleSet, doneSet, heldSet: held }), ['a', 'b', 'c']);
});
t('4. no PASS_B_CORPUS_IDS subset filter exists (cannot rewrite corpus totals)', () => {
  const src = readFileSync('scripts/pass-b-corpus-collect.mjs', 'utf8');
  assert.ok(!/PASS_B_CORPUS_IDS/.test(src), 'the totals-corrupting subset filter must be gone');
  assert.ok(/PASS_B_CORPUS_REQUEUE/.test(src), 'the narrow requeue mechanism is present');
});
t('5. identical/empty stdout preserves distinct attempts (monotonic seq)', () => {
  assert.notStrictEqual(attemptFilename('B1', 1, ''), attemptFilename('B1', 2, ''));
  assert.notStrictEqual(attemptFilename('B1', 1, 'same'), attemptFilename('B1', 2, 'same'));
});
t('6. fatal provenance failures classify as fatal (never retried)', () => {
  assert.strictEqual(classifySpawn({ apiKeySource: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true }).kind, 'fatal');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-opus-5', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true }).kind, 'fatal');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true, imageReceipt: { ok: false, bad: ['/etc/passwd'] } }).kind, 'fatal');
});
t('6b. usage-limit and transport classify correctly (stop vs retry)', () => {
  assert.strictEqual(classifySpawn({ usageLimit: true }).kind, 'usage-limit');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 1, final: null }).kind, 'retryable');
  assert.strictEqual(classifySpawn({ apiKeySource: 'none', model: 'claude-sonnet-4-6', expectedModel: 'claude-sonnet-4-6', exitCode: 0, final: {}, structuredOutputPresent: true, imageReceipt: { ok: true, bad: [] } }).kind, 'ok');
});
t('7. an exclusive lease refuses a second holder (wx)', () => {
  const d = mkdtempSync(join(tmpdir(), 'lease-')); const p = join(d, 'collector.lease');
  try { writeFileSync(p, '1', { flag: 'wx' }); assert.throws(() => writeFileSync(p, '2', { flag: 'wx' }), /EEXIST/); } finally { rmSync(d, { recursive: true, force: true }); }
});
t('8. a tampered cached image is rejected by rehash-before-reuse', () => {
  const d = mkdtempSync(join(tmpdir(), 'img-')); const f = join(d, 'x.jpg'); writeFileSync(f, 'imagebytes');
  const good = createHash('sha256').update(readFileSync(f)).digest('hex'); // exact bytes hash
  try {
    assert.ok(derivativeMatches(f, good), 'untampered derivative matches its sha');
    writeFileSync(f, 'tampered-bytes'); assert.ok(!derivativeMatches(f, good), 'tampered derivative rejected');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
t('9. resume reuses verified checkpoints without spawning (done => empty queue)', () => {
  const order = ['a', 'b']; const eligibleSet = new Set(order);
  assert.deepStrictEqual(computeQueue(order, { eligibleSet, doneSet: new Set(order), heldSet: new Set() }), [], 'all-done => nothing to spawn');
});
t('10. priority order: next-7 scheduled works precede fallback; region rotation spreads', () => {
  const pool = [
    { id: 'sched1', img: 'u', fame: 1, region: 'Asia', src: 's', medium: 'm' },
    { id: 'famous', img: 'u', fame: 9999, region: 'Europe', src: 's', medium: 'm' },
    { id: 'r-eu1', img: 'u', fame: 5, region: 'Europe', src: 's', medium: 'm' },
    { id: 'r-as1', img: 'u', fame: 4, region: 'Asia', src: 's', medium: 'm' },
  ];
  const daily = { easy: [], medium: ['r-eu1', 'r-as1'], hard: [], impossible: [], byDate: { '2026-09-17': { easy: ['sched1'], medium: [], hard: [], impossible: [] } } };
  const q = buildPriorityQueue(pool, daily, { today: '2026-09-17', windowOnly: false });
  assert.strictEqual(q[0], 'sched1', 'a work scheduled today comes first');
  assert.ok(q.indexOf('r-eu1') < q.indexOf('famous'), 'tiered Medium precedes ungrouped fallback');
});
t('11. relative CLI plan is write-free in an isolated repository', () => {
  const d = mkdtempSync(join(tmpdir(), 'corpus-cli-'));
  try {
    mkdirSync(join(d, 'scripts'));
    cpSync('scripts/pass-b-corpus-collect.mjs', join(d, 'scripts/pass-b-corpus-collect.mjs'));
    symlinkSync(resolve('scripts/lib'), join(d, 'scripts/lib'));
    mkdirSync(join(d, 'data'));
    for (const [file, global] of [['pool.js', 'ARTEFACTUM_POOL'], ['daily-order.js', 'ARTEFACTUM_DAILY'], ['teach-works.js', 'ARTEFACTUM_CUES'], ['hotspots.js', 'ARTEFACTUM_HOTSPOTS'], ['vision.js', 'ARTEFACTUM_VISION']]) writeFileSync(join(d, 'data', file), `window.${global}=${file === 'pool.js' ? '[]' : '{}'};`);
    writeFileSync(join(d, 'data/vision-audit.json'), '{"ids":[]}');
    const before = tree(d);
    const out = execFileSync(process.execPath, ['scripts/pass-b-corpus-collect.mjs'], { cwd: d, encoding: 'utf8', timeout: 60000, env: { ...process.env, PASS_B_CORPUS_REQUEUE: '' } });
    assert.match(out, /^runId: corpus-b3-/m);
    assert.match(out, /READ-ONLY PLAN/);
    assert.deepStrictEqual(tree(d), before, 'plan creates no ledger, migration, lease, run folder, or other file');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

t('12. usage-limit interruption is not terminal; genuine stage-fail is', () => {
  assert.ok(isUsageInterrupted({ B1: 'complete', B2: 'failed:subscription usage limit', B3: 'not-requested' }), 'usage-limit mid-pipeline => interrupted (not held)');
  assert.ok(!isUsageInterrupted({ B1: 'complete', B2: 'failed:invalid B2 body: guideAnswers', B3: 'not-requested' }), 'schema fail => genuine hold');
});
t('13. absent hold reasons never authorize a requeue', () => {
  assert.deepStrictEqual(heldToRequeue(['a', 'b', 'c'], { b: 'B0:http-status' }), [], 'unknown and genuine holds stay terminal');
});

t('14. stale-lease holds requeue, but genuine content holds remain terminal', () => {
  const reasons = {
    stale: 'stage-fail:{"B2":"failed:stage B2 leased by another collector"}',
    content: 'stage-fail:{"B2":"failed:invalid B2 body: catalog.sensitivity"}',
  };
  assert.deepStrictEqual(heldToRequeue(['stale', 'content'], reasons), ['stale']);
  assert.ok(isLeaseInterrupted({ B1: 'complete', B2: 'failed:stage B2 leased by another collector: stage lease is active (pid 7)' }));
  assert.ok(!isLeaseInterrupted({ B1: 'complete', B2: 'failed:invalid B2 body: guideAnswers' }));
});

t('15. a well-formed dead-PID stage lease is reclaimed, while a live lease is preserved', () => {
  const d = mkdtempSync(join(tmpdir(), 'stage-lease-')); const p = join(d, 'B2.lease');
  try {
    writeFileSync(p, '12345 2026-09-21T18:00:00.000Z');
    const recovered = acquireStageLease(p, { pid: 99999, now: '2026-09-22T18:00:00.000Z', isAlive: () => false });
    assert.deepStrictEqual(recovered, { recoveredStale: true, priorPid: 12345 });
    assert.strictEqual(readFileSync(p, 'utf8'), '99999 2026-09-22T18:00:00.000Z');
    assert.throws(() => acquireStageLease(p, { pid: 77777, isAlive: () => true }), /stage lease is active/);
    assert.strictEqual(readFileSync(p, 'utf8'), '99999 2026-09-22T18:00:00.000Z', 'live lease remains untouched');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

t('16. malformed stage lease fails closed and is never deleted', () => {
  const d = mkdtempSync(join(tmpdir(), 'stage-lease-malformed-')); const p = join(d, 'B3.lease');
  try {
    writeFileSync(p, 'not-a-valid-owner');
    assert.throws(() => acquireStageLease(p, { pid: 2, isAlive: () => false }), /malformed ownership/);
    assert.strictEqual(readFileSync(p, 'utf8'), 'not-a-valid-owner');
  } finally { rmSync(d, { recursive: true, force: true }); }
});



const PROMPTS = stagePrompts();
const currentRun = runIdFor({ promptHashes: Object.fromEntries(Object.entries(PROMPTS).map(([k,v]) => [k, sha256(v)])) });
const at = s => new Date(s);
for (const [iso, day, mayStart] of [
  ['2026-09-23T06:59:59Z', '2026-09-22', false],
  ['2026-09-23T07:00:00Z', '2026-09-23', true],
  ['2026-09-23T15:29:59Z', '2026-09-23', true],
  ['2026-09-23T15:30:00Z', '2026-09-23', false],
  ['2026-09-23T16:00:00Z', '2026-09-23', false],
  ['2026-09-24T05:00:00Z', '2026-09-23', false],
  ['2026-12-23T08:00:00Z', '2026-12-23', true],
  ['2026-12-23T16:30:00Z', '2026-12-23', false],
  ['2026-03-08T10:00:00Z', '2026-03-08', true],
  ['2026-11-01T09:30:00Z', '2026-11-01', true],
]) t(`Pacific date/DST/start boundary ${iso}`, () => {
  const c = pacificClock(at(iso)); assert.equal(c.date, day); assert.equal(c.mayStart, mayStart);
  if (!mayStart) assert.throws(() => callWindow(at(iso)), /protected-hours/);
  else assert.ok(callWindow(at(iso)).timeout <= c.remainingMs);
});
t('date-first ordering cannot rotate tomorrow ahead of today; horizon excludes Easy/fallback', () => {
  const pool = ['today-a', 'today-b', 'tomorrow', 'last', 'outside', 'easy'].map((id,i) => ({ id, img:'https://x.test/a', region:i === 2 ? 'Asia' : 'Europe' }));
  const daily = { easy:['easy'], byDate: {
    '2026-09-22':{easy:['today-a','today-b']}, '2026-09-23':{easy:['tomorrow']},
    '2026-10-21':{easy:['last']}, '2026-10-22':{easy:['outside']},
  } };
  assert.deepEqual(buildPriorityQueue(pool, daily, {today:'2026-09-22'}), ['today-a','today-b','tomorrow','last']);
  assert.deepEqual(computeQueue(buildPriorityQueue(pool,daily,{today:'2026-09-22'}), {eligibleSet:new Set(pool.map(p=>p.id)),doneSet:new Set(['today-a','today-b','tomorrow','last']),heldSet:new Set()}), []);
});
t('fame quintile is calculated separately for Medium, Hard and Impossible', () => {
  const pool = ['m','h','i'].flatMap((tier,t) => Array.from({length:5},(_,i)=>({ id:`${tier}${i}`,img:'u',fame:1000-t*100-i })));
  const daily = {medium:pool.filter(p=>p.id[0]==='m').map(p=>p.id),hard:pool.filter(p=>p.id[0]==='h').map(p=>p.id),impossible:pool.filter(p=>p.id[0]==='i').map(p=>p.id)};
  const q = buildPriorityQueue(pool,daily,{today:'2026-09-22',windowOnly:false});
  assert.ok(q.indexOf('h0')<q.indexOf('m1')); assert.ok(q.indexOf('i0')<q.indexOf('m1'));
});

function fixture({complete=['B1','B2','B3'],id='test-work'}={}) {
  const root = mkdtempSync(join(tmpdir(),'corpus-evidence-')), runDir=join(root,'current'), priorDir=join(root,'prior');
  const p={id,title:'Test',artist:'Anon',y:1650,place:'Somewhere',medium:'oil',style:'Baroque',img:'https://example.test/image.jpg'};
  const catalog=trustedCatalog(p),legacy={workId:id,teaching:{why:'Existing teaching'},counts:{notes:1}};
  const imgSha256=sha256('test image bytes'),ext='png',imageFile=`${imgSha256}.${ext}`;
  const workRunDir=join(runDir,'works',sha256(id).slice(0,24));
  mkdirSync(join(workRunDir,'attempts'),{recursive:true}); mkdirSync(join(runDir,'imgs'));
  writeFileSync(join(runDir,'imgs',imageFile),'test image bytes');
  writeFileSync(join(workRunDir,'b0-prep.json'),JSON.stringify({work:{id},trustedCatalog:catalog,legacy,image:{ok:true,imgSha256,ext}}));
  const bodies=syntheticFixture().bodies;
  const transcript=(stage,body,{apiKeySource='none',error=false,result='',version='2.1.280',haikuDominates=false}={}) => {
    const blocks=stage==='B2' ? [{type:'tool_use',id:'s',name:'WebSearch',input:{query:'test'}},{type:'tool_use',id:'f',name:'WebFetch',input:{url:'https://example.test'}}] : [{type:'tool_use',id:'r',name:'Read',input:{file_path:`./${imageFile}`}}];
    const results=stage==='B2' ? ['s','f'].map(id=>({type:'tool_result',tool_use_id:id,content:[{type:'text',text:'Museum record text with object details. '.repeat(10)}]})) : [{type:'tool_result',tool_use_id:'r',content:[{type:'image'}]}];
    return [{type:'system',subtype:'init',apiKeySource,claude_code_version:version,model:CALIBRATION_MODEL},{type:'assistant',message:{content:blocks}},{type:'user',message:{content:results}},{type:'result',subtype:'success',is_error:error,result,structured_output:body,modelUsage:{[CALIBRATION_MODEL]:{output_tokens:10},...(haikuDominates?{'claude-haiku-4-5-20251001':{output_tokens:100}}:{})}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
  };
  const context=stage=>stage==='B2'?syntheticFixture().contexts.B2:stage==='B3'?syntheticFixture().contexts.B3:{};
  let seq=0;
  const attempt=(stage,body,opts={})=>{ const text=transcript(stage,body,opts); const path=join(workRunDir,'attempts',attemptFilename(stage,++seq,text)); writeFileSync(path,text); return {text,path}; };
  for(const stage of complete){
    const {text}=attempt(stage,bodies[stage]);
    const promptHash=sha256(effectivePromptFor(stage,{id,catalog,legacy,imageFile,b1body:bodies.B1,b2body:bodies.B2}));
    captureStageCompletion({runDir:workRunDir,stage,rawResponse:JSON.stringify(bodies[stage]),trusted:{workId:id,imgSha256,promptHash,brokerPolicyVersion:BROKER_POLICY_VERSION,imageTransportVersion:IMAGE_TRANSPORT_VERSION,transcriptSha256:sha256(text)},producer:producerEvidence(stage,{runtimeVersion:'unknown'}),createdAt:'2026-09-22T10:00:00Z',context:context(stage)});
  }
  const ledger={version:'passBCorpusLedger/2',runId:currentRun,heldIds:[],heldReasons:{},attemptSeq:0,totals:{}};
  const inspect=()=>inspectWork({runDir,id,catalog,legacy,priorDir});
  const corpus=()=>inspectCorpus({runDir,pool:[p],legacyOf:()=>legacy,ledger,priorDir});
  return {root,runDir,priorDir,workRunDir,p,id,catalog,legacy,imgSha256,ext,imageFile,bodies,transcript,attempt,ledger,inspect,corpus};
}
function withFixture(name,fn,options){t(name,()=>{const f=fixture(options);try{fn(f);}finally{rmSync(f.root,{recursive:true,force:true});}});}
withFixture('read-only resume verifies all completions, raw bodies, transcripts and image without writes',f=>{
  const before=tree(f.root),r=f.inspect();assert.equal(r.done,true);assert.equal(r.attempts,3);assert.deepEqual(tree(f.root),before);
});
withFixture('raw migration repairs an existing completion directory and is idempotent',f=>{
  cpSync(f.runDir,f.priorDir,{recursive:true});rmSync(join(f.workRunDir,'raw'),{recursive:true});
  const before=tree(f.root),r=f.corpus();assert.equal(r.repairs.length,3);assert.deepEqual(tree(f.root),before);
  applyHistoryRepair({runDir:f.runDir,inspection:r,ledger:f.ledger,eligibleCount:1});
  assert.equal(f.inspect().repairs.length,0);assert.equal(f.inspect().done,true);
  const repaired=tree(f.root);applyHistoryRepair({runDir:f.runDir,inspection:f.corpus(),ledger:readLedger(f.runDir),eligibleCount:1});assert.deepEqual(tree(f.root),repaired);
});
withFixture('migration refuses altered prior completion and preserves every file',f=>{
  cpSync(f.runDir,f.priorDir,{recursive:true});rmSync(join(f.workRunDir,'raw'),{recursive:true});
  const oldC=join(f.priorDir,'works',sha256(f.id).slice(0,24),'completions');const name=readdirSync(oldC)[0];writeFileSync(join(oldC,name),readFileSync(join(oldC,name),'utf8')+' ');
  const before=tree(f.root);assert.throws(()=>f.inspect(),/identical migration source/);assert.deepEqual(tree(f.root),before);
});
for(const part of ['raw','transcript','image']) withFixture(`resume detects ${part} tampering before scheduling`,f=>{
  const path=part==='raw'?join(f.workRunDir,'raw',readdirSync(join(f.workRunDir,'raw'))[0]):part==='transcript'?join(f.workRunDir,'attempts',readdirSync(join(f.workRunDir,'attempts'))[0]):join(f.runDir,'imgs',f.imageFile);
  writeFileSync(path,'tampered');assert.throws(()=>f.inspect());
});
withFixture('unheld genuine B1 validation failure is reconstructed as terminal',f=>{
  const bad=structuredClone(f.bodies.B1);bad.visual.palette=[];f.attempt('B1',bad);
  const r=f.corpus();assert.equal(r.heldSet.has(f.id),true);assert.match(r.heldReasons[f.id],/invalid body/);
  assert.deepEqual(computeQueue([f.id],{eligibleSet:new Set([f.id]),doneSet:r.doneSet,heldSet:r.heldSet}),[]);
},{complete:[]});
withFixture('exhausted B2 validation failures override a stale lease/absent hold reason',f=>{
  const bad=structuredClone(f.bodies.B2);bad.guideAnswers=[];f.attempt('B2',bad);f.attempt('B2',bad);
  f.ledger.heldIds=[f.id];f.ledger.heldReasons[f.id]='stage B2 leased by another collector';
  const r=f.corpus();assert.equal(r.heldSet.has(f.id),true);assert.match(r.heldReasons[f.id],/guideAnswers/);
},{complete:['B1']});
withFixture('usage limit with dominant Haiku accounting stays resumable under the historical contract',f=>{
  f.attempt('B2',null,{error:true,result:'usage limit',haikuDominates:true});
  const r=f.corpus();assert.equal(r.fatal,null);assert.equal(r.heldSet.size,0);assert.equal(r.doneSet.size,0);
},{complete:['B1']});
withFixture('fatal on any preserved work is visible despite an empty ledger',f=>{
  f.attempt('B2',null,{apiKeySource:'api-key'});assert.match(f.corpus().fatal,/preserved provenance failure/);
},{complete:['B1']});
withFixture('fatal survives ledger replacement and is never cleared by offline repair',f=>{
  persistFatal(f.runDir,'provenance failure');writeFileSync(join(f.runDir,'ledger.json'),JSON.stringify(f.ledger));
  assert.equal(preservedFatal(f.runDir),'provenance failure');const r=f.corpus();
  applyHistoryRepair({runDir:f.runDir,inspection:r,ledger:f.ledger,eligibleCount:1});assert.match(readLedger(f.runDir).stopReason,/fatal:/);
});
withFixture('malformed ledger never turns into empty resumable state',f=>{
  writeFileSync(join(f.runDir,'ledger.json'),'{');assert.throws(()=>readLedger(f.runDir));
});
withFixture('patch auto-accept never bypasses a preserved fatal',f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');persistFatal(f.runDir,'test fatal');
  assert.throws(()=>bindExecutionPolicy(f.runDir,'2.1.281'),/drift/);
  assert.equal(isPatchUpgrade('2.1.280','2.1.281'),true);assert.equal(isPatchUpgrade('2.1.281','2.1.280'),false);assert.equal(isPatchUpgrade('2.1.9','2.2.0'),false);
});
withFixture('runtime version is bound separately while banked completion bytes stay unchanged',f=>{
  const before=tree(join(f.workRunDir,'completions'));
  bindExecutionPolicy(f.runDir,'2.1.280');bindExecutionPolicy(f.runDir,'2.1.280');
  // VSD-046: a patch-level update is accepted automatically and recorded as its own epoch.
  const auto=bindExecutionPolicy(f.runDir,'2.1.281');
  assert.equal(auto.number,2);assert.equal(auto.review.automatic,true);assert.equal(auto.review.toRuntimeVersion,'2.1.281');
  assert.equal(executionEpochs(f.runDir).length,2);assert.equal(bindExecutionPolicy(f.runDir,'2.1.281').number,2);
  // anything beyond a patch upgrade still pauses for a reviewed rebind
  assert.throws(()=>bindExecutionPolicy(f.runDir,'2.2.0'),/drift/);
  assert.throws(()=>bindExecutionPolicy(f.runDir,'3.0.0'),/drift/);
  assert.throws(()=>bindExecutionPolicy(f.runDir,'2.1.280'),/drift/); // downgrade
  assert.equal(executionEpochs(f.runDir).length,2);
  assert.equal(f.inspect().done,true);assert.deepEqual(tree(join(f.workRunDir,'completions')),before);
});

const ta=async(name,fn)=>{await fn();n++;console.log('ok',name);};
const attemptArgs=f=>({runDir:f.runDir,workRunDir:f.workRunDir,id:f.id,imgSha256:f.imgSha256,ext:f.ext,stage:'B2',seq:20,runtimeVersion:'2.1.280',command:{bin:'fixture-only',argv:['-p','fixture'],env:{removeKeys:['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN']}},now:()=>at('2026-09-22T10:00:00Z')});
await ta('a swallowed fatal is durable and the next invocation spends zero calls',async()=>{
  const f=fixture({complete:['B1']});let calls=0;
  try{
    const spawnStage=async(stage)=>executeCorpusAttempt({...attemptArgs(f),stage,execute:async()=>{calls++;return {stdout:f.transcript(stage,null,{apiKeySource:'user'})};}});
    const result=await runWorkStages({workId:f.id,catalog:f.catalog,legacy:f.legacy,imgSha256:f.imgSha256,ext:f.ext,prompts:PROMPTS,runtimeVersion:'2.1.280',spawnStage,capture:async()=>{throw new Error('must not capture');},loadCompletion:stage=>stage==='B1'?f.bodies.B1:null,skipB4:true});
    assert.match(result.status.B2,/failed:/);assert.equal(calls,1);assert.ok(preservedFatal(f.runDir));
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),seq:21,execute:async()=>{calls++;throw new Error('must not call');}}),/preserved fatal/);
    assert.equal(calls,1);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('each invocation rechecks the cutoff after setup, before reservation/spend',async()=>{
  const f=fixture({complete:['B1']});let checks=0,calls=0;
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),now:()=>at(checks++===0?'2026-09-22T15:29:59Z':'2026-09-22T15:30:00Z'),execute:async()=>{calls++;}}),/protected-hours/);
    assert.equal(calls,0);assert.equal(readdirSync(join(f.workRunDir,'attempts')).filter(n=>n.endsWith('.reserved.json')).length,0);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('pre-call reservation exists inside the executor; timeout is bounded and never retried',async()=>{
  const f=fixture({complete:['B1']});let calls=0;
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),now:()=>at('2026-09-22T15:29:59Z'),execute:async(bin,argv,opts)=>{
      calls++;assert.equal(opts.env.DISABLE_AUTOUPDATER,'1');assert.equal(opts.env.ANTHROPIC_API_KEY,undefined);assert.equal(opts.env.ANTHROPIC_AUTH_TOKEN,undefined);assert.ok(existsSync(join(f.workRunDir,'attempts','b2-000020.reserved.json')));assert.equal(opts.timeout,1800000);assert.equal(opts.killSignal,'SIGKILL');
      throw Object.assign(new Error('timeout'),{killed:true,signal:'SIGKILL',stdout:f.transcript('B2',null)});
    }}),/process-timeout/);
    assert.equal(calls,1);assert.ok(f.inspect().terminalReasons.length);assert.equal(f.inspect().fatal,null);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('CLI drift in any init pauses without a permanent fatal before capture',async()=>{
  const f=fixture({complete:['B1']});
  try{await assert.rejects(executeCorpusAttempt({...attemptArgs(f),execute:async()=>({stdout:f.transcript('B2',f.bodies.B2,{version:'2.1.281'})})}),/runtime version drift/);assert.equal(preservedFatal(f.runDir),null);assert.match(f.inspect().pause,/runtime drift/);assert.equal(f.inspect().terminalReasons.length,0);}
  finally{rmSync(f.root,{recursive:true,force:true});}
});
withFixture('unfinished reservation fails closed across restart',f=>{
  const epoch=bindExecutionPolicy(f.runDir,'2.1.280');
  writeFileSync(join(f.workRunDir,'attempts','b2-000020.reserved.json'),JSON.stringify({runId:currentRun,workId:f.id,stage:'B2',seq:20,executionEpoch:epoch.number,executionEpochSha256:epoch.sha256,executionPolicySha256:sha256(stableJson(epoch.policy))}));
  assert.match(f.inspect().pause,/unknown-outcome/);assert.equal(f.inspect().fatal,null);assert.equal(f.inspect().attempts,2);
},{complete:['B1']});

await ta('transport retry cannot start after 08:30', async()=>{
  const f=fixture({complete:['B1']});let calls=0;
  try{
    await assert.rejects(retryTransportOnce(()=>executeCorpusAttempt({...attemptArgs(f),seq:20+calls,
      now:()=>at(calls?'2026-09-22T15:30:00Z':'2026-09-22T15:29:58Z'),execute:async()=>{
        calls++;throw Object.assign(new Error('transport'),{code:1,stdout:f.transcript('B2',null,{error:true,result:'temporary process failure'})});
      }})),/protected-hours/);assert.equal(calls,1);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('B2 validation retry also checks the call-start window', async()=>{
  const f=fixture({complete:['B1']});let calls=0;
  try{
    const bad=structuredClone(f.bodies.B2);bad.guideAnswers=[];
    const result=await runWorkStages({workId:f.id,catalog:f.catalog,legacy:f.legacy,imgSha256:f.imgSha256,ext:f.ext,prompts:PROMPTS,runtimeVersion:'2.1.280',skipB4:true,
      loadCompletion:stage=>stage==='B1'?f.bodies.B1:null,
      spawnStage:()=>executeCorpusAttempt({...attemptArgs(f),seq:20+calls,now:()=>at(calls?'2026-09-22T15:30:00Z':'2026-09-22T15:29:58Z'),execute:async()=>{calls++;return{stdout:f.transcript('B2',bad)};}}),
      capture:async()=>{throw new Error('invalid B2 body: guideAnswers');}});
    assert.match(result.status.B2,/protected-hours/);assert.equal(calls,1);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});


const reviewFor = (f, version='2.1.281') => ({version:'passBCorpusRuntimeReview/1',runId:currentRun,
  fromEpochSha256:executionEpochs(f.runDir).at(-1).sha256,toRuntimeVersion:version,
  toPolicySha256:sha256(stableJson(executionPolicy(version))),reviewedBy:'offline test fixture',
  reviewedAt:'2026-09-22T10:00:00Z',reason:'Fixture-only runtime review; no real authorization'});

await ta('startup non-patch CLI drift makes zero calls and leaves the current epoch unchanged',async()=>{
  const f=fixture({complete:['B1']});let calls=0;
  try{
    bindExecutionPolicy(f.runDir,'2.1.280');const before=tree(f.root);
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),runtimeVersion:'2.2.0',execute:async()=>{calls++;}}),/paused pending reviewed/);
    assert.equal(calls,0);assert.equal(preservedFatal(f.runDir),null);assert.deepEqual(tree(f.root),before);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('reviewed runtime rotation preserves every attempt and verifies each against its own epoch',async()=>{
  const f=fixture({complete:['B1']});
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),execute:async()=>({stdout:f.transcript('B2',null,{error:true,result:'usage limit'})})}),/usage limit/);
    const attemptsBefore=tree(join(f.workRunDir,'attempts')),oldEpoch=readFileSync(join(f.runDir,'execution-policies','000001.json'),'utf8');
    const epoch=rebindRuntime(f.runDir,reviewFor(f));assert.equal(epoch.number,2);
    bindExecutionPolicy(f.runDir,'2.1.281');
    assert.deepEqual(tree(join(f.workRunDir,'attempts')),attemptsBefore);
    assert.equal(readFileSync(join(f.runDir,'execution-policies','000001.json'),'utf8'),oldEpoch);
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),seq:21,runtimeVersion:'2.1.281',execute:async()=>({stdout:f.transcript('B2',null,{error:true,result:'usage limit',version:'2.1.281'})})}),/usage limit/);
    assert.equal(f.inspect().attempts,3);assert.equal(f.inspect().fatal,null);assert.equal(f.inspect().pause,null);
    rebindRuntime(f.runDir,reviewFor(f,'2.1.280'));assert.equal(executionEpochs(f.runDir).length,3);
    assert.equal(f.inspect().pause,null,'prior .281 attempt remains valid after active runtime returns to .280');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('mid-call CLI drift requires a bound review; no drifted body becomes a completion',async()=>{
  const f=fixture({complete:['B1']});
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),execute:async()=>({stdout:f.transcript('B2',f.bodies.B2,{version:'2.1.281'})})}),/runtime version drift/);
    assert.match(f.corpus().pause,/runtime drift/);assert.equal(f.corpus().fatal,null);
    const before=tree(join(f.workRunDir,'attempts'));rebindRuntime(f.runDir,reviewFor(f));
    const after=f.corpus();assert.equal(after.pause,null);assert.equal(after.heldSet.size,0);
    assert.equal(after.rows[0].bodies.B2,undefined);assert.equal(after.attempts,2);
    assert.deepEqual(tree(join(f.workRunDir,'attempts')),before);
    const fresh=await executeCorpusAttempt({...attemptArgs(f),seq:21,runtimeVersion:'2.1.281',execute:async()=>({stdout:f.transcript('B2',f.bodies.B2,{version:'2.1.281',result:'fresh after reviewed rebind'})})});
    captureStageCompletion({runDir:f.workRunDir,stage:'B2',rawResponse:fresh.raw,
      trusted:{workId:f.id,imgSha256:f.imgSha256,promptHash:sha256(effectivePromptFor('B2',{id:f.id,catalog:f.catalog,legacy:f.legacy,imageFile:f.imageFile,b1body:f.bodies.B1})),brokerPolicyVersion:BROKER_POLICY_VERSION,imageTransportVersion:IMAGE_TRANSPORT_VERSION,transcriptSha256:fresh.transcriptSha256},
      producer:producerEvidence('B2',{runtimeVersion:'2.1.281'}),createdAt:'2026-09-22T11:00:00Z',context:syntheticFixture().contexts.B2});
    assert.ok(f.inspect().bodies.B2,'a later clean completion survives resume with the earlier drifted attempt preserved');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
for(const field of ['runId','fromEpochSha256','toPolicySha256','reviewedBy','reviewedAt','reason']) withFixture(`runtime review rejects missing or stale ${field} without writes`,f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');const review=reviewFor(f);review[field]='';const before=tree(f.root);
  assert.throws(()=>rebindRuntime(f.runDir,review),/review/);assert.deepEqual(tree(f.root),before);
});
withFixture('one review cannot be replayed to append a second epoch',f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');const review=reviewFor(f);rebindRuntime(f.runDir,review);
  const before=tree(f.root);assert.throws(()=>rebindRuntime(f.runDir,review),/review binding/);assert.deepEqual(tree(f.root),before);
});
withFixture('runtime rebind cannot clear fatal.json',f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');persistFatal(f.runDir,'provenance failure');
  const before=tree(f.root);assert.throws(()=>rebindRuntime(f.runDir,reviewFor(f)),/cannot clear/);assert.deepEqual(tree(f.root),before);
});
withFixture('legacy /3 policy is retained as epoch zero during an explicit reviewed upgrade',f=>{
  const old={...executionPolicy('2.1.280'),version:'passBCorpusCollector/3'};delete old.childEnv;
  const path=join(f.runDir,'execution-policy.json');writeFileSync(path,JSON.stringify(old));const bytes=readFileSync(path,'utf8');
  assert.throws(()=>bindExecutionPolicy(f.runDir,'2.1.280'),/drift/);
  rebindRuntime(f.runDir,reviewFor(f));assert.equal(readFileSync(path,'utf8'),bytes);
  assert.deepEqual(executionEpochs(f.runDir).map(e=>e.number),[0,1]);assert.ok(f.inspect().done);
});
await ta('tampering with or deleting an earlier epoch rejects resume after rotation',async()=>{
  const f=fixture({complete:['B1']});
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),execute:async()=>({stdout:f.transcript('B2',null,{error:true,result:'usage limit'})})}),/usage limit/);
    rebindRuntime(f.runDir,reviewFor(f));const path=join(f.runDir,'execution-policies','000001.json'),original=readFileSync(path,'utf8');
    const changed=JSON.parse(original);changed.policy.runtimeVersion='2.1.999';writeFileSync(path,JSON.stringify(changed));
    assert.throws(()=>f.inspect(),/chain mismatch/);writeFileSync(path,original);rmSync(path);
    assert.throws(()=>f.inspect(),/sequence mismatch/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('an OS spawn failure stops without manufacturing permanent provenance failure',async()=>{
  const f=fixture({complete:['B1']});
  try{
    let calls=0;
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),execute:async()=>{calls++;throw Object.assign(new Error('spawn ENOENT'),{code:'ENOENT'});}}),/process failed before provenance/);
    assert.equal(calls,1);assert.equal(preservedFatal(f.runDir),null);assert.equal(f.corpus().fatal,null);
    assert.match(f.corpus().pause,/operational-pause/);assert.equal(f.corpus().attempts,2);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
withFixture('unexpected lane errors pause and never invoke the permanent fatal writer',f=>{
  let reason=null;stopForException(Object.assign(new Error('disk full'),{code:'ENOSPC'}),{
    fatal:r=>persistFatal(f.runDir,r),pause:r=>{reason=r;}});
  assert.match(reason,/operational:disk full/);assert.equal(preservedFatal(f.runDir),null);
});
await ta('bad subscription provenance wins over simultaneous CLI drift',async()=>{
  const f=fixture({complete:['B1']});
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),execute:async()=>({stdout:f.transcript('B2',f.bodies.B2,{apiKeySource:'api-key',version:'2.1.281'})})}),/apiKeySource/);
    assert.match(preservedFatal(f.runDir),/apiKeySource/);assert.ok(f.corpus().fatal);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('confinement failure wins over usage rejection and CLI drift',async()=>{
  const f=fixture({complete:[]});
  try{
    const text=f.transcript('B1',null,{error:true,result:'usage limit',version:'2.1.281'}).replace(`./${f.imageFile}`,'/etc/passwd');
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),stage:'B1',imageFile:f.imageFile,execute:async()=>({stdout:text})}),/confinement/);
    assert.match(preservedFatal(f.runDir),/confinement/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
withFixture('history repair refreshes updatedAt only when ledger contents change',f=>{
  const now=()=>at('2026-09-22T12:34:56Z');
  const repaired=applyHistoryRepair({runDir:f.runDir,inspection:f.corpus(),ledger:{...f.ledger,updatedAt:'2000-01-01T00:00:00Z'},eligibleCount:1,now});
  assert.equal(repaired.updatedAt,now().toISOString());const before=tree(f.root);
  applyHistoryRepair({runDir:f.runDir,inspection:f.corpus(),ledger:readLedger(f.runDir),eligibleCount:1,now:()=>at('2026-09-22T13:00:00Z')});
  assert.deepEqual(tree(f.root),before);
});


withFixture('a rejected B2 body plus usage rejection preserves exactly one conformance retry',f=>{
  const bad=structuredClone(f.bodies.B2);bad.guideAnswers=[];
  f.attempt('B2',bad);f.attempt('B2',null,{error:true,result:'usage limit'});
  f.ledger.heldIds=[f.id];f.ledger.heldReasons[f.id]='evidence:B2:invalid body: guideAnswers';
  const r=f.corpus();assert.equal(r.heldSet.size,0);assert.equal(r.rows[0].pendingB2Retry,true);
  assert.equal(r.rows[0].b2ValidationFailures,1);enforceValidationBudget(r.rows[0]);
  f.attempt('B2',bad);const exhausted=f.corpus();
  assert.equal(exhausted.heldSet.has(f.id),true);assert.throws(()=>enforceValidationBudget(exhausted.rows[0]),/already consumed/);
},{complete:['B1']});
await ta('resuming a pending B2 retry cannot spend a third validation attempt',async()=>{
  const f=fixture({complete:['B1']});let calls=0;
  try{
    const bad=structuredClone(f.bodies.B2);bad.guideAnswers=[];
    f.attempt('B2',bad);f.attempt('B2',null,{error:true,result:'usage limit'});
    const result=await runWorkStages({workId:f.id,catalog:f.catalog,legacy:f.legacy,imgSha256:f.imgSha256,ext:f.ext,prompts:PROMPTS,runtimeVersion:'2.1.280',skipB4:true,
      loadCompletion:stage=>stage==='B1'?f.bodies.B1:null,
      spawnStage:()=>{enforceValidationBudget(f.inspect());return executeCorpusAttempt({...attemptArgs(f),seq:20+calls,
        execute:async()=>{calls++;return{stdout:f.transcript('B2',bad)};}});},
      capture:async()=>{throw new Error('invalid B2 body: guideAnswers');}});
    assert.equal(calls,1);assert.match(result.status.B2,/already consumed/);assert.equal(f.inspect().b2ValidationFailures,2);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
for(const empty of [false,true]) await ta(`09:00 termination is a nonterminal scheduling pause (empty stdout=${empty})`,async()=>{
  const f=fixture({complete:['B1']});let killed=false;
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),now:()=>at(killed?'2026-09-22T16:00:00Z':'2026-09-22T15:29:59Z'),execute:async()=>{
      killed=true;throw Object.assign(new Error('deadline kill'),{killed:true,signal:'SIGKILL',stdout:empty?'':f.transcript('B2',null)});
    }}),/09:00 deadline/);
    assert.equal(preservedFatal(f.runDir),null);const r=f.corpus();
    assert.equal(r.fatal,null);assert.equal(r.pause,null);assert.equal(r.heldSet.size,0);assert.equal(r.attempts,2);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
await ta('deadline termination cannot mask a proven provenance failure',async()=>{
  const f=fixture({complete:['B1']});let killed=false;
  try{
    await assert.rejects(executeCorpusAttempt({...attemptArgs(f),now:()=>at(killed?'2026-09-22T16:00:00Z':'2026-09-22T15:29:59Z'),execute:async()=>{
      killed=true;throw Object.assign(new Error('deadline'),{killed:true,signal:'SIGKILL',stdout:f.transcript('B2',null,{apiKeySource:'api-key'})});
    }}),/apiKeySource/);
    assert.ok(preservedFatal(f.runDir));assert.ok(f.corpus().fatal);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
console.log(`\n${n} corpus-collector regressions passed`);
