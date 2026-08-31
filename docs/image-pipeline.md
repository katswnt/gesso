# Gesso data & image pipeline (canonical)

The pipeline exists so the site never carries a **wrong, blurry, silently-changed, or un-taught image**, a **forked/miscased label**, or a **bad data row** — and so the quality tools we've built actually *run at the right moments* instead of sitting unused.

**Core principle:** works are TARGETED any way (by museum, region, artist, coverage gap), but IMAGES are fetched via **Wikidata/Commons P18**, never the museum's own API/site. Commons already holds high-res images across all museums, so going through Wikidata broadens the museums we can use (museum sites are often low-res / JS-rendered — e.g. NGV's own site is 694px). Every added image is **fingerprinted** for drift detection; every work added to the site is **queued for a TOOL-LESS vision pass** (G-03): broker-fetched sanitized image → tool-less model completion (no tools/shell/net) → human field-level review → hash-bound guarded merge. Cost-gated, never auto-run; a tool-capable agent may explore but may never feed the merge.

---

## Enforcement model — READ THIS FIRST

There are two enforcement tiers, and they do NOT cover the same things. Know which tier a check lives in before you trust it.

### Tier 1 — the CI gate (blocks a prod push)
`.github/workflows/ci.yml` runs `npm run test:ci` on every push/PR to `main`:
`scoring` + `medium` + `static-module` unit tests · `dom-harness` · **`check-pool`** · **`check-design`**.

- **Network-free by design** (CI has no install step / no Wikidata access), so only *local* checks can live here.
- **`check-pool.mjs` is the workhorse** — ~25 HARD assertions (copyright/URAA, place↔region, blank-answer scoring, duplicate-QID, unplayable-in-daily, remains, ledger-immutability, medium-junk, style-vocab dups, genid/URL artist, …). A HARD violation exits nonzero → CI red.
- There are **no local git hooks**, and **Vercel deploys on push**. So check-pool/check-design are the *only* things standing between a bad commit and prod. Anything a machine can catch locally belongs HERE.

### Tier 2 — advisory audits (detect, never block)
Everything else. Two reasons a check can't be in Tier 1:
- **It needs the network** (Wikidata/Commons/museum) — excluded from CI on purpose; run post-harvest and (goal) on a schedule.
- **It's report-only** — writes a JSON report / prints a summary and exits 0 regardless of findings. A human has to read it.

`npm test` (local) runs *more* than CI — it adds `audit-local` + `audit-labels`. **A green CI is therefore WEAKER than a green local `npm test`.** Don't assume an audit that *exists* also *ran* or *blocked*.

### Trigger & fail-mode map
| check | what it catches | fires when | fail-closed? |
|---|---|---|---|
| `check-pool` | the recurring pool-data bugs (see stages 3/4/6) | **test:ci** (CI, push) + npm test | **HARD** |
| `check-design` | design-system gate | **test:ci** + npm test | **HARD** |
| `audit-labels` | label casing / near-dup / fragmented vocab / orphan movements | npm test **(NOT test:ci)** | report-only |
| `audit-local` | wraps audit-fields/place/style-text/vocab/fame/detectors | npm test **(NOT test:ci)** | report-only |
| `audit-all` | audit-data + audit-vocab + audit-p31 (+ check-images `--images`) | `npm run audit`; auto-invoked by promote-canon/harvest/modern/wishlist + consolidate | fail-closed on a verifier CRASH only, not on findings |
| `audit-dailies` | daily-image resolution/reachability (rotation-aware) | `npm run freeze` | **HARD** (network → not in CI) |
| `check-image-drift` | upstream Commons file changed vs fingerprint baseline | `npm run check:drift` | **HARD** (network → not in CI) |
| `audit-copyright` | creator died recently / URAA | `npm run audit:copyright`; soft in promote-wishlist | report-only, network |
| `audit-images-pool` / `audit-easy-images` | native-resolution sweep (pool / easy tier) | manual | report-only, network |
| `audit-image-ratio` | extreme aspect ratio (sliver handscrolls) / broken | manual | report-only, network |
| `check-images` | genuinely-broken Commons images | `audit-all --images` | report-only, network |
| `fingerprint-images` | build the drift baseline (sha1 + w×h) | `npm run fingerprint` | report-only, network |

**Rule of thumb:** if a defect class can be caught with only `data/*.js` (no network), it should be a HARD check-pool assertion so CI blocks it. Network checks run post-harvest and, going forward, on a scheduled Action (Phase 2 below).

---

## Stages

### 1. Source — fetch works + images via Wikidata/Commons
- Target a museum: SPARQL `?item wdt:P195 wd:<museumQID>; wdt:P18 ?img`. Also region/artist/gap queries.
- Image URL is ALWAYS the Commons `Special:FilePath/<file>?width=1600` redirect (survives renames), not a museum CDN.
- Missing place (no P495)? Derive region from the artist's nationality (P27) instead of dropping the work.
- Scripts: `fetch-harvest.mjs`, `harvest-museums.mjs`, `fetch-regions-overnight.mjs` (multi-source), `harvest-ngv.mjs` (a museum-via-Wikidata example). Bespoke museum-scraper scripts are one-offs — Wikidata is canonical.

