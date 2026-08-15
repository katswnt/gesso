# Gesso image / works pipeline (canonical)

The pipeline exists so the site never carries a wrong, blurry, silently-changed, or un-taught image — and so we can pull from ANY museum, not just ones with a good API.

**Core principle:** works are TARGETED any way (by museum, region, artist, coverage gap), but IMAGES are fetched via **Wikidata/Commons P18**, never the museum's own API/site. Commons already holds high-res images across all museums, so going through Wikidata broadens the museums we can use (museum sites are often low-res / JS-rendered — e.g. NGV's own site is 694px). Every added image is **fingerprinted** for drift detection; every work added to the site is **queued for a vision pass that Kat runs MANUALLY with Sonnet agents** (never Codex, never auto-run).

---

## Stages

### 1. Source — fetch works + images via Wikidata/Commons
- Target a museum: SPARQL `?item wdt:P195 wd:<museumQID>; wdt:P18 ?img`. Also region/artist/gap queries.
- Image URL is ALWAYS the Commons `Special:FilePath/<file>?width=1600` redirect (survives renames), not a museum CDN.
- Missing place (no P495)? Derive region from the artist's nationality (P27) instead of dropping the work.
- Scripts: `fetch-harvest.mjs`, `harvest-museums.mjs`, `fetch-regions-overnight.mjs` (multi-source), `harvest-ngv.mjs` (a museum-via-Wikidata example). Bespoke museum-scraper scripts are one-offs — Wikidata is canonical.

### 2. Shape / dedup — `shape-coverage-harvest.mjs`
- Dedup vs pool ids / QIDs / image URLs.
- Junk filters: accession-number titles; non-art (newspapers, book/plate/folio refs); **coins** (ruler is recorded as "artist"); **genid blank-node URLs** as artist → anonymous; **culture-name as artist** ("Franks", "Byzantine; Eastern Mediterranean") → anonymous.
- Hard copyright cutoff: drop `y > 1928`.
- Style: assign only a recognized/guessable movement/culture (Oceania by place → "Māori art" etc.; others only if in MOVEMENTS keys or already pooled). Reject place-as-style ("Egypt","Iran"). No valid style + no artist → drop.
- **URL upgrade** (critical — the harvest stores PREVIEW sizes): AIC `/full/843,/`→`/full/1686,/`; Cleveland `_web.jpg`→`_print.jpg`; V&A `/full/843,/`→`/full/1400,/`.
- Te Papa `/full` masters: already width-gated ≥900 at harvest; treat as known-large (do NOT Range-fetch — their server 500s on Range; images are 3–11 MB).
- Only trust Te Papa collections TaongaMāori/PacificCultures/Art-taonga (its "Art" collection is settler/modern).
- Writes `data/incoming/promote-ready.json` (no pool mutation).

### 3. Size-gate — `finalize-coverage.mjs`
- Resolve native width: Commons via imageinfo batch (no download); museum via Range 64KB header parse; known-large URLs (AIC-1686 / Cleveland-_print / Te Papa-/full) assumed ≥1000 (no fetch); Range fetches run in PARALLEL batches (24), never sequential.
- Threshold: **MIN = 1000px** (reveal renders ~760px CSS, ~1520 retina; <700 = mushy).
- Balance: keep valid-style works up to `PER_STYLE_CAP = 120`; fill with artist-only up to `STYLELESS_FRAC = 0.7`.
- Writes `data/incoming/promote-final.json` — REVIEW the full title list here before promoting.

### 4. Copyright / PD gate — `check-pool.mjs` (local denylist) + `audit-copyright.mjs` (Wikidata P570 death dates)
- `isInCopyright` floor list + `y > PD_CUTOFF` (rolling ~year−96) for foreign named-artist works (URAA). Verified exceptions in `PD_OK`; pending in `data/uraa-pending.json`.

### 5. Fingerprint / pixel-audit — `fingerprint-images.mjs`
- Commons: **sha1** + w×h (imageinfo). Museum: w×h + bytes (Range). Writes `data/image-fingerprints.json` (COMMIT it — it's the known-good baseline). Re-fingerprint after every promotion.

### 6. Promote + gate — `promote-coverage.mjs` → `check-pool.mjs`
- Append via `writeAssignment`; dedup defensively; inline culture-name scrub; clear vestigial styleKind where style is empty; anonymous works never carry "artist" in cats; new works get fame=0 → deepest impossible.
- **Gate as its OWN step.** Read `✅ PASS` visibly, THEN commit separately. Never `gate && commit`.
- Field-scope-diff the pool before commit (only intended fields changed).

### 7. Queue for vision — `vision-next.mjs`
- Selects the next N works not in the ledger (`data/vision-audit.json`), priority/easy/schedule modes; writes `vw-in-N.json` chunks. Does NOT run vision. Use Sonnet FMT (Codex outputs are disabled).

### 8. Vision (MANUAL, Sonnet) — `scripts/vision-audit-prompt.md`
- Kat spawns one Sonnet agent per chunk. Each downloads + VIEWS each image and judges: image.ok (wrong-art → suggestedUrl), playable (featureless → false), imageQuality, framing, mediumLegible, and 5–7 feature-anchored look-closer pins (x,y % measured ON the feature). Writes `vw-out-N.json`.
- Merge: `curate-merge.mjs <out…>` (notes/pins/medium/style — creates the teach entry for newly-audited works) + `vision-mark.mjs` (record ids in the ledger). Never auto-run; ask before a bulk pass and give the cost.

### 9. Drift-watch — `check-image-drift.mjs` (weekly)
- Re-fetch fingerprints, diff vs baseline → content-changed (sha1) / size-changed / gone / url-changed. Confirm "gone" with a retry (kill transient 429s). Changed works → re-audit queue. `npm run check:drift`.

---

## Ongoing image-quality tools
- `audit-images-pool.mjs` — full-site native-resolution audit by tier (LOW <700, SOFT 700–1000). `audit-dailies.mjs` — rotation-aware, wired into `npm run freeze`.
- `find-hires-v2.mjs` — for blurry works: (1) museum IIIF full-size masters (safe, same image, no vision check), (2) deeper Commons search (needs vision-verify). `find-hires-strict.mjs` — title-exact variant.
- **Commons title search is ~5% correct** — it returns different works, details, B&W repros, keyword collisions. ALWAYS vision-verify a Commons swap before applying. `apply-lowres-swaps.mjs <file>` applies field-scoped img-only swaps and re-verifies ≥1000px.

## Key thresholds
| Param | Value |
|---|---|
| Size gate | 1000px native |
| Copyright cutoff | y > (year − 96), hard y>1928 at harvest |
| Per-style cap | 120 |
| Styleless fraction | 0.7 |
| Range fetch batch | 24 parallel |
| Drift "gone" | confirm with 1 retry |

## Recurring gotchas (each cost a bug once)
Preview-URL sizes (AIC 843 / Cleveland _web / V&A 843) silently fail the size gate — upgrade at shape time. Te Papa 500s on Range → known-large. Commons search ~5% correct → vision-verify. Genid-URL artists / coins-with-ruler-artist / culture-name-as-artist / place-as-style → scrub in shape. Never chain gate→commit. Re-fingerprint after promotion. Vision = Sonnet, manual, ask first.
