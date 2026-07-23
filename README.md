# Gesso

**A daily art-history guessing game — and, underneath it, a study in using a frontier LLM as a production QA system for a 5,948-work dataset.**

Live: **[gesso.katswint.com](https://gesso.katswint.com)** · Built by [Kat Swint](https://katswint.com) · Product design by [Briana Das](https://brianadas.com/)

Each day, players guess an artwork's **date, place of creation, medium, movement/culture, and artist** from its image, then get taught what to look for. The game is the visible half. The interesting half is the pipeline that keeps ~6,000 public-domain artworks correct, fairly scored, and honestly framed — with a large language model wired in as an auditor, not an author.

<!-- TODO before sharing widely: drop a gameplay GIF here (reveal screen with pins + teaching notes is the best single frame). -->

---

## Why this is interesting

The runtime is deliberately tiny; the intelligence lives in the **data pipeline**. The core bet: a frontier model is unreliable as an author but valuable as a *reviewer* — if you box it in with structured prompts, a safe/risky split, deterministic gates, and human sign-off. Gesso is that bet, shipped:

- **LLMs as an image-grounded QA layer.** Vision agents download and *look at* each artwork, then judge 7 dimensions (is the image even the right work? is it playable? legible medium? framing? + teaching notes with pixel-pinned coordinates). Output is structured JSON that flows into a merge step.
- **Hallucination guardrails by construction.** `curate-merge.mjs` **auto-applies only low-stakes fields** (style, medium, notes/pins) and **queues high-stakes ones** (title, date, coordinates, image swaps) for human review. The model can improve the dataset but can't silently corrupt its spine.
- **A fail-closed gate the model can't talk its way past.** `check-pool.mjs` runs on every commit and in CI; a hard violation exits non-zero and blocks the ship. Copyright leaks, unmapped movements, coordinate/country mismatches, and "featureless work scheduled as a puzzle" are all *mechanically* impossible to release.
- **"Turn every bug into a detector."** Each production bug I hit became a permanent, deterministic scan (`audit-detectors.mjs`) that runs on every change — so the class of bug can't recur silently.
- **Cost-aware layering.** Cheap deterministic checks and *zero-token* Wikipedia text checks run first; the expensive vision pass is reserved for what only vision can catch, and works are audited in most-seen-first order.

By the numbers: **5,948 works**, **2,262 image-audited (38%, most-seen tiers first)**, **126 pipeline scripts**, **11 serverless endpoints**, a **3,537-line no-build SPA**, **681 mapped art movements**.

---

## The pipeline

```
harvest (Wikidata SPARQL + museum APIs)
  → normalize + copyright filter (public-domain only; death-year gate + denylist)
  → fame ranking (Wikidata sitelinks + pageviews → difficulty tiers)
  → QA STACK ↓                                    → freeze daily schedule (deterministic, diversity-aware)
      1. deterministic detectors    (structural bugs, no network)
      2. zero-token text checks     (assigned style vs. Wikipedia intro)
      3. image-grounded vision QA   (LLM views each image → structured JSON)
      4. cross-field consistency    (date-vs-artist, culture-vs-place contradictions)
  → curate-merge (SAFE fields auto-apply · RISKY fields → human review queue)
  → check-pool GATE (fail-closed; in npm test + CI + pre-commit)
```

Every stage is **resumable** (append-only ledgers track what's been processed) and **advisory-vs-blocking** by design: advisory audits surface backlogs and never block; only the deterministic gate can stop a release.

**Key entry points:** `pull-*.mjs` / `build-pool.mjs` (source adapters: Met, AIC, Cleveland, Harvard, Smithsonian, V&A, Wikidata) · `consolidate.mjs` (dedupe + geocode merge) · `fame-score.mjs` (recognizability tiers) · `vision-next.mjs` → `curate-merge.mjs` (the vision QA loop) · `audit-detectors.mjs` (bug-class dashboard) · `check-pool.mjs` (the gate) · `freeze-daily.mjs` (deterministic schedule).

---

## Architecture & deliberate constraints

These are choices, not defaults — here's the reasoning, including where each stops paying off.

**No build step. Vanilla JS. No framework, no TypeScript, no bundler.**
The deployed artifact is the source: inspectable, dependency-light, and durable (nothing rots when a build tool goes stale). For a static-data game with no server-rendered state, a framework would add supply-chain surface and CI complexity for little gain.
*Where it stops paying:* `index.html` has grown to 3,537 lines in one inline script. The honest next step is to split it into several `<script src>` modules — which keeps the no-build constraint while restoring module boundaries. That refactor is scoped, not yet done.

**Leaderboard trusts client-submitted scores (today).**
Raw per-round guesses are stored server-side so scores can be **authoritatively re-computed** later (a documented "Phase 4"). The leaderboard is a social nudge, not a high-stakes ranking, so I shipped the loop first and deferred server-side replay. Known tradeoff, not an oversight — and the data to close it is already being captured.

**No script-src Content-Security-Policy.**
Because the app is 100% inline JS, a meaningful `script-src` CSP would require either `unsafe-inline` (which defeats the point) or build-time nonces (which conflicts with no-build). I ship the headers that *are* free and honest — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` — and escape all user-set strings at render. A real CSP is one more reason the modularization above is worth doing.

**Scoring constants are hand-tuned.**
Distance radii, the date-difference curve, and movement-similarity weights are game-design values, not learned parameters — appropriate for launch, but not yet validated against a real player score distribution. See roadmap.

**Pipeline writes are non-transactional — by design, and gated.**
The data scripts are human-run, one at a time, and each mutating step prints "run the gate as its own step" rather than auto-committing. There's no multi-file transaction because the **fail-closed gate is the transaction boundary**: nothing reaches production until `check-pool` passes on the final state, so an interrupted mid-pipeline write can't ship. Atomic temp-write+rename is used for the single-file writes; a cross-file rollback would be over-engineering for a solo, gated, human-driven pipeline.

---

## Scoring & difficulty

Each of five categories is worth up to 2,500 points, tuned to be *fair to a thoughtful guess*:
- **Date** — tier-scaled year-difference curve with decade-level bullseyes; a non-linear timeline gives recent centuries more track (most works are post-1400) and handles BCE/CE.
- **Place** — full credit for the country where the work was *made* (point-in-polygon over compact country geometry), with distance decay outside it, and partial credit for the right cultural region.
- **Medium** — a simplified *artistic-medium* taxonomy (oil, bronze, print…), not raw support material.
- **Movement/culture** — exact credit for exact matches, capped partial credit for related movements.
- **Artist** — a bonus, not a gate; hints subtract from core score only.

**Difficulty tracks recognizability, not art-historical obscurity** — and the product says so out loud. The home screen surfaces that "Easy" skews European *because the Western canon decides what's famous*, computed live from the pool. Difficulty is deterministic and **frozen**: every player gets the same five works per date/tier, and served days are immutable (a gate check blocks any silent re-write of the past).

---

## Data & licensing discipline

The corpus is restricted to **public-domain / CC0-safe** images (US-safe rule: creator died by 1955 and/or published pre-1930; FSA and US-government works are PD regardless). `audit-copyright.mjs` checks Wikidata-sourced works against creator death years. Domain conventions are enforced, not assumed:
- **Place = where the work was made**, not the holding museum and not the artist's nationality.
- **Medium = artistic medium/process**, not support material.
- **Secrets** live only in `.env` / Vercel env vars — gitignored, never shipped in client data. (The Supabase key in the client is the *publishable anon* key by design.)

Images come from museum image services, Wikimedia Commons, and Vercel Blob (for hosts that gatekeep browsers); `displaySrc()` serves a card-sized image, `hiRes()` fetches full-res only on zoom, `imgFail()` retries → proxies → graceful fallback.

---

## Quality gates & tests

- **`npm test`** — unit tests (scoring, medium bucketing, module loader), a headless **DOM load-harness** (runs the real app script in a `vm` sandbox to catch load-time throws without a browser), the **fail-closed pool gate**, and a design gate. Advisory network audits run separately (`npm run audit`).
- **CI** (`.github/workflows/ci.yml`) runs the network-free subset (`npm run test:ci`) on every push/PR.
- **Tests read functions out of the shipped `index.html`** rather than duplicating them — so they exercise exactly the deployed code, not a copy that can drift.
- **The LLM auditor is measured, not assumed** — a reproducible labeled eval ([`docs/auditor-eval.md`](docs/auditor-eval.md)) scores its wrong-art detection at 100% precision/recall on planted mismatches (see limitations for the near-miss caveat).

---

## Known limitations & roadmap

Stated plainly, because knowing the gaps is the point:

- **Vision-audit coverage is 38%** (2,262 / 5,948), prioritized most-seen-first so the works players actually encounter are verified first. Burn-down continues in batches.
- **The auditor eval covers *gross* mismatches, not near-misses (yet).** A reproducible 50-item labeled set ([`docs/auditor-eval.md`](docs/auditor-eval.md) · `scripts/eval-auditor.mjs`) scores the vision auditor at **100% precision/recall** on catching planted wrong-art — but those decoys are cross-region obvious mismatches. A *near-miss* decoy set (a different work by the same artist/era) is the harder next iteration.
- **Harvest isn't frozen.** Wikidata is a living graph; re-running a harvest won't reproduce the pool byte-for-byte. Drift is caught after the fact by the audits, not prevented by a committed snapshot — a snapshot/lock is the fix.
- **Modularize `index.html`** (see constraints above).

---

## Human judgment vs. AI assistance

Worth being explicit, since the project uses AI heavily — here's exactly where the human judgment lives.

**I designed and own:** the pipeline architecture and its guardrails (the safe/risky split, the fail-closed gate, the detector-first discipline), the scoring and difficulty model, the daily-scheduling and immutability rules, the product and editorial decisions (the honesty framing, the taxonomy, the teaching design), and every threshold in the gate.

**LLMs did, under that scaffolding:** bulk-drafted teaching notes and audited images *inside* a pipeline I built — every output passes through the safe/risky merge and the deterministic gate before it can ship. The notes are AI-drafted and human-audited via the image-grounded pass, not hand-written per work and not blindly committed. Audit coverage is reported honestly above rather than overclaimed.

The interesting part isn't "wrote 6,000 captions" — it's **building the system that lets a model do that safely and provably.**

---

## Run it locally

```bash
npm install
npm run serve      # static server on :8000  (or: python3 -m http.server 8000)
npm test           # full gate + audits
npm run test:ci    # deterministic, network-free subset (what CI runs)
```

No build step — open the served `index.html`. Data ships as `window.ARTEFACTUM_*` globals in `data/*.js`. Clean routes like `/2026-06-18/easy` need a real server (hence `npm run serve`).

**Stack:** vanilla-JS SPA · Leaflet maps · Vercel serverless (`api/*.js`) · Supabase (accounts) · Upstash Redis (share snapshots + rate limits) · Node ESM data pipeline · Wikidata/Wikimedia + open museum APIs (Met, AIC, Cleveland, Harvard, V&A, Smithsonian, and more).
