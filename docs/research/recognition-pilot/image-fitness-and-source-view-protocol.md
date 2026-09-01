# Pre-outcome image fitness and alternate-source protocol

**Status: pilot draft; decisions occur before model outcomes.**

Each canonical candidate is inspected before hashing and assigned exactly one state:

- `usable`: correct physical work, legible subject/form, no catastrophic crop/occlusion, and enough
  resolution for a 1,568px derivative. Minor age, frame, neutral background, or ordinary conservation
  evidence is allowed.
- `repair`: likely correct work, but wrong crop/orientation, visibly bad reproduction, severe colour
  cast, watermark/label, or inadequate resolution could plausibly be fixed by a better source. It is
  not called until repaired, then reassessed from scratch.
- `blocked`: broker/source/legal failure prevents a valid sanitized derivative. It is replaced from
  the seeded reserve; a blocked source is not evidence that the work is unplayable.
- `unplayable`: the reproduction is valid and the work itself still lacks enough discriminable
  visual structure for Gesso's task. This is recorded separately and replaced for this image-based
  research pilot; it is not silently converted into `blocked`.

Image fitness is not a universal hard daily gate. This protocol governs the research sample only and
does not rewrite current dailies or pool playability.

For Study C, the research process may propose another view, but the owner approves it only when
authoritative accession/QID/institution evidence establishes the same physical object—not a copy,
edition, cast, study, or related work. Before outcomes record:

- institution, accession/QID, direct source and license;
- dimensions/resolution and whole-object coverage;
- crop, viewpoint/angle, rotation and frame/gallery context;
- colour/lighting shift, glare, occlusion and visible labels;
- condition/restoration differences and whether diagnostic areas remain visible.

Both canonical and alternate must independently pass `usable`. A better source discovered later does
not replace a frozen pilot view; it creates a logged deviation or a later study.
