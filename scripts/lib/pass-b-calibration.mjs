// Deterministic controller core for the fixed 50-work Pass B calibration (B0→B1→B2→B3→B4).
// Pure/deterministic helpers only: selection validation, legacy snapshot, trusted catalog, call planning,
// stage-boundary enforcement, producer evidence, and the subscription command builder. NO model calls,
// no authoritative writes, no merge. The CLI (scripts/pass-b-calibration.mjs) does fs orchestration.
import { readFileSync, readdirSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableJson } from './vision-legacy.mjs';
import { buildB2Input, validateStageBody, EVIDENCE_AXES } from './vision-content-schema.mjs';
import { assembleAndValidateB4, b1Grounding } from './pass-b-b4-delta.mjs';
import { verifyCapturedStage, completionKey } from './vision-content-capture.mjs';
import { WIRE_SCHEMAS } from './pass-b-wire-schema.mjs';
import { BROKER_POLICY_VERSION } from './img-broker.mjs';

export const CONTROLLER_VERSION = 'passBCalibration/5-b4-delta'; // B4 = compact editorial delta + deterministic hydration (VSD-022)
export const RUN_ROOT = 'data/incoming/vision-calibration';
// Image transport for the calibration: the sanitized SHA image sits alone in a fresh confined temp dir and
// Claude opens it with the Read tool (the zero-tool @file/base64 transport did NOT deliver the image; see VSD-019).
// A change to this string is part of the run-identity contract, forcing a fresh run.
export const IMAGE_TRANSPORT_VERSION = 'readtool-confined-dir/1';
// Shared B0-B3/run-evidence acceptance contract. B4 now has a separate downstream fork version below, so
// a B4 schema/hydration change does not invalidate already-banked B1-B3 evidence. VSD-023/VSD-038.
export const VALIDATION_CONTRACT_VERSION = 'passBValidation/4'; // /4: spatial pinRef + publishable-hotspot/lineage rules (VSD-027); /3: museum-source leak gate (VSD-026)
// B4-only fork. This is deliberately separate from VALIDATION_CONTRACT_VERSION so banking/reusing B1-B3
// does not acquire a new identity merely because the downstream synthesis contract changed. VSD-039.
export const B4_VALIDATION_CONTRACT_VERSION = 'passBValidationB4/1-structured-grounding';
// Pure, testable run-identity contract. The runId is 'cal50-' + contractHash(...). Every listed binding
// participates; changing any one changes the runId.
export function calibrationContract({ selIds, controllerVersion = CONTROLLER_VERSION, imageTransportVersion = IMAGE_TRANSPORT_VERSION, prompts, validationContractVersion = VALIDATION_CONTRACT_VERSION, b4ValidationContractVersion = B4_VALIDATION_CONTRACT_VERSION, schema = 'contentVisionEnrichment/1' }) {
  return { sel: selIds, controller: controllerVersion, imageTransport: imageTransportVersion, prompts, validationContract: validationContractVersion, b4ValidationContract: b4ValidationContractVersion, schema };
}
export function contractHash(inputs) { return sha256(stableJson(calibrationContract(inputs))).slice(0, 12); }
export const MAX_B3 = 50; // retained: B3/B4 SCHEMAS survive for future synthesis; they are NOT in the calibration path.
export const EXPECTED_STAGES = Object.freeze({ B1: 50, B2: 'conditional' }); // lean calibration: B0/B1 + conditional B2 only
export const PROTECTED_HOURS = Object.freeze({ tz: 'America/Los_Angeles', startHour: 9, endHour: 22 });
export const CALIBRATION_MODEL = 'claude-sonnet-4-6'; // exact pinned id, not the 'sonnet' alias

// ---- Fixed selection: validate composition, never silently repair. ----
export function validateSelection(sel, poolIds) {
  const works = sel?.works;
  const e = [];
  if (!Array.isArray(works) || works.length !== 50) e.push(`expected 50 works, got ${works?.length}`);
  const ids = (works || []).map(w => w.id);
  if (new Set(ids).size !== ids.length) e.push('duplicate ids in selection');
  const missing = ids.filter(id => !poolIds.has(id));
  if (missing.length) e.push(`ids not in current pool: ${missing.join(', ')}`);
  const tally = key => (works || []).reduce((m, w) => (m[w[key]] = (m[w[key]] || 0) + 1, m), {});
  const cohort = tally('cohort');
  if (cohort.strongLegacy !== 25 || cohort.thinLegacy !== 25) e.push(`cohort must be 25/25, got ${JSON.stringify(cohort)}`);
  const band = tally('fameBand');
  if (!['f1', 'f2', 'f3', 'f4', 'f5'].every(b => band[b] === 10)) e.push(`fameBand must be 10 each, got ${JSON.stringify(band)}`);
  const region = tally('regionGroup');
  if (region.europe !== 25 || region['non-europe'] !== 25) e.push(`regionGroup must be 25/25, got ${JSON.stringify(region)}`);
  return { ok: e.length === 0, errors: e, works: works || [], guideStatus: tally('guideStatus') };
}

// ---- Trusted catalog: the ONLY identity that crosses to the web-enabled B2 principal. ----
export function trustedCatalog(pool) {
  return {
    title: String(pool.title ?? ''), artist: String(pool.artist ?? ''),
    date: String(pool.yr ?? pool.y ?? ''), place: String(pool.place ?? ''),
    medium: String(pool.medium ?? ''), style: String(pool.style ?? ''), catalogId: String(pool.id),
  };
}

// ---- Legacy snapshot: everything the audit/synthesis must weigh (never sent to the blind B1/B3). ----
export function snapshotLegacy(id, { teach, hotspots, vision, auditIds }) {
  const t = teach?.[id] || null;
  return {
    workId: id,
    teaching: t ? { why: t.why ?? null, cues: t.cues ?? null, notes: t.notes ?? null, guide: t.guide ?? null } : null,
    hotspots: hotspots?.[id] || null,
    rich: vision?.[id] || null,
    auditListed: !!auditIds?.has?.(id),
    counts: {
      guide: Array.isArray(t?.guide) ? t.guide.length : 0,
      notes: Array.isArray(t?.notes) ? t.notes.length : 0,
      cues: Array.isArray(t?.cues) ? t.cues.length : 0,
      hotspots: Array.isArray(hotspots?.[id]) ? hotspots[id].length : 0,
      rich: vision?.[id] ? 1 : 0,
    },
  };
}

