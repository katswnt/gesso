// Offline proof of the G-03 approval/provenance chain: a human-approved batch applies ONLY when every binding
// holds (run header + derivative sha + completion-FILE sha + the completion's own parsed header/model + a valid
// nonempty approved subset), and ANY tamper (swapped derivative, edited completion, relabeled model, off-schema
// value, unknown id) is rejected BEFORE any write. Exercises scripts/lib/vision-run.mjs the way both merges use it.
//   node tests/vision-provenance.test.mjs
import { mkdtempSync, rmSync, writeFileSync, readFileSync, openSync, writeSync, closeSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createRunDir, verifyApproval, validateApprovedPatch, completionFile, sha256, promptHashOf, runHeader, metaShaOf, visionPassStatus, safeImgPath, workStateSha, acquireLock, releaseLock } from '../scripts/lib/vision-run.mjs';
import { imageDefect, imageTrusted, ledgerTransition, auditedOracle, legacyEvidenceIds, blockedIds, isTransientFail, SCHEMA_VERSION, LEGACY_PASS } from '../scripts/lib/vision-ledger.mjs';

let pass = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else fails.push(n); };

// --- validateApprovedPatch (subset) unit checks ---
ok('patch {playable} valid', validateApprovedPatch({ id: 'x', playable: false }).ok === true);
ok('patch empty rejected', validateApprovedPatch({ id: 'x' }).ok === false);
ok('patch unknown key rejected', validateApprovedPatch({ id: 'x', bogus: 1 }).ok === false);
ok('patch HTML body rejected', validateApprovedPatch({ id: 'x', notes: [{ head: 'h', body: '<img src=x>' }] }).ok === false);

// --- imageTrusted (POSITIVE, explicit trust — the prerequisite for any terminal/mutation) ---
ok('imageTrusted true only when image.ok+clean-issue+good+ok all present', imageTrusted({ image: { ok: true, issue: 'none' }, imageQuality: 'good', framing: 'ok' }) === true);
ok('imageTrusted false when imageQuality missing (fail-closed)', imageTrusted({ image: { ok: true }, framing: 'ok' }) === false);
ok('imageTrusted false when framing missing', imageTrusted({ image: { ok: true }, imageQuality: 'good' }) === false);
ok('imageTrusted false when image.ok missing', imageTrusted({ imageQuality: 'good', framing: 'ok' }) === false);
// BLOCKER 1: {ok:true, issue:'wrong-art'} is a CONTRADICTION — never trusted, always a defect
ok('imageTrusted false on contradictory {ok:true,issue:wrong-art}', imageTrusted({ image: { ok: true, issue: 'wrong-art' }, imageQuality: 'good', framing: 'ok' }) === false);
ok('imageDefect true on contradictory {ok:true,issue:wrong-art}', imageDefect({ image: { ok: true, issue: 'wrong-art' } }) === true);
ok('imageDefect() agrees on wrong-art', imageDefect({ image: { ok: false } }) === true && imageDefect({ imageQuality: 'poor' }) === true && imageDefect({ framing: 'cropped' }) === true);

