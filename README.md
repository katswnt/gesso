# Gesso

**A daily art-history guessing game for curious museum-goers who want to get better at looking.**

Live: **[gesso.katswint.com](https://gesso.katswint.com)** · Product, curation, and engineering by [Kat Swint](https://katswint.com) · Visual and interaction design by [Briana Das](https://brianadas.com/)

Each day, players study an artwork with the label removed and guess its **date, place of creation, medium, movement or culture, and optional artist attribution**. The reveal does more than mark answers right or wrong: image-anchored notes point to the visual evidence that made each answer possible.

Gesso is designed for the person who enjoys visiting museums while traveling and may have taken one art-history survey course—not for someone who already recognizes every canonical work. The product bet is that a free, five-minute daily ritual can build visual literacy without feeling like homework, a speed test, or a gatekept course.

<!-- TODO before sharing widely: add a gameplay GIF showing a guess followed by the pinned teaching reveal. -->

---

## The product case study

Museum labels often assume context, educational tools often feel like coursework, and art games often recycle a short list of famous Western paintings. Gesso tries to solve a different problem: **how do you help a beginner return tomorrow, while gradually expanding what they can see today?**

That led to a few explicit product principles:

- **Earn the habit before expanding the lesson.** A daily is five works, has a clear ending, and is identical for every player on the same date and tier. Archive replays and custom training exist, but only today's daily advances the streak.
- **Teach looking, not recall alone.** The core questions—when, where, medium, movement or culture, and optional artist—reward visual reasoning. There is no timer on the artwork, partial knowledge earns credit, and the reveal points back to the evidence in the image.
- **Treat difficulty as a promise.** Easy must contain works a museum-curious beginner has a real chance of recognizing. Harder tiers change the quality of distractors and the strictness of scoring—not merely the point multiplier.
- **Treat the collection as product design.** Sources are chosen for complementary strengths, acquisition targets known gaps, and daily scheduling improves diversity only within the promise of each difficulty tier.
- **Teach from the player's reasoning.** A map guess changes the period vocabulary used around the date slider, and a geographically informed pin can eliminate implausible movement choices. Feedback responds to the path the player took without leaking the hidden answer.
- **Make the image carry the lesson.** Teaching notes are attached to coordinates on the artwork, connecting a term such as “impasto” or “contrapposto” to something the player can actually inspect.
- **Keep practice psychologically safe.** Practice has unlimited hints and can expose visual cues before lock-in. Custom training and archive replay do not contaminate the daily streak or longitudinal mastery signal.
- **Be candid about the archive.** The product does not pretend its public-domain corpus is a neutral survey of world art. Collections explains which regions, museums, and periods are overrepresented—and why.
- **Ask for commitment only after delivering value.** Play, saving works, and progress begin without an account. The core daily and its teaching remain free; the first sustainability experiment is a quiet, dismissible donation ask after a seven-day streak, shown no more than once every 30 days.

### What success means at this stage

Gesso is a pre-traction, founder-led product; its creator is currently its primary player, so the repository does not claim retention or learning outcomes it has not measured.

The first validation question is **whether someone who completes a daily returns for another one**. Once there is a real cohort, D1 and D7 retention are the primary evidence of recurring value. First-daily completion and reveal engagement diagnose *why* players do or do not return; works studied and mastery growth are learning guardrails so retention is not won by hollow gamification. A useful eventual north-star metric is **weekly retained learners**: players who complete dailies on at least two distinct days in a week.

---

## How the daily is built

The schedule is not five random rows from a database. `scripts/freeze-daily.mjs` makes a deterministic, diversity-aware selection under several competing constraints.

1. **Start with playable, public-domain works.** Remains, works marked unplayable by the audit, and records missing too many scoreable fields cannot enter a daily.
2. **Set a recognizable tier contract.** The fame signal combines cross-language Wikidata sitelinks with Wikipedia readership. Cross-language documentation helps, but the current pageview term is still English-only and the whole score remains an archive-coverage proxy—not a universal measure of cultural importance.
3. **Protect Easy on purpose.** Each Easy daily contains four works from the top icon band and one from the next recognizable band. Gesso does not quietly make Easy harder to satisfy a representation quota.
4. **Mix difficulty within the other tiers.** Medium, Hard, and Impossible each draw across five fame quintiles, preventing a day from becoming uniformly obvious or uniformly hopeless. A date-seeded shuffle then hides which position contains the most recognizable work.
5. **Diversify across more than geography.** The scheduler strongly separates named artists and movement/culture, then spreads country and medium, with additional pressure across region and century. This also protects anonymous traditions that artist-only deduplication would miss.
6. **Prevent repetition.** Across all tiers, it targets a 30-day exact-work gap, a five-day named-artist gap, and a 14-day gap for clusters of near-identical anonymous objects. Within one daily, titles and named artists never repeat and a style appears at most twice. The exact-work gap can relax only as a last resort; on Easy, preserving the four-icons-plus-one-recognizable promise wins before substituting a second less-recognizable work.
7. **Keep every scorecard useful.** A repair pass targets at least two works with movement/culture answers, one with an attributable artist, and two with medium answers. The deliberately low artist floor avoids pushing anonymous—and disproportionately non-Western—work out of the schedule.
8. **Freeze history.** An append-only ledger makes every served daily immutable. By default, re-running the scheduler preserves already frozen future dates too and only extends the horizon; an explicit flag is required to regenerate the future, and served dates still cannot change.

### The intentional Easy-tier tradeoff

Easy skews European because the best available recognizability proxy inherits the Western canon and the digitization choices behind it. That is a known tradeoff, not an accidental output. Forcing geographic parity after setting the tier would break the promise that Easy feels recognizable to the intended beginner.

Gesso instead separates two jobs: **difficulty establishes a trustworthy expectation; diversity rules improve the mix within that expectation.** The interface surfaces the resulting skew rather than laundering it as neutral. The longer-term opportunity is a second difficulty signal based on visual inferability or culture-relative familiarity, not a hidden quota inside the current fame ladder.

---

## Scoring choices made for beginners

Each core category is worth up to 2,500 points. The goal is to reward a defensible visual inference, not only an exact catalogue label.

- **Date respects uncertainty.** Scoring happens in non-linear timeline space, giving recent centuries more resolution while allowing broader ancient estimates. For the many records with a date range, every year inside the sourced range receives full credit.
- **Place means where the work was made.** It never means the holding museum or the artist's nationality. Country polygons include border grace; period-appropriate cultural regions can also receive full credit, with distance-based partial credit outside them.
- **Medium is simplified for play, not erased.** Scoring uses a legible artistic-process taxonomy such as oil, bronze, or print, while the reveal retains the fuller source description.
- **Movement and culture are not treated as synonyms.** The game uses movements, periods, schools, traditions, and cultures where each is the more honest frame. Distractors do not pit the same tradition against itself at incompatible levels of specificity.
- **Artist is optional attribution.** Anonymous, unidentified, workshop, and culture-level records are not treated as failed biographies. When an artist is scoreable, input is accent-insensitive and tolerant of surnames and small typos; deterministic partial credit recognizes a plausible school, era, or region.
- **Hints have an opportunity cost only when they help.** Daily play allows three hints at 500 points each; practice allows unlimited hints. A hint that cannot narrow the field is not charged, and hint penalties do not come out of optional attribution credit.

Difficulty changes the decision itself. Easy medium choices come from visually distant families; harder tiers use plausible lookalikes. Movement choices become more locally related, place falloff gets stricter, and geographic elimination becomes less generous. This makes difficulty about the quality of judgment required, not simply lower scores for the same interaction.

---

## Learning design after the guess

- **Pixel-pinned teaching.** “Look closer” notes connect explanations to exact areas of the artwork; the most relevant notes open first on larger screens.
- **No runtime chatbot.** Teaching notes and common follow-up questions are generated ahead of time, versioned with the corpus, and served without a live model call. That controls cost, latency, abuse, and answer drift.
- **A glossary earned through play.** Movements and cultures unlock after the player encounters them, with a canonical example, visual cues, and a one-click drill.
- **Mastery without contaminated data.** Daily and endless play update “Your Eye.” Self-selected training and archive replay remain off-record, so a drill chosen because the player already feels weak at it does not distort the longitudinal signal.
- **Training changes the game, not just the filter.** One pinned facet becomes given context and removes that question; multiple facets restrict the corpus. Geography and time controls rescale to the trained works, and results emphasize category accuracy and improvement rather than a single high score.
- **A correction loop.** Every reveal includes source records and a structured error report. Reports are part of the content-operations system, not an afterthought.
- **A lesson worth keeping.** Players can save a reveal to My Gallery, reopen its notes, group their collection by era, region, movement, or holding museum, and share the work itself—not only a score.

### Recognition is treated as a research question

“Would a beginner have a chance?” is not answered by the creator's intuition alone.

- **Documentation density is one signal, not ground truth.** Wikidata sitelinks and Wikipedia readership provide a reproducible proxy for prior exposure. All-language pageview experiments test whether English traffic is distorting the ranking.
- **Visual inferability is a separate signal.** Blinded image experiments ask what can be inferred from pixels without a label, while a complementary model predicts how a typical non-expert might perform when recognition is allowed. Both use the same five scorecard fields as small human studies so the signals can be compared.
- **Vision v2 reviews the actual player experience.** The stricter image-grounded pass verifies that the image depicts the correct work, judges whether it contains usable visual evidence, checks quality and framing, drops medium from scoring when it is not visually legible, and places teaching pins directly on the feature being described.
- **Exposure determines audit priority.** Upcoming dailies and the most-seen works are reviewed first. V2 metadata suggestions go to a review backlog rather than changing the pool automatically; the next pass extends that explicit human-signoff rule to cultural attribution and sensitivity.

The goal is eventually to blend documentation density with visual-inference difficulty. That would let a visually legible but under-documented work become approachable without pretending it is already famous.

---

## Designing the collection

The corpus contains roughly **5,900 public-domain works**, but scale is not the product claim. Gesso uses a portfolio of complementary open collections, source-specific acquisition plans, and gap analysis to build something playable without presenting it as a neutral canon.

### Why these collections

| Source | What it contributes to the product |
|---|---|
| **The Metropolitan Museum of Art** | Global scale. Its acquisition plan deliberately weights Asian, Islamic, African, Oceanian, American, Egyptian, and Ancient Near Eastern departments while limiting additional Greek and Roman material already well represented elsewhere. |
| **Cleveland Museum of Art** | Strong open data and images across Asian, Islamic, African, ancient, American, and European art; its selector balances those areas and favors highlights, on-view works, and teachable object types. |
| **Harvard Art Museums** | One API across three museums with deep Asian and Islamic holdings. Searches and quotas explicitly cover Chinese, Japanese, Korean, South and Southeast Asian, Persian, Ottoman, Mughal, and related traditions. |
| **Smithsonian Open Access** | A deliberately even acquisition from the National Museum of African Art and National Museum of Asian Art rather than a generic Smithsonian search. |
| **Victoria and Albert Museum** | Art and design: textiles, ceramics, glass, furniture, jewelry, metalwork, screens, and other forms that counter the corpus's inherited oil-painting bias. Sensitive-image flags are respected at ingestion. |
| **Library of Congress** | Public-domain FSA/OWI photography, including verified work by Dorothea Lange and Walker Evans. It brings documentary images and everyday lives into a collection otherwise prone to “masterpiece” objects. |
| **Walters, Brooklyn, LACMA, NGA, the British Museum, and musée du quai Branly** | Targeted depth in medieval, Islamic, ancient, Egyptian, American, global, print, African, Asian, Oceanian, and Indigenous material, often reached through Wikidata and Commons when a direct open API is unavailable. |
| **Wikidata and Wikimedia Commons** | A cross-institution layer for famous works plus targeted origin- and culture-based discovery independent of the Western museum currently holding an object. |

This is not “add diverse art” as a single backlog item. The collection is profiled across region, era, medium, object type, culture, artist attribution, and their intersections. Acquisition then targets specific art-historical gaps such as Oceania, South and Southeast Asia, pre-Columbian art, prints, sculpture, decorative arts, textiles, photography, and public-domain women artists.

### How acquisition works

- **No collection is ingested wholesale.** Museum highlights, on-view status, timeline inclusion, gallery labels, documentation, image quality, and object legibility help identify works a traveler might encounter and Gesso can teach well. Long-tail records are staged rather than promoted merely to increase the count.
- **Different sources get different strategies.** Department quotas make sense for an encyclopedic museum; an even unit split makes sense for the Smithsonian; object-type searches make sense for the V&A; cross-language sitelinks make sense for Wikidata. One ranking formula would reproduce each source's loudest department.
- **Acquisition quotas do not become difficulty quotas.** Targeted harvesting improves the pool. Difficulty still makes an honest recognizability promise, and the daily scheduler diversifies only within that tier. This is why Easy can remain intentionally canon-heavy while the overall collection becomes broader.
- **Rebalancing is additive.** Coverage analysis explicitly avoids deleting useful European paintings to manufacture parity. It slows acquisition in saturated areas and harvests into missing ones.
- **Documentation bias sometimes requires a different doorway.** One African-art adapter searches by country of origin regardless of holding museum. Another searches by culture and deliberately has no sitelink floor, because requiring extensive Wikipedia coverage would exclude the Yoruba, Edo, Dogon, Kuba, and other traditions the query exists to find.
- **Diversity includes form and authorship.** Acquisition plans seed public-domain women artists and make room for anonymous, collective, and workshop production. Searches include ceramics, manuscripts, screens, scrolls, masks, ritual objects, textiles, vessels, furniture, and photographs—not only named painters and oil canvases.
- **Copyright is a release constraint, not an aesthetic judgment.** Public-domain checks use creator death, publication year, source-specific government-work rules, and a rolling annual harvest as new works enter the public domain.

### The Collections page is part of the product

The home page shows the live share of Easy that is European and the live regional distribution of the entire pool. The Collections page computes its regional counts, source counts, and museum locations from the current corpus rather than freezing favorable numbers in marketing copy.

It also preserves three different facts:

1. **Where a work was made**—the origin used for scoring.
2. **Where its digital record came from**—the source institution or knowledge graph.
3. **Where it is held today**—useful provenance and travel information, but not the work's cultural identity.

The source cards link back to the institutions; each reveal offers a “View at source” path; and maps turn the same provenance system into a museum-discovery tool for someone planning a trip. My Gallery can map the museums that hold a player's own saved works.

The page also names failures in the available infrastructure. Gesso sought direct open-image coverage from museums across Africa, but major collections in Tunis, Cape Town, and Lagos have little usable coverage in the knowledge graphs and open APIs available to the project. African works therefore often arrive through the Western museums that hold them or through origin-based searches—a digital echo of physical dispersal. Similar sections explain why the Americas and Oceania remain thin. Data availability is presented as evidence about power and digitization, not as evidence that those traditions matter less.

The page is also a deliberately mixed reading-and-viewing list. Its links include Mati Diop's *Dahomey*, Digital Benin, the Sarr–Savoy Report, *Statues Also Die*, Dan Hicks's *The Brutish Museums*, *Aanikoobijigan*, Nicholas Thomas's *Possessions*, Local Contexts and Traditional Knowledge Labels, Walter Mignolo, and Linda Nochlin. Those links move the explanation beyond an institutional disclaimer toward restitution work, source-community protocols, feminist criticism, films, and scholarship that can challenge the collection's own frame.

### Curatorial and art-historical conventions

- **Creation and custody are separate facts.** A Benin object held in London does not become British data, and an artist's nationality is not substituted for where an object was made.
- **Historical geography is applied with parity.** Ancient Egypt, Safavid Persia, the Ottoman core, the Low Countries, the pre-unification Italian peninsula, and other historical regions can all be valid scoring areas. Fluid geography is not reserved for non-Western art while Europe gets modern borders.
- **Anonymous makers remain first-class.** Optional attribution and low artist-coverage floors keep ceramics, textiles, ritual objects, and workshop production playable instead of filtering them out for lacking a celebrated individual name.
- **Movement is not a universal category.** The data distinguishes movements, schools, periods, traditions, and cultures instead of forcing every object into a Western “-ism.” The remaining tendency for Western art to receive dynamic movement labels while other art receives broad cultural or dynastic labels is documented as an unresolved ontology problem.
- **Uncertainty remains visible.** Date ranges receive full credit throughout the sourced interval; “attributed to,” workshop, circle, and follower labels are preserved rather than collapsed into false certainty.
- **Some objects should not be gamified.** Human and ancestral remains are excluded from play. Source sensitivity flags are respected, and contested, funerary, sacred, and ceremonial material is routed toward context and additional review.
- **The app's voice is accountable.** Gesso-authored notes are screened for harmful language. Historically assigned museum titles can themselves carry a colonial voice; consistently annotating those inherited titles remains open work rather than a solved claim.

These choices reduce particular distortions; they do not “decolonize” a dataset built from uneven museum, legal, and Wikimedia infrastructure. The project keeps a [choices and assumptions register](docs/ethos.md) so the values, tradeoffs, criticisms, and alternatives remain legible and revisable.

### Giving something back

The collection pipeline can discover museum-object-to-Wikidata matches that are useful to the commons even when the works are too obscure for Gesso. A companion workflow identifies items missing a collection statement, generates small referenced QuickStatements batches, and requires manual verification before submission. It never edits Wikidata automatically. The purpose is reciprocity: improving shared cultural metadata is worthwhile even when it does not improve a product metric.

---

## Access, ownership, and sustainability

The same anti-gatekeeping stance shapes the surrounding product:

- **Progress before registration.** A first-time visitor can play, build a streak, join the leaderboard, save works, and use My Gallery with a device-keyed identity. An account is offered for name ownership, backup, and cross-device continuity—not required to access the lesson.
- **A personal museum, not disposable content.** Saved works retain their study notes and source links and can be filtered by movement or place, grouped by era, region, or holding museum, and shared individually. This gives the daily an accumulating emotional and practical value beyond the streak.
- **Sharing can center the artwork.** Players can share results, the puzzle, a downloadable score image, or a link to a single work and its reveal. Curiosity is a valid social artifact even when the score is not impressive.
- **Accessibility is a product setting.** Colorblind mode adds symbols instead of relying on red, yellow, and green alone; reduced-motion follows the operating-system preference and suppresses decorative movement; controls support keyboard interaction; and dimensions can be shown in centimeters or inches.
- **First-party, minimal analytics.** Product events go to Gesso's own endpoint rather than a third-party tracker. They are keyed to a pseudonymous device identifier, accept only a small set of scalar properties, and exclude names, email addresses, free text, and other PII. Analytics failure never blocks play.
- **Deletion is real.** Signed-in players can delete their authentication record, profiles, leaderboard scores, and synced state. Signing out also clears account-derived local identity so a shared device does not silently inherit it.
- **Playful simulations are labeled.** “The Masters” provides deterministic simulated benchmarks based on real artists from different eras and regions, but the interface explicitly labels the scores simulated rather than presenting synthetic activity as real users. A separate first-attempt marker preserves the distinction between a cold solve and an improved replay score.

### A business model under a values constraint

Revenue is a sustainability guardrail, not the north star. The daily, reveal, and teaching content should remain free, and advertising would conflict with the product's trust model.

The current experiment asks for support only after a player reaches a seven-day streak—a moment when value has been demonstrated rather than promised. The card is dismissible, appears at most once every 30 days, and links to a voluntary donation. The next options are intentionally sequenced: first donations and gifting, later paid convenience or depth that does not paywall the daily lesson, and eventually mission-aligned museum or education partnerships. Each step should be tested as a falsifiable product hypothesis rather than assumed to be a business.

See the [monetization hypothesis](docs/monetization.md) for the options, risks, and experiment design.

---

## The data and AI pipeline

The product is backed by a resumable content-operations system for harvesting, normalizing, reviewing, and scheduling thousands of heterogeneous records.

```
harvest (Wikidata SPARQL + museum APIs)
  → normalize + copyright filter
  → documentation-density ranking
  → QA STACK ↓                                  → deterministic daily freeze
      1. structural detectors       (no network)
      2. zero-token text checks     (source consistency)
      3. image-grounded vision QA   (pixels → structured JSON)
      4. cross-field consistency    (date, maker, place, culture)
  → field-aware merge (automatic vs. review-queue changes)
  → fail-closed release gate
```

The operating principles are:

- **Use models as constrained drafting and review systems, not factual authorities.** Outputs follow schemas and enter different merge paths by field risk. Titles, dates, coordinates, and image swaps require more scrutiny than bounded enrichment fields.
- **Make expensive judgment the last layer.** Deterministic checks run first, text checks next, and vision only where pixels are necessary. Audit priority follows expected player exposure.
- **Turn bugs into permanent detectors.** Each discovered production failure becomes a reproducible scan in `audit-detectors.mjs` or a hard rule in `check-pool.mjs`.
- **Separate warnings from release blockers.** Advisory checks create review backlogs. Deterministic hard violations exit non-zero in tests and CI.
- **Keep runtime AI-free.** Model work happens in the content pipeline; players receive committed, reproducible data.

Key entry points include `build-pool.mjs`, `consolidate.mjs`, `fame-score.mjs`, `freeze-daily.mjs`, `vision-next.mjs`, `curate-merge.mjs`, `audit-detectors.mjs`, and `check-pool.mjs`. The research utilities also include human-study aggregation, learning-curve correction, alternative fame-signal experiments, and blinded visual-guessability tests.

### Authorship, collaboration, and model assistance

**Kat Swint** conceived Gesso and leads its product strategy, collection development, art-historical rules, gameplay and scoring, data pipeline, engineering, and ongoing content operations.

**Briana Das** created the visual and interaction design for the current redesign. Her work is not a coat of CSS: it defines the editorial design system, typography, color, layout, onboarding, motion, navigation patterns, and reusable interface primitives. Kat implemented and extended that system across product surfaces added after Briana's original redesign branch. The current interface should be understood as Briana's design work carried through a product that Kat continues to build.

**Models assist with** implementation, bulk teaching-note drafts, structured source consistency checks, and image-grounded review. Kat defines the product rules, prompts, schemas, field-risk boundaries, merge policies, and release gates, and is accountable for what ships. The first vision pass has covered the corpus; a stricter v2 pixel-grounded pass is being rolled out most-seen-first and tracked in `data/vision.js`.

Kat has **not** manually reviewed every teaching note. She reviews notes while playing, investigates reported errors, and improves the detectors and pipeline when a failure exposes a reusable bug class. Players can report questionable images, facts, labels, or explanations directly from the reveal. That is the actual trust model: broad automated review, sampled human inspection, user reporting, deterministic gates, and continuous correction—not a claim of exhaustive human sign-off.

---

## Architecture and deliberate constraints

- **No build step.** The vanilla-JS deployment is inspectable and dependency-light. The tradeoff is a large inline application that now needs to be separated into plain `<script src>` modules.
- **Hand-tuned scoring.** Distance curves, date tolerances, and movement relationships are product hypotheses, not learned truth. They need calibration against real player distributions.
- **Client-submitted leaderboard scores.** The leaderboard is a low-stakes social nudge, so the first version trusts the client. Raw per-round guesses are stored so authoritative server-side rescoring can be added later.
- **No meaningful `script-src` CSP yet.** Inline JavaScript makes a strong CSP incompatible with the current no-build architecture. Other security headers ship, user-set strings are escaped, and modularization is the path to closing the gap.
- **Human-run, non-transactional pipeline.** Individual writes use atomic replacement where practical; the final deterministic gate is the release transaction boundary.

---

## Data and licensing

The corpus is restricted to public-domain or CC0-safe images under the project's US-oriented policy, with creator-death and publication-year checks plus source-specific rules for government works. Domain conventions are enforced in the pipeline:

- place = where the work was made;
- medium = artistic process, not merely support material;
- source institution ≠ holding institution ≠ place of creation;
- secrets remain in local or deployment environment variables; the shipped Supabase anon key is publishable by design.

Image delivery uses card-sized sources by default, loads full resolution only on zoom, and retries through fallbacks before failing gracefully.

---

## Quality gates and tests

- `npm test` runs scoring and medium tests, static-module checks, the real app script in a headless DOM harness, the pool gate, the design gate, and local advisory audits.
- `npm run test:ci` runs the deterministic, network-free subset on every push and pull request.
- Tests extract functions from the shipped `index.html`, reducing the chance that test copies drift from production logic.
- A reproducible labeled eval in [`docs/auditor-eval.md`](docs/auditor-eval.md) measures gross wrong-image detection. Near-miss decoys—a different work by the same artist or period—remain the more valuable next test.

---

## Known limitations and next questions

- There is not yet a multi-user cohort, so retention, comprehension, and scoring calibration are hypotheses rather than demonstrated outcomes.
- Wikipedia documentation density still reproduces canon, digitization, language, and cumulative-attention bias. Sitelinks are cross-language, but the current readership term is English-only; an all-language alternative is being evaluated before it changes the tiers.
- The v2 pixel-grounded audit is still burning down most-seen-first.
- Historical regions remain broader and less period-specific than the finished product should ultimately support.
- The movement/culture ontology can reproduce a two-tier history in which Western art gets named movements while non-Western art gets broad cultures or dynasties.
- Public-domain restrictions underrepresent twentieth- and twenty-first-century art.
- The single-file application has outgrown the maintainability benefits of its original no-build constraint.
- The harvest is not byte-for-byte reproducible because its upstream knowledge graphs continue to change; committed snapshots or locks would close that gap.

---

## Run it locally

```bash
npm install
npm run serve      # static server on :8000
npm test           # full local suite
npm run test:ci    # deterministic network-free CI suite
```

No build step is required. Data ships as `window.ARTEFACTUM_*` globals in `data/*.js`. Clean routes such as `/2026-06-18/easy` require a server, hence `npm run serve` rather than opening the HTML file directly.

**Stack:** vanilla-JS SPA · Leaflet · Vercel serverless functions · Supabase · Upstash Redis · Node ESM data pipeline · Wikidata/Wikimedia and open museum APIs.
