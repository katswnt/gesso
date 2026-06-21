export const meta = {
  name: 'regen-teach-notes',
  description: 'Generate richer teach notes (why+cues+guide) for all works missing guide, then verify each batch',
  phases: [
    { title: 'Generate', detail: 'one agent per batch of works → writes a draft shard' },
    { title: 'Verify', detail: 'one agent per batch → checks guardrails, corrects, writes final shard' },
  ],
}

const COUNT = (args && args.count) || 3240
const B = (args && args.batch) || 10
const nBatches = Math.ceil(COUNT / B)
log(`regen: ${COUNT} works, ${nBatches} batches of ${B}`)

const GUIDE_RULES = `You are a warm, knowledgeable art-history museum guide writing "teach me" notes for the daily art game Gesso. Notes appear AFTER the player guesses, so naming date/place/artist is fine. Audience: a smart first-timer (someone's mum/aunt) — warm, plain, gloss any jargon inline. The given metadata is GROUND TRUTH.
For EACH work output an object: {id, why, cues, guide}.
- id: copy EXACTLY (keep the full url/prefix).
- why: ONE sentence placing the work — era + region + school/medium + the single biggest visual giveaway.
- cues: EXACTLY 4 strings, each "<visible feature> → <what it signals>", covering 4 axes: (1) WHEN dates it; (2) WHERE locates region/culture; (3) SCHOOL/MOVEMENT diagnostic; (4) MEDIUM or ARTIST'S HAND. One tight clause each side of the arrow.
- guide: array of {q,a}; q = a natural visitor question; a = 2-3 warm plain sentences. FIRST FIVE REQUIRED in order: (1) MEDIUM — why this material + why not a plausible alternative; (2) SUBJECT/FIGURES — who/what & how to recognize them (object: what it is & its use); (3) SIGNIFICANCE — why it matters/what was new; (4) TECHNIQUE — the craft detail to notice; (5) STORY/CONTEXT — who made it, for whom, the backstory. THEN append as many EXTRA accurate {q,a} as the work supports (famous works 8-10; obscure 5). NEVER pad.
ACCURACY (ships with no human review): assert only genuinely well-known facts beyond the metadata. NEVER invent a named figure — if unsure who is depicted, DESCRIBE what is visible ("a seated woman in red") instead of naming. Obscure works lean on safe ground: medium reasoning, visible description, technique, regional/period context; drop optional questions rather than speculate. No hedging filler.`

const results = await pipeline(
  Array.from({ length: nBatches }, (_, i) => i),
  // STAGE 1 — generate a draft shard
  (idx) => agent(
    `${GUIDE_RULES}

TASK: Generate notes for a slice of works.
1. Run: node -e 'const a=require("/tmp/regen-worklist.json");console.log(JSON.stringify(a.slice(${idx * B},${idx * B + B})))' to get this batch's works (id,title,artist,y,place,style,medium). If the slice is empty, write [] and stop.
2. Write the notes as a JSON ARRAY of {id,why,cues,guide} objects to /tmp/notes-shards/gen-${idx}.json — valid JSON only, no markdown.
3. Reply with just: "gen ${idx}: N works".`,
    { label: `gen:${idx}`, phase: 'Generate' }
  ),
  // STAGE 2 — verify & correct that shard
  (genResult, idx) => agent(
    `You are a rigorous art-history fact-checker for the Gesso game. Verify and CORRECT a batch of teach notes.
1. Source works: node -e 'const a=require("/tmp/regen-worklist.json");console.log(JSON.stringify(a.slice(${idx * B},${idx * B + B})))'
2. Draft notes: read /tmp/notes-shards/gen-${idx}.json
3. For each work check: id matches a source work exactly; why is one placing sentence; EXACTLY 4 cues each containing "→" and each a "<feature> → <signal>"; guide has the 5 required slots in order (medium, subject, significance, technique, story) + valid extras; every {q,a} non-empty.
   ACCURACY: flag & fix any INVENTED named figure/person not supported by the metadata or genuinely-famous facts — replace with a visible-description ("a seated woman in red"). Fix any speculation/hedging. Keep good content; only correct what's wrong. If a work is missing or malformed, regenerate it correctly yourself from the source metadata using the same rules: ${GUIDE_RULES}
4. Write the CORRECTED full array of {id,why,cues,guide} to /tmp/notes-shards/${idx}.json (valid JSON only).
5. Reply with: "verify ${idx}: N ok, M corrected" and a one-line note of any work you had to keep generic.`,
    { label: `verify:${idx}`, phase: 'Verify' }
  )
)

const done = results.filter(Boolean).length
log(`done: ${done}/${nBatches} batches verified → /tmp/notes-shards/*.json`)
return { batches: nBatches, completed: done }
