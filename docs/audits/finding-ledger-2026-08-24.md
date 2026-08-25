# Finding ledger — reliability + vision audits

**Created:** 2026-08-24 · **Audited HEAD:** `053a4fd` · **Owner:** Kat / Claude / Codex
**Companion reports:** [`codebase-reliability-audit-2026-08-24.md`](./codebase-reliability-audit-2026-08-24.md) ·
[`vision-pass-inventory-2026-08-24.md`](./vision-pass-inventory-2026-08-24.md) ·
[`remediation-roadmap-2026-08-24.md`](./remediation-roadmap-2026-08-24.md) ·
[`markdown-staleness-audit-2026-08-24.md`](./markdown-staleness-audit-2026-08-24.md)
**Research briefs reviewed:** `~/Downloads/recognition_probe_spec.md` · `~/Downloads/near_miss_decoy_handoff.md` ·
`~/Downloads/recognition_contamination_handoff.md`

This is the Batch-0 evidence ledger. Every finding below was **re-validated against current HEAD** (not taken from
the reports on faith), by inspecting the referenced source at file:line and running counts against the live data.
Statuses: **Confirmed** · **Already-fixed** · **Partially-fixed** · **Stale/inaccurate** · **Needs-investigation**.

**Round-2 refinements folded 2026-08-24 (adversarial review, HEAD unchanged):** `INF-6` split into `INF-6a` (new
`devices`/security cascades, PR 3/4) and `INF-6b` (base-schema tracking, PR 8); `DOC-10` marked two-stage (PR 2 + PR 4);
approval eligibility is a **composite `eligibilityHash`** incl. a `scoringPolicyHash` over executable scoring
semantics (DQ-2); Batch-8A daily gate split into **enforced PR 11a** + automated PR 11b, with freeze selecting only
eligible works and failing on insufficient approved inventory; mutable-source images ineligible-by-default; claim/bind
hardened into a `SECURITY DEFINER` DB function (SEC-1/6); `curate-merge` confirmed a direct `teach-works.js` writer
(bypasses the choke-point) and `data/notes/` shards are a derived deploy artifact (INF-2). Detail lives in the
roadmap; this ledger's evidence is unchanged.

## How this was verified (where I looked, and why)
The original review used six parallel read-only sub-audits, each inspecting the actual files at HEAD and quoting exact
lines / running node counts. A seventh read-only daily-release trace was added after the production medium/image
incidents were raised. No product or data file was edited. Method notes per cluster:
- **Security:** read `api/claim.js`, `api/sync.js`, `api/delete-account.js` fully + grepped all of `api/` for any
  ownership/nonce check. *Why:* the report claims a public identifier is trusted as proof of possession in
  authenticated destructive ops — a P0 if true.
- **Fail-open/cache:** read `scripts/scheduled-audit.mjs`, `check-image-drift.mjs`, `.github/workflows/image-audit.yml`,
  `scripts/lib/wd-cache.mjs`, `scripts/audit-local.mjs`, and how `check-pool.mjs` reads ignored review ledgers.
  *Why:* "green when coverage was lost" and "outage poisons the cache" are operational-truth blockers.
- **Generators/reproducibility:** read `build-regions.mjs`, the `normalize` chain, `ease-metric.mjs`,
  `build-authorities.mjs`, `check-pool` freshness gate; checked tracked-status of `.cache/hbm`, `aat-map.json`,
  `study-human-difficulty.json`. *Why:* clean-checkout reproducibility + fail-closed generation.
- **Research schemas + all vision counts:** read `vision-guess.mjs`, `ease-metric.mjs`, `eval-score.mjs`; ran node
  counts on `vision-audit.json`, `vision.js`, `hotspots.js`, `probe-sonnet.json`, `teach-works.js`, pool. *Why:*
  research-validity + verify every inventory number.
- **Writers/CI/DB:** grepped writers of the 3 canonical files; read `curate-merge.mjs`, `ci.yml`, `db/*.sql`,
  `.githooks`, git config. *Why:* atomicity + enforcement + reproducible backend.
- **Docs/artifacts:** verified each stale-doc claim AND proved reader/writer presence before calling anything
  removable. *Why:* the roadmap's own rule — don't delete before ownership is proven.
- **Daily-release integrity:** traced `vision-mark` → `vision-next` → `curate-merge` → ignored repair queues, then
  replay/freeze/check-pool/CI/deploy behavior and the current medium/smoke fixtures. *Why:* determine how a work already
  called “vision-audited” can still ship with a wrong fact or poor/stale image.

---

