# Case Study — Making a Copyright-Shaped Canon Honest

**Role:** Product (strategy, data model, prioritization, QA design) · **Surface:** Gesso, a daily art-history game (~5,950 public-domain works)

## TL;DR
A daily art game's *collection* is its product. Ours had three invisible problems: a canon quietly shaped by **copyright law**, a taxonomy that mislabeled non-Western art, and AI-generated teaching content that could be plausibly wrong. I turned each into an explicit, measurable system — **disclosure over hiding, decolonized categorization, and fail-closed QA** — shipping ~20 commits behind an automated quality gate with zero regressions.

## The problem (framing)
Gesso teaches you to *see* art by guessing where/when/who/movement/medium. But three issues undercut the promise:

1. **The canon is shaped by IP law, not art history.** Only public-domain works can be shown, so anything by a creator who died after ~1955 is excluded — gutting the 20th century — and difficulty is weighted by *Wikipedia popularity*, which over-documents the Western canon. Result: **Europe 3,389 works vs. Oceania 20, Middle East 7.** Users would never perceive this bias; they'd just absorb a skewed sense of "what art is."
2. **The taxonomy imposed a Western frame.** Every work was forced into a "movement" — a 19th–20th-c. Western construct — even a Shang bronze or a Yoruba figure, which art historians organize by *culture and period*.
3. **AI-written teaching notes could be confidently wrong** (hallucinated symbols, mislabeled mediums), and there was no systematic check.

## What I decided (and the tradeoffs)
- **Disclose the bias instead of hiding it.** Rather than silently over-sampling non-Western art (which would misrepresent museum reality), I made the skew a *teaching moment*: a live "where the art comes from" page that names the copyright cliff and the popularity bias. **Tradeoff:** admitting the flaw vs. faking balance — chose honesty, which is *on-brand* for a product about looking carefully.
- **Move categorization from artist → work, and from "movement" → culture/period.** A movement belongs to an *object at a moment*, not a person (artists span movements — Mondrian, Malevich). Reclassified **207** premodern/non-Western works and made "period" a first-class, guessable category. **Tradeoff:** more schema complexity vs. accuracy — accuracy won.
- **Treat the collection like a museum would:** attribution spectrum ("Workshop of / Attributed to"), honest **date ranges** (670 works now show "c. 1500–1509" and score with leniency), **provenance context** on 71 contested objects (Benin, Parthenon, Rosetta…), and **exclusion of human/ancestral remains** from play (gate-enforced).
- **Make quality fail-closed.** A `check-pool` gate blocks any commit with a hard violation; a suite of audits (copyright, place, vocab, medium, harmful-language) runs in `npm test`; the harvest pipeline auto-runs the copyright death-check.

## Evidence it worked (metrics)
- **Content coverage & QA:** drove the easy-tier from **75% → 100% vision-audited**; ~**891** works image-verified. An AI QA pass over 213 newly-added works caught a **systematic medium-labeling bug across ~130 works**, dozens of birthplace-vs-where-made errors, and ~**11 wrong-image** records — before users saw them.
- **Copyright safety:** the automated audit caught **14 in-copyright works** (O'Keeffe) that slipped in via a marginal rule — proof the gate earns its place.
- **Bias, made legible:** shipped the disclosure surface and a decolonized taxonomy; every contested object now carries acquisition context rather than being presented as a trophy.
- **Zero regressions:** ~20 commits, each behind the fail-closed gate; a near-miss data-corruption incident (a background job racing the content pipeline on the same file) was caught by the gate, reverted, root-caused, and hardened — *the system did its job.*

## What I'd measure next
The user-facing hypothesis — *does honesty deepen engagement?* — is now instrumentable (see `metrics.md`): guide-open rate on contested/sensitive works, and whether the "where the art comes from" page improves retention for the art-curious ICP.

## Why this is a PM story, not an eng story
It's **problem-framing under a hard external constraint** (copyright), an **ethics-vs-completeness tradeoff** decided deliberately, a **data-model decision** (work-level movement) grounded in domain expertise, and **operational rigor** (fail-closed QA for AI-generated content) — the exact judgment a PM is hired to exercise.
