# Codebase remediation roadmap

**Date:** 2026-08-24
**Status:** Canonical implementation specification, proposed for review. No work item is complete merely because it appears here.
**Audited HEAD:** `053a4fd`
**Companion reports:**

- [`codebase-reliability-audit-2026-08-24.md`](./codebase-reliability-audit-2026-08-24.md)
- [`vision-pass-inventory-2026-08-24.md`](./vision-pass-inventory-2026-08-24.md)
- [`markdown-staleness-audit-2026-08-24.md`](./markdown-staleness-audit-2026-08-24.md)
- [`finding-ledger-2026-08-24.md`](./finding-ledger-2026-08-24.md)

This roadmap also reviews three proposed research briefs:

- `/Users/kathrynswint/Downloads/recognition_probe_spec.md`
- `/Users/kathrynswint/Downloads/near_miss_decoy_handoff.md`
- `/Users/kathrynswint/Downloads/recognition_contamination_handoff.md`

The finding ledger is the evidence index; this file is the sole remediation plan and implementation contract. If a
status, count, or file reference changes, update the ledger evidence first and then update the affected contract here.

## Governing approach

**Do the small, urgent fixes first; reassess before the heavy infrastructure.** The audits are trustworthy and the
findings are real, but Gesso is a solo, direct-to-main art game, not an enterprise service — the remediation must not
become larger than the thing it protects. The genuinely urgent items are small and concrete (device-ownership,
account deletion, a thin daily gate, the cheap fail-closed fixes). The large items (corpus transaction layer,
artifact manifests, full content-addressed daily approval, ledger governance, vision consolidation) are real hygiene
with lower urgency and are **opt-in — built if the product grows or the appetite exists, not a mandated program.**

The repair order, within that framing:

> security → truthful failure handling → thin daily protection → cheap reproducibility fixes → **[reassessment gate]** → heavy infrastructure (opt-in) → research (separate track) → cleanup

Use small, independently verifiable changes. Each establishes one invariant, includes the regression test that proves
it, and avoids unrelated deletion or reformatting. Cleanup belongs last: deleting stale-looking files before producer
ownership and clean-checkout reproducibility are established makes it harder to tell a retired artifact from an
orphaned one.

**Meta-risk to watch.** This program has already produced four audit reports, a finding ledger, and a ~1,200-line
plan with **zero fixes shipped**. Planning volume is now itself a smell. The next action should close a real hole,
not perfect the plan for closing it. See **Execution priority** below for what is actually mandated versus opt-in.

## Execution priority (revised 2026-08-24)

The batch and PR contracts below remain the authoritative "how." This section is the "in what order, and what is
actually mandated." Three tiers plus a hard stop.

### Tier 0 — ship now (small, urgent, high value)
1. **Manual daily bridge** (no code): inspect today + 7 days (revealed facts + rendered images) after each
   pool/image/freeze change; repair or remove blockers before deploy. Bridges until the thin gate lands.
2. **Commit the evidence docs** (PR 1) and **capture a sanitized schema-only production baseline** (required before
   any security migration — the tracked schema is empty).
3. **P0 device-ownership + complete account erasure** (PRs 3–4). Real, exploitable, and small: ~3 API files, a device
   capability, and the deletion cascade. Do it properly, incl. `saves`/`events`.
4. **Thin enforced daily gate — "PR 11a-lite":** upgrade `vision-mark` to record a real verdict (`pass`/`blocked`,
   not a bare ID); a `check:daily` fails deploy when a work in today + a short horizon lacks a `pass` verdict, has an
   unreachable/undersized image, or contradicts an active override; freeze skips verdict-`blocked` works. Uses
   existing artifacts — **not** the content-addressed approval ledger. This is the 80/20 of daily protection.
5. **Cheap fail-closed fixes** (PRs 5–7): scheduled-audit/drift result contract, wd-cache integrity, region-generation
   preflight. Small, self-contained, high leverage.

### Reassessment gate — STOP and re-decide here
Before building any heavy infrastructure, confirm it is still worth it given the game's actual scale and stakes. Do
not roll into Tier 2 by momentum.

### Tier 2 — opt-in (build if the product grows or appetite exists)
- **Full content-addressed daily approval — PR 11a/11b as written:** `eligibilityHash` (incl. `scoringPolicyHash`),
  immutable rehosting, freeze-by-hash + approval buffer, 28-day horizon. Excellent design; disproportionate to current
  stakes — the Tier-0 thin gate covers the live risk first.
- **Corpus transaction layer** (PR 10) over the 36 writers.
- **Artifact manifests + safe normalize + overrides** (PR 9).
- **Deterministic baseline + tracked backend + CI** (PR 8) and **finding-registry enforcement**: the lightweight
  generated-ledger `--check` is worth doing early and cheaply; mandatory-PR / CODEOWNERS / branch rulesets are a
  workflow change that a solo direct-to-main repo (where the owner cannot approve their own PR and the `/loop`
  pipeline commits to `main`) should not adopt by default.
- **Vision workflow consolidation + inventory report** (PR 12).
- **Documentation lifecycle + proven cleanup** (PR 16).

### Separate track — research (not part of the security remediation)
PRs 13–15 (recognition schema, contamination Phase 1, graded near-miss) are portfolio research with a different
audience and definition of done. Firewall them from the security work: they must not share an implementation PR with
it and must not delay it, and they ideally live in their own brief rather than this security roadmap.

## Workstream summary

| Batch | Workstream | Completion gate |
|---|---|---|
| 0 | Evidence and worktree control | Every finding has a status, owner, evidence, and acceptance test |
| 1 | Device ownership and account erasure | A valid account cannot act on a foreign device; erasure is complete and transactional |
| 2 | Fail-closed network audits and Wikidata cache | Lost coverage cannot produce a green audit or valid empty cache records |
| 3 | Safe generator foundation | Missing inputs produce a nonzero exit and no canonical changes |
| 4 | Deterministic clean-checkout verification | Default tests run offline, without ignored inputs, and reproduce across clean archives |
| 5 | Generated-artifact contracts | Every tracked generated file has one owner and a read-only freshness check |
| 6 | Research schema and scorer correctness | Ambiguous, duplicate, missing, and semantically wrong results are rejected |
| 7 | Corpus transaction layer | Multi-file corpus mutations succeed together or change nothing |
| 8A | Daily eligibility and content-addressed approval | Today and the release horizon contain only works approved for their exact image and player-facing facts |
| 8B | Vision workflow consolidation | Production coverage and research evidence have distinct names and ledgers |
| 9 | Confirmed cleanup and documentation repair | Removed artifacts have no readers; documentation totals are generated |

Per **Execution priority** above: Batch 1 (device ownership/erasure), the thin **8A-lite** daily gate, and the cheap
fail-closed parts of Batches 2–3 are **Tier 0 — do now**. The maintenance foundation (Batches 4, 5, 7), the full
content-addressed 8A, vision consolidation (8B), and cleanup (9) are **Tier 2 — opt-in after the reassessment gate**,
not a mandated sequence. Research (Batch 6 + PRs 13–15) is a **separate track** that must not displace or delay the
security and daily-protection work.

## Finding coverage

Every confirmed or partially confirmed ledger family has an implementation home:

| Ledger IDs | Fix contract |
|---|---|
| `SEC-1`–`SEC-6`, `INF-5`, `INF-6a`, `DOC-10` (stage 1) | Batch 1; implementation PRs 3–4 |
| `AUD-1`–`AUD-3`, `CACHE-1` | Batch 2; implementation PRs 5–6 |
| `GEN-1`–`GEN-2` | Batch 3; implementation PR 7 |
| `DET-1`–`DET-2`, `INF-3`–`INF-4`, `INF-6b`, `INF-7` | Batch 4; implementation PR 8 |
| `GEN-3`–`GEN-6` | Batch 5; implementation PR 9 |
| `RES-1`–`RES-3` | Batch 6; implementation PR 13 |
| `INF-1`–`INF-2` | Batch 7; implementation PR 10 |
| `DQ-1`–`DQ-6` | Batch 8A; implementation PRs 11a–11b |
| `VIS-1`–`VIS-5`, `DOC-5`, `DOC-12` | Batch 8B; implementation PR 12 |
| `DOC-1`–`DOC-3`, `DOC-6`–`DOC-9`, `DOC-11`, `DOC-13`–`DOC-18` | Batch 9; urgent truth corrections may ride earlier PRs |

`DOC-4` is verify-only because the implementation already fails closed. `GEN-6` is a stale measurement, so the
fix is a reproducibility contract and a fresh measurement, not restoration of the old counts. `DOC-7` is explicitly
not a deletion task: the identical `support.js` files have active readers.

