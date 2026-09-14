import assert from "node:assert/strict";
import {
  AIC_BLOB_HOST,
  POOL_PREFIX,
  beginFailureSettlement,
  classifyHttpFailure,
  endFailureSettlement,
  fetchAicImage,
  isAicDirect,
  jitterMs,
  normalizeFailureState,
  parsePoolModule,
  parsePositiveInt,
  recordSettledFailure,
  serializePoolModule,
  sha256,
  verifiedBlobUrl,
  verifyBlobBytes,
  workIsDeferred,
} from "../scripts/lib/aic-blob-migration.mjs";

let checks = 0;
function check(name, fn) {
  try {
    fn();
    checks++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    checks++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

const jpeg = Buffer.alloc(1_200, 7);
jpeg[0] = 0xff;
jpeg[1] = 0xd8;
jpeg[2] = 0xff;
const response = (status, bytes = Buffer.from("blocked"), type = "text/html") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name.toLowerCase() === "content-type" ? type : null },
  arrayBuffer: async () => bytes,
});

check("pool assignment round-trips byte-for-byte", () => {
  const raw = `${POOL_PREFIX}[{"id":"aic1","title":"bracket ] in a string"}];\n`;
  const parsed = parsePoolModule(raw);
  assert.deepEqual(parsed.pool, [{ id: "aic1", title: "bracket ] in a string" }]);
  assert.equal(serializePoolModule(parsed.pool, parsed.suffix), raw);
});
check("unspaced pool prefix is rejected", () => {
  assert.throws(() => parsePoolModule("window.ARTEFACTUM_POOL=[{\"id\":\"aic1\"}];\n"), /must start/);
});
check("only AIC ids on the direct IIIF host qualify", () => {
  assert.equal(isAicDirect({ id: "aic123", img: "https://www.artic.edu/iiif/2/x/full/843,/0/default.jpg" }), true);
  assert.equal(isAicDirect({ id: "aic123", img: "https://example.com/iiif/2/x" }), false);
  assert.equal(isAicDirect({ id: "Q123", img: "https://www.artic.edu/iiif/2/x" }), false);
});
check("positive integer parser bounds the per-run cap", () => {
  assert.equal(parsePositiveInt("10", { name: "limit", fallback: 5, max: 25 }), 10);
  assert.throws(() => parsePositiveInt("0", { name: "limit", fallback: 5, max: 25 }), /between 1 and 25/);
  assert.throws(() => parsePositiveInt("26", { name: "limit", fallback: 5, max: 25 }), /between 1 and 25/);
});
check("jitter includes the declared interval endpoints", () => {
  assert.equal(jitterMs(5_000, 15_000, () => 0), 5_000);
  assert.equal(jitterMs(5_000, 15_000, () => 0.999999), 15_000);
});
check("HTTP classification distinguishes candidate, transient, and permanent", () => {
  assert.equal(classifyHttpFailure(403), "403-candidate");
  assert.equal(classifyHttpFailure(429), "transient");
  assert.equal(classifyHttpFailure(503), "transient");
  assert.equal(classifyHttpFailure(404), "permanent");
});

