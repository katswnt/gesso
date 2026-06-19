# Training Mode — implementation spec

Fleshes out the "Training mode (spec)" + "Drill me on ___" items in `tasks/long-term-goals.md` into something buildable against the **actual** `index.html`. Grounded in the current Learning (infinite) mode, pool filtering, mastery store, and scoring code; line numbers are approximate (index.html is ~1806 lines).

Training Mode is **Learning mode with a constrained, facet-selected work set and (optionally) hidden inputs + a slice-scoped before/after summary**. It reuses almost all of the existing infinite-mode machinery; the new code is (1) a pool filter, (2) a free-text→facet parser, (3) a slightly different summary, (4) an extended `mastery` store, and (5) a start-screen entry. No streak/score impact, exactly like infinite mode.

---

## ✅ Design review — DECISIONS (2026-06, supersede any conflicting detail below)

1. **Chips are the hero; free-text is power-user sugar.** Lead the setup UI with tappable facet chips; the text box is a shortcut, not a dependency. The parser failing gracefully ("couldn't match: portraits") is acceptable *because nothing relies on it.* When text DOES resolve, immediately echo it back as removable chips — trust comes from the echo, not the parse. (Gap the parser exposes: there's no *subject* facet, so "renaissance portraits" can't fully resolve — chips sidestep this.)
2. **Training is its own route/screen (`/training`), not a 5th block on the start screen.** The start screen is at its hierarchy limit (4 daily tiers + Practice). Add ONE calm entry that opens the dedicated Training setup screen. Do NOT stack free-text + chips + tray + focus + count + start under the Practice panel.
3. **Single-axis drills OMIT the other inputs entirely** (default, not "optional polish"). A map-only round should look like a *map screen* — the single active input fills the space — not a normal round with three greyed-out "not scored" boxes.
4. **Weak-spot drill: surface the "why" AND the mix.** Label says why ("You're at 54% on Baroque — let's fix that"), and one line makes the 30% non-target mix visible ("mostly Baroque, with a few others to keep you honest") so the filter never feels broken.
5. **Naming — DECIDED: Daily / Infinite / Training.** **Infinite = endless random** (retire "Learning/Practice" as user-facing; "Infinite" matches the internal `infinite` flag and contrasts better with "Training" than the near-synonym "Practice" did). **Training = targeted drills.** *Already applied in index.html (heading, recap "Infinite session", share text, hint copy).* Differentiation line to hold everywhere: **Infinite doesn't ask you anything and tracks no goal; Training asks what to work on and shows your before→after progress on it.**
6. **The before→after delta ("54% → 71% ↑") is the hero of the training recap** — big, with the up-arrow, the visual centerpiece, NOT a line atop the strengths section. It's the only place a player sees themselves improve; spend the design budget there.
7. **Normalize the weak-spot thresholds.** `byCategory` for `style`/`movement` uses `===MAX_CAT` (exact) while `when`/`where` use `≥75%` — so movement looks artificially weaker and gets over-served. Normalize the comparison (consistent ≥ threshold, or weight movement) before weak-spot targeting ships (Phase 3).

**Still-needed design work (not in this spec):** mockup of the map-only single-axis round (so it reads as a map screen, not a round with dead inputs). *(The Training setup / filter-builder screen IS now mocked — design handoff in `tasks/17_training/`.)*

