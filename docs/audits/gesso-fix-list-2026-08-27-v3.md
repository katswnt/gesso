# Gesso (artguessr) — fix list v3

**Supersedes v1 and v2.** Four new defects (G-21 through G-24), and G-04 flipped from *suspected*
uninformative to *measured* uninformative — with the important twist that the auditor itself was
vindicated. Where documents disagree, this one wins.

Merged from: the Claude Code audit, the Codex audit, and three Claude addenda — all 2026-08-27.

- **[BOTH]** — independently reproduced by both auditors. Highest confidence.
- **[CLAUDE]** / **[CODEX]** — one auditor only.
- **[PRIOR]** — already found in Kat's own August audits. Credit to prior work.
- **[MEASURED]** — an experiment was run, not an inference.

A bug fix round was in progress throughout. Verify against current HEAD before starting.

**Running total: 19 findings, 12 live.**

---

## What changed since v2

**G-04 is settled, and the news is better than expected.** A three-arm experiment ($0.44, 150 bare
completions) shows the eval is solvable with **no image at all** — but also that the auditor works
fine when the filename is removed. The instrument was broken; the detector wasn't. Full detail in
G-04.

**Four new defects, all from the two places addendum 1 predicted:**

- **G-21** (live) — one stale id silently discards an entire stored day. 7.5% of `daily-history`.
- **G-22** (latent) — `buildIndexes()` is not idempotent; `MINY` shifts to −25000 on re-init.
- **G-23** (live) — *Venus of Willendorf*'s date axis is unwinnable, max 10%.
- **G-24** (live) — `styleChoices` ships two defensible answers in ~1 daily in 27, and both guards
  are structurally incapable of firing.

G-24 is the most interesting finding in the entire series. See below.

---

## Corrections carried forward from v2 — still read first

**1. The fame correlation figure was wrong, twice.**
v1 said Spearman ρ = 0.575 for fame against recognition depth. That was inflated by a tie-ranking
bug (ties ranked by sort order rather than averaged, with 52% of observations tied at max depth).
Tie-corrected:

| subset | n | ρ |
|---|---|---|
| all | 407 | 0.271 |
| canon only | 108 | 0.059 |
| non-canon only | 299 | 0.169 |

**"Fame predicts recognition resistance monotonically" is not supported.** It predicts it weakly,
and not at all within the canon set where the hand-set `+2000` flag has already selected for
recognizability.

**2. The note confound is real but small.** v1 treated it as a serious design flaw. Measured: the
note first appears at rung 1, which costs 3 works out of 389 (0.8%). Drop rate scales with pixel
severity, not with the note's introduction. **Bounded at ≤0.8 percentage points.** The three-arm
note experiment is nice-to-have, not necessary.

**3. Much of the censoring/self-report analysis was already in your own audits.**
`docs/audits/codebase-reliability-audit-2026-08-24.md:166-170` states the `stopRung: 4` conflation
and gives the exact 210/78 split. `finding-ledger-2026-08-24.md:420` flags the right-censoring and
the 95.6% class imbalance; `:425` flags that self-report-predicts-self-report is circular. v1
presented these as new findings. They weren't.

**4. The ease-tiering question is moot.** `ease.json` has zero consumers — see G-06 below.

---

## The finding that actually came out of this

Not a fix. Put it at the top because it reframes several items below.

**On clean reads — the 197 works where recognition actually broke — fame and blinded guessability
are negatively correlated: ρ = −0.183, 95% CI [−0.32, −0.04].** More famous works are slightly
*harder* to characterize from pixels alone once the model is genuinely blinded.

The robustness check is what makes this credible. `G` averages over facets including `where`, and
F-08 corrupts `where` (49.2% of clean-read works carry a false zero there). Removing the broken
facet makes the effect **stronger**:

| measure | n | ρ | 95% CI |
|---|---|---|---|
| G as shipped | 197 | −0.183 | [−0.32, −0.04] |
| **G excluding `where`** | 197 | **−0.254** | **[−0.38, −0.12]** |
| style alone | 197 | −0.197 | [−0.33, −0.06] |
| medium alone | 197 | −0.176 | [−0.31, −0.04] |
| when alone | 197 | −0.122 | [−0.26, 0.02] |
| `where` alone (broken) | 197 | +0.016 | [−0.12, 0.16] |

When a finding is an artifact of a bug, removing the bug kills it. This did the opposite, and the
effect appears independently in style and medium.

Sign is stable across every era band, both oil mediums, and non-canon (−0.197). Canon is flat
(+0.022), which is predicted — the `+2000` flag makes fame nearly degenerate there.

**Interpretation:** fame measures documentation density and prior exposure, not visual legibility.
Coherent, and more interesting than the result the pipeline was built to produce.

**Not yet a paper, for three stated reasons:** 84% European (region-generality untested, Asia n=9,
Africa n=5, Oceania n=1); the 52% censored works are excluded by construction; the CI still admits
ρ ≈ −0.05. Fixing F-08, extending the ladder so censored works enter the sample, and acquiring
non-European coverage would close all three. The third is the expensive one.

**The independent-measure check can't be run from existing artifacts.** `layPct` exists in 7 works.
`vision-predict-human` has 30 but measures a different construct. Testing the inversion against a
second measure requires re-running the full 410-work probe.

---

## P0 — live, user-visible, or exposure

### G-01 · Date scoring silently voided for ~1,400 works [CLAUDE]

`index.html:313` declares `let MINY=-2500`; `:1440` overwrites it from the pool minimum at runtime.
Actual pool minimum is **−11000**, set by one work (*Swimming Reindeer*).

The pre-1400 segment spans 12,400 years across 350 slider units = 35.4 years/unit. With
`timeMult 1.3`, the bullseye window `pd ≤ 12` becomes **±553 real years**.

*Winged Victory of Samothrace* (y=−175), guess 425 CE — six centuries wrong — returns 2500/2500
with `bull:true` and reveal text "right period." With the declared `MINY=-2500`, the same guess
returns 1300.

**1,428 of 6,546** date-scored works sit before 1400. Nothing tests `posToYear`, `yearToPos`, or
`MINY`. The trigger is data, not code — any future harvest with an older object rescales a
2,500-point axis with no gate, no test, no log line.

**Decision needed from you:** hard constant, or clamped percentile with outliers pinned to the
floor? Don't delegate — it's a scoring-design question and exactly what an interviewer would ask
you to justify. Then add a golden test and a gate that fails if the pool minimum leaves an expected
band.

Confirmed absent from all five prior audit documents (`MINY` returns zero hits).

### G-02 · Production deploy serves the entire repository [CLAUDE]

