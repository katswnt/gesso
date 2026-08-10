# Gesso — Tier 2 plan (batched from the ethos audit + 6 research proposals)

Sequenced by lift. Sources: [`ethos.md`](ethos.md), and the research proposals in `/tmp/prop-{a6,b1,a2a3,c3,d,collections}.md`. Tier 1 (C1 rename, B4 "optional", B5 calibration, F1 harness) already shipped to `main`.

---

## Batch A — Verified bug + compliance fixes (one data pass → gate → commit)

Do these together in a single data pass; run `node tests/dom-harness.mjs` then `node scripts/check-pool.mjs` as its own step; commit only on ✅ PASS.

### A-bugs (verified this session)
1. **Fame generator zeroes proper-noun canon icons.** `scripts/make-fame-js.mjs` line 34 (short bare-noun guard) doesn't exempt `p.canon`, wiping the +2000 boost. **Rosetta Stone, Terracotta Army, Capitoline Wolf** all sit at fame **0**.
   → Add `&& !p.canon` to **line 34 only**; regenerate `data/fame.js`. Leave line 30 (generic-title guard) alone.
   → **Data question, don't auto-fix:** a work titled just **"Mask"** is `canon:true` and correctly zeroed by line 30 — why is it canon? Inspect + retitle or un-canon.
2. **Polynesian deity mis-located.** `met313658` "'Otua fefine" — `place:"Polynesia"`, coord `[-17.7,-149.4]` (**Tahiti**), but it's **Ha'apai Islands (Tonga)**. Pin ~1,600 km off, wrong country.
   → `place → "Tonga (Ha'apai Islands)"`, coord `→ ~[-19.8,-174.4]`.
3. **Mask of Tutankhamun near-zero fame** (`wd:Q9048095`, fame 58.5, not canon). Consistent with a wrong Wikidata entity (should be **Q424855**).
   → (a) add `canon:true` now; (b) verify + correct the entity in a networked pass.
4. **place = artist's birthplace ×3.** `audit-local` flags 3 (count verified; the known place-birthplace class in project memory).
   → Enumerate the 3, correct place/coord to where-made.

### A-canon (enhancements riding the same pass)
5. Add `canon:true` to **Great Buddha of Kamakura** (fame 755→Easy), **Moai** (34), **Aztec Sun Stone** (58) — all correct coords, just under-famed. Raises non-European Easy share at zero identifiability cost.

### A-compliance (potential copyright-gate gap — HIGH priority, flagged by the D research)
6. **URAA gap.** The D1 rule "creator died by ~1955" is **only reliable for US artists.** The URAA (1996) restored US copyright on many *foreign* works published after ~1928 even when the author died long ago. Real cases: **Amrita Sher-Gil** (d.1941) is URAA-restored (NOT PD in US); **Xu Beihong** confirmed not-PD via Met API; the "Frida Kahlo → PD 2025" claim is **false for the US**.
   → **Audit the pool** for works admitted on the *death-date* arm with a **foreign author + post-1928 publication** → these are potential URAA-restored leaks. Add a `check-pool` guard so the death-date arm can't admit foreign post-1928 works without a publication-date PD basis. (Mirrors the existing fail-closed copyright posture — see [[gesso-project]] audit-copyright.)

---

## Batch B — Structural changes (sequenced by lift)

### B1. Place-NA — surgical, ~8 works *(prop-b1)*
The paradigm case (Aboriginal) isn't in the pool. Real candidates: **6 African works the museum itself pinned only to a continent**, 2 Native N. American (`place:"North America (Indigenous)"`), and the Polynesian one (fixed in Batch A). Add a `placeNA` flag (reuse the existing medium-NA / artist-NA mechanism) that drops the place axis + redistributes, with a reveal line. Detection: `style==="Native North America"` or an allowlist of continent-only African place strings.

### B2. Confidence-based date tolerance *(ethos B2 — design settled with Kat)*
Keep the current recency-curve as the **player-discriminability** model (its real justification), drop the ontological "era-appropriate" copy, and add an **object-datability floor**: tolerance = `max(playerReach(era), objectRange)` — never demand more precision than either a non-specialist could have *or* the object's own dated range supports. First step: audit how many works carry a real date range vs. a single year.

