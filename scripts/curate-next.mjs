#!/usr/bin/env node
// Select the next N un-audited works for the comprehensive curate pass, in PRIORITY order, and write them
// as full-context input chunks. Resumable via data/incoming/curate/manifest-done.json (ids already audited).
//   node scripts/curate-next.mjs [N=100] [chunkSize=15]
// Priority: daily-visible (next 90 days) first, tier easy>medium>hard>impossible, gate-backlog works first
// within a tier, then by fame; after the daily-visible set, the rest of the pool by fame.
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const N = +(process.argv[2] || 100), CHUNK = +(process.argv[3] || 15);
const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const byId = Object.fromEntries(pool.map(p => [p.id, p]));
const daily = readGlobal("data/daily-order.js", "ARTEFACTUM_DAILY");
let fame = {}; try { const f = readFileSync("data/fame.js", "utf8"); fame = JSON.parse(f.slice(f.indexOf("{"), f.lastIndexOf("}") + 1)); } catch {}
const fa = p => fame[p.id] != null ? fame[p.id] : (p.fame || 0);
const tt = readFileSync("data/teach-works.js", "utf8");
const teach = JSON.parse(tt.slice(tt.indexOf("{", tt.indexOf(".work")), tt.lastIndexOf("}") + 1));
const hot = (() => { const t = readFileSync("data/hotspots.js", "utf8"); return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); })();
let done = new Set(); try { done = new Set(JSON.parse(readFileSync("data/incoming/curate/manifest-done.json", "utf8"))); } catch {}
const J = f => { try { return new Set(JSON.parse(readFileSync("data/incoming/" + f, "utf8")).map(w => w.id)); } catch { return new Set(); } };
const backlog = new Set([...J("copy-integrity-backlog.json"), ...J("pin-backlog.json"), ...J("century-backlog.json")]);

// tier rank per work
const tierRank = {}; ["easy", "medium", "hard", "impossible"].forEach((t, i) => (daily[t] || []).forEach(id => { if (tierRank[id] == null) tierRank[id] = i; }));
// daily-visible in next 90 days
const visible = new Set();
{ const t0 = Math.floor(Date.now() / 86400000); for (let d = t0; d <= t0 + 90; d++) { const k = new Date(d * 86400000).toISOString().slice(0, 10); const e = daily.byDate?.[k]; if (!e) continue; for (const t of ["easy", "medium", "hard", "impossible"]) (e[t] || []).forEach(id => visible.add(id)); } }

const cand = pool.filter(p => teach[p.id]?.notes?.length && !done.has(p.id));
const key = p => [ visible.has(p.id) ? 0 : 1, tierRank[p.id] ?? 9, backlog.has(p.id) ? 0 : 1, -Math.round(fa(p)) ];
cand.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
const pick = cand.slice(0, N);

const ctx = id => { const p = byId[id], c = teach[id]; return { id, title: p.title, artist: p.artist || "anonymous", date: p.y, place: p.place, region: p.region, medium: p.medium || null, style: p.style || null, styleKind: p.styleKind || null, dim: p.dim || null, img: p.img, why: c.why, notes: c.notes.map(n => { const o = { head: n.head, body: n.body }; if (typeof n.x === "number") { o.x = n.x; o.y = n.y; } return o; }), hotspotCount: (hot[id] || []).length }; };
const chunks = []; for (let i = 0; i < pick.length; i += CHUNK) chunks.push(pick.slice(i, i + CHUNK));
const L = "abcdefghijklmnopqrstuvwxyz";
chunks.forEach((ch, i) => writeFileSync(`data/incoming/curate/in-${L[i]}.json`, JSON.stringify(ch.map(p => ctx(p.id)), null, 1)));
writeFileSync("data/incoming/curate/batch-ids.json", JSON.stringify(pick.map(p => p.id)));
const byT = {}; for (const p of pick) { const t = ["easy", "medium", "hard", "impossible"][tierRank[p.id]] || "non-daily"; byT[t] = (byT[t] || 0) + 1; }
console.error(`selected ${pick.length} works (${cand.length} remain undone) in ${chunks.length} chunks of ~${CHUNK}`);
console.error(`by tier: ${JSON.stringify(byT)} | visible-90d: ${pick.filter(p => visible.has(p.id)).length} | backlog: ${pick.filter(p => backlog.has(p.id)).length}`);