## Security — device ownership & account erasure  →  Roadmap Batch 1 (PRs 3–4) · **P0**
| ID | Finding | Severity | Status | Evidence (HEAD) | Intended change | Acceptance test | PR |
|---|---|---|---|---|---|---|---|
| SEC-1 | `claim.js` writes caller-supplied `deviceId`→`profiles.user_id` after only JWT validation (no ownership check); secret key bypasses RLS | P0 | **Confirmed — 3A partial** (devices relation + hardened `claim_device` fn committed, applied to prod & live-verified; `claim.js` still unchanged — enforcement pending 3B) | `api/claim.js:38` (JWT `:29-32`, regex `:24`, `:34`); `db/devices.sql` | Require proof of device capability; reject if device already bound to another account | Foreign-device claim rejected; already-claimed device rejected; replayed capability (reused cap / cap for another device) rejected via `UNIQUE(capability_hash)` | 3 |
| SEC-2 | `sync.js` performs the same unowned bind, then reads/merges all uid profiles + overwrites identity | P0 | **Confirmed — 3A partial** (bind fn applied to prod & live-verified; `sync.js` still unchanged / not yet on `devices.user_id` — pending 3B) | `api/sync.js:71` (`:65-68,:74,:80`) | Resolve devices server-side from authed uid; never trust body deviceId for authority | Foreign-device sync rejected; account-scoped read of foreign state impossible | 3 |
| SEC-3 | `delete-account.js` unions caller `deviceId` with account devices → deletes a foreign device's rows | P0 | **Confirmed** | `api/delete-account.js:27-32,:28` | Derive deletable devices **only from `devices.user_id = auth.uid()`** (never the caller body deviceId, never the contaminated `profiles.user_id`); delete scores/saves/profiles for exactly those device_ids. Foreign-device-deletion fix lands in **3B**; full transactional erasure incl. `events` in PR 4 | Foreign-device delete affects nothing; another account's rows untouched | 3B/4 |
| SEC-4 | Deletion omits `saves` and `events` despite "delete everything" | P1 | **Confirmed** | `delete-account.js:29-35`; tables real (`api/saves.js:7`, `api/event.js:6,56`) | Transactional DB fn deletes profiles+scores+saves+events+user_state+auth | Verify every owned table emptied | 4 |
| SEC-5 | Deletion checks no responses → returns `{ok:true}` on partial failure | P1 | **Confirmed** | `delete-account.js:30-36` | Check each step; fail on partial erasure | Forced failure at each step ⇒ non-2xx, no partial commit | 4 |
| SEC-6 | No server-side ownership capability/nonce anywhere; JWT is the only boundary | P0 | **Confirmed — 3A partial** (capability model + hardened `SECURITY DEFINER` register/claim fns applied to prod & live-verified; `api/lib` + enforcement pending 3B/3C) | grep `api/` (no `api/lib`, no nonce/ownership); `db/devices.sql` | Client-minted device capability (only its 64-hex SHA-256 hash stored, `UNIQUE`), replay resistance via `UNIQUE(capability_hash)` + first-writer-wins (no separate nonce), DB uniqueness, enforced in a hardened `SECURITY DEFINER` claim/bind function (`search_path=''`, schema-qualified, execute revoked from `PUBLIC`/`anon`/`authenticated`/`service_role` then granted only to the intended role, atomic `for update` check-and-bind, `auth.uid()`-derived identity), + rate limiting/audit logging | Capability required before claim; **replayable bearer capability** — `UNIQUE(capability_hash)` blocks cross-device reuse, but a stolen valid cap can be replayed for its **own** device (proves possession, not freshness); concurrent-claim race cannot double-bind | 3 |

**Nuance (verified):** for a *foreign* device, delete destroys the victim's `scores`+`profiles` only — `user_state`/auth-user
are keyed by the attacker's uid so they aren't hit. Still identity-hijack (SEC-1/2) + data-destruction (SEC-3). The
regression test for SEC-3 should assert the exact table set.

---

## Operational truth — fail-open audits & cache poisoning  →  Roadmap Batch 2 (PRs 5–6) · **P1**
| ID | Finding | Status | Evidence (HEAD) | Intended change | Acceptance test | PR |
|---|---|---|---|---|---|---|
| AUD-1 | `scheduled-audit` doesn't fail on nonzero-exit / no-JSON / no-result / low-coverage | **Confirmed** | `scripts/scheduled-audit.mjs:9-15,24-30,44,53` | Common child contract; fail on those conditions | All-mock-fail + malformed-child + zero-coverage exit nonzero | 5 |
| AUD-2 | `check-image-drift` skips every `qfail`; all-fail ⇒ `checked:0`, exit 0 | **Confirmed** | `check-image-drift.mjs:35-37,62-63,97` | Emit attempted/checked/unknown/coverage; fail below threshold | All-qfail run exits nonzero | 5 |
| AUD-3 | Workflow opens issue only on driver failure ⇒ verifier outage = green | **Confirmed** | `.github/workflows/image-audit.yml:28-29` | Open/update issue on low coverage too | Partial run opens issue | 5 |
| CACHE-1 | `wd-cache` seeds empty schema records, coerces failed queries to `[]`, persists ⇒ a 503 caches a valid-but-empty entity later runs trust | **Confirmed** | `wd-cache.mjs:42` seed · `:52/69/85` `||[]` · `:95` persist · `:36` trust | Stage-then-promote only after all queries succeed; states `ok`/`confirmed-empty`/`unknown`+timestamps | Mocked outage leaves cache unchanged | 6 |
| DET-1 | `audit-local` claims no-network but fields/place/style-text hit WD/Wikipedia ⇒ `npm test` not offline, leans on ignored `wd-entities.json` | **Confirmed** | `scripts/audit-local.mjs:9-11` + those scripts | Split into `audit:network`; keep `test`/`test:ci` offline | Clean archive runs `test` with no network | 8 |
| DET-2 | ignored `no-pins-reviewed.json` alters `check-pool`'s reported pin count (local vs CI diverge) | **Confirmed** | `check-pool.mjs:198,205,209`; `.gitignore:2` | Decide canonical: track it or drop the dependency | Two clean checkouts agree | 8 |

---

## Reproducibility — fail-closed generators & artifact contracts  →  Roadmap Batches 3/5 (PRs 7,9) · **P1**
| ID | Finding | Status | Evidence (HEAD) | Intended change | Acceptance test | PR |
|---|---|---|---|---|---|---|
| GEN-1 | `.cache/hbm` is a tracked machine-specific symlink → `/tmp/hbm` | **Confirmed** | `git ls-files .cache/`, `readlink`; used `build-regions.mjs:34-35` | Remove tracked symlink; ignored/configurable cache | Clean archive build path documented | 7 |
| GEN-2 | `build-regions` writes `ARTEFACTUM_REGIONS={}` and exits 0 on all-missing input (no preflight/floor) | **Confirmed** | `build-regions.mjs:220-223,231-232` (`--offline` `:36`) | Preflight inputs; min-culture floor; `--check` mode; refuse empty | Missing input ⇒ nonzero, `regions.js` byte-unchanged | 7 |
| GEN-3 | `normalize` non-transactional: writes pool+easy-exclude, then aborts at `build-authorities` on missing ignored `aat-map.json` | **Confirmed** | `package.json:11`; `build-authorities.mjs:10-11`; `resync-fame.mjs:20`; `build-easy-exclude.mjs:49` | Preflight all inputs before any write; track/snapshot `aat-map.json` | Missing input ⇒ no writes at all | 9 |
| GEN-4 | `ease.json` has 23 human records from ignored `study-human-difficulty.json` ⇒ not clean-reproducible | **Confirmed** | `ease-metric.mjs:51-53,64-65`; `"Rsrc":"human"`×23 | Track/snapshot the study input or mark output noncanonical | Clean checkout reproduces or declares source | 9 |
| GEN-5 | Authorities freshness gate is presence-only (no content/count compare) | **Confirmed** | `check-pool.mjs:382-386` | Gate exact generated content where it affects behavior | Content drift caught | 9 |
| GEN-6 | Audit's regen diff counts (29/407 scores, 297/407 ease, 3/703 authorities) | **Stale/inaccurate** | `authorities.json` = **818** not 703; `resync-fame --dry` = **0** now; `scores.json` **is** offline-reproducible (`grade-guessability.mjs:15-16,25`) | Re-measure at implementation time; don't cite these numbers | Manifest `--check` reports real drift | 9 |