await checkAsync("source fetch retries a 403 and returns verified JPEG bytes", async () => {
  const replies = [response(403), response(200, jpeg, "image/jpeg")];
  const sleeps = [];
  const result = await fetchAicImage("https://www.artic.edu/iiif/2/x", {
    fetchImpl: async () => replies.shift(),
    sleepImpl: async ms => sleeps.push(ms),
    random: () => 0,
    attempts: 3,
    retryBaseMs: 10,
    retryJitterMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.sha256, sha256(jpeg));
  assert.deepEqual(sleeps, [10]);
});
await checkAsync("source fetch bounds a hard 403 to the configured attempts", async () => {
  let calls = 0;
  const result = await fetchAicImage("https://www.artic.edu/iiif/2/x", {
    fetchImpl: async () => { calls++; return response(403); },
    sleepImpl: async () => {},
    attempts: 3,
    retryBaseMs: 1,
    retryJitterMs: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.category, "403-candidate");
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
});
await checkAsync("HTML challenge bodies are never accepted as artwork bytes", async () => {
  const result = await fetchAicImage("https://www.artic.edu/iiif/2/x", {
    fetchImpl: async () => response(200, Buffer.alloc(2_000), "text/html"),
    sleepImpl: async () => {},
    attempts: 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid-image-response/);
});
await checkAsync("Blob verification re-downloads and matches the source hash", async () => {
  let requested = "";
  const result = await verifyBlobBytes(
    "https://a5qzyud92a17tezg.public.blob.vercel-storage.com/aic/aic1.jpg",
    sha256(jpeg),
    {
      fetchImpl: async url => { requested = String(url); return response(200, jpeg, "image/jpeg"); },
      sleepImpl: async () => {},
      attempts: 1,
    },
  );
  assert.equal(result.ok, true);
  assert.match(requested, /gesso_verify=/);
});
await checkAsync("Blob verification rejects different bytes", async () => {
  const other = Buffer.from(jpeg);
  other[20] ^= 1;
  const result = await verifyBlobBytes(
    "https://a5qzyud92a17tezg.public.blob.vercel-storage.com/aic/aic1.jpg",
    sha256(jpeg),
    { fetchImpl: async () => response(200, other, "image/jpeg"), sleepImpl: async () => {}, attempts: 1 },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /hash mismatch/);
});
check("Blob verification accepts only public Vercel Blob HTTPS hosts", () => {
  assert.ok(verifiedBlobUrl("https://a5qzyud92a17tezg.public.blob.vercel-storage.com/aic/aic1.jpg"));
  assert.ok(verifiedBlobUrl("https://a5qzyud92a17tezg.public.blob.vercel-storage.com/aic/aic1.jpg", AIC_BLOB_HOST));
  assert.equal(verifiedBlobUrl("https://another.public.blob.vercel-storage.com/aic/aic1.jpg", AIC_BLOB_HOST), null);
  assert.equal(verifiedBlobUrl("http://a5qzyud92a17tezg.public.blob.vercel-storage.com/aic/aic1.jpg"), null);
  assert.equal(verifiedBlobUrl("https://example.com/aic/aic1.jpg"), null);
});

const work = { id: "aic198911", title: "Restricted work", img: "https://www.artic.edu/iiif/2/x/full/843,/0/default.jpg" };
const hard403 = { phase: "source", status: 403, category: "403-candidate", reason: "download HTTP 403", attempts: 3 };
check("an AIC-wide 403 wave stays transient", () => {
  const state = normalizeFailureState(null);
  beginFailureSettlement(state);
  const disposition = recordSettledFailure(state, work, hard403, {
    now: "2026-09-01T10:00:00.000Z",
    runId: "run-1",
    runProvedAicReachable: false,
    transientRetryMs: 3_600_000,
  });
  endFailureSettlement(state, "2026-09-01T10:00:00.000Z");
  assert.equal(disposition, "transient");
  assert.equal(state.transient[work.id].globalBlockSuspected, true);
  assert.equal(state.permanent[work.id], undefined);
});
check("one 403 in an otherwise reachable run is not yet permanent", () => {
  const state = normalizeFailureState(null);
  beginFailureSettlement(state);
  const disposition = recordSettledFailure(state, work, hard403, {
    now: "2026-09-01T10:00:00.000Z",
    runId: "run-1",
    runProvedAicReachable: true,
  });
  endFailureSettlement(state, "2026-09-01T10:00:00.000Z");
  assert.equal(disposition, "transient");
  assert.deepEqual(state.transient[work.id].confirmedReachableRuns, ["run-1"]);
});
check("the same 403 in two distinct reachable runs becomes permanent", () => {
  const state = normalizeFailureState(null);
  beginFailureSettlement(state);
  recordSettledFailure(state, work, hard403, {
    now: "2026-09-01T10:00:00.000Z",
    runId: "run-1",
    runProvedAicReachable: true,
    transientRetryMs: 0,
  });
  endFailureSettlement(state, "2026-09-01T10:00:00.000Z");
  beginFailureSettlement(state);
  const disposition = recordSettledFailure(state, work, hard403, {
    now: "2026-09-01T11:00:00.000Z",
    runId: "run-2",
    runProvedAicReachable: true,
  });
  endFailureSettlement(state, "2026-09-01T11:00:00.000Z");
  assert.equal(disposition, "permanent");
  assert.deepEqual(state.permanent[work.id].confirmedReachableRuns, ["run-1", "run-2"]);
});
check("repeating the same run id cannot manufacture permanence", () => {
  const state = normalizeFailureState(null);
  for (const now of ["2026-09-01T10:00:00.000Z", "2026-09-01T11:00:00.000Z"]) {
    beginFailureSettlement(state);
    recordSettledFailure(state, work, hard403, { now, runId: "same-run", runProvedAicReachable: true, transientRetryMs: 0 });
    endFailureSettlement(state, now);
  }
  assert.equal(state.permanent[work.id], undefined);
  assert.deepEqual(state.transient[work.id].confirmedReachableRuns, ["same-run"]);
});
check("a changed source URL releases a permanent hold", () => {
  const state = normalizeFailureState(null);
  state.permanent[work.id] = { sourceUrl: work.img };
  assert.equal(workIsDeferred(work, state).deferred, true);
  assert.equal(workIsDeferred({ ...work, img: `${work.img}?replacement=1` }, state).deferred, false);
});
check("a legacy string-array failure file is evidence, not permanent credit", () => {
  const state = normalizeFailureState(["aic25093 — download 404"]);
  assert.deepEqual(state.legacyUnclassified, ["aic25093 — download 404"]);
  assert.deepEqual(state.permanent, {});
});
check("a damaged structured failure ledger is rejected rather than replaced", () => {
  assert.throws(
    () => normalizeFailureState({ version: "aic-blob-failures/2", permanent: [], transient: {} }),
    /malformed AIC failure ledger maps/,
  );
  assert.throws(
    () => normalizeFailureState({ version: "aic-blob-failures/2", permanent: { aic1: { sourceUrl: "x" } }, transient: {} }),
    /malformed permanent AIC failure record/,
  );
});

console.log(`✅ aic-blob-migration: ${checks} checks`);
