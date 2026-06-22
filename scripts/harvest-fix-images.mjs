// Re-pull each enriched record's image from the authoritative English Wikipedia article lead image
// (the article's main image is the artwork itself) — fixes wbsearch's wrong-entity P18 images.
import { readFileSync, writeFileSync } from "node:fs";
const UA={headers:{"User-Agent":"gesso-harvest/1.0 (kathryn.swint@gmail.com)"}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function gj(u){ for(let t=0;t<5;t++){ try{ const r=await fetch(u,UA); if(r.ok)return await r.json(); if(r.status===404)return null; }catch{} await sleep(700*(t+1)); } return undefined; }
async function findArticle(title,artist){
  const q=`${title} ${artist||""}`.trim();
  const j=await gj(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=1&srsearch=${encodeURIComponent(q)}`);
  return j&&j.query&&j.query.search&&j.query.search[0]?j.query.search[0].title:null;
}
async function leadImage(article){
  const j=await gj(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}`);
  if(!j)return null;
  const src=(j.originalimage&&j.originalimage.source)||(j.thumbnail&&j.thumbnail.source); if(!src)return null;
  // src is an upload.wikimedia.org URL; extract the Commons filename → FilePath form with width
  const m=src.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^\/]+?)(?:\/\d+px-[^\/]+)?$/);
  const file=m?decodeURIComponent(m[1]):null;
  return file?`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`:null;
}
let total=0,fixed=0,kept=0,failed=0; const fails=[];
for(let i=0;i<8;i++){ const path=`data/incoming/famous-harvest/enriched-${i}.json`; let arr;
  try{arr=JSON.parse(readFileSync(path,"utf8"));}catch{continue;}
  for(const r of arr){ total++; await sleep(250);
    const art=await findArticle(r.title,r.artist); await sleep(250);
    const img=art?await leadImage(art):null;
    if(img){ r.imgOld=r.img; r.img=img; r.imgArticle=art; fixed++; }
    else { failed++; fails.push(`${r.title} — ${r.artist||"anon"}`); kept++; }
  }
  writeFileSync(path,JSON.stringify(arr,null,1));
}
console.error(`records=${total} image re-pulled=${fixed} failed(kept old)=${failed}`);
for(const f of fails)console.error("  FAIL: "+f);
