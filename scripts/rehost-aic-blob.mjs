// Re-host AIC IIIF images to Vercel Blob without hammering AIC's Cloudflare edge.
//
// Safety properties:
// - one source request at a time, with a randomized 5–15 second inter-work pause;
// - bounded exponential retry for transient responses;
// - verified Blob re-download + SHA-256 match before pool.js changes;
// - atomic pool/state writes after each successful migration;
// - resumable transient backoff and conservative 403 classification;
// - exact preservation of the legacy `window.ARTEFACTUM_POOL = ` wrapper.
//
// Requires Node 18+ and BLOB_READ_WRITE_TOKEN. Run from the repository root:
//   /opt/homebrew/bin/node scripts/rehost-aic-blob.mjs --limit=10
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { put } from "@vercel/blob";
import { writeAtomic } from "./lib/static-module.mjs";
import {
  AIC_BLOB_HOST,
  FAILURE_VERSION,
  beginFailureSettlement,
  clearFailure,
  endFailureSettlement,
  fetchAicImage,
  isAicDirect,
  jitterMs,
  normalizeFailureState,
  parsePoolModule,
  parsePositiveInt,
  recordSettledFailure,
  serializePoolModule,
  verifiedBlobUrl,
  verifyBlobBytes,
  workIsDeferred,
} from "./lib/aic-blob-migration.mjs";

const POOL_PATH = "data/pool.js";
const FAILURE_PATH = "data/incoming/aic-blob-fails.json";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const INTER_WORK_MIN_MS = 5_000;
const INTER_WORK_MAX_MS = 15_000;
const TRANSIENT_RETRY_MS = 60 * 60 * 1_000;
const SOURCE_ATTEMPTS = 3;
const BLOCK_WAVE_LIMIT = 3;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function usage() {
  console.log(`Usage: /opt/homebrew/bin/node scripts/rehost-aic-blob.mjs [options]

Options:
  --limit=N                    Attempt at most N network migrations (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})
  --dry-run                    Inspect eligibility without token, network, or writes
  --mark-permanent=ID[,ID...] Record an owner-confirmed hard failure without requesting it
  --help                       Show this help

A 403 is not automatically permanent: Cloudflare also uses it for temporary machine-wide blocks.
The script requires the same URL to fail in two separate AIC-reachable runs before classifying it
as permanent. --mark-permanent is only for a URL already verified independently by the owner.`);
}

