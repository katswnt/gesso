// Deterministic production-language leak detector for PLAYER-FACING copy (why / cues / notes / guide).
// It rejects text that references the generation pipeline instead of the artwork: stage names (B1–B4),
// "visual verification confirms", pipeline/stage/pass language, "the prompt/model/metadata/record/catalog/
// title" used as an INPUT SOURCE, and structured-output/hydration operations. Patterns are NARROW and
// verb/context-anchored so ordinary art language ("the model wears a wreath", "the title suggests a myth",
// "the record of Christ's life") does NOT false-positive. Used by the player-copy gate and the merge path.

// Each rule: [label, regex]. A match on ANY field = a leak.
export const LEAK_RULES = Object.freeze([
  ['stage-verification', /\bB[0-4]\b[^.?!\n]{0,40}\bverif(?:y|ied|ication|ies)\b/i],
  ['visual-verification', /\bvisual verification\b/i],
  ['verification-confirms', /\bverification\s+confirms?\b/i],
  ['stage-name-op', /\bB[0-4]\s+(?:stage|pass|analysis|step|output|found|identified|notes?|confirms?|flagged|detected)\b/i],
  ['pipeline-stage', /\b(?:pipeline|upstream|downstream)\s+(?:stage|step|pass|analysis|verification)\b/i],
  ['stage-pass-word', /\b(?:stage|pass)\s+B[0-4]\b/i],
  // "the prompt" and "the metadata" are never legitimate art-copy content -> flag bare.
  ['the-prompt', /\bthe prompt\b/i],
  ['the-metadata', /\bthe metadata\b/i],
  ['ai-model', /\b(?:the\s+)?(?:AI|language|vision|ML)\s+model\b/i],
  ['model-as-agent', /\bthe model\s+(?:said|says|identif\w+|cannot|can't|could not|couldn't|does not|doesn't|was\s+(?:asked|given|unable|told)|infer\w+|generat\w+|output|not\s+able|notes?|assumes?|guess\w*)\b/i],
  // INPUT-SOURCE-LACKS-DATA: the pipeline complaining that its input (title/record/catalog/caption/image) lacks
  // information. Absence-anchored so ordinary "the title suggests/gives/includes …" (the artwork's own title) stays legal.
  ['source-lacks-data', /\bthe\s+(?:provided\s+)?(?:title|record|catalog|catalogue|caption|label|image|photo|photograph|data|information)\s+(?:does\s+not|doesn't|do\s+not|don't|cannot|can't|fails?\s+to)\s+(?:give|provide|specify|mention|name|record|indicate|say|tell|list|note|include|identify|show)\b/i],
  // CATALOG-DATA framing: record/catalog/catalogue treated as a data source (of-framing "the record of X" stays legal).
  ['catalog-as-data', /\bthe\s+(?:record|catalog|catalogue)\s+(?:lists?|records?|notes?|states?|gives?|shows?|indicates?|identifies?|specif(?:y|ies)|omits?|provides?|says?|calls?|labels?|describes?|does not|doesn't)\b/i],
  // "in the catalog(ue)" as a data source (but keep the art-historical "catalogue raisonné").
  ['in-the-catalog', /\bin the catalog(?:ue)?\b(?!\s+raisonn)/i],
  // "the museum('s) record/catalogue/label/documentation <data-verb>" — museum metadata cited as a source.
  ['museum-record-as-data', /\bthe\s+museum(?:'s)?\s+(?:record|catalogue|catalog|label|documentation|files?|database|entry)\s+(?:indicates?|states?|lists?|gives?|says?|records?|notes?|shows?|specif(?:y|ies)|identifies?|describes?|calls?|omits?|provides?|does not|doesn't)\b/i],
  // "the museum <states/leaves open/does not specify …>" as the arbiter of the artwork's facts (keeps
  // "the museum acquired/holds/displays/houses …", which are ordinary provenance/location prose).
  ['museum-as-source', /\bthe\s+museum\s+(?:explicitly\s+)?(?:leaves?\s+(?:it\s+|this\s+)?(?:open|unresolved|unanswered)|does not\s+(?:say|specify|record|give|identify|name|list)|doesn't\s+(?:say|specify|record|give|identify|name|list)|notes?\s+that|states?\s+that|indicates?\s+that|specif(?:y|ies)\s+that)\b/i],
  ['provided-information', /\bthe provided (?:information|data|metadata|record|catalog|details?)\b/i],
  ['based-on-metadata', /\bbased on the (?:metadata|record|catalog|catalogue|prompt)\b/i],
  ['pipeline-op', /\b(?:structured output|tool[_ ]use|json[- ]?schema|compact delta|hydrat(?:e|es|ed|ion)|calibration run|synthesis stage|research stage)\b/i],
]);

// Return the list of {label, match} leaks in a single string (empty if clean).
export function detectLeaks(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  for (const [label, re] of LEAK_RULES) { const m = s.match(re); if (m) out.push({ label, match: m[0] }); }
  return out;
}
export function hasLeak(text) { return detectLeaks(text).length > 0; }

// Scan one production teach-works entry ({why, cues[], notes[{head,body}], guide[{q,a}]}) + optional hotspots
// text; return [{field, label, match}] for every leak found across all player-facing fields.
export function scanTeachEntry(entry, { hotspots = null } = {}) {
  const hits = [];
  const add = (field, text) => { for (const l of detectLeaks(text)) hits.push({ field, ...l }); };
  if (entry) {
    add('why', entry.why);
    (entry.cues || []).forEach((c, i) => add(`cues[${i}]`, c));
    (entry.notes || []).forEach((n, i) => { add(`notes[${i}].head`, n.head); add(`notes[${i}].body`, n.body); });
    (entry.guide || []).forEach((g, i) => { add(`guide[${i}].q`, g.q); add(`guide[${i}].a`, g.a); });
  }
  (hotspots || []).forEach((h, i) => { add(`hotspots[${i}].conciseText`, h.conciseText); add(`hotspots[${i}].deepText`, h.deepText); });
  return hits;
}
