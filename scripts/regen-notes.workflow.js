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
- guide: 5-7 {q,a} (obscure works 4-5) that THIS SPECIFIC work provokes — the questions a curious first-timer would actually ask standing in front of THIS image, in the order they'd wonder them. Every q MUST be anchored to something particular to this work: a named figure or object, a visible detail, a material/format choice, a formal tension, or a fact specific to it — e.g. "Why does Saint Michael look serene instead of furious?", "What's the red cross on the shield telling us?", "Why paint a fish market on a hanging scroll?". Across the set still cover the teachable ground — what it's made of, who/what is shown, what made it matter, the craft to notice, who it was for — but ONLY woven into work-specific questions. BANNED as question wording (they read as a filled-in form across works): "Why does it matter?", "Why does this work/painting matter?", "How was it made?", "How was it done?", "What is it made of?", "What technique should I notice?", "Who made it and for whom?", "Who made it, for whom, and what is the backstory?", "What's/What is the story behind it?", "Who is shown?", "What are we/am I looking at?", "What should I look at?", and any near-paraphrase. If the only honest question for a dimension is one of those generic stems, DROP it rather than pad. a = 2-3 warm plain sentences answering that specific question. Fewer sharp questions beat a full form; NEVER pad.
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
3. For each work check: id matches a source work exactly; why is one placing sentence; EXACTLY 4 cues each containing "→" and each a "<feature> → <signal>"; guide has 4-7 work-SPECIFIC {q,a}, every {q,a} non-empty. REJECT any question that is a generic template stem ("Why does it matter?", "How was it made?", "What is it made of?", "Who made it and for whom?", "What's the story behind it?", "Who is shown?", "What are we looking at?", "What technique should I notice?" or any near-paraphrase) — rewrite it to be anchored to THIS work (a named figure/detail/material/tension), or drop it if there's no honest specific version.
   ACCURACY: flag & fix any INVENTED named figure/person not supported by the metadata or genuinely-famous facts — replace with a visible-description ("a seated woman in red"). Fix any speculation/hedging. Keep good content; only correct what's wrong. If a work is missing or malformed, regenerate it correctly yourself from the source metadata using the same rules: ${GUIDE_RULES}
4. Write the CORRECTED full array of {id,why,cues,guide} to /tmp/notes-shards/${idx}.json (valid JSON only).
5. Reply with: "verify ${idx}: N ok, M corrected" and a one-line note of any work you had to keep generic.`,
    { label: `verify:${idx}`, phase: 'Verify' }
  )
)

const done = results.filter(Boolean).length
log(`done: ${done}/${nBatches} batches verified → /tmp/notes-shards/*.json`)
return { batches: nBatches, completed: done }