---

## Research validity — recognition & eval schemas  →  Roadmap Batch 6 (PR 13) · **P1 (prereq for both briefs)**
| ID | Finding | Status | Evidence (HEAD) | Intended change | Acceptance test | PR |
|---|---|---|---|---|---|---|
| RES-1 | `stopRung:4` conflates "broke at last rung" with "survived whole ladder" (288 works = 210 survived + 78 broke) | **Confirmed (exact)** | `vision-guess.mjs:141,145`; `probe-sonnet.json` | Add `recognizedRung0`/`survived`/nullable `breakRung`, derived from `recognizedTrace`; migrate committed probe | Migrated data distinguishes 78 breaks from 210 survivors | 13 |
| RES-2 | `ease-metric` uses only `stopRung`, never the persisted `recognized` ⇒ opposite outcomes treated identically | **Confirmed** | `ease-metric.mjs:63-68` | Consume unambiguous fields; regenerate ease/scores after | Ease differs for survived vs broke | 13 |
| RES-3 | `eval-score` counts any `image.ok===false` as wrong-art; drops missing from metrics; no id/dup/schema validation | **Confirmed** | `eval-score.mjs:11,18,19-21` | Require `issue==='wrong-art'`; enforce complete/unique/schema; fail on incomplete coverage; record model/prompt/hash | Incomplete/ambiguous output ⇒ no metric report | 13 |

---

## Vision inventory & consolidation  →  Roadmap Batch 8B (PR 12) · **P2**
| ID | Finding | Status | Evidence (HEAD) | Intended change | PR |
|---|---|---|---|---|---|
| VIS-1 | Canonical ledger covers **5,972/6,557 (91.1%)**, 40 stale ledger IDs, 585 current works uncovered; README "whole corpus" claim stale | **Confirmed (exact)** | `data/vision-audit.json` (6,012 distinct); `README.md:105` | Single deterministic vision-inventory report; README reads from it; close gap by schedule/risk | 12 |
| VIS-2 | `vision.js` = 202 works, 195 have hotspots, **7 lack** a hotspot key; only pins consumed at runtime | **Confirmed (exact)** | `data/vision.js` × `hotspots.js` | Migrate the 7 pins into hotspots; preserve research fields w/ provenance; then remove `vision.js` from runtime | 12 |
| VIS-3 | "Vision v2" names two different systems (rich `vision.js` vs feature-anchored notes/pins in the canonical audit) | **Confirmed** | `index.html:3228` vs `scripts/vision-v2-{prep,merge}.mjs`, `merge-v1-to-v2.mjs`, `docs/vision-pass-v2.md` | Purpose-based names (`contentVisionAudit`, `richVisionEnrichment`, …) | 12 |
| VIS-4 | `teach-works.js` (5,973 current records) is not a valid completion ledger (mixes text + image-grounded) | **Confirmed** (audit said ~5,968) | `data/teach-works.js` | Never use as vision-completion count | 12 |
| VIS-5 | 59 stale hotspot keys (of 5,795), 28,679 pins; probe 410 durable + 23 untracked candidates (0 overlap) | **Confirmed (exact)** | `hotspots.js`, `probe-sonnet.json`, `…candidates-partial.json` | Prune stale keys during consolidation; PRESERVE the untracked 23-work candidate file | 12 |

---

