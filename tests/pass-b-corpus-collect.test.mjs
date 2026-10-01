// Offline regressions for the repaired corpus B0-B3 collector (no model calls, no network).
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, readdirSync, existsSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyMisreadIncident, applyFatalClearance, loadFatalClearances, FATAL_CLEARANCE_VERSION, CLEARANCE_DISPOSITION, b0FailureClass, B0_TRANSIENT_HOLD_AFTER, B0_CIRCUIT_BREAKER, isPatchUpgrade, runIdFor, computeQueue, classifySpawn, attemptFilename, derivativeMatches, buildPriorityQueue, isUsageInterrupted, isLeaseInterrupted, heldToRequeue, acquireStageLease, pacificClock, callWindow, inspectWork, inspectCorpus, applyHistoryRepair, readLedger, persistFatal, preservedFatal, executeCorpusAttempt, effectivePromptFor, bindExecutionPolicy, executionEpochs, executionPolicy, rebindRuntime, stopForException, enforceValidationBudget, retryTransportOnce, COLLECTOR_VERSION, COLLECTION_MODEL, HISTORICAL_MODEL, rebindModel, epochModel, rebindContract, grantFormatRetries, loadFormatRetries, WIRE_POLICY } from '../scripts/pass-b-corpus-collect.mjs';
import { syntheticFixture, verifyB1ImageRead, parseStreamTranscript, producerEvidence, trustedCatalog, runWorkStages, CALIBRATION_MODEL, IMAGE_TRANSPORT_VERSION } from '../scripts/lib/pass-b-calibration.mjs';
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
  const transcript=(stage,body,{apiKeySource='none',error=false,result='',version='2.1.280',haikuDominates=false,model=COLLECTION_MODEL}={}) => {
    const blocks=stage==='B2' ? [{type:'tool_use',id:'s',name:'WebSearch',input:{query:'test'}},{type:'tool_use',id:'f',name:'WebFetch',input:{url:'https://example.test'}}] : [{type:'tool_use',id:'r',name:'Read',input:{file_path:`./${imageFile}`}}];
    const results=stage==='B2' ? ['s','f'].map(id=>({type:'tool_result',tool_use_id:id,content:[{type:'text',text:'Museum record text with object details. '.repeat(10)}]})) : [{type:'tool_result',tool_use_id:'r',content:[{type:'image'}]}];
    return [{type:'system',subtype:'init',apiKeySource,claude_code_version:version,model},{type:'assistant',message:{content:blocks}},{type:'user',message:{content:results}},{type:'result',subtype:'success',is_error:error,result,structured_output:body,modelUsage:{[model]:{output_tokens:10},...(haikuDominates?{'claude-haiku-4-5-20251001':{output_tokens:100}}:{})}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
  };
  const context=stage=>stage==='B2'?syntheticFixture().contexts.B2:stage==='B3'?syntheticFixture().contexts.B3:{};
  let seq=0;
  // unreserved attempts = pre-epoch history (historical 4.6 rule)
  const attempt=(stage,body,opts={})=>{ const text=transcript(stage,body,{model:HISTORICAL_MODEL,...opts}); const path=join(workRunDir,'attempts',attemptFilename(stage,++seq,text)); writeFileSync(path,text); return {text,path}; };
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

// ---- VSD-049: incident-specific fatal clearance (strict verifier unchanged) ----
{
  const W='data/incoming/vision-calibration/corpus-b3-6401bc543ead/works/80af7ef472e10b8b2dd4f6ae';
  const realPath=join(W,'attempts','b3-002996-9e10b97c.transcript.jsonl');
  if(existsSync(realPath)){
    const real=readFileSync(realPath,'utf8'); const b0=JSON.parse(readFileSync(join(W,'b0-prep.json'),'utf8')); const img=`${b0.image.imgSha256}.${b0.image.ext}`;
    t('real Q17327791 B3 transcript: strict verifier still fatal; exact-incident check matches',()=>{
      assert.equal(sha256(real),'9e10b97c80841967ed1ba88523e18048053e5d9a0fa04aa2d6690f1e7df1f86b');
      assert.equal(verifyB1ImageRead(parseStreamTranscript(real),{callDir:null,imageBasename:img}).bad.length,1);
      const r=verifyMisreadIncident(real,img); assert.equal(r.ok,true,r.reason);
    });
    const C='/private/tmp/corpus-7ZgDbK', diag=`File does not exist. Note: your current working directory is ${C}.`;
    const lines=real.split('\n').filter(Boolean);
    const edit=fn=>lines.map(l=>{const e=JSON.parse(l);fn(e);return JSON.stringify(e);}).join('\n')+'\n';
    const eachBlock=(e,fn)=>{for(const b of (Array.isArray(e.message?.content)?e.message.content:[]))fn(b);};
    for(const [name,mut] of [
      ['diagnostic with a filename suggestion',e=>eachBlock(e,b=>{if(b.type==='tool_result'&&b.content===diag)b.content=diag+' Did you mean secrets.txt?';})],
      ['misread outside the call dir',e=>eachBlock(e,b=>{if(b.type==='tool_use'&&b.name==='Read'&&!b.input.file_path.endsWith(img))b.input.file_path='/private/tmp/other/'+b.input.file_path.split('/').pop();})],
      ['traversal in the misread',e=>eachBlock(e,b=>{if(b.type==='tool_use'&&b.name==='Read'&&!b.input.file_path.endsWith(img))b.input.file_path=C+'/../x.jpg';})],
      ['misread result returned content',e=>eachBlock(e,b=>{if(b.type==='tool_result'&&b.content===diag){b.is_error=false;b.content=[{type:'text',text:'secret'}];}})],
      ['wrong cwd in init',e=>{if(e.type==='system'&&e.subtype==='init')e.cwd='/private/tmp/elsewhere';}],
      ['API key provenance',e=>{if(e.type==='system'&&e.subtype==='init')e.apiKeySource='user';}],
      ['image read returned extra text',e=>eachBlock(e,b=>{if(b.type==='tool_result'&&Array.isArray(b.content)&&b.content.some(x=>x.type==='image'))b.content.push({type:'text',text:'x'});})],
    ]) t(`exact-incident check refuses: ${name}`,()=>assert.equal(verifyMisreadIncident(edit(mut),img).ok,false));
    t('exact-incident check refuses a missing or duplicated misread result',()=>{
      const withoutResult=lines.filter(l=>!l.includes(JSON.stringify(diag).slice(1,-1))).join('\n')+'\n';
      assert.equal(verifyMisreadIncident(withoutResult,img).ok,false);
      const dupIdx=lines.findIndex(l=>l.includes('File does not exist'));
      const dup=[...lines.slice(0,dupIdx+1),lines[dupIdx],...lines.slice(dupIdx+1)].join('\n')+'\n';
      assert.equal(verifyMisreadIncident(dup,img).ok,false);
    });
  }
}
withFixture('B0 fetch failures: unreachable hosts are transient, unusable images are terminal',f=>{
  for (const x of [{code:'timeout'},{code:'network-error'},{code:'dns-failed'},{code:'http-status',status:403},{code:'http-status',status:429},{code:'http-status',status:503},{code:'http-status',status:null}])
    assert.equal(b0FailureClass(x),'transient',JSON.stringify(x));
  for (const x of [{code:'scheme-not-https'},{code:'bad-url'},{code:'mime-not-allowed'},{code:'decode-failed'},{code:'too-large'},{code:'blocked-ip'},{code:'http-status',status:404},{code:'http-status',status:410}])
    assert.equal(b0FailureClass(x),'terminal',JSON.stringify(x));
  assert.equal(B0_TRANSIENT_HOLD_AFTER,5);assert.equal(B0_CIRCUIT_BREAKER,5);
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
const attemptArgs=f=>({runDir:f.runDir,workRunDir:f.workRunDir,id:f.id,imgSha256:f.imgSha256,ext:f.ext,stage:'B2',seq:20,runtimeVersion:'2.1.280',command:{bin:'fixture-only',argv:['-p','fixture','--model',COLLECTION_MODEL],env:{removeKeys:['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN']}},now:()=>at('2026-09-22T10:00:00Z')});
const misreadTranscript=(C,image,body,{outside=false}={})=>{
  const bad=outside?'/private/tmp/outside/x.jpg':`${C}/${'0'.repeat(64)}.png`;
  return [{type:'system',subtype:'init',apiKeySource:'none',model:COLLECTION_MODEL,tools:['Read','StructuredOutput'],cwd:C,claude_code_version:'2.1.280'},
    {type:'assistant',message:{content:[{type:'tool_use',id:'r1',name:'Read',input:{file_path:bad}}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'r1',is_error:true,content:`File does not exist. Note: your current working directory is ${C}.`}]}},
    {type:'assistant',message:{content:[{type:'tool_use',id:'r2',name:'Read',input:{file_path:`${C}/${image}`}}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'r2',content:[{type:'image',source:{type:'base64',data:'x'}}]}]}},
    {type:'assistant',message:{content:[{type:'tool_use',id:'so',name:'StructuredOutput',input:body}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'so',content:'Structured output provided successfully'}]}},
    {type:'result',subtype:'success',is_error:false,structured_output:body,modelUsage:{[COLLECTION_MODEL]:{output_tokens:10}}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
};
await ta('clearance: one exact finding clears to a terminal hold; replay, wrong hash and a second fatal all still block',async()=>{
  const f=fixture({complete:['B1','B2']});
  try{
    const b3=(seq,opts)=>executeCorpusAttempt({...attemptArgs(f),stage:'B3',seq,imageFile:f.imageFile,execute:async(bin,argv,o)=>({stdout:misreadTranscript(o.cwd,f.imageFile,f.bodies.B3,opts)})});
    await assert.rejects(b3(30),/confinement violation/);
    assert.ok(preservedFatal(f.runDir)); assert.ok(f.inspect().fatal);
    const A=join(f.workRunDir,'attempts'), meta=JSON.parse(readFileSync(join(A,'b3-000030.meta.json'),'utf8'));
    const H=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
    const fatalBytes=readFileSync(join(f.runDir,'fatal.json'));
    const req={version:FATAL_CLEARANCE_VERSION,runId:JSON.parse(fatalBytes).runId,disposition:CLEARANCE_DISPOSITION,independentReview:'test review',ownerAuthorization:'test owner',reviewedAt:'2026-09-29T12:00:00Z',
      finding:{workId:f.id,stage:'B3',seq:30,reservationSha256:H(join(A,'b3-000030.reserved.json')),metaSha256:H(join(A,'b3-000030.meta.json')),transcriptSha256:H(join(A,meta.transcriptFile)),transcriptFile:meta.transcriptFile,fatalJsonSha256:H(join(f.runDir,'fatal.json')),fatalReason:JSON.parse(fatalBytes).reason}};
    assert.throws(()=>applyFatalClearance(f.runDir,{...req,finding:{...req.finding,metaSha256:'0'.repeat(64)}}),/hash mismatch/);
    assert.throws(()=>applyFatalClearance(f.runDir,{...req,ownerAuthorization:''}),/owner authorization/);
    applyFatalClearance(f.runDir,req);
    assert.equal(loadFatalClearances(f.runDir).length,1);
    assert.equal(preservedFatal(f.runDir),null); const row=f.inspect();
    assert.equal(row.fatal,null); assert.ok(row.terminalReasons.some(r=>r.includes('fatal-cleared')));
    assert.ok(readFileSync(join(f.runDir,'fatal.json')).equals(fatalBytes),'fatal.json preserved byte-for-byte');
    assert.throws(()=>applyFatalClearance(f.runDir,req),/already cleared/);
    // a second fatal (outside-dir read) with fatal.json unchanged must still block
    await assert.rejects(b3(31,{outside:true}),/confinement violation/);
    assert.ok(readFileSync(join(f.runDir,'fatal.json')).equals(fatalBytes),'first-fatal file unchanged');
    assert.ok(f.inspect().fatal,'the new fatal attempt still blocks');
    // tampering with any bound evidence of the cleared attempt fails closed: reservation changed, reservation missing, meta changed
    const resPath=join(A,'b3-000030.reserved.json'), resBytes=readFileSync(resPath), res=JSON.parse(resBytes);
    writeFileSync(resPath,JSON.stringify({...res,promptHash:'0'.repeat(64)}));
    assert.throws(()=>f.inspect(),/cleared attempt evidence changed/,'changed reservation');
    rmSync(resPath);
    assert.throws(()=>f.inspect(),/cleared attempt evidence changed|reservation/,'missing reservation');
    writeFileSync(resPath,resBytes); assert.equal(f.inspect().terminalReasons.some(r=>r.includes('fatal-cleared')),true,'restored bytes verify again');
    writeFileSync(join(A,'b3-000030.meta.json'),JSON.stringify({...meta,reason:'edited'}));
    assert.throws(()=>f.inspect(),/cleared attempt evidence changed/,'changed meta');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
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
      producer:producerEvidence('B2',{model:COLLECTION_MODEL,runtimeVersion:'2.1.281'}),createdAt:'2026-09-22T11:00:00Z',context:syntheticFixture().contexts.B2});
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

// ---------- VSD-054: model per execution epoch (Codex-reviewed direction, 2026-09-30) ----------
const modelReview=(f,toModel)=>{const prev=executionEpochs(f.runDir).at(-1);return {version:'passBCorpusModelReview/1',runId:currentRun,fromEpochSha256:prev.sha256,toModel,
  toPolicySha256:sha256(stableJson(executionPolicy(prev.policy.runtimeVersion,toModel))),reviewedBy:'offline test fixture',reviewedAt:'2026-09-30T10:00:00Z',reason:'fixture-only model review'};};
const reserveManual=(f,{stage,seq,epoch,text})=>{const A=join(f.workRunDir,'attempts'),stem=`${stage.toLowerCase()}-${String(seq).padStart(6,'0')}`;
  writeFileSync(join(A,`${stem}.reserved.json`),JSON.stringify({runId:currentRun,workId:f.id,stage,seq,executionEpoch:epoch.number,executionEpochSha256:epoch.sha256,executionPolicySha256:sha256(stableJson(epoch.policy))}));
  const file=attemptFilename(stage,seq,text);writeFileSync(join(A,file),text);
  writeFileSync(join(A,`${stem}.meta.json`),JSON.stringify({workId:f.id,stage,seq,exitCode:0,kind:'ok',transcriptFile:file,transcriptSha256:sha256(text)}));return file;};
const captureB2=(f,text,model)=>captureStageCompletion({runDir:f.workRunDir,stage:'B2',rawResponse:JSON.stringify(f.bodies.B2),
  trusted:{workId:f.id,imgSha256:f.imgSha256,promptHash:sha256(effectivePromptFor('B2',{id:f.id,catalog:f.catalog,legacy:f.legacy,imageFile:f.imageFile,b1body:f.bodies.B1})),brokerPolicyVersion:BROKER_POLICY_VERSION,imageTransportVersion:IMAGE_TRANSPORT_VERSION,transcriptSha256:sha256(text)},
  producer:producerEvidence('B2',{model,runtimeVersion:'2.1.280'}),createdAt:'2026-09-30T11:00:00Z',context:syntheticFixture().contexts.B2});
const inFixture=async(name,fn,opts)=>ta(name,async()=>{const f=fixture(opts);try{await fn(f);}finally{rmSync(f.root,{recursive:true,force:true});}});

await inFixture('mixed history: unreserved 4.6 B1, a 4.6-epoch B2 and a later 5.5 epoch all verify against their own model',async f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');                         // epoch 1: collection model (5.5)
  const e2=rebindModel(f.runDir,modelReview(f,'claude-sonnet-4-6')); // epoch 2: 4.6
  const text=f.transcript('B2',f.bodies.B2,{model:'claude-sonnet-4-6'});reserveManual(f,{stage:'B2',seq:30,epoch:e2,text});captureB2(f,text,'claude-sonnet-4-6');
  const e3=rebindModel(f.runDir,modelReview(f,COLLECTION_MODEL));   // epoch 3: back to 5.5; epoch-2 evidence must still verify as 4.6
  assert.equal(epochModel(e3),COLLECTION_MODEL);
  const r=f.inspect();assert.equal(r.fatal,null);assert.ok(r.bodies.B1&&r.bodies.B2);
},{complete:['B1']});
await inFixture('a 5.5 completion under a 5.5 epoch verifies; the same transcript claiming 4.6 is a preserved model-drift fatal',async f=>{
  const e1=bindExecutionPolicy(f.runDir,'2.1.280');assert.equal(epochModel(e1),COLLECTION_MODEL);
  const good=f.transcript('B2',f.bodies.B2,{model:COLLECTION_MODEL});reserveManual(f,{stage:'B2',seq:30,epoch:e1,text:good});captureB2(f,good,COLLECTION_MODEL);
  assert.equal(f.inspect().fatal,null);assert.ok(f.inspect().bodies.B2);
  const bad=f.transcript('B2',null,{model:'claude-sonnet-4-6',result:'x'});reserveManual(f,{stage:'B2',seq:31,epoch:e1,text:bad});
  assert.match(String(f.inspect().fatal),/preserved (provenance failure|model drift)/);
},{complete:['B1']});
await inFixture('a completion whose producer model disagrees with its reservation epoch is rejected',async f=>{
  const e1=bindExecutionPolicy(f.runDir,'2.1.280');
  const text=f.transcript('B2',f.bodies.B2,{model:COLLECTION_MODEL});reserveManual(f,{stage:'B2',seq:30,epoch:e1,text});captureB2(f,text,'claude-sonnet-4-6');
  assert.throws(()=>f.inspect(),/producer does not match|invalid B2 completion/);
},{complete:['B1']});
await inFixture('unreserved (pre-epoch) evidence claiming 5.5 fails the historical rule, so an epoch-less import cannot smuggle a model',async f=>{
  f.attempt('B2',null,{model:COLLECTION_MODEL,result:'x'});
  assert.match(String(f.inspect().fatal),/preserved (provenance failure|model drift)/);
},{complete:['B1']});
await inFixture('model rebind: reviewed binding required, only the model changes, preserved fatal blocks it, runtime rebind keeps the model',async f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');
  for(const [k,v] of [['reviewedBy',''],['toModel','claude-opus-5'],['fromEpochSha256','x'],['runId','other']]){const r=modelReview(f,'claude-sonnet-4-6');r[k]=v;if(k==='toModel')r.toPolicySha256='x';assert.throws(()=>rebindModel(f.runDir,r));}
  assert.throws(()=>rebindModel(f.runDir,modelReview(f,COLLECTION_MODEL)),/no change/);
  const e2=rebindModel(f.runDir,modelReview(f,'claude-sonnet-4-6'));assert.equal(epochModel(e2),'claude-sonnet-4-6');
  const {model:_a,...before}=executionEpochs(f.runDir)[0].policy,{model:_b,...after}=e2.policy;assert.deepEqual(after,before);
  // the active epoch is 4.6 but new collection uses 5.5: sessions pause instead of switching silently
  assert.throws(()=>bindExecutionPolicy(f.runDir,'2.1.280'),/paused pending reviewed --rebind-model/);
  const rr={version:'passBCorpusRuntimeReview/1',runId:currentRun,fromEpochSha256:e2.sha256,toRuntimeVersion:'2.1.281',toPolicySha256:sha256(stableJson(executionPolicy('2.1.281','claude-sonnet-4-6'))),reviewedBy:'fixture',reviewedAt:'2026-09-30T10:00:00Z',reason:'fixture'};
  assert.equal(epochModel(rebindRuntime(f.runDir,rr)),'claude-sonnet-4-6');
  persistFatal(f.runDir,'fixture fatal');assert.throws(()=>rebindModel(f.runDir,modelReview(f,COLLECTION_MODEL)),/preserved fatal/);
},{complete:['B1']});
await inFixture('a model rebind leaves terminal holds and attempts untouched',async f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');
  f.attempt('B2',null,{result:'x',error:true});const before=f.corpus();
  const tr=tree(join(f.workRunDir,'attempts'));rebindModel(f.runDir,modelReview(f,'claude-sonnet-4-6'));
  const after=f.corpus();assert.deepEqual([...after.heldSet],[...before.heldSet]);assert.equal(after.attempts,before.attempts);assert.deepEqual(tree(join(f.workRunDir,'attempts')),tr);
},{complete:['B1']});
await inFixture('a live command whose model differs from the active epoch is refused before any reservation',async f=>{
  bindExecutionPolicy(f.runDir,'2.1.280');const before=tree(join(f.workRunDir,'attempts'));let calls=0;
  await assert.rejects(executeCorpusAttempt({...attemptArgs(f),command:{bin:'fixture-only',argv:['-p','fixture','--model','claude-sonnet-4-6'],env:{removeKeys:['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN']}},execute:async()=>{calls++;}}),/no reservation written/);
  assert.equal(calls,0);assert.deepEqual(tree(join(f.workRunDir,'attempts')),before);
},{complete:['B1']});

// ---------- VSD-057: capped wire schema epoch + one fresh attempt for format-held works ----------
const preWireEpoch=f=>{const {wireSchema:_w,wireSchemaSha256:_h,...policy}=executionPolicy('2.1.280');const dir=join(f.runDir,'execution-policies');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'000001.json'),JSON.stringify({version:'passBCorpusExecutionEpoch/1',runId:currentRun,number:1,previousSha256:null,policy,review:null}));return executionEpochs(f.runDir).at(-1);};
const contractReview=f=>{const prev=executionEpochs(f.runDir).at(-1);return {version:'passBCorpusContractReview/1',runId:currentRun,fromEpochSha256:prev.sha256,
  toPolicySha256:sha256(stableJson(executionPolicy(prev.policy.runtimeVersion,epochModel(prev)))),reviewedBy:'offline test fixture',reviewedAt:'2026-10-01T10:00:00Z',reason:'fixture-only contract review'};};