// --- visionPassStatus (component-level completion; terminal/complete REQUIRE positive trust + >=5 non-blank notes) ---
const N5 = [1,2,3,4,5].map(i => ({ head: `Head ${i}`, body: `Body text ${i}`, x: 10 * i, y: 10 * i }));
const fullPass = { image: { ok: true, issue: 'none' }, playable: true, imageQuality: 'good', framing: 'ok', mediumLegible: true, notes: N5 };
ok('full comprehensive pass (5 pinned notes) → complete', visionPassStatus(fullPass) === 'complete');
ok('full pass with noPins (5 unpinned notes) → complete', visionPassStatus({ ...fullPass, notes: N5.map(n => ({ head: n.head, body: n.body })), noPins: true }) === 'complete');
ok('playable:false on a TRUSTED image → unplayable (terminal)', visionPassStatus({ image: { ok: true, issue: 'none' }, imageQuality: 'good', framing: 'ok', playable: false }) === 'unplayable');
ok('unplayable holds on a trusted good image', visionPassStatus({ ...fullPass, playable: false }) === 'unplayable');
// BLOCKER 1: a defective full completion reduced to only {playable:false} at review must NOT terminally exclude
ok('playable:false ALONE (image fields dropped) → incomplete, NOT unplayable', visionPassStatus({ playable: false }) === 'incomplete');
ok('playable:false + image.ok:true but no quality/framing → incomplete (trust not affirmed)', visionPassStatus({ image: { ok: true }, playable: false }) === 'incomplete');
ok('contradictory {ok:true,issue:wrong-art} full pass → needs-image (not complete)', visionPassStatus({ ...fullPass, image: { ok: true, issue: 'wrong-art' } }) === 'needs-image');
ok('image.ok:false → needs-image', visionPassStatus({ image: { ok: false }, playable: true }) === 'needs-image');
ok('imageQuality poor → needs-image', visionPassStatus({ ...fullPass, imageQuality: 'poor' }) === 'needs-image');
ok('framing not ok → needs-image', visionPassStatus({ ...fullPass, framing: 'cropped' }) === 'needs-image');
// BLOCKER 2: too few notes, or a blank note, can NEVER complete
ok('4 notes (< MIN_NOTES 5) → incomplete', visionPassStatus({ ...fullPass, notes: N5.slice(0, 4) }) === 'incomplete');
ok('one note → incomplete (thin)', visionPassStatus({ ...fullPass, notes: [N5[0]] }) === 'incomplete');
ok('5 notes but one has a blank body → incomplete', visionPassStatus({ ...fullPass, notes: [...N5.slice(0, 4), { head: 'H', body: '  ', x: 5, y: 5 }] }) === 'incomplete');
ok('5 notes, none pinned, no noPins → incomplete (no pins verdict)', visionPassStatus({ ...fullPass, notes: N5.map(n => ({ head: n.head, body: n.body })) }) === 'incomplete');
ok('noPins:true contradicting a pinned note → incomplete', visionPassStatus({ ...fullPass, noPins: true }) === 'incomplete');
// thin partials can NEVER complete — each drops exactly one required component
ok('thin partial {playable:true} only → incomplete', visionPassStatus({ playable: true }) === 'incomplete');
ok('missing mediumLegible → incomplete', visionPassStatus({ ...fullPass, mediumLegible: undefined }) === 'incomplete');
ok('empty notes + no noPins → incomplete', visionPassStatus({ ...fullPass, notes: [] }) === 'incomplete');
ok('non-object → incomplete', visionPassStatus(null) === 'incomplete');

// --- SCHEMA cross-field rejections (blocker 1 + blocker 2 + noPins secondary) ---
ok('schema rejects blank note body', validateApprovedPatch({ id: 'x', notes: [{ head: 'H', body: '   ' }] }).ok === false);
ok('schema rejects blank note head', validateApprovedPatch({ id: 'x', notes: [{ head: '', body: 'B' }] }).ok === false);
ok('schema rejects contradictory image {ok:true,issue:wrong-art}', validateApprovedPatch({ id: 'x', image: { ok: true, issue: 'wrong-art', reason: 'r', suggestedUrl: null } }).ok === false);
ok('schema rejects contradictory image {ok:false,issue:none}', validateApprovedPatch({ id: 'x', image: { ok: false, issue: 'none', reason: 'r', suggestedUrl: null } }).ok === false);
ok('schema accepts clean {ok:true,issue:none}', validateApprovedPatch({ id: 'x', image: { ok: true, issue: 'none', reason: 'clear', suggestedUrl: null } }).ok === true);
ok('schema rejects noPins:true alongside a pinned note', validateApprovedPatch({ id: 'x', noPins: true, notes: [{ head: 'H', body: 'B', x: 5, y: 5 }] }).ok === false);

// --- BLOCKER 4: safeImgPath confines derivative reads to <runDir>/imgs/ (a tampered manifest can't escape) ---
const HEX = 'a'.repeat(64);
{ const rd = mkdtempSync(join(tmpdir(), 'sip-')); mkdirSync(join(rd, 'imgs'));
  ok('safeImgPath accepts a valid hex sha + alnum ext (real imgs/ dir, file need not exist)', safeImgPath(rd, HEX, 'jpg') === join(rd, 'imgs', `${HEX}.jpg`));
  rmSync(rd, { recursive: true, force: true }); }