## Daily-game release integrity  →  Roadmap Batch 8A (PRs 11a–11b) · **P1**
| ID | Finding | Status | Evidence (HEAD) | Intended change | Acceptance test | PR |
|---|---|---|---|---|---|---|
| DQ-1 | “Vision-audited” conflates processed with passed: `vision-mark` accepts bare IDs and records no verdict; `curate-merge` can queue a poor/wrong image while the ID is still marked complete | **Confirmed** | `vision-mark.mjs:10-22`; `curate-merge.mjs:66-76,109-113` | Versioned approval states (`pass`/`blocked`/`stale`), with failed reviews remaining ineligible | Poor/framing/wrong-image result creates `blocked`, never a production pass | 11a |
| DQ-2 | Approval is ID-only, not bound to current work/image/prompt: no URL/content fingerprint, record hash, policy/schema, model, or output provenance; later changes remain “audited” | **Confirmed** | `vision-mark.mjs:17-22`; `vision-next.mjs:18-19,34,41,50,60` | Composite `eligibilityHash` (workAnswer + imageAsset + **scoringPolicyHash over executable semantics** + taxonomy + approvalPolicy) covering player-facing fields, image bytes, review provenance, and the scoring policy that determines the answer | Change medium, URL, served bytes, **or a scoring function (e.g. `simplifyMedium`)** ⇒ eligibility becomes stale and work is requeued | 11b |
| DQ-3 | Daily freeze/history pin only IDs while runtime resolves mutable current `pool.js`; immutability checks compare ID arrays, not the facts/image players receive | **Confirmed** | `freeze-daily.mjs:134-140,216-249`; `check-pool.mjs:284-288`; `audit-dailies.mjs:39-60` | Store expected `eligibilityHash` with future assignments; freeze selects only eligible works and fails on insufficient approved inventory; require reapproval/refreeze on relevant changes | Future hash mismatch blocks deployment; prior assignment change is auditable | 11a |
| DQ-4 | Upcoming vision coverage is advisory and excludes today; poor-image repair state lives in ignored `data/incoming/*`, so an unresolved blocker can still ship | **Confirmed** | `check-pool.mjs:289-297` (`WARN`, `date<=today` skipped); `curate-merge.mjs:109-113`; `vision-next.mjs:28-36` | Tracked eligibility source + hard offline gate for today and declared horizon; queue derived from blocker state | Missing/stale/blocked approval today or at horizon edge exits nonzero | 11a |
| DQ-5 | Image checks are not deploy gates and verify reachability/dimensions, not semantic/visual quality; drift also treats lost coverage as success | **Confirmed** | `package.json:6-23`; `vercel.json:2`; `audit-dailies.mjs:125-153`; `check-image-drift.mjs:54-63,92-103`; `.github/workflows/ci.yml:21-23` | Add offline `check:daily` to CI/deploy; keep separate fail-closed network drift (PR 5 dependency); require structured visual verdict | Dark/cropped/glare/detail/wrong-art fixture blocks even at high resolution; zero network coverage fails the network job; mutable-source images ineligible-by-default (rehost-or-exclude; no play-time byte guarantee) | 11a |
| DQ-6 | Tests prove classifier mechanics and generic runtime safety, not the truth of each scheduled work; incident corrections lack a durable per-ID override/source record across competing writers | **Confirmed** | `medium.test.mjs:13-60` generic cases; `gameplay-smoke.mjs:60-99` representative picks; writer findings `INF-1/2` | Tracked sourced curation overrides applied last + exact work-ID regression for every incident (PRs 9/10 are foundations) | Bronze→Steel incident value survives normalize, curate merge, freeze, and release check | 11b |

**Implementation log — manual bridge, 2026-08-24:** the first today-plus-seven-day replay checked 160 scheduled
works and caught three exact incidents before release: `Q15848824` scored the Elymian-Punic Walls as Tunisia/`-4`
despite the image and teaching record identifying Erice, Sicily; `Q109046361` asked for a blank medium despite the
Tourdan Situla being silver; and `Q17635755` used a Nio photograph obscured by dense protective mesh and a visitor.
The first two pool facts were corrected. The Nio work's existing `prevImg` was also inspected and rejected because the
same mesh obscures the sculpture; the work was marked `play:false` and surgically removed from five future slots and
the raw hard rotation.
`tests/daily-incidents.test.mjs` now locks all three work IDs. This is evidence that `DQ-1`/`DQ-2`/`DQ-5`
and `DQ-6` remain systemically **Confirmed**, not a claim that the later eligibility gate is complete.

**Implementation log — production schema baseline, 2026-08-25:** captured the real production `public` schema
(project `jmrpqmejupouqfergyyg`, PostgreSQL 17.6) via `pg_dump 18.6 --schema=public --schema-only --no-owner` through
the session pooler; sanitized (no rows, no ownership, no credentials — scan clean) and **committed** (`9ac7f86`) as
`db/production-schema-baseline.sql` (+ `.md` provenance, SHA-256 pinned) with an offline gate
`scripts/check-production-schema-baseline.mjs` (now wired into `test`/`test:ci`). A live PostgREST OpenAPI cross-check
matched all 5 tables/columns. Read-only `pg_catalog` queries then **verified** (not inferred): **0 foreign keys**,
**0 policies**, **0 non-internal table triggers**, RLS enabled + not forced on all 5 tables, and the RLS event trigger
`ensure_rls` (`ddl_command_end` → `public.rls_auto_enable()`, enabled) — whose sanitized `CREATE EVENT TRIGGER` DDL is
now appended to the baseline `.sql`. Key facts for PR 3/PR 4: `profiles.device_id` is UNIQUE (but nullable); **neither
`profiles.user_id` nor `user_state.user_id` has any FK to `auth.users`** (no cascade); `scores`/`saves`/`events` have
**no** device/profile FK; RLS is service-role-only (zero policies) while `GRANT ALL` to `anon`/`authenticated` is broad
and neutralized *only* by RLS; `rls_auto_enable()` is `SECURITY DEFINER` (search_path `pg_catalog`) but only `RAISE LOG`s
on enable failure, so migrations must set RLS explicitly. This is **capture-and-verify only** — it does **not** fix
`INF-6b`: clean-database replay, the tracked base-schema migrations, and API/database tests remain pending (PR 8 / PR 3).
Account-erasure scope (evidence-based): `auth.users` is definitely in scope; **no account-linked** Vercel Blob (it holds
public artwork images), Redis (anonymous reports + per-IP rate limits), or Supabase Storage (no usage found) data was
found in the repo. External stores + platform logs still need a documented reader/writer inventory before PR 4;
anonymous-report/IP retention is a separate privacy-retention question, not account erasure.