// ---- Bounded, deterministic legacy-content input. Reaches B2 (audit) and B4 (synthesis) ONLY — never
// the blind B1/B3 image stages. This is the existing site content the calibration must preserve/improve. ----
export function legacyContentInput(legacy) {
  const cap = (arr, n) => Array.isArray(arr) ? arr.slice(0, n) : null;
  const t = legacy?.teaching || {};
  return {
    version: 'passBLegacyInput/1', workId: legacy?.workId ?? null,
    why: typeof t.why === 'string' ? t.why : null,
    cues: cap(t.cues, 8),
    notes: cap((t.notes || []).map(n => ({ head: n.head ?? null, body: n.body ?? null, x: n.x ?? null, y: n.y ?? null })), 40),
    guide: cap((t.guide || []).map(q => ({ q: q.q ?? null, a: q.a ?? null })), 25),
    hotspots: cap((legacy?.hotspots || []).map(h => ({ n: h.n ?? null, x: h.x ?? null, y: h.y ?? null })), 60),
    rich: legacy?.rich ?? null,
    counts: legacy?.counts ?? null,
  };
}

// Authoritative prior value for a disposition component, taken from the deterministic B0 snapshot (never
// from the model). Used by the review packet to show old-vs-proposed.
export function priorForComponent(component, legacy) {
  const t = legacy?.teaching || {};
  switch (component) {
    case 'why': return t.why ?? null;
    case 'cues': return t.cues ?? null;
    case 'notes': return t.notes ?? null;
    case 'guide': return t.guide ?? null;
    case 'hotspots': return legacy?.hotspots ?? null;
    case 'richDescriptors': return legacy?.rich ? Object.keys(legacy.rich).sort() : null;
    default: return null; // imageState/playability/scoredFacts/catalogFacts live in pool/ledger, shown elsewhere
  }
}

// ---- Stage tool/network policy → producer evidence (the model can never assert these). ----
// B1/B3 image stages and the post-B4 B5 spatial-only canary get ONLY the Read tool, confined to a fresh
// per-call directory holding one SHA image. B2 gets ONLY web search/fetch. B4 is tool-less.
const TOOL_POLICY = { B1: 'tools:read-only-confined-dir', B2: 'tools:web-search+fetch-only', B3: 'tools:read-only-confined-dir', B4: 'tools:none', B5: 'tools:read-only-confined-dir-spatial-only' };
const NET_POLICY = { B1: 'egress:claude-service-only', B2: 'egress:claude-service+public-web', B3: 'egress:claude-service-only', B4: 'egress:claude-service-only', B5: 'egress:claude-service-only' };
export function producerEvidence(stage, { model = CALIBRATION_MODEL, runtimeVersion }) {
  const kind = 'claude-code-subscription';
  return {
    kind, model, runtimeVersion: String(runtimeVersion || 'unknown'),
    toolPolicyHash: sha256(TOOL_POLICY[stage]), networkPolicyHash: sha256(NET_POLICY[stage]),
  };
}

// ---- Claude CLI envelope helpers (the CLI reports resolved models in `modelUsage`, not a top-level
// `model`, and wraps the answer in a ```json fence). ----
export function primaryModelFromEnvelope(env2) {
  const mu = env2?.modelUsage || {};
  const outOf = u => u?.outputTokens ?? u?.output_tokens ?? 0;
  return Object.entries(mu).sort((a, b) => outOf(b[1]) - outOf(a[1]))[0]?.[0] ?? env2?.model ?? null;
}
export function stripJsonFence(text) {
  const s = String(text);
  const m = s.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  return (m ? m[1] : s).trim();
}

// ---- stream-json transcript parsing. The CLI emits line-delimited JSON events; tool_use blocks live in
// `assistant` messages, tool_result blocks in `user` messages, and one terminal `result` event carries
// structured_output/modelUsage/usage. This is the raw execution evidence the controller verifies. ----
export function parseStreamTranscript(stdout) {
  const toolUses = [], toolResults = []; let final = null, init = null; let lines = 0, parsed = 0;
  for (const ln of String(stdout).split('\n')) {
    if (!ln.trim()) continue;
    lines++;
    let ev; try { ev = JSON.parse(ln); } catch { continue; }
    parsed++;
    // The system/init event carries apiKeySource and claude_code_version — the authoritative provenance
    // fields (the terminal result event does NOT include them).
    if (ev?.type === 'system' && ev?.subtype === 'init') init = { apiKeySource: ev.apiKeySource ?? null, claudeCodeVersion: ev.claude_code_version ?? null, model: ev.model ?? null };
    const content = ev?.message?.content;
    if (Array.isArray(content)) for (const b of content) {
      if (b?.type === 'tool_use') toolUses.push({ id: b.id ?? null, name: b.name ?? null, input: b.input ?? {} });
      if (b?.type === 'tool_result') {
        const hasImage = Array.isArray(b.content) && b.content.some(c => c?.type === 'image');
        // Capture bounded HEAD+TAIL of the result text so a fetch that returned a non-error envelope but NO
        // page body (HTTP 4xx/5xx, unfollowed redirect, "no web page content") can be told apart from a real
        // retrieval even when the failure marker lands after the first several hundred characters.
        let text = '';
        if (typeof b.content === 'string') text = b.content;
        else if (Array.isArray(b.content)) text = b.content.map(c => (typeof c?.text === 'string' ? c.text : '')).join('\n');
        toolResults.push({ toolUseId: b.tool_use_id ?? null, isError: b.is_error === true, hasImage, textLen: text.length, head: text.slice(0, 500), tail: text.slice(-400) });
      }
    }
    if (ev?.type === 'result') final = ev;
  }
  return { lines, parsed, toolUses, toolResults, final, init };
}

// The terminal result event (structured_output, modelUsage, usage, num_turns, is_error).
export function transcriptFinal(transcript) { return transcript?.final ?? null; }

// A tool_result is a match for a tool_use by id; when ids are absent, fall back to order-agnostic presence.
function resultFor(transcript, toolUseId) {
  return transcript.toolResults.find(r => r.toolUseId && r.toolUseId === toolUseId) || null;
}