## ✅ Filter-builder handoff review — DECISIONS (tasks/17_training/)
8. **Artist facet shows only artists with ≥5 works.** 1,145 named artists but only 164 clear the empty-guard floor; surfacing the rest makes the tab a field of dead-ends ("Vermeer = 3 works = loosen a filter"). Gate the Artist browse/search to artists with ≥5 pool works.
9. **Per-option counts are standalone (cacheable); the funnel carries the combined truth.** Show each option's own `trainingSet({facet}).length` (precompute once), and rely on the narrowing funnel for the real after-each-family result — don't recompute conditioned counts per option.
10. **Place facet = `canonicalizePlace`d country (+ Region), not raw place strings.** Use `scripts/lib/places.mjs` so the facet options are clean countries (no "United States" vs "...of America"); offer Region as the coarse option. Movement+Culture stay ONE facet (`style`) as the handoff notes.
11. **#4 axis wiring (single-axis drills):** the Focus control on the Training screen sets `TRAIN.axis ∈ {none|when|where|style}`. `startTraining(TRAIN)` carries `{facets, axis}`. In `renderRound`, when `TRAIN.axis` is set, render ONLY that input and OMIT the others entirely (per decision #3 — not greyed naFields); `score()` scores only that axis. `axis:'none'` = normal full round over the filtered set.

---

## 0. What already exists (the substrate we build on)

- **Infinite / Learning mode** is the template. Entry: `startInfinite(key, push)` (~line 1101) sets `infinite=true`, builds `game=practiceOrder(key)` (~1092), `idx=0`, `results=[]`, then `renderRound()`. "End session" → `renderInfiniteSummary()` (~1107). Navigation via `pushNav({v:'inf',key})` and `routeFrom` handles `/infinite/<level>` (~974) and `pathFor` maps `s.v==='inf'` (~968).
- **Round rendering** `renderRound()` (~1192) reads `game[idx]`, builds the right-column fields conditionally on `it.cats` (`when` always; `medium`/`style`/`artist` only if `it.cats.includes(...)`, else a non-scoring `naField` placeholder ~1209). `infinite` toggles unlimited hints + look-closer hotspots.
- **Scoring** `score()` (~1346) writes `cells.{when,where,medium,style,artist}`, computes `coreCats=it.cats.filter(c=>c!=='artist')`, `baseMax=coreCats.length*MAX_CAT`, `coreNet`, `bonus`, and pushes a result `{it,cells,coreCats,baseMax,coreNet,bonus,...}`. Mastery is bumped **only** when `!infinite&&!runArchive` (~1394): `bumpMastery(it.style,'byStyle',exact)` and `bumpMastery(it.region,'byRegion', where>=75%)`.
- **Mastery store** (~687): `loadMastery()` → `{byStyle:{},byRegion:{}}` from `localStorage["artefactum.mastery"]`; each entry `{correct,total}`. `bumpMastery(key,bucket,correct)`, `saveMastery`, `masteryLine()` (~691) merges byStyle+byRegion.
- **Pool + metadata** `POOL` (~615), fame-sorted in `buildIndexes()` (~620). Per-work fields available: `id,title,artist,y,place,lat,lng,medium,medSimple,style,styleKind('movement'|'culture'),region,fame,cats[]`. Derived index sets: `ALL_MED`, `MOVS`, `CULTS`, `MOVEMENT_NAMES` (sorted), `styleRegion`, `styleCountry`. `MED_FAMILY` (~323) maps each `medSimple` to a family (`paint|draw|print|sculpt|craft`). `MOVEMENTS` (~364) keyed by movement/culture name with `{dates,region,palette}`. `simplifyMedium()` (~331) produces `medSimple`.
- **Tier filtering** `tierItems(i)` (~674) returns the frozen daily IDs or a fame-percentage slice; `practiceOrder(key)` (~1092) shuffles that tier (Easy weaves icons). `shuffle(a)` (~62) is RNG-aware.
- **Countries** `window.ARTEFACTUM_COUNTRIES` (`data/countries.js`): array of `{n:name, b:bbox, r:rings}`. `placeCountry(it.place)` / `nearCountry` already used in scoring. Region values in pool: `Europe, Asia, North America, Africa, South America, Oceania`.
- Helpers: `norm(s)` (~277) lowercases/strips punctuation; `mulberry32`/`seedHash` (~929) for deterministic RNG.

**Implication:** Training Mode is a *thin wrapper*: replace the one line `game=practiceOrder(key)` with `game=trainingSet(filter)`, optionally hide fields in `renderRound()` for single-axis drills, and branch the summary. Everything else (reveal, hints, hotspots, "doesn't affect streak") comes free because it keys off `infinite`.

