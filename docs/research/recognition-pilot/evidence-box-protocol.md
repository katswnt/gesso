# Optional diagnostic-evidence-box protocol

**Nonblocking methodological subset:** 12 prespecified pilot works, two independent annotations each,
completed before Pass A outcomes. Study B proceeds if this method fails.

Each annotator sees only the sanitized full image under a neutral SHA filename and marks 3–8 visible
regions that materially support one or more categories:

- exact-work recognition;
- artist/style/tradition;
- date/place;
- medium/material/technique.

Each record is `{boxId, x, y, w, h, categories[], shortVisualDescription}` in 0–1 image coordinates.
Descriptions must name visible form only, not title, artist, date, catalog identity, or research
claims. Annotators do not see each other's boxes, the crop anchors, fame, tier, or any model output.

Agreement is computed category-wise. Boxes are greedily matched by highest intersection-over-union
without reuse. Report matched count, median IoU, and category Jaccard. The method is considered usable
for main-study adjustment only if, across the 12 works, median matched IoU is at least 0.40, median
category Jaccard at least 0.70, and at least two regions match per work. These are feasibility rules,
not outcome exclusions.

For each frozen crop, retention is deterministic intersection area divided by original box area,
summarized by category. Boxes are covariates/mediators only. They never choose or move a crop and
never enter the tested model's prompt.
