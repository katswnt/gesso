# Recognition/inference pilot deviations log

**Pilot status:** not frozen; no pilot annotation or model response has been collected.

This file is append-only after the pilot protocol freeze. A deviation records the date, affected artifact
or rule, whether any outcome was visible, the reason, the replacement rule, and the consequence for
confirmatory interpretation. Nothing is silently folded into prompts, manifests, graders, or
analysis.

Seeded-reserve rule (deterministic, reproducible): within the replaced work's fame×region cell, take
the pool candidates with an https image and a non-Q, non-generic title, exclude the current sample and
any id variant of it, and pick the lowest `sha256("<selection-seed>:" + id)` tiebreak. This mirrors the
frozen selection tiebreak and is auditable from `data/pool.js` at the recorded `selection.poolCommit`.

| Date | Artifact/rule | Outcomes visible? | Deviation and reason | Replacement/consequence |
|---|---|---:|---|---|
| 2026-08-31 | Sample work `wikidata:Q6163568` (Our Lady of Africa), cell f4/europe | No | The source image depicts the shrine **building** (Iglesia de Santa María de África, Ceuta), not the statue, and the truth (medium, style) is undocumented — unsuitable for an image-based recognition pilot. Repairing only the URL would not fix the missing truth. | Replaced from the deterministic f4/europe seeded reserve with `http://www.wikidata.org/entity/Q5227835` (Gerard ter Borch, *The Gallant Conversation / Paternal Admonition*, Rijksmuseum SK-A-404). The replacement inherits the replaced work's methodological flags (promptOrder=true); the ten fame×region cells stay at 3–4 works. Its text/key/truth are fully curated pre-outcome from the Rijksmuseum record; a work-specific institution+accession qualifier pins the Amsterdam object against the Berlin autograph version. Image, source-view, and rights approval are deferred (imageFitness=false); no outcome was observed. |
