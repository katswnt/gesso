# Enrichment passes — runbook ("just run it")

Three passes, cheapest-first. Do the cheap non-vision work first; reserve the (paid) vision pass for the
image-only captures. Spec for what the vision pass captures: `docs/vision-pass-v2.md`.

## 1. Movement / culture pass (CHEAP — text subagents, no images, Max-plan tokens)

Fills empty styles + normalizes bad ones from artist+date+region alone. ~free on the subscription.

```
# extract works needing a style + the movement vocabulary, split into batches
node -e '<see git history: writes /tmp/mov/vocab.json + /tmp/mov/batch-{1,2,3}.json>'
# spawn one text subagent per batch (Agent tool): each Reads its batch, classifies each work to a
#   movement (named Western artist) or culture (anon/non-Western), writes /tmp/mov/out-N.json
# then apply high-confidence (>=0.6), deriving styleKind from vocab membership, with a fame guard:
node /tmp/mov-merge.mjs      # in-vocab->movement; else->culture; skip famous-unmapped (needs MOVEMENTS add)
node scripts/check-pool.mjs  # gate must be PASS before commit
```
Rule the merge enforces: only fill EMPTY styles (never overwrite); a famous work (fame>=300) must get a style
that's IN the MOVEMENTS table — otherwise leave it for a deliberate MOVEMENTS-table addition.

## 2. Web / description pass (CHEAP — no images)

Everything derivable from text/metadata/museum descriptions — do NOT spend the vision pass on these:
- movement/culture (pass 1), subject/iconography (often in the museum's own description), medium/date/dimensions
  (museum APIs: `api.vam.ac.uk/v2/museumobject/<id>`, Met/AIC/Harvard APIs), canonical-movement normalization.
- Anachronism invention-dates (pigments: Prussian blue ~1710, cobalt ~1802, mauve ~1856; tech: photography ~1830s,
  acrylic ~1940s) = a one-time STATIC rules table, not a per-work call.

## 3. Vision pass v2 (PAID/token — image-grounded, only the visual-only captures)

Cost: full pool ~$175 batched (API) OR run via Max-plan subagents that Read local images (no API). The image is
the cost; capture generously (see vision-pass-v2.md). Splitting into multiple calls is MORE expensive.

```
node scripts/vision-v2-prep.mjs 12   # select targets, download images to /tmp/v2/imgs/, manifest + chunk-N.json
# for EACH /tmp/v2/chunk-N.json: spawn an image-grounded subagent with the PROMPT below. It Reads each
#   work's /tmp/v2/imgs/<id>.jpg AND the manifest metadata, writes /tmp/v2/out/out-N.json.
node scripts/vision-v2-merge.mjs     # notes->teach-works.js, pins->hotspots.js, rich->data/vision.js,
                                     #   corrections/playability->reviewable backlog; then check-pool gate
```

### Vision subagent PROMPT (per chunk)
> You are enriching artworks for an art-guessing/teaching game. Read /tmp/v2/manifest.json. For each id in your
> chunk, Read its image file (manifest[id].imgFile) and use manifest[id].meta (title/artist/date/place/medium/style)
> as CONTEXT. Base every observation on what you actually SEE in the image (do not invent features).
> Output JSON per work with: consistent (is the image the right artwork for the metadata? + `seen` one-line
> description); metadata_flags (any field the image contradicts); playable (false for group-photos/architecture/
> featureless/remains/too-little-info); notes {why, cues[], guide[{q,a}]} ONLY if the existing note is missing/
> template/fabricated (else "keep"); evidence per field (when/where/medium/style/artist) = [{feature, bbox:[x,y,w,h]
> 0-1, why}] — the visible clue that pins the answer + where it is; pins [{x,y,label}]; palette (3-5 hex + warm/cool);
> format (tondo/arched/scroll/diptych/orientation); figures (count + who/what); pose_gesture; delights [{bbox,label}];
> signature {present,location,reads}; condition (fragment/damaged/faded/restored) + artifacts (reflections/glare/
> gallery-snapshot); image_quality (crisp enough?); recognized (bool); guessability {when,where,medium,style,artist}
> 0-100; movement_suggestion. Validate all bbox in [0,1]. Write /tmp/v2/out/out-<chunk>.json.

Chunk size ~12 (image reads are token-heavy; smaller than the text pass's 100). Corrections never auto-apply —
they land in a backlog for a gate/eyeball. Cross-check: compare vision movement/subject/medium vs pass-1/2 outputs
on the same works to validate quality.
