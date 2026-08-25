# Codebase reliability audit

**Date:** 2026-08-24  
**Audit mode:** Read-only; commands capable of writing were run against `git archive` snapshots under `/tmp`.  
**Evidence window:** The final full test run was pinned to `cd823dc`. This report was added while the workspace was at `053a4fd`; the intervening commit changed only artwork dating/exemptions and related reveal copy, not the systemic files discussed below.

## Executive summary

The deterministic core is healthy: the CI test suite and syntax check pass, the pool gate reports no hard violations, gameplay smoke coverage is meaningful, and no tracked secret or broken relative import was found.

The larger reliability problem is that several higher-level systems can still report success after losing coverage or failing partway. There are also hidden-input dependencies, many competing writers for canonical data, and a serious device-ownership flaw in the account APIs. In short, “green” currently means the deterministic checks passed; it does not yet guarantee that the checkout is reproducible, the network audits actually observed anything, or a multi-file mutation completed coherently.

## Scope and method

The audit covered:

- Repository/worktree state and tracked-versus-ignored artifacts.
- Test, CI, pre-commit, deploy, and scheduled-audit behavior.
- Producer/consumer relationships for canonical and generated data.
- Clean-checkout reproducibility and hidden-cache behavior.
- Atomicity and partial-write risks in data mutation scripts.
- API authorization, deletion, persistence, and database-schema ownership.
- Vision/guessability/evaluation data freshness.
- Stale documentation, dead artifacts, payload duplication, and taxonomy cruft.

Mutation-capable commands—including generators, full tests, and destructive failure simulations—were isolated in temporary copies. The user’s untracked `data/guessability/probe-sonnet-candidates-partial.json` was not touched.

## Verified baseline

At the final full verification point (`cd823dc`):

- `npm run test:ci` passed.
- `npm run check:syntax` passed.
- Scoring tests: 58 passed.
- Medium tests: 90 passed.
- Static-module tests: 6 passed.
- Wikidata field-rule tests: 7 passed.
- Gameplay smoke: 99 checks passed.
- `check-pool`: 0 hard violations and 872 advisory warnings.
- No missing relative JS imports were found.
- No tracked service-role/private-key secret was found by the targeted scan.
- Fame overlay, easy exclusion, and teaching-note shards reproduced deterministically.

## P1 — Authenticated APIs do not establish device ownership

### Evidence

After validating only the account JWT:

- [`api/claim.js`](../../api/claim.js) writes the caller-supplied `deviceId` into `profiles.user_id`.
- [`api/sync.js`](../../api/sync.js) performs the same binding before syncing state.
- [`api/delete-account.js`](../../api/delete-account.js) combines the caller-supplied `deviceId` with devices found by authenticated user ID, then deletes every listed profile and score.

A mocked handler run proved that a valid account token plus `victim-device-9999` generated service-role deletion requests for that victim’s scores and profile. A similar run proved that `claim` would bind the victim ID to the authenticated user.

Account deletion has two companion problems:

- It does not delete `saves` or `events`, despite presenting the operation as “Delete everything.”
- It does not check most Supabase deletion responses, so it can return `{ok:true}` after partial failure.

Anonymous device identity is an intentional product model. The defect is that an identifier is being treated as proof of possession/ownership, including inside authenticated destructive operations.

### Required change

1. Derive deletable device IDs exclusively from `profiles.user_id = authenticated uid`.
2. Ignore a body `deviceId` during deletion unless ownership has already been established server-side.
3. Introduce a server-issued device capability or one-time claim nonce; do not use the public identifier itself as the capability.
4. Reject an attempted claim if the device is already bound to another account.
5. Move account erasure into a transactional database function that deletes all owned scores, profiles, saves, state, and any policy-approved analytics linkage before deleting the auth user.
6. Check every response and return failure on partial erasure.

### Acceptance criteria

- A valid user cannot claim, sync, read account-wide saves through, or delete a device they do not own.
- Account deletion affects only devices resolved from the authenticated account.
- A forced failure in any deletion step does not return success.
- Tests cover foreign-device IDs, already-claimed devices, retries, and complete erasure.

## P1 — Scheduled image auditing is fail-open

### Evidence

[`scripts/scheduled-audit.mjs`](../../scripts/scheduled-audit.mjs) parses child output but does not treat all of the following as blocking failures:

- Child process exits nonzero.
- No parseable JSON is produced.
- The daily verifier returns no result.
- The verifier checks zero or only a tiny fraction of its expected targets.

[`scripts/check-image-drift.mjs`](../../scripts/check-image-drift.mjs) correctly distinguishes transient query failures from confirmed missing images, but it skips every `qfail`. If all queries fail, it can report zero drift and exit successfully with `checked: 0`.

The scheduled GitHub workflow opens an issue only when the driver fails, so a verifier outage can become a green weekly run.

### Required change