// ---- B1 image-receipt verification (from the raw transcript, NOT from prose). Require at least one
// successful Read of the EXACT SHA-named image inside the confined call dir; reject ANY Read whose target
// escapes that dir or names a different file. ----
export function verifyB1ImageRead(transcript, { callDir, imageBasename }) {
  const reads = transcript.toolUses.filter(u => u.name === 'Read');
  // Normalize the macOS /tmp -> /private/tmp symlink so the call dir and the Read tool's reported realpath
  // compare equal. (mkdtemp returns /tmp/…; the Read tool reports /private/tmp/….)
  const norm = p => String(p).replace(/^\/private(?=\/)/, '');
  const wantAbs = callDir ? norm(resolvePath(callDir, imageBasename)) : null;
  let good = 0; const bad = [];
  for (const r of reads) {
    const fp = typeof r.input?.file_path === 'string' ? r.input.file_path : '';
    const base = fp.split('/').pop();
    const abs = norm(fp.startsWith('/') ? fp : (callDir ? resolvePath(callDir, fp) : fp));
    const traversal = fp.includes('..');
    const insideCallDir = callDir ? (abs === wantAbs) : (base === imageBasename);
    if (traversal || !insideCallDir || base !== imageBasename) { bad.push(fp); continue; } // out-of-dir, traversal, or wrong file
    const res = r.id ? resultFor(transcript, r.id) : null;
    // A Read is delivered ONLY with a nonempty tool-use id AND a matching non-error tool_result carrying an
    // image content block. A missing result (or missing id) is NOT receipt.
    const delivered = !!(r.id && res && !res.isError && res.hasImage);
    if (delivered) good++;
  }
  const ok = good >= 1 && bad.length === 0;
  return { ok, reads: reads.length, good, bad, reason: ok ? null : (bad.length ? `read target escaped confinement: ${bad.join(', ')}` : 'no successful Read of the exact image (no image content block)') };
}

