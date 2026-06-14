# Collections page — data + copy (for Claude Design / Briana)

**Data source:** `data/collections.js` → `window.ARTEFACTUM_COLLECTIONS` (regenerate with `node scripts/make-collections.mjs`). Shape:
```
{ total, region:[[name,count]], origins:[[country,count]] (top 20),
  eras:[[band,count]] (chronological), sources:[[institution,count]] }
```
Pair these numbers with the copy below. All figures update when the pool changes — read them live from the file, don't hardcode.

---

## Headline
**Where this art comes from — and why it looks the way it does.**
Every work here is shown under an open license (public domain or CC0). That single rule shapes the whole collection — what's here, what isn't, and why.

## Section 1 — Where it's *from* (origin, not ownership)
Use `region` + `origins`. Lead line, e.g.:
> The {total} works span {region.length} continents — currently **{Asia%}% Asia, {Europe%}% Europe, {Africa%}% Africa**. We rank by *where a work was made*, not where it now sits.

## Section 2 — When it's from
Use `eras`. Note the cliff at the end:
> Coverage thins sharply after **1900**. That's not taste — it's copyright (next section).

## Section 3 — The open collections we draw from
Use `sources`. These are open-access museum programs + Wikimedia:
> The Met · Art Institute of Chicago · Cleveland Museum of Art · Harvard Art Museums · Victoria & Albert · Smithsonian (National Museums of African & Asian Art) · the Prado, National Gallery (London), Uffizi, Rijksmuseum, National Gallery of Art, de Young, **Tokyo National Museum, National Palace Museum (Taipei), National Museum of Korea, and the Egyptian Museum (Cairo)** — plus Wikidata / Wikimedia Commons.

---

## "Why the collection looks like this" — the honest, technical reasons

**1. Open license only → little modern/contemporary art.**
We can only show images that are free to use. In the US a work generally enters the public domain ~95 years after publication (today: **roughly pre-1929, and the line moves forward each year**). Most 20th–21st-century art is still under copyright — so MoMA, the Whitney, and the Tate publish their *catalog data* openly but **not their images**, and we can't display them. That's the 1900 cliff you see in the timeline.

**2. Fame is measured by Wikipedia, which has its own biases.**
Difficulty ("Easy → Impossible") is set by a work's **global recognizability** — specifically how many language editions of Wikipedia cover it (its Wikidata "sitelinks"). It's the fairest cross-cultural signal we found, but Wikipedia over-documents the Western canon, so "Easy" still skews European. We surface this honestly on the home screen, and we weight non-English Wikipedias for East-Asian works so they aren't under-ranked.

**3. African-located museums are nearly absent from open data.**
We *wanted* to source directly from museums across Africa. But on Wikidata, **the Bardo (Tunis), Iziko (Cape Town), and the National Museum (Lagos) have effectively zero works with open images** — only the **Egyptian Museum, Cairo** has real coverage. African heritage is overwhelmingly catalogued under *Western* museums (the Benin Bronzes sit in London and New York, not Lagos). So African art reaches this site mostly through Western holding-museums or by country-of-origin — a digital echo of how that art was dispersed. We name it rather than hide it.

**4. We pull the famous, not the whole.**
No collection is ingested wholesale — we take each source's most-recognized works (by Wikipedia sitelinks) so the game stays playable, not a warehouse.

---
*Tone: plain, a little rueful, never defensive. The point is transparency — the gaps are part of the story of how art history got digitized.*
