# Guide regeneration pipeline — RETIRED (G-03)

> **This pipeline is retired. Do not run `scripts/guides-regen.mjs` — it is a fail-closed tombstone.**

The old flow spawned tool-capable Sonnet agents that read corpus context off disk and wrote model output
straight into `data/teach-works.js` (the `guide` field) — a raw model-output sink with no human approval and no
provenance binding. G-03 closes every such path: model-derived content reaches `teach-works.js` **only** through
the reviewed, hash-bound merge (`scripts/curate-merge.mjs --run <runDir>`), never from a tool-capable agent.

## The "Ask the Guide" Q&A is a DEFERRED capability

The study-guide Q&A is **not** part of the security-only tool-less pass (which does notes/pins + image QA only).
Rebuilding richer per-work Q&A is a deferred follow-up that must run on the **same secure path**:

1. **Broker + select** — `node scripts/vision-next.mjs …` fetches each image through the hardened broker
   (`scripts/lib/img-broker.mjs`) into a run-scoped dir with a URL-free provenance manifest.
2. **Tool-less completion** — `node scripts/vision-audit-run.mjs <runDir>` (cost-gated, never in CI): one
   multimodal completion per work, **no `tools`**, no agent wrapper, no shell/fs/net. The Q&A schema would be
   added to `scripts/lib/vision-run.mjs` as new completion fields, strictly validated (enums/bounds/no-HTML).
3. **Human field-level review** — `scripts/vision-review.mjs` writes `approved.json` copying the exact approved
   values + `completionSha256`.
4. **Hash-bound merge** — `scripts/curate-merge.mjs --run <runDir>` verifies every binding and applies **only**
   the approved values.

Until that schema + review UX is built, there is no supported guide-regeneration path. See the G-03 boundary in
`docs/image-pipeline.md` and the memory `gesso-vision-security-boundary`.
