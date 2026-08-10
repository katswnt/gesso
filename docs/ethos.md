# Gesso — Choices & Assumptions Register

*What this is:* a durable record of the values-laden choices baked into Gesso — the taxonomy, the scoring, the difficulty model, the copyright gate, the AI method, and the product frame — each one surfaced, named, and stress-tested. It exists so the choices are **legible and revisable** rather than silent, and so a future maintainer (or a critic) can see not just *what* Gesso does but *what it assumed* and *what it traded away*.

*How it was made:* every choice below was audited by eleven expert lenses — art historian, historian, political scientist, colonial/restitution scholar, Western museum curator, source-community/non-Western curator, intersectional decolonial feminist, critical-data/algorithmic-bias analyst, product & games-ethicist, SWE/systems-ethicist, and a composite of the makers themselves (El Greco, Bruegel, Hokusai, a Benin brass-caster, a woman filed for centuries as "Anonymous," Kandinsky's estate). Each was asked to **affirm what's right and stress-test what's assumed**, not to rubber-stamp.

*How to read an entry:*
- **Choice** — what Gesso actually does.
- **Value encoded** — the belief the choice expresses.
- **Assumption** — the thing taken for granted for the choice to hold.
- **Where it holds / where it bites** — the synthesized surface + stress-test across lenses.
- **Alternatives on the table** — the roads not taken, or not yet taken.
- **Flag** — `affirm` (right call), `tension` (right instinct, real cost), or `risk` (the cost may outweigh the benefit as built). Flags are the audit's, not gospel; several are `affirm-with-tension`.

*The two findings that recur in almost every lens* (see [Cross-cutting patterns](#cross-cutting-patterns) at the end):
1. **Disclosure is not discharge.** Gesso names its biases with rare candor — and naming can quietly license the biased thing to keep running. Honesty copy earns its keep only when paired with a change to the mechanic or a dated remediation.
2. **Each fix can install a subtler frame.** Anti-border scoring re-inscribes *empire-as-region*; anti-genius scoring re-erases the *already-unnamed*; a carefully decolonized label still sits on a *pin-on-a-modern-map* substrate that carries a nation-state ontology upstream of every label.

---

## A. Taxonomy & Naming

### A1 — Place = where the work was MADE
Not the holding museum, not the artist's nationality.

- **Value encoded:** An object is anchored to its site of *production* — an anti-nationalist, anti-custodian ontology that refuses both the passport and the loot-holder as the definition of belonging.
- **Assumption:** That "where it was made" is (a) knowable and (b) singular.
- **Where it holds / where it bites:** Nearly every lens **affirms the principle** (art history, poli-sci, the makers via Hokusai: "'Made in Edo' tells you something true; 'held in Boston' tells you only where it drifted"). The soft spot is the *single point*. For workshop-dispersed, diasporic, trade-diffused, and nomadic production — a Gandhāran Buddha, a Silk Road textile, an export porcelain designed for Lisbon and painted in Jingdezhen — "made where" is contested or plural [art history, history, poli-sci]. Two lenses name a sharper omission: the Western-curator lens notes museum cataloguing distinguishes place *made* / *found* / *commissioned* / *workshop* for good reason, and Gesso's single field **suppresses the find-site and provenance data the app elsewhere (A3, A6) claims to care about**; the makers' Benin caster: "the deepest fact about my plaque is not only where it was cast but that it is *in London because it was taken* in 1897 — 'place of making' quietly drops the half living communities are still fighting over."
- **Alternatives on the table:** Keep "made" as the scored field but add **non-scored provenance sub-fields** (find-site, commission, current custody, how-it-got-there) surfaced at reveal; allow multi-origin objects to score full credit at any credited node; expose "attributed / uncertain / multiple" as a first-class state instead of one confident dot.
- **Flag:** **affirm** — the principle is right; the single-point commitment and the missing provenance fields are the residual weakness.

### A2 — Culture-and-period for premodern & non-Western art; "movement" for the rest
Premodern and non-Western works are named by *culture and period* rather than forced into a "movement."

- **Value encoded:** "Movement" has a real historical home (the post-1400 European art world's self-naming — -isms coined by critics, dealers, manifestos) and shouldn't be exported onto societies that never worked that way.
- **Assumption:** That "culture + period" is the *neutral* residual — the truthful description when there's no movement.
- **Where it holds / where it bites:** This is the audit's **deepest single tension**, flagged by five lenses. The corpus runs a **two-tier ontology**: the West gets *diachronic* labels (agents, schools, ruptures — Cubism, Baroque); everyone else gets *synchronic* labels (a people + a time — "Han China," "Benin"). One tier narrates change; the other describes a state — reproducing exactly the "peoples without history" frame post-colonial art history spent forty years dismantling [art history]. The historian sharpens it: "culture + period" is *not* innocent — "Kamakura," "Edo," "Ming," "Gupta" are **dynastic periods** that date art by who held the throne, so the app grants the West *stylistic agency* (artists making movements) while giving the rest *dynastic time* (art happening under rulers). The source-community curator lands the hardest blow: "movement" implies humans who *named themselves*; "culture and period" is the ethnographic register that speaks *about* a people in the third person and freezes a *living* Yoruba casting lineage into a closed historical "period." **Who** assigns "Yoruba, 15th c."? Wikidata/Met catalogers — not Yoruba communities.
- **Alternatives on the table:** **Decouple the taxonomy type from the West/non-West axis** — let non-Western traditions carry their real internal school/workshop vocabularies where scholarship supports them (Kanō school, Tosa school, Company painting, Ife naturalism, Bengal School), and let Western premodern work take culture+period too (Ottonian, Merovingian). Store **provenance-of-name** (who named this culture-label, from what source) and surface it at reveal; mark living traditions *living*, not "period."
- **Flag:** **tension** — the fix for one Eurocentrism installs a subtler one; solvable by *enriching* the non-Western taxonomy, not flattening it.

### A3 — Historical super-regions over modern borders
Scoring credits the historical cultural region (Low Countries, Han China, Ottoman, Russian/Soviet sphere), not the modern country; "'Nigeria' is a colonial fiction for a Benin bronze." A stated **parity rule**: the same generous historical geography for the West that the corpus already gives ancient/non-Western art.

- **Value encoded:** The past should be scored on its own spatial terms; the nation-state is a recent, contingent container that distorts pre-national objects.
- **Assumption:** That the historical region is *less* of a construct than the modern nation.
- **Where it holds / where it bites:** Widely **affirmed as the app's strongest anti-colonial instinct** — and flagged by six lenses for the same reason. Super-regions are *also* imposed abstractions, and specifically **imperial** ones: "Ottoman," "Han China," "Russian/Soviet sphere" are the labels of empires and dominant cores. Crediting an Armenian manuscript, a Ukrainian icon, a Coptic or Circassian or Uyghur object to the metropole's name **universalizes the conqueror's map** — the erasure A3 claims to resist [history, poli-sci, colonial, curator-nonwestern]. Benin was a *sovereign kingdom*; folding it into a "super-region" can replace a colonial container with an areal-studies one [poli-sci]. Regions are also **time-indexed**: "Ottoman" is right for 16th-c Bursa and wrong for 12th-c Bursa (Seljuq/Byzantine) — a static label silently imports a period claim [history]. The **parity rule** is honest anti-Eurocentrism, but every lens notes the catch: symmetry in *treatment* doesn't neutralize asymmetry in *who authored the categories* — and European super-regions (Holy Roman Empire, Christendom) are exactly the imperial abstractions historians spent a century deconstructing [history, poli-sci, decolonial]. A quieter asymmetry [colonial]: European works usually *also* carry an artist and a movement, so the region is *additive*; non-Western works often carry *only* culture-and-period, so the region becomes the whole identity.
- **Alternatives on the table:** **Period-stamp** each credited region and show the polity's actual extent for that century, not a timeless blob. Where an empire subsumes a distinct culture, **credit the finer culture too** (accept "Armenian" OR "Ottoman"). Prefer the object's own contemporaneous polity where attested (Kingdom of Benin, not "West Africa"); reserve super-regions for genuinely stateless/areal cases; expose the region taxonomy for critique the way other biases already are.
- **Flag:** **affirm-with-tension** — right to reject colonial states; guard against empire-as-region becoming a new flattening.

### A4 — Medium = artistic process, not support
Oil, bronze, print — a simplified taxonomy; medium is dropped from scoring when it can't be judged from the image.

- **Value encoded:** The intellectually salient fact is the *making* (technique), not the substrate.
- **Assumption:** That process and support separate cleanly, and that support is inert.
- **Where it holds / where it bites:** Two lenses flag it. For much of art history **the support IS the meaning**: "oil on panel" vs. "oil on canvas" dates and locates a work (panel = earlier/Northern; canvas = later/Venetian); fresco vs. tempera is a technology of place; an icon painter's gesso-and-egg is theological, not incidental; "bronze" collapses lost-wax vs. sand-cast vs. later aftercast — the difference between an original and a foundry reproduction, i.e. a **forgery-detection** fact [art history, curator-western]. The simplification privileges the Western easel-painting frame where support feels like a footnote, and barely applies to textiles, lacquer, featherwork, or manuscript illumination. The curator's key distinction: it's fine to *not score* support, but Gesso currently **discards** it rather than storing it — throwing away real object data.
- **Alternatives on the table:** Store the full composite medium string as catalogue data (player sees "oil on panel"), score only the simplified process class ("oil"); let medium be a short material phrase for object classes where support is load-bearing (panel, vellum, silk).
- **Flag:** **tension** — a defensible scoring simplification that misfires outside easel painting and currently deletes data instead of merely not-scoring it.

### A5 — Curated, controlled MOVEMENTS vocabulary
A `style-verbose`/`style-comma` gate blocks descriptive "junk" cultures; a fixed vocabulary with explicit culture/movement/period typing.

- **Value encoded:** A canon of legitimate style-names exists, and descriptive noise should be gated out to keep the data clean.
- **Assumption:** That the boundary between a real movement and "descriptive junk" is stable and known.
- **Where it holds / where it bites:** The Western curator **affirms** this as museum best practice (AAT, ULAN, Iconclass exist for exactly this) — the single strongest engineering choice here — but with the field's hard-won caution: *a controlled vocabulary is a point of view*, and who gets a "movement" vs. a residual "culture/period" slot reinscribes the center/periphery A2 already struggles with. Two lenses push to `risk`: "every -ism was 'descriptive junk' before it won" [art history], and the residual "junk" categories tend to fall on exactly the non-Western material the corpus is thinnest on — and because the **LLM auditor is told to enforce this vocabulary (E1), the blind spots become self-sealing**: the model can only validate *into* the existing boxes [critical-data]. The gate laundering editorial canon into "structure."
- **Alternatives on the table:** Align terms to a published authority (AAT/ULAN) with stable IDs; **version the vocabulary with a visible changelog and an "emerging / contested" tier** scored generously rather than gated out, so classificatory uncertainty is visible instead of coerced.
- **Flag:** **tension** — controlled vocabulary is correct and necessary for a scored game; just don't mistake control for objectivity, and don't let the gate hide the politics of category-making.

### A6 — Sacred/contested objects shown "with context, not as trophies"
Human remains flagged `sensitive:"remains"` and excluded from puzzles (kept visible in Collections).

- **Value encoded:** An ethics of display that refuses the imperial vitrine; some things (remains) should never be gamified at all.
- **Assumption:** That *framing* is the site of the harm — that a looted object becomes ethical once honestly captioned; and that "sacred/contested" largely reduces to "human remains."
- **Where it holds / where it bites:** **Excluding human remains from a guessing mechanic is unanimously affirmed** as ethics *in the mechanic*, not the copy — the model the rest of the app should follow. But six lenses converge on the residual: **the trophy is a possession-and-circulation problem, not a caption problem.** A looted Benin bronze rendered as a daily image a stranger scores for points is still consumed as spectacle on terms its source community never set — "not as trophies" describes the maker's *intention*; the game's *verb* is still acquisitive (possess, identify, catalogue — the exact posture that dispossessed it) [colonial, decolonial, product, curator-nonwestern, artists]. The line is currently drawn at **Western squeamishness about bodies**, not source-community protocol about the sacred: a mask that may not be seen by the uninitiated, an ancestor figure that is a living relative not an "artwork," an object whose *image* is restricted, all remain guessable [curator-nonwestern]. And *who* decided a given object is guessable-but-contextualized? That judgment is made from inside the same Western epistemology the project critiques [colonial].
- **Alternatives on the table:** Extend `sensitive` beyond remains to a **`restricted`/`ceremonial` class** sourced from actual community protocols (AIATSIS, NAGPRA-adjacent guidance, ICOM restitution lists, Traditional Knowledge / Local Contexts labels); such objects appear in Collections with provenance/restitution notes but **never enter the scored rotation**. For flagged contested objects, replace the *competitive guess* with a no-score **"witness/encounter" mode** (provenance + restitution reveal, no points) — extending the human-remains logic from exclusion to a distinct non-gamified treatment.
- **Flag:** **tension → risk** — best-in-class intent and a genuinely correct hard line on remains; the guessing mechanic itself resists full de-trophying, and the sensitivity line is currently drawn by Western category, not source protocol.

### A7 — Harmful language scrubbed from the app's OWN voice; original titles preserved
A `check-language` gate flags "savage"/slurs in Gesso's notes; original artwork **titles** are kept verbatim.

- **Value encoded:** A line between *our* speech (accountable, editable) and the *artifact's* speech (historical, to be preserved faithfully).
- **Where it holds / where it bites:** The decolonial-feminist lens calls this **the least coherent seam in the whole design**. Most "original" titles on canonical non-Western and colonial-era works were **not given by the maker** — they were assigned by the collector, dealer, or ethnographic museum: the exoticizing "Fetish Figure," "Idol," "Oriental Woman," the racial descriptors baked into 19th-c labels. Preserving those verbatim while scrubbing your own "savage" **canonizes the colonizer's voice as if it were the object's own** — the gate cleans the one voice the maker fully controls and broadcasts the one voice most saturated with the exact harm the gate targets. This lands hardest on works depicting or made by racialized women, whose museum titles most often fuse racial and sexual objectification. The SWE lens adds the structural limit: a denylist catches a *word*, but curatorial harm is usually *tone and omission* — a title (or note) can be technically clean and still frame a looted object as a trophy.
- **Alternatives on the table:** Keep the historical title but **demote it to a cited, sourced label** ("collection title, assigned by [museum], [date]") shown alongside a neutral descriptive title; **run `check-language` over titles too** — not to erase, but to *annotate* the harmful ones as historical artifacts.
- **Flag:** **risk** — the fidelity/scrub split is inconsistent and silently re-broadcasts colonial captions as if they were the work's own name.

---

## B. Scoring Model

### B1 — Five categories × 2,500, hand-tuned constants
"Game-design values, not learned parameters."

- **Value encoded:** Reward weighting is authored design, not discovered truth — and being hand-tuned, it can't overfit a biased click-stream.
- **Assumption:** That the maker's tuning intuitions generalize across traditions the maker knows unevenly; that place/date/etc. are equally knowable and equally central across all art.
- **Where it holds / where it bites:** The critical-data lens **affirms hand-tuning over a black-box learned weight** as the more honest choice — but flags that equal 2,500-per-axis weighting is *itself* a claim. For a non-cartographic object (a Dreaming painting, a devotional icon), forcing a full-weight place-pin imports a Westphalian, map-based epistemology and penalizes worldviews where "where it was made" isn't the salient fact. The constants encode one art-historical grammar as universal.
- **Alternatives on the table:** Allow **per-tradition axis weights** (drop or down-weight "place" where the category is a category error), surfaced to the player as part of the teaching.
- **Flag:** **affirm-with-tension** — transparent authored constants beat laundered learned ones; the remaining issue is uniformity across incommensurable traditions.

### B2 — Date scored in timeline-position space, not raw years
A non-linear timeline (recent centuries get most of the track); a bullseye is ~a decade in the 1900s but ~two centuries in 2500 BCE — "era-appropriate tolerance."

- **Value encoded:** Precision expectations should scale with the density of the historical record.
- **Assumption:** That "a decade in 1900 ≈ two centuries in 2500 BCE" reflects real epistemics, not recent-era chauvinism — and that one monotonic curve fits all regions.
- **Where it holds / where it bites:** Defensible as *epistemic humility* — we date a Sumerian object to a century, a 1912 canvas to a year [art history, history]. But the historian pushes to `risk`: the game sells an *epistemic* fact (the record is thinner deep in time) as an *ontological* one ("era-appropriate tolerance," as if antiquity simply *contained* less datable change), quietly teaching a progressivist "antiquity was slow, modernity fast" bias. And a single recency-curve is **globally false in places**: Chinese and Islamic material is often dated tightly (reign marks, dated colophons) far "back" on the curve, while plenty of *19th-c* African/Oceanic work is datable only to a half-century — the curve misprices both.
- **Alternatives on the table:** Drive tolerance off the **work's own dating confidence** (per-object date range in the data), not its position on a global recency curve — a reign-marked Ming bowl gets tight tolerance; an undated 19th-c mask gets wide.
- **Flag:** **affirm-with-tension** — good instinct; per-object confidence would be both fairer and truer.

### B3 — Right country OR right cultural region = full credit; decays outside
No penalty for sub-country imprecision (we only know most works to country granularity).

- **Value encoded:** Being right at the level of the polity-or-region is what "knowing where" means; don't punish imprecision the data itself doesn't have.
- **Assumption:** That "country" and "cultural region" are commensurable units that can share one full-credit bucket.
- **Where it holds / where it bites:** Two lenses flag that this **quietly undercuts A3**. If "Italy" and "Roman Empire" and "Etruscan" all score full for one object, the game stops distinguishing a modern-national guess from a historically-literate one — the pedagogy ("a border is recent") is contradicted by the scoring (the border still pays full) [history]. For an app whose ethos insists the colonial state is a fiction, **rewarding "Nigeria" with full marks re-legitimizes the container A3 works to reject** [poli-sci]. The forgiveness is humane but launders anachronism as correctness.
- **Alternatives on the table:** **Tier it** — full credit for the period-correct culture/polity, high-but-not-full for the modern country, so the map-literate guess actually beats the anachronistic one; when a modern-country guess maps onto a contested historical polity, accept it but **reveal the tension** in the teaching layer ("you said Nigeria; this is a Benin Kingdom bronze — here's why that difference matters").
- **Flag:** **tension** — the generosity is humane but currently launders anachronism as correctness and undercuts A3.

### B4 — Movement/culture: exact = full, related = capped partial. Artist = a BONUS, not a gate
Hints subtract from core only.

- **Value encoded:** The *work* and its context are the core knowledge; the individual maker is enrichment — a deliberate decentering of the cult of genius.
- **Assumption:** That demoting the named genius is progressive *and harmless to the maker*; that "Anonymous" is a neutral data-absence.
- **Where it holds / where it bites:** For the canonical named artist this reads as welcome modesty [makers: Kandinsky]. But the decolonial-feminist and makers' lenses flip it: **"Anonymous" is rarely neutral — it is where erasure was *done*,** disproportionately to women and non-Western makers (guild women, nuns, weavers, the makers of "ethnographic" objects were un-named by the same institutions that lovingly individuated the male master). Making the name a *bonus* can **ratify that erasure**: the named European man is guessable-for-points; the un-named Akan or Anatolian woman structurally cannot be — so individual authorship becomes a reward only Western-canonical, mostly-male makers can dispense, and the player is never asked to *feel* the absence. The makers' woman-filed-as-Anonymous: "my erasure is your data gap… if the app renders me as blank, it repeats the archive's silence in a cleaner font." And two "Anonymous" are not the same silence: the European woman's *unrecorded* erasure vs. the Benin caster's *collective-by-design* anonymity.
- **Alternatives on the table:** Reframe artist as **"attribution," not "bonus,"** and surface *how securely* a work is attributed; **type the reason for anonymity** (unrecorded / collective-tradition / de-attributed / lost) so absence carries its history instead of hiding it; at reveal, name the erasing institution or practice.
- **Flag:** **tension** — the anti-genius instinct is defensible, but "bonus" framing plus untyped "Anonymous" re-inflicts the historical de-naming on those already unnamed.

### B5 — Forgiving by design
"A thoughtful guess beats a blank, and close still counts"; no "you left X blank" warning (deliberately).

- **Value encoded:** Learning is served better by encouragement than by punishment; a wrong-but-reasoned attempt has real epistemic value.
- **Assumption:** That players internalize "close counts" as *calibration* ("I was in the right century") rather than *permission to not think*.
- **Where it holds / where it bites:** The product/games-ethics lens affirms the humane default but notes "blank counts" + no-warning quietly optimize for **completion and return**, not learning — a player who blanks four categories and still sees a non-humiliating score is protected from the one signal (the felt gap) that drives study. The forgiveness may be doing *retention* work dressed as pedagogy.
- **Alternatives on the table:** Keep partial credit, but surface a **non-punitive calibration line at reveal** — "you skipped Medium; here's the 10-second tell" — converting the blank into a teachable moment rather than silently absorbing it.
- **Flag:** **tension** — humane default; the absence of *any* blank signal trades a learning cue for comfort.

### B6 — Difficulty is deterministic and frozen
Everyone gets the same 5 works/date/tier; served days are immutable (a gate blocks silent rewrites of the past).

- **Value encoded:** Fairness-as-identical-conditions and a shared social object (the Wordle contract); the historical record, once served, must not be silently rewritten.
- **Assumption:** That immutability is unambiguously virtuous, and that identical inputs are equitable.
- **Where it holds / where it bites:** The historian and SWE lenses **applaud the append-only, anti-memory-hole discipline** — exactly how sound archives work. Two caveats. (1) History is *revisionist by method*: dates get corrected, attributions fall, "Ottoman/Armenian" labels will themselves be revised — a hard freeze means a **known-wrong or offensive label persists in the played record** [history, SWE]; the project's own place=birthplace bug is a live example. (2) Identical inputs are *procedurally* fair but not *substantively* fair — a Western-educated player and a player from an under-covered region face systematically different difficulty on the "same" puzzle, and the frozen-daily format imports Wordle's streak/FOMO compulsion loop into a context whose stated ethos is "low-pressure" [product].
- **Alternatives on the table:** Keep days immutable but add a **first-class `correction` record type** (append-only errata: original served value preserved, corrected value shown with a dated, provenance-stamped note) allowed through the immutability gate under signoff, with a public changelog; offer an explicit **non-streak "learn" mode** (untimed, unlimited, no shared score) so teaching isn't hostage to the retention loop.
- **Flag:** **affirm** — immutability as anti-revisionism is right; add versioned errata so correction isn't blocked, only made honest, and a non-competitive mode so the loop doesn't contradict the "low-pressure" claim.

---

## C. Difficulty, Fame & the Canon

### C1 — Difficulty = recognizability (Wikipedia sitelinks + pageviews)
Explicitly *not* art-historical importance/obscurity.

- **Value encoded:** Difficulty is an empirical, reproducible property of a work's cultural footprint, not a curator's taste.
- **Assumption:** That cross-language Wikipedia coverage + pageviews is a valid proxy for **global** recognizability.
- **Where it holds / where it bites:** **The single most-flagged choice in the audit — seven of eleven lenses, converging on `risk`.** Wikipedia coverage doesn't measure human recognizability; it measures **which language communities had an editor who cared** — a function of Wikipedia's own well-documented systemic bias (editors skew Global North, male, English-first) and of *which institutions digitized, editorialized, and cross-linked their heritage*, i.e. the colonial collecting apparatus. So a Benin bronze central to Edo identity scores *harder* (more "obscure") than a minor Dutch still life — **inverting cultural centrality for a large population** [critical-data, curator-nonwestern, colonial, poli-sci]. "Global recognizability" is the launder: a Western/anglophone-canon signal renamed neutral and universal, and the numeric provenance makes the bias *feel like data rather than a choice* [product]. Two deeper mechanisms: pageviews are **endogenous to exposure** (a work accrues views only if already surfaced — so C1 measures *cumulative advantage*, not intrinsic recognizability) [critical-data]; and Wikipedia's biography gender gap means a non-Western woman maker is under-documented *twice over* and often filed under "Anonymous" [decolonial]. Gesso *naming* this bias (C2) is genuinely more than the discipline usually does — but naming it doesn't stop it governing what players see.
- **Alternatives on the table:** **Rename the surfaced axis honestly** — "documentation density" or "archive-coverage," not "global recognizability." Add a **second, independent difficulty signal decoupled from Wikipedia** — e.g. *visual*-inference difficulty (how readable the diagnostic cues are from the image), judged by the vision agent — so a non-canonical work can be "easy" without needing anglophone fame. Or **normalize sitelinks *within* culture/region** ("recognizability relative to peers of the same tradition"), breaking the single global ladder.
- **Flag:** **risk** — transparency is real; the metric's *name* overclaims and the mechanic still ranks players against a colonial archive dressed as neutral "recognizability."

### C2 / C3 — The bias is surfaced, not hidden — but the easy tier is still ~90% European
In-app: "Difficulty tracks global recognizability… 'Easy' still skews European," "the canon's bias runs deep." The easy tier is ~90% European — a known, unresolved gap.

- **Value encoded:** Transparency about a harm is itself a substantive ethical act.
- **Assumption:** That disclosure meaningfully differs from — and partly redeems — reproduction, at the level of *what users experience*.
- **Where it holds / where it bites:** This is **Finding #1 in concentrated form.** Disclosure and mitigation are different acts: the label changes what a reflective adult *thinks*; it does not change which works get served, seen, and thereby reinforced. And C1 is the sharpest **feedback loop** in the system: fame → low difficulty → Easy tier → daily exposure to every player → more downstream recognition → more sitelinks → still-lower difficulty. **Gesso becomes a small but real node in the canon-reproduction pipeline it critiques** [critical-data]. Multiple lenses warn the honesty copy can function as **moral offset / confession-as-alibi** — "a land acknowledgment that returns no land" — letting the 90%-European tier keep running with a clear conscience [decolonial, product, curator-nonwestern, colonial]. To the maker's real credit, the self-congratulatory "we name it rather than hide it" line was *already removed* (see E4) — the audit reads that as the correct instinct and the governing principle.
- **Alternatives on the table:** **Bind every disclosure to a mechanical commitment or a dated target** — e.g. an easy tier capped at a stated max-European share with a public counter tracking movement toward it; "Oceania: 27 works — target 75 by Q2, here's the harvest queue." Turn each honesty statement into **a roadmap the player can hold you to**, not a terminus.
- **Flag:** **affirm-with-tension** — genuinely rare, non-preening candor; still at risk of decorating a gap it doesn't yet close.

### C4 — The pool pulls the FAMOUS, not a representative survey
"You're seeing canon hits, not a representative survey."

- **Value encoded:** Honesty that the corpus is a canon sample, plus the pragmatic bet that famous works are the on-ramp for a broad audience.
- **Assumption:** That fame is measurable and separable from importance; that the game-frame honors the object.
- **Where it holds / where it bites:** Inherits C1's critique (fame = documentation frontier, not recognition). The makers' lens adds the object's-eye view: turning a Benin plaque made as dynastic record and devotional presence into a five-field guessing round **completes a chain — object → loot → museum vitrine → content — each step abstracting it from what it was *for*** [artists]. Bruegel's counterpoint keeps it honest: "I don't mind being guessed — I painted to delight a crowd. The question is whether every maker consented to *this* crowd."
- **Alternatives on the table:** See C1 (decouple difficulty from fame; balance tier composition) and A6 (a non-scored encounter mode for objects the guess-frame dishonors).
- **Flag:** **tension** — a defensible on-ramp bet that inherits C1's canon bias and, for sacred/looted objects, the trophy problem.

### C5 — Coverage is uneven and admitted
Oceania ~27 works, Middle East ~7; a Collections "honesty" page names the gaps and the colonial reasons ("African art reaches this site mostly through Western holding-museums… a digital reflection of how that art was physically dispersed").

- **Value encoded:** The corpus's thinness is not neutral scarcity but the digital afterlife of physical looting — and saying so is the responsible thing an aggregator can do.
- **Assumption:** That naming the extraction, and its cause, is *enough* of what an aggregator can do about it.
- **Where it holds / where it bites:** The colonial lens calls this **"the audit's model paragraph"** — it correctly identifies that the pipeline (PD images from Western holding-museums) *is* the looting re-encoded as an API. But the site then draws its African content *through those same holding-museums* — **consuming the dispersal it diagnoses.** The restitution frame asks the further question the page doesn't: does the project route *anything back*? Link to the source nation's own museum, to restitution campaigns (Benin Dialogue Group, DRC/Belgium returns), to community-held collections? If the only channel is the British Museum's or the Met's image, the honesty page **documents the wound without reaching for the sources trying to heal it** [colonial, curator-nonwestern].
- **Alternatives on the table:** For each object sourced through a Western holding-museum, add a **provenance line + link to the originating nation's collection or an active restitution effort**; preferentially source images from **source-country institutions** where available; make the honesty page a roadmap, not a plaque.
- **Flag:** **affirm-with-tension** — diagnosis is excellent; the supply chain still runs through the extractor.

---

## D. Copyright / Public-Domain Gate

### D1 / D2 / D3 — Public-domain / CC0 only; the "1900 cliff"; the silenced 20th century
US-safe rule (creator died by ~1955 and/or published pre-1930; FSA & US-government works PD regardless), fail-closed. Consequence: most modern & contemporary art is under copyright, so the corpus effectively ends near 1900 and 20th-c living/non-Western/global-south artists are structurally under-represented.

- **Value encoded:** Rights hygiene and reproducibility over comprehensiveness; a legal floor that isn't negotiable.
- **Assumption:** That US public-domain status is a **neutral, apolitical** eligibility line — a filter on *availability*, not a claim about *history*.
- **Where it holds / where it bites:** The Western curator confirms this is **exemplary, legally correct image-rights practice** — no registrar would fault it — and Kandinsky's estate notes the flip side: estates *want* control, so a gate that respects rights protects living makers too. But **every justice-oriented lens flags the same structural shadow:** PD status tracks the **Western digitization frontier and US copyright terms**, so the gate silently deletes the global-south **20th century** — the independence-era, anti-colonial, and postcolonial artists (Onabolu, the Nsukka school, the Zaria Rebels, Négritude-adjacent painters, mid-century Indian and Southeast Asian modernism) **precisely at the moment those cultures were producing art *about* throwing off empire** [colonial, curator-nonwestern, history, decolonial, artists, critical-data]. The net effect: the corpus can show a colonized people as *premodern artifact* (PD, pre-1900) but not as *modern self-authoring subject* (in-copyright) — a legal side-door that reproduces the old "modernism = the West, then history stops" periodization. Gender compounds it [decolonial]: women's large-scale entry into the *named* canon is also mostly post-1900, so the archive under-counted them before 1900 and the copyright cliff deletes their arrival after it. "A copyright frontier is a periodization" [history]. A uniform rule over a non-uniform history reproduces the history's shape.
- **Alternatives on the table:** Add a small, clearly-labelled **"licensed / by-permission" lane** for a curated set of 20th-c global-south and women makers (direct artist/estate/source-institution agreements — many grant educational use). **Actively counter-source** the PD-eligible non-default work that *does* exist (pre-1930 publications, non-US-jurisdiction PD, CC0-releasing non-Western institutions) rather than accepting the frontier's default shape. Where images are truly unavailable, admit **image-withheld data cards** (date/place/culture guessable from a described object) so the 20th c isn't temporally amputated for everyone. Add a "what the 1900 cliff erased" module naming the *specific* movements silenced, so absence is legible as loss.
- **Flag:** **tension (legally unavoidable) / risk (distributional).** The legal floor is right and honestly surfaced; its distributional shadow — freezing the non-West as ancient/ethnographic while the West gets to be modern — is a first-class design fact, not a footnote, and disclosure alone doesn't declaw it. *(Curator addendum: extend "sensitivity" review beyond copyright — a legally-PD image can still be subject to community reproduction protocols. "It's public domain" is a copyright answer, not an ethics answer.)*

---

## E. AI / Method & Honesty

### E1 — LLM as AUDITOR, not author; the safe/risky split
Vision agents image-verify each work; low-stakes fields (style, medium, notes/pins) auto-apply, high-stakes ones (title, date, place, image swaps) queue for human sign-off.

- **Value encoded:** Automation should assist, not author; machine judgment is trusted only for low-stakes fields, human judgment reserved for identity-defining facts.
- **Assumption:** That "stakes" are a property of the **field**, not the **work** — that style/medium/notes are uniformly low-stakes.
- **Where it holds / where it bites:** **The audit's second-sharpest finding — four lenses, converging on `risk`.** The split is a *values* judgment presented as an *engineering* one, and it **mislocates cultural risk**: classifying an object's **culture/style is the highest-stakes act for a source community** (misattributing "Yoruba vs. Fon," "Ottoman vs. Persian" is the classic museum harm) — yet it rides the *auto-apply* path, unsupervised [curator-nonwestern, colonial, critical-data, SWE]. Because a vision-language model's priors are the same **Western-canon-heavy corpus that produced C1's skew**, using it to auto-fill style and draft teaching notes **re-inscribes the dominant art-historical narrative as verified fact — under the reassuring authority of the word "audit"** [critical-data]. "Notes" are not low-stakes for a Benin or Aboriginal object: a confident model description of a sacred object's iconography can be culturally wrong or *disclosing* in ways no gate catches (the gate checks slurs and copyright, not epistemic authority) [colonial]. The split even **inverts the colonial risk**: it treats *facts* (date, place) as risky and *interpretation* (culture, notes) as safe — but misnaming a people is often more harmful than misdating an object [colonial]. "Safe" here means *low-effort-to-fix*, not *low-harm* [SWE].
- **Alternatives on the table:** Make the split a function of **(field × sensitivity flag)**: route *any* field on a sensitive/contested/non-Western-underrepresented work to human sign-off regardless of field type. **Reclassify culture/movement attribution as high-stakes** and human-gated; route it to source-community reviewers where possible; log model confidence + provenance-of-label on every culture field; sample-audit the auto-applied tier weekly.
- **Flag:** **risk** — the restraint is real, but the riskiest field for the app's stated values sits on the low-stakes path, and "audit" framing lends model bias the authority of verification.

### E2 — Fail-closed deterministic gate the model can't talk past
Copyright leaks, bad taxonomy, served-day rewrites all mechanically blocked.

- **Value encoded:** Values become real only when mechanically enforced — ethics-as-code, a check a model can't argue around.
- **Assumption:** That the values worth protecting are expressible as pass/fail predicates over data.
- **Where it holds / where it bites:** The SWE lens calls this **the strongest design decision in the whole dossier — and the most over-claimed.** A gate catches only what it can pattern-match: `check-language` flags a *word*, but harm in curatorial framing is usually *tone and omission* — a note can be technically clean and still frame a looted object as a trophy (A6). **The values the gate doesn't encode become invisible, because green CI reads as "ethical."** A denylist is also adversarially brittle and Anglocentric. "The gate is the ethics" over-trusts deterministic checks for judgments that are irreducibly interpretive.
- **Alternatives on the table:** Keep the gate as a **floor, not the ceiling** — pair it with periodic human editorial review of a random sample, and log a **"not-checked-by-gate" surface** so unencoded values stay visible rather than assumed-handled.
- **Flag:** **affirm-with-tension** — fail-closed for D1/B6 is genuinely excellent; treating it as *sufficient* for A7-class interpretive judgments is the trap.

### E3 — Teaching notes are AI-drafted, human-audited
Image-grounded, not hand-written per work; coverage reported honestly.

- **Value encoded:** Interpretive text can be model-drafted then curator-verified without loss.
- **Assumption:** That authorship of interpretation splits cleanly into draft (machine) + sign-off (human).
- **Where it holds / where it bites:** In museum practice **the label is not a neutral fact-container — it is *interpretation*, and its authorship is accountable** (labels are increasingly signed). "Human-audited" verifies against *error* but does not confer *authorship* or *voice*: a checked draft still encodes the model's canon-weighted priors about **what is worth noticing** in an object — the "over-documents the Western canon" bias re-entering through the *interpretive* layer, not the selection layer. **Audit catches "wrong," not "whose gaze"** [curator-western]. The makers' Hokusai: "someone will read, in confident prose, 'what to look for' in my line — from a model trained on centuries of (often Western, often wrong) writing about me… sign-off catches errors of fact, rarely errors of *frame*." When the record is thin, the model *fills* — defaulting to the dominant story, the one that erased the unnamed woman.
- **Alternatives on the table:** **Mark model-drafted notes visibly as such** at point of display and **name the human auditor**; spot-audit for *framing/gaze* bias, not just factual error; route any note *about* a contested or non-Western object through a named human/community reviewer.
- **Flag:** **tension → risk** — auditing controls facts, not tone; the AI narrator quietly homogenizes many makers' voices into one museum-label register, and canon bias re-enters via the label voice.

### E4 — Radical transparency as an ethos
README and in-app copy foreground the biases, gaps, tradeoffs, and AI's role; earlier self-congratulatory prose ("We name it rather than hide it") was deliberately **removed** — honesty without preening.

- **Value encoded:** The audience is trusted with the machinery's flaws; disclosure over polish.
- **Where it holds / where it bites:** Affirmed across the board as genuine and rare — *and* it's the exact surface where **Finding #1** lives: the audit's recurring warning is that transparency without a coupled intervention can **launder reproduction as critique**. The removal of the self-congratulatory line is read by multiple lenses as the maker **already sensing this trap** — and as the governing principle going forward: honesty copy earns its keep only when paired with a mechanic change or a dated remediation.
- **Alternatives on the table:** Treat every disclosure as a **promissory note with a date and a counter**, not a terminus (see C2, C5).
- **Flag:** **affirm** — with the standing caution that disclosure is the *start* of the obligation, not the discharge of it.

---

## F. Product & Access

### F1 — No-build vanilla JS, no framework
Inspectable, durable, dependency-light; the deployed artifact IS the source.

- **Value encoded:** Source == deploy; transparency and longevity over developer convenience.
- **Where it holds / where it bites:** The SWE lens **affirms** this as values-aligned and audit-cost-lowering — with the cost that no build means **no type checker on the client path** (project memory already records runtime `ReferenceError`s that syntax checks miss and a stubbed-DOM load harness built to compensate). That harness is now load-bearing but informal.
- **Alternatives on the table:** Treat the **load-harness as a required gate**, not an ad-hoc script.
- **Flag:** **affirm** — with the load-harness formalized into the gate.

### F2 — Leaderboard trusts client-submitted scores (today)
Raw guesses stored for later authoritative re-scoring ("Phase 4"); framed as social nudge, not high-stakes ranking.

- **Value encoded:** Low-stakes social play doesn't warrant anti-cheat engineering; trust the player now, re-score authoritatively later.
- **Assumption:** That the leaderboard is genuinely low-stakes, and that the persisted payload is the **raw guess vector**, not a client-computed score.
- **Where it holds / where it bites:** Two lenses flag `risk`. **A leaderboard is by definition a status object — "low-stakes" is aspirational, not structural** — and trusting the client means a spoofable ranking that quietly punishes the honest player, contradicting the fail-closed ethos everywhere else [product, SWE]. The SWE lens names the load-bearing dependency: **the "Phase 4 re-score" promise is only real if what's persisted is the raw guess + server timestamp, not a client-computed score** — otherwise "later" never comes and the trust is permanent.
- **Alternatives on the table:** Since the scoring model (B1) is deterministic constants, **server-authoritative scoring is cheap now** — ship it and skip the client-trust window; or until then, show **personal stats + a share-card** (the Wordle pattern) and no cross-player ranking. *Verification action:* confirm the persisted payload is the guess vector, server-timestamped.
- **Flag:** **risk** — acceptable only if raw inputs are stored server-side; a spoofable public ranking is an attack surface on the game's own credibility.

### F3 — Free, daily, low-pressure, teaching-first
The reveal/teaching is the payoff, not the score; colorblind mode + reduce-motion exist.

- **Value encoded:** The score is scaffolding; the actual product is the "what to look for" reveal.
- **Assumption:** That players who came for a guessing game stay for the lesson — that the reveal is experienced as reward, not homework.
- **Where it holds / where it bites:** The a11y work (colorblind, reduce-motion) is **unambiguously affirmed** as real access work. But the product lens notes the stated hierarchy (teaching > score) is in **tension with the engagement mechanics actually shipped**: if the score is truly secondary, why a leaderboard (F2) and a frozen streak-shaped daily (B6)? And nothing in the design suggests the reveal's *efficacy* is instrumented — genuine teaching-first design would measure "did they read the reveal," not "did they return."
- **Alternatives on the table:** **Instrument the reveal** (dwell, expand-taps) and make *that* the north-star metric, explicitly de-emphasizing DAU/streak — align the measured incentive with the stated value. (This dovetails with the metrics plan in [`metrics.md`](metrics.md).)
- **Flag:** **tension** — the right stated priority, not yet backed by the metrics or the surrounding mechanics.

### F4 — Built by one person + AI + a designer
Attribution is explicit ("Built by Kat Swint with a little help from Claude Code and Codex · Design by Briana Das").

- **Value encoded:** Honest authorship; a small, legible team.
- **Assumption:** That the maintainer's encoded taxonomy (A5 vocabulary, the E1 safe/risky split, the gate rules) is reproducible and survivable.
- **Where it holds / where it bites:** The SWE lens calls single-maintainer **the deepest systemic risk in the whole audit.** Every value in sections A–E is instantiated as a rule authored and understood by one person; the gates encode *her* judgment calls and the LLM enforces *her* taxonomy. Harvest-drift compounds it (Wikidata/Commons change upstream — project memory documents copyright leaks and P186 junk from prior harvests). **If the maintainer steps away, the gates keep running but nobody can *revise* the values they encode — freezing a 2026 curatorial worldview indefinitely.**
- **Alternatives on the table:** **Externalize the taxonomy and safe/risky policy into versioned, commented config** with a written rationale doc; **pin harvest source snapshots**; add a **"why this rule exists" note to each gate** so the values are legible — and revisable — by a successor.
- **Flag:** **risk** — the gates outlive the judgment that made them defensible; make the judgment legible.

---

## Cross-cutting patterns

Reading the eleven lenses together, five patterns recur across otherwise unrelated choices. These are the real findings — the per-choice entries are where they surface.

**1. Disclosure is not discharge.** *(C1/C2/C3, C5, D1–D3, A6, E4 — named by nearly every lens.)* Gesso names its biases with candor almost no peer matches — and every justice-oriented lens warns that **naming a harm can be mistaken for fixing it**, even function as an alibi ("a land acknowledgment that returns no land"). The maker already acted on this instinct once (removing the self-congratulatory E4 line). The governing principle the audit endorses: **every disclosure should be a promissory note — a mechanic change, a dated target, or a counter the player can hold you to — not a terminus.**

**2. Each fix installs a subtler frame.** *(A2, A3, B3, B4 — history, poli-sci, decolonial, curator-nonwestern.)* Gesso's instincts are unusually good, and the recurring failure mode is that each correction re-encodes the thing it opposes one level up: anti-border scoring → **empire-as-region** (Armenian work credited to "Ottoman"); anti-genius scoring → **re-erasing the already-unnamed** (women/collective makers whose whole injury was being un-named); anti-national labels → still resolved on a **modern-map substrate**. The fixes are *enrichments away* from working (period-stamp regions, credit the finer culture too, type the reason for anonymity) — not reversals.

**3. The mechanic carries the ontology upstream of the labels.** *(A1, A3, B1, B3, the map-pin — poli-sci, history, decolonial, curator-nonwestern, critical-data.)* The most careful taxonomy in the world still sits on a **pin-on-a-modern-map** that presumes every object has one locatable earthly origin and that "where" is a *territory* — a Westphalian epistemology imposed on objects from relational, ancestral, ceremonial, diasporic, or trade-network worlds. The label layer is thoughtful; the *substrate* is unexamined. The strongest version of the app would let some objects answer "where" with a **people, a route, or a relationship — or refuse the question**.

**4. "AI-as-auditor" can re-import the canon bias under the authority of "audit."** *(A5, C1, E1, E3 — critical-data, SWE, curator-nonwestern, colonial.)* The vision model's priors are the same Western-canon corpus that produces the difficulty skew; letting it **auto-assign culture/style and draft teaching notes** re-inscribes the dominant narrative as *verified fact*. The safe/risky split mislocates the risk — **culture is the highest-stakes field for a source community and it's on the auto-apply path.** The gate (E2) is a floor that gets over-trusted as the ceiling; it catches words, not gaze.

**5. The values live in one person's gates.** *(F1, F4, A5, E2 — SWE.)* The conscience of the app is a set of rules one maintainer authored and understands. That's what makes it coherent — and what makes it fragile and unrevisable if she steps away. **Externalize and annotate the judgment**, don't just run it.

---

## Where the app is strongest

So the register isn't only a list of tensions — the audit was as clear about what's *right*:

- **Ethics in the mechanic, not the copy.** Excluding human remains from the guessing rotation (A6) is the single most-praised choice — *ethics enforced by the machine, not asserted in a caption.* It's the model the rest of the app should follow.
- **The fail-closed gate (E2)** for copyright and served-day immutability is "the strongest design decision in the dossier" — as a floor.
- **The parity rule (A3)** — giving the West the same soft, generous historical geography the corpus already gives the non-West — is honest anti-Eurocentrism almost no comparable artifact attempts.
- **Naming the biases at all (C2, C5, D2, E4)** is, by repeated acknowledgment, "genuinely better than the field" — the raw material that makes remediation possible.
- **Place-of-making over holding-museum (A1)** and **hand-tuned, authored constants over laundered learned weights (B1)** are the right calls on their axes.

The makers' closing composite voice sums the whole audit: *"Gesso's makers would mostly rather be here — taught and looked-at — than absent. The affirmations are real. The risks cluster where the record was already unjust: the unnamed woman, the taken bronze, the muted 20th-century global-south maker. There, the app's honest confession of bias is not yet the same as repair."*

---

## The decisions this register surfaces (for later)

Recorded here so the choices are actionable, not just documented. None are made yet; each corresponds to a flagged entry above.

| # | Decision | Choices | Lowest-lift first step |
|---|----------|---------|------------------------|
| 1 | Rename "global recognizability" → "documentation density"/"archive-coverage" | C1 | Copy change; highest honesty-per-byte |
| 2 | Add a second, non-Wikipedia difficulty signal (visual-inference) so non-canon works can be "easy" | C1, C3 | Reuse the vision agent already in the pipeline |
| 3 | Tier B3 so the period-correct culture beats the modern-country guess | B3, A3 | Scoring constant + reveal copy |
| 4 | Move culture/style attribution off the E1 auto-apply path onto human sign-off | E1, A5 | Change the safe/risky field list |
| 5 | Extend `sensitive` beyond `remains` to a `restricted`/`ceremonial` class → non-scored "witness" mode | A6, C4 | New flag + a no-score reveal path |
| 6 | Add an append-only `correction` errata layer through the immutability gate | B6 | New record type; unblocks fixing known-wrong served days |
| 7 | Type the reason for "Anonymous" (unrecorded / collective / de-attributed / lost) | B4 | Data field + reveal copy |
| 8 | Store composite medium ("oil on panel") even while scoring the simplified class | A4 | Stop discarding the support string |
| 9 | Store provenance sub-fields (find-site / how-it-got-there) surfaced at reveal | A1, C5 | Non-scored fields; ties into restitution links |
| 10 | Pair every honesty statement with a dated target + public counter | C2, C5, E4 | Turn the honesty page into a roadmap |
| 11 | Route contested-object images toward source-country institutions + restitution links | C5, A6 | Provenance line per holding-museum object |
| 12 | Server-authoritative scoring (or verify raw guess vectors are stored) | F2 | Confirm the persisted payload first |
| 13 | Externalize the taxonomy + safe/risky policy into versioned, annotated config | F4, A5, E2 | "Why this rule exists" note per gate |
| 14 | A licensed/by-permission lane for a curated set of 20th-c global-south + women makers | D1–D3 | Even a handful breaks the "1900 = history stops" frame |

---

*Register compiled 2026-08-10 from an eleven-lens expert audit. It is a snapshot of a moving target — as choices change, this file should change with them. Related: [`case-study-honesty-pass.md`](case-study-honesty-pass.md) (the copyright-shaped-canon story), [`metrics.md`](metrics.md) (instrumenting the teaching-first claim in F3), [`icp.md`](icp.md), [`monetization.md`](monetization.md).*
