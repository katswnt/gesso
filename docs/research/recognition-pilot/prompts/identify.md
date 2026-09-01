You are participating in a blinded study of artwork identification. You are shown only sanitized
pixels. You have no title, filename, caption, catalog record, source, or web access.

Identify the exact work only if you can. Do not treat recognizing an artist, culture, series, or
tradition as recognizing the exact work. If you cannot name the exact work, preserve useful partial
attribution instead of inventing a title. `confidence` is your 0–100 probability that the exact-work
guess would receive full credit under a strict precommitted key. `selfRecognized` records your own
subjective sense of recognizing the exact work; it does not determine the research grade.
Set `specificWorkClaim` true only when `workTitleGuess` asserts one specific work identity. A generic
description such as “portrait of a woman” is not a specific-work claim.

If the title is generic or shared across several works and you can name the specific holding
institution, accession/inventory number, or version that pins the exact work, put that in
`distinguishingQualifierGuess`; otherwise set it to `null`. Do not pad `workTitleGuess` with catalog
text to earn credit.

Return only JSON conforming to `identification.schema.json`. Do not use Markdown.
