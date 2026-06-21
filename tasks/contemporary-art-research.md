# Adding Modern & Contemporary Art to Gesso — Legal Options Report

*Prepared 2026-06. Not legal advice; consult an IP attorney before launching with copyrighted-art exposure.*

## TL;DR — Prioritized Recommendation

For an indie educational game with a small budget, in priority order:

1. **Harvest the rolling public domain aggressively (free, zero risk).** US works published before 1931 are PD now; a new year's cohort frees every Jan 1 (1930 works now, 1931 in 2027). This already covers a surprising amount of early modernism — Mondrian, Klee, van Doesburg, Orozco, early Picasso, Dalí's *Persistence of Memory* (1931 → free 2027). Build a pipeline keyed to **first-publication year + 95**.
2. **Pull modern slivers from open-access museum APIs and Wikimedia/Wikidata (free).** Best modern coverage: Art Institute of Chicago (server-side PD filter + IIIF), Cleveland, SMK Denmark, LoC WPA posters, Smithsonian. Enumerate via Wikidata SPARQL (creator death ≤1955 AND inception <1931 AND has image).
3. **For still-copyrighted blue-chip works (Warhol, Pollock, Basquiat, Kahlo, late Picasso/Matisse): use low-res educational thumbnails under a fair-use rationale, OR link-out / IIIF embed.** Fair use is reasonably strong for small low-res "identification" thumbnails; the practical risk is occasional DMCA takedowns, not lawsuits. Apply Wikipedia's non-free-content discipline.
4. **Treat formal licensing (ARS/DACS/Bridgeman) as a last resort.** It is effectively infeasible at scale for an indie budget and blue-chip estates often decline game uses outright.

---

## 1. Fair Use / Fair Dealing (US)

### The four factors applied to thumbnails
17 U.S.C. § 107: (1) purpose/character (transformative? commercial?); (2) nature of the work; (3) amount used; (4) market effect.

**Kelly v. Arriba Soft, 336 F.3d 811 (9th Cir. 2003)** — Low-res thumbnails in an image search engine were fair use: "significantly transformative" because they served a *different purpose* (indexing/access) than the original aesthetic photos. Low resolution prevented market substitution (factor 4). 
- https://www.copyright.gov/fair-use/summaries/kelly-arriba-9thcir2003.pdf

**Perfect 10 v. Amazon/Google, 508 F.3d 1146 (9th Cir. 2007)** — Strengthened Kelly. Google thumbnails "highly transformative" — a thumbnail "transforms the image into a pointer directing a user to a source of information." Market harm cannot be presumed for highly transformative use. 
- https://www.copyright.gov/fair-use/summaries/perfect10-amazon-9thcir2007.pdf

**Takeaway:** Small low-res images used for a *new functional purpose* (referencing / identification / testing recognition) — not aesthetic display — are strongly favored. A quiz that tests recognition of a work maps onto this "different purpose" logic.

### Warhol Foundation v. Goldsmith, 598 U.S. 508 (2023) — the narrowing
The Court (7–2) held Warhol's commercial licensing of "Orange Prince" (from Goldsmith's photo) to a magazine was NOT fair use. Key holding: **new meaning/message alone is not enough**; factor 1 turns on whether the use has a *different purpose/character*, weighed against commerciality and **competition with the original's market**. Because both served the same purpose (magazine portrait of Prince) and competed in the same licensing market, factor 1 favored Goldsmith. 
- https://supreme.justia.com/cases/federal/us/598/21-869/

**What it means for Gesso:** "I shrank it / restyled it" is not a shield. The defensible position is *purpose + non-competition*: the thumbnail is used to **teach/identify** the work (different purpose) and does **not** compete in the art-licensing market (no prints, no merch, no high-res downloads). Warhol does NOT disturb Kelly/Perfect 10's thumbnail logic, which rests on functional purpose + low-res non-substitution.

### Wikipedia non-free content criteria (the de-facto safe playbook)
Wikipedia allows copyrighted images only if ALL 10 NFCC are met — a conservative compliance template:
- **No free equivalent** (true for in-copyright modern art).
- **Minimal use:** one image per subject; **low resolution** preferred — guidance: **≤ ~100,000 pixels (~0.1 MP), roughly ≤400px on the long edge**.
- **Contextual significance** (must materially aid understanding).
- **Separate written fair-use rationale per use** (source, holder, purpose).
- https://en.wikipedia.org/wiki/Wikipedia:Non-free_content_criteria
- https://en.wikipedia.org/wiki/Wikipedia:Non-free_content/Definition_of_%22low_resolution%22

