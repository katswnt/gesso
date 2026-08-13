# Works-to-import status

_Last reviewed: 2026-08-13. Regenerate the backlog counts with the node snippet at the bottom._

## From the "what famous works are we missing?" conversation

| Work | Decision | State |
|---|---|---|
| Bust of Nefertiti | add (via Commons image-license check, NOT P18) | ✅ in pool (`wikidata:Q582172`) |
| Terracotta Army | add | ✅ in pool (`wikidata:Q47672`) |
| The Blue Boy | add (Gainsborough, 1770) | ✅ in pool (`wikidata:Q604761`) |
| Ghent Altarpiece | add (van Eyck, 1432) | ✅ in pool (`wikidata:Q734834`) |
| **Salvator Mundi** | add IF the Commons image is genuinely PD/CC0 | ⏳ **OUTSTANDING** — not in pool. Verify the Commons image license (the disputed da Vinci; the restored/photographed hi-res may be copyright-encumbered). If it fails the license check, exclude and note here. |
| Ishtar Gate | exclude — architecture, not a movable artwork | ❌ excluded |
| L'Origine du monde | exclude | ❌ excluded |
| The Little Mermaid (statue) | exclude — in copyright (Eriksen est. d.1959) | ❌ excluded |

## Standing backlogs (data/incoming/) — separate from the above

- `wishlist-curated.json` — 212 works, **fully drained** (all in pool).
- `canon-missing.json` — 98 famous works, ~**39 still missing** by title (e.g. Lady with an Ermine, Sunflowers, Guernica, Les Demoiselles d'Avignon). Highest-value undrained list — worth a promote pass.
- `staged-missing.json` — 1,030 works, ~**173 still missing** by title. Long tail; lower priority.
- Counts are fuzzy (variant titles); verify before promoting. Only add PD/CC0 works and run `scripts/audit-copyright.mjs` + `scripts/check-pool.mjs` after any harvest.

## Next actions

1. Resolve Salvator Mundi's Commons license → add or record exclusion.
2. Drain `canon-missing.json` (~39 real misses) — highest-value famous works.
3. Then reassess `staged-missing.json`.

<!-- regenerate counts:
node -e 'const w={};new Function("window",require("fs").readFileSync("data/pool.js","utf8"))(w);const t=new Set(w.ARTEFACTUM_POOL.map(p=>String(p.title||"").toLowerCase().replace(/[^a-z0-9]/g,"")));for(const f of ["canon-missing","staged-missing","wishlist-curated"]){const a=JSON.parse(require("fs").readFileSync("data/incoming/"+f+".json","utf8"));const n=(Array.isArray(a)?a:a.works||[]).map(x=>x.title||x.name).filter(Boolean);console.log(f,n.length,"listed",n.filter(x=>t.has(x.toLowerCase().replace(/[^a-z0-9]/g,""))).length,"in-pool")}'
-->
