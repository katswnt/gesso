# Repository agent instructions

The collaboration policy for this repository is **[`docs/agent-collaboration.md`](docs/agent-collaboration.md)**.
Read it before working here. It is the single source of truth; this file is only a pointer, so the
two cannot drift apart.

The short version:

- Claude Code implements coherent batches — edits, tests, local commits, and non-production branch
  pushes — without asking each time. Local commits are a safety tool, not a risk.
- Codex reviews completed milestones, not individual commits, and never edits concurrently.
- Kat's explicit approval is required only for: updating `main` or deploying to production;
  freezing or regenerating the schedule; paid API calls; destructive or hard-to-reverse external
  actions; and genuine product decisions.
- Reserve adversarial and mutation testing for security boundaries, publication authority, silent
  corruption, and data-loss risk — not ordinary code changes.
- Launch and research lanes are separate. Do not copy work between them.

## Before any vision-pipeline work

Read **[`docs/PIPELINE.md`](docs/PIPELINE.md)** before proposing, changing or running any vision
pipeline. It is the implementation runbook and the operative reference on this branch.

The canonical owner-approved product intent is `docs/vision-system.md`, which currently exists
**only in the research lane and has never been on `main`.** Until a separate owner decision brings
it across, treat `PIPELINE.md` as authoritative here.

Do not mistake a planned capability for a shipped one. Any new vision decision must follow the
maintenance protocol in the canonical record, including its dated decision log and
implementation-status update.
