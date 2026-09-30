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

## Still not built (needed for launch, independent of the cloud)

Publishing verified copy to the live game, meaning the approval/publish path with rollback. This can be developed
from phone sessions during travel.

## Open questions

- Departure date. It decides whether phases 1–3 must finish before leaving.
- Codex's own capabilities (cloud tasks from mobile, scheduling, metering), from its reply to the review brief.
