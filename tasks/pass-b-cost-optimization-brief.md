# Pass B cost-optimization brief (for Codex review)

## Why this exists
Pass B (contentVisionEnrichment) works and is being calibrated on a fixed 50-work cohort. The
next goal is to run the vision audit across **every work on the site**, not just the cohort. At
site scale the per-work cost dominates, so before the rollout we want a cost-reduced pipeline that
does **not** degrade content quality. This brief lists the proposed levers and a concrete A/B pilot,
and asks Codex to pressure-test both. Nothing here is implemented yet.

## Cost model, stated honestly
- Pass B currently runs on the **Claude Code subscription** (paid API keys stripped from the child).
  On that path "cheaper" means **fewer tokens and less wall-clock**, not dollars: there is no
  per-call bill.
- A **full-site** run may not be viable on the subscription path (rate/volume). If it moves to the
  **paid Messages API**, then dollars become the metric, and two levers that are inert on
  subscription become real: explicit prompt caching (`cache_control`) and the Batch API (50% off,
  async). Codex should weigh in on which execution path the site-wide run should use, because it
  changes which optimizations matter. The G-03 constraints hold on either path: tool-less calls
  except B2's web allowlist, broker-sanitized images, no image bytes to a tool-capable context.

## Current pipeline shape (baseline)
Per work, up to 4 model calls, all pinned to `claude-sonnet-4-6`:
- **B1** blind image inventory, zero tools (vision).
- **B2** no-image research + legacy audit, web tools only (`WebSearch`/`WebFetch`).
- **B3** conditional targeted image re-look, zero tools except image (vision). Runs **only** when B2
  emits a targeted verification request.
- **B4** synthesis, no image, zero tools (the highest-stakes reasoning: dispositions, corrections).

Invariant to know: the controller **hard-requires** the resolved primary model to equal a single
pinned id (`EXPECTED_MODEL === 'claude-sonnet-4-6'`), and fails the stage otherwise
(`scripts/pass-b-calibration.mjs`, model-drift check). Any per-stage model change must loosen this
single-pin into a per-stage expected-model map, or it will fail closed.

## Proposed levers

### Free wins (target: zero quality change)
1. **Prompt caching.** Each stage sends an identical instruction prefix across all works; only the
   image (B1/B3) and a small metadata payload (B2/B4) vary. If the static prefix is cached, we pay
   full input once and a fraction thereafter, across the whole batch.
   - Open question for Codex: **does the subscription CLI apply or expose prompt caching?** We plan
     to inspect the envelope `usage` for cache-read / cache-creation fields on the next run before
     claiming it. If the site-wide run uses the paid API instead, we would set `cache_control` on
     the static prefix explicitly.
2. **Confirm and tune B3 conditionality.** B3 is a full vision call. We will measure the **B3 fire
   rate** across the 50-work cohort. If it fires more than the "a second look is genuinely worth it"
   bar intends, tightening B2's targeted-verification threshold removes a vision call on many works
   with no content loss.
3. **Trim thinking/effort on the bounded stages.** B3 ("is feature X visible, give a bbox") and
   B2's structured emit do not need the deep adaptive thinking that B4's synthesis does. Cap effort
   there; keep B1 (vision inventory) and B4 (synthesis) on full thinking.

### Structural lever (needs owner sign-off; listed for Codex's opinion, not for this pilot's free tier)
4. **Per-stage model tiering: drop B3 to Haiku** (`claude-haiku-4-5`), keep B1/B2/B4 on Sonnet.
   Rationale: targeted "present/absent + bounding box" is exactly the bounded task a cheap model
   does well; B1 vision inventory, B2 research, and B4 synthesis are quality-critical and stay
   Sonnet. Requires converting the single pinned-model check into a per-stage expected-model map.

## The A/B pilot (owner-requested)
Run it in two passes over the **same fixed 50-work cohort**, once the current pipeline is green:
1. **Baseline pass:** the 50 works through the **current** pipeline (all Sonnet, no changes). This
   is the quality and cost reference.
2. **Cheaper pass:** the same 50 works through the **cost-reduced** pipeline (prompt caching if
   available + trimmed thinking on B2/B3 + **B3 → Haiku**).

Compare, per work and in aggregate:
- **Cost:** input / output / cache-read / cache-write tokens, and wall-clock, per stage.
- **Quality delta:** field-by-field diff of B outputs. Specifically:
  - B3 agreement: does Haiku match Sonnet on `found` and bbox (IoU) for the same requests?
  - B4 agreement: do dispositions (keep/revise/replace/add/remove) and corrections match?
  - Note/guide content: material differences, not cosmetic wording.
- **Validator pass rate:** does the cheaper pipeline produce more invalid bodies? A cheaper model
  that fails validation and forces a retry can erase the savings, or cost more. This must be
  tracked, because retries are the main way a "cheaper" pipeline gets more expensive.

**Decision rule:** adopt a lever only if the quality delta is within tolerance **and** net tokens
drop after accounting for any added retries.

## Questions for Codex
1. Prompt caching on the subscription CLI: real or not, and how do we verify it from the envelope?
   If the site-wide run should be on the paid API instead, is `cache_control` on the static prefix
   plus the Batch API the right architecture given the tool-less / broker constraints?
2. Is **B3 the only safe stage to downgrade**, or is B2 (research with web) also a Haiku candidate?
   We assume B1 (vision inventory) and B4 (synthesis) must stay Sonnet. Agree or challenge.
3. What quality metrics and thresholds make the A/B decision rigorous rather than vibes? Propose the
   IoU / agreement thresholds and sample sizes you would trust.
4. How do we bound the retry risk (cheaper model → more validator failures → retries → net cost up)?
   Is there a cap or fallback-to-Sonnet-on-second-failure policy you would want?
5. Site-wide scaling: any batching or shared-context reuse across works by the same artist/movement
   that would cut cost **without** breaking Pass B's blind-first isolation (B1 must never learn
   identity; image and research lanes stay separate)?

## Constraints that do not move
No paid API without explicit owner approval; G-03 boundary (tool-less except B2 web allowlist,
broker-sanitized images, no image to a tool-capable context); strict local validators remain the
final authority; no auto-apply to site data (human field-level approval manifest still gates every
merge).