- Make child nonzero exit, missing JSON, schema mismatch, and coverage below a stated threshold fail the driver.
- Emit `attempted`, `checked`, `unknown`, `failed`, and coverage percentage.
- Set a defensible minimum coverage threshold for each network verifier.
- Preserve the useful distinction between “unknown” and “confirmed gone,” but never translate “all unknown” into “all clear.”

### Acceptance criteria

- A run with all network calls mocked to fail exits nonzero.
- A malformed child response exits nonzero.
- A partial run below the coverage threshold opens/updates the audit issue.

## P1 — Wikidata cache poisoning and hidden-state-dependent tests

### Evidence

[`scripts/lib/wd-cache.mjs`](../../scripts/lib/wd-cache.mjs) seeds current-schema empty records before issuing three SPARQL queries, converts failed requests to empty arrays, then persists those records. With fetch mocked to return HTTP 503, the audit persisted `Q42` as a valid schema-v3 entity with every field empty. Later audits will trust that record and skip refetching it.

[`scripts/audit-local.mjs`](../../scripts/audit-local.mjs) describes itself as local/no-network, but its first three children require Wikidata or Wikipedia data. In a clean checkout, `npm test` reached the advisory audit and then produced no output for more than 25 seconds. With ignored `wd-entities.json` and Wikipedia extracts present, the same six audits finished in 1.25 seconds.

Ignored state also changes results. For example, `check-pool` reported 39 no-pin works without `data/incoming/no-pins-reviewed.json` and 29 with the local ignored review file.

### Required change

- Commit a cache batch only after every required query succeeds.
- Store explicit states such as `ok`, `confirmed-empty`, and `unknown`, plus fetch timestamps.
- Negative-cache only an explicit “entity does not exist” response.
- Make `npm test` genuinely network-free and independent of ignored state.
- Move cached/network audits to a separately named command with explicit timeouts.
- Decide whether review ledgers such as `no-pins-reviewed.json` are canonical inputs; if they are, track them.

### Acceptance criteria

- A mocked outage writes no valid empty entity records.
- A clean `git archive` completes the default test command without network access.
- Two clean checkouts produce identical test results.

## P1 — Regions generation can erase canonical output successfully

### Evidence

The tracked `.cache/hbm` is a machine-specific symlink to `/tmp/hbm`. In a clean archive, [`scripts/build-regions.mjs`](../../scripts/build-regions.mjs) failed while trying to create the broken target.

After replacing that symlink with an empty real cache in the temporary snapshot, `node scripts/build-regions.mjs --offline` caught all 67 missing inputs, wrote:

```js
window.ARTEFACTUM_REGIONS={};
```

and exited 0.

The existing atomic helper protects syntax and interruption safety for one file, but it cannot distinguish a syntactically valid empty result from a catastrophic semantic failure.

### Required change

- Remove the tracked machine-specific symlink.
- Use an ignored/configurable cache location.
- Preflight all required era files before generating output.
- Refuse to replace `regions.js` when completeness is below the declared expectation.
- Add a `--check` mode that compares regenerated output without modifying the checkout.

### Acceptance criteria

- Missing cache/network input changes no canonical file and exits nonzero.
- Clean-checkout behavior is documented and deterministic.
- The generator enforces a minimum expected culture count.

## P1 (research validity) — Recognition and wrong-art eval schemas remain ambiguous

### Recognition encoding

[`scripts/vision-guess.mjs`](../../scripts/vision-guess.mjs) assigns `stopRung: 4` both when recognition finally breaks at the last rung and when recognition survives the entire ladder. The committed score data contains 288 rung-4 works: 210 survived all transforms and 78 broke at rung 4.

[`scripts/ease-metric.mjs`](../../scripts/ease-metric.mjs) uses only `stopRung`, ignoring the persisted final `recognized` value. Both opposite outcomes therefore receive the same visual-recognizability treatment.

Required change: add explicit `survived` and nullable `breakRung`; migrate the committed probe and make all downstream calculations use the unambiguous fields.

### Wrong-art scorer

[`scripts/eval-score.mjs`](../../scripts/eval-score.mjs):

- Counts any `image.ok === false` as a successful wrong-art detection, even when the stated issue is low quality, download failure, or something else.
- Excludes missing output records from metrics instead of failing coverage.
- Does not validate the exact ID set, duplicates, or output schema.

Required change: enforce complete and unique output coverage, validate schema, require `issue === "wrong-art"` for the target metric, and fail publication when coverage is incomplete.

## P1/P2 — Generated artifacts are stale and not reproducible

### Evidence

Regenerating against the audited snapshot and available local source inputs changed:

- `data/guessability/scores.json`: 29 of 407 scored works—9 `when`, 19 `style`, and 1 `medium` result.
- `data/guessability/ease.json`: 297 of 407 works.
- `data/authorities.json`: 3 of 703 concepts (`Greater Nicoya`, `Federal`, and `Academic realism`).

