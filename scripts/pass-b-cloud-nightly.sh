#!/usr/bin/env bash
# Cloud nightly chunk (run by a Claude Code Routine; see tasks/cloud-plan.md). Safe to fire several times a night:
# pacing, hours and the lease decide whether it does anything. Never merges, never steals a lease, never publishes.
#  1. Clone the private evidence repo's state branch; read the OWNER-PINNED code commit (state/pin.json).
#  2. Run from a clean worktree at exactly that commit; its data/incoming is the evidence checkout's incoming/.
#  3. Take the lease (first push wins; a held lease means another run is active: exit and report. A crashed
#     automation run's lease is recovered after 90 quiet minutes, VSD-066).
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
# node_modules are not in git and package-lock.json is gitignored: install the exact versions the laptop evidence
# was produced with (sharp's version shapes the image derivatives whose hashes are recorded).
npm install --no-save --no-audit --no-fund --loglevel=error sharp@0.35.3 @vercel/blob@2.4.0
node -e "const v=JSON.parse(require('fs').readFileSync('node_modules/sharp/package.json','utf8')).version; if (v!=='0.35.3') { console.error('sharp '+v+' != 0.35.3'); process.exit(1); }"
# Boost (owner 2026-11-18, VSD-080): until PASS_B_BOOST_UNTIL (an ISO time, e.g. the weekly reset) every firing runs
# PASS_B_BOOST_WORKERS workers and a PASS_B_BOOST_MAX_CALLS cap, to use a week's otherwise-lost allowance before it
# resets; after that time the routine's plain values apply again with no edit. Pacing still decides every call.
# VSD-084 (owner 2026-11-19, "run as hard as possible"): the boost also raises the weekly pacing ceiling to
# PASS_B_BOOST_CEILING (default 0.98, the pacer's maximum; 2% stays for the owner).
# BOOST-BEGIN
if [ -n "${PASS_B_BOOST_UNTIL:-}" ] && [ "$(node -e 'process.stdout.write(Date.parse(process.argv[1]) > Date.now() ? "1" : "0")' "$PASS_B_BOOST_UNTIL")" = 1 ]; then
  export PASS_B_NIGHTLY_WORKERS="${PASS_B_BOOST_WORKERS:-6}" PASS_B_MAX_CALLS="${PASS_B_BOOST_MAX_CALLS:-1000}" PASS_B_WEEKLY_CEILING="${PASS_B_BOOST_CEILING:-0.98}"; fi