ok('safeImgPath rejects traversal in ext', safeImgPath('/run', HEX, '../../x') === null);
ok('safeImgPath rejects traversal in sha', safeImgPath('/run', '../../../etc/passwd', 'jpg') === null);
ok('safeImgPath rejects a slash in sha', safeImgPath('/run', 'a/'.repeat(32), 'jpg') === null);
ok('safeImgPath rejects a non-64 sha', safeImgPath('/run', 'abc', 'jpg') === null);
ok('safeImgPath rejects an over-long / non-alnum ext', safeImgPath('/run', HEX, 'png; rm -rf') === null && safeImgPath('/run', HEX, 'toolongext') === null);
// SYMLINK confinement (lexical resolve() does NOT follow filesystem links): a symlinked imgs/ must be rejected
{ const sbase = mkdtempSync(join(tmpdir(), 'symrun-'));
  const realRun = join(sbase, 'run'); mkdirSync(realRun);
  const external = join(sbase, 'external'); mkdirSync(external); writeFileSync(join(external, `${HEX}.jpg`), 'EXTERNAL');
  symlinkSync(external, join(realRun, 'imgs'));   // imgs/ → external dir
  ok('safeImgPath returns null when imgs/ is a symlink to an external dir', safeImgPath(realRun, HEX, 'jpg') === null);
  const goodRun = join(sbase, 'good'); mkdirSync(goodRun); mkdirSync(join(goodRun, 'imgs'));
  ok('safeImgPath accepts a real imgs/ dir (non-existent file OK)', safeImgPath(goodRun, HEX, 'jpg') === join(goodRun, 'imgs', `${HEX}.jpg`));
  // a symlinked derivative FILE is refused too
  const linkTarget = join(sbase, 'secret.jpg'); writeFileSync(linkTarget, 'SECRET');
  symlinkSync(linkTarget, join(goodRun, 'imgs', `${'b'.repeat(64)}.jpg`));
  ok('safeImgPath returns null when the derivative file is a symlink', safeImgPath(goodRun, 'b'.repeat(64), 'jpg') === null);
  rmSync(sbase, { recursive: true, force: true }); }

// --- workStateSha (base-state guard: a stale run whose live state drifted must be refused by curate-merge) ---
{ const p = { style: 'Cubism', styleKind: 'movement', medium: 'Oil paint', play: undefined, cats: ['movement', 'medium'], img: 'https://x/a.jpg', y: 1910 };
  const c = { notes: [{ head: 'H', body: 'B', x: 5, y: 5 }] };
  const base = workStateSha(p, c, null);
  ok('workStateSha stable for identical state', workStateSha({ ...p }, { notes: [{ head: 'H', body: 'B', x: 5, y: 5 }] }, null) === base);
  ok('workStateSha changes when a pool field changes (a newer merge)', workStateSha({ ...p, medium: 'Tempera' }, c, null) !== base);
  ok('workStateSha changes when teach notes change', workStateSha(p, { notes: [{ head: 'H2', body: 'B', x: 5, y: 5 }] }, null) !== base);
  ok('workStateSha changes when play flips', workStateSha({ ...p, play: false }, c, null) !== base);
  ok('workStateSha changes when hotspots change', workStateSha(p, c, [{ n: 1, x: 5, y: 5 }]) !== base);
  // ledger status + no-pins membership are part of the base state (an older run must not demote a newer ledger change)
  const withEntry = workStateSha(p, c, null, { status: 'needs-image', pass: SCHEMA_VERSION }, false);
  ok('workStateSha changes when the ledger entry status changes', withEntry !== workStateSha(p, c, null, { status: 'complete', pass: SCHEMA_VERSION }, false));
  ok('workStateSha changes when the ledger entry appears (newer terminal status)', withEntry !== workStateSha(p, c, null, null, false));
  ok('workStateSha changes when no-pins membership changes', workStateSha(p, c, null, null, true) !== workStateSha(p, c, null, null, false));
  // EXACT regression (v7 blocker): two needs-image entries with DIFFERENT blocked-image hashes must NOT hash identically
  const blk1 = { status: 'needs-image', pass: SCHEMA_VERSION, img: 'https://x/a.jpg', imgSha: 'a'.repeat(64) };
  const blk2 = { status: 'needs-image', pass: SCHEMA_VERSION, img: 'https://x/a.jpg', imgSha: 'b'.repeat(64) };  // same url, different derivative
  ok('workStateSha distinguishes needs-image entries by blocked imgSha (same url)', workStateSha(p, c, null, blk1, false) !== workStateSha(p, c, null, blk2, false)); }

