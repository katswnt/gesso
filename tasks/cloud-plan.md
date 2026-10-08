# Cloud plan: nightly pipeline and phone-first development (draft, 2026-09-30)

Goal: during a month of travel, the Pass B pipeline keeps running overnight with the laptop closed, stays within
the Max 5x weekly budget automatically, and the owner can develop and review from a phone (Claude and Codex).
Nothing here runs until the owner authorizes it; one Codex review before the first cloud night.

## Who does what

| Where | Role |
|---|---|
| **Claude Code Routines** (scheduled cloud sessions, Max usage pool) | The nightly pipeline: three scheduled firings (currently 07:00/10:00/13:00 UTC, or 00:00/03:00/06:00 PDT); the runner enforces Pacific hours and a shared call cap. |
| **Claude cloud sessions from the phone app** | Development, reading reports, "run now", fixing issues; pushes to `claude/*` branches. |
| **Codex cloud (ChatGPT app)** | Independent review of branches and PRs and second opinions. Exact capabilities to be confirmed by Codex itself. |
| **Laptop** | Optional. When home, it imports the cloud evidence and verifies it. It never runs at the same time as the cloud. |

## Where the evidence lives

The private repo `katswnt/gesso-pass-b-evidence`, branch `claude/pass-b-state`, has been seeded
with the complete evidence tree (13,733 files, 2.71 GB at seeding). It becomes the execution source of truth:
- **Complete run state**, including reservations, outcomes, completions/raw, snapshots, execution epochs,
  fatal findings/clearances and the evidence those records bind. The old September cloud bundle omits
  reservations and epochs; it is historical 4.6 interchange only, not this runner's resume format.
- **Exact images are in the evidence repo.** Re-fetching alone cannot recover changed historical bytes.
- **Full working-tree checkout, shallow history.** Sparse window checkout is not implemented and would
  need to retain out-of-window fatal/clearance evidence too. No such redesign is needed for this pilot.
- **Run-level state:** the shared lease, owner code pin, call/probe allowance and status summary. Append-only
  where the collector is append-only; status/ledger remain convenience artifacts, not terminal authority.

## One nightly chunk (a Routine run)

1. Check out the evidence state branch and run the owner-pinned code in a clean worktree.
2. Take the shared lease: exclusive local creation, then first successful remote push wins. A loser exits;
   a dead run's lease is never stolen. Laptop native collection/nightly calls require the same lease.
3. Check global preserved fatal/pause state, Pacific hours and pacing before each reservation.
4. Run claim-first end to end for nearest verified dailies, then collection if requested. One durable
   **30-call pilot allowance total**, shared across both processes, restarts and all schedule firings.
5. Push every reservation, shared allowance and necessary inputs before the call. Collection pushes
   B0/image/epochs and each captured stage promptly. Push outcomes and completed copy; stop on failure.
6. Push `state/status.json` and release the lease on clean completion/pause. Abnormal exits retain the
   lease for deliberate owner recovery. Fatal-to-GitHub-issue alerts are **not built**.

The Routine's lifetime and nested CLI behavior need pilot confirmation. Correctness does not depend on
surviving an entire work: a lost VM leaves a remotely durable reservation that cannot silently be retried.
The scheduled UTC hours shift relative to Pacific time at DST; the runner's Pacific gate remains authoritative.
**Owner 2026-10-08:** the wrapper default is now `PASS_B_MAX_CALLS=150` per Pacific night, with the allowance id
`nightly-<Pacific date>` shared by that night's firings. The 30-call pilot (`pilot-30`) is preserved and spent (all 30 calls
used 2026-10-02). Weekly usage pacing still applies. Do not change the cap or id scheme without owner authorization.

## Pacing rule (built with option B; works on laptop or cloud)

**Built as VSD-055.** Every transcript's `rate_limit_event` (both windows, each with its own resetsAt) is logged
with its observation time. Before every reservation: go only if weekly use is below min(85%, elapsed fraction of
the week + 3 points) and five-hour use is below 90%. A missing, stale (>3 h) or pre-reset reading never counts as
zero. Pacing `/2` requires both windows to be fresh for normal operation; a stale high reading still
blocks until its reset. Two probe calls are shared across restarts for the same telemetry/reset state;
partial readings cannot repeatedly replenish them. The durable shared pilot cap is the backstop. The
usage log and allowance file live in the evidence repo, and allowance + reservation are pushed together.

## Phases

0. **Offline implementation:** VSD-054 model epochs, VSD-055 pacing and VSD-056 nightly job exist.
   The 2026-09-30 review repairs add global fatal handling, incremental frozen work inputs, zero-call
   copy recovery, complete prerequisite persistence, shared pacing/caps and lease exclusion.
1. **Persistence:** seed/checkout/lease/status implemented. The repair uses the complete checkout;
   no new bundle format. GitHub-issue alerts remain deferred.
2. **Routine configuration:** a Routine and environment exist; this offline repair changes neither
   their state nor the owner pin. The corrected code needs a later reviewed commit/pin update.
3. **Pilot:** owner-authorized 30 calls total; confirm nested CLI auth/model, push permissions, restart
   behavior and telemetry. A usage reset is not a fresh pilot authorization or allowance.
4. **Travel mode:** only after the pilot and owner go-ahead. Morning checks read `state/status.json`;
   laptop and cloud use the same lease/evidence rather than running independent collectors.

## Original review corrections (2026-09-30; implementation status clarified above)

- **Save each reservation remotely BEFORE spending**, save each outcome promptly, and stop if persistence fails.
  A reservation on a reclaimed VM that was never pushed is a lost unknown outcome. (The draft wrongly said killed
  chunks leave terminal reservations.)
- **The export format must be complete.** `scripts/pass-b-cloud-bundle.mjs` currently excludes reservations and
  epochs and covers only finished B1–B3. The current full-checkout path retains reservations, epochs (the model per epoch, VSD-054),
  claim-first stage runs, and fatal findings, clearances and their evidence, even for works outside the window.
- **Lease:** one designated state branch; the first successful push wins and losers exit. Never auto-merge a
  losing claim, and never steal an expired lease. The laptop honours the same lease.
- **Pin the code revision and evidence branch** explicitly in the routine; never rely on the default checkout.
- **Checkout:** sparse checkout still downloads history, so measure the first checkout and use a partial clone
  if needed later. The implemented pilot uses a full shallow checkout and retains exact image bytes.
- **Time zone and cost:** schedule in America/Los_Angeles with the 08:30 start cutoff and 09:00 finish deadline.
  Disable paid overage while the requirement is $0 incremental spend.
- **Pilot unknowns:** nested `claude -p` auth, model and transcript behaviour inside a Routine, VM expiry and
  restart. Measure them within the authorized 30-call pilot; work count depends on stage applicability.
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