// Resolve a possibly-relative path against a base without importing node:path into pure helpers used by tests.
function resolvePath(base, p) {
  if (typeof p === 'string' && p.startsWith('/')) return p;
  const clean = String(p || '').replace(/^\.\//, '');
  return `${String(base).replace(/\/+$/, '')}/${clean}`;
}

// ---- B2 research verification (from the raw transcript, NOT usage.server_tool_use aggregate counters).
// Require at least one genuine WebSearch AND one genuine WebFetch that actually RETRIEVED a page. A
// WebFetch that returns an HTTP 4xx/5xx envelope or an unfollowed redirect comes back with is_error=false
// and no page body, so is_error alone would count a failed fetch as success — inspect the result text. ----
const FETCH_FAILURE_MARKER = /the server returned http\s*\d{3}|response body was not retrieved|was not retrieved|redirect detected|could not be retrieved|failed to fetch|no web ?page content|do(?:es)?n'?t see any [a-z ]{0,24}content|content provided in your message|no content (?:was )?provided|access denied|forbidden\b/i;
export function webFetchRetrieved(res) {
  if (!res || res.isError) return false;
  const text = `${res.head || ''}\n${res.tail || ''}`; // check HEAD+TAIL so a late marker cannot evade
  if (FETCH_FAILURE_MARKER.test(text)) return false; // non-error envelope, but no page body
  return (res.textLen || 0) >= 120; // a genuine retrieval returns substantive content
}
export function verifyB2WebEvents(transcript) {
  // A tool-use with no id, or with no matching tool_result, is NOT evidence of anything — require a real
  // matching non-error result (never default a missing result to success).
  const results = name => transcript.toolUses.filter(u => u.name === name).map(u => (u.id ? resultFor(transcript, u.id) : null));
  const searchRes = results('WebSearch');
  const fetchRes = results('WebFetch');
  const searches = searchRes.filter(r => r && !r.isError).length; // matching non-error result required
  const fetchAttempts = fetchRes.length;
  const fetches = fetchRes.filter(webFetchRetrieved).length; // only genuinely-retrieved pages
  const fetchFailed = fetchAttempts - fetches;
  const ok = searches >= 1 && fetches >= 1;
  return { ok, searches, fetches, fetchAttempts, fetchFailed, reason: ok ? null : `B2 research-not-performed: WebSearch=${searches}, WebFetch(retrieved)=${fetches}/${fetchAttempts} (need >=1 successful search AND >=1 fetch that actually returned a page; a 4xx/redirect envelope is not a retrieval)` };
}

// ---- Resume/revalidation EXECUTION-EVIDENCE gate. Given a captured completion, prove its evidence is real:
// locate the attempt transcript that HASHES to completion.transcriptSha256 (a fabricated sha has no matching
// file → fail), then re-verify model + apiKeySource + the stage's tool activity, and for B4 confirm the
// transcript's delta rehydrates EXACTLY to the stored body. Offline; no model/network. ----
export function findTranscriptBySha(workRunDir, stage, transcriptSha256) {
  const attemptsDir = join(workRunDir, 'attempts');
  if (!transcriptSha256 || !existsSync(attemptsDir)) return null;
  for (const f of readdirSync(attemptsDir)) {
    if (!f.startsWith(`${stage.toLowerCase()}-`) || !f.endsWith('.transcript.jsonl')) continue;
    let bytes; try { bytes = readFileSync(join(attemptsDir, f), 'utf8'); } catch { continue; }
    if (sha256(bytes) === transcriptSha256) return { file: f, bytes };
  }
  return null;
}
export function verifyStageEvidence({ stage, workRunDir, completion, imageBasename, expectedModel = CALIBRATION_MODEL, b1 = null, b2 = null, b3 = null, legacy = null }) {
  const errors = [];
  const found = findTranscriptBySha(workRunDir, stage, completion?.transcriptSha256);
  if (!found) return { ok: false, errors: [`transcript-sha-not-found:${String(completion?.transcriptSha256 || '').slice(0, 12)}`] };
  const transcript = parseStreamTranscript(found.bytes);
  const final = transcriptFinal(transcript);
  const model = primaryModelFromEnvelope(final);
  if (!model || model !== expectedModel) errors.push(`model:${model || 'none'}`);
  const apiKeySource = transcript.init?.apiKeySource ?? null;
  if (apiKeySource !== 'none') errors.push(`apiKeySource:${apiKeySource || 'missing'}`);
  if (stage === 'B1' || stage === 'B3') { const r = verifyB1ImageRead(transcript, { callDir: null, imageBasename }); if (!r.ok) errors.push(`read:${r.reason}`); }
  if (stage === 'B2') { const r = verifyB2WebEvents(transcript); if (!r.ok) errors.push(`web:${r.reason}`); }
  if (stage === 'B4') {
    const delta = final?.structured_output;
    if (delta == null) errors.push('b4-no-structured-output');
    else {
      const r = assembleAndValidateB4({ delta, b1, b2, b3, legacy: legacy || { teaching: {} } });
      if (!r.ok) errors.push(`b4-reassembly-invalid:${(r.errors || []).join('|').slice(0, 100)}`);
      else if (stableJson(r.body) !== stableJson(completion.body)) errors.push('b4-hydration-mismatch');
    }
  }
  return errors.length ? { ok: false, errors, transcriptFile: found.file } : { ok: true, transcriptFile: found.file };
}

// ---- Resume loader with STALE-vs-CORRUPT discipline (VSD-023). Returns the verified stored body, or null
// when the stage must re-run (stored input is legitimately stale). Throws (never deletes) on any integrity
// problem: unreadable/corrupt completion, a missing promptHash (corruption, not staleness), a mismatched raw
// SHA, or unverifiable execution evidence. A legitimately stale completion (its promptHash differs but the
// OLD artifact still fully verifies) is atomically archived under stale/ and the stage re-runs. ----
export function loadOrArchiveCompletion({ stage, workRunDir, id, imgSha256, ext, promptHash, context = {}, bodies = {}, legacy = null, brokerPolicyVersion, imageTransportVersion = IMAGE_TRANSPORT_VERSION, runtimeVersion = 'unknown', expectedModel = CALIBRATION_MODEL }) {
  const key = completionKey(stage, id);
  const completionPath = join(workRunDir, 'completions', `${stage.toLowerCase()}-${key}.json`);
  if (!existsSync(completionPath)) return null;
  let stored;
  try { stored = JSON.parse(readFileSync(completionPath, 'utf8')); }
  catch (e) { throw new Error(`resume integrity: unreadable completion for ${stage} ${id} (${String(e.message).slice(0, 60)})`); }
  if (!stored.promptHash) throw new Error(`resume integrity: completion for ${stage} ${id} has no promptHash (corruption)`);
  const producer = producerEvidence(stage, { runtimeVersion });
  const imageBasename = `${imgSha256}.${ext}`;
  const evidence = (completion) => verifyStageEvidence({ stage, workRunDir, completion, imageBasename, expectedModel, b1: bodies.B1, b2: bodies.B2, b3: bodies.B3, legacy });
  if (stored.promptHash === promptHash) {
    const trusted = { workId: id, imgSha256, promptHash, brokerPolicyVersion, imageTransportVersion };
    const v = verifyCapturedStage({ completionPath, runDir: workRunDir, trusted, producer, context });
    if (!v.ok) throw new Error(`resume verification failed for ${stage} ${id}: ${v.errors.join(',')}`);
    const ev = evidence(v.value);
    if (!ev.ok) throw new Error(`resume evidence failed for ${stage} ${id}: ${ev.errors.join(',')}`);
    return v.value.body;
  }
  const staleTrusted = { workId: id, imgSha256, promptHash: stored.promptHash, brokerPolicyVersion, imageTransportVersion };
  const vOld = verifyCapturedStage({ completionPath, runDir: workRunDir, trusted: staleTrusted, producer, context });
  if (!vOld.ok) throw new Error(`resume integrity: STALE ${stage} ${id} does not verify against its own bindings (${vOld.errors.join(',')}) — preserved, not deleted`);
  const evOld = evidence(vOld.value);
  if (!evOld.ok) throw new Error(`resume integrity: STALE ${stage} ${id} has unverifiable evidence (${evOld.errors.join(',')}) — preserved, not deleted`);
  const staleDir = join(workRunDir, 'stale'); mkdirSync(staleDir, { recursive: true, mode: 0o700 });
  renameSync(completionPath, join(staleDir, `${stage.toLowerCase()}-${key}-${String(stored.promptHash).slice(0, 12)}.json`)); // atomic archive; re-run writes fresh
  return null;
}

// ---- Neutral, content-addressed image FILENAME (never a title/id/path clue). The image sits alone in a
// fresh confined call dir; Claude opens it with the Read tool. No `@` mention (that transport failed). ----
export function neutralImageFile(imgSha256, ext) {
  if (!/^[0-9a-f]{64}$/.test(imgSha256 || '')) throw new Error('imageFile needs a sha256');
  if (!/^[a-z0-9]{1,5}$/.test(ext || '')) throw new Error('imageFile needs a safe ext');
  return `${imgSha256}.${ext}`;
}

// ---- Subscription command builder. Built for every stage; EXECUTED only by the CLI under --live.
// B1/B3 image stages and B5 spatial canaries get ONLY the Read tool confined to a fresh call dir holding
// one SHA image; B2 gets ONLY web search/fetch and NEVER an image; B4 is tool-less. Env strips API
// keys so the intended subscription/OAuth login is used, never a paid key. Output is stream-json so the
// controller can verify real tool-use events (Read / WebSearch / WebFetch) from the raw transcript. ----
export function buildStageCommand({ stage, model = CALIBRATION_MODEL, promptText, imageFile = null, wireSchema = null }) {
  if (!['B1', 'B2', 'B3', 'B4', 'B5'].includes(stage)) throw new Error(`unknown stage ${stage}`);
  const imageStage = stage === 'B1' || stage === 'B3' || stage === 'B5';
  if (imageStage && !imageFile) throw new Error(`${stage} requires a confined image filename`);
  if (!imageStage && imageFile) throw new Error(`${stage} must NOT receive an image`);
  if (imageFile && !/^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(imageFile)) throw new Error('imageFile must be a bare <sha>.<ext>');
  const schema = wireSchema || WIRE_SCHEMAS[stage];
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false) throw new Error(`${stage} needs a structural wire schema`);
  // Per-stage tool allowlist: image stages get Read only; B2 gets web only; B4 gets nothing. Both --tools
  // and --allowedTools are set so the tool is BOTH declared and permitted under --restricted/--safe-mode.
  const toolSet = imageStage ? 'Read' : (stage === 'B2' ? 'WebSearch WebFetch' : '');
  const argv = ['-p', promptText, '--model', model, '--tools', toolSet];
  if (toolSet) argv.push('--allowedTools', toolSet); // grant exactly the declared tools; never more
  // B4 editorial reconciliation and B5 point localization are bounded, not open-ended research: cap them
  // at low effort. B1/B2/B3 keep the session default effort.
  if (stage === 'B4' || stage === 'B5') argv.push('--effort', 'low');
  argv.push(
    '--json-schema', JSON.stringify(schema), '--prompt-suggestions', 'false',
    '--safe-mode', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--no-chrome', '--disable-slash-commands', '--permission-mode', 'dontAsk',
    '--no-session-persistence', '--output-format', 'stream-json', '--verbose',
  );
  const env = { removeKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], schemaHint: stage === 'B5' ? 'contentVisionLocalization/1' : 'contentVisionEnrichment/1' };
  return { bin: 'claude', argv, env, toolsEnforced: toolSet === '' ? 'none' : toolSet, imageAttached: !!imageFile, imageFile, wireSchemaSha256: sha256(stableJson(schema)) };
}