function parseArgs(argv) {
  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  const markPermanent = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true, limit, dryRun, markPermanent };
    if (arg === "--dry-run" || arg === "--dry") { dryRun = true; continue; }
    if (arg === "--limit") {
      limit = parsePositiveInt(argv[++i], { name: "--limit", fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = parsePositiveInt(arg.slice("--limit=".length), { name: "--limit", fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
      continue;
    }
    if (arg === "--mark-permanent") {
      const value = argv[++i];
      if (!value) throw new Error("--mark-permanent requires an AIC id");
      for (const id of value.split(",")) markPermanent.add(id.trim());
      continue;
    }
    if (arg.startsWith("--mark-permanent=")) {
      for (const id of arg.slice("--mark-permanent=".length).split(",")) markPermanent.add(id.trim());
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }
  for (const id of markPermanent) {
    if (!/^aic\d+$/.test(id)) throw new Error(`--mark-permanent requires an id like aic198911 (got ${JSON.stringify(id)})`);
  }
  return { help: false, limit, dryRun, markPermanent };
}

function loadToken() {
  const envText = [".env.local", ".env"]
    .filter(existsSync)
    .map(path => readFileSync(path, "utf8"))
    .join("\n");
  const token = process.env.BLOB_READ_WRITE_TOKEN
    || (envText.match(/^BLOB_READ_WRITE_TOKEN\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not found in the environment, .env.local, or .env");
  return token;
}

function loadFailureState() {
  if (!existsSync(FAILURE_PATH)) return normalizeFailureState(null);
  let value;
  try { value = JSON.parse(readFileSync(FAILURE_PATH, "utf8")); }
  catch (error) { throw new Error(`refusing to replace unreadable ${FAILURE_PATH}: ${error.message}`); }
  return normalizeFailureState(value);
}

function writeFailureState(state) {
  const temp = `${FAILURE_PATH}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: "w" });
  renameSync(temp, FAILURE_PATH);
}

function ownerPermanentRecord(work, now) {
  return {
    id: work.id,
    title: work.title || "",
    sourceUrl: work.img,
    phase: "source",
    status: 403,
    category: "owner-confirmed-permanent-403",
    reason: "owner independently confirmed the unchanged source URL returns a hard 403",
    attempts: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    resolution: "replace-or-supply-a-new-source-url",
  };
}

function uploadFailure(phase, error) {
  return {
    ok: false,
    phase,
    status: null,
    category: "transient",
    reason: `${phase}: ${error?.message || error}`,
    attempts: 1,
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const args = parseArgs(process.argv.slice(2));
if (args.help) { usage(); process.exit(0); }

const rawPool = readFileSync(POOL_PATH, "utf8");
const { pool, suffix } = parsePoolModule(rawPool);
let expectedPoolRaw = rawPool;
// Prove a no-op serialization cannot alter anything before enabling writes.
if (serializePoolModule(pool, suffix) !== rawPool) {
  throw new Error("refusing to run: pool.js is not in the exact canonical JSON assignment format");
}

const failureState = loadFailureState();
const nowMs = Date.now();
const allTargets = pool.filter(isAicDirect);
const byId = new Map(allTargets.map(work => [work.id, work]));

for (const id of args.markPermanent) {
  if (!byId.has(id)) throw new Error(`${id} is not a current AIC-direct migration target`);
}

// A source URL change is the repair signal: old permanent/backoff records must not suppress it.
for (const work of pool) {
  const permanent = failureState.permanent[work.id];
  const transient = failureState.transient[work.id];
  if ((permanent && permanent.sourceUrl !== work.img) || (transient && transient.sourceUrl !== work.img)) clearFailure(failureState, work.id);
}

const wouldMark = [...args.markPermanent].map(id => byId.get(id));
const markedIds = new Set(wouldMark.map(work => work.id));
const deferred = { permanent: 0, backoff: 0 };
const eligible = [];
for (const work of allTargets) {
  if (markedIds.has(work.id)) continue;
  const hold = workIsDeferred(work, failureState, nowMs);
  if (hold.deferred) deferred[hold.reason]++;
  else eligible.push(work);
}
const selected = eligible.slice(0, args.limit);

console.log(`AIC-direct targets: ${allTargets.length}`);
console.log(`Eligible now: ${eligible.length} | selected this run: ${selected.length}/${args.limit}`);
console.log(`Deferred: permanent ${deferred.permanent} | transient backoff ${deferred.backoff}`);
if (wouldMark.length) console.log(`Owner-confirmed permanent this run: ${wouldMark.map(work => work.id).join(", ")}`);

if (args.dryRun) {
  console.log("DRY RUN — no token read, network request, upload, or file write");
  process.exit(0);
}

const token = loadToken();
const runId = `aic-blob-${new Date().toISOString()}-${randomUUID()}`;
const startedAt = new Date().toISOString();
for (const work of wouldMark) {
  clearFailure(failureState, work.id);
  failureState.permanent[work.id] = ownerPermanentRecord(work, startedAt);
}
if (wouldMark.length) {
  failureState.updatedAt = startedAt;
  writeFailureState(failureState);
}

let migrated = 0;
let sourceSuccesses = 0;
let attempted = 0;
let consecutiveWaveBlocks = 0;
let circuitBroken = false;
const outcomes = [];

for (let index = 0; index < selected.length; index++) {
  const work = selected[index];
  attempted++;
  console.error(`[${attempted}/${selected.length}] ${work.id} ${(work.title || "").slice(0, 70)}`);
  const source = await fetchAicImage(work.img, {
    attempts: SOURCE_ATTEMPTS,
    headers: {
      "User-Agent": UA,
      Accept: "image/jpeg,image/*;q=0.9,*/*;q=0.1",
      Referer: "https://www.artic.edu/",
    },
  });

  if (!source.ok) {
    // A success *before* this failure does not prove a later 403 was object-specific: the edge may
    // have begun rate-limiting mid-run. Settlement only credits a source success after this failure.
    outcomes.push({ work, result: { ...source, phase: "source" }, sourceSuccessesBefore: sourceSuccesses });
    consecutiveWaveBlocks = [403, 429, 503].includes(source.status) ? consecutiveWaveBlocks + 1 : 0;
    console.error(`  source failed after ${source.attempts} attempt(s): ${source.reason}`);
  } else {
    sourceSuccesses++;
    consecutiveWaveBlocks = 0;
    const pathname = `aic/${work.id}.jpg`;
    try {
      const upload = await put(pathname, source.bytes, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/jpeg",
        token,
      });
      const blobUrl = verifiedBlobUrl(upload?.url, AIC_BLOB_HOST);
      if (!blobUrl || blobUrl.pathname !== `/${pathname}`) {
        throw new Error(`unexpected Blob URL for ${pathname}`);
      }
      const verification = await verifyBlobBytes(blobUrl.href, source.sha256, { expectedHost: AIC_BLOB_HOST });
      if (!verification.ok) throw new Error(verification.reason);

      const previous = { img: work.img, src: work.src, aicImg: work.aicImg, hadAicImg: Object.hasOwn(work, "aicImg") };
      try {
        if (!work.aicImg) work.aicImg = work.img;
        work.img = blobUrl.href;
        work.src = "aic-blob";
        // Preserve edits made before this run, but never overwrite a concurrent edit made after it
        // started. This makes an unattended/local scheduled run safe around another active agent.
        if (readFileSync(POOL_PATH, "utf8") !== expectedPoolRaw) {
          throw new Error("concurrent pool.js change detected; retry after the other writer finishes");
        }
        const nextPoolRaw = serializePoolModule(pool, suffix);
        writeAtomic(POOL_PATH, nextPoolRaw);
        expectedPoolRaw = nextPoolRaw;
      } catch (error) {
        work.img = previous.img;
        if (previous.src === undefined) delete work.src;
        else work.src = previous.src;
        if (previous.hadAicImg) work.aicImg = previous.aicImg;
        else delete work.aicImg;
        throw new Error(`pool-write: ${error.message}`);
      }
      clearFailure(failureState, work.id);
      failureState.updatedAt = new Date().toISOString();
      migrated++;
      outcomes.push({ work, result: { ok: true } });
      console.error(`  verified ${verification.bytes} bytes sha256=${source.sha256.slice(0, 12)}… -> ${blobUrl.href}`);
      // Pool is already durably updated. If this ancillary write fails, abort honestly; the next run
      // sees the Blob URL and clears the stale record rather than re-uploading the work.
      writeFailureState(failureState);
    } catch (error) {
      // A failure-ledger write after a successful pool write is not an upload failure and must not
      // manufacture a false retry record for the now-migrated work.
      if (!isAicDirect(work)) throw error;
      const phase = /^pool-write:/.test(error?.message || "")
        ? "pool-write"
        : /blob hash mismatch|blob verification/i.test(error?.message || "") ? "blob-verification" : "blob-upload";
      const result = uploadFailure(phase, error);
      outcomes.push({ work, result });
      console.error(`  ${result.reason}`);
    }
  }

  if (consecutiveWaveBlocks >= BLOCK_WAVE_LIMIT) {
    circuitBroken = true;
    console.error(`  circuit breaker: ${BLOCK_WAVE_LIMIT} consecutive 403/429/503 targets; stopping without marking a Cloudflare wave permanent`);
    break;
  }
  if (index < selected.length - 1) {
    const pause = jitterMs(INTER_WORK_MIN_MS, INTER_WORK_MAX_MS);
    console.error(`  pacing ${(pause / 1_000).toFixed(1)}s before the next work`);
    await sleep(pause);
  }
}

const settledAt = new Date().toISOString();
beginFailureSettlement(failureState);
let newPermanent = 0;
let transient = 0;
for (const { work, result, sourceSuccessesBefore = 0 } of outcomes) {
  if (result.ok) { clearFailure(failureState, work.id); continue; }
  const disposition = recordSettledFailure(failureState, work, result, {
    now: settledAt,
    runId,
    runProvedAicReachable: result.category === "403-candidate"
      ? sourceSuccesses > sourceSuccessesBefore
      : sourceSuccesses > 0,
    transientRetryMs: TRANSIENT_RETRY_MS,
  });
  if (disposition === "permanent") newPermanent++;
  else transient++;
}
endFailureSettlement(failureState, settledAt);
writeFailureState(failureState);

const directRemaining = pool.filter(isAicDirect).length;
const activePermanent = Object.values(failureState.permanent)
  .filter(record => byId.get(record.id)?.img === record.sourceUrl).length;
console.log(`\nRun complete: attempted ${attempted}/${selected.length} | source fetched ${sourceSuccesses} | verified migrations ${migrated}`);
console.log(`Recorded this run: permanent ${newPermanent + wouldMark.length} | transient ${transient}`);
console.log(`AIC-direct remaining: ${directRemaining} (${activePermanent} held for replacement; others resume in later passes)`);
console.log(`Failure ledger: ${FAILURE_PATH} (${FAILURE_VERSION})`);
if (circuitBroken) console.log("Cloudflare block wave suspected; wait for the recorded backoff before another pass.");
if (migrated) {
  console.log("\nPool changed. Run these as separate commands and read each result before proceeding:");
  console.log("  /opt/homebrew/bin/node scripts/check-pool.mjs");
  console.log("  npm test");
}