---

## 1. Modes

A Training run is described by one config object, `TRAIN` (module-level, alongside `infinite`):

```js
let TRAIN = null; // null = normal play/infinite; object = training run
// shape:
// {
//   facets: { centuries:Set<number>, regions:Set<string>, countries:Set<string>,
//             movements:Set<string>, mediaFamilies:Set<string> },  // empty sets = no constraint
//   axis: null | 'when' | 'where' | 'style',   // single-category drill; null = all axes
//   weakSpot: false,                            // auto weak-spot mode
//   label: "Baroque",                           // human label for UI
//   baseline: { ... }                           // pre-session mastery snapshot for the slice (see §4)
// }
```

`infinite` stays `true` for any training run (so hints/hotspots/no-streak all apply). `TRAIN` is the *additional* state. A training run is just `infinite===true && TRAIN!==null`.

### (a) Custom-filter practice — "Drill me on…"
Player picks one or more **facet chips** and/or types **free text** that resolves to facets (§3). Facets across the five families (century, region, country, movement/culture, medium family) combine with **AND across families, OR within a family** (e.g. "Baroque OR Renaissance, in France" = `movements∈{Baroque,Renaissance} AND country=France`). All scoring axes active, exactly like infinite.

### (b) Single-category drills (date-only / map-only / movement-only)
Set `TRAIN.axis` to `'when' | 'where' | 'style'`. In `renderRound()`, render **only** that axis's input; the other inputs become `naField`-style "not scored in this drill" placeholders (or are omitted). In `score()`, still compute the chosen cell normally but **zero out / skip** the others for the session summary (see §4). Artist is never a single-axis drill (it's a bonus). `medium` could be added later but isn't in v1 (movement/date/map are the three the long-term goals name).

- Visual: the unused fields render with the existing `naField` helper (~1209) text "Map-only drill — date & movement hidden." The `when` slider / `map` / `style` pills stay as today for the active axis.
- Scoring: keep `score()` intact (it's deterministic and well-tested); the *drill scope* is applied in the summary by filtering to `TRAIN.axis`. This avoids touching the core scoring branches. (Optional polish: skip building the hidden fields entirely so there's nothing to interact with.)

### (c) Auto weak-spot drill
`TRAIN.weakSpot=true`. Before building the set, read the (extended) mastery profile and pick the player's **lowest-accuracy axis or slice**:
1. Compare the four **category** accuracies (`byCategory`: when/where/style, plus the existing where/style signals) — if one category is clearly weakest, set `TRAIN.axis` to it (a single-category drill biased to stress that input). 
2. Otherwise pick the weakest **movement** (`byStyle`) or **region** (`byRegion`) slice with `total>=3` and bias the served set toward it (set the corresponding facet) while leaving all axes on.
   - "Bias" = include the weak slice's works **plus** a minority of mixed works so it's practice, not a single style on loop. Concretely: 70% from the weak slice, 30% from the rest of the tier (still shuffled).
- Label e.g. "Weak spot: Baroque (54%)". Falls back to a generic message if there isn't enough data (`total<3` everywhere) — offer custom-filter instead.

---

## 2. Work selection

New function, parallel to `practiceOrder` (~1092):