// ---- B1 → B2 boundary: only allowlisted signals cross (reuses the vetted buildB2Input). ----
export function b2InputFor(workId, catalog, b1Body) {
  return buildB2Input({ workId, trustedCatalog: catalog, b1: b1Body });
}

// ---- B2 conditionality (lean calibration): run the no-image research stage only when B1 raised research
// questions, or there is existing legacy content / catalog to fact-check. Deterministic; no model call. ----
export function b2Plan(b1Body, legacy) {
  const hasQuestions = Array.isArray(b1Body?.researchQuestions) && b1Body.researchQuestions.length > 0;
  const c = legacy?.counts || {};
  const hasLegacyClaims = ((c.notes || 0) + (c.guide || 0) + (c.cues || 0) + (c.rich || 0)) > 0 || !!legacy?.teaching?.why;
  const reasons = [hasQuestions && 'b1-research-questions', hasLegacyClaims && 'legacy-content-to-check'].filter(Boolean);
  return { run: reasons.length > 0, reasons };
}

// ---- B3 conditionality (RETAINED for future synthesis; NOT executed in the lean calibration path). ----
export const MAX_B3_REQUESTS = 2; // B2-v2 budget: at most two targeted second-look requests per work
export function b3Plan(b2Body) {
  const all = Array.isArray(b2Body?.targetedVerificationRequests) ? b2Body.targetedVerificationRequests : [];
  const reqs = all.slice(0, MAX_B3_REQUESTS); // cap to the two most important; extras are dropped (logged by the caller)
  return { run: reqs.length > 0, requests: reqs.map(r => ({ requestId: r.requestId, whatToLocate: r.whatToLocate })), requestIds: reqs.map(r => r.requestId), dropped: all.length - reqs.length };
}

// ---- Calibration call plan: B0 + B1 per work, CONDITIONAL B2, CONDITIONAL B3 (only on B2 targeted
// requests), and a compact B4 synthesis when B2 ran. Max processes = B1 + B2 + B3 + B4 per work. ----
export function planCalls(works) {
  const n = works.length;
  return { works: n, B0: n, B1: n, B2Max: n, B3Max: Math.min(n, MAX_B3), B4Max: n, b2Conditional: true, b3Conditional: true, maxProcesses: n * 3 + Math.min(n, MAX_B3) };
}

// ---- Compact B4 input: ONLY validated structured outputs + the legacy components needed to decide. Never
// raw transcripts, never schemas, never B1's verbose visual prose. B4 has NO image and NO tools, so it cannot
// re-derive visual evidence: it must PRESERVE B1's references. We therefore carry each B1 noteCandidate WITH
// its evidenceRef, plus ONLY the referenced B1 evidence/delight rows (projected with their axis), and any B3
// verifications. B4 may reuse these ids but may not invent new visual evidence. ----
export function compactB4Input({ b1, b2, b3, legacyInput }) {
  let b1c = null;
  if (b1) {
    const notes = (b1.noteCandidates || []).map(n => ({ head: n.head, body: n.body, role: n.role, pin: n.pin ?? null, evidenceRef: n.evidenceRef ?? null }));
    const referenced = new Set(notes.map(n => n.evidenceRef).filter(x => typeof x === 'string'));
    const evidenceRows = [];
    for (const axis of EVIDENCE_AXES) for (const item of (b1.evidence?.[axis] || [])) {
      if (referenced.has(item.evidenceId)) evidenceRows.push({ id: item.evidenceId, axis, feature: item.feature, bbox: item.bbox ?? null, confidence: item.confidence });
    }
    const delightRows = (b1.visual?.delights || []).filter(d => referenced.has(d.delightId)).map(d => ({ id: d.delightId, description: d.note, bbox: d.bbox ?? null, confidence: d.confidence }));
    b1c = { imageState: b1.imageFitness?.imageState ?? null, playable: b1.playable ?? null, seen: b1.seen ?? null, noteCandidates: notes, evidence: evidenceRows, delights: delightRows, tags: b1.tags ?? null };
  }
  const b2c = b2 ? {
    catalog: b2.catalog ?? null,
    factChecks: (b2.factChecks || []).map(f => ({ claimId: f.claimId, claim: f.claim, verdict: f.verdict, confidence: f.confidence, sources: f.sources })),
    guideAnswers: (b2.guideAnswers || []).map(g => ({ q: g.q, a: g.a, kind: g.kind, sourceRefs: g.sourceRefs })),
  } : null;
  const b3c = b3 ? { verifications: (b3.verifications || []).map(v => ({ requestId: v.requestId, found: v.found, bbox: v.bbox ?? null, note: v.note, confidence: v.confidence })) } : null;
  return { version: 'passBCompactB4Input/1', b1: b1c, b2: b2c, b3: b3c, legacy: legacyInput };
}

// ---- Protected-hours guard for unattended live work. Foreground calibration must be explicitly authorized. ----
export function protectedHoursBlock(hourPacific, foregroundAuthorized) {
  const inProtected = hourPacific >= PROTECTED_HOURS.startHour && hourPacific < PROTECTED_HOURS.endHour;
  return inProtected && !foregroundAuthorized;
}

// ---- Run manifest binding (selection/catalog/prompts/schemas/broker/model/controller). ----
export function buildRunManifest({ runId, works, promptHashes, imagePrep }) {
  const m = {
    version: CONTROLLER_VERSION, runId, createdStage: 'B0',
    controllerVersion: CONTROLLER_VERSION, brokerPolicyVersion: BROKER_POLICY_VERSION,
    imageTransportVersion: IMAGE_TRANSPORT_VERSION,
    model: CALIBRATION_MODEL, schema: 'contentVisionEnrichment/1',
    promptHashes,
    selection: works.map(w => ({ id: w.id, cohort: w.cohort, fameBand: w.fameBand, regionGroup: w.regionGroup, guideStatus: w.guideStatus })),
    images: imagePrep.map(p => ({ id: p.id, ok: p.ok, imgSha256: p.ok ? p.imgSha256 : null, ext: p.ok ? p.ext : null, reason: p.ok ? null : p.reason })),
    plan: planCalls(works),
  };
  m.manifestSha256 = sha256(stableJson(m));
  return m;
}