### B3. Tier the place credit *(ethos B3)*
Period-correct culture/polity = full; right modern country only = ~0.8 + a reveal line ("you said Nigeria; this is Benin Kingdom — here's why"). Stops full-credit anachronism from undercutting A3.

### A2/A3. Non-Western taxonomy *(prop-a2a3)*
- **A2:** elevate ~25 non-Western schools to first-class "movement" type (Kanō, Rinpa, Wu/Zhe school, Pahari, Deccani, Ife naturalism, Cretan school…). ~half ready now; rest carry caveats (Rajput bundles workshops; "Company painting" is a colonial term). Already covered: ukiyo-e, Mughal, Safavid, Timurid, Benin, Iznik.
- **A3:** all 8 super-regions are European. **Add Ottoman + Han/Imperial China** super-regions; **split Ukrainian / Georgian / Armenian out of "Russian/Soviet"** (the sharpest erasure); add Al-Andalus/Sephardic to Iberia, Czech/Hungarian/Polish to Austro-Hungarian, Irish/Scottish/Welsh to British Isles. Implement dual-credit: naming *either* the empire *or* the subsumed culture = full.

### A6 + E1. Sensitivity enum + AI-split fix *(prop-a6)*
Extend `sensitive` beyond `remains` to a real enum (funerary, secret-sacred/initiation-restricted, ceremonial-regalia-in-use, active-restitution, image-restricted) anchored to ICOM / AIATSIS / NAGPRA / Local Contexts TK Labels — each with a handling rule (exclude+witness-mode / keep+provenance-note / don't-display). Detection flags candidates for **human review, never auto-apply**. Then wire **E1** (the deferred Tier 1 item): route culture/style/notes to the human queue for any `sensitive`/contested work in `curate-merge.mjs`.

### C1. Second difficulty signal *(next-vision-pass.md)*
Add `visDiff` (visual-inference difficulty) during the next image pass; blend with documentation-density so a non-canon work can be Easy without anglophone fame. Parked in [`next-vision-pass.md`](next-vision-pass.md).

### D. Break the 1900 cliff — PD-now harvest + licensed lane *(prop-d)*
**Actionable PD-NOW wins (no permission needed):** Raja Ravi Varma (d.1906, oleographs everywhere), Henry Ossawa Tanner (d.1937, CC0 Smithsonian/Met), Edmonia Lewis (d.1907, CC0), Osman Hamdi Bey (d.1910), Olowe of Ise (Yoruba d.1938, AIC CC0 — the only named in-period sub-Saharan African artist), Mahmoud Mokhtar (pre-1930 only). **CC0 seams:** Japanese women painters (Ike Gyokuran, Kiyohara Yukinobu, Uemura Shōen), Chinese ink masters at Freer (Qi Baishi, Huang Binhong), Indonesian at Rijksmuseum (Raden Saleh, Kassian Céphas), Cassatt & Morisot. Easiest harvest path: AIC faceted keyless API (`?place_ids=Japan&is_public_domain=1`). **Do NOT** chase Sher-Gil / Kahlo / the Progressives — URAA-locked (see A-compliance). This is also the real lever for Task #45 (diversify Easy).

### Collections decolonial section *(prop-collections)*
Drop the drafted ~220-word first-person section into the Collections page (names Sarr-Savoy, Hicks, Mignolo, Local Contexts TK Labels, Nochlin, each tied to a real Gesso choice; ends by turning the lens on Gesso itself). Ready to paste. Add a "further reading" list.

---

## Suggested order
1. **Batch A** (bugs + URAA compliance) — highest value, lowest lift, one pass.
2. **Collections section** + **B1 place-NA** — small, self-contained, visible.
3. **A6 enum → E1 wiring** — unblocks the deferred Tier 1 item; needs Kat's ruling on the `restricted` classes (judgment call).
4. **D PD-now harvest** — concrete cliff-break + Easy diversification; reuses the proven harvest→audit-copyright→promote→vision flow.
5. **A2/A3 taxonomy**, **B2 date tolerance**, **B3 tiered place** — larger, need Kat's sign-off on the accept-lists / school vocabulary.

Judgment calls still needing Kat (from ethos.md): A6 restricted classes, C3 easy-tier composition rule, A7 which flagged titles are colonial captions (29-candidate list generated), B1 which get placeNA, A2 school vocabulary, A3 finer-culture accept-lists, D licensed-lane shortlist.