```js
function trainingSet(TRAIN){
  let works = POOL.slice();                 // whole pool, NOT tier-sliced (training is cross-tier by design)
  const f = TRAIN.facets;
  if (f.centuries.size)     works = works.filter(p => f.centuries.has(centuryOf(p.y)));
  if (f.regions.size)       works = works.filter(p => f.regions.has(p.region));
  if (f.countries.size)     works = works.filter(p => f.countries.has(placeCountry(p.place)));
  if (f.movements.size)     works = works.filter(p => p.style && f.movements.has(p.style));
  if (f.mediaFamilies.size) works = works.filter(p => MED_FAMILY[p.medSimple] && f.mediaFamilies.has(MED_FAMILY[p.medSimple]));
  // single-axis drills require that axis to be answerable:
  if (TRAIN.axis==='style')  works = works.filter(p => p.cats.includes('style'));
  if (TRAIN.axis==='where')  works = works.filter(p => p.lat!=null);   // always true, kept explicit
  // 'when' is always answerable (every work has y)
  return works;
}
function centuryOf(y){ return Math.floor((y - (y<=0?1:0)) / 100); } // 1450 -> 14 (15th c.); -50 -> -1 (1st c. BCE)
```

- **Century convention:** store centuries as a signed integer bucket; UI labels them "15th century" = works with `y` in 1400–1499 → `centuryOf=14`. (Document this so the parser and the chip labels agree; see §3.)
- **`placeCountry`** already exists and is used in scoring — reuse it; don't reimplement point-in-polygon. Country facets are derived from `ARTEFACTUM_COUNTRIES[].n`.
- **Ordering:** shuffle with `shuffle(works)` for variety (training is for reps, not fairness — unlike dailies). For weak-spot bias, build the 70/30 interleave then `shuffle` each part. Re-fill on exhaustion the same way infinite does: `renderRound`'s Next handler concatenates a fresh `practiceOrder` today (~1547) — change that branch to `game = game.concat(TRAIN ? trainingSet(TRAIN) : practiceOrder(tier))`.
- **Empty-result guard (required):** after `trainingSet`, if `works.length < MIN_TRAIN` (suggest `MIN_TRAIN = 8`), do **not** start. Show an inline message in the setup UI: "Only N works match — loosen a filter." If `0`, disable the Start button. If `1–7`, allow start but warn "small set, works will repeat quickly." This is the long-term-goals "empty-filter guard / tell the player + loosen."
- **Determinism:** training is intentionally **non-deterministic** (shuffled, no seed) since it doesn't feed leaderboards. Keep the daily's `__RNG` seeding in `renderRound` (~1195) as-is; it only affects distractor option order, which is fine.

---

## 3. Free-text → facet resolution ("Drill me on 15th century / Italian art / Baroque / Egypt")

A pure function `resolveFacets(text)` → partial facet object + a list of unresolved tokens. Approach: **tokenize on commas/"and"/whitespace-phrases, then match each phrase against ordered resolvers, longest-match first.** No NLP; a deterministic phrase matcher over our own vocab.

```js
function resolveFacets(text){
  const out = { centuries:new Set(), regions:new Set(), countries:new Set(), movements:new Set(), mediaFamilies:new Set() };
  const unresolved = [];
  const phrases = String(text).toLowerCase().split(/\s*(?:,|;|\band\b|\+)\s*/).map(s=>s.trim()).filter(Boolean);
  for (const ph of phrases){
    if (matchCentury(ph, out)) continue;       // "15th century", "1400s", "quattrocento", "3rd century bce"
    if (matchMovement(ph, out)) continue;      // exact/fuzzy vs MOVEMENT_NAMES (movements + cultures)
    if (matchRegionCountry(ph, out)) continue; // "italian"/"italy"->country; "asia"/"asian"->region; "egypt"->country
    if (matchMedium(ph, out)) continue;        // "oil","oils","paintings"->paint family; "sculpture"->sculpt; etc.
    unresolved.push(ph);
  }
  return { facets: out, unresolved };
}
```

Resolvers (precedence order matters — century first, then the named vocab, then geography, then medium):

- **`matchCentury`** — regex set:
  - `/^(\d{1,2})(st|nd|rd|th)\s*c(entury)?(\s*(bce|bc))?$/` → `centuries.add(±(n-1))` (15th → 14; with BCE → negative).
  - `/^(\d{3,4})s$/` → `1400s` → `centuryOf(1400)`.
  - Italian ordinals as a small alias table (optional): `quattrocento→15th, cinquecento→16th, trecento→14th, seicento→17th`.
