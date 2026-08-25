# Markdown staleness audit

**Date:** 2026-08-24

**Audit mode:** Read-only investigation; this report is the only resulting repository change.

**Audited HEAD:** `053a4fd`

**Scope:** All 45 Markdown files visible in the repository: 42 tracked files plus the three previously created audit reports under `docs/audits/`.

## Executive summary

The Markdown layer is substantially stale. The primary problem is not broken links or obviously abandoned files; it is historical snapshots, implementation handoffs, and completed plans that still look like current operating instructions.

The mechanical relative-link check found no broken Markdown links. Semantic review found several more serious classes of drift:

- A dangerous external-data instruction: `tasks/long-term-goals.md` says to use Wikidata `P276` for collection membership, while the correct property is `P195`.
- Product and security claims contradicted by current code, especially account deletion and device ownership.
- Completed features still presented as unchecked future work.
- Deleted scripts and data artifacts still named by operational runbooks.
- Dynamic counts copied into prose and never refreshed.
- Historical evaluations presented as current evidence without preserving their scoring limitations.
- Point-in-time audits with old line numbers and no `historical` or `superseded` banner.

The repository should preserve its useful history, but it needs explicit document states, one living source of truth per subsystem, generated quantitative claims, and a documentation check in the normal definition of done.

## Scope and method

The audit checked:

- All Markdown files found by `rg --files -g '*.md'`.
- Tracked versus untracked state.
- Relative Markdown links.
- Backticked references to scripts, data files, APIs, tests, and commands.
- Checklists and claims of `done`, `pending`, `next`, `current`, and `not started`.
- Numerical claims against the current 6,557-work pool and current vision artifacts.
- Feature-status claims against `index.html`, `api/`, `scripts/`, CI, Vercel configuration, and database files.
- Contradictions between README, runbooks, audits, task lists, and handoffs.
- Whether each document behaves as a living source of truth, a proposal, a historical record, or an unlabeled mixture.

No repository tests or mutation-capable generators were run for this audit. No existing file was edited.

## Immediate corrections

These documents can currently cause incorrect implementation, security assumptions, external edits, or public claims.

| File | Verified problem | Recommended disposition |
|---|---|---|
| [`tasks/long-term-goals.md`](../../tasks/long-term-goals.md) | Describes unbuilt Redis accounts and Training even though Supabase accounts and Training shipped. Line 99 instructs contributors to add Wikidata `P276` for collection membership; the correct property is `P195`. | Rewrite from current reality. Remove shipped implementation specs and correct `P276` before anyone follows it. |
| [`README.md`](../../README.md) | Says roughly 5,900 works instead of 6,557; says the first vision pass covered the corpus and is tracked in `data/vision.js`; claims deletion is complete; says there is no build step despite the Vercel shard build; contradicts other docs about all-language fame. | Refresh before external use. Account deletion and vision claims are the most important corrections. |
| [`tasks/auth-ux-audit.md`](../../tasks/auth-ux-audit.md) | Its primary auth-rendering defects were fixed, but it calls profile binding correct and account deletion “solid.” The reliability audit proves foreign-device authority and incomplete erasure. | Mark superseded by the reliability audit. Do not retain as active guidance. |
| [`docs/PIPELINE.md`](../PIPELINE.md) | Documents the deleted `scripts/curate-codex.mjs` autonomous loop. Its wrong-art and pin-quality evidence is also presented without the newer limitations. | Update as the operational vision runbook or merge its unique material into `image-pipeline.md`. |
| [`docs/auditor-eval.md`](../auditor-eval.md) | Presents a saturated 100% result as current evidence. The scorer skips missing output and counts any `image.ok === false` as wrong-art detection. | Add a prominent historical-baseline/scorer-limitation banner until the hardened graded evaluation replaces it. |
| [`tasks/teaching-notes-guidelines.md`](../../tasks/teaching-notes-guidelines.md) | Says notes receive no human review and ship directly, describes an older four-cue/five-guide schema, and references an older generation pipeline. | Rewrite around the current notes/pins schema, actual review model, and current generation/merge commands. |

### Highest-risk contradiction: P195 versus P276

[`tasks/long-term-goals.md`](../../tasks/long-term-goals.md) says to contribute `P276` as a collection statement. That is wrong and could cause bad external Wikidata edits.

