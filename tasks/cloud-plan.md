# Cloud plan: nightly pipeline and phone-first development (draft, 2026-09-30)

Goal: during a month of travel, the Pass B pipeline keeps running overnight with the laptop closed, stays within
the Max 5x weekly budget automatically, and the owner can develop and review from a phone (Claude and Codex).
Nothing here runs until the owner authorizes it; one Codex review before the first cloud night.

## Who does what

| Where | Role |
|---|---|
| **Claude Code Routines** (scheduled cloud sessions, Max usage pool) | The nightly pipeline: hourly runs 00:00–08:00 PT, each a short paced chunk that commits its results. |
| **Claude cloud sessions from the phone app** | Development, reading reports, "run now", fixing issues; pushes to `claude/*` branches. |
| **Codex cloud (ChatGPT app)** | Independent review of branches and PRs and second opinions. Exact capabilities to be confirmed by Codex itself. |
| **Laptop** | Optional. When home, it imports the cloud evidence and verifies it. It never runs at the same time as the cloud. |

## Where the evidence lives

Today about 3.2 GB of pipeline evidence exists only on the laptop. In cloud mode the private repo
`katswnt/gesso-pass-b-evidence` becomes the source of truth:
- **Per-work bundles.** Stage completions, transcripts, reservations, meta, and saved source-page snapshots, in the
  bundle format built for the September cloud lane. Every bundle is re-verified on import (hashes plus full
  re-derivation), so a bad or tampered bundle is rejected.
- **No images in git.** They are re-fetched by B0's broker (the cloud lane already did this with Full network),
  and each is hash-checked against its recorded digest.
- **Only the working set is needed.** A routine checks out only the current 30-day window's works
  (sparse checkout), not all 854+.
- **Run-level state in the repo.** Ledger, execution epochs (now including the model, see option B), `fatal.json`,
  and a `status.json` summary. Append-only where the local collector is append-only.

## One nightly chunk (a Routine run)

1. Check out the code repo branch and the evidence repo window (sparse).
2. **Gates, before any call:** the lease is free (no laptop or other routine holding it), no preserved fatal,
   inside 00:00–08:30 PT, and the **pacing rule** says go. Otherwise record why and exit.
3. Take the lease (a commit in the evidence repo; the first push wins, and a losing run exits).
4. Run up to N calls (collection, then claim-first for window works), re-checking pacing after every call.
5. Verify the new bundles locally, commit them with `status.json`, push, and release the lease.
6. On a fatal stop: write `fatal.json`, push, open a GitHub issue (phone notification). All later runs refuse.

The length of a single routine run isn't documented, so chunks stay short (about 30–45 minutes). A killed chunk
leaves only terminal reservations and is never retried, which the runner already handles.

## Pacing rule (built with option B; works on laptop or cloud)

It reads `rate_limit_event` (seven_day and five_hour utilization plus resetsAt) from the newest transcript. No
extra model calls.
- **Full night:** weekly use ≤ the fraction of the week elapsed (weekly reset Thursday 04:00 PT).
- **Half night:** up to about 5 points ahead of pace.
- **Stop:** further ahead, or weekly ≥ about 85% (hard floor), or 5-hour ≥ about 90%.

## Phases

0. **Laptop, offline (next):** option B (model per epoch; Sonnet 5.5 for new collection), the pacing gate, and a
   nightly job of collection plus claim-first. Tests against real transcripts.
1. **Evidence repo as source of truth:** a sync tool (laptop → repo for window works), cloud checkout, lease,
   `status.json`, and a fatal → GitHub issue. Tests with fixture bundles.
2. **Routine setup:** the network environment (Full, as the image hosts need), a setup script and the schedule.
   The owner does anything that needs the claude.ai UI; the rest I set up by CLI or API.
3. **Pilot night after the weekly reset:** a small cap (about 5 works). It confirms child `claude -p` inside a
   routine, chunk timing, pushes and the pacing reading. Then the full nightly.
4. **Travel mode:** routines on, laptop off. The morning check is `status.json` / a status page on the phone.
   Import to the laptop when home.

## Codex review corrections (2026-09-30), to build before any unattended cloud run

- **Save each reservation remotely BEFORE spending**, save each outcome promptly, and stop if persistence fails.
  A reservation on a reclaimed VM that was never pushed is a lost unknown outcome. (The draft wrongly said killed
  chunks leave terminal reservations.)
- **The export format must be complete.** `scripts/pass-b-cloud-bundle.mjs` currently excludes reservations and
  epochs and covers only finished B1–B3. Cloud mode needs reservations, epochs (the model per epoch, VSD-054),
  claim-first stage runs, and fatal findings, clearances and their evidence, even for works outside the window.
- **Lease:** one designated state branch; the first successful push wins and losers exit. Never auto-merge a
  losing claim, and never steal an expired lease. The laptop honours the same lease.
- **Pin the code revision and evidence branch** explicitly in the routine; never rely on the default checkout.
- **Checkout:** sparse checkout still downloads history, so measure the first checkout and use a partial clone
  if needed. Re-fetching images detects changed bytes but can't recover the original, so keep the exact evidence
  images somewhere durable.
- **Time zone and cost:** schedule in America/Los_Angeles with the 08:30 start cutoff and 09:00 finish deadline.
  Disable paid overage while the requirement is $0 incremental spend.
- **Pilot unknowns:** nested `claude -p` auth, model and transcript behaviour inside a Routine, VM expiry and
  restart. Prove them with the 5-work pilot.
- **Codex's role while travelling:** hosted Codex Cloud tasks from the ChatGPT app (laptop off), plus
  `@codex review` on GitHub PRs from a phone. Codex scheduled tasks are for status checks, not a durable
  pipeline runner.

## Still not built (needed for launch, independent of the cloud)

Publishing verified copy to the live game (guarded approval/publish with rollback), and a final check of each text
after trimming: the assembler joins surviving sentences with no coherence check yet. Neither blocks a quarantined
cloud pilot; both can be developed from phone sessions during travel.

## Open questions

- Departure date. It decides whether phases 1–3 must finish before leaving.
- Codex's own capabilities (cloud tasks from mobile, scheduling, metering), from its reply to the review brief.
