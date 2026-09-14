import { createHash } from "node:crypto";

export const FAILURE_VERSION = "aic-blob-failures/2";
export const POOL_PREFIX = "window.ARTEFACTUM_POOL = ";
export const AIC_BLOB_HOST = "a5qzyud92a17tezg.public.blob.vercel-storage.com";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const isAicDirect = work => /^aic\d+$/.test(work?.id || "") && /www\.artic\.edu\/iiif\//i.test(work?.img || "");

export function parsePositiveInt(value, { name, fallback, max = Number.MAX_SAFE_INTEGER }) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a positive integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`${name} must be between 1 and ${max}`);
  return n;
}

export function parsePoolModule(raw) {
  if (!raw.startsWith(POOL_PREFIX)) throw new Error(`pool.js must start with ${JSON.stringify(POOL_PREFIX)}`);
  const end = raw.lastIndexOf("]");
  if (end < POOL_PREFIX.length || !/^;\s*$/.test(raw.slice(end + 1))) throw new Error("pool.js must contain one canonical array assignment");
  const pool = JSON.parse(raw.slice(POOL_PREFIX.length, end + 1));
  if (!Array.isArray(pool)) throw new Error("pool.js assignment is not an array");
  return { pool, suffix: raw.slice(end + 1) };
}

export function serializePoolModule(pool, suffix = ";\n") {
  if (!Array.isArray(pool) || !/^;\s*$/.test(suffix)) throw new Error("invalid pool serialization input");
  return `${POOL_PREFIX}${JSON.stringify(pool)}${suffix}`;
}

export function normalizeFailureState(value) {
  const state = { version: FAILURE_VERSION, updatedAt: null, permanent: {}, transient: {} };
  if (value == null) return state;
  // Preserve an older string-array failure file as operator-visible history without treating any entry
  // as a permanent failure. The old script could not distinguish Cloudflare blocks from object failures.
  if (Array.isArray(value)) {
    if (value.length) state.legacyUnclassified = value.map(String);
    return state;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== FAILURE_VERSION) {
    throw new Error(`unsupported AIC failure ledger (expected ${FAILURE_VERSION} or the legacy array)`);
  }
  const plainMap = map => map && typeof map === "object" && !Array.isArray(map);
  if (!plainMap(value.permanent) || !plainMap(value.transient)) throw new Error("malformed AIC failure ledger maps");
  for (const [kind, map] of [["permanent", value.permanent], ["transient", value.transient]]) {
    for (const [id, record] of Object.entries(map)) {
      if (!/^aic\d+$/.test(id) || !record || typeof record !== "object" || Array.isArray(record)
        || record.id !== id || typeof record.sourceUrl !== "string" || !record.sourceUrl) {
        throw new Error(`malformed ${kind} AIC failure record for ${id}`);
      }
    }
  }
  return value;
}

export function jitterMs(minMs, maxMs, random = Math.random) {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs < 0 || maxMs < minMs) throw new Error("invalid jitter range");
  return Math.floor(minMs + random() * (maxMs - minMs + 1));
}

export function classifyHttpFailure(status) {
  if (status === 403) return "403-candidate";
  if ([408, 425, 429, 503].includes(status) || status >= 500) return "transient";
  if (status >= 400 && status < 500) return "permanent";
  return "transient";
}

const isJpeg = bytes => bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export async function fetchAicImage(url, {
  fetchImpl = fetch,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random,
  attempts = 3,
  retryBaseMs = 15_000,
  retryJitterMs = 5_000,
  timeoutMs = 90_000,
  headers = {},
} = {}) {
  let last = { status: null, reason: "not-attempted", category: "transient" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!type.startsWith("image/") || bytes.length < 1_000 || !isJpeg(bytes)) {
          last = { status: response.status, reason: `invalid-image-response type=${type || "missing"} bytes=${bytes.length}`, category: "transient" };
        } else {
          return { ok: true, status: response.status, bytes, sha256: sha256(bytes), attempts: attempt, contentType: type };
        }
      } else {
        last = { status: response.status, reason: `download HTTP ${response.status}`, category: classifyHttpFailure(response.status) };
      }
    } catch (error) {
      last = { status: null, reason: `network ${error?.name || "error"}: ${error?.message || error}`, category: "transient" };
    }
    const retryable = last.category === "transient" || last.category === "403-candidate";
    if (!retryable || attempt === attempts) return { ok: false, ...last, attempts: attempt };
    const delay = retryBaseMs * (2 ** (attempt - 1)) + jitterMs(0, retryJitterMs, random);
    await sleepImpl(delay);
  }
  return { ok: false, ...last, attempts };
}