[`docs/wikidata-giveback.md`](../wikidata-giveback.md) and [`scripts/wikidata-giveback.mjs`](../../scripts/wikidata-giveback.mjs) correctly establish:

- `P195` means collection membership.
- `P276` means physical location.
- An artwork can move or go off display without leaving its collection.

The long-term-goals instruction should be corrected even if no other documentation cleanup is performed.

## Living backlogs that need rebuilding

### `tasks/todo.md`

[`tasks/todo.md`](../../tasks/todo.md) is mostly a changelog disguised as a backlog. Completed items contain long implementation narratives, while the remaining items are harder to identify and several have drifted.

Examples:

- It reports Oceania at roughly 28 works; the current pool contains 161.
- It reports roughly seven early-medieval European works; the current `Europe`/500–999 count is 48.
- It calls `data/vision.js` a dead bank, but `index.html` still loads it and uses its pins as a runtime fallback.
- It says the next-vision document was deleted, but `docs/next-vision-pass.md` exists.
- Its header says all-language fame shipped while README still says the all-language alternative is being evaluated.

Recommended change: keep only open, actionable work in `tasks/todo.md`. Move completed narratives to a dated changelog or archive. A checked item should leave the active backlog after its verification evidence is recorded elsewhere.

### `tasks/long-term-goals.md`

[`tasks/long-term-goals.md`](../../tasks/long-term-goals.md) combines durable product ideas, already-shipped implementations, abandoned architectures, duplicate proposals, and dangerous instructions.

Examples:

- Training features remain unchecked despite current `renderTraining`, `trainingSet`, single-axis drills, weak-spot selection, and account integration.
- Accounts/leaderboards are specified around Upstash Redis even though the shipped implementation uses Supabase for profiles, scores, user state, and auth.
- Historical-region generation points to missing `scripts/gen-regions.mjs` and `data/artist-meta.js`; the shipped implementation uses different scripts and structures.
- All-language fame remains unchecked despite comments and other docs describing it as shipped.
- Wikidata give-back uses the wrong property.

Recommended change: rewrite it as a short conceptual horizon. Do not embed current implementation plans there. Link each active project to one buildable spec or issue.

### `tasks/coverage-gaps.md`

[`tasks/coverage-gaps.md`](../../tasks/coverage-gaps.md) analyzes a 5,618-work pool and reports only seven Oceanian works. The current pool has 6,557 works and 161 Oceanian works. Its methodology and art-historical questions remain useful, but every ranking, count, and target requires recomputation.

Recommended change: replace hand-entered counts with a generated coverage report and retain editorial targets separately from observations.

### `docs/tier2-plan.md`

[`docs/tier2-plan.md`](../tier2-plan.md) contains several batches that later shipped: place handling, date tolerance, super-regions, aliases, and URAA work. It still reads as an unexecuted plan.

Recommended change: archive the original plan, then create a small unresolved-decisions document if the remaining sensitivity, culture-review, visual-difficulty, and licensed-lane questions are still active.

### `docs/next-vision-pass.md`

[`docs/next-vision-pass.md`](../next-vision-pass.md) mixes uncollected fields with sensitivity/provenance work that partially shipped. Its `[[...]]` memory references are not repository links.

Recommended change: replace it with a current proposal that uses the stable vision workflow names from the vision inventory, distinguishes collected from proposed fields, and states the cost and required human review for each field.

### `tasks/provenance-gates-plan.md`

[`tasks/provenance-gates-plan.md`](../../tasks/provenance-gates-plan.md) begins with “SPEC (not started)” while its three main sections later say shipped or partially shipped.

Recommended change: convert it to a status report containing only remaining lifespan triage, creator-QID validation, and any intended HARD-gate promotion.

### `tasks/teach-shard-plan.md`

[`tasks/teach-shard-plan.md`](../../tasks/teach-shard-plan.md) says “SPEC (not started),” but the shard builder, runtime loader, Vercel build, choke-point regeneration, and tests have shipped.

Recommended change: mark implemented and historical. Keep it as an architecture record, not a task.

## External-facing evidence that needs refresh

### Portfolio documents

The following documents should not be reused externally until their counts and claims are revalidated:

