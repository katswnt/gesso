# Gesso — work queue (data quality + fixes), in priority order

_Pool is now 4,583 works (promoted the 1,490-work canon expansion). Notes 4,543/4,583. Hotspots for new works running via Codex (scripts/staged-hotspots.mjs, resumable, data/incoming/staged-hotspots/). Vercel deploys are caught up. Everything below is the agreed plan — execute top-down._

## 🚨 0. URGENT: purge non-artwork entities (countries/places) from the pool
Wikidata items that are COUNTRIES/CULTURES (e.g. "Uganda", "Ethiopia") got pulled as "works" — they show map/flag images, have culture "Culture of <X>", no real artist/medium, and **huge fame** (country sitelinks) so they land in **Easy**. From the wd-africa / wd-culture (and maybe wd-museums) pulls.
- **Fix:** remove pool works that are entities, not artworks. Detect: title is a country/place name; OR style/culture matches `/^culture of /i` or is a bare country; OR no artist+no medium+map-like; cross-check Wikidata instance-of (P31) = country/state/ethnic group/geographic region if doing it thoroughly.
- After purge: regenerate fame.js + re-freeze daily.
- Build this into the audit tool (flag P31=country/place) so it can't recur.

## 1. Audit tool + data clean pass (highest leverage — catches the El-Greco/Goya class)
**1a. `scripts/audit-data.mjs`** (permanent, deterministic — already prototyped, it works): flags
  - artist-origin mismatch (place ≠ where the artist worked) — caught Goya→"Italy (Rome)", Gauguin/Sargent/Copley mislocated;
  - fame collisions (anon/generic-title works with implausibly high fame — "Madurodam" 451, "Iznik dish", "Spandrel");
  - non-artwork entities (#0);
  - duplicates, lowercase/messy fields, missing place/region/medium, cats-vs-fields consistency.
**1b. Work-data clean pass:**
  - **Re-geocode by ARTIST nationality first** (artist is a stronger origin signal than holding-museum place) — fixes Goya→Spain, El Greco→Spain, raw-polity strings ("French Third Republic", "Kingdom of Great Britain", "Papal States" leftovers). For full coverage do a one-time Wikidata pass: fetch artist P27 / work P937, flag/fix place mismatches.
  - **Expand fame concept-collision guard** (zero "Madurodam"/"Iznik dish"-type anon works) so they leave Easy.
  - medium + dimensions backfill: already done.
**1c. User-input matching pass:** accents ✅ done (deaccent). Add alias/partial matching — "Leonardo"/"da Vinci" → "Leonardo da Vinci", surname-only, light typo tolerance. Medium already collapses to clean families (simplifyMedium).

## 2. Geo → point-in-country (fixes #5 Japan/China, #13 Belgium/Netherlands, #9 Guatemala/Mexico)
Radius-from-the-work's-point is fundamentally leaky for adjacent/small countries. Replace with real country containment:
- Bundle a compact country dataset (simplified polygons OR bbox+centroid table, ~50–100 KB) + a `countryOf(lat,lng)` fn.
- Score: **full credit iff pin's country === work's country**, else decay by distance. Keep a small border grace so a pin just over a line still scores high.
- One change fixes all three geo bugs + the Guatemala "Mexico" mislabel.

## 3. Quick pair — dimensions pre-lock + mastery tracker
- **Dimensions pre-lock (T2):** show "≈ 73 × 92 cm" near the image on the PLAY screen (dimensions aren't a guess category → safe, gives scale). Dim survived promotion (3,184/4,583 have it).
- **Mastery (#8):** "Your mastery" stuck at "Sharp on Regionalism (2/2)…" — trace whether saveMastery persists / masteryLine reads current data (likely stale-display or limited-keys). Quick.

## 4. Learning mode (T1)
Rename infinite → "Learning mode": **unlimited hints**; a **hotspot toggle** visible pre-lock; notes still gated to post-lock.

## 5. Lower-urgency data
- **#12 duplicates** (same work, different photo): conservative dedup — anonymous works on `title+place+year` (NOT generic-title alone, to avoid merging distinct "Figure"/"Untitled" objects); flag rest.
- **#3 broken images** ("Image unavailable", some with hotspots): URL-validation pass (HEAD) → for 404s try the alternate Commons file or flag/drop.
- The ~181 staged works that were too place-less to promote (recoverable via artist-nationality geocode in 1b).

## Done this session (for reference)
Cats recompute (medium/artist guessability) · accent-insensitive artist · movement family-dedup · period labels not quizzed · El Greco→Spain · capitalized styles · **fame re-scored consistently (Easy cutoff 69.3→411)** · promotion 3,260→4,583 · geo radii tightened · simplifyMedium · bottom-sheet/practice/FAQ/slider mobile fixes · Collections live-compute + 12 museums · report endpoint (needs Upstash env) · Men's Bath image fix.
