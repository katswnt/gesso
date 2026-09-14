# Pass B — bounded integrity repair (post-Codex)

Constraints: offline only; no model/network; no rerun of the 50 works; preserve `cal50-0a47b6f7f332`;
no merge/commit/push/production write.

## Shared groundwork
- [x] parseStreamTranscript: capture `init` (apiKeySource, claude_code_version) + tool_result head+tail text

## Fixes
- [x] 1. VALIDATION_CONTRACT_VERSION in contractHash/runId (calibrationContract/contractHash helpers, regression)
- [x] 2. Resume evidence via verifyStageEvidence (raw+transcript SHA, model, apiKeySource, B1/B3 Read, B2 web, B4 hydration); fabricated transcript SHA fails
- [x] 3. Stale vs corrupt (loadOrArchiveCompletion): corrupt/missing-promptHash → preserve + throw; stale → verify old, archive to stale/, rerun; 3 regressions
- [x] 4. Tool-evidence edge cases: Read needs id + non-error image result; WebSearch needs non-error result; WebFetch via head+tail
- [x] 5. Source host normalization (decode/lowercase/strip terminal dots); 4 regressions
- [x] 6. Player caps restored (proposedWhy=500, note body=600) shared constants; assembler slices removed; 650-note regressions
- [x] 7. CLI version from transcript init; no-op resume doesn't rewrite manifest/packet
- [x] 8. Offline revalidation script → acceptance-report.json

## Verify
- [x] tests/vision-content-schema.test.mjs — 66 checks passed
- [x] tests/pass-b-calibration.test.mjs — 49 checks passed
- [x] syntax checks clean; git diff --check clean
- [x] revalidation: 200/200 raw/body/transcript/model/apiKeySource, 150/150 tool-evidence, 48/50 hydration-equal (+2 why-trim), 0 integrity failures

## Review
Done. All 8 fixes + shared groundwork implemented offline; no model/network; the 50 works were not rerun or
altered (200 completions, 0 stale dirs, only acceptance-report.json added). No merge/commit/push. runId is
UNCHANGED for the existing cohort; a future run with a changed VALIDATION_CONTRACT_VERSION forks the runId.
2 whys (cleveland120847=557, cleveland170810=636) flagged for manual editorial trim — not rerun.
