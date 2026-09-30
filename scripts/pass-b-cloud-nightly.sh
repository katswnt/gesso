#!/usr/bin/env bash
# Cloud nightly chunk (run by a Claude Code Routine; see tasks/cloud-plan.md). Safe to fire several times a night:
# pacing, hours and the lease decide whether it does anything. Never merges, never steals a lease, never publishes.
#  1. Clone the private evidence repo's state branch; read the OWNER-PINNED code commit (state/pin.json).
#  2. Run from a clean worktree at exactly that commit; its data/incoming is the evidence checkout's incoming/.
#  3. Take the lease (first push wins; a held lease means another run is active or died: exit and report).
#  4. Nightly job (claim-first for nearest dailies, then collection). Every reservation is pushed before its call.
#  5. Write state/status.json and release the lease.
set -euo pipefail
REPO_DIR="$(git rev-parse --show-toplevel)"
EV="${PASS_B_EVIDENCE_DIR:-$HOME/gesso-pass-b-evidence}"
BRANCH="claude/pass-b-state"
HOLDER="routine-$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [ ! -d "$EV/.git" ]; then git clone -q --depth 1 --branch "$BRANCH" https://github.com/katswnt/gesso-pass-b-evidence.git "$EV"; fi
git -C "$EV" config user.name "Gesso Pass B (cloud)"; git -C "$EV" config user.email "pass-b-cloud@users.noreply.github.com"
# An attached repo is cloned on its default branch: always switch to the state branch (never merge into main).
git -C "$EV" fetch -q origin "$BRANCH"
if [ "$(git -C "$EV" rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then git -C "$EV" checkout -q -B "$BRANCH" "origin/$BRANCH"; fi
git -C "$EV" pull -q --ff-only origin "$BRANCH"
PIN="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$EV/state/pin.json','utf8')).commit)")"
WT="$(mktemp -d)/gesso"
git -C "$REPO_DIR" fetch -q origin "$PIN" 2>/dev/null || git -C "$REPO_DIR" fetch -q origin
git -C "$REPO_DIR" worktree add -q --detach "$WT" "$PIN"
ln -s "$EV/incoming" "$WT/data/incoming"
cd "$WT"
export PASS_B_REMOTE_EVIDENCE="$EV" PASS_B_NIGHTLY_LIVE=1 PASS_B_CORPUS_LIVE=1 PASS_B_MAX_CALLS="${PASS_B_MAX_CALLS:-60}"
echo "pinned code $PIN | evidence $(git -C "$EV" rev-parse --short HEAD) | cap $PASS_B_MAX_CALLS calls | holder $HOLDER"
set +e
# Rehearsal (PASS_B_CLOUD_DRY=1): everything above for real, then the read-only plans only: no lease, no calls, no pushes.
if [ -n "${PASS_B_CLOUD_DRY:-}" ]; then
  node scripts/pass-b-nightly.mjs; node scripts/pass-b-corpus-collect.mjs | head -6
  node scripts/pass-b-cloud-lease.mjs status | head -12; echo "DRY RUN COMPLETE (claude on PATH: $(command -v claude || echo MISSING); CLI $(claude --version 2>/dev/null | head -1))"; exit 0
fi
node scripts/pass-b-cloud-lease.mjs acquire "$HOLDER"; LEASE=$?
if [ $LEASE -ne 0 ]; then node scripts/pass-b-cloud-lease.mjs status; exit 0; fi
node scripts/pass-b-nightly.mjs --run ${PASS_B_COLLECT:+--collect} 2>&1 | tee /tmp/pass-b-nightly.log; RUN=${PIPESTATUS[0]}
SUMMARY="$(tail -3 /tmp/pass-b-nightly.log | tr '\n' ' ' | cut -c1-400)"
node scripts/pass-b-cloud-lease.mjs write-status "$(node -e "console.log(JSON.stringify({summary: process.argv[1], exit: Number(process.argv[2]), holder: process.argv[3], pinnedCommit: process.argv[4]}))" "$SUMMARY" "$RUN" "$HOLDER" "$PIN")"
node scripts/pass-b-cloud-lease.mjs release "$HOLDER"
exit $RUN
