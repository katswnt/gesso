# Agent collaboration policy

Canonical policy for how Claude Code and Codex work on this repository. `AGENTS.md` and
`CLAUDE.md` are thin pointers to this file so the two cannot drift apart.

Calibrated 2026-09-02 after the launch-readiness pass. The intent is to be **adversarial about
silent corruption and external side effects, pragmatic about reversible repository work.**

## Roles

**Claude Code implements.** It owns a *coherent batch*: the change, its tests, related fixes,
local commits, and pushes of a non-production branch. It reports decisions and deviations, not
every shell command.

**Codex reviews completed milestones**, not individual commits, and attacks the load-bearing
claims of a finished batch rather than re-deriving everything.

**One writer at a time.** While Claude is editing, Codex stays read-only. Never edit concurrently.

**No self-certification.** Claude reports evidence and stops; Codex reviews independently.

## Lanes

The **launch/main-fixes** lane and the **research** lane are separate. Do not read from, write
to, or copy changes between them. Recognition-pilot and vision-research work never blocks a
launch, and launch work never edits research artifacts.

## What needs Kat's approval

Only these:

- updating `main`, or any production deployment;
- freezing or regenerating the schedule (`freeze-daily.mjs`, `npm run freeze`);
- paid API calls;
- destructive or hard-to-reverse external actions, including backend writes and migrations;
- genuine product decisions.

Everything else — edits, tests, local commits, non-production branch pushes, and the preview
builds those pushes trigger — is Claude's to do without asking. **Local commits are a safety
tool, not a risk:** Git is infinite rollback on a branch nobody has pulled.

### When instructions conflict

If a bounded specification authorizes something Kat's standing instruction forbids, **Kat's
instruction wins.** Surface the conflict **once**, in that round's report, and ask her to settle
it. Do not re-litigate it every round.

## How much review a change earns

The trigger is **not** which file changed — it is whether the change can **fail silently while
reporting success.** Every serious defect found during launch readiness was of that kind:
`curate-merge` exiting 0 while half-writing authoritative files; `freeze` exiting 0 while
permanently losing ledger history; `check-pool` printing PASS over a corrupt ledger; a production
score POST that would have gone through unintercepted. None was caught by "tests pass."

| Change | Claude | Codex |
|---|---|---|
| Docs, tests, local commits | complete the batch autonomously | review with the batch |
| Static data append via validated tooling | execute, verify, commit | check the semantic diff once |
| Runtime / frontend fixes | implement, test, commit, push branch | review the completed feature |
| Canonical-data mutation logic | adversarial + mutation testing warranted | deep review once per mechanism |
| `main` update / deployment | prepare fully | **Kat approves the final action** |
| Backend writes, migrations, paid calls, freeze | stop for explicit approval | review proportional to risk |

**Adversarial and mutation testing are for security boundaries, publication authority, silent
corruption, and data-loss risk.** Exact byte/hash proofs belong on generated canonical data and
deployed artifacts — not on ordinary code changes.

## Writing a specification

State the **outcome and the genuine prohibitions.** Do not prescribe a command list.

A spec detailed enough to dictate exact commands is detailed enough to be wrong in specific ways,
and it shifts the implementer's attention from *"is this correct?"* to *"did I follow the steps?"*
— backwards for an adversarial role. During launch readiness, prescriptive specs variously would
have bricked `freeze` on real data, pinned a test to a Git ref that self-invalidated on commit,
and produced fixtures that expired at midnight.

## Warnings and blockers

A **launch blocker** is reproducible and materially impairs gameplay, scheduled content,
accessibility, security or player trust, or the ability to see, answer, submit, reveal or advance.

Everything else is a warning: it goes to a backlog and does not block a launch. Cosmetic
awkwardness and borderline metrics are not blockers unless player-visible behaviour proves harm.

## Operational rules

**Ledger reconciliation** (`npm run ledger:check` / `ledger:record`) may be run in batches. It is
**required before anything that changes or trims `data/daily-order.js`**, not once per calendar
day. It may run without a bespoke round while all of these hold: only recoverable missing dates;
no drift, corruption or missing source assignment; the change is append-only; every appended
record exactly matches `daily-order.js`; no other tracked file changes. Any deviation is owner
attention.

**Do not repeat a full smoke or mobile suite** unless the candidate gained a player-runtime
change.

**Vision pipeline.** Read [`docs/PIPELINE.md`](PIPELINE.md) before proposing, changing or running
any vision pipeline; it is the implementation runbook and the operative reference on this branch.
The canonical owner-approved intent lives in `docs/vision-system.md`, which currently exists **only
in the research lane and has never been on `main`.** Until a separate owner decision brings it
across, treat `PIPELINE.md` as authoritative here and do not assume a planned capability has
shipped. Any new vision decision follows the maintenance protocol in the canonical record.

## Re-tightening trigger

This calibration assumes **zero users**. That assumption expires.

**Once the game has real players**, runtime and frontend changes return to *review before merge to
`main`*, because the daily is live content someone is seeing and a regression stops being free.
Everything else in this policy stays as written.
