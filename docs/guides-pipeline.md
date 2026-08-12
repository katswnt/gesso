# Guide regeneration pipeline (text-based, Sonnet)

Fixes thin/template "Ask the guide" Q&A. The old guides came from `gen-teach` via **Codex, from tombstone
metadata only (no image)**, so they fell back to a generic 5-slot template. This pipeline regenerates them
**text-only** from each work's existing image-grounded notes and cues (which are good), via **Sonnet agents**.
Do NOT route this through Codex.

## Steps

1. **Select** (writes context chunks for works still needing regen, skips ids that already have an output):
   ```
   node scripts/guides-regen.mjs select [N=100] [chunkSize=13]
   ```
   Picks the top-N "thin" works by fame. Thin = guide of ≤6 questions with ≥2 pure-template phrases.
   Writes `data/incoming/guides/chunks/chunk-*.json` and `selected.json`.

2. **Generate**: spawn ONE Sonnet agent per chunk with the prompt below. Each reads its
   `chunk-<n>.json` and writes `data/incoming/guides/out/out-<n>.json` = `{"<id>":[{"q","a"},...]}`.

3. **Merge** (validates, writes `guide` field into `data/teach-works.js` for selected ids):
   ```
   node scripts/guides-regen.mjs merge
   ```

4. **Gate** as its own step, then commit:
   ```
   node tests/dom-harness.mjs && node scripts/check-pool.mjs
   ```

## Canonical agent prompt

> You are upgrading the "Ask the Guide" Q&A for Gesso, an art-history game. These works currently have a thin,
> generic guide built from a fixed template (medium slot, subject slot, "why does this matter", "what technique
> should I notice", "who made it and for whom"). Make each guide genuinely specific to its work.
>
> Gold standard, Boccioni's "Unique Forms of Continuity in Space": "Why does this figure look as if it is being
> peeled open by the air?", "Why does the figure have no arms or face?", "How is it different from Cubist
> sculpture?". Curiosity-driven, work-specific.
>
> Read `data/incoming/guides/chunks/chunk-<n>.json` (array of works: id, title, artist, y, movement, place, why,
> cues, notes, oldGuide). For each:
> - KEEP any oldGuide question already specific to this work (polish, carry its answer content).
> - DROP the pure-template slots ("why does this matter", "what technique should I notice", "who made it and for
>   whom", "what should I look for").
> - ADD work-specific questions so the final guide has 8 to 12, curiosity-driven: subject, symbolism,
>   composition, technique, history, scale, function, comparisons, controversies.
> Ground everything in the provided why/cues/notes plus well-established art history. NEVER invent a name, date,
> patron, or attribution not supported by the material. Each entry is {"q","a"} with a 2 to 3 sentence answer in
> plain, warm prose. No em-dashes. Every question must only make sense for this specific work.
>
> Write `{"<id>":[{"q","a"},...]}` for your works to `data/incoming/guides/out/out-<n>.json`.

## Notes
- Reuse: put prior good outputs in `data/incoming/guides/out/` and `select` will skip those ids.
- The merge only touches the `guide` field; `why`, `cues`, and hotspot `notes` are left alone.
