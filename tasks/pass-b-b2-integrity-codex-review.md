# Codex review: Pass B B2 research-integrity repair (pre-canary)

## Ask
Adversarially review the bounded B2 repair below **before** we spend a live subscription canary on it.
Find flaws, spoofing paths, and gaps. Do not widen scope: the owner's bar is "once one B2 genuinely
searches and fetches, that's sufficient" and "do not turn source tracing into an infrastructure
project." All changes are uncommitted (HEAD 0ce9383). Nothing has run live since the changes.

## Why this exists
A pre-repair canary (run dir `cal50-e1031fa21c8d`, preserved as evidence) showed B2 with web tools
*available* (permission fix worked) but `server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }`.
B2 made zero real web calls yet emitted 12 factChecks with source URLs from training memory
(clevelandart.org, wikipedia, google arts). The validator accepted them because a URL string passes
HTTPS/sourceId checks. So B2 was asserting "supported/refuted" on unretrieved, possibly fabricated
sources. This repair forces genuine retrieval and independently verifies it.

## The three changes to review

### 1. Prompt (scripts/lib/pass-b-prompts.mjs, buildB2Prompt)
- B2 now told: it HAS WebSearch/WebFetch and MUST use them; must actually retrieve (WebSearch then
  WebFetch the pages relied on) before marking any claim supported or refuted; may cite ONLY sources
  it retrieved this session (never a URL recalled from memory); if retrieval is unavailable or a
  claim cannot be sourced by a fetched page, leave that claim unresolved; keep uncertainty <=1000
  chars and explicitly report retrieval failure there.

### 2. Controller telemetry gate (scripts/lib/pass-b-calibration.mjs)
```
export function b2ResearchTelemetry(envelope) {
  const st = envelope?.usage?.server_tool_use || {};
  const n = v => (Number.isFinite(v) ? v : 0);
  const searches = n(st.web_search_requests);
  const fetches = n(st.web_fetch_requests);
  return { ok: searches >= 1 && fetches >= 1, searches, fetches };
}
export function assertB2Research(stage, envelope) {
  if (stage !== 'B2') return;                 // B2-only; B1/B3/B4 untouched
  const { ok, searches, fetches } = b2ResearchTelemetry(envelope);
  if (!ok) throw new Error(`B2 research-not-performed: web_search_requests=${searches}, web_fetch_requests=${fetches} ...`);
}
```
Wired into the live spawn (scripts/pass-b-calibration.mjs spawnStage) AFTER the attempt telemetry is
persisted to disk and AFTER the structured_output presence check, BEFORE `capture`. So a
research-not-performed B2 keeps its diagnostic attempt/envelope but yields NO completion, and
runWorkStages records `B2: failed:...` and stops the work (one attempt per stage, no retry).
The check reads the provider-reported `usage.server_tool_use`, not anything the model authors.

### 3. Tests (offline, both green)
- tests/pass-b-calibration.test.mjs (34 checks): new gate test asserts throw for
  supported-claims-zero-tools, remembered-URLs-zero-tools, search-only, fetch-only, and
  missing/`{}` telemetry; passes for search>=1 AND fetch>=1; and does NOT throw for B1/B3/B4 even
  with zero telemetry.
- tests/vision-content-schema.test.mjs (34 checks): unchanged this round (source-grounding rule from
  the prior round still in force: supported/refuted need >=1 valid source, unresolved may have zero,
  every guide answer cites >=1 declared source).

## Related uncommitted changes already in this prototype (context, not this round's focus)
Web allowlist for B2 only (`--allowedTools "WebSearch WebFetch"`, B1/B3/B4 zero-tool, restricted +
safe-mode + empty MCP + API-key strip retained); evidenceRef union namespace (note/hotspot ref =
evidence id OR delight id, unique across the union); coordinate convention (bbox [x,y,w,h] 0-1, pins
0-100); structured_output-only parsing; pinned model with resolved==claude-sonnet-4-6 required;
exact raw envelope bytes preserved SHA-bound; contextual resume re-verification.

## Adversarial questions for Codex
1. **Spoofability.** Is `usage.server_tool_use.web_search_requests` / `web_fetch_requests` truly
   provider-reported and outside model control in the Claude Code CLI envelope? If a model could
   influence those counts, the gate is theater. Confirm or refute.
2. **Gate strength vs the owner's bar.** The gate proves "some search AND some fetch happened," NOT
   "every cited URL was fetched." A model could fetch one page and still cite a remembered URL for a
   different claim. Given the owner explicitly forbids building full source-tracing now, is
   ">=1 search AND >=1 fetch" the right minimal bar, or is there a cheap strengthening that does not
   become an infra project (e.g. cross-check that at least the cited hosts appear among fetched URLs,
   if the envelope exposes fetched URLs)?
3. **Gaming risk from the prompt.** Does "you MUST run WebSearch then WebFetch" invite a perfunctory
   one-shot search+fetch to satisfy the gate without real diligence? Is that acceptable under the bar?
4. **Failure semantics.** Is throwing after the attempt file is written (evidence kept) but before
   capture (no completion) correct? Any path where a completion could still be written for a
   research-not-performed B2, or where B1/B3/B4 could trip the gate?
5. **Cost at scale.** Forcing real fetch adds server_tool_use requests per work. Any concern for the
   eventual all-works run, and does it interact with the separately-observed automatic prompt caching
   (B2 showed cache_read ~50k)?
6. **Anything else** that would make a live canary a waste of spend.

## Constraints that do not move
No paid API; G-03 boundary (tool-less except B2 web allowlist, broker-sanitized images, no image to a
tool-capable context); strict local validators are final authority; no auto-apply (human approval
gate); no commit/push/merge/deploy without explicit owner approval.