- [`docs/showcase.md`](../showcase.md): roughly 5,950 works, old QA counts, and an overbroad fail-closed claim.
- [`docs/case-study-honesty-pass.md`](../case-study-honesty-pass.md): old corpus/region counts and “decolonized” language that the newer README deliberately qualifies.
- [`docs/monetization.md`](../monetization.md): says `support_convert` is wired, while `docs/metrics.md` correctly says conversion cannot be measured without a Ko-fi webhook.

The product strategy in [`docs/icp.md`](../icp.md) remains comparatively stable. [`docs/metrics.md`](../metrics.md) is also relatively current.

### URAA review

[`docs/uraa-review.md`](../uraa-review.md) lists 62 works as a current review population. Only 32 listed IDs still resolve to current pool works, and `data/uraa-pending.json` is currently empty.

Recommended change: preserve the file as a dated legal/data-quality review record and remove any implication that it is the active queue. Legal conclusions should retain the existing not-legal-advice warning and receive explicit review dates.

### Collections copy

[`tasks/collections-copy.md`](../../tasks/collections-copy.md) instructs readers to use deleted `data/collections.js` and `scripts/make-collections.mjs`. Current collections figures are computed by the runtime.

Recommended change: retain the editorial copy separately from data-wiring instructions, and generate inserted counts from the actual current source.

## Historical documents that need banners, not deletion

The following documents contain useful reasoning or design history but should begin with a banner such as:

> Historical snapshot. Preserved for reasoning and provenance. Do not implement directly; revalidate against current code and the active roadmap.

Candidates:

- [`tasks/code-review.md`](../../tasks/code-review.md)
- [`tasks/hardcoded-data-audit.md`](../../tasks/hardcoded-data-audit.md)
- [`tasks/design-system-audit.md`](../../tasks/design-system-audit.md)
- [`tasks/accounts-leaderboard-spec.md`](../../tasks/accounts-leaderboard-spec.md)
- [`tasks/training-mode-spec.md`](../../tasks/training-mode-spec.md)
- [`tasks/16_leaderboard/README.md`](../../tasks/16_leaderboard/README.md)
- [`tasks/17_training/README.md`](../../tasks/17_training/README.md)
- [`tasks/18_account/README.md`](../../tasks/18_account/README.md)
- [`tasks/19_dab_colors/README.md`](../../tasks/19_dab_colors/README.md)
- [`tasks/20_account_prompts/README.md`](../../tasks/20_account_prompts/README.md)
- [`docs/combo-design-language.md`](../combo-design-language.md)
- [`docs/combo-logic-reconcile.md`](../combo-logic-reconcile.md)
- [`docs/ethos.md`](../ethos.md)
- [`tasks/enrich-samples.md`](../../tasks/enrich-samples.md)

Common reasons:

- Old `index.html` line numbers after the file grew substantially.
- Pre-Supabase or pre-shipped architectures.
- Branch-reconciliation instructions for branches that have already been consolidated.
- Findings that were fixed without updating the original audit.
- Design handoffs that were partly or fully ported but still use future-tense language.

The goal is not to destroy history. It is to prevent history from being mistaken for present authority.

## Relatively current documents

These appeared healthy enough to retain as living references, with normal maintenance or a review date:

- [`docs/audits/codebase-reliability-audit-2026-08-24.md`](./codebase-reliability-audit-2026-08-24.md)
- [`docs/audits/vision-pass-inventory-2026-08-24.md`](./vision-pass-inventory-2026-08-24.md)
- [`docs/audits/remediation-roadmap-2026-08-24.md`](./remediation-roadmap-2026-08-24.md)
- [`docs/image-pipeline.md`](../image-pipeline.md), with minor scheduled-audit/status corrections
- [`docs/guides-pipeline.md`](../guides-pipeline.md)
- [`docs/taxonomy.md`](../taxonomy.md), although its generated artifact freshness remains a codebase issue
- [`docs/wikidata-giveback.md`](../wikidata-giveback.md)
- [`docs/metrics.md`](../metrics.md)
- [`docs/icp.md`](../icp.md)
- [`scripts/vision-audit-prompt.md`](../../scripts/vision-audit-prompt.md)
- [`scripts/consistency-sweep-prompt.md`](../../scripts/consistency-sweep-prompt.md)
- [`tasks/email-templates.md`](../../tasks/email-templates.md), with external-console state explicitly unknown
- [`tasks/contemporary-art-research.md`](../../tasks/contemporary-art-research.md), as dated research rather than implementation authority
- [`tasks/lessons.md`](../../tasks/lessons.md), as an incident record