**Single-owner splits (round-2 review).** Two findings are intentionally two-part so each still has exactly one
*owner per part*:
- **`INF-6` → `INF-6a` + `INF-6b`.** `INF-6b` (track the existing base schema: `profiles`, `scores`, `saves`,
  `events`, `user_state`) is owned by **PR 8**. `INF-6a` (the *new* `devices` relation + security cascades) is owned
  by the security PRs (**PR 3/PR 4**), which build on `INF-6b`. Because the security migrations depend on the base
  tables existing in tracked SQL, capture a sanitized schema-only production baseline *before* PR 3 (see revised
  order); do not author cascade migrations against the empty tracked schema.
- **`DOC-10` is a two-stage correction.** Stage 1 (**PR 2**) removes the dangerous "deletion is safe / binding is
  correct" claims immediately; stage 2 (**PR 4**) finalizes the wording to match the shipped erasure behavior. This
  is one finding delivered in two PRs, not a duplicate.

## Cross-cutting implementation invariants

Every code PR in this program must preserve these rules:

1. **Authority is server-derived.** User-supplied identifiers select data only after independent authorization; they
   never establish possession or expand scope.
2. **Unknown is not success.** Missing input, lost network coverage, malformed output, and partial execution are
   explicit non-success states.
3. **Canonical writes are staged.** Validation happens before promotion; a failed operation leaves the previous
   canonical set coherent.
4. **Approval follows content *and* scoring policy.** Any approval of a work is invalidated when the relevant image,
   player-facing facts, **or the executable scoring policy that determines the accepted answer** change (e.g. a
   `simplifyMedium` regex, an alias-equivalence group, a movement family, a category rule, or `whereCredit`/date
   tolerance). A per-work record hash is insufficient by itself; eligibility must also bind a scoring-policy version.
5. **One owner per artifact.** A tracked generated artifact has one declared writer, complete declared inputs, and a
   read-only freshness check.
6. **Tracked claims are reproducible.** Published counts and research conclusions can be recomputed from preserved,
   versioned evidence.
7. **CI is the authority.** Local hooks may help, but required safety checks run in CI and the deploy gate.
8. **Incidents become exact regressions.** A corrected work keeps a stable-ID fixture or override that prevents the
   same fact or image defect from returning during regeneration.

## Batch 0 — Establish an evidence ledger

Commit the audit reports separately from implementation changes. Create a finding ledger with, at minimum:

- Stable finding ID.
- Severity.
- Current status: `confirmed`, `in-progress`, `fixed`, `obsolete`, or `accepted-risk`.
- Current file-and-line evidence.
- Intended change.
- Regression or acceptance test.
- Pull request or commit that resolves it.

Before any data regeneration, explicitly preserve and classify the untracked `data/guessability/probe-sonnet-candidates-partial.json`. Do not overwrite, merge, or publish it merely because it is present.

For every later batch:

1. Revalidate the finding against the current HEAD.
2. Add a test that demonstrates the failure where practical.
3. Implement the narrow fix.
4. Run the batch-specific gate plus the deterministic baseline.
5. Update the ledger with evidence rather than a prose assertion.

## Batch 1 — Fix device ownership and account erasure

### Required architecture

The public `deviceId` must stop functioning as proof of possession. Introduce a server-issued, high-entropy device capability:

- Return the secret only to the device.
- Store only a hash server-side.
- Require proof of the capability before an anonymous device can be claimed.
- Use a one-time claim nonce or equivalent replay-resistant claim exchange.
- Enforce a database uniqueness rule preventing a device from being bound to multiple accounts.
- Resolve account devices server-side from the authenticated user for sync and deletion.
- Never extend authority merely because a request body contains a device ID.

If an existing installation has only a public identifier and cannot prove possession, do not silently grandfather it into ownership. Use an explicit upgrade or re-registration path.

Use a tracked `devices` relation as the ownership boundary. The migration should provide, at minimum:

```text
devices
  device_id        primary key
  capability_hash  not null
  user_id           nullable foreign key → auth.users(id) on delete cascade
  created_at
  claimed_at
  revoked_at
```

Tables keyed by a device (`profiles`, `scores`, `saves`, and `events`) should reference `devices.device_id` with the
reviewed cascade behavior. Account tables such as `user_state` should reference `auth.users.id` with `on delete
cascade`. For the high-entropy raw capability, store only a keyed HMAC or equivalent preimage-resistant digest and
use constant-time comparison; do not store the secret itself. A claim may bind an unclaimed device or confirm an
existing same-user binding; a device bound to another user returns
`409` without mutation. `sync` resolves the authenticated user's device set server-side rather than binding the
body's `deviceId` as a side effect.

**Defense in depth, not one helper.** RLS cannot rescue a bad authorization decision because these endpoints use the
service-role client (which bypasses RLS). So authorization must be layered: a shared application authorization helper;
database uniqueness + foreign-key constraints; and — preferably — the claim/bind performed inside a narrowly-scoped
database function rather than in application code. Confine service-role access to reviewed helpers, and add rate
limiting + audit logging on capability issuance and claim. Harden that `SECURITY DEFINER` claim/bind function:

- Set a fixed, safe `search_path` (e.g. `pg_catalog`) and schema-qualify every relation.
- Grant `EXECUTE` only to the minimal required role; `REVOKE` execute from `PUBLIC`/`anon`.
- Perform an atomic check-and-bind (single statement / row lock) so a concurrent claim cannot double-bind under the
  uniqueness constraint.
- Derive the acting identity from `auth.uid()` inside the function where feasible; never trust a caller-supplied UID
  merely because the application verified a JWT earlier in the request.

The legacy-device decision is a required product decision before migration:

- **Recommended:** issue a new capability-backed identity, leave legacy server rows unclaimable/read-only, and offer
  an explicit support migration when evidence exists.
- **Compatibility option:** a time-boxed one-time migration flow with its weaker proof and abuse risk documented.

Do not silently treat possession of an old public ID as possession of the device.

