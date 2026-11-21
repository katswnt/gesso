// Stubbed-DOM load harness for index.html's inline app script.
//   node tests/dom-harness.mjs
// No build, no jsdom: a self-returning Proxy stands in for every DOM node so arbitrary
// document/element chains no-op instead of throwing, while real globals (data pools,
// localStorage, a Leaflet stub) are provided. Exits 1 on ANY throw.
//
// WHY it CALLS functions, not just evals: the load path alone missed real bugs before —
// a `const esc` shadowing the global esc() (TDZ) only threw when a modal opener ran, and
// the Training DEMONYM collision only surfaced on a render. So after eval we invoke the
// HTML builders/modal openers and fail on the first throw.
import { createIndexSandbox } from "../scripts/lib/index-app-sandbox.mjs";

const fail = (where, e) => { console.error(`❌ harness FAIL @ ${where}:\n   ${e && e.stack ? e.stack.split("\n").slice(0,3).join("\n   ") : e}`); process.exit(1); };

// ---- the shared sandbox (scripts/lib/index-app-sandbox.mjs): self-returning Proxy DOM, localStorage, Leaflet and
// supabase stubs, data globals (data/*.js set window.ARTEFACTUM_*), then the main inline app script ----
const DATA = ["data/cues.js","data/teach-works.js","data/hotspots.js","data/pool.js","data/fame.js",
  "data/regions.js","data/daily-order.js","data/countries.js","data/museums.js"];
let ctx;
try { ({ ctx } = createIndexSandbox({ dataFiles: DATA, syncTimers: true, onDataError: (f, e) => fail(`loading ${f}`, e) })); } // run timers sync so render bodies execute
catch (e) { fail("eval app script (load-time)", e); }

// ---- INVOKE builders/openers to catch on-call throws (the part load-only misses) ----
const call = (name, ...args) => {
  const fn = ctx[name];
  if (typeof fn !== "function") return; // not all exist in every revision — skip silently
  try { fn(...args); } catch (e) { fail(`calling ${name}()`, e); }
};
// HTML builders (return strings) + modal openers (build + attach to stubbed DOM)
["header","renderStart","renderTraining","renderLeaderboard","renderAccount","renderGlossary",
 "renderCollections","openIdentityModal","openLogin","openMenu","openSettings","route"].forEach(n => call(n));
// My Gallery: exercise the detail page (fully sync) + gallery grid sync path with a real pool id
const _pid = (ctx.ARTEFACTUM_POOL && ctx.ARTEFACTUM_POOL[0] && ctx.ARTEFACTUM_POOL[0].id) || "x";
if (ctx.SAVED && typeof ctx.SAVED.add === "function") ctx.SAVED.add(_pid);
call("renderGalleryDetail", _pid);
call("renderGallery");
call("renderWorkPage", _pid); // public per-work share page (?w=<id>)

console.log("✅ dom-harness PASS — app script loaded and key builders ran without throwing");
process.exit(0);