// --- isTransientFail (shared broker-failure classifier; only STABLE failures back off) ---
ok('dns-failed transient', isTransientFail('dns-failed') === true);
ok('timeout transient', isTransientFail('timeout') === true);
ok('network-error transient', isTransientFail('network-error') === true);
ok('http 429 transient', isTransientFail('http-status', 429) === true);
ok('http 408/425 transient', isTransientFail('http-status', 408) === true && isTransientFail('http-status', 425) === true);
ok('whole 5xx range transient (500/501/507/520/522/599)', [500, 501, 507, 520, 522, 599].every(s => isTransientFail('http-status', s) === true));
ok('http 404/410/403 STABLE', isTransientFail('http-status', 404) === false && isTransientFail('http-status', 410) === false && isTransientFail('http-status', 403) === false);
ok('blocked-ip STABLE', isTransientFail('blocked-ip') === false);
ok('mime/decode/too-large STABLE', isTransientFail('mime-not-allowed') === false && isTransientFail('decode-failed') === false && isTransientFail('too-large') === false);
ok('no-ipv4 (v6-only host) STABLE — unsupported host, not a transient DNS hiccup', isTransientFail('no-ipv4') === false);

// --- merge lock (serializes concurrent curate-merge — the second holder is refused while the first owns it) ---
{ const lbase = mkdtempSync(join(tmpdir(), 'lock-')); const lp = join(lbase, '.merge.lock');
  ok('first acquireLock succeeds', acquireLock(lp) === true);
  ok('second acquireLock refused while held (two-process guard)', acquireLock(lp) === false);
  releaseLock(lp);
  ok('acquireLock succeeds again after release', acquireLock(lp) === true);
  releaseLock(lp); rmSync(lbase, { recursive: true, force: true }); }

// --- CONFLICT PRECEDENCE: an image defect OUTRANKS playable:false (a bad image can NEVER terminally exclude) ---
ok('playable:false + image.ok:false → needs-image (not unplayable)', visionPassStatus({ playable: false, image: { ok: false } }) === 'needs-image');
ok('playable:false + imageQuality:poor → needs-image', visionPassStatus({ playable: false, imageQuality: 'poor' }) === 'needs-image');
ok('playable:false + framing:cropped → needs-image', visionPassStatus({ playable: false, framing: 'cropped' }) === 'needs-image');
ok('the reproduced worst case → needs-image', visionPassStatus({ playable: false, image: { ok: false }, imageQuality: 'poor', framing: 'cropped' }) === 'needs-image');

// --- LEDGER TRANSITION (blocker 2: demote a stale terminal; blocker 3: PRESERVE a needs-image blocker) ---
const NOW = '2026-08-28';
{ const t = ledgerTransition(null, 'complete', SCHEMA_VERSION, NOW);
  ok('complete → set terminal entry + drop legacy bare', t.setEntry && t.setEntry.status === 'complete' && t.removeFromIds === true); }
{ const t = ledgerTransition(null, 'unplayable', SCHEMA_VERSION, NOW);
  ok('unplayable → set terminal entry', t.setEntry && t.setEntry.status === 'unplayable'); }
{ const t = ledgerTransition(null, 'needs-image', SCHEMA_VERSION, NOW);
  ok('needs-image → set blocker entry (re-selects)', t.setEntry && t.setEntry.status === 'needs-image' && t.removeFromIds === true); }
{ // blocker 2: prior unplayable, forced re-audit approves only {playable:true} → status incomplete → invalidate
  const prev = { status: 'unplayable', pass: SCHEMA_VERSION, at: '2026-08-01' };
  const t = ledgerTransition(prev, 'incomplete', SCHEMA_VERSION, NOW);
  ok('incomplete over a prior terminal → demote (remove entry, re-selects)', t.removeEntry === true && !t.setEntry && t.invalidated === true); }
{ // blocker 3 (the exact repro): prior needs-image + incomplete retry MUST preserve the blocker
  const prev = { status: 'needs-image', pass: SCHEMA_VERSION, at: '2026-08-01' };
  const t = ledgerTransition(prev, 'incomplete', SCHEMA_VERSION, NOW);
  ok('incomplete over a current needs-image → PRESERVE blocker (no delete)', !t.removeEntry && !t.setEntry && t.invalidated === false); }
{ // a never-audited work that stays incomplete is left untouched (no churn)
  const t = ledgerTransition(undefined, 'incomplete', SCHEMA_VERSION, NOW);
  ok('incomplete over a never-audited work → no-op', !t.setEntry && !t.removeEntry && !t.removeFromIds && !t.invalidated); }
{ // a stale-pass entry on an incomplete retry is left as-is (already re-auditable)
  const t = ledgerTransition({ status: 'complete', pass: 'vision-audit/0-OLD', at: NOW }, 'incomplete', SCHEMA_VERSION, NOW);
  ok('incomplete over a stale-pass entry → no-op', !t.removeEntry && !t.invalidated); }