// ---- Synthetic fixture: schema-valid B1..B4 bodies to exercise B0→B4 capture + packet with NO model call. ----
export function syntheticFixture() {
  const axes = ['when', 'where', 'medium', 'style', 'artist', 'format'];
  const evidence = Object.fromEntries(axes.map((ax, i) => [ax, [{ evidenceId: `ev_${ax}`, feature: `${ax} feature`, why: `visible ${ax} cue`, bbox: i % 2 ? null : [0.1, 0.1, 0.2, 0.2], confidence: 0.5 }]]));
  const vtext = ['pose', 'gesture', 'gaze', 'bodyOrientation', 'relationships', 'tone', 'format', 'composition', 'viewpoint', 'subject', 'objectFunction', 'material', 'surface', 'technique', 'condition', 'damage', 'signature', 'inscriptions', 'photoArtifacts'];
  const visual = { ...Object.fromEntries(vtext.map(k => [k, `${k} description`])), figures: [{ who: 'a figure', role: 'subject' }], palette: { colors: ['brown', 'ochre'], character: 'warm' }, lighting: 'diffuse', iconography: ['book'], delights: [{ delightId: 'd1', note: 'corner detail', bbox: [0.8, 0.8, 0.1, 0.1], confidence: 0.5 }] };
  const source = { sourceId: 's1', url: 'https://example.org/catalog', title: 'Catalog entry', retrievedAt: '2026-09-02T00:00:00Z' };
  const catalog = { mediumFull: 'oil on canvas', anonReason: { notApplicable: true, reason: 'attributed' }, living: false, movementSuggestion: 'Baroque', styleKind: 'movement', provenanceNote: { notApplicable: true, reason: 'n/a' }, displacementCue: { notApplicable: true, reason: 'n/a' }, sensitivity: [] };
  const tags = { controlled: ['portrait'], free: ['seated'] };
  const B1 = { imageFitness: { ok: true, issue: 'none', quality: 'good', framing: 'ok', mediumLegible: true, imageState: 'usable', reason: '', suggestedUrl: null }, playable: true, playableReason: 'clear anchors', noPinsVerdict: false, seen: 'A seated figure.', evidence, visual, tags, noteCandidates: [{ noteId: 'n1', head: 'The material', body: 'Visible brushwork.', pin: { x: 40, y: 50 }, role: 'technique', confidence: 0.6, evidenceRef: 'ev_medium' }], researchQuestions: [{ questionId: 'q1', topic: 'maker', evidenceId: 'ev_artist' }], uncertainty: 'Identity unclear.' };
  const B2 = { catalog, factChecks: [{ claimId: 'c1', claim: 'Oil on canvas.', verdict: 'supported', confidence: 0.8, sources: [source] }], guideAnswers: Array.from({ length: 5 }, (_, i) => ({ questionId: `g${i + 1}`, q: `Context question ${i + 1}?`, a: 'A sourced contextual answer.', kind: 'context', evidenceRef: null, sourceRefs: ['s1'] })), targetedVerificationRequests: [{ requestId: 'r1', claimId: 'c1', whatToLocate: 'the signature lower right' }], uncertainty: '' };
  const B3 = { verifications: [{ requestId: 'r1', found: true, bbox: [0.8, 0.8, 0.1, 0.1], note: 'mark visible', confidence: 0.7 }], uncertainty: '' };
  const B4 = {
    imageState: 'usable', playable: true, playableReason: 'specific clues', catsAdjustments: { removeMedium: false },
    dispositions: [
      { component: 'why', disposition: 'revise', reason: 'sharper one-liner' }, { component: 'cues', disposition: 'keep', reason: 'still accurate' },
      { component: 'notes', disposition: 'revise', reason: 'reground on a visible feature' }, { component: 'hotspots', disposition: 'add', reason: 'add a diagnostic pin' },
      { component: 'guide', disposition: 'add', reason: 'add a technique question' }, { component: 'imageState', disposition: 'keep', reason: 'usable' },
      { component: 'playability', disposition: 'keep', reason: 'clear anchors' },
    ],
    proposedWhy: 'A ram-headed composite figure that teaches iconographic reading.',
    proposedCues: ['ram head → composite deity', 'gilded limbs → precious-metal leaf'],
    notes: Array.from({ length: 5 }, (_, i) => ({ noteId: `pn${i + 1}`, head: `Note ${i + 1}`, body: 'Grounded observation of a visible feature.', pin: { x: 20 + i, y: 30 + i }, role: 'diagnostic', evidenceRef: 'ev_when', sourceRefs: ['s1'] })),
    hotspots: [{ hotspotId: 'h1', observationId: 'pn1', x: 20, y: 20, region: null, rank: 1, role: 'diagnostic', conciseText: 'Pointed arch', deepText: 'Anchors the longer lesson.', evidenceRef: 'ev_when', confidence: 0.8, sourceDependent: false }],
    guide: Array.from({ length: 5 }, (_, i) => ({ questionId: `pg${i + 1}`, q: `Why does detail ${i + 1} matter?`, a: 'Links visible evidence to sourced context.', kind: i < 3 ? 'image' : 'context', evidenceRef: i < 3 ? ['ev_when', 'ev_where', 'ev_medium'][i] : null, sourceRefs: ['s1'] })),
    richDescriptors: { visual, catalog, tags }, evidence, sources: [source], corrections: { consequential: [] }, conflicts: [], uncertainty: '',
  };
  // B4Delta: the COMPACT editorial delta the model actually emits (VSD-022); it assembles into a valid full
  // record (like B4 above) using B1's grounding ids (ev_*/d1) + B2's source id (s1).
  const B4Delta = {
    version: 'contentVisionB4Delta/3',
    imageState: 'usable', playable: true, playableReason: 'clear anchors', removeMedium: false,
    why: { action: 'revise', text: 'A ram-headed composite figure that rewards close looking.' },
    cues: { action: 'replace', items: ['ram head → composite deity'] },
    notes: Array.from({ length: 5 }, (_, i) => ({ action: 'add', ref: 'n1', head: `Delta note ${i + 1}`, body: 'A grounded observation of a visible feature.', role: 'diagnostic', evidenceRef: 'ev_when', sourceRefs: ['s1'] })),
    hotspots: [{ action: 'add', ref: 'n1', pinRef: 'n1', rank: 1, conciseText: 'Pointed arch', deepText: 'Anchors the longer lesson.', role: 'diagnostic', evidenceRef: 'ev_medium', sourceDependent: false }],
    guide: Array.from({ length: 5 }, (_, i) => ({ action: 'add', ref: null, q: `Why does detail ${i + 1} matter?`, a: 'Links visible evidence to sourced context.', kind: i < 3 ? 'image' : 'context', evidenceRef: i < 3 ? ['ev_when', 'ev_where', 'ev_medium'][i] : null, sourceRefs: ['s1'] })),
    corrections: [{ field: 'medium', from: 'oil', to: 'tempera', evidenceRef: 'ev_when', sourceRefs: ['s1'], confidence: 0.8 }],
    conflicts: [],
    grounding: {
      components: [
        ...Array.from({ length: 5 }, (_, i) => ({ target: `note:${i}`, claimRefs: ['c1'], observationRefs: ['ev_when'] })),
        { target: 'hotspot:0', claimRefs: ['c1'], observationRefs: ['ev_medium'] },
        ...Array.from({ length: 5 }, (_, i) => ({ target: `guide:${i}`, claimRefs: ['c1'], observationRefs: i < 3 ? [['ev_when', 'ev_where', 'ev_medium'][i]] : [] })),
      ],
      conflicts: [],
      openClaims: [],
    },
  };
  return { workId: 'fixture-synthetic-1', trustedCatalog: { title: 'Synthetic', artist: 'Anon', date: '1650', place: 'Somewhere', medium: 'oil', style: 'Baroque', catalogId: 'fixture-synthetic-1' }, bodies: { B1, B2, B3, B4, B4Delta }, contexts: { B2: { evidenceIds: axes.map(a => `ev_${a}`) }, B3: { requestIds: ['r1'] } } };
}