- **`matchMovement`** — match `ph` against `MOVEMENT_NAMES` (the sorted union of `MOVS`+`CULTS`, built at ~641) using `norm()` for exact, then a substring/startsWith fallback (`norm(name).includes(norm(ph))`). Also accept `MOVEMENTS` keys (same set, but it pulls in any meta-only names). On match add the **canonical** name to `movements`. Handle the `CANON_STYLE` aliases (~617) by normalizing through it first (so "post-impressionism" → "Post-Impressionism"). If multiple movements match a phrase (e.g. "renaissance" → "Renaissance","Early Renaissance","Italian Renaissance"), add **all** of them (OR within family is the desired behavior).
- **`matchRegionCountry`** — two layers:
  - **Region** alias table: `{europe/european→Europe, asia/asian→Asia, africa/african→Africa, north america/american→North America, south america→South America, oceania→Oceania}`.
  - **Country**: a small **demonym→country** map for the common art nationalities (`italian→Italy, french→France, dutch→Netherlands, spanish→Spain, german→Germany, japanese→Japan, chinese→China, egyptian→Egypt, greek→Greece, english/british→United Kingdom, american→United States, indian→India, mexican→Mexico, persian→Iran…` ~30 entries), then a direct match of `ph` against `ARTEFACTUM_COUNTRIES[].n` via `norm`. Because country names in `countries.js` use forms like "W. Sahara"/"United States of America", keep the demonym/alias map as the primary path and the raw-name match as fallback. Add the resolved country to `countries`. ("Egypt" → country=Egypt → filters works whose `placeCountry(place)==='Egypt'`.)
  - Note the ambiguity: "Italian art" should give a **country** filter (origin), not a region; that's why country resolution is keyed off demonyms. "Asian" stays a **region** because we have no finer signal worth the bucket.
- **`matchMedium`** — alias table to `MED_FAMILY` values: `{oil/oils/painting/paintings/painted→paint, drawing/drawings/sketch→draw, print/prints/woodblock/etching/engraving→print, sculpture/statue/carving/bronze/marble→sculpt, ceramic/pottery/porcelain/glass/textile/lacquer/photo/photograph→craft}`. Add the family to `mediaFamilies`. (We filter by family, not exact medium, to keep sets reasonably sized — matches the medium-scoring model where same-family is the partial-credit unit.)

**UX of unresolved tokens:** show them as a muted note ("Couldn't match: 'xyz'") and just ignore them; the resolved chips still apply. The free-text box and the chip pickers write into the **same** facet object, so typing "Baroque" adds the same chip a user could click — the result is a unified chip tray the player can edit before starting.

---

## 4. Stats — extend `mastery`, slice before/after delta

### Store changes (`loadMastery` ~687)
Extend the default shape (back-compatible — missing buckets default to `{}`):

```js
function loadMastery(){
  try{
    const m = JSON.parse(localStorage.getItem("artefactum.mastery")) || {};
    return { byStyle:m.byStyle||{}, byRegion:m.byRegion||{},
             byCategory:m.byCategory||{}, byCentury:m.byCentury||{} };
  }catch{ return {byStyle:{},byRegion:{},byCategory:{},byCentury:{}}; }
}
```

`bumpMastery` is generic already; add new bump sites in `score()` (~1394), still gated on `!infinite&&!runArchive` so **only real daily play feeds the persistent profile** (training itself is no-stats, same rule as infinite):

```js
// byCategory: accuracy per scored axis (when/where/style) — full-credit threshold per axis
bumpMastery('when',  'byCategory', cells.when.pts >= MAX_CAT*0.75);
bumpMastery('where', 'byCategory', cells.where.pts >= MAX_CAT*0.75);
if (it.cats.includes('style')) bumpMastery('style','byCategory', cells.style.pts===MAX_CAT);
// byCentury: keyed by signed century bucket as a string
bumpMastery(String(centuryOf(it.y)), 'byCentury', cells.when.pts >= MAX_CAT*0.75);
```