// --- AUDITED ORACLE (blocker 4: bare legacy ids NEVER audited; v9: terminal entries CROSS-VERIFIED vs evidence store) ---
const RUN1 = 'a'.repeat(32), ISHA = 'a'.repeat(64), CSHA = 'b'.repeat(64);
const EV = { run: RUN1, imgSha: ISHA, completionSha: CSHA };   // valid provenance triple that MUST match the evidence store
{ const led = { legacyPass: LEGACY_PASS, ids: ['legacy-1', 'legacy-2'], entries: {
    done: { status: 'complete', pass: SCHEMA_VERSION, at: NOW, ...EV },
    gone: { status: 'unplayable', pass: SCHEMA_VERSION, at: NOW, run: RUN1, imgSha: 'c'.repeat(64), completionSha: 'd'.repeat(64) },
    noev: { status: 'complete', pass: SCHEMA_VERSION, at: NOW },                                  // no evidence fields
    forged: { status: 'complete', pass: SCHEMA_VERSION, at: NOW, run: 'f'.repeat(32), imgSha: ISHA, completionSha: CSHA }, // run not in store
    mism: { status: 'complete', pass: SCHEMA_VERSION, at: NOW, run: RUN1, imgSha: '9'.repeat(64), completionSha: CSHA },   // sha != store
    block: { status: 'needs-image', pass: SCHEMA_VERSION, at: NOW, ...EV },
    stale: { status: 'complete', pass: 'vision-audit/0-OLD', at: NOW, ...EV },
  } };
  const BS = 'e'.repeat(64), PH = 'a'.repeat(64);
  const IMG_OK = { ok: true, issue: 'none', reason: 'clear', suggestedUrl: null };             // a SCHEMA-VALID trusted image
  const AP_C = { image: IMG_OK, imageQuality: 'good', framing: 'ok', playable: true, mediumLegible: true, notes: N5 };   // schema-valid COMPLETE approval → visionPassStatus 'complete'
  const AP_U = { image: IMG_OK, imageQuality: 'good', framing: 'ok', playable: false };         // schema-valid trusted image + playable:false → 'unplayable'
  const hdr = { promptHash: PH, schemaVersion: SCHEMA_VERSION, brokerPolicyVersion: 'img-broker/1', modelId: 'claude-sonnet-4-6' };
  const evidence = { [RUN1]: { at: NOW, header: hdr, items: [
    { id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }, { id: 'gone', imgSha: 'c'.repeat(64), completionSha: 'd'.repeat(64), baseSha: BS, approved: AP_U },
    { id: 'mism', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }, { id: 'block', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }, { id: 'stale', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C },
  ] } };
  const audited = auditedOracle(led, evidence);
  ok('complete + evidence cross-verified (approval produces complete) → audited', audited('done') === true);
  ok('unplayable + evidence cross-verified (approval produces unplayable) → audited', audited('gone') === true);
  ok('FORGED entry (well-formed hashes, run not in store) → NOT audited', audited('forged') === false);
  ok('entry sha != evidence item sha → NOT audited', audited('mism') === false);
  ok('no-evidence-fields entry → NOT audited', audited('noev') === false);
  ok('needs-image → NOT audited', audited('block') === false);
  ok('stale-pass → NOT audited', audited('stale') === false);
  ok('bare legacy id → NEVER audited', audited('legacy-1') === false && audited('legacy-2') === false);
  ok('audited requires the evidence store (empty store → nothing audited)', auditedOracle(led, {})('done') === false);
  ok('duplicate evidence item for one id → NOT audited (fail closed)', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }, { id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }] } })('done') === false);
  ok('evidence header wrong schema → NOT audited', auditedOracle(led, { [RUN1]: { header: { ...hdr, schemaVersion: 'vision-audit/0' }, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }] } })('done') === false);
  ok('incomplete evidence header (schema only) → NOT audited', auditedOracle(led, { [RUN1]: { header: { schemaVersion: SCHEMA_VERSION }, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }] } })('done') === false);
  ok('promptHash not 64-hex → NOT audited (must be a real SHA-256)', auditedOracle(led, { [RUN1]: { header: { ...hdr, promptHash: 'x' }, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_C }] } })('done') === false);
  // v11 blocker: the approved values must PRODUCE the recorded status — a thin OR unplayable approval can't back 'complete'
  ok('status-mismatch: complete entry backed by a THIN approval → NOT audited', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: { playable: true } }] } })('done') === false);
  ok('status-mismatch: complete entry backed by an UNPLAYABLE approval → NOT audited', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: AP_U }] } })('done') === false);
  // v12 medium (Codex repro): SCHEMA-INVALID approval must NOT earn credit even though visionPassStatus is looser
  const badImg = { image: { ok: true }, imageQuality: 'good', framing: 'ok', playable: true, mediumLegible: true, notes: N5 };  // image missing issue/reason/suggestedUrl
  ok('schema-invalid image (missing required fields) → validateApprovedPatch fails', validateApprovedPatch({ id: 'done', ...badImg }).ok === false);
  ok('schema-invalid image approval → NOT audited (even if visionPassStatus would pass)', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: badImg }] } })('done') === false);
  const xNoY = { image: IMG_OK, imageQuality: 'good', framing: 'ok', playable: true, mediumLegible: true, notes: [1,2,3,4,5].map(i => ({ head: `H${i}`, body: `B${i}`, x: 10 * i })) };  // pins with x but no y
  ok('pins with x but no y → validateApprovedPatch fails', validateApprovedPatch({ id: 'done', ...xNoY }).ok === false);
  ok('x-without-y notes approval → NOT audited (schema catches what visionPassStatus does not)', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS, approved: xNoY }] } })('done') === false);
  ok('item missing baseSha → NOT audited', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, approved: AP_C }] } })('done') === false);
  ok('item missing approved object → NOT audited', auditedOracle(led, { [RUN1]: { header: hdr, items: [{ id: 'done', imgSha: ISHA, completionSha: CSHA, baseSha: BS }] } })('done') === false);
  ok('blockedIds lists only current-pass needs-image', JSON.stringify(blockedIds(led)) === '["block"]');
  ok('legacyEvidenceIds = bare ids with no entry', JSON.stringify(legacyEvidenceIds(led)) === '["legacy-1","legacy-2"]'); }
{ // LEGACY_PASS is a distinct, immutable sentinel that never equals the current schema (no retroactive promotion)
  ok('LEGACY_PASS !== SCHEMA_VERSION', LEGACY_PASS !== SCHEMA_VERSION);
  const audited = auditedOracle({ legacyPass: SCHEMA_VERSION, ids: ['x'], entries: {} });
  ok('even legacyPass==current does NOT audit a bare id (no legacy grandfathering path)', audited('x') === false); }

