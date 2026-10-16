#!/usr/bin/env bash
# One-shot, cloud-safe schedule switch (owner 2026-10-16: "switch it to paris time"). Runs in a Claude Code cloud
# routine so the owner's laptop is not needed. Waits for any active run to release the lease, then under its own
# lease: writes state/schedule.json, appends the reviewed --rebind-schedule epoch, pins the code that contains it,
# and prints the status report. Idempotent: if the schedule already matches, it only reports.
#   bash scripts/pass-b-apply-schedule.sh Europe/Paris "<reviewed by>" "<reason>"
set -euo pipefail
TZNAME="${1:?time zone}"; REVIEWED_BY="${2:?reviewed by}"; REASON="${3:?reason}"
REPO_DIR="$(git rev-parse --show-toplevel)"
EV="${PASS_B_EVIDENCE_DIR:-$HOME/gesso-pass-b-evidence}"; BRANCH="claude/pass-b-state"
if [ ! -d "$EV/.git" ]; then git clone -q --depth 1 --branch "$BRANCH" https://github.com/katswnt/gesso-pass-b-evidence.git "$EV"; fi
git -C "$EV" config user.name "Gesso Pass B (cloud)"; git -C "$EV" config user.email "pass-b-cloud@users.noreply.github.com"
git -C "$EV" fetch -q origin "$BRANCH"
if [ "$(git -C "$EV" rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then git -C "$EV" checkout -q -B "$BRANCH" "origin/$BRANCH"; fi
# 1. wait (up to ~4h) for an active run to finish; never steal a lease
for i in $(seq 1 48); do git -C "$EV" pull -q --ff-only origin "$BRANCH" || true; [ -f "$EV/state/lease.json" ] || break; echo "lease held by $(grep -o '"holder": "[^"]*"' "$EV/state/lease.json"); waiting"; sleep 300; done
if [ -f "$EV/state/lease.json" ]; then echo "STILL LOCKED after waiting: schedule NOT changed (review the lease)"; exit 2; fi
git -C "$REPO_DIR" fetch -q origin g-03-image-agent-boundary; CODE="$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)"   # pipeline branch tip (has --rebind-schedule)
WT="$(mktemp -d)/gesso"; git -C "$REPO_DIR" worktree add -q --detach "$WT" "$CODE"; ln -s "$EV/incoming" "$WT/data/incoming"; cd "$WT"
npm install --no-save --no-audit --no-fund --loglevel=error sharp@0.35.3 @vercel/blob@2.4.0
export PASS_B_REMOTE_EVIDENCE="$EV" PASS_B_TIMEZONE="$TZNAME" PASS_B_CORPUS_LANE=local
HOLDER="schedule-$(date -u +%Y%m%dT%H%M%SZ)-$$"
node scripts/pass-b-cloud-lease.mjs acquire "$HOLDER" || { echo "could not take the lease: schedule NOT changed"; exit 2; }
trap 'node scripts/pass-b-cloud-lease.mjs release "$HOLDER" || echo "LEASE RELEASE FAILED: release by hand"' EXIT
CURRENT="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$EV/state/schedule.json','utf8')).timeZone)}catch{console.log('')}")"
if [ "$CURRENT" != "$TZNAME" ]; then
  node -e "require('fs').writeFileSync('$EV/state/schedule.json', JSON.stringify({timeZone:'$TZNAME',setBy:process.argv[1],setAt:new Date().toISOString()},null,1)+'\n')" "$REVIEWED_BY"
fi
REVIEW="$(mktemp)"
PASS_B_REVIEWED_BY="$REVIEWED_BY" PASS_B_REASON="$REASON" PASS_B_REVIEW_OUT="$REVIEW" node --input-type=module -e "
import { executionEpochs, executionPolicy, epochModel, CORPUS_RUN_DIR, SCHEDULE_REVIEW_VERSION, SCHEDULE_TZ } from './scripts/pass-b-corpus-collect.mjs';
import { sha256, stableJson } from './scripts/lib/vision-legacy.mjs';
import { writeFileSync } from 'node:fs';
const prev = executionEpochs(CORPUS_RUN_DIR).at(-1), policy = executionPolicy(prev.policy.runtimeVersion, epochModel(prev));
if (prev.policy.timeZone === SCHEDULE_TZ) { console.log('epoch already in ' + SCHEDULE_TZ); process.exit(0); }
writeFileSync(process.env.PASS_B_REVIEW_OUT, JSON.stringify({ version: SCHEDULE_REVIEW_VERSION, runId: prev.runId, fromEpochSha256: prev.sha256, toTimeZone: SCHEDULE_TZ,
  toPolicySha256: sha256(stableJson(policy)), reviewedBy: process.env.PASS_B_REVIEWED_BY, reason: process.env.PASS_B_REASON, reviewedAt: new Date().toISOString() }, null, 1));
console.log('from epoch ' + prev.number + ' (' + prev.policy.timeZone + ')');"
if [ -s "$REVIEW" ]; then node scripts/pass-b-corpus-collect.mjs --rebind-schedule "$REVIEW" | tail -1; fi
node -e "require('fs').writeFileSync('$EV/state/pin.json', JSON.stringify({commit:'$CODE',branch:'g-03-image-agent-boundary',pinnedAt:new Date().toISOString(),pinnedBy:'schedule switch to $TZNAME: '+process.argv[1]},null,1)+'\n')" "$REVIEWED_BY"
git -C "$EV" add state/schedule.json state/pin.json incoming/vision-calibration/corpus-b3-6401bc543ead/execution-policies
git -C "$EV" diff --cached --quiet || { git -C "$EV" commit -q -m "schedule: $TZNAME; pin ${CODE:0:7}"; git -C "$EV" push -q origin "$BRANCH"; }
node scripts/pass-b-corpus-collect.mjs | grep -E "date|may start|fatal" | head -3
echo "=== status report ==="; node scripts/pass-b-status-report.mjs --evidence "$EV"
echo "SCHEDULE SWITCH COMPLETE: $TZNAME"
