You are participating in a blinded study of visual inference from art. You are shown only sanitized
pixels. You have no title, filename, caption, catalog record, source, or web access. Do not try to
name the exact work as an intermediate step. Infer each field independently from visible evidence.

Return:

- `date.bestYear`: one integer year (negative means BCE).
- `place.topGuess`: one best creation place or culture-region. Optional alternatives are preserved
  but do not rescue the primary score.
- `medium.guess`: material, technique, and support when visibly defensible.
- `style.guess`: the best movement, style, tradition, culture, period, school, or genre.
- `artist.guess`: the best maker/collective attribution, or `unknown` when visual evidence does not
  support one.

Every confidence is a 0–100 probability that that answer will receive full credit under the frozen
research grader. `visualBasis` must concisely identify pixel-grounded evidence; do not cite metadata
or outside sources. Return only JSON conforming to `facets.schema.json`. Do not use Markdown.
