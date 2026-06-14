// Compute Collections-page stats from the pool → data/collections.js (window.ARTEFACTUM_COLLECTIONS).
// Run: node scripts/make-collections.mjs
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const by=(f)=>{const o={};for(const p of pool){const k=f(p);if(k)o[k]=(o[k]||0)+1;}return Object.entries(o).sort((a,b)=>b[1]-a[1]);};
const era=p=>{const y=p.y;return y<0?"Before 1 CE":y<500?"1–500":y<1400?"500–1400":y<1600?"1400–1600":y<1750?"1600–1750":y<1860?"1750–1860":y<1900?"1860–1900":"1900+";};
// our pull-pipeline src -> the open collection / dataset it came from
const SRC={aic:"Art Institute of Chicago",met:"The Metropolitan Museum of Art",cleveland:"Cleveland Museum of Art",
  harvard:"Harvard Art Museums",va:"Victoria & Albert Museum",smithsonian:"Smithsonian (African & Asian Art)",
  wikidata:"Wikidata / Wikimedia Commons",wd:"Wikidata / Wikimedia Commons",wdmus:"Wikidata museum collections",
  modern:"Art Institute of Chicago (modern, public domain)",mus:"Open museum APIs"};
const sources={};for(const p of pool){const s=SRC[p.src]||p.src||"Other";sources[s]=(sources[s]||0)+1;}
const out={
  total: pool.length,
  region: by(p=>p.region),
  origins: by(p=>p.place).slice(0,20),
  eras: ["Before 1 CE","1–500","500–1400","1400–1600","1600–1750","1750–1860","1860–1900","1900+"].map(k=>[k, pool.filter(p=>era(p)===k).length]),
  sources: Object.entries(sources).sort((a,b)=>b[1]-a[1]),
};
writeFileSync("data/collections.js","window.ARTEFACTUM_COLLECTIONS="+JSON.stringify(out)+";\n");
console.log("wrote data/collections.js | total",out.total,"| regions",out.region.length,"| sources",out.sources.length);