## Why these documents became stale

### 1. Markdown copies state instead of deriving it

Pool sizes, coverage counts, vision totals, event counts, and filenames are typed into prose. The repository can change without touching the copied number. Nothing alerts the author when 5,618 becomes 6,557 or seven Oceanian works become 161.

### 2. One file is serving incompatible purposes

`tasks/todo.md` is simultaneously:

- An active backlog.
- A changelog.
- A postmortem archive.
- A verification report.
- A place to preserve decisions.

Those have different lifecycle rules. A backlog should become shorter as work ships; a changelog should be append-only. Combining them guarantees that completed work remains in the apparent queue.

### 3. Point-in-time audits are not labeled as snapshots

Audits correctly describe the repository on the day they are written, but filenames and titles such as “Code Review” or “Auth UX Audit” make them look perpetually current. When fixes land, the original analysis becomes partially false without any visible status change.

### 4. Implementation sessions close code tasks but not documentation tasks

The definition of done has focused on code, tests, and shipping. The implementing session often updates the nearest todo line but not every README, runbook, handoff, portfolio claim, or earlier audit that described the old state.

### 5. Several documents claim the same authority

Vision has README descriptions, `docs/PIPELINE.md`, `docs/image-pipeline.md`, `docs/next-vision-pass.md`, `data/vision.js` terminology, handoffs, and task-list claims. Accounts have a long-term spec, detailed spec, auth audit, five design handoffs, README claims, and live code. With no declared hierarchy, contradictions accumulate.

### 6. File paths and line numbers are being used as durable identifiers

Large single-file code makes line-number references tempting. As `index.html` grows, a previously accurate `index.html:1306` reference points somewhere else. Deleted scripts remain in prose because code deletion does not break a Markdown build.

### 7. External state cannot be inferred from Git

Whether Supabase email templates were pasted, whether a scheduled action ran successfully, or whether a Wikidata batch was submitted lives outside the repository. A checkbox inside Git silently ages unless it records who verifies it and when.

### 8. Fast AI-assisted development amplifies the copy problem

Each coding session receives a subset of the context and tends to optimize the immediate task. It may create a new handoff, plan, or audit rather than reconciling all earlier documents. Later assistants then read stale prose as fact and repeat it into new files. This is not specific to one model; it is the natural result of overlapping sources of truth without lifecycle metadata.

### 9. Documentation is not mechanically gated

CI checks code and data invariants, but it does not check retired script names, corpus claims, document status, or whether a shipped feature remains unchecked in a living roadmap. Staleness therefore has no failing signal.

## How to prevent recurrence

### 1. Give every document a lifecycle state

Use a small metadata block at the top of every operational, planning, audit, or handoff document:

```yaml
---
status: living | proposal | historical | superseded
owner: Kat
verified_at_commit: 053a4fd
verified_on: 2026-08-24
review_by: 2026-09-30
source_of_truth: scripts/vision-next.mjs
superseded_by: docs/audits/remediation-roadmap-2026-08-24.md
---
```

Not every field is required for every document. The important rule is that a reader can immediately tell whether the file is current authority, a proposal, or history.

### 2. Declare one source of truth per subsystem

Recommended hierarchy:

| Subject | Canonical living document | Other documents |
|---|---|---|
| Public product/architecture claims | `README.md` | Portfolio docs derive or link |
| Data/image operations | `docs/image-pipeline.md` | Merge unique `PIPELINE.md` material into it |
| Active work | `tasks/todo.md` | No completed history |
| Product horizon | `tasks/long-term-goals.md` | Concepts only; implementation links out |
| Vision definitions/counts | Generated vision report + vision inventory | README consumes generated totals |
| Reliability remediation | `docs/audits/remediation-roadmap-2026-08-24.md` | Earlier audits remain evidence |
| Decisions/rationale | Dated ADRs or historical design records | Never mixed into the active todo |

When two documents must coexist, one should explicitly say it is subordinate to the other.

### 3. Separate backlog, changelog, decisions, and postmortems

