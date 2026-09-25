# Corpus Pass B (B0–B3) collector — stopped; offline handoff

Read `AGENTS.md`, then all of `docs/vision-system.md` and `docs/PIPELINE.md` before pipeline work.
This handoff does not authorize model calls. The collector remains stopped pending explicit owner spend
instruction and review of the `/4` changes.

## Safe offline checks

```bash
node --check scripts/pass-b-corpus-collect.mjs
node tests/pass-b-corpus-collect.test.mjs
node scripts/pass-b-corpus-collect.mjs
```

Default invocation is read-only, including the ledger and migration tree. Tests use isolated scratch
fixtures. If an authorized history repair is needed, `--repair-history` copies only verified missing raw
files and repairs evidence-derived ledger state under the exclusive run lease; it cannot call a model or
fetch an image. The 2026-09-22 repair is complete: 75 raw files restored for 25 migrated works, ten genuine
failures re-held, 416 verified completions, 129 done / 23 held / 500 preserved attempts.

## Later owner-authorized collection

`PASS_B_CORPUS_LIVE=1 node scripts/pass-b-corpus-collect.mjs --run` is the live entry point; do not run it
from this handoff alone. The scope is Pacific today plus the following 29 dates, earliest date first,
with no fall-through to Easy or the rest of the corpus. Every stage/retry must start 00:00–08:30 Pacific;
clients finish or are terminated by 09:00. Foreground invocation does not bypass these limits.

The evidence directory stays `data/incoming/vision-calibration/corpus-b3-6401bc543ead/` under the banked
`passBCorpusCollector/2` input/acceptance contract. Runtime `/4` is bound before new calls by append-only
`execution-policies/` epochs, including the exact installed CLI version. Each reservation verifies against
its own epoch. Children use `DISABLE_AUTOUPDATER=1`. Patch-level CLI updates are accepted automatically and recorded (VSD-046); any other drift pauses until an explicit reviewed offline
`--rebind-runtime <review.json>` appends a successor; old attempts are never relabeled. See the
[review artifact and recovery procedure](PIPELINE.md#reviewed-runtime-rebind-and-fatal-recovery). Historical completion envelopes are preserved, including their older
`runtimeVersion:unknown`; their transcripts remain the CLI-version evidence.

The requested primary model is `claude-sonnet-4-6`; wrong provenance/model results fail fatally; CLI drift pauses
and stops future calls pending the reviewed rebind. **Capability correction:** this checks returned evidence; it cannot prevent a
provider from serving a wrong model before detection. Claude Code may also use Haiku internally to
summarize fetched pages, so this is not a guarantee of exclusively Sonnet token usage.

Never make a throwaway model call to probe remaining capacity. Usage limits pause collection; resume
only when reset evidence and the permitted time window allow it. Genuine validation failures remain
terminal even without a hold reason. Fatal records and preserved fatal attempt evidence stop the whole
run across restarts. Operational exceptions pause without creating `fatal.json`; unknown fresh reserved
outcomes still stop resume for review. An observed 09:00 deadline termination pauses, while an earlier
hang timeout is held. A B2 validation failure followed by usage rejection retains only its one unspent
conformance retry; it cannot regain a fresh two-attempt budget across resumes. Do not delete evidence, reset a
fatal, or use blind requeue to manufacture resumability. Well-formed dead-PID leases can be recovered by
the collector; active/malformed ownership is preserved.

B4, auto-policy, approval, owner decisions, daily rescheduling, and production writes are outside this
collector. Do not modify B1–B3 prompts/schemas while collecting, the uncommitted VSD-038 prototype, or
`pass-b-edit-pass.mjs`, `pass-b-edit-pass-diff.mjs`, `pass-b-write-resolutions.mjs`.

The older handoff's automatic resume and throwaway usage-probe advice is explicitly superseded by this
2026-09-22 correction and VSD-041/042/045. A fresh operator should present the concrete intended live
scope for owner authorization if no such authorization exists in the active session.

F2 remains a blocker before publication: this collector compares B0 legacy inputs to live content,
so publication would currently cause a whole-plan drift failure. Frozen legacy baselines and per-work
staleness are not implemented. The wrong-image repair queue and window replacement mechanism also
remain follow-ups; no image or daily schedule was changed. Existing unrelated scratch files and old
leases were preserved. The current 73 collector regressions are offline only.
