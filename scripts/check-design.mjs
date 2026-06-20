// Fail-closed design-system gate — keeps chrome colors tokenized and UI glyphs in the ICONS map.
// Run after ANY index.html UI change:  node scripts/check-design.mjs   (exits 1 on HARD; wired into npm test)
// LOCAL only (no network). Mirrors scripts/check-pool.mjs. Companion: tasks/design-system-audit.md.
//
// HARD (block ship):
//   R1 style-attr token-hex : a #rrggbb inside a style="…" attr whose value equals a :root token → use var(--token)
//   R2 stale fallback       : var(--X,#hex) where #hex ≠ the real :root value of --X
// WARN (report only):
//   W1 entity glyph used as UI (&times; &starf; …) → suggest ICONS map
//   W2 raw pictographic/UI emoji glyph             → suggest ICONS map
//   W3 chrome #rrggbb with NO matching token (outside DATA) → GENUINE CHOICE: add a token?
import { readFileSync } from "node:fs";

const css = readFileSync("styles.css", "utf8");
const root = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
const tok2hex = {}, hex2tok = {};
for (const m of root.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)) {
  const name = m[1], hex = m[2].toLowerCase();
  tok2hex[name] = hex;
  if (!(hex in hex2tok)) hex2tok[hex] = name; // first token wins for a shared value
}

const html = readFileSync("index.html", "utf8");
const lines = html.split("\n");

// DATA regions to skip (intentional palette/emoji data, not chrome): line-range + per-line regex.
const movStart = html.slice(0, html.indexOf("const MOVEMENTS={")).split("\n").length;
const movEnd = html.slice(0, html.indexOf("const MOV_FAMILY=")).split("\n").length;
const isDataLine = (ln, i) =>
  (i + 1 >= movStart && i + 1 <= movEnd) ||
  /\bSWATCHES\b|palette\s*:\s*\[|GLOSSARY_EMBLEM|LOCKED_PALETTE|\bDABS\b|swatchGlyph/.test(ln);

const hard = [], warn = [];
const at = i => `index.html:${i + 1}`;

// curated UI glyphs (entities + raw) that should be ICONS, plus a broad emoji range
const UI_ENTITY = /&(times|starf|infin|check|rarr|larr|#10022|#9819|#8599|#9818|#9824);/g;
const UI_RAW = /[◎∞★☆◐✕✓↻⟳♛]|[\u{1F000}-\u{1FAFF}☀-➿]/gu;

for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  if (isDataLine(ln, i)) continue;

  // R2 — stale fallback: var(--X, #hex) whose hex disagrees with :root
  for (const m of ln.matchAll(/var\(\s*--([a-z-]+)\s*,\s*(#[0-9a-fA-F]{3,6})\s*\)/g)) {
    const real = tok2hex[m[1]];
    if (real && real !== m[2].toLowerCase())
      hard.push(`[R2 stale-fallback] ${at(i)} var(--${m[1]},${m[2]}) — --${m[1]} is ${real}; drop the fallback`);
  }

  // R1 — token-valued hex inside a style="…" attribute
  for (const sm of ln.matchAll(/style="([^"]*)"/g)) {
    for (const hm of sm[1].matchAll(/#[0-9a-fA-F]{6}/g)) {
      const hex = hm[0].toLowerCase();
      if (hex2tok[hex]) hard.push(`[R1 style-hex] ${at(i)} ${hex} → use var(--${hex2tok[hex]})`);
    }
  }

  // W3 — chrome hex (anywhere on a non-data line) with no token match
  for (const hm of ln.matchAll(/#[0-9a-fA-F]{6}/g)) {
    const hex = hm[0].toLowerCase();
    if (!hex2tok[hex] && hex !== "#ffffff" && hex !== "#000000")
      warn.push(`[W3 untokened-hex] ${at(i)} ${hex} — GENUINE CHOICE: add a token or snap to one?`);
  }

  // W1 / W2 — glyphs used as UI
  const stripped = ln.replace(/\/\/.*$/, ""); // skip line comments
  for (const m of stripped.matchAll(UI_ENTITY)) warn.push(`[W1 entity-glyph] ${at(i)} &${m[1]}; → use ICONS map`);
  for (const m of stripped.matchAll(UI_RAW)) warn.push(`[W2 emoji-glyph] ${at(i)} "${m[0]}" → use ICONS map`);
}

const group = arr => { const g = {}; for (const v of arr) { const k = v.match(/^\[([^\]]+)\]/)[1].split(" ")[0]; (g[k] = g[k] || []).push(v); } return g; };
const report = (label, arr) => {
  const g = group(arr); console.log(`\n${label} (${arr.length}):`);
  for (const [k, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k}: ${v.length}`); v.slice(0, 6).forEach(x => console.log("     " + x.replace(/^\[[^\]]+\] /, "")));
  }
};

console.log(`=== check-design: ${lines.length} lines, ${Object.keys(tok2hex).length} tokens ===`);
report("⚠ HARD violations (block ship)", hard);
report("ℹ warnings (review)", warn);
console.log(`\n${hard.length ? "❌ FAIL — " + hard.length + " hard violations" : "✅ PASS — no hard violations"}`);
process.exit(hard.length ? 1 : 0);