// ---- Live per-work orchestration (B1→B2→B3?→B4). Deterministic control flow with INJECTED spawn +
// capture so it is unit-testable without any model call. A failed stage blocks that work's dependents but
// never corrupts other works. `spawnStage(stage,{argv,imageFile})` returns raw stdout; `capture(...)`
// validates+persists and throws on an invalid body; `hasCompletion(stage)` supports resume. ----
export async function runWorkStages({ workId, catalog, legacy = null, imgSha256, ext, prompts, runtimeVersion, spawnStage, capture, loadCompletion = () => null, skipB4 = false }) {
  // Calibration: B1 (image, Read tool) → CONDITIONAL B2 (no-image research) → CONDITIONAL B3 (image, only on
  // B2 targeted requests) → compact B4 synthesis (no image, only when B2 ran).
  const status = { B1: 'pending', B2: 'not-requested', B3: 'not-requested', B4: 'not-requested' };
  const bodies = {};
  const retries = {}; // per-stage { attempts, errors } for a validation-only retry (raw transcripts kept by spawnStage)
  const hydration = {}; // per-stage deterministic-hydration record (B4 delta -> assembled full record)
  const legacyInput = legacyContentInput(legacy);
  const imageFile = neutralImageFile(imgSha256, ext);
  // The completion is bound to the EXACT effective prompt (base + dynamic input), the image-transport version,
  // and the raw transcript SHA returned by spawnStage. spawnStage returns { raw, transcriptSha256 } and has
  // already verified the required tool-use evidence (Read of the exact image for B1; web events for B2).
  // validationRetries: on a response that COMPLETED NORMALLY (process/web/model gates passed) but FAILED strict
  // local schema/cross-reference validation, retry once with a FRESH process, same prompt/schema/model/inputs.
  // A process/web/model failure is NOT retried (it propagates). The validator is never weakened or repaired around.
  // hydrate (B4 only): transform the raw model output (a compact editorial DELTA) into the full record to
  // capture, deterministically from the validated B1/B2/B3 rows. The raw delta stays in the transcript
  // (SHA-bound); hydrate returns { body, record } and its record is surfaced for a sidecar. It may throw
  // (assemble/strict-validate failure), which is handled exactly like a validation failure.
  const run = async (stage, { imageFile: img = null, promptText, context = {}, validationRetries = 0, hydrate = null }) => {
    // Pass the already-loaded upstream bodies + legacy so a resumed B4 completion can be checked for exact
    // delta→body rehydration (item 2). B1/B2/B3 evidence needs no bodies.
    const existing = await loadCompletion(stage, { promptHash: sha256(promptText), context, bodies, legacy }); // resume verifies bindings + evidence
    if (existing) { status[stage] = 'complete'; return existing; }
    const command = buildStageCommand({ stage, promptText, imageFile: img });
    const producer = producerEvidence(stage, { runtimeVersion });
    let lastErr;
    for (let attempt = 0; attempt <= validationRetries; attempt++) {
      const spawned = await spawnStage(stage, { command, imageFile: img }); // fresh process each attempt; process/web/model failure propagates (no retry)
      const rawModel = typeof spawned === 'string' ? spawned : spawned.raw;
      const transcriptSha256 = typeof spawned === 'string' ? null : spawned.transcriptSha256;
      const trusted = { workId, imgSha256, promptHash: sha256(promptText), brokerPolicyVersion: BROKER_POLICY_VERSION,
        imageTransportVersion: IMAGE_TRANSPORT_VERSION, transcriptSha256 };
      try {
        let raw = rawModel;
        if (hydrate) { const hy = hydrate(rawModel); raw = hy.body; hydration[stage] = hy.record; } // deterministic assemble; may throw
        const cap = await capture({ stage, rawResponse: raw, trusted, producer, context });
        if (attempt > 0) (retries[stage] = retries[stage] || { attempts: 0, errors: [] }).attempts = attempt; // count prior failed attempts
        status[stage] = 'complete';
        return cap.completion.body;
      } catch (validationErr) {
        lastErr = validationErr;
        const r = (retries[stage] = retries[stage] || { attempts: 0, errors: [] });
        r.attempts = attempt + 1; r.errors.push(String(validationErr.message).slice(0, 400));
        if (attempt >= validationRetries) throw validationErr; // out of retries -> genuine failure
      }
    }
    throw lastErr; // unreachable
  };
  try {
    // B1 prompt explicitly names the confined image file for the Read tool (the only per-work dynamic part).
    const b1Prompt = `${prompts.B1}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile} to view the artwork, then inventory ONLY what you actually see. If Read fails or returns no image, set imageFitness.ok=false and do not invent content.`;
    bodies.B1 = await run('B1', { imageFile, promptText: b1Prompt });
  } catch (e) { status.B1 = `failed:${e.message.slice(0, 80)}`; return { status, bodies, retries }; }
  const b2 = b2Plan(bodies.B1, legacy);
  if (!b2.run) return { status, bodies, retries }; // no research needed and no legacy to check -> stop after B1
  status.B2 = 'requested';
  try {
    const b2in = b2InputFor(workId, catalog, bodies.B1);
    // B2 gets allowlisted image signals AND the existing site content to audit — but no image and no image prose.
    // One validation-only retry (owner-authorized): a normally-completed B2 that fails strict validation reruns once.
    bodies.B2 = await run('B2', { promptText: `${prompts.B2}\n\nCATALOG+SIGNALS:\n${JSON.stringify(b2in)}\n\nEXISTING CONTENT:\n${JSON.stringify(legacyInput)}`, context: { evidenceIds: b2in.visibleSignals.map(s => s.evidenceId) }, validationRetries: 1 });
  } catch (e) { status.B2 = `failed:${e.message.slice(0, 80)}`; return { status, bodies, retries }; } // B2 failed after retry: retain B1, needs attention
  // B3: conditional targeted second look — ONLY the concrete visual questions B2 raised (image, Read tool).
  const b3 = b3Plan(bodies.B2);
  if (b3.dropped) status.b3Dropped = b3.dropped; // no silent cap: surface requests dropped by MAX_B3_REQUESTS
  if (b3.run) {
    status.B3 = 'requested';
    try {
      const b3Prompt = `${prompts.B3}\n\nThe working directory contains exactly one image file: ./${imageFile}\nCall the Read tool on ./${imageFile}, then answer ONLY these targeted requests.\n\nLOCATE:\n${JSON.stringify(b3.requests)}`;
      bodies.B3 = await run('B3', { imageFile, promptText: b3Prompt, context: { requestIds: b3.requestIds } });
    } catch (e) { status.B3 = `failed:${e.message.slice(0, 80)}`; } // a failed second look does not block synthesis
  }
  // --through-b3 / --skip-b4 execution mode: bank B1–B3 tonight; leave B4 for tomorrow's corrected run.
  // Pure runtime skip — B0–B3 checkpoints are untouched and remain consumable by a later B4-only pass.
  if (skipB4) { status.B4 = 'skipped:through-b3'; return { status, bodies, retries }; }
  // B4 (VSD-022): the model emits a COMPACT editorial delta; the controller deterministically ASSEMBLES the
  // full record from validated B1/B2/B3 + legacy and runs the UNCHANGED strict validator on the result.
  status.B4 = 'requested';
  try {
    const compact = compactB4DeltaInput({ b1: bodies.B1, b2: bodies.B2, b3: bodies.B3 || null, legacyInput });
    bodies.B4 = await run('B4', {
      promptText: `${prompts.B4}\n\nINPUTS:\n${JSON.stringify(compact)}`,
      hydrate: rawDelta => {
        let delta; try { delta = JSON.parse(rawDelta); } catch { throw new Error('B4 delta is not valid JSON'); }
        const asm = assembleAndValidateB4({ delta, b1: bodies.B1, b2: bodies.B2, b3: bodies.B3 || null, legacy });
        if (!asm.ok) throw new Error(`B4 ${asm.stage}: ${(asm.errors || []).slice(0, 3).join('; ')}`);
        return { body: JSON.stringify(asm.body), record: { assembler: asm.deltaVersion, b4ValidationContractVersion: B4_VALIDATION_CONTRACT_VERSION, deltaSha256: asm.deltaSha256, assembledBodySha256: asm.bodySha256, transcriptBoundDelta: true } };
      },
    });
  } catch (e) { status.B4 = `failed:${e.message.slice(0, 80)}`; }
  return { status, bodies, retries, hydration };
}