# BOOST-END
export PASS_B_REMOTE_EVIDENCE="$EV" PASS_B_NIGHTLY_LIVE=1 PASS_B_CORPUS_LIVE=1 PASS_B_MAX_CALLS="${PASS_B_MAX_CALLS:-300}"
# Cloud host, subscription rules: never inherit the historical cloud-credit lane's pacing/hours exemption.
export PASS_B_CORPUS_LANE=local
# Owner 2026-10-08: 150 calls per Pacific night, one allowance shared by that night's firings (00/03/06 PT).
# The 30-call pilot (pilot-30) is preserved and spent. Weekly usage pacing still applies on top of this cap.
# Schedule time zone (owner 2026-10-16): a setting in the evidence repo, so it can be changed from a phone.
# state/schedule.json {"timeZone": "Europe/Paris"}; default Pacific. The runner's 00:00–08:30 / 09:00 rule is local.
export PASS_B_TIMEZONE="${PASS_B_TIMEZONE:-$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$EV/state/schedule.json','utf8')).timeZone||'America/Los_Angeles')}catch{console.log('America/Los_Angeles')}")}"
# Hours (owner 2026-10-17, VSD-066): state/schedule.json "hours": "all-day" lets every firing start (cron every 2 h);
# each 2-hour slot then has its own allowance (slot-<city>-<date>-<HH>), so every firing may make up to PASS_B_MAX_CALLS.
# The city (owner 2026-11-17, back on California time) keeps a new time zone's slots from reusing allowances the old
# time zone already spent on the same local date and hour (Paris slots were slot-<date>-<HH>).
export PASS_B_HOURS="${PASS_B_HOURS:-$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$EV/state/schedule.json','utf8')).hours||'night')}catch{console.log('night')}")}"
# Scope (owner 2026-10-30, VSD-068): state/schedule.json "scope": "corpus" continues past the 30-day window down the
# priority bands (Easy, top-fame M/H/I, Medium, Hard, Impossible) once the window is done; default "window".
export PASS_B_SCOPE="${PASS_B_SCOPE:-$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$EV/state/schedule.json','utf8')).scope||'window')}catch{console.log('window')}")}"
if [ "$PASS_B_HOURS" = "all-day" ]; then SLOT_H=$(( 10#$(TZ=$PASS_B_TIMEZONE date +%H) / 2 * 2 )); DEFAULT_BUDGET="slot-${PASS_B_TIMEZONE##*/}-$(TZ=$PASS_B_TIMEZONE date +%Y-%m-%d)-$(printf %02d $SLOT_H)"
else DEFAULT_BUDGET="nightly-$(TZ=$PASS_B_TIMEZONE date +%Y-%m-%d)"; fi
export PASS_B_CALL_BUDGET_ID="${PASS_B_CALL_BUDGET_ID:-$DEFAULT_BUDGET}" PASS_B_LEASE_HOLDER="$HOLDER"
echo "pinned code $PIN | evidence $(git -C "$EV" rev-parse --short HEAD) | cap $PASS_B_MAX_CALLS calls, workers ${PASS_B_NIGHTLY_WORKERS:-3}, weekly ceiling ${PASS_B_WEEKLY_CEILING:-0.95} | time zone $PASS_B_TIMEZONE, hours $PASS_B_HOURS, scope $PASS_B_SCOPE | allowance $PASS_B_CALL_BUDGET_ID | holder $HOLDER"
set +e
# Rehearsal (PASS_B_CLOUD_DRY=1): everything above for real, then the read-only plans only: no lease, no calls, no pushes.
if [ -n "${PASS_B_CLOUD_DRY:-}" ]; then
  node scripts/pass-b-nightly.mjs || { echo "DRY RUN FAILED: nightly plan"; exit 1; }
  node scripts/pass-b-corpus-collect.mjs > /tmp/pass-b-collect-plan.txt 2>&1 || { tail -5 /tmp/pass-b-collect-plan.txt; echo "DRY RUN FAILED: collector plan"; exit 1; }; head -6 /tmp/pass-b-collect-plan.txt
  node scripts/pass-b-cloud-lease.mjs status | head -12 || { echo "DRY RUN FAILED: lease status"; exit 1; }
  echo "DRY RUN COMPLETE (claude on PATH: $(command -v claude || echo MISSING); CLI $(claude --version 2>/dev/null | head -1))"; exit 0
fi
# VSD-079: a container restart (exit 137) kills the run but keeps /tmp. The restarted launcher names the run it started
# before (only if no pipeline process survives), so its own dead lease is recovered now instead of after 90 quiet minutes.
OWN_DEAD=""
if [ -s /tmp/pass-b-holder ] && ! pgrep -f "scripts/pass-b-(nightly|corpus-collect)\.mjs" >/dev/null; then OWN_DEAD="$(cat /tmp/pass-b-holder)"; fi
echo "$HOLDER" > /tmp/pass-b-holder
node scripts/pass-b-cloud-lease.mjs acquire "$HOLDER" ${OWN_DEAD:+--own-dead "$OWN_DEAD"}; LEASE=$?
if [ $LEASE -ne 0 ]; then node scripts/pass-b-cloud-lease.mjs status; exit 0; fi
node scripts/pass-b-nightly.mjs --run ${PASS_B_COLLECT:+--collect} 2>&1 | tee /tmp/pass-b-nightly.log; RUN=${PIPESTATUS[0]}
SUMMARY="$(tail -3 /tmp/pass-b-nightly.log | tr '\n' ' ' | cut -c1-400)"
# Status via environment variables (inline JS in the shell was mangled by brace expansion in the 2026-10-01 laptop pilot).
PASS_B_STATUS_SUMMARY="$SUMMARY" PASS_B_STATUS_EXIT="$RUN" PASS_B_STATUS_HOLDER="$HOLDER" PASS_B_STATUS_PIN="$PIN" \
  node scripts/pass-b-cloud-lease.mjs write-status-env || { echo "STATUS PUSH FAILED; lease retained for review"; exit 1; }
if [ "$RUN" -ne 0 ]; then echo "RUN FAILED; lease retained for review"; exit "$RUN"; fi
node scripts/pass-b-cloud-lease.mjs release "$HOLDER"
exit $RUN