const base = mkdtempSync(join(tmpdir(), 'vrun-'));
const run = createRunDir(base);
const id = 'http://www.wikidata.org/entity/Q12345';        // id with '/'+':' — never a raw path component
const MODEL = 'claude-sonnet-4-6';

const img = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#37a' } }).jpeg().toBuffer();
const imgSha = sha256(img);
writeFileSync(join(run.imgsDir, `${imgSha}.jpg`), img);

const manHeader = runHeader(run.runId, promptHashOf('PROMPT v1'));   // NO modelId in the frozen manifest header
const meta = { title: 'T', artist: 'A' };
const BASE = 'c'.repeat(64);   // a valid 64-hex base-state hash the run was built from
const manItem = { id, firstDate: 'x', tier: 'easy', meta, imgStatus: 'ok', sha256: imgSha, ext: 'jpg', imgFile: `imgs/${imgSha}.jpg`, baseSha: BASE };
const manifest = { header: manHeader, items: [manItem] };
const writeManifest = () => writeFileSync(run.manifestPath, JSON.stringify(manifest));
writeManifest();

const result = { id, image: { ok: true, issue: 'none', reason: 'clear', suggestedUrl: null }, playable: true, playableReason: 'decorated', imageQuality: 'good', qualityReason: 'sharp', framing: 'ok', mediumLegible: true, notes: [{ head: 'Blue field', body: 'A calm blue ground.', x: 50, y: 40 }] };
const compRec = { header: { ...manHeader, modelId: MODEL }, id, imgSha256: imgSha, baseSha: BASE, metaSha: metaShaOf(id, meta, imgSha, BASE), result };   // record carries its OWN full header + meta + baseSha binding
const compPath = join(run.completionsDir, completionFile(id));
writeFileSync(compPath, JSON.stringify(compRec));
const compSha = sha256(readFileSync(compPath));

// a PARTIAL, human-approved patch that SELECTS a model field verbatim (allowlist): playable:true MATCHES the completion
const approvedGood = { header: { ...manHeader, modelId: MODEL }, items: [{ id, imgSha256: imgSha, completionSha256: compSha, approved: { playable: true } }] };
const writeApproved = (obj) => { try { rmSync(run.approvedPath, { force: true }); } catch {} const fd = openSync(run.approvedPath, 'wx'); writeSync(fd, JSON.stringify(obj)); closeSync(fd); };

