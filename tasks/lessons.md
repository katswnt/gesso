
## 2026-08-14 — Gate chained after commit with `;` (again)
Ran `check-pool | tail ; git add ; git commit ; git push` as one command. `;` runs every
step regardless of exit code, so a FAILED gate (ledger-missing escalated to hard) still got
committed AND pushed to prod. The img swaps were correct, but shipping with a red gate is the
violation. RULE: run `node scripts/check-pool.mjs` as its OWN Bash call, READ "✅ PASS" in the
output, and only THEN run a separate commit call. Never join gate and commit with `;` or `&&`
in the same invocation. (Reinforces memory gesso-gate-before-commit.)

## 2026-09-22 — Safety check written against synthetic transcripts, not real ones
My review told Codex to make "any `*tool_use` block fatal" for the tool-less B4 canary. In reality, Claude
Code returns `--json-schema` output through a built-in `StructuredOutput` tool_use, and all 49 historical B4
transcripts contain it. The offline tests used hand-made transcripts without that event, so they passed. The
first live smoke then spent 2 of its 10 slots: St. John was fatal on its own valid answer, and La Gloire hit
a 6-minute timeout that was never sized against real B4 durations (up to ~5 min historically, longer under
/3). RULE: any provenance, tool, or timeout gate must be regression-tested against at least one REAL preserved
transcript from the same stage and CLI version, and timeouts must come from the measured duration
distribution with headroom. Synthetic fixtures are additions, never substitutes.

## 2026-09-29 — Collapsed separate failures into one cause, and let a coarse metric stand
After the four-call shadow audit I reported "6/6 known holds caught" and said "the cause is the evidence, not the
model." Both were wrong. Every known-failure component was held only because of a NEIGHBOURING unsupported
sentence; the error-bearing assertion itself was routed to visual-only (wings, pose, lion), never extracted
(the wings question's presupposition), or ignored despite supplied contradicting evidence (Carnavalet
"sommeil"). Missing evidence explained the holds on owner-supported copy; the audit's reasoning failures were a
separate problem that more evidence does not fix. RULE: score detection at the level of the specific error
(identified / partial or ambiguous / routed elsewhere / not extracted), never "component held". Before naming a
single cause, check each failure class against the saved outputs and list every independent cause.

## 2026-09-29 — Reported a held verdict as detection, a hypothesis as a cause, and doubted a correct label
After the eight-pair judgment test I (1) said J2 showed the model handled "Glory above", although its reason
only addressed the coffin, never the position; (2) said the full audit's failures "look tied to the extraction
workload", which is a plausible hypothesis, not an established cause; (3) floated relabelling J7 when the model's
verdict rested on its own unsupported assertion. RULE: credit detection only when the model's stated reason names
the specific error; label causes as hypotheses unless an experiment isolated them; when a model result disagrees
with a pre-registered label, test the model's reasoning against the evidence before questioning the label.

## 2026-09-30 — `git add <directory>` swept protected untracked files into a pushed commit
Staging with `git add scripts tests` picked up the owner/Codex prototype files that must stay untracked (edit-pass,
VSD-038 release-grounding, staging-pilot scripts), and the commit was pushed. Fixed by `git rm --cached` in a follow-up
commit (files on disk verified unchanged by hash); they remain in the branch history. RULE: in this repo, always stage
explicit file paths, never a directory or `-A`, and read `git status --short` BEFORE committing, not after.