const retryReview=f=>({version:'passBCorpusFormatRetryReview/1',runId:currentRun,epochSha256:executionEpochs(f.runDir).at(-1).sha256,reviewedBy:'offline test fixture',reviewedAt:'2026-10-01T10:00:00Z',reason:'fixture'});
const overCap=f=>({...f.bodies.B2,catalog:{...f.bodies.B2.catalog,movementSuggestion:'x'.repeat(301)}});
await inFixture('contract rebind: a pre-wire epoch pauses with a --rebind-contract message; the review may change only the wire binding',async f=>{
  preWireEpoch(f);
  assert.throws(()=>bindExecutionPolicy(f.runDir,'2.1.280'),/--rebind-contract/);
  for(const [k,v] of [['reviewedBy',''],['fromEpochSha256','x'],['runId','other'],['toPolicySha256','x']]){const r=contractReview(f);r[k]=v;assert.throws(()=>rebindContract(f.runDir,r));}
  const e2=rebindContract(f.runDir,contractReview(f));
  assert.equal(e2.policy.wireSchema,WIRE_POLICY.wireSchema);assert.equal(epochModel(e2),COLLECTION_MODEL);
  assert.equal(bindExecutionPolicy(f.runDir,'2.1.280').sha256,e2.sha256,'the new epoch is now the bound policy');
  assert.throws(()=>rebindContract(f.runDir,contractReview(f)),/no change/);
  persistFatal(f.runDir,'fixture fatal');assert.throws(()=>rebindContract(f.runDir,contractReview(f)),/preserved fatal/);
},{complete:['B1']});
await inFixture('format retry: two pre-wire invalid B2 bodies are held; one grant releases exactly them, once, without touching evidence',async f=>{
  preWireEpoch(f);f.attempt('B2',overCap(f));f.attempt('B2',overCap(f));
  let r=f.corpus();assert.equal(r.heldSet.size,1);assert.equal(f.inspect().b2ValidationFailures,2);assert.equal(f.inspect().formatEligible.length,2);
  assert.throws(()=>grantFormatRetries(f.runDir,retryReview(f),r.rows),/wire-schema epoch/,'no grant before the capped-schema epoch');
  rebindContract(f.runDir,contractReview(f));
  const tr=tree(join(f.workRunDir,'attempts'));
  assert.equal(grantFormatRetries(f.runDir,retryReview(f),f.corpus().rows).length,1);
  r=f.corpus();const w=f.inspect();
  assert.equal(r.heldSet.size,0,'work re-enters the queue');assert.equal(w.b2ValidationFailures,0);assert.equal(w.formatRetryGranted,true);assert.equal(w.attempts,3,'B1 + both preserved B2 attempts still counted');
  assert.deepEqual(tree(join(f.workRunDir,'attempts')),tr,'preserved transcripts untouched');
  assert.equal(grantFormatRetries(f.runDir,retryReview(f),r.rows).length,0,'one grant per work, ever');
  // A fresh failure under the capped epoch counts normally: B2 keeps exactly its one ordinary retry.
  const e=executionEpochs(f.runDir).at(-1),bad=f.transcript('B2',overCap(f),{model:COLLECTION_MODEL});reserveManual(f,{stage:'B2',seq:40,epoch:e,text:bad});
  assert.equal(f.inspect().b2ValidationFailures,1);assert.equal(f.inspect().formatEligible,null);
},{complete:['B1']});
await inFixture('format retry: tampered released transcript or a forged second record fails closed',async f=>{
  preWireEpoch(f);const file=f.attempt('B2',overCap(f));f.attempt('B2',overCap(f));rebindContract(f.runDir,contractReview(f));
  grantFormatRetries(f.runDir,retryReview(f),f.corpus().rows);
  const rec=readFileSync(join(f.runDir,'format-retries','000001.json'),'utf8');
  writeFileSync(join(f.runDir,'format-retries','000002.json'),rec.replace('"number": 1','"number": 2'));
  assert.throws(()=>loadFormatRetries(f.runDir),/out of chain|second grant/);rmSync(join(f.runDir,'format-retries','000002.json'));
  writeFileSync(file.path,file.text+'\n');
  assert.throws(()=>f.inspect(),/missing or changed transcript/);
},{complete:['B1']});
await inFixture('format retry: a work with any non-format terminal reason is not eligible',async f=>{
  preWireEpoch(f);f.attempt('B2',overCap(f));f.attempt('B2',null,{result:'x',error:true});rebindContract(f.runDir,contractReview(f));
  assert.equal(f.inspect().formatEligible,null);assert.equal(grantFormatRetries(f.runDir,retryReview(f),f.corpus().rows).length,0);
},{complete:['B1']});
await inFixture('format retry: a SUCCESSFUL fresh B2 after the grant verifies (released transcripts stay preserved, never captured)',async f=>{
  preWireEpoch(f);f.attempt('B2',overCap(f));f.attempt('B2',overCap(f));const e=rebindContract(f.runDir,contractReview(f));
  grantFormatRetries(f.runDir,retryReview(f),f.corpus().rows);
  const good=f.transcript('B2',f.bodies.B2,{model:COLLECTION_MODEL});reserveManual(f,{stage:'B2',seq:50,epoch:e,text:good});captureB2(f,good,COLLECTION_MODEL);
  const w=f.inspect();assert.equal(w.fatal,null);assert.ok(w.bodies.B2);assert.equal(f.corpus().heldSet.size,0);
},{complete:['B1']});
await ta('owner hours exception: only today\'s Pacific date opens a daytime start, and it is reported for the reservation',async()=>{
  const day=at('2026-10-01T20:00:00Z');
  assert.throws(()=>callWindow(day,undefined),/protected-hours/);assert.throws(()=>callWindow(day,'2026-09-30'),/protected-hours/);
  const w=callWindow(day,'2026-10-01');assert.equal(w.hoursException,'2026-10-01');assert.equal(w.timeout,30*60*1000);
  assert.equal(callWindow(at('2026-10-01T08:00:00Z'),'2026-10-01').hoursException,undefined,'inside the window no exception is recorded');
});
console.log(`\n${n} corpus-collector regressions passed`);
