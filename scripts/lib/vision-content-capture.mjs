// Deterministic-controller capture for rich Pass B stage stdout. Model processes
// never receive a filesystem handle. The controller stores exact raw bytes and a
// validated provenance envelope under neutral, hash-derived names.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildStageCompletion, validateStageCompletion } from './vision-content-schema.mjs';
import { sha256, stableJson } from './vision-legacy.mjs';

function safeDir(runDir, child) {
  const root = resolve(runDir);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('runDir must be a real directory');
  const realRoot = realpathSync(root);
  const target = join(realRoot, child);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const realTarget = realpathSync(target);
  if (!realTarget.startsWith(`${realRoot}${sep}`) || lstatSync(realTarget).isSymbolicLink()) throw new Error('capture directory escapes runDir');
  return realTarget;
}

// The single source of truth for a completion's on-disk key (stage + NUL + workId). Every reader/writer of
// a completion path MUST use this so the separator can never drift.
export function completionKey(stage, workId) { return sha256(`${stage}\0${workId}`).slice(0, 32); }

export function captureStageCompletion({ runDir, stage, rawResponse, trusted, producer, createdAt, context = {} }) {
  const completion = buildStageCompletion({ stage, rawResponse, trusted, producer, createdAt, context });
  const rawDir = safeDir(runDir, 'raw');
  const completionDir = safeDir(runDir, 'completions');
  const rawPath = join(rawDir, `${completion.rawResponseSha256}.json`);
  if (existsSync(rawPath)) {
    if (sha256(readFileSync(rawPath, 'utf8')) !== completion.rawResponseSha256) throw new Error('existing raw response hash mismatch');
  } else writeFileSync(rawPath, rawResponse, { flag: 'wx', mode: 0o600 });
  const key = completionKey(stage, trusted.workId);
  const completionPath = join(completionDir, `${stage.toLowerCase()}-${key}.json`);
  writeFileSync(completionPath, `${JSON.stringify(completion, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  return { completionPath, rawPath, completion };
}

export function verifyCapturedStage({ completionPath, runDir, trusted, producer, context = {} }) {
  const completionDir = safeDir(runDir, 'completions');
  const resolvedCompletion = resolve(completionPath);
  if (!resolvedCompletion.startsWith(`${completionDir}${sep}`) || !existsSync(resolvedCompletion)
    || lstatSync(resolvedCompletion).isSymbolicLink()) return { ok: false, errors: ['completion path confinement'] };
  let completion;
  try { completion = JSON.parse(readFileSync(resolvedCompletion, 'utf8')); }
  catch { return { ok: false, errors: ['completion JSON'] }; }
  const checked = validateStageCompletion(completion, { ...context, trusted, producer });
  if (!checked.ok) return checked;
  const rawPath = join(safeDir(runDir, 'raw'), `${completion.rawResponseSha256}.json`);
  if (!existsSync(rawPath) || lstatSync(rawPath).isSymbolicLink()) return { ok: false, errors: ['raw response missing'] };
  const raw = readFileSync(rawPath, 'utf8');
  const errors = [];
  if (sha256(raw) !== completion.rawResponseSha256) errors.push('raw response hash');
  try {
    const reparsed = JSON.parse(raw);
    if (stableJson(reparsed) !== stableJson(completion.body)) errors.push('raw response/body mismatch');
  } catch { errors.push('raw response JSON'); }
  return errors.length ? { ok: false, errors } : { ok: true, value: completion };
}
