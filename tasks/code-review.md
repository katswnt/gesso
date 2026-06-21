# Gesso Code Review

Verdict: this reads like an ambitious, product-minded project with real taste and a lot of hard-won domain work, but it is not yet unequivocally staff-level because the core rules are encoded in too many ad hoc places and the data pipeline lacks strong invariants. The best signal is the deterministic daily/fame/scoring concept; the biggest thing holding it back is that important domain contracts (origin, medium, PD eligibility, generated-data trust) are documented but not enforced uniformly enough for a recruiter-agent review.

## Critical

### Origin convention is currently violated by data

- `scripts/audit-data.mjs:23` flags artist-origin mismatches, and `node scripts/audit-data.mjs` currently reports `artistOrigin 164`. Examples include `The Starry Night | France -> expect Netherlands` and `Whistler's Mother | United Kingdom -> expect United States`.
- Problem: the project states that origin is the artist's country of origin, not holding museum location. Several records appear to use place made, subject place, or collection-supplied place strings instead.
- Why it matters: this is a product-rule breach on the main scoring category. It will make correct player guesses look wrong and undercuts the claim that the data model encodes art-history intent.
- Recommended fix: implement the stated convention in one place: add an `artistOrigin` normalization pass keyed from Wikidata creator nationality/country-of-citizenship plus manual overrides, fail `audit-all` when `artistOrigin` is nonzero for scored works, and freeze dailies only after the audit is clean.

## Major

### Generated text is inserted as HTML without escaping

- `index.html:1149`, `index.html:1150`, `index.html:1259`, `index.html:1317`, `index.html:1319`
- Problem: hint text, guide text, study-note `why`, and cue strings are inserted through `innerHTML`/`insertAdjacentHTML` without escaping at the final insertion point. Some strings are generated from static files, but those files are produced from external APIs and AI-assisted scripts.
- Why it matters: "static generated data" is still an input boundary. A portfolio reviewer will flag this as an XSS posture issue, especially because the app already has an `esc()` helper and uses it inconsistently.
- Recommended fix: make a tiny rendering helper for trusted markup vs plain generated text. Escape `study.why`, `study.cues`, guide bodies, and hint output by default; only allow explicit, audited markup fields if needed.

### Pipeline writes are not transactional

- `scripts/rehost-aic-blob.mjs:18`, `scripts/rehost-harvard-blob.mjs:16`, `scripts/resolve-harvard.mjs:24`, `scripts/fix-support-medium.mjs:46`, `scripts/consolidate.mjs:184`
- Problem: many scripts rewrite `data/pool.js` directly by slicing around the first `[` and last `]`. Several save partial progress in place.
- Why it matters: interruption, malformed generated JS, or a bad slice can corrupt the main corpus. Senior-level pipeline code should make destructive writes boring: parse robustly, write a temp file, validate, then atomically rename.
- Recommended fix: add a shared `scripts/lib/static-module.mjs` with `readWindowAssignment(name,path)` and `writeWindowAssignmentAtomic(name,path,value)`. Validate JSON and optionally run `node --check` on a generated wrapper before replacing tracked data.

### Data parsing relies on fragile regex/slicing of JavaScript modules

- `scripts/audit-copyright.mjs:7`, `scripts/freeze-daily.mjs:6`, `scripts/check-images.mjs:6`, `scripts/audit-data.mjs:4`
- Problem: generated `data/*.js` files are parsed with string replacement or greedy bracket matching.
- Why it matters: this works until a string contains an unexpected bracket, a prefix changes whitespace, or another assignment lands in the file. It also duplicates parsing policy across the pipeline.
- Recommended fix: same shared static-module parser as above, with tests against `pool.js`, `fame.js`, `daily-order.js`, `teach-works.js`, and deliberately tricky string contents.

### The shipped data payload is too large for a no-build SPA

- `data/teach-works.js` is about 9.6 MB, `data/pool.js` about 2.2 MB, and tracked data totals about 13.3 MB before compression.
- Problem: every player pays for the whole corpus and all teaching notes up front, including works they will not see in the current round.
- Why it matters: the no-build architecture is a valid tradeoff, but the current payload size is a real performance liability on mobile and weak networks. It is also an easy critique in a hiring review.
- Recommended fix: keep the no-build approach but shard generated data by purpose: daily core payload, on-demand teach-note shards keyed by work ID prefix/tier, and optional archive/practice payloads. Preserve script-tag loading if desired; just load less on first paint.

### `audit-all` hides failures

- `scripts/audit-all.mjs:7`
- Problem: audit commands catch errors and continue, then print summaries that may be based on stale files.
- Why it matters: audit tooling should fail closed. If a verifier breaks, deployment should not look green.
- Recommended fix: collect failures, still print all possible summaries, then exit nonzero if any audit command failed. Add `--soft` for exploratory local use.

### Source adapters duplicate domain logic

- `scripts/build-pool.mjs:33`, `scripts/consolidate.mjs:21`, `index.html:323`
- Problem: medium simplification exists in multiple forms across scripts and client code. Recent copper/silver/wood fixes landed in the client path, but pipeline paths can still bucket differently.
- Why it matters: when generated `p.medium`, `p.medSimple`, audits, and scoring disagree, regressions look random and are hard to review.
- Recommended fix: extract one medium classifier into `scripts/lib/domain.mjs`, import it in pipeline scripts, and generate a small browser copy into `index.html` or `data/domain.js`. Add fixture tests for oil on panel, engraving on paper, silver gelatin photograph, copperplate engraving, bronze, wood support, and mixed-media edge cases.