- `tasks/todo.md`: open work only.
- `CHANGELOG.md` or dated release notes: completed outcomes.
- `docs/decisions/`: why a durable architectural/product decision was made.
- `docs/incidents/`: lessons and failure reports.
- `docs/archive/`: superseded plans, handoffs, and audits.

Archiving is preferable to deletion because it preserves reasoning and portfolio evidence without presenting it as current instruction.

### 4. Generate volatile facts

Do not manually maintain:

- Pool size.
- Counts by region/era/source.
- Vision-pass coverage and overlaps.
- Audit/test counts.
- Event inventory.
- Generated-artifact inventory.

Add deterministic read-only report scripts and either:

- Embed their output into generated documentation, or
- Have CI compare documented values against the report.

For prose, prefer “the current corpus” plus a link to a generated table over copying a number into five files.

### 5. Add a documentation manifest and check

A lightweight `docs/manifest.json` could declare:

```json
{
  "README.md": { "status": "living", "owner": "Kat" },
  "docs/PIPELINE.md": { "status": "superseded", "supersededBy": "docs/image-pipeline.md" },
  "tasks/code-review.md": { "status": "historical", "verifiedAt": "85e6d6b" }
}
```

Then add `npm run docs:check` to verify:

- Relative links resolve.
- Backticked repository paths exist unless explicitly marked proposed/removed.
- Living documents do not reference a retired-script denylist.
- Required status metadata exists.
- Generated count blocks match current reports.
- A superseded document points to its replacement.
- A living document's review date has not expired without producing a warning.

CI cannot prove that prose is semantically true, but it can eliminate many repeatable drift classes.

### 6. Add documentation to the definition of done

Every behavior-changing pull request should answer:

1. Which living documents describe this behavior?
2. Which active checklist item should be removed or changed?
3. Does an old audit/spec need a historical or superseded banner?
4. Did any public number or portfolio claim change?
5. Does the new behavior require a generated report or doc invariant?

The PR should not be complete until the answer is either “updated” or “not applicable, because…”.

### 7. Make AI sessions revalidate documents before editing them

Prompts for Claude Code, Codex, or another coding agent should require:

- Treat plans and audits as evidence, not truth.
- Check document status metadata first.
- Revalidate claims against current HEAD.
- Preserve user changes and historical reasoning.
- Do not add a new plan when an existing canonical plan should be updated.
- Update the active todo and canonical runbook in the same change as implementation.
- Mark replaced documents superseded rather than silently leaving contradictions.

This prevents an assistant from faithfully implementing an obsolete plan.

### 8. Review on triggers, not only on a calendar

Calendar reviews help, but code events are better triggers. Re-audit documentation when:

- Pool size or artifact schemas change.
- A subsystem changes storage provider.
- A generator or command is deleted/renamed.
- A planned feature ships.
- A public metric is regenerated.
- A security or privacy finding changes the product's claims.
- A portfolio/application package is prepared.

A monthly review can catch leftovers, but the implementation that creates drift should also trigger the update.

### 9. Give external state an explicit verifier

For tasks such as Supabase templates or Wikidata submissions, record:

```yaml
status: needs-manual-verification
verified_by: null
verified_on: null
verification_method: Supabase Dashboard > Authentication > Email Templates
```

Do not allow an unowned checkbox to stand in for inaccessible external state.

### 10. Prefer stable symbols over line numbers

Reference `renderAccount()` or `api/delete-account.js` rather than `index.html:1643`. If a precise anchor is required, use it only in a dated audit and make clear that the line number belongs to `verified_at_commit`.

## Recommended cleanup sequence

### PR 1 — Correct dangerous current claims

- Fix `P276` → `P195` in long-term goals.
- Correct README account-deletion and device-ownership claims.
- Correct README vision coverage/nomenclature and corpus size.
- Add an explicit warning to the existing wrong-art eval.
- Remove the deleted Codex-loop instructions from the operational pipeline.

No archiving or broad prose cleanup in this PR.

### PR 2 — Establish document states

- Add lifecycle metadata or visible banners.
- Mark historical audits/specs/handoffs historical.
- Mark the auth audit superseded by the reliability audit.
- Mark the teach-shard plan implemented.
- Preserve all content initially; do not delete.

