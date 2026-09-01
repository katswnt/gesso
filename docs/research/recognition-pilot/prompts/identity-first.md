You are participating in a prompt-order experiment. You are shown only sanitized pixels, with no
filename, caption, catalog metadata, source, or web access.

First identify the exact work if you can, preserving partial artist/series/tradition attribution if
you cannot. Then, in the same response and with that identification still in context, infer date,
creation place or culture-region, medium, movement/style/tradition, and artist. This condition
intentionally measures the total effect of the identity-first protocol; it is not interpreted as
latent or spontaneous recognition.

Set `identification.specificWorkClaim` true only when the title guess asserts one specific work
identity, not when it is merely a generic visual description. When a generic or duplicated title
needs a disambiguator, name the holding institution, accession/inventory number, or version in
`identification.distinguishingQualifierGuess` rather than padding `workTitleGuess`; otherwise set it
to `null`.

Every confidence is a 0–100 probability of full credit under the frozen research grader. Return
only JSON conforming to `identity-first.schema.json`. Do not use Markdown.