### Real-world risk
- **DMCA takedown, not litigation, is the realistic worst case** if hosted on a DMCA-safe-harbor platform (Vercel) with a prompt takedown process. *Lenz v. Universal* requires senders to consider fair use first.
- **Statutory damages/attorney's fees** generally require pre-infringement registration; many photographers/estates haven't registered, leaving only (negligible) actual damages for a tiny non-commercial game.
- **ARS/VAGA/estates** are aggressive on *commercial* licensing (merch, ads, books) but typically send licensing demands/takedowns for small online uses rather than sue.
- Risk scales with: how commercial the game looks, image resolution/downloadability, and direct competition with licensing markets.

**Risk-reduction checklist:** favor PD; keep thumbnails genuinely small (≤~100k px), non-downloadable; keep purpose clearly educational/identificatory; no merch/prints/high-res; minimize ads/paywalls; host with DMCA safe harbor + takedown contact; keep per-image fair-use rationales.

---

## 2. Licensing Avenues — feasibility for an indie budget: LOW

| Org | Covers | Cost (rough) | Indie tier? | Verdict |
|---|---|---|---|---|
| **Artists Rights Society (ARS)** US | Picasso, Matisse, Warhol Fdn, Miró, Chagall, 100k+ | Quote-only; ~$50–150 low end, $300–$1,000+/image blue-chip; short-term, territory-limited | None | Out of reach at scale; marquee names often declined for games |
| **DACS** (UK) | Same artists, UK territory | Bespoke quote; free tier only for academic journals | No (games don't qualify) | Not viable |
| **VG Bild-Kunst** (DE) | Same, Germany/EU | Publishes tariffs: internet ~12% of revenue, **min ~€10/work** + VAT; also clear photographer | Cheapest published rates | Borderline for a *few* works only |
| **Bridgeman Images** | Bundles repro + copyright fee; real in-copyright catalog (Picasso, Dalí, Bacon, Mondrian) | PD self-serve ~£20–50; in-copyright quote-only, low-hundreds+, time-limited | "Bridgeman Education" sub ≠ republication rights | Right model, hostile cost |
| **Artstor/JSTOR (ITHAKA)** | ~2.5M cleared images | Institutional sub | — | **DO NOT USE** — terms ban embedding in public/open websites + commercial use |

- ARS requests: https://arsny.com/licensing-requests/
- A modest 30–50 copyrighted works could run thousands–tens of thousands with renewals + multi-territory admin. Picasso/Warhol-tier estates frequently decline game uses. **Skip as primary strategy.**

---

## 3. CC-Licensed / Open-Access Modern Art That DOES Exist

**Reality:** Every major museum open program gates *free images* on actual PD status, not department. 20th/21st-c works are largely absent. A modern open pool exists via (a) artists dead ~70+ yrs, (b) US-government/WPA PD works, (c) a few self-publishing living artists.

**US-safe rule for a modern work:** artist died ≤1955 AND first published before 1931 → PD in EU/UK/Russia *and* US, no URAA risk.

### Open-access APIs (best modern slivers in **bold**)
- **Art Institute of Chicago** — CC0; server-side `is_public_domain=true`; IIIF; some post-1920 PD works (best US sliver). `api.artic.edu/api/v1`
- **Cleveland Museum of Art** — CC0; IIIF; bulk on GitHub. `openaccess-api.clevelandart.org`
- **SMK Denmark** — Public Domain Mark per work; ~39,480 PD works incl. early-20th-c European; IIIF. `api.smk.dk`
- **Met** — CC0 images where `isPublicDomain`; Dept 11 (Modern/Contemporary) mostly excluded. `collectionapi.metmuseum.org`
- **Smithsonian Open Access** — CC0; Hirshhorn only a few hundred CC0. `api.si.edu/openaccess`
- **NGA**, **Getty** (little modern), **Rijksmuseum** (open set stops ~late 19th c — explicitly no modern), **Finnish National Gallery** (most 20th-c blocked by Kuvasto).
- **MoMA** — metadata only CC0 (~130k); images of in-copyright works NOT open. github.com/MuseumofModernArt/collection

### Wikimedia Commons / Wikidata (best route for famous modern PD art)
- Tags: `{{PD-old-70}}`, `{{PD-US-expired}}`, `{{PD-Art}}` (faithful 2D repro is PD per *Bridgeman v. Corel*).
- **Wikidata SPARQL** (`query.wikidata.org/sparql`, CORS-enabled): paintings where creator death `P570` ≤ 1955 AND inception `P571` < 1931 AND has image `P18`. Resolve via `Special:FilePath`; verify Commons `extmetadata` license.

### Living/self-publishing CC artists (truly contemporary)
- **David Revoy** (*Pepper&Carrot*, CC BY 4.0), **Nina Paley** (*Sita Sings the Blues*, CC0). No blue-chip estate releases catalogs under CC.

### US Government / WPA-era PD American art (no URAA risk)
- **17 USC 105**: federal works PD. **LoC WPA Poster Collection** (~900, loc.gov, JSON via `?fo=json`). NARA RG 69. Smithsonian Archives of American Art (CC0). (WPA/FAP per-item verify — relief workers, not regular federal employees.)

### Already-free famous moderns (life+70 countries; restrict to pre-1931 works for US safety)
Klimt (d.1918), Schiele (d.1918), Modigliani (d.1920), Klee (d.1940), Kandinsky (d.1944), Mondrian (d.1944), Munch (d.1944, *The Scream*), Bonnard (d.1947), Beckmann (d.1950), Matisse (d.1954 — catalog PD in EU 2025). **2026 new life+70 cohort (died 1955):** Léger, Tanguy, Utrillo.

---

## 4. Workarounds for Copyrighted Works

- **Link-out (safest):** a hyperlink to a museum/Wikipedia page is not a display or copy — no infringement. Recommended default for in-copyright works.
- **Hotlinking/embedding raw images — risky.** *Goldman v. Breitbart* (S.D.N.Y. 2018) rejected the "server test"; embedding can violate the display right even if the file stays on another server. Circuit split (9th Cir. server test still stands). Avoid raw-JPEG hotlinking nationwide.
- **IIIF viewers with rights metadata — the strongest legitimate embed.** Load the museum's published manifest (Mirador/Universal Viewer); honor the `rights` URI and `requiredStatement` attribution. Reuse is OK only if the rights value permits it (e.g. `InC-EDU`); a plain "In Copyright" grants only viewing.
- **rightsstatements.org:** 12 standardized labels. Most relevant: **`InC-EDU` (In Copyright – Educational Use Permitted)**, `InC-NC`, `NoC-US`, `NKC`. These are status labels, not licenses — use CC for actual licensing.
  - https://iiif.io/api/cookbook/recipe/0008-rights/ ; https://rightsstatements.org/vocab/1.0/

---

## 5. The Rolling Public Domain (publication + 95)

US works published before 1978 get a 95-year term expiring Jan 1 after year 95. Formula: **publication year + 96 = the year it becomes free.**
- 1929 → PD 2025; **1930 → 2026**; **1931 → 2027**; 1932 → 2028; 1933 → 2029; 1934 → 2030.
- Duke CSPD: https://web.law.duke.edu/cspd/publicdomainday/2026/

**2026 cohort (1930 works), Duke-confirmed:** Mondrian *Composition in Red, Blue and Yellow*; Klee *Tierfreundschaft*; van Doesburg *Simultaneous Counter-Composition*; Taeuber-Arp; Orozco *Prometheus*; Grant Wood *American Gothic* (1930); Steichen Vogue photos.

**2027 (1931 works) candidates to add:** Dalí *The Persistence of Memory* (1931 → 2027); early-1930s Picasso, Matisse, Magritte, Kandinsky, Hopper — **verify each work's first-publication date individually.**

**Critical caveat:** keyed to *publication year, not death*. Picasso (d.1973) and Matisse (d.1954) become US-free **work-by-work** as each year clears 95 — their full catalogs are NOT free. Life+70 governs non-US countries and unpublished works only; for a US audience rely on publication+95. Watch the **URAA trap** (*Golan v. Holder*): a foreign work PD in Europe can still be US-copyrighted if protected in its source country on Jan 1 1996 — safe condition: first published before 1931.

---

## Recommended Implementation for Gesso

1. **Add a "publication + 95" rolling pipeline.** Annually (Jan 1) enumerate the newly-free cohort via Wikidata SPARQL (inception year = current−96, has image), verify first-publication dates, add to the static pool. This grows the modern era legally and for free every year.
2. **Mine AIC + Cleveland + SMK + Wikidata** now for the existing early-modern PD pool (Mondrian, Klee, Kandinsky, Munch, Léger, etc.) — restrict foreign works to pre-1931 publication for US safety.
3. **For blue-chip in-copyright works (Warhol/Pollock/Kahlo/Basquiat):** either (a) include only as **low-res ≤~100k-px non-downloadable thumbnails with a Wikipedia-style per-work fair-use rationale**, framed as recognition/identification, no merch/high-res; or (b) **link-out / IIIF-embed** honoring `InC-EDU` rights. Keep a takedown contact and respond to DMCA notices.
4. **Do not** build on Artstor/JSTOR or pay licensing orgs at scale.
5. Before public launch with copyrighted thumbnails, get a short IP-attorney review.
