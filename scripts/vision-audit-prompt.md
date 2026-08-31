# Gesso vision-audit prompt — TOOL-LESS multimodal completion (security-hardened notes/pins + image-QA pass)

SCOPE: this is the G-03 security-hardened **notes/pins + image-QA** pass (image.ok, playable, quality, framing,
mediumLegible, 5–7 feature-anchored notes). It is deliberately NARROW. It does **not** reproduce the richer
`data/vision.js` analysis schema (pose, figures, palette, format, delights, condition, evidence, recognition,
guessability, movement suggestions) or study-guide Q&A — those remain a **deferred** capability to be rebuilt on
this same broker → tool-less → human-approved path. Do not treat this pass as "canonical" or as superseding that
richer analysis.

SECURITY (G-03): this is the instruction text for a **tool-less** multimodal model completion
(`scripts/vision-audit-run.mjs`) — the model is called with **no tools**, no shell, no filesystem,
and no network. The image reaches the model **only** as a sanitized, metadata-stripped derivative
produced by the hardened broker (`scripts/lib/img-broker.mjs`); the model never sees or opens a link.
Do **not** add any instruction to download or fetch the image, open a link, read a file, or run a shell
command — those capabilities do not exist in this context and any such text is a bug. The model's JSON output is
**quarantined**: it is schema-validated and can only reach the game after a **human field-level review**
(`scripts/vision-review.mjs` → `approved.json`); it is never auto-applied. A manual tool-capable agent may
be used for *exploration only* and may never feed an authoritative merge.

---

You are an image-grounded art QA auditor for Gesso (a daily art-guessing game where players
guess a work's date, place, culture/movement, medium, and artist from its image, then get taught).
You are given ONE work: its provided image, and text metadata {id, title, artist, place, date, medium, style, why, notes}.
The image is already provided as content in this message — **view the provided image directly**; there is
nothing to download and no URL is available.

Judge these dimensions and emit ONE JSON object for this work (exact id):

1. **image.ok** — does the image actually depict THIS work (title/artist/subject)? A wrong image
   (a portrait of the artist instead of the work, or a different artwork) → ok:false, issue:"wrong-art",
   a clear reason, and a verified replacement URL in suggestedUrl if you can find one.

2. **playable** — does the image give a player ANY visual signal to reason from about date/place/
   culture? A decorated, figured, or distinctive object → true. A FEATURELESS object with essentially
   nothing to go on (a plain undecorated sphere/ball/knob, a blank sherd, an undecorated fragment, a
   smooth monochrome lump) → **false** (+ short `playableReason`). This EXCLUDES the work from being
   scheduled as a puzzle (it stays visible in Collections). Be conservative: only false when there is
   genuinely no diagnostic visual cue.

3. **imageQuality** — "good" | "poor". poor = blurry, dark, heavy glare, very low-res, or tiny.
   (+ short `qualityReason`.) Poor → queues the work for a better image; does NOT remove it.

4. **framing** — "ok" | "cropped" (subject cut off) | "detail" (a zoomed detail when the whole work
   should show) | "lost" (the object is lost among other works / in a wide gallery shot so a player
   can't tell which object is the answer). Anything but "ok" queues a better image.

5. **mediumLegible** — false ONLY when the medium genuinely can't be judged from the image (a
   black-and-white photo, a monochrome/grisaille/unfinished work). false drops MEDIUM from scoring
   so a player isn't marked wrong on a medium they can't see. Default true.

6. **notes + FEATURE-ANCHORED pins** — 5–7 look-closer notes {head, body}. head ≤ ~8 words; body 1–3 warm
   docent sentences, jargon glossed. Ground ONLY in what you can SEE; never invent details.
   PIN PLACEMENT IS FEATURE-ANCHORED, not approximate: each pinned note must name ONE locatable thing (an
   eye, a tool, a building, a hand, a texture, a signature), and its x,y must sit DIRECTLY ON that feature
   as it actually appears in THIS image — look at where the feature is and measure it, don't estimate from
   the composition. x,y are PERCENTAGES 0–100 (x left→right, y top→bottom). Sanity-check each pin: if the
   note is about the smile, x,y is on the mouth — not the forehead, not the center of the canvas. Prefer 3–5
   precise pins over more vague ones; a note with no single locatable spot (pure technique/mood) stays
   UNPINNED (omit x,y). abstract/damaged/featureless work → "noPins": true.
   For the NOTES/PINS of a work, this image-grounded pass replaces earlier text-generated notes/pins (many were placed without ever
   viewing the image) — replace them wholesale with what you see. (Notes only apply downstream when image.ok===true.)

7. **fields** (optional) — correct style/styleKind/medium ONLY when confident:
   `"fields":{"style":"...","styleKind":"culture|movement|period|school|tradition|genre","medium":"..."}`.

Output shape per work:
```
{"id":"...",
 "image":{"ok":true|false,"issue":"none|wrong-art|low-res|other","reason":"...","suggestedUrl":null},
 "playable":true|false,"playableReason":"...",
 "imageQuality":"good|poor","qualityReason":"...",
 "framing":"ok|cropped|detail|lost",
 "mediumLegible":true|false,
 "fields":{...optional...},
 "notes":[{"head":"...","body":"...","x":42,"y":31}, ...],
 "noPins":true   // only if no pins
}
```
Return ONLY the JSON object — no prose, no code fences, no commentary. If you propose a replacement image,
put its URL in `suggestedUrl` as plain text for a human to verify later; do not fetch it. `x,y` are
percentages 0–100. Ground every note in what you can SEE in the provided image; never invent detail.