These power the **auto weak-spot** picker (§1c) and "your Movement accuracy" trend copy.

### Session before/after delta ("Baroque 54% → 71%")
This is **session-scoped** and works without accounts:
1. At training start, snapshot the *current* slice accuracy from the persistent profile into `TRAIN.baseline`. For a movement drill: `baseline = pct(mastery.byStyle["Baroque"])`. For a single-axis drill: `pct(mastery.byCategory[axis])`. For a multi-facet custom drill with no single clean slice: snapshot the dominant facet (the movement if present, else region, else the weakest category) and label accordingly. If the slice has `total<2`, show "no prior baseline" instead of a number.
2. During the session, compute the **session accuracy on the drilled slice** from `results[]` exactly as `renderInfiniteSummary` already does (`groupAcc` ~1122 for movement/region; for single-axis use `cells[axis].pts/MAX_CAT` averaged). 
3. End summary line: `Baroque: 54% → 71% this session (+17)`. Color via the existing `bandCol` (~1131). If no baseline: `Baroque: 71% this session`.

### What's localStorage-only vs needs Accounts
- **localStorage-only (ship now):** the extended `mastery` profile (`byCategory`/`byCentury`), the weak-spot picker, and the **single-session** before→after delta. All single-device.
- **Needs Accounts (later):** *cross-session* trends ("up 12% this week"), because they require **dated samples** server-side. The current `mastery` store keeps only running `{correct,total}` with no timestamps. Phase 4 (see §6) adds a dated sample log (server-side via the Accounts `mastery:<userId>` Redis hash from the Accounts spec) and computes week-over-week. Do **not** try to fake trends from localStorage running totals.

---

## 5. UI

### Entry point — hang off the Learning-mode block in `renderStart` (~1043)
The start screen already has a `.practice` block with `.pchip.inf` tier buttons (~1046). Add, directly beneath it, a **"Drill me on…"** panel:

```
┌ Training mode ──────────────────────────────┐
│ Drill exactly what you want. Won't affect    │
│ your streak or stats.                        │
│ [ Weak spots ▸ ]   ← auto weak-spot, if data │
│ Drill me on…  [ free-text input ........... ]│
│ Quick chips: [15th c.][Renaissance][Baroque] │
│  [Italian][Egypt][Oil paint][Sculpture]…     │
│ Selected: ⟨Baroque ✕⟩ ⟨France ✕⟩             │
│ Focus: ( All ) ( Date only ) ( Map only )    │
│        ( Movement only )                     │
│ 142 works match · [ Start training → ]       │
└──────────────────────────────────────────────┘
```

- **Free-text input** with a debounced `oninput` → `resolveFacets` → render the resolved chips into the "Selected" tray + any "couldn't match" note + the live count (`trainingSet(TRAIN).length`).
- **Quick chips** are pre-seeded common facets (a handful of centuries, the top movements by pool count, the big regions/countries, the 5 medium families). Clicking toggles a facet in the tray.
- **Selected tray** chips are individually removable (✕). 
- **Focus** segmented control sets `TRAIN.axis` (All = null). 
- **Live count + empty guard** (§2): show count, disable Start under `MIN_TRAIN`, warn for small sets.
- **Weak spots** button only renders if the weak-spot picker (§1c) finds a slice with enough data; it preloads the tray and label, then the player can Start or tweak.

This is one new `renderTraining()` view (or an inline expansion of the start screen). Add a nav state `{v:'train'}` to `pathFor`/`routeFrom` (~968/974) → path `/training` (deep-linkable; the facets themselves can be URL params later, not required for v1).

