#!/usr/bin/env node
// Build a standalone, self-contained review page for the curate review-queue: each flagged change shown
// WITH the work's image so Kat can judge it visually. Inlines all data so it opens as a plain file:// page.
//   node scripts/build-review-html.mjs  ->  data/incoming/curate/review.html
import { readFileSync, writeFileSync } from "node:fs";
import { readGlobal } from "./lib/static-module.mjs";

const pool = readGlobal("data/pool.js", "ARTEFACTUM_POOL");
const byId = Object.fromEntries(pool.map(p => [p.id, p]));
const queue = JSON.parse(readFileSync("data/incoming/curate/review-queue.json", "utf8"));

// attach each item's current pool record (image + current field values) so the page is self-sufficient
const items = queue.map(q => {
  const p = byId[q.id] || {};
  return { ...q, img: p.img || "", artist: p.artist || "", curPlace: p.place || "", curTitle: p.title || "", y: p.y };
});
const order = { image: 0, place: 1, title: 2, "style-unmapped": 3, date: 4 };
items.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

const counts = items.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {});
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Curate review queue</title>
<style>
 body{margin:0;background:#11100e;color:#e8e2d4;font:14px/1.5 -apple-system,Segoe UI,sans-serif}
 header{position:sticky;top:0;background:#1b1916;border-bottom:1px solid #322e27;padding:14px 20px;z-index:5}
 h1{margin:0 0 8px;font-size:18px}
 .filters button{font:600 12px monospace;text-transform:uppercase;letter-spacing:.05em;background:#26231d;color:#cdbf9c;border:1px solid #3a352c;border-radius:6px;padding:6px 11px;margin-right:6px;cursor:pointer}
 .filters button.on{background:#7dd3a0;color:#11100e;border-color:#7dd3a0}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;padding:18px 20px}
 .card{background:#1b1916;border:1px solid #322e27;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
 .card img{width:100%;height:230px;object-fit:contain;background:#0c0b0a;display:block}
 .card .body{padding:11px 13px}
 .ttl{font-weight:700;font-size:15px;margin-bottom:2px}
 .meta{font:11px monospace;color:#8b8475;margin-bottom:8px;word-break:break-all}
 .badge{display:inline-block;font:700 9px monospace;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border-radius:4px;margin-bottom:8px}
 .b-image{background:#7a2d2d;color:#ffd9d9}.b-place{background:#2d5a7a;color:#d9ecff}.b-title{background:#6a5a2d;color:#fff3d9}.b-date{background:#3a3a3a;color:#ddd}.b-style-unmapped{background:#5a2d6a;color:#f0d9ff}
 .chg{font:13px monospace;line-height:1.6}
 .from{color:#c98b8b;text-decoration:line-through}.to{color:#9fe0b8}
 .reason{color:#cdbf9c;font-size:12.5px;margin-top:7px;font-style:italic}
 a.qa{color:#7dd3a0;font:11px monospace;text-decoration:none}
 .hide{display:none}
</style></head><body>
<header><h1>Curate review queue &middot; ${items.length} items</h1>
<div class="filters">
 <button data-f="all" class="on">all (${items.length})</button>
 ${["image","place","title","style-unmapped","date"].filter(t=>counts[t]).map(t=>`<button data-f="${t}">${t} (${counts[t]})</button>`).join("")}
</div></header>
<div class="grid" id="grid">
${items.map(it => {
  const qid = (String(it.id).match(/Q\d+/) || [it.id])[0];
  const chg = it.type === "image"
    ? `<div class="reason">⚠ ${esc(it.issue || "")} — ${esc(it.reason || "")}</div>${it.suggestedUrl ? `<div class="chg">suggested: <a href="${esc(it.suggestedUrl)}" target="_blank">${esc(it.suggestedUrl).slice(0,60)}</a></div>` : ""}`
    : it.type === "style-unmapped"
    ? `<div class="chg">style → <span class="to">${esc(it.suggested || "")}</span></div>`
    : `<div class="chg"><span class="from">${esc(String(it.from ?? "—"))}</span> &rarr; <span class="to">${esc(String(it.to ?? "—"))}</span></div>`;
  return `<div class="card" data-type="${it.type}">
   <img src="${esc(it.img)}" loading="lazy" onerror="this.style.opacity=.25">
   <div class="body">
    <span class="badge b-${it.type}">${it.type}</span>
    <div class="ttl">${esc(it.curTitle || it.title)}</div>
    <div class="meta">${esc(it.artist || "anon")} &middot; ${esc(it.id)}</div>
    ${chg}
    <div style="margin-top:9px"><a class="qa" href="https://gesso.katswint.com/?qa=${esc(qid)}" target="_blank">▶ open live ?qa</a></div>
   </div></div>`;
}).join("\n")}
</div>
<script>
 const btns=[...document.querySelectorAll('.filters button')],cards=[...document.querySelectorAll('.card')];
 btns.forEach(b=>b.onclick=()=>{btns.forEach(x=>x.classList.toggle('on',x===b));const f=b.dataset.f;
   cards.forEach(c=>c.classList.toggle('hide',f!=='all'&&c.dataset.type!==f));});
</script></body></html>`;

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c])); }
writeFileSync("data/incoming/curate/review.html", html);
console.error(`wrote data/incoming/curate/review.html — ${items.length} items (${Object.entries(counts).map(([k,v])=>k+":"+v).join(", ")})`);
