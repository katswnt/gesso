#!/usr/bin/env node
// TOOL-LESS vision audit runner (G-03). Reads a run built by vision-next.mjs and, for each broker-sanitized
// derivative, calls a multimodal model completion with **NO `tools` field, no agent wrapper, no shell, no
// filesystem, no network** beyond the model API itself. The model sees ONLY the sanitized image + text metadata —
// never a URL. Output is strictly schema-validated and written to a QUARANTINED completions/ dir; it is NEVER
// applied. Apply only via human review (scripts/vision-review.mjs → approved.json) → curate-merge.mjs --run.
// COST-GATED: refuses unless VISION_RUN_LIVE=1 and ANTHROPIC_API_KEY are set. Never runs in CI.
//   VISION_RUN_LIVE=1 node scripts/vision-audit-run.mjs data/incoming/vision/runs/<runId>
import { readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { validateCompletion, completionFile, promptHashOf, sha256, metaShaOf, safeImgPath } from "./lib/vision-run.mjs";

const MODEL = process.env.VISION_MODEL || "claude-sonnet-4-6";
const runDir = process.argv[2];
if (!runDir) { console.error("usage: VISION_RUN_LIVE=1 node scripts/vision-audit-run.mjs <runDir>"); process.exit(1); }
if (process.env.VISION_RUN_LIVE !== "1") { console.error("❌ refusing: this makes paid, tool-less model calls. Set VISION_RUN_LIVE=1 to confirm you approve the cost."); process.exit(1); }
const KEY = process.env.ANTHROPIC_API_KEY; if (!KEY) { console.error("❌ ANTHROPIC_API_KEY required"); process.exit(1); }

const PROMPT = readFileSync("scripts/vision-audit-prompt.md", "utf8");
// The manifest header is IMMUTABLE here (never mutated). Verify the current prompt matches what the run froze, so a
// changed prompt cannot run under the old promptHash. modelId is recorded per-completion, not in the manifest.
const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
if (promptHashOf(PROMPT) !== manifest.header.promptHash) { console.error("❌ prompt hash != manifest.header.promptHash — the prompt changed since this run was built. Rebuild the run (vision-next) or restore the prompt."); process.exit(1); }
const REC_HEADER = { ...manifest.header, modelId: MODEL };

async function audit(item) {
  // NEVER trust item.imgFile as a path — derive it from the validated hex sha + alnum ext, confined to imgs/, so a
  // tampered manifest (e.g. imgFile:"../../../etc/passwd") can't make the runner send an arbitrary local file.
  const imgPath = safeImgPath(runDir, item.sha256, item.ext);
  if (!imgPath) return { ok: false, reason: "unsafe/invalid derivative path (tampered manifest?)" };
  if (item.imgFile != null && item.imgFile !== `imgs/${item.sha256}.${item.ext}`) return { ok: false, reason: "manifest imgFile mismatch (tampered manifest?)" };
  if (typeof item.baseSha !== "string" || !/^[0-9a-f]{64}$/.test(item.baseSha)) return { ok: false, reason: "missing/invalid baseSha in manifest" };
  const bytes = readFileSync(imgPath);
  if (sha256(bytes) !== item.sha256) return { ok: false, reason: "derivative sha mismatch (tampered before call)" };  // bind the exact image immediately before the call
  const data = bytes.toString("base64");
  // URL-free payload: the model gets ONLY the sanitized image + text metadata — never the id (pool ids can be
  // Wikidata URLs) and never an image URL. The runner sets the id on the output itself, so the model needn't see it.
  const userText = `${PROMPT}\n\n--- work metadata ---\n${JSON.stringify(item.meta)}`;
  // TOOL-LESS by construction: the request body intentionally has NO `tools` field and no agent framing.
  const body = {
    model: MODEL, max_tokens: 2000,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: item.mime, data } },
      { type: "text", text: userText },
    ] }],
  };
  let r; try { r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { return { ok: false, reason: "transport " + (e && e.message) }; }
  if (!r.ok) return { ok: false, reason: "api " + r.status };
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
  let obj; try { obj = JSON.parse(text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "")); } catch { return { ok: false, reason: "non-json output" }; }
  obj.id = item.id;
  const v = validateCompletion(obj);
  if (!v.ok) return { ok: false, reason: "schema: " + v.errors.join(",") };
  return { ok: true, value: v.value };
}

let done = 0, bad = 0;
for (const item of manifest.items) {
  if (item.imgStatus !== "ok") continue;
  const res = await audit(item);
  if (!res.ok) { bad++; console.error(`  ${item.id}: ${res.reason}`); continue; }
  // full header (prompt+schema+broker-policy+MODEL) + metaSha (binds the id+meta+image shown) are stored IN the
  // record so approval verification can detect a manifest edited after the run
  const record = { header: REC_HEADER, id: item.id, imgSha256: item.sha256, baseSha: item.baseSha, metaSha: metaShaOf(item.id, item.meta, item.sha256, item.baseSha), result: res.value };
  const fd = openSync(join(runDir, "completions", completionFile(item.id)), "wx", 0o600);   // exclusive/immutable
  writeSync(fd, JSON.stringify(record, null, 1)); closeSync(fd);
  done++;
}
console.log(`vision-audit-run: ${done} completions quarantined, ${bad} failed (schema/api). NOTHING applied.`);
console.log(`  review: node scripts/vision-review.mjs ${runDir}   then: node scripts/curate-merge.mjs --run ${runDir}`);
