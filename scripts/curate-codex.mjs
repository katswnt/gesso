// Comprehensive curate pass via Codex vision (≈free). Node downloads each image locally (resolving Commons
// File: -> direct CDN url so the Special:FilePath concurrent cross-wiring can't happen), then Codex audits the
// work against the image and returns the full curate JSON. Resumable. NO git/commit. Output feeds curate-merge.mjs.
//   node scripts/curate-codex.mjs [limit]   (reads data/incoming/curate/in-*.json)
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UA = "GessoCurate/1.0 (kathryn.swint@gmail.com)";
const DIR = "data/incoming/curate";
const works = readdirSync(DIR).filter(f => /^in-[a-z]\.json$/.test(f)).flatMap(f => JSON.parse(readFileSync(join(DIR, f), "utf8")));
const OUT = join(DIR, "codex-out.json");
let done = {}; if (existsSync(OUT)) { try { done = Object.fromEntries(JSON.parse(readFileSync(OUT, "utf8")).map(w => [w.id, w])); } catch {} }
const limit = +(process.argv[2] || works.length);
const todo = works.filter(w => !(w.id in done)).slice(0, limit);
console.error(`curate-codex: ${Object.keys(done).length} done, ${todo.length} to audit (of ${works.length})`);

async function resolveImg(url) {
  if (!/commons\.wikimedia\.org\/.*Special:FilePath\//.test(url)) return url;
  const file = decodeURIComponent(url.split("Special:FilePath/")[1].split("?")[0]);
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(file)}&prop=imageinfo&iiprop=url&iiurlwidth=1000&format=json`;
    const j = await (await fetch(api, { headers: { "User-Agent": UA } })).json();
    const pg = Object.values(j.query.pages)[0]; return pg?.imageinfo?.[0]?.thumburl || url;
  } catch { return url; }
}
async function dl(w) {
  const path = join("/tmp", "cu_" + w.id.replace(/[^a-z0-9]/gi, "_") + ".jpg");
  try { const url = await resolveImg(w.img); const r = await fetch(url, { headers: { "User-Agent": UA } }); if (!r.ok) return null; writeFileSync(path, Buffer.from(await r.arrayBuffer())); return path; } catch { return null; }
}
function codex(args) { return new Promise(res => { const c = spawn("codex", args, { stdio: ["ignore", "ignore", "ignore"] });
  const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} res(false); }, 240000);
  c.on("close", code => { clearTimeout(t); res(code === 0); }); c.on("error", () => { clearTimeout(t); res(false); }); }); }

function prompt(w) {
  const ctx = JSON.stringify({ title: w.title, artist: w.artist, date: w.date, place: w.place, region: w.region, medium: w.medium, style: w.style, styleKind: w.styleKind, notes: w.notes });
  return `The attached image is the artwork for this record:\n${ctx}\n\n` +
`Audit it and output ONE JSON object (no prose, no markdown fences):\n` +
`{"id":"${w.id}","image":{"ok":bool,"issue":"none|wrong-art|stand-in|catalog-scan|bw-repro|low-res|broken","reason":""},` +
`"fields":{ optional corrections: "place","medium","style","styleKind","title","date" },` +
`"movementMeta":{"dates":"c. X–Y","region":"...","palette":["#..","#..","#..","#.."]}  (ONLY if you set a niche fields.style),` +
`"notes":[{"head":"","body":"","x":num?,"y":num?}],"noPins":bool,"flags":[""]}\n\n` +
`Rules: image.ok=false ONLY if it clearly is NOT this artwork or is a stand-in/catalog-scan/B&W-repro/broken. ` +
`Rewrite notes: fix broken/truncated heads&bodies, merge redundancy (~5-7 notes), every claim accurate to the image, warm docent voice, invent nothing. ` +
`Pins: put x/y (0-100) on notes naming a VISIBLE locatable feature (the note must describe that feature); >=1 novel detail; no two pins within ~6 units; pinned notes FIRST; aim 2-5. If genuinely non-objective/monochrome/pure-text set noPins=true,pins none. ` +
`fields: only keys that should CHANGE. medium must be a real material; style must be a real movement/culture (never a bare country/nationality) and include movementMeta if niche. flags: anything needing human review (uncertain attribution/origin/title).`;
}

async function analyze(path, w) {
  const out = join(mkdtempSync(join(tmpdir(), "cu-")), "o.json");
  const ok = await codex(["exec", "-s", "read-only", "--skip-git-repo-check", "--color", "never", "-i", path, "-o", out, prompt(w)]);
  if (!ok) return null;
  try { let s = readFileSync(out, "utf8").trim(); const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0) return null; const j = JSON.parse(s.slice(a, b + 1)); j.id = w.id; return j; } catch { return null; }
}

let i = 0, fails = 0, ok = 0;
const save = () => writeFileSync(OUT, JSON.stringify(Object.values(done), null, 1));
async function worker() {
  while (i < todo.length) { const w = todo[i++]; const path = await dl(w);
    if (!path) { done[w.id] = { id: w.id, image: { ok: false, issue: "broken", reason: "download failed" }, flags: ["image-download-failed"] }; continue; }
    const r = await analyze(path, w);
    if (r === null) { fails++; if (fails >= 12) { console.error("too many Codex failures (cap?) — saving + stopping; re-run to resume"); save(); process.exit(0); } continue; }
    done[r.id] = r; ok++; if (ok % 6 === 0) { save(); console.error(`${Object.keys(done).length}/${works.length} audited | last: ${(w.title||"").slice(0,30)}`); }
  }
}
await Promise.all([worker(), worker(), worker()]);
save();
console.error(`DONE: ${Object.keys(done).length}/${works.length} audited -> ${OUT}`);