// ---- Compact B4 DELTA input: what the model SEES to author an editorial delta. It carries the referenceable
// B1 grounding namespace (evidence/delight ids WITH short descriptions), B1 note/hotspot candidates, B2
// verified findings + source registry, B3 verifications, and legacy content — but NO coordinates and nothing
// the model must reproduce. The controller owns and hydrates every registry. ----
export function compactB4DeltaInput({ b1, b2, b3, legacyInput }) {
  const g = b1Grounding(b1);
  const evidence = [...g.evidence.entries()].map(([id, e]) => ({ id, axis: e.axis, feature: e.feature }));
  const delights = [...g.delights.entries()].map(([id, d]) => ({ id, note: d.note }));
  const b1Candidates = [...g.candidates.entries()].map(([id, c]) => ({ id, head: c.head, body: c.body, role: c.role, evidenceRef: c.evidenceRef }));
  const sources = []; const seen = new Set();
  for (const f of (b2?.factChecks || [])) for (const s of (f.sources || [])) if (s?.sourceId && !seen.has(s.sourceId)) { seen.add(s.sourceId); sources.push({ id: s.sourceId, title: s.title, url: s.url }); }
  const b2c = b2 ? {
    catalog: b2.catalog ?? null,
    factChecks: (b2.factChecks || []).map(f => ({ claimId: f.claimId, claim: f.claim, verdict: f.verdict, confidence: f.confidence, sourceRefs: (f.sources || []).map(s => s.sourceId) })),
    guideAnswers: (b2.guideAnswers || []).map(x => ({ q: x.q, a: x.a, kind: x.kind, sourceRefs: x.sourceRefs, evidenceRef: x.evidenceRef })),
    sources,
  } : null;
  const requestClaims = new Map((b2?.targetedVerificationRequests || []).map(r => [r.requestId, r.claimId]));
  const b3c = b3 ? { verifications: (b3.verifications || []).map(v => ({ observationId: `b3:${v.requestId}`, requestId: v.requestId, claimId: requestClaims.get(v.requestId) ?? null, found: v.found, note: v.note, confidence: v.confidence })) } : null;
  // Legacy content carries explicit ids so the model can reference an existing item by ref (legacy-n1, etc.).
  const lg = legacyInput || {};
  const legacy = {
    why: lg.why ?? null,
    cues: (lg.cues || []).map((c, i) => ({ id: `legacy-c${i + 1}`, text: c })),
    notes: (lg.notes || []).map((n, i) => ({ id: `legacy-n${i + 1}`, head: n.head, body: n.body })),
    guide: (lg.guide || []).map((q, i) => ({ id: `legacy-g${i + 1}`, q: q.q, a: q.a })),
    hotspots: (lg.hotspots || []).map((h, i) => ({ id: `legacy-h${i + 1}`, n: h.n })),
    counts: lg.counts ?? null,
  };
  return {
    version: 'passBB4DeltaInput/4',
    imageState: b1?.imageFitness?.imageState ?? null, playable: b1?.playable ?? null, seen: b1?.seen ?? null,
    grounding: { evidence, delights }, b1Candidates, b2: b2c, b3: b3c, legacy,
  };
}

// Re-export for the CLI/tests.
export { validateStageBody };
