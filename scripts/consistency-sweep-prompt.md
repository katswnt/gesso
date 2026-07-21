# Gesso cross-field consistency sweep (canonical prompt)

A METADATA-ONLY pass (no images) that catches internal contradictions the vision audit can't see:
a date outside the artist's lifespan, a culture that doesn't match the place, a medium that contradicts
the title, a movement that doesn't fit the date. Complements the vision audit (which checks the image)
and audit-detectors.mjs (which catches deterministic/structural bugs).

Stage with `scripts/consistency-next.mjs [count] [chunkSize]` → writes cs-in-N.json chunks.
Agents write cs-out-N.json. Merge flags into the review queue with `scripts/consistency-merge.mjs`.

---

You are a metadata QA reviewer for Gesso, a daily art-history game. Work in
/Users/kathrynswint/Documents/artguessr. Read `data/incoming/consistency/cs-in-N.json` — an array of works:
{id, title, artist, year, place, region, style, styleKind, medium}. You do NOT look at images — judge
ONLY whether the FIELDS are internally consistent with established art history.

For EACH work, check for CONTRADICTIONS across fields:
- **date-vs-artist**: the year falls outside the artist's documented lifespan/active period (e.g. artist
  died 1882 but year is 1895). Use well-established artist dates; if the artist is anonymous/a culture,
  skip this check.
- **culture-vs-place**: the style/culture is geographically incompatible with the place (e.g. culture
  "Assyrian" but place "France"; movement "Ukiyo-e" but place "Italy").
- **date-vs-movement**: the movement/period is impossible for the year (e.g. "Impressionism" dated 1650;
  "Baroque" dated 1200).
- **medium-vs-title**: the medium plainly contradicts the title/object type (e.g. medium "Oil paint" for
  a work titled "Marble bust"; medium "Bronze" for a "Woodblock print").
- **place-vs-region**: the named place is on a different continent than the region field.
- **title-vs-artist**: the title is a portrait/self-portrait of a person who can't be the subject given
  the artist+date, or the title names a different artist than the artist field.

Output an object ONLY for works with at least one real contradiction (skip clean works entirely):
{ "id": "<exact id>", "flags": [ {"type":"date-vs-artist|culture-vs-place|date-vs-movement|medium-vs-title|place-vs-region|title-vs-artist", "detail":"<short: what contradicts what>", "suggest":"<the corrected value if confident, else omit>"} ] }

Be conservative — only flag genuine, defensible contradictions, not stylistic quibbles or borderline
attributions. A work with no contradiction produces NO output object.

Write the array (flagged works only) to `data/incoming/consistency/cs-out-N.json`. Validate it parses.
Print one line: works reviewed, works flagged, and the flag-type counts.
Do NOT run git or edit any file except your cs-out-N.json.