`npm run normalize` is neither clean-checkout-reproducible nor transactional. It runs two writers and then fails because ignored `data/incoming/aat-map.json` is absent.

Ease generation optionally consumes ignored `data/incoming/study-human-difficulty.json`, while the committed result contains 23 human-derived records. A clean checkout cannot reproduce that output.

The authority freshness gate checks only that current labels have entries. It does not compare generated content such as current work counts.

### Required change

- Define a manifest for every tracked generated artifact: owner script, tracked inputs, optional external snapshot, schema, and verification command.
- Track/version required curated inputs or publish an immutable source snapshot with provenance.
- Add `--check` modes that write to temporary files and compare bytes.
- Preflight every input before any part of `normalize` writes.
- Gate exact freshness where generated data affects behavior or published analysis.

## P2 — Canonical data has too many competing, non-atomic writers

At least:

- 36 scripts directly rewrite `data/pool.js`.
- 8 directly rewrite `data/teach-works.js`.
- 4 directly rewrite `data/hotspots.js`.

Many use in-place `writeFileSync` and bracket slicing rather than [`scripts/lib/static-module.mjs`](../../scripts/lib/static-module.mjs).

The primary curation path, [`scripts/curate-merge.mjs`](../../scripts/curate-merge.mjs), sequentially writes `index.html`, pool, teaching notes, hotspots, and ignored queues. An interruption can leave a split canonical state. Several other multi-file promotion/merge scripts have the same shape.

### Required change

Create one corpus transaction layer:

1. Read and parse all current canonical inputs.
2. Apply the requested mutation entirely in memory.
3. Validate schemas and cross-file invariants.
4. Stage every output.
5. Run syntax and semantic checks against the staged set.
6. Promote the set together, with rollback/journal support if any promotion fails.

Legacy scripts should use the transaction layer or be explicitly deprecated.

## P2 — CI, hooks, API tests, and database ownership gaps

- CI runs `test:ci` but not `check:syntax`, leaving many operator scripts outside the enforced syntax path.
- The tracked `.githooks/pre-commit` is inactive in the audited checkout; Git uses `.git/hooks`, which has no installed pre-commit hook.
- No API behavior tests cover claim, sync, deletion, score races, or device-capability boundaries.
- Only three SQL migration files are tracked. Base schemas for `scores`, `profiles`, `events`, and `user_state` live partly in code comments/manual setup, so a fresh backend cannot be recreated from the repository.
- `package-lock.json` is ignored, so the scripts that use `sharp` and `@vercel/blob` do not have a repository-pinned dependency graph.

## P3 — Stale documentation and removable artifacts

- `README.md` says roughly 5,900 works; the pool contains 6,557.
- `docs/PIPELINE.md` references deleted `scripts/curate-codex.mjs`.
- `tasks/hardcoded-data-audit.md` references deleted collection/movement files and scripts.
- `tasks/code-review.md` says `audit-all` hides failures, but the current implementation now collects verifier failures and exits nonzero.
- `tasks/todo.md` calls `data/vision.js` dead, while the runtime still loads it and uses its pins as a fallback.
- `data/vision.js` contains 202 rich records and is 352 KB; only pins are consumed at runtime. Seven records lack a corresponding hotspot key, so those pins can be migrated before retiring the legacy payload.
- Nine unreferenced PNG masters duplicate used WebPs and total 10.69 MiB.
- Five `tasks/*/support.js` files are byte-identical and unreferenced elsewhere.
- The label audit reports 112 orphan movement entries, 14 casing inconsistencies, 50 fragmented vocabulary groups, and 2 authority concept duplicates.

## Recommended implementation order

1. Fix API device ownership, account deletion completeness, and API behavior tests.
2. Make scheduled audits and Wikidata caching fail closed on lost coverage.
3. Protect `regions.js` from incomplete generation and remove the tracked cache symlink.
4. Fix recognition/eval schemas and regenerate research artifacts.
5. Introduce generated-artifact manifests, preflight, and `--check` freshness gates.
6. Consolidate canonical writes behind a transaction layer.
7. Add syntax to CI, install/document hooks, and track full database migrations.
8. Reconcile documentation and remove/migrate stale payloads and duplicate assets.

## Repository-wide completion criteria

The reliability work is complete when:

- A clean `git archive` can run the default deterministic verification with no network and no ignored inputs.
- Every tracked generated file can be reproduced or verified from declared versioned inputs.
- Network verifiers fail when coverage is absent or below threshold.
- Missing generator inputs cannot change canonical files.
- No authenticated API can act on a foreign device identifier.
- Account deletion is complete, account-scoped, transactional, and response-checked.
- Recognition and wrong-art metrics reject ambiguous or incomplete records.
- Canonical data mutations pass through one validated staging/promotion path.
- CI exercises syntax, deterministic tests, schema/invariant gates, and API behavior tests.