writeApproved(approvedGood);
{ const v = verifyApproval(run.dir); ok('valid allowlist approval passes + only approved field returned', v.ok === true && v.batch.length === 1 && JSON.stringify(v.batch[0].approved) === '{"playable":true}'); }
// ALLOWLIST: an approved value that DIFFERS from the reviewed completion is rejected (no silent corrections)
{ writeApproved({ header: { ...manHeader, modelId: MODEL }, items: [{ id, imgSha256: imgSha, completionSha256: compSha, approved: { playable: false } }] });
  ok('approved value differing from the completion rejected (allowlist)', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /differs from the reviewed completion/.test(e)));
  writeApproved(approvedGood); }
// baseSha PROVENANCE: tampering the manifest baseSha after the run is caught (metaSha no longer matches)
{ manItem.baseSha = 'd'.repeat(64); writeManifest();
  ok('post-run baseSha tamper rejected (metaSha binding)', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /metadata mismatch|baseSha mismatch/.test(e)));
  manItem.baseSha = BASE; writeManifest(); }
{ manItem.baseSha = 'not-hex'; writeManifest();
  ok('non-hex baseSha rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /invalid baseSha/.test(e)));
  manItem.baseSha = BASE; writeManifest(); }
{ const v = verifyApproval(run.dir); ok('batch carries the bound baseSha + imgSha + completionSha (durable provenance)', v.ok === true && v.batch[0].baseSha === BASE && v.batch[0].imgSha256 === imgSha && v.batch[0].completionSha256 === compSha); }
// FULL CHAIN (v11): a GENUINELY complete approval → status via visionPassStatus → entry via ledgerTransition → stamped
// with run/imgSha/completionSha (curate-merge's mapping) → cross-verified by auditedOracle. Status is DERIVED, never
// hardcoded, so a thin approval can't masquerade as complete.
{ const cApproved = { image: { ok: true, issue: 'none', reason: 'clear', suggestedUrl: null }, imageQuality: 'good', framing: 'ok', playable: true, mediumLegible: true, notes: N5 };
  ok('full chain: genuine complete approval is SCHEMA-VALID + visionPassStatus complete', validateApprovedPatch({ id: 'W', ...cApproved }).ok === true && visionPassStatus(cApproved) === 'complete');
  const RUNc = '1'.repeat(32), IMGc = '2'.repeat(64), COMPc = '3'.repeat(64), BASEc = '4'.repeat(64);
  const t = ledgerTransition(null, visionPassStatus(cApproved), SCHEMA_VERSION, NOW);   // derives 'complete' → setEntry
  const entry = { ...t.setEntry, run: RUNc, imgSha: IMGc, completionSha: COMPc };        // curate-merge stamps provenance
  const evStore = { [RUNc]: { at: NOW, header: { promptHash: 'a'.repeat(64), schemaVersion: SCHEMA_VERSION, brokerPolicyVersion: 'img-broker/1', modelId: 'm' }, items: [{ id: 'W', imgSha: IMGc, completionSha: COMPc, baseSha: BASEc, approved: cApproved }] } };
  ok('full chain: complete entry + complete-producing evidence → audited', auditedOracle({ entries: { W: entry } }, evStore)('W') === true);
  ok('full chain: dropped completionSha (the v10 bug) → NOT audited', auditedOracle({ entries: { W: { ...entry, completionSha: undefined } } }, evStore)('W') === false);
  // a thin approval never reaches a terminal entry at all (ledgerTransition on 'incomplete' → no setEntry)
  ok('full chain: thin approval → incomplete → no terminal entry', ledgerTransition(null, visionPassStatus({ playable: true }), SCHEMA_VERSION, NOW).setEntry === undefined);
  // a complete ledger entry backed by unplayable-shaped evidence → status mismatch → NOT audited
  const evMis = { [RUNc]: { header: evStore[RUNc].header, items: [{ id: 'W', imgSha: IMGc, completionSha: COMPc, baseSha: BASEc, approved: { image: { ok: true, issue: 'none', reason: 'clear', suggestedUrl: null }, imageQuality: 'good', framing: 'ok', playable: false } }] } };
  ok('full chain: complete entry but unplayable evidence → NOT audited (status mismatch)', auditedOracle({ entries: { W: entry } }, evMis)('W') === false); }

// BLOCKER 4 tamper: a traversal ext in the manifest must be rejected (verifyApproval must not read outside imgs/)
{ manItem.ext = '../../evil'; writeManifest();
  ok('traversal ext in manifest rejected before write', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /unsafe\/invalid derivative path/.test(e)));
  manItem.ext = 'jpg'; writeManifest(); }