## Minor

### Image zoom loses the original logical source after fallback

- `index.html:294`, `index.html:1554`, `index.html:1561`, `index.html:1594`
- Problem: `openZoom(e.target.src)` uses the currently displayed card URL. If `imgFail()` has cache-busted or replaced the image with weserv, zoom no longer has the original source context for `hiRes()`.
- Why it matters: fallback may rescue the card but leave zoom lower quality or source-transformed. This is a quality issue, not a correctness failure.
- Recommended fix: store the original artwork image URL in `data-src-original` on the `<img>` and call `openZoom(img.dataset.srcOriginal || img.src)`. Keep fallback URL only for display.

### IIIF URL rewriting handles only one size syntax

- `index.html:1554`, `index.html:1561`
- Problem: `displaySrc()` and `hiRes()` rewrite `/full/<digits>,/` only. IIIF services commonly also use `!843,843`, `pct:n`, or already-full forms.
- Why it matters: as new museum sources are added, the image pipeline can silently skip intended card/zoom sizing.
- Recommended fix: centralize `rewriteIiifSize(src,size)` and cover numeric width, `!w,h`, `pct`, and no-op cases with fixture URLs from AIC, Harvard, V&A, and any Blob-hosted originals.

### Scoring logic has no automated fixture tests

- `index.html:446`, `index.html:452`, `index.html:1168`
- Problem: the movement and artist partial-credit logic is nuanced and recently changed, but there is no test harness that exercises BCE ranges, missing movement metadata, exact-vs-partial caps, or artist partials.
- Why it matters: this is the hot path. Without fixtures, future changes can accidentally make a partial match equal an exact match or misparse BCE ranges.
- Recommended fix: extract pure scoring helpers into `scripts/lib/scoring-fixtures.mjs` or a tiny browser-independent test file. Add fixtures for `500 BCE-500`, `1000-1 BCE`, missing movement metadata, same family with no era overlap, exact movement, related movement, exact artist, same-school artist, same-era artist, and no metadata.

### Fame tier constants are split between client and freezer

- `index.html:508`, `scripts/freeze-daily.mjs:20`
- Problem: `tierItems()` uses percentage cuts for fallback display/counts, while `freeze-daily.mjs` uses explicit Easy T1/T2 sizes and then splits the rest.
- Why it matters: the production daily uses frozen order, but the UI's "works available" and fallback semantics can drift from the actual freeze policy.
- Recommended fix: generate tier metadata alongside `data/daily-order.js`, or share tier constants in one script/data file. The client should describe the frozen tier it is actually serving.

### Serverless report endpoint has no abuse controls

- `api/report.js:4`
- Problem: `/api/report` accepts arbitrary anonymous POSTs and writes to Redis with only truncation.
- Why it matters: this is not a secret leak, but it is operationally fragile. A public endpoint can be spammed and increase KV usage.
- Recommended fix: add origin checking, a small per-IP rate limit, and a honeypot/timestamp field. Keep the graceful localStorage fallback in the client.

## Nit

### Several helper names still underspecify domain meaning

- `index.html:763`, `index.html:1168`, `scripts/consolidate.mjs:35`
- Problem: names like `dailyItems`, `score`, and `CENTROIDS` are understandable locally but not explicit about product rules.
- Why it matters: naming is part of the portfolio signal. Domain-heavy code benefits from names that preserve intent.
- Recommended fix: prefer names such as `dailyWorksForTierDate`, `scoreLockedRound`, and `ORIGIN_CENTROIDS` when touching these areas next.

### Inline styles make review and accessibility work harder

- `index.html:837`, `index.html:1036`, `index.html:1263`, `index.html:1503`
- Problem: large render templates still contain many inline styles.
- Why it matters: this is acceptable for a fast prototype, but it weakens maintainability and makes visual/accessibility review harder.
- Recommended fix: gradually move repeated inline declarations into `styles.css` classes by screen, starting with round/reveal/final templates.

### Verification artifacts should be formalized

- `tasks/code-review.md` verification notes below; no package scripts exist in `package.json`.
- Problem: checks are currently tribal commands.
- Why it matters: recruiters' agents will look for a clear "how do I verify this?" path.
- Recommended fix: add npm scripts even without a build step: `check:syntax`, `audit:data`, `audit:all`, `audit:images`, and `freeze:daily`.

## Safe Improvements Made In This Pass

- Added top-level architecture/domain invariant comments to `index.html`.
- Added focused comments around deterministic shuffling, medium simplification, movement similarity, artist partial-credit metadata, and scoring caps.
- Removed the disabled `addPalestine()` map-label hook and its no-op calls.
- Rewrote `README.md` as a concise engineering/product brief covering architecture, scoring, public-domain discipline, image strategy, local running, deployment, pipeline scripts, and tradeoffs.

## Verification Run

- `node --check scripts/*.mjs api/*.js` completed without syntax errors.
- Extracted the main inline script from `index.html` and parsed it with `new Function(...)`: passed.
- Ran `node scripts/audit-data.mjs`: completed; important result is `artistOrigin 164`, `sharedImage 1`, `badImageName 3`, `missing 0`, `fameCollision 0`.
- Ran a small pure-function sanity check for `timeScore`, BCE formatting, and movement partial-credit caps: passed.
