# Corpus Pass B (B1–B3) collector — resume handoff

Point a fresh Claude instance at this file. It can run on **any** model; the pipeline's own
model is pinned in code and this does not change that.

## One command (resume from checkpoints)

```bash
cd /Users/kathrynswint/Documents/artguessr
# verify the collector is intact after any update, then resume:
node --check scripts/pass-b-corpus-collect.mjs
node tests/pass-b-corpus-collect.test.mjs            # must pass (offline, no calls)
PASS_B_CORPUS_LIVE=1 node scripts/pass-b-corpus-collect.mjs --run   # 4 lanes, background
```

Dry check (no calls, prints runId + queue totals + migration):
`node scripts/pass-b-corpus-collect.mjs`

Pause: `pkill -f pass-b-corpus-collect` (then remove `.../corpus-b3-*/collector.lease` only if its
PID is dead). Resume is idempotent — completed stages are skipped via verified checkpoints.

## Model guarantee (Sonnet 4.6 stays Sonnet 4.6)

- Every B1/B2/B3 call is spawned with `--model claude-sonnet-4-6` (`CALIBRATION_MODEL`), keys
  stripped, `apiKeySource:none`. The collector **fatally aborts on model drift** — it will halt
  before using any other model. The orchestrating Claude instance's model is irrelevant.
- If an update renames/removes `claude-sonnet-4-6`, the run fail-closes; fixing it is a
  `CALIBRATION_MODEL` code change (send it through Codex review), not a prompt.

## Scope — do NOT cross these lines

- **B1–B3 only.** No B4, reconciliation, release policy, approval, owner decisions, or
  production writes. (B4 is handled separately by the owner + Codex.)
- Do not alter B1–B3 prompts/schemas while collecting.
- Do not touch the protected scripts: `pass-b-edit-pass.mjs`, `pass-b-edit-pass-diff.mjs`,
  `pass-b-write-resolutions.mjs`.
- VSD-038 (release grounding) stays paused/uncommitted; don't resume it here.

## Stable artifacts

- Collector + tests: `scripts/pass-b-corpus-collect.mjs`, `tests/pass-b-corpus-collect.test.mjs`
  (committed, branch `g-03-image-agent-boundary`). Runbook: `docs/PIPELINE.md` (corpus collector bullet).
- Run dir (checkpoints + `ledger.json`): `data/incoming/vision-calibration/corpus-b3-6401bc543ead/`
  (gitignored). Deterministic runId — a fresh instance recomputes it and resumes the same run.

## Behavior to expect

- Stops cleanly on a subscription **usage-limit**; resume when the window resets (probe with one
  throwaway call, or just re-run — it fail-closes fast if still limited).
- Held works are terminal *with a recorded reason* (schema-conformance / image-fetch failures);
  usage-limit interruptions are NOT terminal and are retried on resume.
- Ledger totals (`done` / `held` / `remaining`, stage completion counts) are recomputed from the
  verified on-disk artifacts, so they're trustworthy across resumes.

## What to tell the new instance

> "Read `docs/corpus-collector-resume.md` in full, plus `docs/PIPELINE.md` (the corpus-collector
> section) and the collector `scripts/pass-b-corpus-collect.mjs`. Then, BEFORE running anything or
> making any model call, repeat back to me in your own words what you understand is happening: what
> this pipeline does, its scope and hard limits, how the model is pinned, how resume/pause and the
> checkpoints/ledger work, and exactly what command you'd run to resume. Wait for my confirmation.
> Only after I confirm: verify the collector (node --check + its test), then resume the B1–B3
> collector from its checkpoints. B1–B3 only; the pipeline is pinned to claude-sonnet-4-6 in code,
> so run on whatever model you are. Don't touch B4/reconciliation/approval/production or the
> protected scripts."

The read-back-and-wait step is deliberate: it lets you confirm the new instance (possibly a new
model after an update) has understood the scope and guardrails **before** it spends any calls.