### 2. Shape / dedup — `shape-coverage-harvest.mjs`
- Dedup vs pool ids / QIDs / image URLs.
- Junk filters: accession-number titles; non-art (newspapers, book/plate/folio refs); **coins** (ruler recorded as "artist"); **genid blank-node URLs** as artist → anonymous; **culture-name as artist** ("Franks", "Byzantine; Eastern Mediterranean") → anonymous.
- Hard copyright cutoff: drop `y > 1928`.
- **Style normalization happens on entry:** run the label through `canonicalizeStyle(style, canonMap)` (from `lib/domain.mjs`), where `canonMap = buildStyleCanon(<MOVEMENTS keys>)`. This folds case + word-order variants onto the curated MOVEMENTS spelling (`"academic realism"`/`"realism academic"` → the canonical key) and voids place-as-style. Every promote path now does this — `promote-canon/harvest/modern` too (they used to pass style through raw, which is how forked labels entered).
- **URL upgrade** (critical — the harvest stores PREVIEW sizes): AIC `/full/843,/`→`/full/1686,/`; Cleveland `_web.jpg`→`_print.jpg`; V&A `/full/843,/`→`/full/1400,/`.
- Te Papa `/full` masters: already width-gated ≥900 at harvest; treat as known-large (do NOT Range-fetch — their server 500s on Range; images are 3–11 MB).
- Only trust Te Papa collections TaongaMāori/PacificCultures/Art-taonga (its "Art" collection is settler/modern).
- Writes `data/incoming/promote-ready.json` (no pool mutation).

### 3. Size-gate — `finalize-coverage.mjs`
- Resolve native width: Commons via imageinfo batch (no download); museum via Range 64KB header parse; known-large URLs (AIC-1686 / Cleveland-_print / Te Papa-/full) assumed ≥1000 (no fetch); Range fetches run in PARALLEL batches (24).
- Threshold: **MIN = 1000px** on the shorter side (reveal renders ~760px CSS, ~1520 retina; <700 = mushy). Panoramas/handscrolls are the exception — a small short-side is fine when the long axis is huge; see `audit-image-ratio.mjs`.
- Balance: keep valid-style works up to `PER_STYLE_CAP = 120`; fill with artist-only up to `STYLELESS_FRAC = 0.7`.
- Writes `data/incoming/promote-final.json` — REVIEW the full title list here before promoting.

### 4. Copyright / PD gate — `check-pool.mjs` (structural, in CI) + `audit-copyright.mjs` (network, advisory)
- check-pool: `in-copyright` denylist + `post-pd-cutoff` (visible, foreign, named-artist, `y > year−96`) → HARD. Verified exceptions in `PD_OK`; pending in `data/uraa-pending.json`.
- `audit-copyright.mjs` reads Wikidata P570 death dates — advisory, run post-harvest.

