# Gesso Pool Coverage Gaps

READ-ONLY analysis of `data/pool.js` (5,618 works). Goal: find areas underrepresented relative to a balanced, encyclopedic art-history game, like the already-known Renaissance-sculpture gap.

## Methodology

Loaded `data/pool.js` in node and profiled counts across region, era buckets, medium families (raw `medium` mapped to Oil/Tempera/Fresco/Drawing/Print/Bronze/Marble/Stone/Wood/Ceramic/Glass/Textile/Photograph/etc.), style/movement, culture (`styleKind`), and country (`place`), plus the key intersections region×era, medium×era, region×medium. Compared the resulting distribution against (a) the Met's department structure and (b) the Gardner's/Janson's survey spine. "Thin" = small count relative to art-historical weight, not relative to other buckets.

## Headline distribution

- **Region**: Europe 2,995 (53%), Asia 1,338, North America 747, Africa 450, South America 81, **Oceania 7**.
- **Era**: 19c 1,314, Renaissance 1,164, Early-20c 796, 17c 745, 18c 405, Medieval 1000-1400 319, Ancient 562 (combined), Early Medieval 173, post-1945 only 35.
- **Medium**: Oil dominates at 2,376 (42%). 3D/decorative is comparatively thin everywhere outside ancient/non-Western departments.
- **Over-represented**: European Oil painting, especially 17c Dutch/Baroque and 19c France — 2,016 European oils vs ~183 European sculptures across all eras. European oils alone are 36% of the entire game.

## Confirmed: the Renaissance-sculpture gap holds
Europe 1400-1600: **621 paintings + 127 tempera/fresco vs only 68 3D works** (3D = bronze/marble/stone/wood/ivory/ceramic). 17c is even more lopsided: 513 paintings vs 23 sculptures. Donatello/Verrocchio/Michelangelo-era sculpture, Bernini, and the entire decorative-arts wing are nearly absent.

## Ranked gaps

| # | Gap | Current | Why it matters | Concrete harvest source | Target |
|---|-----|---------|----------------|-------------------------|--------|
| 1 | **Oceania** (Pacific: Māori, Polynesia, Melanesia, Aboriginal Australia, PNG) | **7** | An entire Met department + Janson chapter at ~0. No coverage of a whole human art tradition. | Met Open Access API (`metmuseum.github.io`) dept "Arts of Africa, Oceania, and the Americas", search Oceania/Maori/Asmat/Sepik; also Cleveland & British Museum (Q-codes via Wikidata `P195` museum). | 80-120 |
| 2 | **European sculpture & decorative arts, 1400-1700** | ~91 (68 Ren + 23 17c) | Renaissance/Baroque sculpture is core survey content (Donatello, Michelangelo, Cellini, Giambologna, Bernini) yet swamped 8:1 by oils. | Met dept "European Sculpture and Decorative Arts"; V&A API; Wikidata SPARQL: `instance of sculpture` + creator floruit 1400-1700 + image. | +250 |
| 3 | **Prints / works on paper as a teachable category** | 284 prints, 414 drawings (mostly bundled, few canonical) | Dürer/Rembrandt/Goya/Hokusai prints and the whole "Drawings & Prints" department are thin in *canonical, famous* examples; many current prints are minor. | Met dept "Drawings and Prints"; NGA open access (strong print holdings); search Dürer, Rembrandt etchings, Goya Caprichos, Piranesi. | +200 canonical |
| 4 | **Post-1945 / Modern & Contemporary** | **35** | Abstract Expressionism, Pop, Minimalism, postwar global art — a major survey era — almost nonexistent. (Copyright-constrained, but PD-eligible and museum-OA works exist.) | LACMA & Smithsonian OA (CC0); Wikidata filtered through `scripts/audit-copyright.mjs` (death >1955 rule) for safe PD picks; focus pre-1960 PD-eligible. | +80 (PD-safe) |
| 5 | **South & Southeast Asian art** (India, Nepal/Tibet, Cambodia, Thailand, Indonesia) | 151 | One Met sub-department covering Chola bronzes, Gandhara, Khmer/Angkor, Borobudur-era, Mughal painting — major survey content, half of China's count (357). | Met dept "Asian Art" filter South/SE Asia; Cleveland (strong S-Asian); V&A; Wikidata `P495 country` India/Cambodia/Indonesia + sculpture/painting. | +150 |

## Secondary gaps (next tier)

- **Early Medieval Europe 500-1000**: only **2 works**. No Carolingian/Ottonian/Insular (Book of Kells, Lindisfarne, Sutton Hoo, Aachen). Survey-critical. Source: British Museum, Cleveland, Met Medieval/Cloisters. Target +60.
- **Sub-Saharan Africa excl. Egypt**: 168 (vs 282 Egypt). Benin bronzes, Ife, Nok, Kuba, Kongo under-weighted relative to importance; Egypt over-weighted within the Africa region. Source: British Museum, Quai Branly, Met AOA. Target +120.
- **Pre-Columbian Americas**: 108 ancient. Maya, Aztec, Moche, Nazca, Inca — thin for a continent. Source: Met AOA, Cleveland, Walters. Target +100.
- **Photography**: 152, almost all Early-20c US documentary (FSA/Lange/Evans). Missing 19c European photography (Nadar, Talbot, Atget) and pictorialism. Source: NGA, LACMA, Smithsonian OA. Target +60.
- **Textiles / Costume / Glass / Musical Instruments / Arms & Armor**: near-zero as recognizable categories (decorative-arts query returned 0). Whole Met departments unrepresented. Lower priority for a guessing game but worth a token presence. Source: V&A, Met.

## Note on over-representation
European oil painting (esp. 17c Dutch Golden Age 138-style-tagged, 19c French Impressionism/Romanticism) is the dominant bloc and should NOT be expanded; rebalancing should come from harvesting the gaps above, not trimming oils. Asia is reasonably broad except S/SE Asia. North America is 88% 19c-20c (almost no colonial/early material), which is historically accurate and fine.