// BLOCKER 4 tamper: a mismatched imgFile (points elsewhere) is caught even with a valid sha/ext
{ manItem.imgFile = '../../../etc/passwd'; writeManifest();
  ok('manifest imgFile mismatch rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /imgFile mismatch/.test(e)));
  manItem.imgFile = `imgs/${imgSha}.jpg`; writeManifest(); }

// NEW BLOCKER 2 — DUPLICATE approved ids for one work must be rejected (two patches would both apply)
{ writeApproved({ header: { ...manHeader, modelId: MODEL }, items: [
    { id, imgSha256: imgSha, completionSha256: compSha, approved: { playable: false } },
    { id, imgSha256: imgSha, completionSha256: compSha, approved: { playable: true } },
  ] });
  ok('duplicate id in approved.json rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /duplicate id in approved/.test(e)));
  writeApproved(approvedGood); }
{ const orig = manifest.items; manifest.items = [manItem, { ...manItem }]; writeManifest();
  ok('duplicate id in manifest rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /duplicate id in manifest/.test(e)));
  manifest.items = orig; writeManifest(); }

// NEW BLOCKER 1 — verifyApproval returns the runId (for single-use recording in curate-merge)
ok('verifyApproval surfaces runId for single-use tracking', verifyApproval(run.dir).runId === run.runId);

// tamper: swap the derivative bytes → sha mismatch
{ writeFileSync(join(run.imgsDir, `${imgSha}.jpg`), await sharp({ create: { width: 32, height: 24, channels: 3, background: '#a33' } }).jpeg().toBuffer());
  ok('swapped derivative rejected', verifyApproval(run.dir).ok === false);
  writeFileSync(join(run.imgsDir, `${imgSha}.jpg`), img); }

// tamper: edit the completion after review → completion-FILE sha mismatch
{ writeFileSync(compPath, JSON.stringify({ ...compRec, result: { ...result, playable: false } }));
  ok('edited completion rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /completion sha mismatch/.test(e)));
  writeFileSync(compPath, JSON.stringify(compRec)); }

// tamper: relabel the model — approval claims a different model than the completion record
{ writeApproved({ ...approvedGood, header: { ...manHeader, modelId: 'evil-model' } });
  ok('model relabel rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /model mismatch/.test(e))); }

// tamper: approval header claims a different prompt hash than the frozen manifest
{ writeApproved({ ...approvedGood, header: { ...manHeader, promptHash: 'deadbeef', modelId: MODEL } });
  ok('prompt-hash mismatch rejected', verifyApproval(run.dir).ok === false); }

// tamper: manifest metadata edited AFTER the run (the exact repro from the audit) → metaSha mismatch
{ writeApproved(approvedGood);
  const orig = meta.title; meta.title = 'Totally Different Title'; writeManifest();
  ok('post-run meta edit rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /metadata mismatch/.test(e)));
  meta.title = orig; writeManifest(); }

// tamper: off-schema approved patch (HTML in body)
{ writeApproved({ header: { ...manHeader, modelId: MODEL }, items: [{ id, imgSha256: imgSha, completionSha256: compSha, approved: { notes: [{ head: 'x', body: 'see <img src=x onerror=alert(1)>' }] } }] });
  ok('off-schema approved rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /invalid/.test(e))); }

// tamper: approved id not present in manifest
{ writeApproved({ header: { ...manHeader, modelId: MODEL }, items: [{ id: 'unknown-id', imgSha256: imgSha, completionSha256: compSha, approved: { playable: false } }] });
  ok('unknown id rejected', verifyApproval(run.dir).ok === false && verifyApproval(run.dir).errors.some(e => /not in manifest/.test(e))); }

// restore good → still verifies (proves rejects were about tamper, not a broken checker)
writeApproved(approvedGood);
ok('good approval still verifies after tamper cases', verifyApproval(run.dir).ok === true);

rmSync(base, { recursive: true, force: true });
if (fails.length) { console.error(`❌ vision-provenance.test — ${fails.length} FAILED:`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`✅ vision-provenance.test PASS — ${pass} checks (nonempty-subset patch; visionPassStatus component-level completion incl. thin-partial-never-completes; approval binds run+derivative+completion-file+parsed-header+model; swapped derivative, edited completion, model relabel, prompt-hash mismatch, off-schema value, unknown id all rejected before write)`);
process.exit(0);