Make account erasure one supported privileged operation: delete the authenticated user with the Supabase admin API,
after the tracked schema has been migrated so the reviewed foreign-key cascades remove all account- and device-owned
rows. Supabase documents both [admin user deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
and the recommended [`auth.users` foreign-key cascade pattern](https://supabase.com/docs/guides/auth/managing-user-data).
Verify those semantics against a local Supabase instance and the production schema before rollout. The endpoint must
ignore any body `deviceId`, return success only after the admin operation succeeds, and be idempotent on retry. If
there are storage objects or external analytics identities, inventory them explicitly; they require a separate,
auditable erasure policy rather than an assumed database cascade.

Do not implement erasure as several unchecked REST deletes. If production constraints prevent a single cascade-rooted
operation, use a durable erasure job with explicit per-resource states and return pending—not success—until the full
policy is satisfied.

### Regression coverage

- Claim a foreign device.
- Sync a foreign device.
- Read account-scoped state through a foreign device.
- Delete a foreign device.
- Claim a device already bound to a different account.
- Replay a used claim capability or nonce.
- Retry an interrupted claim or deletion.
- Force failure at each erasure step.
- Verify complete deletion of every owned table.
- Verify that another account's rows remain untouched.
- Verify an omitted or fabricated body `deviceId` cannot change deletion scope.
- Verify the tracked schema can be created from an empty local backend and its cascades match the erasure matrix.

### Completion gate

No authenticated endpoint can act on a foreign device identifier, and a forced erasure failure cannot produce `{ok:true}` or a partial committed deletion.

## Batch 2 — Make network-derived claims fail closed

Create a common child-result contract for scheduled/network verifiers. A successful verifier result should include:

```json
{
  "attempted": 650,
  "checked": 615,
  "unknown": 35,
  "confirmedFailures": 4,
  "coverage": 0.946
}
```

The driver must fail on:

- A nonzero child exit.
- Missing or malformed JSON.
- A schema mismatch.
- Zero attempted or checked targets when targets were expected.
- Coverage below that verifier's declared threshold.
- An unexpected target count without an explicit explanation.

Keep `unknown` distinct from `confirmedFailures`, but never translate “all unknown” into “all clear.” Include the expected and observed coverage in the scheduled issue output.

For Wikidata caching:

- Build a requested batch in memory or a staging file.
- Promote it only after every required query for that batch succeeds.
- Persist explicit states such as `ok`, `confirmed-empty`, and `unknown` with timestamps.
- Negative-cache only an authoritative “entity does not exist” result.
- Never persist a timeout, 429, 5xx response, parse failure, or partial query set as a current-schema empty entity.

### Completion gate

All-network-failure, malformed-child-output, zero-coverage, and partial-query tests exit nonzero. A mocked Wikidata outage leaves the trusted cache unchanged.

## Batch 3 — Establish a safe-generator pattern

Start with `scripts/build-regions.mjs`, then extract and reuse the pattern:

1. Resolve and preflight every required input.
2. Produce the complete candidate output in memory or under a temporary staging path.
3. Validate syntax, schema, cross-file invariants, and semantic minimums.
4. Compare the candidate with the existing artifact.
5. Promote only after all validation succeeds.
6. Provide a `--check` mode that never modifies the checkout.

Remove the tracked machine-specific `.cache/hbm` symlink. Use an ignored and configurable cache location. Region generation must enforce a declared minimum expected culture/era count; syntactically valid `{}` is not a valid build.

### Completion gate

Missing cache or network input exits nonzero and leaves `regions.js` byte-for-byte unchanged. Clean-checkout behavior is documented and covered by a test.

## Batch 4 — Make default verification deterministic and offline

Define commands by contract:

- `test` and `test:ci`: deterministic, offline, tracked inputs only.
- `audit:network`: network allowed, with explicit timeouts and coverage thresholds.
- `generate`: mutation allowed after preflight.
- `generate:check`: read-only regeneration/freshness comparison.

Then:

- Track `package-lock.json` so repository dependencies are pinned.
- Decide whether ignored review ledgers are canonical inputs; track/version them if they affect official results.
- Remove ignored input dependencies from deterministic tests.
- Add `check:syntax` to CI.
- Treat local hooks as convenience only; document installation and enforce mandatory checks in CI.
- Run the deterministic suite in a clean `git archive` fixture.

### Completion gate

Two clean archives, without network or ignored files, finish the default test command with identical results.

## Batch 5 — Give generated artifacts explicit contracts · Tier 2 (opt-in)

Add a tracked manifest for every generated artifact. Each entry should declare:

- Output path.
- Sole owning script.
- Tracked input paths.
- External snapshot and provenance, if required.
- Schema version.
- Generation command.
- Read-only verification command.
- Whether byte-for-byte or semantic equality is required.

Prevent new direct writers immediately, then migrate existing writers by operational frequency. Preflight all inputs for multi-step commands such as `normalize` before the first output is written.

Do not call a generated file reproducible when it silently depends on a developer's ignored cache. Either track the curated input, publish and pin an immutable source snapshot, or classify the output as noncanonical.

### Completion gate

Every tracked generated artifact can be reproduced or verified from declared inputs, and each has one authoritative writer.

## Batch 6 — Correct research schemas and evaluation semantics

This batch is a prerequisite for both proposed research briefs.

### Recognition encoding

Replace overloaded `stopRung` semantics with explicit fields:

```json
{
  "recognizedRung0": true,
  "survived": false,
  "breakRung": 4
}
```

When recognition survives every transform:

```json
{
  "recognizedRung0": true,
  "survived": true,
  "breakRung": null
}
```

Derive the migration from `recognizedTrace`, retain the original trace, and make downstream calculations consume the unambiguous fields. Do this before regenerating guessability scores or ease results.

### Wrong-art scorer

Before building a larger decoy set, make the scorer:

- Require the exact expected ID set.
- Reject missing, unexpected, and duplicate output IDs.
- Validate every output against a versioned schema.
- Count wrong-art detection only when `image.ok === false` and `image.issue === "wrong-art"`.
- Treat download, quality, framing, and parse failures as errors or separately reported unknowns, not successful detections.
- Fail publication when coverage is incomplete.
- Record prompt, model, model-version/date, input-manifest hash, and run configuration.

### Completion gate

The migrated recognition data distinguishes the 78 last-rung breaks from the 210 ladder survivors, downstream results use that distinction, and incomplete or semantically invalid auditor output cannot produce a metric report.

## Review — recognition probe specification

The phase-gated scope, explicit pre-registration, small-n honesty, and decision to derive labels from `recognizedTrace` are strong. Phase 1 is a sensible guaranteed deliverable before attempting hidden-state work. Several design claims should be narrowed before execution.

### Recommended Phase 1 target hierarchy

1. Use ladder survival among works recognized at rung 0 as the primary binary target. Survival is only conceptually defined for the rung-0-recognized cohort.
2. Keep rung-0 self-reported recognition as a secondary, severely imbalanced target. Report precision-recall AUC and calibration alongside ROC AUC; ROC AUC alone can look reassuring with 95.6% positives.
3. Do not treat `breakRung` as ordinary ordinal regression. Ladder survivors are right-censored: their recognition did not break within the observed ladder. If modeling rung is worthwhile, use a discrete-time survival/hazard formulation or state clearly that a simpler ordinal analysis is exploratory.

The measured outcome should be named `selfReportedRecognition` or `selfReportedLadderSurvival`, not recognition without qualification.

### Small-sample model design

- Use ridge-regularized logistic regression as the default; 407 observations against 512 embedding dimensions is not a feature-selection setting where lasso coefficients will be stable.
- Tune regularization inside nested cross-validation.
- Perform PCA, scaling, and every other learned preprocessing step inside each training fold.
- Prefer repeated grouped cross-validation, grouping at least by artist and, where identifiable, series or near-duplicate image family. Random work-level folds can leak an artist's visual identity across train and test.
- Build confidence intervals from held-out/out-of-fold predictions or a group-aware bootstrap, not by treating cross-validation folds as independent samples.
- Predeclare the comparison and avoid exploring many embeddings, pooling rules, and target definitions until one produces a favorable result.

### Fame and image-quality confounds

Compare more than the proposed three models:

1. Fame alone, preferably with a predeclared transform such as `log1p` if fame is heavy-tailed.
2. Nuisance controls alone: dimensions, aspect ratio, source, framing, and available image-quality flags.
3. CLIP embedding alone.
4. Fame plus nuisance controls.
5. CLIP plus nuisance controls.
6. Fame plus CLIP plus nuisance controls.

Report the incremental held-out value of each block. Pool rare source categories and keep all encoding inside the folds.

CLIP is itself trained on web image-text pairs and may encode famous-work identity or documentation density. Therefore, “CLIP beats fame” does not prove that recognition follows purely visual properties. It proves that this CLIP representation contains predictive information beyond the chosen fame proxy. That is still a valid result, but it is a narrower claim. A nonsemantic image-quality baseline and, optionally, a second representation can help localize the signal.

### Required Phase 3 correction

The current Phase 3 headline—“probe accuracy versus the model's own self-report accuracy”—needs an independent outcome. A probe trained to predict the model's self-report cannot meaningfully beat that self-report at predicting itself.

Define a behavioral retrieval target independent of the reported boolean, for example:

- Correctly identifying the specific title/artist from pixels under a fixed response and grading protocol.
- A preregistered forced-choice identity task with controlled distractors.
- Another externally scored behavior that distinguishes specific-work retrieval from broad stylistic inference.

Then compare:

- How well the model's self-reported recognition predicts that behavioral target.
- How well a held-out linear probe predicts the same target.

Extract hidden states at a fixed, preregistered position before the model emits its recognition answer. Probing states after the `recognized` token or its explanatory output would create trivial label leakage. Pin the model revision, prompt, layer pooling, split groups, and random seed.

### Provenance for the new repository

The proposed separate `recognition-probe` repository is reasonable for a portfolio study, but its export must record:

- Gesso source commit.
- Source-file hashes.
- Export-script version.
- Label derivation rules.
- Image URL and downloaded-content fingerprint.
- Inclusion/exclusion reasons.
- Model and embedding-checkpoint identifiers.

Image caches should remain derived and replaceable; the labels, manifests, analysis code, and environment lockfile should be versioned.

## Review — graded near-miss decoy evaluation

The brief correctly diagnoses a saturated benchmark and adds the missing fame axis. Preserving the existing T0 benchmark as a historical baseline is useful. The stronger eval should be built only after the scorer is hardened as specified above.

### Treat tiers as categories until difficulty is observed

The proposed tiers are plausible semantic-distance categories, but they are not guaranteed to be monotonically difficult. A same-artist work 25 years apart may be easier to distinguish than two near-contemporary works from the same style. Report an empirical curve, but do not bake the assumed order into scoring or statistical tests until the pilot supports it.

Define exact normalized matching rules for:

- Artist identity.
- Year distance and uncertain dates.
- Medium equivalence.
- `style` versus `styleKind`.
- Region.
- Series/subject membership.

### Correct the metric design

Recall can be reported by decoy tier and fame band. False-positive rate/specificity can be reported for controls by fame band.

“Precision by tier” is not defined unless each tier has a corresponding matched control population and a declared class prevalence. Precision changes with the correct/wrong mixture, not only auditor ability. Choose one of these designs:

1. Build independently verified, tier-eligible controls matched to each tier's target distribution, then report precision within the fixed cell prevalence.
2. Treat all controls as a common pool and report tier-specific recall plus fame-specific control false-positive rate, balanced accuracy, and uncertainty; reserve precision for the overall declared mixture.

The second option is simpler and is the recommended pilot design.

### Sampling and independence

A deterministic walk through a fame-sorted list is reproducible but can introduce systematic selection bias and heavy artist/source reuse. Prefer seeded sampling with a committed candidate manifest and seed. Reproducible randomness is still deterministic.

- Prevent the same target or decoy source from appearing in multiple scored cells unless reuse is an explicit factor.
- Cap artist, series, museum/source, region, and medium dominance.
- Randomly interleave every tier and fame band across runners/chunks.
- Prevalidate image bytes and retain fingerprints, not just URLs.
- Record exclusion and replacement decisions.

Ten decoys per cell is appropriate for a pipeline pilot, not for a confident performance curve. Label the first run a pilot, report interval widths, and determine the full-run size from the observed rates and desired uncertainty rather than presenting `n=10` cells as conclusive.

### Ground truth and runner variance

- Independently verify control images against museum/source records rather than using a prior model audit as the gold label.
- Human-review every T4/T5 pair before the blind run. Mark legitimate alternate versions, workshop copies, details, and ambiguous series matches as `ambiguous`; exclude them from the primary metric while reporting their count.
- Run a preregistered overlap subset through more than one runner to estimate agreement.
- Pin the model, prompt, tool policy, run date, and configuration.
- Keep the inputs structurally identical across categories and hide category proportions from runners.

If the evaluated object is the production agent workflow, use that workflow consistently. If the goal is a model benchmark, a pinned direct vision API is more reproducible. Do not alternate between the two without treating runner type as an experimental factor.

### Portable evidence

The current ignored inputs and outputs cannot support a reproducible tracked report. For the graded study, version at least:

- Candidate and final sample manifests.
- Truth labels and ambiguity decisions.
- URL/content fingerprints and provenance.
- Raw structured verdicts or a durable immutable snapshot of them.
- Prompt/model/run metadata.
- Scoring code and generated report.

Do not report a tracked metric that cannot be recomputed from preserved evidence.

## Batch 7 — Consolidate corpus writes behind a transaction layer · Tier 2 (opt-in)

The target mutation path is:

```text
read → mutate in memory → validate cross-file state
     → stage every output → verify the staged set → promote or roll back
```

Build a shared corpus transaction module with:

- Schema-aware readers and serializers.
- Cross-file invariant validation.
- Temporary staging.
- Syntax and semantic verification against staged outputs.
- A promotion journal and rollback behavior.
- Fault-injection tests for failures before, during, and after promotion.

Migrate `curate-merge.mjs` first because it writes multiple canonical surfaces. Migrate other scripts by usage frequency and risk. Prevent new bracket-slicing/in-place writers, then explicitly deprecate legacy writers once their callers have moved.

### Completion gate

Injected failures at every stage leave the previous canonical corpus coherent, and the main curation path uses the shared transaction layer.

## Batch 8A — Enforce daily eligibility with content-addressed approval

> **Priority note.** Tier 0 ships only the thin **8A-lite** gate (verdict + reachable image + dimensions + override,
> using existing artifacts — see Execution priority). The full content-addressed approval record, `eligibilityHash`,
> and immutable rehosting described in this batch are the **Tier-2 (opt-in)** target, built after the reassessment
> gate — not required to protect today's game.

The daily-game failures are not explained by one missed Bronze/Steel correction or one missed low-quality image.
They come from the absence of a release invariant connecting the scheduled work to the exact facts and image that
were reviewed. An ID in `data/vision-audit.json` currently means only that some pass touched that ID; it does not
prove that the current image passed, that its medium was verified, or that either value is unchanged.

### Canonical approval record

Create one tracked, versioned production-quality ledger, provisionally
`data/quality/work-approvals.json`. It is the only source of daily eligibility. A record must include:

```json
{
  "schemaVersion": 1,
  "policyVersion": "daily-quality-v1",
  "works": {
    "work-id": {
      "recordHash": "sha256:…",
      "image": {
        "url": "https://…",
        "fingerprint": "sha256:…",
        "width": 1600,
        "height": 1200,
        "status": "pass",
        "issues": []
      },
      "facts": {
        "medium": {
          "value": "Steel",
          "sources": ["https://…"],
          "verifiedAt": "2026-08-24"
        }
      },
      "vision": {
        "status": "pass",
        "schemaVersion": 1,
        "promptHash": "sha256:…",
        "model": "…",
        "auditedAt": "2026-08-24T00:00:00Z",
        "outputHash": "sha256:…"
      },
      "blockers": []
    }
  }
}
```

The exact schema may change during review, but these semantics may not:

- Eligibility is a **composite hash**, not a per-work record hash alone. A per-work hash misses global scoring
  changes that alter the accepted answer with no change to any work record (the medium incident is the proof: a
  `simplifyMedium` regex change reclassified ~256 works' accepted medium with zero work-record edits). Require:

  ```text
  eligibilityHash = workAnswerHash + imageAssetHash + scoringPolicyHash + taxonomyVersion + approvalPolicyVersion
  ```

  - `workAnswerHash` covers the normalized player-facing fields that affect a game or its answer: work ID, image URL,
    title, artist, date/range, place/coordinates, medium, style/style kind, categories, playability, other revealed
    facts. Editorial-only metadata may be excluded only through a documented, allowlisted hash projection.
  - `scoringPolicyHash` must cover **executable scoring semantics, not only extracted lookup tables**: a regex or
    control-flow change inside `simplifyMedium` (or any scoring function) must invalidate eligibility. Define a
    canonical scoring-policy manifest/version plus a **semantic or normalized-code hash** of the scoring functions
    (`simplifyMedium`, alias-equivalence groups, `MOV_FAMILY`, category rules, `whereCredit`, `movEra` tolerance),
    and add a CI check proving the runtime/library versions the hash was computed under match those in use.
  - A test must prove that changing **any** answer-affecting field *or dependency* flips `eligibilityHash`.
- `image.fingerprint` identifies downloaded bytes, not merely the URL. A URL serving different bytes invalidates the
  approval.
- Status is explicit: `pass`, `blocked`, `stale`, or a narrow, documented `exempt`. “Processed” and “pass” are never
  synonyms.
- A poor, wrong, cropped, dark, glare-obscured, tiny, unreachable, or semantically mismatched image becomes
  `blocked`; queuing a repair does not mark the work complete.
- A current fact/image mismatch, unresolved required fact, changed hash, missing provenance, or incomplete review
  makes the work ineligible.
- The old `data/vision-audit.json` is migration evidence, not sufficient approval by itself.

### Immutable daily image delivery

A stored fingerprint does not control a mutable museum/Commons URL at the moment a player loads it. When licensing
permits, the image that receives production approval should be rehosted at an immutable, content-addressed object key
(or an equivalently immutable revision URL), and the scheduled pool record must use that approved asset. The upload
path must verify the downloaded bytes, dimensions, MIME type, and hash before promotion; do not overwrite an existing
hash key with different bytes.

**Mutable-source images are ineligible for the daily by default: rehost immutably or exclude.** If an image cannot
legally or operationally be rehosted, it may only run as a narrow, reviewer-approved, expiring `mutable-source`
exception with an owner and last-verified time. State the guarantee accurately: **while a mutable-source image
remains, the approval provides metadata/fingerprint containment but cannot guarantee the bytes a player receives at
load time** (a near-release network check is time-of-check-to-time-of-use, not the serving moment). **Exact-byte
eligibility requires an immutable/revision-addressed or rehosted asset.** The reviewer, not the pipeline, decides
whether a mutable-source exception is eligible at all.

### Visual-quality policy

A production image pass uses a versioned structured checklist covering at least: correct artwork/version, whole-work
framing (unless a detail is intentional and labeled), usable exposure/contrast/color, absence of obstructive glare,
adequate subject scale/detail, no gallery-context loss, and no crop/watermark that compromises play. Resolution and
reachability are separate mechanical checks. Any uncertainty or conflict routes to human review; an agent may not
turn uncertainty into `pass`. Track a small blinded second-review sample and disagreement rate so the pass itself is
measured rather than assumed reliable. High-traffic/easy works and every changed image in the release horizon receive
the stricter review policy defined at rollout.

### Durable fact corrections

Create a tracked curation override/provenance layer, provisionally `data/curation-overrides.json`, for incident-grade
corrections such as Bronze → Steel. Each entry records work ID, field, normalized value, authoritative sources,
rationale, reviewer, and verification date. Generators apply reviewed overrides last. `check-pool` fails when the
canonical pool diverges from an active override. Every production incident adds an exact work-ID regression fixture;
a generic medium fixture is insufficient.

An override is not permission to hide a broken upstream source forever. Give overrides an owner and review trigger;
retire one only after the corrected authoritative input reproduces the same value and a test proves it.

### Approval writer and queue semantics

Replace ID-only completion writes with a schema-validating approval command. It must:

1. Read the current work and downloaded image fingerprint.
2. Validate the complete structured review result.
3. Refuse `pass` if any required check is unresolved or failed.
4. Write `blocked` plus machine-readable reasons for failed work.
5. Stage and atomically promote the updated ledger.
6. Emit the old and new record hashes for review.

The next-work selector chooses missing, stale, and re-reviewable blocked records. It may not skip a work solely
because the ID appears in a historical ledger. Repair queues should be derived from the canonical approval states or
carry references to them; an ignored `data/incoming/*` queue cannot be the only durable record of a production
blocker.

### Offline daily release gate

Add `scripts/check-daily-release.mjs` and `npm run check:daily`. It must deterministically replay the exact assignment
logic for today plus a declared horizon (recommended default: 28 days) from tracked inputs and fail if any scheduled
work has:

- No current approval.
- A non-`pass` status or open blocker.
- An `eligibilityHash` (work answer, image asset, scoring policy, taxonomy, or approval policy), URL, or image
  fingerprint mismatch.
- Missing or invalid image dimensions below the declared quality floor.
- An unresolved required fact or an active override not reflected in the canonical pool.
- A schedule entry that cannot be reproduced exactly.

Today is included. A check that begins tomorrow cannot protect today's game. The command emits both a human summary
and versioned JSON with the schedule hash, attempted/eligible/blocked counts, blocker IDs, and zero exit only when the
entire declared window is eligible. It performs no network access and makes no writes.

Add the release gate to `test:ci` and the Vercel build command. Keep a separate fail-closed network job for image
reachability and content drift; that job may refresh evidence or open a blocker, but cannot substitute for the
offline eligibility gate. Dimension and HTTP checks are necessary but do not replace visual judgments about crop,
glare, darkness, detail loss, or wrong artwork.

### Schedule immutability and correction policy

Future frozen assignments should carry the expected `eligibilityHash`. Changing a player-facing field, image, or the
scoring policy that determines the answer requires reapproval and refreezing affected future dates. Past results need an explicit product policy:

- Preserve the historical assignment ID and result.
- Permit documented correctness fixes to the displayed archival metadata/image; do not preserve a known false answer
  merely for byte-level history.
- Record the correction and previous hash so the change is auditable.

The exact boundary between historical snapshot and corrected archive is a product decision, but the implementation
must not silently mutate either.

### Required tests

- Approved work whose medium changes becomes stale and blocks the schedule.
- Approved URL serving new bytes becomes stale.
- Poor-image verdict creates `blocked`, never “done.”
- Replacing the image requeues the work and requires a new pass.
- Today plus the entire horizon is checked; an issue on day 28 fails.
- A Bronze/Steel fixture is preserved through every generator and merge path.
- A future schedule hash mismatch fails deployment.
- A network outage cannot convert an unknown image into a pass.
- A failed approval write leaves the old ledger byte-for-byte unchanged.

### Completion gate

No work can ship in today's game or the declared release horizon unless the exact current facts and immutable image
bytes have a current production approval, or a narrowly approved mutable-source exception is still within its
verification window. Reproducing a corrected medium or replacing an image invalidates the previous approval, and the
same incident is prevented by an exact regression.

### Staged delivery: enforced 11a, then automated 11b

Protect today's game early, but do not build a disposable report-only gate. Ship a small **enforced** vertical slice
of the final approval architecture first, then automate it.

**PR 11a — enforced thin slice.** Uses the final approval schema and the composite `eligibilityHash`. A named
reviewer manually approves the exact works for today plus seven days, binding each approval to its facts and image
fingerprint. Missing, stale, or blocked approval **fails deployment** (offline `check:daily` in CI and the deploy
gate). The brief report-only window that the rollout mentions exists **only to seed and verify the initial approval
set**; it is not a throwaway gate — the end state is enforced.

**Freeze/scheduling selects only currently-eligible works (constraint).** Once 11a is enforced:

- `freeze-daily`/scheduling may assign **only works with a current `pass` approval** whose `eligibilityHash` still
  matches; ineligible works are never scheduled.
- Human review **replenishes an approval *buffer* of eligible inventory**; it must **not** degrade into a mandatory
  per-day manual approval step in the automated pipeline.
- **Insufficient approved inventory fails the freeze** (loudly), rather than silently scheduling unapproved works or
  falling back to ID-only eligibility.

**PR 11b — automation.** Automates the approval writer, expands the enforced horizon to 28 days, and adds immutable
content-addressed rehosting (so `mutable-source` exceptions can be retired toward exact-byte eligibility).

**Interim manual bridge (now, until 11a is enforced).** Assign a named daily-release owner to inspect the exact 20
works for today and the next seven days — revealed facts and rendered images — after every pool/image/freeze change,
recording blockers in a tracked temporary ledger and repairing/removing them before deploy. This is manual
containment that the enforced 11a slice replaces; it is not a permanent parallel process.

## Batch 8B — Consolidate the vision workflows · Tier 2 (opt-in)

Adopt purpose-based names:

1. `contentVisionAudit` — production image QA workflow that writes the Batch 8A approval ledger.
2. `richVisionEnrichment` — 202-work structured experiment.
3. `hotspotPlacement` — coordinate-only legacy layer.
4. `guessabilityProbe` — adaptive recognition/guessability study.
5. `humanDifficultyPrediction` — prediction pilot.
6. `imageMismatchScreen` — catalog-consistency screen.
7. `auditorEval` — synthetic benchmark, with baseline and graded versions.

Then:

- Treat the Batch 8A approval ledger as the only production completion source; `contentVisionAudit` is the workflow
  that creates or updates those records, not a second ledger.
- Close its 585-current-work coverage gap based on scheduling and risk, not by treating hotspot presence as completion.
- Do not automatically run every specialized research pass on those 585 works.
- Use stratified samples for guessability and human-prediction research.
- Use mismatch screening for new or risk-selected works and report its observed coverage.
- Migrate the seven unique rich-enrichment pin sets into the hotspot layer.
- Preserve unused rich-enrichment fields with provenance before removing `data/vision.js` from runtime.
- Track research outputs when their counts or conclusions are published; otherwise label them local and ephemeral.

Add a deterministic read-only vision report that emits pool count, completion counts, orphans, overlaps, scheduled coverage, demographic/corpus strata, and tracked-versus-ignored provenance. Generate README/showcase totals from that report.

### Completion gate

There is one defensible production coverage count, all published research counts point to portable evidence, and runtime no longer carries a second mostly-unused pin payload.

## Batch 9 — Remove confirmed cruft and repair documentation · Tier 2 (opt-in)

Only after artifact owners and readers are mapped:

- Repair stale README, pipeline, task, and coverage claims.
- Remove duplicate PNG masters after confirming no build, publishing, archival, or external operator use.
- Resolve orphan movement entries, casing inconsistencies, fragmented vocabulary, and authority duplicates through explicit reviewed migrations.
- Retire obsolete scripts only after checking package commands, CI, scheduled workflows, documentation, and operator procedures.
- Record removals in the finding ledger with the evidence used to prove they were unused.

Do not remove or consolidate the five identical `tasks/*/support.js` files merely because their bytes match; sibling
`.dc.html` files actively load them. Treat the eight duplicate PNG masters with in-use WebP twins as candidates only
after a final reader check. `chain.png` is a separate case because its WebP twin is also unused. Label cleanup is a
reviewed data migration, not an incidental documentation edit.

### Completion gate

Documentation is generated or checked where possible, every removed artifact has a completed reader/writer check, and the deterministic baseline remains green.

## Implementation-ready pull-request contracts

The boundaries below are the default delivery units. A reviewer may split a PR further, but should not combine
unrelated contracts simply because the files are adjacent. For every PR: revalidate its ledger IDs against the then
current HEAD, preserve unrelated work, demonstrate the regression before the fix where practical, and update the
ledger with the merge reference.

### PR 1 — Preserve the evidence substrate

**Root problem:** remediation work will drift if its evidence and corrections remain untracked.

**Files:** the four dated reports in `docs/audits/` plus `finding-ledger-2026-08-24.md`.

**Contract:** commit documentation only. Preserve but do not include
`data/guessability/probe-sonnet-candidates-partial.json` unless Kat separately approves publishing the candidate set.
Do not include `data/incoming/*` research output.

**Acceptance:** all companion links resolve; ledger IDs are unique; no product/data files differ; the audited HEAD is
recorded. **Rollback:** revert the documentation commit; no runtime effect.

### PR 2 — Correct dangerous documentation claims

**Root problem:** current documentation can cause incorrect external Wikidata edits and falsely represents account
erasure as safe.

**Likely files:** `tasks/long-term-goals.md`, `README.md`, `tasks/auth-ux-audit.md`, ledger.

**Contract:** correct P276 → P195 for collection membership; replace deletion guarantees with the verified current
limitations; add a superseded banner to the auth audit. Do not rewrite the entire documentation set here.

**Acceptance:** no instruction recommends P276 for collection membership; public deletion text matches SEC-3/4/5;
links point to the current audits. **Rollback:** documentation-only revert.

### PR 3 — Device capability and endpoint authorization

**Ledger:** `SEC-1`, `SEC-2`, `SEC-6`, `INF-5`, `INF-6a` (new `devices` relation + security cascades; builds on the
`INF-6b` base schema tracked by PR 8, which — with the sanitized production baseline — must exist first).

**Root problem:** a public `deviceId` is currently treated as possession and can be bound to the wrong account.

**Likely files:** `api/claim.js`, `api/sync.js`, new device-registration endpoint, new
`api/lib/device-ownership.js`, authenticated client integration in `index.html`, new tracked DB migrations,
`tests/api-device-ownership.test.mjs`, `package.json`, CI. Review `api/profile.js`, `api/saves.js`, `api/score.js`,
and `api/event.js` so any private device-scoped read/write uses the same boundary; public telemetry must never grant
authority merely because it accepts a device label.

**Dependencies/decisions:** approve the legacy-device policy; inventory actual production constraints and RLS; decide
capability transport/storage on the client. Use a schema migration with a backwards-compatible observation period
before enforcing if required, but give it a fixed end date.

**Implementation:** issue a high-entropy capability, persist only its hash, require it for claim/sync, bind only an
unclaimed or same-user device, and resolve all account devices from the JWT subject server-side. Separate validation,
authorization, and mutation. Keep service-role access inside reviewed helpers. Perform claim/bind inside a hardened
`SECURITY DEFINER` database function: fixed safe `search_path`, schema-qualified relations, `EXECUTE` granted to the
minimum role with `PUBLIC`/`anon` revoked, atomic check-and-bind under the uniqueness constraint, and identity
derived from `auth.uid()` where feasible — never trust a caller-supplied UID. Add rate limiting + audit logging on
capability issuance and claim.

**Tests and acceptance:** hostile-device claim/sync, already-bound device, malformed capability, replay, cross-user
read, same-user retry, and concurrent claim race. The test must fail on the vulnerable revision and pass with the fix;
all merged commits stay green. A local database test proves the unique ownership constraint.

**Rollout/rollback:** deploy additive schema first; measure capability adoption; then enforce. Rolling application code
back must not drop the new ownership constraint. Never roll back to accepting an ID as proof.

### PR 4 — Complete account erasure

**Ledger:** `SEC-3`–`SEC-5`, remaining `INF-6a` erasure cascades, `DOC-10` stage 2 (final wording matching shipped erasure).

**Root problem:** deletion scope trusts a body ID, omits tables, and returns success on partial failure.

**Likely files:** `api/delete-account.js`, tracked base-schema/cascade migrations for `devices`, `profiles`, `scores`,
`saves`, `events`, and `user_state`; `tests/api-delete-account.test.mjs`; erasure-policy documentation.

**Dependencies/risks:** PR 3 ownership schema; verified production schema; explicit inventory of storage and external
analytics. Authentication deletion and application-row deletion must follow the approved cascade or durable-job
design—do not invent an untestable cross-service “transaction.”

**Tests and acceptance:** body device IDs are ignored; foreign rows survive; all policy-owned rows disappear; a
forced admin failure is non-2xx; retry is idempotent; local empty-database migration plus cascade integration test
passes. Assert the current exploit's exact victim impact (`scores` and `profiles`) in the before-fix regression.

**Rollout/rollback:** validate constraints and cascade counts on a scrubbed database copy; add observability for
pending/failed erasure; application rollback cannot restore deleted data, so stage and test before production.

### PR 5 — Strict network-verifier result contract

**Ledger:** `AUD-1`–`AUD-3`.

**Root problem:** failed or zero-coverage observation is currently reported as green.

**Likely files:** new `scripts/lib/audit-result.mjs`, `scripts/scheduled-audit.mjs`,
`scripts/check-image-drift.mjs`, `.github/workflows/image-audit.yml`, unit fixtures/tests.

**Implementation:** version the attempted/checked/unknown/confirmed-failure/coverage schema; make every driver reject
nonzero exits, missing/malformed output, zero expected coverage, and below-threshold coverage. Workflow issues must
distinguish findings from infrastructure/coverage failure.

**Acceptance:** all-qfail, timeout, malformed JSON, partial output, zero checked, and threshold-boundary fixtures have
declared exits; a clean run remains green. **Rollback:** retain the contract parser even if an initial threshold is
adjusted; never restore green-on-unknown.

### PR 6 — Wikidata cache integrity

**Ledger:** `CACHE-1`.

**Root problem:** transient failures are serialized as valid empty entities and poison later runs.

**Likely files:** `scripts/lib/wd-cache.mjs`, its callers, cache schema/migration code, new cache tests.

**Implementation:** model `ok`, `confirmed-empty`, and `unknown`; stage a requested batch; promote only after all
required queries succeed; negative-cache only an authoritative missing-entity response; version and timestamp cache
records. Old ambiguous empty entries must be treated as stale and refetched, not migrated to confirmed-empty.

**Acceptance:** mocked 429/5xx/timeout/parse/partial-query responses leave trusted cache unchanged; authoritative
missing entity is cached; old schema is invalidated deliberately. **Rollback:** keep a backup/read-only migration
path; cache may be discarded and refetched, never silently trusted.

### PR 7 — Fail-closed region generation

**Ledger:** `GEN-1`, `GEN-2`.

**Root problem:** missing machine-local inputs can overwrite `regions.js` with a valid-looking empty artifact.

**Likely files:** `scripts/build-regions.mjs`, `.gitignore`, tracked `.cache/hbm` entry, generator tests/docs.

**Implementation:** preflight all inputs; use an ignored configurable cache; build in memory/staging; enforce declared
schema and minimum culture/era floors; provide mutation-free `--check`; promote atomically.

**Acceptance:** missing cache, malformed data, empty candidate, and below-floor candidate all exit nonzero and leave
the artifact byte-identical; a clean declared-input fixture passes. **Rollback:** previous canonical `regions.js`
remains the fallback; removal of the machine-specific symlink is permanent.

### PR 8 — Deterministic baseline, tracked backend, and CI enforcement

**Ledger:** `DET-1`, `DET-2`, `INF-3`–`INF-4`, `INF-6b` (owns tracking the existing base schema; the security PRs add `INF-6a` on top), `INF-7`. A sanitized schema-only production baseline is captured before PR 3 so the base tables exist in tracked SQL first.

**Root problem:** local/CI checks do not share inputs, default tests can use the network, hooks are not enforcement,
the dependency graph is unpinned, and a fresh backend is not reconstructable.

**Likely files:** `package.json`, tracked `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`, DB migration
files, `scripts/audit-local.mjs` and network callers, hook-install documentation, clean-archive test helper.

**Implementation:** make `test`/`test:ci` offline and tracked-input-only; create `audit:network`; decide whether
`no-pins-reviewed.json` is canonical and either track it or remove the dependency; add syntax and API tests to CI;
track complete base schema and ordered migrations; use `npm ci`.

**Acceptance:** two `git archive` checkouts without ignored files or network return identical default-test results;
network access is detected/blocked in that fixture; an empty local backend migrates successfully; required CI checks
do not depend on local hooks. **Rollback:** dependency/schema changes require their own normal migration rollback;
never restore ignored canonical input.

### PR 9 — Artifact manifest, safe normalization, and durable overrides

**Ledger:** `GEN-3`–`GEN-6`; prepares `DQ-2`, `DQ-6`.

**Root problem:** generated artifacts have multiple implicit inputs/owners, and `normalize` can leave a split state.

**Likely files:** new `data/artifacts-manifest.json`, `scripts/check-artifacts.mjs`,
`scripts/check-writer-ownership.mjs`, `package.json`, `scripts/resync-fame.mjs`,
`scripts/build-easy-exclude.mjs`, `scripts/build-authorities.mjs`, `scripts/check-pool.mjs`, tracked/snapshotted
inputs, new `data/curation-overrides.json` and its validator.

**Implementation:** declare output, sole owner, inputs, schema, command, and equality mode; preflight the entire
normalize chain before its first write; compare authoritative content, not presence; decide whether to version
`aat-map.json` and human-difficulty inputs or classify dependent outputs noncanonical. Apply reviewed field overrides
last and check that canonical data reflects them. Re-measure GEN-6 rather than encoding stale counts. The manifest
declares `data/notes/` shards as a **derived** artifact built from `data/teach-works.js` by `build-teach-shards`
(the deploy build), owned as derived — not a directly-written canonical file.

**Acceptance:** `generate:check` is read-only; missing input produces no writes; unauthorized direct writers fail the
ownership check; clean checkout reproduces/verifies each declared artifact; an exact medium override survives
normalization. **Rollback:** preserve previous artifacts and manifest version; do not delete an input until its
replacement is proven.

### PR 10 — Corpus transaction layer and first writer migration

**Ledger:** `INF-1`, `INF-2`.

**Root problem:** dozens of bracket-slicing writers and sequential multi-file promotion can leave corpus files out of
sync or overwrite a correction.

**Likely files:** new `scripts/lib/corpus-txn.mjs`, `scripts/curate-merge.mjs`, `scripts/lib/static-module.mjs`,
transaction/fault-injection tests, writer-ownership allowlist.

**Implementation:** read and mutate in memory; stage every output; syntax/schema/cross-file validate the staged set;
promote with journal/rollback; never swallow a failed derived-artifact build. Migrate `curate-merge` first — verified
at HEAD it writes `data/pool.js`, `data/teach-works.js`, `data/hotspots.js`, and `index.html` with **direct
`writeFileSync` (bracket-slicing), bypassing the `writeTeachWorks` choke-point** (`curate-merge.mjs:103-107`), so it
is a core INF-1 writer to route through the txn. Treat the 64 `data/notes/` shards as a **derived deploy artifact**
(rebuilt from `teach-works.js` by `build-teach-shards`), not something the txn co-writes atomically; the txn stages
`teach-works.js` as the source of truth and the manifest owns the shards. Preserve the `writeAssignment` spaced-form
so legacy parsers keep working. Then prioritize remaining writers by production use and risk; the allowlist shrinks
in later PRs and this PR need not rewrite all 36.

**Acceptance:** injected failure before, between, and after promotions leaves either the old or new coherent set;
DOM/gameplay/check-pool gates pass against staged and promoted outputs; exact curation overrides persist.
**Rollback:** transaction module may be bypassed only by reverting the whole migrated caller; retain its old output
snapshot until verification completes.

PR 11 ships in two enforced stages so today's game is protected early without building a throwaway report-only gate.
`DQ-1`–`DQ-6` are one finding family delivered across 11a (enforcement core) then 11b (automation/immutable), the same
staged pattern as `DOC-10`.

### PR 11a — Enforced daily eligibility (thin slice, protects today)

**Ledger:** `DQ-1`, `DQ-3`, `DQ-4`, `DQ-5` (enforcement + eligibility + today's-game gate).

**Root problem:** vision completion is ID-only/advisory and frozen dailies point at mutable work records, so a wrong
fact or poor/stale image can ship today with no gate.

**Likely files:** new `data/quality/work-approvals.json` + final schema, new `scripts/check-daily-release.mjs`,
`scripts/freeze-daily.mjs`, `scripts/check-pool.mjs`, `package.json` (`check:daily`), `vercel.json`, CI, release tests.

**Implementation:** use the **final** approval schema and the composite `eligibilityHash`; a reviewer manually
approves the exact works for today + 7 days, bound to facts and image fingerprint. `check:daily` deterministically
replays today + the horizon offline and **fails deployment** on missing/stale/blocked approval or any
`eligibilityHash`/URL/fingerprint mismatch. **Freeze/scheduling selects only currently-eligible works**; human review
replenishes an approval **buffer** (not a mandatory per-day manual step); **insufficient approved inventory fails the
freeze** rather than scheduling unapproved works. Mutable-source images are **ineligible by default** (rehost or
exclude); a mutable-source exception provides only metadata/fingerprint containment and cannot guarantee play-time
bytes. A brief report-only window is used **only to seed the initial approvals**, then enforcement flips on.

**Tests/acceptance:** an issue on today's assignment or at the horizon edge fails; a stale `eligibilityHash` (incl. a
scoring-policy change) blocks; insufficient eligible inventory fails the freeze; the gate performs no network access.

### PR 11b — Automated content-addressed approval + immutable images (28-day horizon)

**Ledger:** `DQ-2`, `DQ-6`; completes `DQ-3`/`DQ-5` at the 28-day horizon.

**Likely files:** `data/curation-overrides.json` + validator, immutable image-promotion path (reusing
`scripts/rehost-blob.mjs`/`@vercel/blob`), `scripts/vision-mark.mjs`, `scripts/vision-next.mjs`,
`scripts/curate-merge.mjs`, `scripts/audit-dailies.mjs`, approval-writer + override tests.

**Dependencies/decisions:** PRs 5, 8, 9; preferably PR 10 for multi-file writes. Approve the hash projection, quality
floors, 28-day horizon, reviewer/exemption policy, and historical-correction behavior. Migrate old vision IDs to
`needs-review` unless current evidence proves a pass; do not mass-convert to approved.

**Implementation and acceptance:** replace ID-only writes with the schema-validating approval writer; apply reviewed
overrides last with an exact per-incident regression (Bronze→Steel survives normalize/curate/freeze/release-check);
rehost approved images immutably so mutable-source exceptions can be retired; expand the enforced horizon to 28 days.
Demonstrate every failure class with exact fixtures: medium correction, stale image bytes, low-quality visual
blocker, changed future work, failure on today's assignment. The network drift job fails closed but stays separate
from the deterministic release decision.

**Rollout/rollback:** seed/review the horizon before enforcing; run report-only briefly to measure blockers, then
enforce on a dated cutover. Rollback may reduce the enforced horizon temporarily but must never restore ID-only
approval or ship known blockers.

### PR 12 — Vision inventory, provenance, and naming consolidation

**Ledger:** `VIS-1`–`VIS-5`, `DOC-5`, `DOC-12`.

**Root problem:** overlapping passes have ambiguous names and completion semantics; runtime also carries a second pin
payload.

**Likely files:** new `scripts/vision-inventory.mjs`, vision scripts/docs, `data/vision.js`, `data/hotspots.js`,
`index.html`, README/showcase generated-count section, DOM tests.

**Implementation:** adopt purpose-based names; make the Batch 8A approval ledger the production-eligibility source;
report completion/blocked/stale/orphan/overlap/provenance counts deterministically; migrate seven unique rich-vision
pin sets into hotspots; preserve research fields with provenance before removing runtime use of `vision.js`; close
the remaining coverage gap by daily risk and schedule, not by applying every research pass.

**Acceptance:** inventory output is stable in a clean archive; README totals derive from it; all pins render before
and after migration; no 23-work candidate research file is altered; published pass counts name their schema and
source. **Rollback:** retain a migration snapshot of `vision.js` until runtime and data checks pass.

### PR 13 — Recognition schema and evaluator semantics

**Ledger:** `RES-1`–`RES-3`.

**Root problem:** last-rung failure and survival are conflated, and wrong-art metrics count unrelated failures while
silently dropping missing data.

**Likely files:** `scripts/vision-guess.mjs`, committed recognition result data, `scripts/ease-metric.mjs`,
`scripts/eval-score.mjs`, schemas/tests, regenerated derived artifacts, `docs/auditor-eval.md` limitation banner.

**Implementation:** retain trace; derive `recognizedRung0`, `survived`, nullable `breakRung`; validate exact unique
ID coverage; count only `issue === "wrong-art"`; separate unknown/error classes; bind output to manifest, prompt,
model, and configuration hashes.

**Acceptance:** migration exactly separates the known 78 last-rung breaks and 210 survivors; downstream ease uses
the new semantics; missing/duplicate/unknown-quality outputs cannot publish a score. **Rollback:** keep the original
trace and pre-migration artifact; no lossy rewrite.

### PR 14 — Recognition-contamination study, Phase 1 only

**Root question:** does a visual representation predict self-reported ladder survival beyond fame and nonsemantic
image-quality/source cues? This is a research question, not a production-remediation gate.

**Repository/files:** preferably the proposed separate `recognition-probe` repository, with export script, committed
manifest/labels/provenance, environment lock, preregistration, analysis code, and generated report. Record the Gesso
commit and source hashes.

**Design contract:** primary target is ladder survival among rung-0-recognized works; report PR-AUC, calibration, and
uncertainty as well as ROC-AUC. Use ridge logistic regression, nested grouped CV by artist/series, fold-internal
preprocessing, nuisance-only and fame-only baselines, and incremental CLIP value. Add a negative-control set of
recently digitized/obscure works (the AIC blob proposal or an equivalently provenance-controlled corpus) before
making a contamination claim. Size that control from a power/precision calculation for the target effect, accounting
for the grouped (artist/series) design effect that inflates variance — not a fixed count; ~50 may serve only as a
provisional floor if the calculation justifies it (n=8 is plainly inadequate). A second model arm is required before
generalizing across models.

**Claim boundary:** positive predictability is consistent with representation-level identity/documentation signal;
it is not by itself proof of training-set membership. Run an extended degradation ladder only after the negative
control and document whether it destroys useful visual information along with recognition. Phase 3 hidden-state work
requires an independent behavioral identity target and preregistered pre-answer extraction position; self-report
cannot be used as both predictor and ground truth.

**Acceptance:** the report is fully recomputable, contains negative/nuisance controls, labels small-sample limits,
and avoids causal contamination claims unsupported by membership evidence. **Stop rule:** do not proceed to hidden
states merely because Phase 1 is null or positive; require separate design review.

### PR 15 — Graded near-miss auditor pilot

**Root problem:** the existing synthetic wrong-art benchmark is saturated and does not measure realistic semantic
near misses.

**Likely files/repository:** committed candidate/final manifests, truth/ambiguity labels, image fingerprints, pinned
prompt/model/run metadata, raw structured verdicts, scoring code, and report. Do not rely on ignored output.

**Design contract:** treat tiers as categories until monotonicity is observed; use seeded sampling with caps on
artist/series/source/region/medium dominance; independently verify controls; human-review all T4/T5 items; mark
alternate versions and ambiguous copies separately; randomly interleave strata; include a runner-overlap subset.
Report tier recall plus fame-band control false-positive rate and balanced accuracy. Do not publish tier precision
without a matched control population and declared prevalence.

**Acceptance:** PR 13 scorer rejects incomplete runs; the first run is labeled pilot; interval widths and all
exclusions/replacements are reported; every metric can be recomputed. **Stop rule:** choose full-run sample size from
pilot uncertainty, not the convenient `n=10` cell size.

### PR 16 — Documentation lifecycle and proven cleanup

**Ledger:** remaining `DOC-*` and `DOC-6`/`DOC-8` cleanup candidates.

**Root problem:** living plans and historical snapshots are indistinguishable; copied counts and dead references
drift; apparent duplication invites unsafe deletion.

**Likely files:** `README.md`, docs/tasks listed in the ledger lifecycle table, new docs manifest/checker, confirmed
asset candidates. External email-template state requires manual console verification.

**Implementation:** add document status, owner/source of truth, verified commit/date, review trigger, and
`superseded_by`; generate volatile counts; archive/banner historical reports; repair deleted-script references;
split active backlog from incident history; remove only the eight independently proven duplicate PNG candidates.
Keep active `support.js` files. Treat label/vocabulary cleanup as a separate reviewed data migration with its own
diff and tests.

**Acceptance:** `docs:check` catches missing targets and stale generated counts; all 47 current Markdown files have a
lifecycle; every removed asset has a no-reader/no-writer record; default verification and visual/runtime checks stay
green. **Rollback:** documentation and asset removals are individually revertible; preserve history rather than
rewriting it away.

The research PRs 14 and 15 may proceed after PR 13 and design sign-off. They do not block PRs 3–12, and they should
not consume the same implementation PR as security, release integrity, or corpus mutation work.

## Repository-wide definition of done

The remediation is complete only when:

- A clean archive runs default verification without network or ignored inputs.
- Every tracked generated artifact has declared, versioned inputs and a read-only check.
- Network verifiers fail when observation coverage disappears or falls below threshold.
- Missing generator inputs cannot modify canonical files.
- No authenticated API can act on a foreign device identifier.
- Account deletion is complete, account-scoped, transactional, and response-checked.
- Recognition results distinguish last-rung break from ladder survival.
- Evaluations reject incomplete, duplicate, and semantically invalid records.
- Research reports can be recomputed from preserved evidence and state claims at the level their labels support.
- Multi-file canonical mutations pass through validated staging and promotion.
- CI enforces deterministic tests, syntax, schemas, invariants, and API security behavior.
- Today's game and the declared future horizon pass a content-addressed eligibility gate for the exact facts and
  immutable image bytes that will ship, with any mutable-source exception explicit and unexpired.
- Corrected player-facing facts survive every generator and merge path through a tracked provenance/override record
  and exact regression.
- “Vision complete” means a current production pass, not merely a processed ID or an unresolved repair queue.
- Stale artifacts are removed only after reader/writer verification.

## Required reviewer decisions before implementation

Claude's review should recommend defaults, but Kat must approve these product/policy choices before their dependent
PR begins:

1. Legacy-device migration: secure re-registration (recommended) versus a time-boxed compatibility flow.
2. Account-erasure inventory: whether storage or external analytics contain user-owned/linkable data.
3. Daily approval hash projection, image quality floors, release horizon, and who may grant an exemption.
4. Past-game correction policy: corrected archive versus immutable displayed metadata, with audit history either way.
5. Which currently ignored curation/research inputs become canonical tracked evidence versus explicitly local output.
6. Whether the 23-work recognition candidate file may be committed or must stay private/local.

## Prompt for Claude Code to review and opine

```text
Read these files in full:

1. docs/audits/remediation-roadmap-2026-08-24.md
2. docs/audits/finding-ledger-2026-08-24.md
3. docs/audits/codebase-reliability-audit-2026-08-24.md
4. docs/audits/vision-pass-inventory-2026-08-24.md
5. docs/audits/markdown-staleness-audit-2026-08-24.md

The remediation roadmap is the canonical proposed implementation specification; the ledger is its evidence index.
Review and opine only—do not edit, commit, push, migrate data, delete files, or implement fixes.

Revalidate against the current HEAD every code/schema/file claim that materially affects your opinion. Preserve all
uncommitted work, especially data/guessability/probe-sonnet-candidates-partial.json and data/incoming/*.

Return:

1. A verdict for each PR contract (1–16): Approve, Approve with changes, Split, Reorder, or Reject.
2. For every non-approval, cite current file:line evidence and propose exact replacement wording or architecture.
3. A coverage check showing whether every live finding ID in the ledger maps to one—and only one—fix contract;
   identify duplicate, missing, stale, or circular acceptance criteria.
4. A threat-model review of device capability, claim/sync authorization, legacy-device migration, and account erasure.
   Specifically test whether the proposed Supabase cascade/admin-delete design is actually supported by the tracked
   and production schemas, and flag any storage/external-data gap.
5. A daily-release review of the content-addressed approval schema, hash projection, immutable image delivery,
   mutable-source exceptions, visual-review policy, image fingerprinting, override precedence, today's-game
   inclusion, 28-day horizon, schedule immutability, exemption policy, and deploy gate.
   Try to construct a path by which a wrong medium or low-quality/stale image still ships.
6. A transaction/reproducibility review: identify every canonical writer the first corpus transaction and artifact
   manifest must cover, and challenge rollback behavior under injected failure.
7. A research-design review of the recognition-contamination and graded near-miss contracts. Distinguish what the
   data can establish from causal training-contamination claims; verify the negative controls, grouped CV, metrics,
   ambiguity handling, and portable-evidence requirements.
8. Your recommended final PR order, explicitly noting hard dependencies, parallelizable work, rollout/rollback
   hazards, and any required Kat decision.
9. A concise list of the five highest-risk assumptions in the spec.

Do not create a second roadmap. Put proposed changes into a review response organized by this roadmap's sections.
Treat prior reports as evidence to verify, not unquestionable truth. Do not mark a finding fixed because a plan or
test exists; require the acceptance evidence stated in the contract.
```