### PR 3 — Rebuild living planning documents

- Replace `tasks/todo.md` with open items only.
- Rewrite `tasks/long-term-goals.md` as a conceptual horizon.
- Recompute coverage priorities.
- Replace or retire `docs/next-vision-pass.md` and `docs/tier2-plan.md`.
- Consolidate overlapping pipeline runbooks.

### PR 4 — Mechanize freshness

- Add deterministic vision and coverage reports.
- Add a documentation manifest/status convention.
- Add `docs:check` and CI enforcement for mechanical drift.
- Replace copied counts in README/showcase with generated values or checked blocks.

### PR 5 — Refresh external-facing evidence

- Update showcase and case study from current generated evidence.
- Qualify fail-closed and human-review claims precisely.
- Update the monetization event model.
- Clearly label dated legal and URAA work.

## Completion criteria

The documentation cleanup is complete when:

- No living document directs a reader to a deleted script or data source.
- No living document claims account deletion or device ownership properties the code does not provide.
- Wikidata collection give-back consistently uses `P195`.
- Active task lists contain open work rather than completed implementation history.
- Every plan, audit, and handoff visibly declares whether it is living, proposed, historical, or superseded.
- Pool, coverage, and vision counts come from deterministic reports.
- The canonical vision terminology is consistent across README and runbooks.
- Historical reasoning is preserved without looking operational.
- CI catches broken links, missing referenced paths, retired commands, missing status metadata, and checked numerical blocks.
- External-facing portfolio claims can be traced to current evidence.

## Claude Code handoff prompt

```text
Continue the audit-verification job in:

/Users/kathrynswint/Documents/artguessr

You already revalidated the reliability and vision audits at HEAD 053a4fd and
created:

- docs/audits/finding-ledger-2026-08-24.md

Do not create a second verification ledger and do not repeat the full six-agent
verification unless HEAD has changed. Begin by checking HEAD and the worktree.
Preserve all uncommitted user work.

A fourth report now exists. Read it and the existing ledger completely:

- docs/audits/markdown-staleness-audit-2026-08-24.md
- docs/audits/finding-ledger-2026-08-24.md

Treat the new report and your ledger as evidence to verify, not unquestionable
truth. Revalidate only the new Markdown-staleness claims and contradictions;
do not redo already verified reliability or vision counts.

Your only authorized edit in this pass is
`docs/audits/finding-ledger-2026-08-24.md`. Correct and extend that file:

1. DOC-5 is currently wrong. `tasks/todo.md:28` still calls `data/vision.js` a
   dead bank, `git diff -- tasks/todo.md` is empty, and `index.html` still loads
   `ARTEFACTUM_VISION` and uses it for runtime pins. Revalidate the current
   lines and mark the documentation finding accurately; it is not
   "Already-fixed (this session)."
2. Remove the stray literal `</content>` at the end of the ledger.
3. Revalidate the staleness report's new findings and add stable DOC IDs for
   confirmed items not already represented, including the P195/P276 error,
   account-deletion claims, obsolete pipeline commands, stale task/plan status,
   and outdated generated counts.
4. Add a lifecycle table covering every Markdown file: `living`, `proposal`,
   `historical`, or `superseded`. Cite current evidence and name the replacement
   for anything superseded.
5. Reconcile the ledger with the existing remediation roadmap. Do not create a
   second roadmap.
6. Correct the PR-1 description: there are now four audit reports plus the
   ledger. Keep the untracked recognition candidate file preserved but outside
   PR 1 unless Kat explicitly approves committing research candidates.
7. Correct the first-code-PR advice. Tests that intentionally fail against HEAD
   are useful during test-driven development but are not independently
   mergeable into a green branch. Either make PR 2 a passing test-harness-only
   change, or put the hostile-device regression tests and the narrow fix in the
   same PR, demonstrating that the tests fail before the fix and pass after it.

Preserve the correct nuances already recorded for GEN-6, DOC-6, DOC-7, and the
foreign-device deletion table set. Do not infer that an artifact is removable
merely because it is duplicate or apparently unreferenced.

Do not edit product code, other documentation, generated artifacts, data,
configuration, or tests. Do not delete, move, commit, or push anything. After
updating the ledger, run read-only link/path and formatting checks and report
the exact corrections for approval.
```