`vercel.json:3` sets `"outputDirectory": "."`, no `.vercelignore` exists, and the SPA rewrite at
`:14` excludes any path containing a file extension. Net effect: every tracked file with an
extension is publicly fetchable.

```
/docs/audits/finding-ledger-2026-08-24.md   200   56,073 B
/db/production-schema-baseline.sql          200   13,613 B
/api/score.js                               200    7,598 B   (source, not the function)
/scripts/freeze-daily.mjs                   200   22,574 B
/tasks/code-review.md                       200   11,630 B
```

**Severity is confirmed reconnaissance-only, both paths verified.**

*Read:* all five anon-granted tables return `[]`. RLS is enabled on all five (schema lines 252-276)
and there are **zero** `CREATE POLICY` statements anywhere in `db/`, so anon is default-denied. The
`GRANT ALL ... TO anon` lines that look alarming are inert. `devices` returns 401 and is
additionally locked by explicit revokes at `db/devices.sql:36,74,108`.

*Write:* verified in addendum 2. A first probe naming a nonexistent column hit `PGRST204` at the
PostgREST layer before RLS was consulted — inconclusive. A second probe omitted
`events.device_id` (declared `NOT NULL` with no default, so no row could be created under any
outcome) and reached the database:

```
{"code":"42501","message":"new row violates row-level security policy for table \"events\""}
[HTTP 401]
```

RLS denied the write before the constraint was reached. No row was created by either probe.

**Still fix it.** `tasks/code-review.md` opens by saying the project "is not yet unequivocally
staff-level," and it's fetchable from a site on your resume.

**Do not just add `.vercelignore`** — `buildCommand` runs `check-pool.mjs` and
`build-teach-shards.mjs`, and `.vercelignore` excludes files from upload entirely. Either add
explicit 404 routes for `/docs`, `/tasks`, `/db`, `/tests`, `/server`, `/scripts` (config-only,
1-2 hours), or build into a real output directory (correct long-term fix, same modularization the
README already lists as owed).

### G-03 · Untrusted corpus URLs reach an agent's shell [BOTH]

`scripts/vision-audit-prompt.md:15-16` instructs an agent with full tool access to compose a shell
command from a data field:

```
curl -sL -A "Mozilla/5.0" "<img>" -o /tmp/v_<id>.jpg
```

The agent builds that string, so a quote or `$(...)` in a pool image URL is command injection in
the auditing agent's session. `curl -L` follows redirects anywhere.

The URLs aren't yours — harvest scripts store aggregator-supplied image fields verbatim. The
shipped pool has **22 distinct image hosts** including `datocms-assets.com`, `lib.is`, `wga.hu`,
and a raw S3 bucket. An unexpected host is already the norm, so a hostile one wouldn't stand out.
Eleven works still point at plaintext `http://`.

Codex extends it upstream: `scripts/vision-v2-prep.mjs:33` fetches arbitrary corpus URLs, follows
redirects, buffers the whole body, and performs no scheme, final-host, IP-range, MIME, or size
validation. Full chain:

```
museum/corpus URL → fetcher + redirects → local decoder → multimodal model
  → structured output → partially automatic merge → player-facing corpus
```

SSRF, decompression attack, malformed-image parsing, pixel and metadata prompt injection, schema
confusion, and data poisoning on one path.

**Fix:** hardened fetch broker — scheme allowlist, final-host revalidation after each redirect hop,
private/loopback IP rejection, MIME check, size cap. Quote-safe argument passing, or drop the shell
and fetch in-process.