export function verifiedBlobUrl(value, expectedHost = null) {
  try {
    const url = new URL(value);
    const publicBlob = /\.public\.blob\.vercel-storage\.com$/i.test(url.hostname);
    const rightStore = !expectedHost || url.hostname.toLowerCase() === expectedHost.toLowerCase();
    return url.protocol === "https:" && publicBlob && rightStore ? url : null;
  } catch { return null; }
}

export async function verifyBlobBytes(urlValue, expectedSha, {
  fetchImpl = fetch,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 3,
  retryBaseMs = 2_000,
  timeoutMs = 90_000,
  expectedHost = null,
} = {}) {
  const url = verifiedBlobUrl(urlValue, expectedHost);
  if (!url || !/^[0-9a-f]{64}$/.test(expectedSha || "")) return { ok: false, reason: "invalid blob verification input", attempts: 0 };
  url.searchParams.set("gesso_verify", expectedSha);
  let reason = "not-attempted";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: "image/jpeg", "Cache-Control": "no-cache" }, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const actual = sha256(bytes);
        if (actual === expectedSha) return { ok: true, attempts: attempt, bytes: bytes.length, sha256: actual };
        reason = `blob hash mismatch expected=${expectedSha} actual=${actual}`;
      } else reason = `blob verification HTTP ${response.status}`;
    } catch (error) { reason = `blob verification ${error?.name || "error"}: ${error?.message || error}`; }
    if (attempt < attempts) await sleepImpl(retryBaseMs * (2 ** (attempt - 1)));
  }
  return { ok: false, reason, attempts };
}

export function clearFailure(state, id) {
  delete state.permanent[id];
  delete state.transient[id];
}

function baseFailure(work, result, now, prior = null) {
  return {
    id: work.id,
    title: work.title || "",
    sourceUrl: work.img,
    phase: result.phase || "source",
    status: result.status ?? null,
    category: result.category,
    reason: result.reason,
    attempts: result.attempts || 1,
    firstSeenAt: prior?.firstSeenAt || now,
    lastSeenAt: now,
  };
}

export function recordSettledFailure(state, work, result, {
  now,
  runId,
  runProvedAicReachable,
  transientRetryMs = 60 * 60 * 1_000,
} = {}) {
  clearFailure(state, work.id);
  const prior = result.category === "403-candidate"
    ? (state._prior403?.[work.id] || null)
    : null;
  if (result.category === "permanent") {
    state.permanent[work.id] = { ...baseFailure(work, result, now), resolution: "replace-or-supply-a-new-source-url" };
    return "permanent";
  }
  if (result.category === "403-candidate" && runProvedAicReachable) {
    const priorRuns = Array.isArray(prior?.confirmedReachableRuns) ? prior.confirmedReachableRuns : [];
    const confirmedReachableRuns = [...new Set([...priorRuns, runId])];
    const record = { ...baseFailure(work, result, now, prior), confirmedReachableRuns };
    if (confirmedReachableRuns.length >= 2) {
      state.permanent[work.id] = { ...record, category: "permanent-403", resolution: "replace-or-supply-a-new-source-url" };
      return "permanent";
    }
    state.transient[work.id] = { ...record, nextRetryAt: new Date(Date.parse(now) + transientRetryMs).toISOString() };
    return "transient";
  }
  const record = { ...baseFailure(work, result, now, prior), globalBlockSuspected: result.category === "403-candidate" && !runProvedAicReachable };
  state.transient[work.id] = { ...record, nextRetryAt: new Date(Date.parse(now) + transientRetryMs).toISOString() };
  return "transient";
}

export function beginFailureSettlement(state) {
  // Keep the previous confirmed 403 history available while rebuilding the active maps this run.
  state._prior403 = { ...state.transient, ...state.permanent };
  return state;
}

export function endFailureSettlement(state, now) {
  delete state._prior403;
  state.updatedAt = now;
  return state;
}

export function workIsDeferred(work, state, nowMs = Date.now()) {
  const permanent = state.permanent[work.id];
  if (permanent?.sourceUrl === work.img) return { deferred: true, reason: "permanent" };
  const transient = state.transient[work.id];
  if (transient?.sourceUrl === work.img && Date.parse(transient.nextRetryAt) > nowMs) return { deferred: true, reason: "backoff" };
  return { deferred: false, reason: null };
}
