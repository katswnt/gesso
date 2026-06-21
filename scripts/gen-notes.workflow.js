export const meta = {
  name: 'gen-notes',
  description: 'Generate teach notes (why+cues+guide) for a worklist into data/incoming/notes-shards (generate-only)',
  phases: [{ title: 'Generate' }],
}
const B = (args && args.batch) || 10
const COUNT = (args && args.count) || 1030
const WL = '/Users/kathrynswint/Documents/artguessr/data/incoming/staged-missing.json'
const OUT = '/Users/kathrynswint/Documents/artguessr/data/incoming/notes-shards'
const n = Math.ceil(COUNT / B)
log(`gen-notes: ${COUNT} works, ${n} batches`)
const RULES = `You are a warm museum guide writing "teach me" notes for an art game (shown AFTER guessing). For EACH work output {id,why,cues,guide}.
- id: exact copy. - why: ONE sentence placing it (era+region+school/medium+biggest visual tell).
- cues: EXACTLY 4 strings "<visible feature> → <what it signals>" covering WHEN, WHERE, school/movement, MEDIUM/hand.
- guide: array of {q,a} (2-3 warm plain sentences). FIRST FIVE REQUIRED in order: (1) medium (if medium is "" or "—", DON'T name a material—describe the visible surface), (2) subject/figures, (3) significance, (4) technique, (5) story/context. Add extra accurate {q,a} if well-supported.
ACCURACY (ships unreviewed): only assert genuinely well-known facts; NEVER invent a named figure—describe what's visible if unsure; obscure works lean on medium/technique/region. No fabrication, no hedging filler.`
await pipeline(
  Array.from({ length: n }, (_, i) => i),
  (idx) => agent(
    `${RULES}

TASK:
1. Get this batch's works: node -e 'const a=require("${WL}");console.log(JSON.stringify(a.slice(${idx * B},${idx * B + B})))'  (fields: id,title,artist,y,place,style,medium). If empty, write [] and stop.
2. Write a JSON ARRAY of {id,why,cues,guide} (4 cues, ≥5 guide each) to ${OUT}/gen-${idx}.json — valid JSON only.
3. Reply "gen ${idx}: N".`,
    { label: `gen:${idx}`, phase: 'Generate' }
  )
)
return { batches: n }
