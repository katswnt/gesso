// Dedicated FSA/OWI photo harvest (Library of Congress) — US-government works = public domain.
// Scopes to the FSA/OWI b&w negatives collection, verifies each photo's contributor, pulls the LoC
// image (tile.loc.gov, reliable). Stages to data/incoming/fsa-fetched.json. Run: node scripts/fetch-fsa.mjs
import { readFileSync, writeFileSync } from "node:fs";
const UA="GessoFSA/1.0 (kathryn.swint@gmail.com)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PHOTOGRAPHERS=[
  {name:"Dorothea Lange", surname:"lange", cap:45, must:["2017762849"]}, // 2017762849 = Migrant Mother
  {name:"Walker Evans", surname:"evans", cap:45, must:[]},
];
const COLL="https://www.loc.gov/collections/fsa-owi-black-and-white-negatives/";
async function loc(u){ for(let t=0;t<5;t++){ try{ const r=await fetch(u,{headers:{"User-Agent":UA,"Accept":"application/json"}});
  if(r.status===429||r.status>=500){ await sleep(2500*(t+1)); continue; } if(!r.ok) return null;
  const txt=await r.text(); try{ return JSON.parse(txt); }catch{ return null; } }catch(e){ await sleep(1500*(t+1)); } } return null; }
const bigImg=x=>{ const u=(x.image_url||[]).filter(s=>s.includes("tile.loc.gov")).slice(-1)[0]; return u?u.split("#")[0]:null; };
const itemNo=id=>{ const m=String(id).match(/item\/(\w+)/); return m?m[1]:null; };
const yearOf=s=>{ const m=String(s||"").match(/(1[89]\d\d|20\d\d)/); return m?parseInt(m[1],10):null; };

const pool=JSON.parse(readFileSync("data/pool.js","utf8").match(/\[[\s\S]*\]/)[0]);
const have=new Set(pool.map(p=>p.id));
const out=[];
for(const ph of PHOTOGRAPHERS){
  const cands=new Map(); // itemNo -> {id, img}
  for(const mid of ph.must) cands.set(mid,{id:`http://www.loc.gov/item/${mid}/`, img:null});
  for(let page=1; page<=6 && cands.size < ph.cap*2; page++){
    const j=await loc(`${COLL}?q=${encodeURIComponent(ph.surname)}&fo=json&c=50&sp=${page}&at=results`); await sleep(400);
    const r=j&&j.results||[]; if(!r.length) break;
    for(const x of r){ const no=itemNo(x.id); if(!no||!/\/item\//.test(x.id)) continue; const img=bigImg(x); if(!img) continue;
      if(!cands.has(no)) cands.set(no,{id:x.id,img,title:x.title}); }
  }
  let kept=0;
  for(const [no,c] of cands){ if(kept>=ph.cap) break; const id="loc"+no;
    if(have.has(id)) continue;
    const j=await loc(`https://www.loc.gov/item/${no}/?fo=json&at=item`); await sleep(300);
    const it=j&&j.item; if(!it) continue;
    const contribs=(it.contributor_names||[]).join(" | ").toLowerCase();
    if(!contribs.includes(ph.surname)) continue;               // verify attribution
    const img=c.img||bigImg(it)|| (it.image_url? it.image_url.filter(s=>s.includes("tile.loc.gov")).slice(-1)[0]:null);
    if(!img) continue;
    const y=yearOf(it.date)||yearOf(it.created_published&&it.created_published[0])||yearOf(it.sort_date);
    if(y==null) continue;
    let title=(Array.isArray(it.title)?it.title[0]:it.title)||c.title||"Untitled";
    title=title.replace(/\s+/g," ").trim(); if(title.length>120) title=title.slice(0,117)+"…";
    out.push({ id, title, artist:ph.name, y, place:"United States of America", region:"North America",
      medium:"Photograph", style:"Documentary photography", styleKind:"movement",
      img: img.split("#")[0], src:"loc-fsa", govReview:true });
    have.add(id); kept++;
  }
  console.error(`✓ ${ph.name}: ${kept} FSA photos (from ${cands.size} candidates)`);
}
writeFileSync("data/incoming/fsa-fetched.json",JSON.stringify(out,null,1));
console.log(`\nSTAGED ${out.length} FSA photos → data/incoming/fsa-fetched.json`);
const by={}; out.forEach(o=>by[o.artist]=(by[o.artist]||0)+1); console.log(by);