**Write this one up.** `vision-guess.mjs:5-9` contains the correct capability argument ("an agent
has a shell it can escape with; a bare completion has none"). You made it in one pipeline and not
the neighbouring one. That gap, stated honestly, is the only adversarial artifact available from
work already done.

---

## P1 — corrupts shipped numbers

### G-04 · The eval is solvable with no image at all — but the auditor is fine [MEASURED]

**Settled by experiment.** 50 items (25 controls, 25 decoys) x 3 arms = 150 bare completions, no
`tools` field so the model had no channel to fetch anything. Images downloaded by the script and
passed as base64. Model `claude-sonnet-4-6`, matching the probe artifacts' model class.

| arm | setup | decoys caught | false alarms | precision | recall |
|---|---|---|---|---|---|
| A | image + real URL *(replicates the original)* | 25/25 | 0/23 | 100.0% | 100.0% |
| B | image + **hashed** URL | 25/25 | 0/23 | 100.0% | 100.0% |
| **C** | **NO image** + real URL | **25/25** | **0/25** | **100.0%** | **100.0%** |

Cost: **$0.44**. Two controls errored in the image arms only — *Saturn Devouring His Son* (10.5 MB)
and *Psyche Revived by Cupid's Kiss* (22.5 MB) both exceed the 10 MB image limit — so those arms
have 23 controls. Arm C needed no image and has all 25.

**Two conclusions, and they're about different objects.**

**Arm C invalidates the eval.** A run with zero pixel access reproduces the published 100/100
exactly. So `docs/auditor-eval.md`'s score cannot distinguish an auditor that examined the image
from one that read the filename. This is stronger than the earlier claim that *recall* carried no
information — **precision carries none either**, because the no-image run also produces zero false
alarms.

**Arm B vindicates the auditor.** With the image present and the filename destroyed, still 100/100.
The model genuinely detects gross cross-region wrong-art from pixels alone. That's a real capability
and it's worth stating plainly.

**Root causes of the original design flaw:**
- `eval-auditor.mjs:36` uses `.find()` on a fame-sorted list, so 25 decoys draw from **two distinct
  images**: *A Friend in Need* 23 times, *Ghent Altarpiece* twice.
- The auditor receives the image URL and is told to fetch it, so the answer is in the input string:
  `title: "The Third of May 1808"` / `img: .../A Friend in Need 1903 C.M.Coolidge.jpg`

**Arm B is the eval that should have been published.** Same items, same auditor, filename proxied.
It measures the thing the document claims to measure and costs about fifteen cents.

**Fix:** ship Arm B as the baseline, then build the graded near-miss tiers on top of it (S-1). The
filename proxy is a prerequisite for every tier — without it, no tier measures anything.

**This is now a better story, not a worse one.** You're not reporting "my detector might have been
cheating." You're reporting "my instrument couldn't tell the difference, here's the three-arm design
that can, and the detector turned out fine." That's eval methodology demonstrated end to end.

### G-05 · 25% of where-scores are false zeros; France scored from the Atlantic [CLAUDE]

Two bugs on `grade-guessability.mjs:95`.

The prompt asks for "modern country or region" and the model routinely answers with a disjunction,
but `placeCountry` splits only on `[,/;]`. **103 of 407 works (25.3%)** score `where = 0`, all with
guess strings that aren't exact country names. "Netherlands or Belgium" for a Netherlands work
scores zero — indistinguishable from naming the wrong continent.

Separately the centroid is the midpoint of the country's bounding box while the country test is a
real polygon:

```
France  bbox [-54.52, 2.05, 9.56, 51.15]  →  26.60N, 22.48W   (Atlantic, off Western Sahara)
Russia  bbox [-180, 41.15, 180, 81.25]    →  61.20N,  0.00     (North Sea)
Italy   bbox [6.75, 36.62, 18.48, 47.12]  →  41.87N, 12.62E    (fine)
```

French Guiana widens the France box until its midpoint leaves Europe. France is ~24% of the probe
sample.

**Now higher priority than v1 suggested.** This is the facet blocking the negative-correlation
finding from being publishable — 49.2% of clean-read works carry a false zero here, and removing
the facet strengthens the effect. Fixing it is step one of three toward a real result.

Neither script is in `npm test` or `test:ci`. Neither bug appears in your own August audits.

### G-06 · `ease.json` has zero consumers [NEW — addendum 2]

Traced: the only file referencing `ease.json` is `scripts/ease-metric.mjs`, which *writes* it. Not
`index.html`, not `freeze-daily.mjs`, not any handler under `api/`.

```
probe-sonnet.json → grade-guessability.mjs → scores.json → ease-metric.mjs → ease.json → (nothing)
```

`easy-exclude.json` does gate the Easy tier via `freeze-daily.mjs`, but
`scripts/build-easy-exclude.mjs` now computes exclusions **deterministically from the work's date**,
keeping prior probe-derived ids only as a preserved keep-set. Its own header says so. A dry run
reports 44 ids currently excluded and **0 newly excluded by the date rule**.

**This is a research-validity problem, not a product bug.** Good news for players. Less good for
the README, which implies the guessability pipeline informs difficulty more than the code supports.

For the record, ease is dominated by its fame term anyway: ρ(ease, R) = 0.926, ρ(ease, G) = 0.533,
378 of 399 R values come from the `fame×vis` estimate, only 21 rows are `Rsrc: "human"`, and the
range is compressed to 0.625–0.925.

**Fix:** correct the README framing. Then decide whether to wire a corrected ease into the tiering
or delete the pipeline's product pretensions and keep it as research infrastructure.

### G-07 · Guessability reads taken at rungs where recognition is still active [PRIOR, confirmed]

**Already in your own audits** — `codebase-reliability-audit-2026-08-24.md:166-170` states the
`stopRung: 4` conflation and gives the exact split (288 rung-4 works: 210 survived all transforms,
78 broke at rung 4). `finding-ledger:420` flags the right-censoring and class imbalance; `:425`
flags the self-report circularity.

Confirmed independently: **51.6% of ease rows (206 of 399)** take their guessability from a rung
where the model still reported recognizing the work. Mean G is **0.836** for those against
**0.595** for the clean 48% — contamination inflates the read by roughly 0.24 on a 0–1 scale.

Conditional drop rate per rung:

```
rung 0  full             407 reached   18 drop    4.4%   (no note, no transform)
rung 1  flip             389 reached    3 drop    0.8%   (note first appears)
rung 2  flip+rot         386 reached   40 drop   10.4%
rung 3  +crop60          346 reached   58 drop   16.8%
rung 4  +crop45          288 reached   78 drop   27.1%
```

**Fixes:** add an explicit `survived: true|false` field so `stopRung` stops conflating opposite
outcomes. Check `recognized` against whether the model named the right work — `vision-predict-human.mjs:49`
already asks for an identification, so the mechanism exists. Extend the ladder past rung 4 so
censored works enter the sample (tighter crops, grayscale, channel permutation, blur — each costs
guessability signal, so the point is characterizing the tradeoff curve, not finding one that always
works).

### G-08 · The probe sample is the Easy tier [BOTH]

`probe-sonnet.json` is N=410 — exactly the Easy-tier `distinctCount`. Probe fame median **1,084**
against a full-pool median of **26**; Easy tier has a fame floor around 929.

"95.6% of artworks are recognized at full resolution" is really "95.6% of the works I pre-selected
as the most famous ~6% of my pool are recognized." **There is no obscure-work arm.**

The fame regressor is partly judgment: `make-fame-js.mjs:30` adds a flat `+2000` for the hand-set
`canon` flag, over half the total magnitude for canonical works.

**Also unresolved:** the committed `probe-sonnet.json` records `confidence` fields, but the current
prompt asks for `layPct`, and the retune commit landed ~1 hour after the data was committed. **The
shipped artifact cannot be regenerated by the shipped script, and no manifest of the 410 ids
exists.** If you have that list, commit it — your most substantial dataset isn't currently
reproducible even by you.

---

## P2 — scheduler, gameplay, test integrity

### G-09 · The repair pass creates most of the violations it exists to avoid [CLAUDE]

`freeze-daily.mjs:191-204`, call sites `:175` and `:185`. `repairCoverage` receives `avoidW` (30-day
work gap) but never `avoidA` (5-day artist gap), `avoidCL` (14-day cluster gap), or the per-day
style cap. It runs after assembly, so anything it inserts is exempt from three of the four cross-day
rules the README advertises.

180-day horizon: 90 repair swaps, 11 inserting a work whose artist is in the live avoid set. 18
five-day artist-gap violations, **11 of 18 (61%) created by the repair pass itself**. Because
`poolIds.find()` scans from index 0, the same works recur — Dürer and Gauguin. Shipped
`data/daily-order.js` shows the same signature: 21 violations across 184 days, Goya five times,
Dürer four.

The README states the 5-day artist gap as a property; it's a preference holding ~90% of the time.
The relaxation ladder also drops the artist gap in the *first* bucket alongside the style cap, which
the README doesn't mention while correctly saying the work gap relaxes last.

**The scheduler is the product's core algorithm and has zero unit tests.** Nothing exercises
`diversify`, `dayIds`, `repairCoverage`, or the relaxation ladder.

### G-10 · Typing "painter" wins the artist category on 35 works [CLAUDE]

`index.html:517-529`, rule 6. Accepts any record token of length ≥4 that isn't a name particle.

| typed guess | matches | works asking artist |
|---|---|---|
| `painter` | 34 artists | 35 |
| `master` | 14 artists | 11 |
| `elder` / `younger` | 5 / 7 | — |

Rule 5's Levenshtein budget of 2 on names ≥10 chars is too generous for a dynastically dense
namespace: "Filippo Lippi" ↔ "Filippino Lippi", "Jan Mostaert" ↔ "Jan Gossaert", "Anton Raphael
Mengs" ↔ "Raphael" via the alias table's substring rule — the exact collision class the comment at
`:492` claims to avoid.

`scoring.test.mjs` has three negative guards; the Monet/Manet one is the most valuable line in the
file. There should be twenty.

### G-11 · Tier leniency inverted on the date axis [CLAUDE]

`index.html:111-116`. `timeMult`: easy 1.3, medium 1.3, hard 1.35, impossible 1.4. Score is
`timeScore(pd / timeMult)` — larger is *more forgiving*. Impossible is the most lenient date tier,
easy the strictest, easy and medium identical.

*The Starry Night*, guess 17 years off: 2250 on easy, 2500 on impossible. `distK` and `relMov` are
correctly ordered, so this reads as oversight. Four lines of test away.

### G-12 · A cats rebuild silently un-opts-out ten works [CLAUDE]

`index.html:1438-1439` comments that deep-prehistory pieces opt out of date-guessing, and
`data/pool.js` correctly stores *Venus of Willendorf* with `cats` lacking `"when"`. Eight lines
later (`:1446-1450`) the array is rebuilt from `const c=["when"]` unconditionally.

At runtime the work asks for a date it can't receive: y=−25000 maps below the slider floor, so the
best possible guess scores 250/2500. Fame 1237, appears in `data/daily-order.js`. **Ten works have
a stored opt-out destroyed this way.**

Same root cause as G-01: data-driven runtime mutation of pool records. Addendum 1 flags this as a
pattern likely to recur — the daily and archive replay path in `index.html` is the next place to
look.

### G-13 · The "local, no-network" test suite makes network calls [CODEX]

`scripts/audit-local.mjs:1` says it runs local, no-network checks and catches all child failures.
Its first child, `audit-fields.mjs:1`, performs a network-backed Wikidata load. In an isolated
checkout the suite **waited indefinitely**.

Remove from `npm test`, make it cache-only, or add a strict timeout.

### G-14 · Tests skip rather than fail [CLAUDE]

`tests/dom-harness.mjs:88` — `if (typeof fn !== "function") return; // skip silently`. Rename a
builder and coverage evaporates while the suite prints PASS. Codex adds that the same harness
suppresses timer exceptions at `:49`.

`gameplay-smoke.mjs` advertises 4,900 checks, ~4,800 of which are one assertion repeated, gated
behind `if (S.MED_EXCLUDE && S.mediumOptions)`, and it warns rather than fails when an intended
fixture is missing (`:60`).

One date-window test mirrors the production algorithm instead of executing it; a regex only confirms
a matching condition remains in the HTML (`scoring.test.mjs:118`).

**You already invented the fix:** `note-shard.test.mjs:30` fails when the input set drops below
1,000 items. That floor pattern belongs in every file.

### G-15 · Duplicated correctness predicates [CLAUDE]

`workComplete` — the rule deciding whether a work can be shown at all — exists in four independent
copies: `freeze-daily.mjs:25`, `check-pool.mjs:271`, `audit-dailies.mjs:32`, `index.html`. The
seeded PRNG exists twice with small differences. `scripts/lib/` exists and is used correctly
elsewhere, so this is discipline, not architecture.

### G-16 · Production source parsed with regex [CLAUDE]

Multiple scripts extract logic from `index.html` by string index and `new Function`.
`freeze-daily.mjs:20-24` wraps it in a bare `catch{}` that silently yields an empty movement-family
map — a rename in `index.html` disables movement-family separation with no error. The tests do it
too, and their regexes encode formatting (one terminates on `return false; }` with a single space).

---

## P1.5 — the new defects

### G-24 · `styleChoices` ships two defensible answers in ~1 daily in 27, and both guards are structurally broken [MEASURED]

**The most interesting finding in the series.** `styleChoices` (`index.html:166-198`) generates the
multiple-choice options for the movement/culture question. Zero tests. It decides whether a round is
*fair*.

**Measured rate.** Two sweeps driving the real function under real per-round seeds: a grid of 5,911
scoreable works x 4 tiers x 5 seeds (118,220 option sets), and the real `dailyItems()` over 365
consecutive dates x 4 tiers (7,072 actual style rounds).

A round is unfair when the option set contains a casing variant, the same concept under two names,
or a strict subtype of the correct answer — because then two options are both defensibly right.

| | option sets | distinct works |
|---|---|---|
| **Unfair (two defensible answers)** | 941 / 118,220 = **0.80%** | 549 / 5,911 = **9.29%** |
| Fragmented-vocabulary co-show | 2,410 / 118,220 = 2.04% | 1,378 / 5,911 = 23.31% |

**On real shipped dailies: 54 of 7,072 style rounds (0.76%), across 54 distinct (date, tier)
dailies out of 1,460.** Roughly one daily in 27.

Worst by exposure: `Baroque` co-shown with `New Spanish Baroque`, affecting **281 works**. `New
Spanish Baroque` has **two works in the entire pool** and poisons questions for 282. Worst by
per-round probability: `Roman` at impossible tier, where **34.0%** of option sets contain one of
`Ancient Roman` / `Gallo-Roman` / `Graeco-Roman` / `Roman Imperial`.

Three rounds from the shipped schedule:

```
2026-09-20 easy  r2   Ecstasy of Saint Teresa
  answer: Baroque
  options: [Bird-and-flower painting, Hudson River School, Baroque, New Spanish Baroque]

2026-12-05 easy  r4   A Bar at the Folies-Bergere
  answer: Realism
  options: [Realism, Academic realism, Regionalism, Persian miniature]

2027-02-13 medium r1  Diana of Versailles
  answer: Roman
  options: [Belle Epoque portraiture, Ancient Roman, Roman, Zhe school]
```

**Root cause 1 — the family dedup can't fire.** `movFam` (`:187`) strips a closed list of European
nationality adjectives, then runs `.replace(/[^a-z]/g,"")`, collapsing spaces. A multi-word label
only matches its head noun if *every* qualifier is on the strip list — and the list omits `New`,
`Antwerp`, `Harlem`, `Academic`, `Gallo`, `Canadian`, `Social`:

```
"Baroque"          -> "baroque"      vs "New Spanish Baroque"  -> "newbaroque"        no match
"Mannerism"        -> "mannerism"    vs "Antwerp Mannerism"    -> "antwerpmannerism"  no match
"High Renaissance" -> "renaissance"  vs "Harlem Renaissance"   -> "harlemrenaissance" no match
```

Additionally `movFam("Venetian school")` returns `""`, and `:195` guards with `if(dedup && k && ...)`,
so **empty keys never dedup at all**. And `:189` sets `dedup = isCult ? (look==='far') : true`, so
**cultures get no family dedup on medium, hard, or impossible** — which is why the `Roman`, `Egypt`,
and `Shang dynasty` collisions cluster there.

**Root cause 2 — `sib()` is perfectly anti-correlated with its purpose.** Verified against the real
`movementSim`:

| pair | movementSim | blocked at >=0.85? | kind |
|---|---|---|---|
| Baroque / New Spanish Baroque | **0.000** | no | subsumption, **unfair** |
| Mannerism / Antwerp Mannerism | **0.000** | no | subsumption, **unfair** |
| American Realism / Academic realism | **0.000** | no | casing + subsumption, **unfair** |
| Roman / Ancient Roman | **0.000** | no | same concept, **unfair** |
| High Renaissance / Harlem Renaissance | **0.000** | no | shared token, **unfair** |
| Realism / Social Realism | 0.700 | no | subsumption, **unfair** |
| Gothic art / International Gothic | 0.196 | no | subsumption, **unfair** |
| Romanticism / Neoclassicism | **0.900** | **YES** | fair lookalike |
| Post-Impressionism / Pointillism | **0.916** | **YES** | fair lookalike |
| Suprematism / Constructivism | **0.912** | **YES** | fair lookalike |
| Ukiyo-e / Rinpa | **0.930** | **YES** | fair lookalike |

**It blocks exactly the distractors that make the game pedagogically interesting, and permits
exactly the ones that make it unfair.**

The mechanism: `movementSim` needs `MOV_FAMILY` membership or a `MOVEMENTS` region entry to score
anything, and **306 of 495 offered labels (61.8%) have no `MOV_FAMILY` membership**. Sub-variants
like `New Spanish Baroque` are precisely the labels missing from it, so their similarity floors near
zero. Curated canonical movements have rich metadata and score high.

Net effect: the two guards jointly suppress **7 of the 36 curated `RELATED_MOV` neighbour pairs
(19.4%)**, including `Romanticism`<->`Neoclassicism` and `Post-Impressionism`<->`Pointillism`.
`RELATED_MOV` exists to say "offer these as instructive near-misses"; `sib()` says "never co-show
these." **Two subsystems contradict each other on a fifth of the curated list.**

**What does hold.** Across 118,220 grid sets and 7,072 shipped rounds: the answer is never absent
(0), duplicates never occur (0), sets are never short in daily or infinite play (0).

**One exception, training mode.** The restricted-pool branch at `:174-175` is not backfilled by the
`:197` fallback, so pinning few movements yields short rounds — 2 pinned movements produces a
**2-option round**, a literal coin flip. May be intended; it's undocumented and it changes the
scoring baseline.

**One data-side inconsistency.** The header comment at `:163` asserts cultures compete with cultures
and movements with movements. Measured: **422 scoreable works (7.1%)** have a `styleKind` of
`period`, `tradition`, `school`, or `genre`, so their answer isn't in the `MOVS` pool they draw
distractors from. And **17 labels appear under both `movement` and `culture`** in `data/pool.js`
(`Dutch Golden Age`, `Ukiyo-e`, `Qing dynasty`, `Ancient Roman`, others), affecting 628 movement
works and 145 culture works.

**Fixes, in order:** normalize labels before comparison (casefold, strip a much wider qualifier set,
compare on token overlap rather than a collapsed string); make `sib()` block on *subsumption* —
token containment — separately from blocking on *similarity*; reconcile `sib()` against
`RELATED_MOV` so the curated near-misses are explicitly permitted; resolve the 17 dual-classified
labels; decide what `styleKind: period|tradition|school|genre` works should draw distractors from.

**Why this matters beyond the product.** It's a *fairness* bug, not a data-quality bug, and it's the
first thing Gesso has produced that's shaped like trust and safety work rather than adjacent to it:
a safeguard whose failure mode is systematic, measurable, and in exactly the wrong direction, with a
named mechanism. "My guard was anti-correlated with its purpose, here's the measured rate, here's
why" is a strong writeup and it's a different genre from the agent-boundary piece.

### G-21 · One stale id silently discards an entire stored day [MEASURED, LIVE]

`index.html:1800-1804`, inside `dailyItems()`:

```js
const got = pinned[key].map(id=>byId[id]).filter(Boolean).filter(workComplete);
if(got.length>=ROUNDS) return got.slice(0,ROUNDS);   // else: fall through to the ROTATION
```

The ledger stores the exact five ids served for a date and tier. The guard is **all or nothing**: if
one stored id is no longer in `POOL`, or has since been marked `play:false` by a later quality pass,
`got.length` drops to four and **the entire stored day is discarded and replaced by the rotation** —
five different works, silently, no warning.

`workComplete` is time-varying, because `play` and `sensitive` get edited by later data passes. So
**flagging a work unplayable today rewrites the history of a day that was already played and
shared.**

Measured on current data:
- `data/daily-order.js`: **2 of 736** tier-days silently replaced
- `data/daily-history.js`: **15 of 200 tier-days (7.5%)** silently replaced

Concrete: `2026-07-08 impossible` stores five ids, two of which (`vaO199638`, `sifsg_F1917.553`) are
no longer in `POOL`, so the archive replays five entirely different works. Same for `2026-07-09
impossible`, `2026-07-28 hard`, `2026-07-17 hard`.

**This directly contradicts the ledger's own stated purpose**, commented at `:1806`: *"live forever
in the append-only ledger... so ANY past daily replays with its TRUE served works."*

**Fix:** serve the stored ids that resolve and backfill only the missing slots, or fail loudly rather
than silently substituting. Either way, log it. Silent substitution of an append-only record is the
worst available behaviour.

### G-22 · `buildIndexes()` is not idempotent [LATENT]

`:1440` computes `MINY` from `p.cats` **before** `:1446-1451` rebuilds `p.cats`. First call sees
stored cats; any later call sees rebuilt cats, which have had `"when"` forced back onto works that
opted out.

```
MINY after call 1 (production): -11000
MINY after call 2:              -25000
MINY after call 3:              -25000
```

`MINY` is the only non-idempotent output. **Shipped impact today is none** — `buildIndexes()` has one
call site at `:3975`. But any future re-init, test, or hot reload shifts the timeline floor by 14,000
years, and this is the mechanism by which G-12 corrupts G-01.

A full enumeration of every pool-field assignment found exactly six inside `buildIndexes()`
(`:1431-1471`), so there is **no fourth field overwrite there**. The class recurs elsewhere — G-21 is
the other instance.

### G-23 · One work's date axis is unwinnable [MEASURED, LIVE]

G-01 and G-12 combine. `:1440` excludes date-opt-out works from `MINY` using **stored** cats; `:1451`
then forces `"when"` back on. A work can therefore be date-quizzed while lying outside the slider
domain derived from `MINY`.

**11 works** have a stored `"when"` opt-out destroyed by `:1451`. Exactly **one** is then
date-quizzed with a true year below the slider floor:

```
Venus of Willendorf   y = -25000   fame 1237   play: undefined
  stored cats   ["where","medium","style"]        <- deliberate opt-out
  runtime cats  ["when","where","medium","style"] <- :1451 forces "when" back
  slider floor  -11000  (MINY, set by Swimming Reindeer)
  true year is 14,000 years below the floor

driven through the real score():
  best reachable guess (-11000) ->  250/2500  "same period"
  unreachable exact    (-25000) -> 2500/2500
```

**A player cannot score above 10% on the date axis no matter how well they know the work.**

The comment at `:1439` states the exact intent that `:1451` destroys: *"deep-prehistory pieces like
Venus of Willendorf opt out of date-guessing (cats without 'when') so they don't drag the slider back
to -25000."* The opt-out is honoured for `MINY` and then discarded for the question.

**Scope:** Venus is **not** in the frozen `byDate` schedule. It reaches players only through the
rotation fallback, which the sweep reports returns it on two dates. The defect is real regardless —
the work is playable, `workComplete` passes, and its date axis is unwinnable whenever served.

Fixed automatically by fixing G-12. Worth a regression test that asserts every date-quizzed work's
true year lies within the slider domain.

---

## P3 — claims and copy

### G-17 · README corpus count is stale [BOTH]

"Roughly 5,900 public-domain works." Tested pool contains **6,557**. The one place the summary
*under*sells.

### G-18 · "Cultural-sensitivity review gate" overstates what ships [CODEX]

The README is candid that sensitivity review is a future pass; the oversell is in the project
brief's "cultural-sensitivity review gate."

The scheduler excludes human remains (`freeze-daily.mjs:13`) but still schedules funerary and sacred
objects, which get context copy (`index.html:1363`), not enforced human sign-off. Compare against
the "next pass" wording at `README.md:90`.

Either build the gate or describe it as context copy plus a remains exclusion.

### G-19 · Rarity and token-spend claims in showcase.md [CLAUDE]

"A combination very few PMs can claim in one artifact" — a rarity claim without a comparison class,
in a document about yourself. The sentence a hostile reader quotes back. Cut it.

"915k tokens of AI QA" — spend metric presented as outcome metric. Replace with what it caught: the
417 hidden works, the England/Paris bug, the Skater, the Vanuatu stone.

### G-20 · Merge-pipeline risk taxonomy placements [CODEX]

`curate-merge.mjs:44` auto-applies "lower-risk" model judgments (known style mappings, bucket-valid
media) while queuing title, place, date, and image corrections. Codex disagrees with every
placement — model-proposed medium and playability aren't obviously safe.

The demonstrated competence is that a taxonomy and enforcement boundary exist. The specific line is
arguable, and it's exactly what a T&S interviewer would probe. Be ready to defend it.

---

## Spinoffs, re-ranked

### S-1 · Near-miss auditor benchmark — 2-3 days · still highest value

Fix G-04 and make it the artifact it was trying to be.

1. **Ship Arm B as the new baseline.** Image present, filename hashed. It already scores 100/100
   and it measures what the document claims to measure. ~15 cents.
2. Replace `ranked.find()` with sampling producing a distinct decoy per trial — currently 25 decoys
   draw from two images.
3. Graded tiers on top of the Arm B setup: gross cross-region → same region different era → same
   movement different artist → same artist different work → same artist within 10y same medium →
   same artist same series.
4. Controls with independent provenance, not "previously audited" (currently circular).
5. **Stratify by fame as well as tier.** The current eval runs entirely on famous works where the
   auditor may pass via recognition rather than perception.
6. Precision/recall per cell with bootstrap CIs. Operating threshold with a stated cost ratio.
7. Handle the >10 MB image cases — two controls errored out in the image arms. Downscale before
   sending rather than dropping them, or the hardest-to-render works get silently excluded.

Feasibility: 4,823 usable works, 464 artists with ≥2, 242 with ≥4, **33,758 same-artist pairs within
10 years**, 106 style groups with ≥5. Deep series for the hardest tier: Dürer 157, Goya 110, Hokusai
89, Hiroshige 82, Titian 70, Rembrandt 65.

Watch for label noise at the top tiers — a swapped image may be a legitimate alternate view, detail,
or workshop replica. Hand-check, or add an `ambiguous` label excluded from scoring.

**The drop is the finding.**

### S-2 · Agent-boundary threat model + hostile fixtures — 2-4 days

Fix G-03 properly and write it up. Fixtures for redirects to loopback and private ranges, oversized
responses, wrong MIME, malformed image data, prompt injection in pixels, prompt injection in EXIF.
Then harden the fetch broker and require provenance-bound schema output.

**The only artifact in the portfolio with an adversary in it.** Both audits named the absence of an
adversary as the biggest gap for T&S.

### S-3 · Make the negative-correlation finding publishable — sequenced

Three tractable steps, in order:

1. **Fix G-05.** It's the facet blocking the result, and removing it already strengthens the effect.
2. **Extend the ladder past rung 4** so the 52% censored works enter the sample. Currently the
   finding describes only works the ladder could break.
3. **Acquire non-European coverage.** 84% European; Asia n=9, Africa n=5, Oceania n=1. This is the
   expensive one and it's a corpus-harvesting problem, not an analysis problem.

Optional fourth: re-run the full 410-work probe capturing `layPct` so the inversion can be tested
against an independent construct. Can't be done from existing artifacts — `layPct` exists in 7
works.

### S-4 · Open-encoder representation probe — 3-5 days

Smallest credible fix for the model-internals gap, reusing the existing 410-image transform set.

Per image and transform: capture representations from several encoder layers; measure same-work
retrieval rank against the corpus; compare representation similarity as perturbation increases;
train held-out linear probes for work identity, period, region, medium; stratify failures by fame,
source, region, medium.

Replacing the self-reported `recognized` boolean with continuous embedding similarity fixes both
halves of G-07 — no censoring, no self-report.

**Add alternate photographs or scans of the same work where available.** That separates
image-template memorization from work-level recognition, which is the sharper question: *are famous
works resistant because of visually distinctive structure, or because models memorized canonical
image variants?*

Gate first: does a small open VLM recognize famous artworks at all? Test 20 works across the fame
range. If recognition is near-zero there are no labels to learn from.

### S-5 · Where do people think art was made? — 1 line + a re-run

Fix the map-pin bug (`study-aggregate.mjs:53` reads `g.ll[0]`/`g.ll[1]`; `index.html:3037` writes
`{lat,lng}` — all 713 logged where-guesses are the literal string `"NaN,NaN"`). Supabase rows are
intact, so a one-line fix and a re-run recovers everything.

Then: not "how accurate were people" but *which way they're wrong*. Does everything ancient drift
toward Egypt? **Do people place works by where they saw them rather than where they were made, and
does that correlate with the holding museum?**

n=9 is small, but this is descriptive and the effect sizes would be large if they exist.

### S-6 · Does a model reason better when it stops recognizing? — a re-run storing every rung

Currently `vision` stores only the terminal rung. Store all five for a dose-response curve per
facet.

The motivating record: Mona Lisa at the tightest crop reports non-recognition, then answers 1620,
Italian Baroque, Caravaggesque tenebrism, possibly Artemisia Gentileschi — citing craquelure, canvas
texture, flesh-tone glazing. Confidently wrong and *visually defensible*. A model reasoning instead
of retrieving.

**Is a blinded model better calibrated than a recognizing one, because it has to justify from
pixels?** Given the negative correlation now survives stratification, this is the natural next
question and your corpus has ground truth on five independent facets per image.

### ~~S-7 · The note-only arm~~ — downgraded

Bounded at ≤0.8 percentage points. Nice-to-have confirmatory arm, not necessary.

---

## The writeup

Retitle bluntly: **"Image transformations do not reliably blind vision models to canonical art."**

Include: 95.6% / 54.0%, the **tie-corrected** correlations (0.271 all, 0.169 non-canon, 0.059
canon), sample selection (Easy tier, fame median 1,084 vs pool 26), the prompt, the stopping rule,
and the limitations.

**Lead with the inversion, not the resistance.** ρ = −0.183 on clean reads, −0.254 excluding the
broken `where` facet, appearing independently in style and medium, stable across era strata. That's
the result nobody was looking for and it's the one worth publishing.

**Do not present the ease model as validated** — and note that it currently reaches no consumers at
all.

---

## Legibility

Both audits independently concluded the strongest evidence is unreachable. No bio, location, site
link, pinned repos, or profile README on GitHub. Repo description mentions none of the evaluation,
gating, or bias work. `tasks/provenance-gates-plan.md` is ~5 clicks deep in a folder named "tasks,"
linked from nothing. `vision-guess.mjs:5-9` is nine lines inside a 165-line script in a directory of
~200. The README's recommended reading order points at the PM documents.

Two hours of surface work, highest return in the series. Covered separately in the GitHub surface
document.

**Link `auditor-eval.md` with the caveat, not without it.** Pointing an evaluation-literate reader
at a 100/100 result that string matching reproduces is worse than not linking it. Naming it yourself
converts a weakness into evidence.

---

## What's strong — don't break it

- **Incident-derived detectors.** `check-pool.mjs` (~37 hard, ~17 warn, `process.exit` at `:400`,
  wired into CI). Every rule names the incident that produced it. `:231-233` documents a *dropped*
  check because 124/124 were false positives.
- **`tasks/provenance-gates-plan.md`** — root-causes three data bugs to one entry point, states the
  principle, sets a build order, and records a decision *not* to ship the hard gate because the dry
  run mixed real errors with legitimate copies of older masters and bad Wikidata lifespans. Shipped
  as WARN with a triage backlog, an exemption file, three named follow-ups. Coverage/false-positive
  tradeoff with the enforcement tier matched to confidence. **Still the single most transferable
  artifact you have.**
- **The blinding argument** at `vision-guess.mjs:5-9`. Verified: request body at `:114-120` is
  `{model, max_tokens, messages}` with no `tools` key; prompt at `:57-75` carries no title, artist,
  or date; image arrives as base64 so the filename never travels.
- **`db/devices.sql`** — best security code in the portfolio. SHA-256 of a client-minted secret,
  `SECURITY DEFINER` with `set search_path = ''`, fully schema-qualified, inherited grants explicitly
  undone including `revoke ... from service_role` with an inline comment explaining why. Identity
  from `auth.uid()` inside the definer function.
- **`db-verify-guarded.mjs`** — writer-first and erasure-first orderings, real database blocking,
  max-score semantics under concurrency, contaminated projections can't become authority.
- **Four migration gates** parsing SQL *semantics* rather than presence — row locking, return
  contract, deadlock safety. All four in CI.
- **`tests/api-device-ownership.test.mjs`** — 389 lines, adversarial, header says "the pre-fix
  handlers would fail these."
- **Your own audit documents are real.** Findings stay open with expiry conditions; the ledger argues
  its own severity *down* where evidence supports it; DOC-10 exists solely to record that the README
  over-claims deletion correctness. **They also found the censoring and circularity problems before
  the external audits did.**
- **`docs/ethos.md`** preserves criticism rather than affirmation. Sharpest line aimed at you:
  "Disclosure is not discharge."
- **Collaboration with Briana is documented, verifiable evidence.** `README.md:225` separates her
  visual/interaction system from your implementation; `docs/combo-design-language.md` decodes her
  conventions, identifies your overrides, provides a porting checklist, preserves open questions. 25
  Briana-authored commits, multiple design branches, in-product attribution at `index.html:1779`.

---

## The pattern, now measured

**Governance is incident-triggered and arrives late.** Dated by commit position:

| artifact | commit | % through history |
|---|---|---|
| `check-pool.mjs` | #384 | 35% |
| `check-design.mjs` | #431 | 39% |
| `audit-detectors.mjs` | #754 | 69% |
| `.github/workflows/ci.yml` | #767 | 70% |
| `docs/ethos.md` | #848 | 78% |
| `tasks/lessons.md` | #975 | 89% |
| `docs/audits/` | #1068 | 98% |
| `check-function-count.mjs` | #1080 | 99% |

Monotonic in degree of abstraction: first-order gate at 35%, CI enforcement at 70%, values register
at 78%, lessons file at 89%, audit-of-audits at 98%. Same shape in letterbddy.

Commits are the right unit — ~500 of 1,084 landed in the first nine days, so `check-pool.mjs` at
"day 6" is already several hundred commits of accumulated complexity.

**Incident-triggered, not schedule-triggered**, which is what separates this from "documentation
comes last." `check-function-count.mjs` exists because a Vercel deploy failed on the 12-function
limit, and its comment cites the incident and the vendor doc.

**You test the arbiter, not the inputs.** The sharpest diagnosis in the series:

| surface | what it decides | coverage |
|---|---|---|
| The daily scheduler | the core algorithm | zero — G-09 lives here |
| The geo input layer | every geographic score | zero — G-05 lives here |
| The date transform | a 2,500-point axis | zero — G-01 lives here |
| `styleChoices` | whether a round is *fair* | zero |
| The guessability pipeline (7 scripts) | the research conclusions | zero, none in `npm test` |
| `db/guarded-writes.sql` | six hardened DB functions | a 117-line gate, zero callers |

`whereCredit` arbitrates geographic credit, is a clean pure function, and is well tested. Every
input feeding it is untested. `check-pool.mjs` gates the pool; nothing gates the scripts that write
the pool.

The arbiter gets scrutiny because the arbiter is where the interesting judgment lives.

---

## Next places to look — both prior predictions hit

Addendum 1 named two places to look next. Both produced live defects, which is a good sign about the
audit's model of the codebase.

1. **`styleChoices`** -> G-24. Predicted "potentially G-01-class." It was.
2. **The daily and archive replay path** -> G-21, G-22, G-23.

Still unexamined, in rough priority order:

1. **The remaining ~4,000 lines of `index.html`** outside the scoring block — rendering, routing,
   gallery, training mode, sharing. Read shallowly by every pass so far.
2. **The harvest adapters.** 188 scripts total; the gates and the vision pipeline were read closely,
   the rest sampled. `check-pool.mjs` gates the pool; nothing gates the scripts that *write* it, and
   G-01 entered through exactly that door.
3. **Training mode more broadly.** G-24 already surfaced an undocumented 2-option round there. It
   has its own restricted-pool code paths and its own scoring baseline.

Still outstanding elsewhere: the poker push/fold Nash verification is unmeasured. Local compute
only, no API spend.

---

## Loose ends

- **Pre-commit hook has never run** — `core.hooksPath` still points at `.git/hooks`. One minute.
- **CI triggers only on `main`** while current work sits on a feature branch.
- **`db/guarded-writes.sql`** ships six hardened functions and a 117-line gate; `grep guarded_`
  across `api/ server/ index.html` returns nothing. Handlers still write via raw PostgREST. **The
  biggest gap between built and shipped in the portfolio.**
- **Commit the 410-work probe manifest.** 15 minutes, and without it your most substantial dataset
  isn't reproducible.

---

## Running defect ledger — all repos

| id | status | summary |
|---|---|---|
| G-01 / F-01 | live | `MINY` overwritten to −11000; date scale poisoned for 1,428 works |
| F-02 | live | poker-face pays on a different hand than it displays |
| F-03 | live | subplot's receipt contradicts its own recommendation |
| G-04 / F-04 | **measured** | eval solvable with **no image at all** (arm C 100/100); auditor vindicated (arm B 100/100) |
| F-05 | live | all 713 study map pins destroyed at aggregation |
| G-08 / F-06 | framing | probe sample is the Easy tier, presented as a finding about artworks |
| G-07 / F-07 | prior work | censoring and self-report circularity, already in the repo's own audits |
| G-05 / F-08 | live | 25% false-zero `where` scores; France scored from a centroid in the Atlantic |
| G-09 / F-09 | live | repair pass creates 61% of artist-gap violations |
| G-10 / F-10 | live | typing "painter" wins the artist category on 35 works |
| F-11 | docs | summary sentences overclaim where detailed sections are accurate |
| G-11 / F-12 | live | tier leniency inverted on the date axis |
| G-12 / F-13 | live | cats rebuild destroys 11 stored opt-outs |
| **G-21 / F-14** | **live** | one stale id silently discards an entire stored day (7.5% of history) |
| **G-22 / F-15** | latent | `buildIndexes()` not idempotent; `MINY` → −25000 on re-init |
| **G-23 / F-16** | **live** | *Venus of Willendorf*'s date axis is unwinnable (max 10%) |
| **G-24 / F-17** | **live** | `styleChoices` ships two defensible answers in ~1 daily in 27; both guards structurally broken |
| G-02 / S-01 | live | production serves the whole repo; reconnaissance-only, both paths verified |
| G-03 / S-02 | theoretical | untrusted data reaches an agent's shell in the audit prompt |
| S-03 | live | leaderboard unauthenticated, unrated, unbounded in body size |

**19 findings, 12 live.**

---

## What to write up, revised

Three candidate pieces, and the ordering has changed.

### 1. The eval methodology piece — now the strongest, and it's nearly written

The three-arm result gives you a complete arc with a measured payoff at every step:

> Built an image-audit eval. Got 100% precision and 100% recall. Wrote down in the limitations
> section that the decoys were probably too easy. Later checked properly: a run with **no image at
> all** reproduces the same 100/100, so the score carried no information about vision. But a run
> with the image and the filename destroyed *also* scores 100/100 — the detector was fine. The
> instrument was broken, not the thing it measured. Cost to find out: forty-four cents.

The generalizable claim is the one that transfers: **an eval that never removes the alternative
explanation cannot distinguish the capability it names from a shortcut, and a perfect score is the
strongest signal that this has happened.**

That's the piece to write first. It's honest about your own artifact, it has real numbers, it
vindicates the system while indicting the measurement, and every reader in trust and safety or model
evaluation has shipped a metric with this problem.

### 2. The fairness-guard piece — the most interesting, and it's new

G-24. A guard designed to prevent two-defensible-answer rounds, which turns out to be **perfectly
anti-correlated with its purpose**: it blocks the instructive near-misses a sibling subsystem
explicitly curates, and permits the subsumption pairs that make a round unwinnable. Measured rate on
shipped content: one daily in 27. Named mechanism: 61.8% of labels have no `MOV_FAMILY` membership,
and the missing ones are exactly the sub-variants.

This is the first Gesso artifact shaped like trust and safety work rather than adjacent to it. The
transferable claim: **a safeguard tuned on the cases you thought of can be systematically wrong on
the cases you didn't, and the failure can be perfectly inverted rather than merely incomplete.**
That's a policy-enforcement lesson, not a data-quality one.

### 3. The agent-boundary piece — still the only one with an adversary

G-03. Untrusted third-party URLs from 22 distinct hosts reaching a shell-capable agent's action
space, in a repo that contains the correct capability argument for the neighbouring pipeline. Still
worth writing, still the only artifact with an adversary in it.

### And the research finding

The negative correlation on clean reads (ρ = −0.183 shipped, −0.254 excluding the broken `where`
facet, stable across era strata) is a separate piece and a longer one. It needs G-05 fixed, the
ladder extended past rung 4, and non-European coverage before it's publishable. Don't let it block
the three above.