### 5. Fingerprint / pixel-audit — `fingerprint-images.mjs`
- Commons: **sha1** + w×h (imageinfo). Museum: w×h + bytes (Range, with a full-GET fallback for CDNs that 500 on Range, e.g. Te Papa). Writes `data/image-fingerprints.json` (COMMIT it — it's the known-good baseline). Re-fingerprint after every promotion (`npm run fingerprint`).

### 6. Promote + gate — `promote-*.mjs` → `check-pool.mjs`
- Append via `writeAssignment` (keep the spaced `window.X = [...]` form — legacy parsers depend on it). Dedup defensively; scrub culture-name/genid artists; normalize style (stage 2); new works get fame=0 → deepest impossible.
- All promoters (`promote-canon/harvest/modern/wishlist/coverage`) auto-invoke `audit-all` after appending (the advisory network suite). The fail-closed gate is still a separate step (below).
- **Gate as its OWN step.** Read `✅ PASS` visibly, THEN commit separately. Never `gate && commit`.
- Field-scope-diff the pool before commit (only intended fields changed — see the diff snippet in `consolidate-styles.mjs`'s workflow).

### 7. Build a vision run — `vision-next.mjs`
- Selects the next N works not in the ledger (`data/vision-audit.json`) in schedule/easy order, and **fetches each image through the hardened broker** (`scripts/lib/img-broker.mjs`: HTTPS-only, SSRF-vetted, IPv4-only, decoded + EXIF-stripped + size-capped) into a fresh run dir `data/incoming/vision/runs/<runId>/` with a provenance manifest. Does NOT call a model. The model never sees a URL.

### 8. Vision (TOOL-LESS completion) — `scripts/vision-audit-run.mjs` + `scripts/vision-audit-prompt.md`
- **G-03:** the audit is a **tool-less** multimodal completion — no tools, no shell, no filesystem, no network. Each work's sanitized derivative + text metadata goes to the model; it judges image.ok/playable/imageQuality/framing/mediumLegible + 5–7 feature-anchored pins and returns strict JSON, written to a **quarantined** `completions/` dir. Cost-gated (`VISION_RUN_LIVE=1`), never in CI, never auto-run — ask before a bulk pass and give the cost.
- **Apply only via human review:** `scripts/vision-review.mjs <run> --approve <decisions.json>` writes a hash-bound `approved.json` (per id, only the fields the human approves), then `scripts/curate-merge.mjs --run <run>` verifies every binding, applies **only** approved values, and records that run's approved ids in the ledger. Nothing auto-applies; a manifest/completion edited after review is rejected before any write. **A tool-capable vision agent may be used for exploration only and may never feed the merge** (the `curate-codex`/`hotspot-codex`/`vision-mark`/`merge-hotspots` paths are retired).

### 9. Drift-watch — `check-image-drift.mjs` (goal: weekly)
- Re-fetch fingerprints, diff vs baseline → content-changed (sha1) / size-changed / gone / url-changed. Confirm "gone" with a retry (kill transient 429s). Changed works → re-audit queue. `npm run check:drift`.

---

## Ongoing image / data-quality tools
- `audit-images-pool.mjs` — full-site native-resolution audit by tier (LOW <700, SOFT 700–1000). `audit-easy-images.mjs` — the same, scoped to the easy tier. `audit-dailies.mjs` — rotation-aware, fail-closed, wired into `npm run freeze`.
- `audit-image-ratio.mjs` — extreme-aspect-ratio / sliver / broken images (the axis the single-number size-gate can't see; use it to tell a real low-res work from a legitimately wide handscroll).
- `check-images.mjs` — genuinely-broken Commons images (distinct from low-res and from drift). Runs via `audit-all --images`.
- `audit-labels.mjs` — label casing / near-dup / fragmented vocab / orphan movements. Report-only; the *blockable* subset (casing / word-order / descriptor dups) is now a HARD check-pool gate.
- `find-hires-v2.mjs` — for blurry works: (1) museum IIIF full-size masters (safe, same image, no vision check), (2) deeper Commons search (needs vision-verify). `find-hires-strict.mjs` — title-exact variant. `apply-lowres-swaps.mjs <file>` applies field-scoped img-only swaps and re-verifies ≥1000px.
- **Commons title search is ~5% correct** — it returns different works, details, B&W repros, keyword collisions. ALWAYS vision-verify a Commons swap before applying.

## Label vocabulary — keeping it un-forked
A style label written two ways ("Ming dynasty" vs "Ming dynasty painting") poisons multiple-choice distractors. Defense in depth:
1. **Prevent at entry** — `canonicalizeStyle` folds case/word-order variants onto the MOVEMENTS spelling (stage 2).
2. **Block at the gate** — check-pool HARD-fails `style-casing-dup` / `style-wordorder-dup` / `style-descriptor-dup`. The pool was consolidated to 0 on 2026-08-15, so a new fork reds CI until mapped.
3. **Fix** — add the `loser → winner` pair to `scripts/consolidate-styles.mjs` (winner MUST be a MOVEMENTS key) and re-run it; re-gate.

## Key thresholds
| Param | Value |
|---|---|
| Size gate | 1000px shorter side |
| Copyright cutoff | y > (year − 96), hard y>1928 at harvest |
| Per-style cap | 120 |
| Styleless fraction | 0.7 |
| Range fetch batch | 24 parallel |
| Drift "gone" | confirm with 1 retry |

## Recurring gotchas (each cost a bug once)
Preview-URL sizes (AIC 843 / Cleveland _web / V&A 843) silently fail the size gate — upgrade at shape time. Te Papa 500s on Range → known-large + full-GET fingerprint fallback. Commons search ~5% correct → vision-verify. Genid-URL artists / coins-with-ruler-artist / culture-name-as-artist / place-as-style → scrub in shape. **Raw style passthrough forks the vocab → always `canonicalizeStyle` on entry.** Never chain gate→commit. Re-fingerprint after promotion. Vision = Sonnet, manual, ask first. **An audit that exists hasn't necessarily run — check which tier it's in.**

## Roadmap — making "run everything on every mutation" real
- **Phase 1 (DONE, 2026-08-15):** label-vocab folded at entry + HARD-gated in CI; genid/URL artist HARD; fingerprint Te Papa fallback; Codex vision path removed.
- **Phase 2 (next):** a scheduled GitHub Action (mirror `supabase-keepalive.yml`) that runs the network audits weekly — `check-image-drift`, `audit-dailies`, `audit-place`, `audit-copyright` — and opens an issue on any non-zero exit. This is how the fail-closed-but-network checks finally get an automatic trigger.
- **Phase 3 (DONE):** the efficiency refactor. Image audits read native dims from the fingerprint baseline (`scripts/lib/img-dimensions.mjs`, ~92% no-fetch); all 6 WD audits (`p31`/`misharvest`/`copyright`/`fields`/`place`/`style-text`) share one incremental `wd-entities.json` pull (`scripts/lib/wd-cache.mjs`) instead of ~6 separate whole-pool SPARQL sweeps. Result: `audit-local`'s 6 advisory audits run in ~1.3s and `audit-all` in ~0.3s on a warm cache. Resolution enforcement is at the source — freeze-daily excludes baseline-LOW works from scheduling (a check-pool CI assertion would be belt-and-suspenders, not yet added).