**Implementation log — PR 3 Part 3A (device-ownership migration), 2026-08-25:** added `db/devices.sql` — the tracked
delta on the pre-migration baseline. New `public.devices` relation (device_id PK with the API shape CHECK,
`capability_hash` NOT NULL UNIQUE 64-hex CHECK, nullable `user_id`, timestamps, `revoked_at`), explicit RLS enable +
`revoke all … from public, anon, authenticated` + `grant all … to service_role`, all in one transaction. Two hardened
`SECURITY DEFINER` functions with `search_path=''`: `register_device` (service-role only, stores the app-computed
SHA-256 hash of the client-minted capability — the app hashes the raw; the function does not mint it — no user
binding) and `claim_device` (authenticated; identity from `auth.uid()`, never a caller-supplied uid; atomic
`for update` check-and-bind; returns `bound`/`already_bound_same_user`/`conflict_other_user`/`unregistered`/`revoked`/
`bad_capability`). Offline gate `scripts/check-devices-migration.mjs` (wired into `test`/`test:ci`) asserts the migration
text; falsifiability confirmed. Real-Supabase integration test `scripts/db-verify-devices.mjs` (`npm run db:verify`,
permanent prod guard + deliberate exact-ref override). **Committed** on branch `verify/pr3-3a-device-auth` as
`465580946eb703f3eb4c7c916c2746f536b2bebd`; `db/devices.sql` SHA-256
`713bee406404989e9877e1fecacacb0af8eb208479daa4f8e52c938825b0f188`. **Applied to production project
`jmrpqmejupouqfergyyg`** on 2026-08-25 (single transaction, additive) and **live-verified**: preflight clean, then
**22/22 catalog assertions** and **39/39 functional assertions** passed — RLS on / not forced; anon/authenticated
denied all table privileges; execute grants (register→service_role, claim→authenticated, **service_role ∉ claim**);
both `SECURITY DEFINER` with exact `search_path=""`; `UNIQUE` + both CHECKs; two-JWT `bound`/`conflict_other_user`;
`hash_in_use`; concurrent → **exactly one bound + one conflict** (real `FOR UPDATE` lock); revoked rejected by both
functions. **Cleanup verified: zero `public.devices` rows, zero `dv*` verifier rows, zero `dvtest_*` Auth users**;
expected `dvtest_*` create/delete traces remain in the prod Auth audit log (the one residue of verifying on prod).
**SEC-1 / SEC-2 / SEC-6 remain Confirmed — 3A partial**: the ownership relation + hardened register/claim functions
are committed, applied, and verified, but the **vulnerable API handlers are unchanged** — capability enforcement and
wiring `claim`/`sync`/`saves`/`profile`/`score`/`delete-account` onto `devices.user_id` remains **pending 3B/3C**.

---

## Infrastructure — writers, CI, hooks, DB  →  Roadmap Batches 1/4/7 (PRs 3–4,8,10) · **P2**
| ID | Finding | Status | Evidence (HEAD) | Intended change | PR |
|---|---|---|---|---|---|
| INF-1 | 36 scripts in-place-write `pool.js` (+17 via helper), 8 write `teach-works.js`, 4 write `hotspots.js`; most bracket-slice | **Confirmed (exact)** | grep `scripts/` | Corpus transaction layer; prevent new bracket-slicers | 10 |
| INF-2 | `curate-merge` writes index+pool+teach+hotspots+queues sequentially (interrupt ⇒ split state); it writes `teach-works.js` via **direct `writeFileSync`, bypassing the `writeTeachWorks` choke-point**, and does **not** write the 64 `data/notes/` shards (those are derived at deploy by `build-teach-shards`) | **Confirmed** | `curate-merge.mjs:103-107`; `vercel.json:2` | Migrate first onto the txn layer (stage `teach-works.js` as source; shards owned as derived by the manifest, not co-written atomically) | 10 |
| INF-3 | CI runs `test:ci` but not `check:syntax` | **Confirmed** | `ci.yml`, `package.json:12` | Add `check:syntax` (+ API tests) to CI | 8 |
| INF-4 | `.githooks/pre-commit` tracked but inactive (`core.hooksPath=.git/hooks`) | **Confirmed** | git config; `.git/hooks` has none | Treat hooks as convenience; enforce in CI; document install | 8 |
| INF-5 | No API behavior tests (claim/sync/delete/score-race/capability) | **Confirmed** | `tests/` (7 files, none touch `api/`) | Add API test harness + hostile-device regression tests | 3 |
| INF-6 | Only `saves.sql` has CREATE TABLE; **scores/profiles/events/user_state have no CREATE TABLE** in tracked SQL | **Confirmed** — production schema now **captured & verified** (`db/production-schema-baseline.sql`, 2026-08-25); INF-6b tracking (clean-DB replay + base-schema migrations + CI) still **pending** | `db/*.sql` (3 files, 2 ALTER-only) + `db/production-schema-baseline.sql` | **Split: INF-6b** = PR 8 owns tracking the existing base schema (sanitized production baseline captured ✓ before PR 3); **INF-6a** = the security PRs (3/4) add the new `devices` relation + cascades on top | 8 (INF-6b) / 3–4 (INF-6a) |
| INF-7 | `package-lock.json` gitignored ⇒ no repo-pinned dep graph (sharp/@vercel/blob) | **Confirmed** | `.gitignore:8` | Track the lockfile; enables `npm ci` in CI | 8 |

---

## Documentation & artifacts  →  Roadmap Batch 9 (PR 16) · **P3**
| ID | Finding | Status | Evidence (HEAD) | Note |
|---|---|---|---|---|
| DOC-1 | README says ~5,900 works; pool is 6,557 | **Confirmed** | `README.md:105` | Generate totals from the vision-inventory report (VIS-1) |
| DOC-2 | `PIPELINE.md` references deleted `scripts/curate-codex.mjs` | **Confirmed** | `docs/PIPELINE.md:120`; file absent | Update pipeline doc |
| DOC-3 | `tasks/hardcoded-data-audit.md` references deleted files + stale line numbers | **Confirmed (doc stale)** | `:13,15,22,68` (refs `collections.js`/`make-collections.mjs`/`movements.js`, all gone) | Rewrite or retire |
| DOC-4 | `tasks/code-review.md` says `audit-all` hides failures | **Already-fixed** | `audit-all.mjs:11-12,46-48` exits nonzero | Remove the stale section only |
| DOC-5 | `tasks/todo.md:28` calls `data/vision.js` a "dead bank … superseded … not worth wiring" AND says `next-vision-pass.md` was deleted | **Confirmed** (⚠ my earlier "Already-fixed (this session)" was WRONG — re-validated 2026-08-24, HEAD unchanged) | `tasks/todo.md:28` unchanged (`git diff -- tasks/todo.md` empty); runtime still loads+uses it — `index.html:64` (`<script src="data/vision.js">`) and `index.html:3230` (`VIS()` reads `ARTEFACTUM_VISION` for look-closer pins, `:3228` comment); and `docs/next-vision-pass.md` **exists** | Correct the todo wording: `vision.js` is a LIVE pin fallback (not dead/superseded), and next-vision-pass.md is not deleted. (Fix belongs to VIS-2/Batch 8B, not "already done".) |
| DOC-6 | "9 PNG masters (10.69 MiB) duplicate used webps" | **Partially** — **8** PNGs (10.60 MiB) have in-use webp twins ⇒ removable; `chain.png`'s webp is *also* unused (separate case) | grep-proven no refs | Remove the 8 after final grep |
| DOC-7 | "5 `tasks/*/support.js` byte-identical **and unreferenced**" | **Stale/inaccurate** — identical ✓ but **referenced** by sibling `.dc.html` (e.g. `18_account/…dc.html:6`) | **DO NOT remove/consolidate** | Disagreement with audit+roadmap |
| DOC-8 | Label audit: 112 orphan movements, 14 casing, 50 fragmented vocab, 2 authority dupes | **Confirmed (exact)** | `audit-labels.mjs` | Separate reviewed data-quality pass, not doc cleanup |

