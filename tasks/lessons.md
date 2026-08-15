
## 2026-08-14 — Gate chained after commit with `;` (again)
Ran `check-pool | tail ; git add ; git commit ; git push` as one command. `;` runs every
step regardless of exit code, so a FAILED gate (ledger-missing escalated to hard) still got
committed AND pushed to prod. The img swaps were correct, but shipping with a red gate is the
violation. RULE: run `node scripts/check-pool.mjs` as its OWN Bash call, READ "✅ PASS" in the
output, and only THEN run a separate commit call. Never join gate and commit with `;` or `&&`
in the same invocation. (Reinforces memory gesso-gate-before-commit.)