### Play
`startTraining(TRAIN)` mirrors `startInfinite` (~1101): `clearTimers(); infinite=true; TRAIN=TRAIN; tier=null; runDate=todayStr(); runArchive=false; game=trainingSet(TRAIN); idx=0; results=[]; renderRound();`. (`tier=null` is fine — `practiceOrder`/`tierItems` aren't called in this path; audit any `tier`-dependent UI in `renderRound`/`header` and supply a label like "Training" where it shows the tier name.) `renderRound` already keys hints/hotspots off `infinite`; add the `TRAIN.axis` field-hiding branch.

### Results summary
Reuse `renderInfiniteSummary` (~1107) with a training branch:
- Header kicker: "Training session · {TRAIN.label}" instead of "Practice session · {tier}".
- Add the **slice before→after delta** line (§4) at the top of the strengths section.
- For single-axis drills, collapse the per-category strengths grid to just the drilled axis (it's the only meaningful number).
- Keep the "doesn't affect your streak" badge (~1145), the perfect/masterpiece cards, "works you nailed", and the share recap (adjust the share text to name the slice). 
- "Keep practising" → `startTraining(TRAIN)` (same config); add a "Change drill" → `renderTraining()`.

---

## 6. Phasing

Effort assumes one developer working in `index.html` (+ the `mastery` store). Total MVP ≈ 2–4 days, matching the long-term-goals estimate.

### Phase 1 — Custom-filter practice (no profile needed) — ~1.5 days
The immediately-useful core. Touch/add:
- **Add** `trainingSet(TRAIN)`, `centuryOf(y)`, `resolveFacets(text)` + the four `match*` resolvers and their alias tables.
- **Add** `renderTraining()` (the setup UI), `startTraining(TRAIN)`, module-level `TRAIN` state.
- **Edit** `renderStart` (~1043) to add the Training panel + handler.
- **Edit** `renderRound` Next-handler (~1547) so exhaustion refills via `trainingSet(TRAIN)` when training.
- **Edit** `renderInfiniteSummary` (~1107) header/labels for the training branch; **edit** `pathFor`/`routeFrom` (~968/974) for `/training`.
- **Edit** anything in `renderRound`/`header` that assumes a non-null `tier`.
- Empty-result guard wired into the setup UI.

### Phase 2 — Single-category drills — ~0.5 day
- **Edit** `renderRound` (~1199–1226) to honor `TRAIN.axis`: render only the active axis's field, replace the others with "not scored in this drill" placeholders.
- **Edit** the summary to scope strengths to `TRAIN.axis`.
- `trainingSet` already filters for axis-answerability (§2).

### Phase 3 — Auto weak-spot targeting (needs the persistent profile) — ~1 day
- **Edit** `loadMastery` (~687) to add `byCategory`/`byCentury` (back-compatible).
- **Add** the new `bumpMastery` sites in `score()` (~1394), gated `!infinite&&!runArchive`.
- **Add** `pickWeakSpot(mastery)` → a `TRAIN` config (axis or biased facet), and the **biasing** in `trainingSet` (70/30 interleave for slice bias).
- **Add** the slice before→after delta (`TRAIN.baseline` snapshot + summary line).
- **Edit** `renderTraining` to surface the "Weak spots" button when data exists.

### Phase 4 — Cross-session trends (needs Accounts) — separate, post-Accounts
- Requires the Accounts spec's `mastery:<userId>` server store + **dated samples**. Add a dated-sample writer on each real daily, then "your Movement accuracy is up 12% this week" copy. Out of scope until accounts land; do not approximate from localStorage running totals.

---

## Open questions / decisions to confirm
- **Country granularity vs `countries.js` name forms** ("United States of America", "W. Sahara"): the demonym alias map is the primary resolver; confirm the ~30-entry map covers the pool's actual top countries (derive from `placeCountry` over POOL once and eyeball the long tail).
- **Medium drill** as a 4th single-axis option — easy to add later; left out of v1 per the long-term-goals naming (date/map/movement).
- **Weak-spot bias ratio** (70/30) and the `total>=3` data threshold are tunable.
- **`MIN_TRAIN`** (8) for the empty guard — tune against how thin real facet combos get.