---

## Documentation staleness — new findings (markdown-staleness audit)  →  Roadmap Batch 9 · P3
*Revalidated 2026-08-24, HEAD `053a4fd` unchanged; reliability/vision counts NOT recounted. Each row was checked by
reading the cited file at HEAD.*
| ID | Finding | Status | Evidence (HEAD) | Intended change |
|---|---|---|---|---|
| DOC-9 | `tasks/long-term-goals.md:99` tells contributors to add Wikidata **P276** for *collection membership* — the wrong property; risks bad external Wikidata edits | **Confirmed (HIGH — dangerous external instruction)** | `long-term-goals.md:99` ("missing the P276 collection statement") vs `docs/wikidata-giveback.md:9` ("Use **P195 (collection)** … **P276 (location)** is secondary") | Fix P276→P195 before anyone follows it |
| DOC-10 | Docs over-claim deletion/ownership as correct: `README.md:185` "Deletion is real … profiles, scores, synced state"; `tasks/auth-ux-audit.md:87` calls server delete **"Solid"** ("deletes scores+profiles for every bound device") | **Confirmed** | `README.md:185`, `auth-ux-audit.md:87` — contradicted by **SEC-3/4/5** (acts on any *bound* device incl. foreign; omits `saves`+`events`; unchecked responses) | **Two-stage:** stage 1 (PR 2) removes the dangerous "deletion safe / binding correct" claims now + marks auth-ux-audit **superseded** by the reliability audit; stage 2 (PR 4) finalizes wording to match shipped erasure |
| DOC-11 | `README.md` says **"No build step"** (`:239`, `:292`) — stale: the Vercel `buildCommand` now runs `check-pool && build-teach-shards` | **Confirmed** | `README.md:239,292`; `vercel.json` buildCommand (added this session) | Update the build-step claim |
| DOC-12 | `README.md:231` "The first vision pass has covered the corpus … tracked in `data/vision.js`" — false on both counts | **Confirmed** | `README.md:231`; coverage is **91.1%** (VIS-1); corpus ledger is `data/vision-audit.json`, not `vision.js` (the 202-work rich bank, VIS-2) | Correct README vision coverage + file/nomenclature (ties VIS-1/VIS-4) |
| DOC-13 | Obsolete runbook wiring: `tasks/collections-copy.md:3` says regenerate via deleted `data/collections.js` + `scripts/make-collections.mjs` (collections are runtime-computed now). (PIPELINE.md's deleted `curate-codex.mjs` = DOC-2) | **Confirmed** | `collections-copy.md:3`; both files absent | Split editorial copy from data-wiring; generate counts |
| DOC-14 | Stale plan status: `tasks/provenance-gates-plan.md:3` and `tasks/teach-shard-plan.md:3` both say **"SPEC (not started)"** while their bodies + shipped code say implemented; `docs/tier2-plan.md` reads as an unexecuted plan though its batches shipped | **Confirmed** | `provenance-gates-plan.md:3`, `teach-shard-plan.md:3`, `tier2-plan.md` | Convert to status reports / mark historical-implemented |
| DOC-15 | Hand-copied counts stale: `todo.md` Oceania ~28 (actual **161**) & early-medieval Europe ~7 (actual **48**), and claims `next-vision-pass.md` was deleted (it **exists**); `coverage-gaps.md:3,11` "5,618 works / Oceania 7" (actual **6,557 / 161**); `docs/showcase.md` ~5,950 | **Confirmed** | node: pool **6,557**, Oceania **161**, Europe 500–999 **48**; `todo.md:28`; `coverage-gaps.md:3,11`; `docs/next-vision-pass.md` exists | Generate volatile counts from a report; keep editorial targets separate |
| DOC-16 | `docs/auditor-eval.md` presents a saturated **100% F1** as current evidence with no historical/limitation banner | **Confirmed** | `auditor-eval.md:11` (F1 100%), no banner in `:1-12`; scorer flaws = **RES-3** | Add historical-baseline + scorer-limitation banner until the graded eval replaces it |
| DOC-17 | `docs/monetization.md:23` lists `support_convert` as **wired**, contradicting `docs/metrics.md:57` ("Not client-measurable … needs a Ko-fi webhook") | **Confirmed** | `monetization.md:23` vs `metrics.md:57` | Correct the monetization event model |
| DOC-18 | `docs/uraa-review.md` presents a 62-work list as an active review queue, but `data/uraa-pending.json` is **empty** | **Confirmed** (empty verified; "only 32 IDs still resolve" per staleness audit, not independently recounted) | `uraa-review.md`; `data/uraa-pending.json` = `[]` | Label as a dated legal/data-quality snapshot, not the active queue |

## Markdown lifecycle table (all 47 `.md` files)
Status ∈ {`living`, `proposal`, `historical`, `superseded`}. **[V]** = independently opened/verified this pass; rows
without [V] adopt the markdown-staleness audit's assessment and should be re-validated before acting on them.
Nothing here is a delete instruction — historical/superseded means *banner + keep*, not remove (see DOC-6/DOC-7:
do not infer removability from duplication/apparent-disuse).

| File | Status | Evidence / replacement |
|---|---|---|
| `README.md` | living | [V] SoT for public claims; needs DOC-1/10/11/12/15 fixes |
| `docs/audits/codebase-reliability-audit-2026-08-24.md` | living | [V] evidence report |
| `docs/audits/vision-pass-inventory-2026-08-24.md` | living | [V] evidence report |
| `docs/audits/remediation-roadmap-2026-08-24.md` | living | [V] **canonical remediation plan** (this ledger is subordinate to it) |
| `docs/audits/markdown-staleness-audit-2026-08-24.md` | living | [V] source report for this pass |
| `docs/audits/finding-ledger-2026-08-24.md` | living | [V] this ledger |
| `docs/image-pipeline.md` | living | data/image-ops SoT (minor scheduled-audit corrections) |
| `docs/guides-pipeline.md` | living | per staleness audit |
| `docs/taxonomy.md` | living | generated-artifact freshness still a code issue |
| `docs/wikidata-giveback.md` | living | [V] correct P195 authority (DOC-9 defers here) |
| `docs/metrics.md` | living | [V] relatively current |
| `docs/icp.md` | living | comparatively stable |
| `scripts/vision-audit-prompt.md` | living | per staleness audit |
| `scripts/consistency-sweep-prompt.md` | living | per staleness audit |
| `tasks/email-templates.md` | living | external-console state unknown |
| `tasks/lessons.md` | living | incident record (append-only) |
| `tasks/todo.md` | living | [V] active backlog but bloated/stale (DOC-5/15); split backlog↔changelog |
| `tasks/long-term-goals.md` | living | [V] product horizon but stale + dangerous (DOC-9/14/15); needs rebuild |
| `docs/next-vision-pass.md` | proposal | [V] exists; mixes uncollected + partially-shipped fields; rewrite to stable vision names |
| `docs/showcase.md` | proposal | portfolio; stale counts (DOC-15) |
| `docs/monetization.md` | proposal | [V] portfolio; DOC-17 contradiction |
| `tasks/contemporary-art-research.md` | proposal | dated research, not implementation authority |
| `docs/auditor-eval.md` | historical | [V] saturated baseline (DOC-16); needs banner |
| `docs/uraa-review.md` | historical | [V] dated legal/data review (DOC-18) |
| `docs/case-study-honesty-pass.md` | historical | portfolio; stale corpus/region counts |
| `docs/ethos.md` | historical | per staleness audit |
| `tasks/code-review.md` | historical | [V] contains the already-fixed DOC-4 item; banner |
| `tasks/hardcoded-data-audit.md` | historical | [V] refs deleted files (DOC-3) |
| `tasks/design-system-audit.md` | historical | old `index.html` line numbers |
| `tasks/training-mode-spec.md` | historical | training shipped |
| `tasks/enrich-samples.md` | historical | dated samples |
| `tasks/coverage-gaps.md` | historical | [V] dated analysis, counts stale (DOC-15); methodology reusable |
| `tasks/16_leaderboard/README.md` | historical | design handoff, ported |
| `tasks/17_training/README.md` | historical | design handoff, ported |
| `tasks/18_account/README.md` | historical | design handoff, ported |
| `tasks/19_dab_colors/README.md` | historical | design handoff, ported |
| `tasks/20_account_prompts/README.md` | historical | design handoff, ported |
| `tasks/provenance-gates-plan.md` | historical | [V] implemented (header wrongly says SPEC; DOC-14) → shipped code + this ledger |
| `tasks/teach-shard-plan.md` | historical | [V] implemented (DOC-14) → shipped; keep as architecture record |
| `docs/PIPELINE.md` | superseded | [V] → `docs/image-pipeline.md` (merge unique material; deleted `curate-codex` = DOC-2) |
| `tasks/auth-ux-audit.md` | superseded | [V] → `docs/audits/codebase-reliability-audit-2026-08-24.md` (delete-"Solid" contradiction, DOC-10) |
| `docs/tier2-plan.md` | superseded | [V] → shipped code + `tasks/todo.md` (batches shipped, DOC-14) |
| `tasks/collections-copy.md` | superseded | [V] → runtime-computed collections (deleted `collections.js`, DOC-13) |
| `tasks/accounts-leaderboard-spec.md` | superseded | → shipped Supabase accounts + reliability audit (spec is Upstash/Redis) |
| `docs/combo-design-language.md` | superseded | → `main` (branch consolidated) |
| `docs/combo-logic-reconcile.md` | superseded | → `main` (branch consolidated) |
| `tasks/teaching-notes-guidelines.md` | superseded | → needs rewrite around the current notes/pins schema + actual review model (old 4-cue/5-guide, "no human review" claim) |

*(47 distinct `.md` files, all listed once.)*

## Reconciliation with the remediation roadmap
This ledger is **subordinate to** [`remediation-roadmap-2026-08-24.md`](./remediation-roadmap-2026-08-24.md); it does
**not** create a second roadmap. Mapping of the new markdown findings onto the existing plan:
- **DOC-9 through DOC-18 fold into roadmap Batch 9** (confirmed cleanup + documentation repair), which correctly
  sequences docs **last** — *except* the actively-misleading subset, which should ride earlier PRs: **DOC-9 (P276→P195)**
  and **DOC-10 (deletion/ownership over-claims)** are dangerous *now*, so fix DOC-9 in the roadmap's first cleanup PR
  and correct the DOC-10 README/auth-ux claims alongside **Batch 1** (they describe the very security defect Batch 1
  fixes). Everything else (banners, backlog rebuild, count generation) stays in Batch 9 order.
- The staleness report's own PR1–PR5 cleanup sequence is a **refinement of roadmap Batch 9**, not a competing plan;
  its "PR 4 — mechanize freshness" (docs manifest + `docs:check`) is the durable prevention layer and pairs with
  roadmap Batch 5 (generated-artifact contracts).
- **DQ-1 through DQ-6 map to new roadmap Batch 8A / PR 11.** They are production-release findings, not merely vision
  naming or coverage cleanup. Batch 8A therefore precedes Batch 8B and makes current, content-addressed approval—not
  an ID in the legacy ledger—the daily eligibility boundary.
- **Do not delete** anything during doc cleanup before reader/writer checks (roadmap rule; DOC-6/DOC-7 nuances hold).

---

## Research briefs — reconciled review  →  Roadmap Batch 6 prereq, then PRs 14–15
The three briefs are strong and self-aware; the roadmap's statistical corrections are sound and I concur. Key points to
hold the implementers to (all depend on RES-1/RES-2/RES-3 landing first):
- **Recognition probe:** primary target = **ladder survival among rung-0-recognized works** (not raw `recognized`,
  which is 95.6% positive — report PR-AUC + calibration, not just ROC-AUC). `breakRung` is **right-censored** for
  survivors — don't treat as plain ordinal regression. Use **ridge**-regularized logistic, **nested CV**, all
  preprocessing inside folds, **grouped CV by artist/series** (random work-level folds leak an artist's identity).
  The **fame ↔ image-quality confound is real** — add a nonsemantic image-quality baseline block; "CLIP beats
  fame" only proves the representation carries info beyond the fame proxy. **Phase 3 needs an independent
  behavioral target** (self-report-predicts-self-report is circular); extract hidden states at a fixed position
  **before** the recognition token to avoid label leakage.
- **Recognition contamination:** Phase 1 can show that a representation predicts self-reported survival beyond fame
  and nuisance cues; it cannot alone prove training membership. Add a provenance-controlled obscure/recently
  digitized negative-control corpus and a second model arm before generalizing. Run the extended degradation ladder
  only after the control, and measure the useful-visual-information cost. Any Phase 3 hidden-state comparison needs
  an independently scored behavioral identity target and states extracted before the answer token.
- **Near-miss decoy eval:** treat tiers as **categories, not guaranteed-monotonic** difficulty. **Precision-by-tier
  is undefined** without matched per-tier controls — prefer tier-recall + fame-band control false-positive rate +
  balanced accuracy for the pilot. Use **seeded sampling + committed manifest** (not a fame-sorted walk),
  cap artist/source/series dominance, prevalidate image bytes + fingerprints. **Human-review every T4/T5** pre-run;
  mark alternate-versions/workshop-copies `ambiguous` and exclude. Label the first run a **pilot** (n=10/cell is
  not a curve). Version manifests/truth/verdicts/metadata — ignored outputs aren't portable evidence.

---

## Roadmap revalidation — agreements, disagreements, already-fixed

**Agree with the roadmap's ordering and acceptance contract** (security → truthful failure → safe writes →
reproducibility → daily-release integrity → research validity → vision consolidation → cleanup; small independent
PRs; cleanup last). Every
P0/P1 systemic finding it depends on is Confirmed against HEAD.

**Disagreements / corrections (things the reports got wrong):**
1. **DOC-7 — the 5 `support.js` are NOT removable.** They're byte-identical but actively loaded by sibling
   `.dc.html` design comps. The roadmap now explicitly preserves them.
2. **GEN-6 — the regen diff counts are stale** (703→818 authorities; `scores.json` is offline-reproducible;
   `resync-fame` shows 0 drift now). Batch 5's premise should be **re-measured**, not cited from the audit.
3. **DOC-6 — it's 8 PNGs, not 9** (`chain.png` is a different case: its webp twin is also unused).
4. **SEC nuance** — foreign-device delete hits `scores`+`profiles` only (not `user_state`/auth). Doesn't change the
   fix; the SEC-3 test must assert the exact tables.

**Already-fixed (verify-only, no work):** DOC-4 only (`audit-all` already fails closed). ⚠ **DOC-5 was NOT already
fixed** — corrected above to **Confirmed** (todo.md:28 still calls `vision.js` a dead bank; `git diff` empty).
`vision.js` is a *live pin fallback*, not dead code; don't remove before the 7-pin migration (VIS-2).

**Preserve (do not touch):** untracked `data/guessability/probe-sonnet-candidates-partial.json` (23 works) and
`data/incoming/*` local research outputs. The date/medium/place/ukiyo-e data fixes committed earlier this session
(`4e69292`…`053a4fd`) are unrelated to these findings and already shipped.

---

## Recommended first PR
**PR 1 — audit reports + this ledger (no code):** commit the **four** audit reports together with this ledger:
`codebase-reliability-audit-2026-08-24.md`, `vision-pass-inventory-2026-08-24.md`, `remediation-roadmap-2026-08-24.md`,
`markdown-staleness-audit-2026-08-24.md`, and `finding-ledger-2026-08-24.md`. **Do NOT include** the untracked
`data/guessability/probe-sonnet-candidates-partial.json` in PR 1 — keep it preserved on disk, leave it untracked
unless Kat explicitly approves committing research candidates. Zero risk; establishes the substrate every later PR
updates. *(This file is the ledger.)*

**First CODE PR — PR 3 (revised).** PR 2 is now the urgent documentation-truth correction. A test suite deliberately
written to **fail** against HEAD is a valid TDD step but is **not independently mergeable** because it turns
`main`/CI red. Put the hostile-device regression tests and the narrow device-ownership fix in PR 3, demonstrating in
the PR that the tests fail before the fix and pass after it. PR 4 handles complete account erasure. Every merged
commit stays green while SEC-1…SEC-5 are still proven with executable regressions.

> Do not start implementation until this ledger and the canonical roadmap are approved. Update the PR column here as
> each contract lands.
