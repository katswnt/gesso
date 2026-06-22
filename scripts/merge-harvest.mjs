// Merge enriched famous-harvest records into pool.js + teach-works.js + hotspots.js. Validates each record.
// Usage: node scripts/merge-harvest.mjs data/incoming/famous-harvest/enriched-*.json
import { readFileSync, writeFileSync } from "node:fs";
import { isPlaceCanonical, continentOf } from "./lib/places.mjs";
const files=process.argv.slice(2);
const html=readFileSync("index.html","utf8");
const MOV=new Set([...html.slice(html.indexOf("const MOVEMENTS={"),html.indexOf("const MOV_FAMILY=")).matchAll(/"([^"]+)":\{dates:/g)].map(m=>m[1]));
const BUCKETS=new Set(["Oil paint","Tempera","Fresco","Watercolor","Ink","Drawing","Woodblock print","Engraving","Lithograph","Bronze","Copper","Marble","Stone","Wood","Ivory","Jade","Ceramic","Glass","Textile","Gold","Silver","Lacquer","Photograph","Mixed media","Leather","Wax","Beadwork"]);
const okC=v=>typeof v==="number"&&v>=0&&v<=100;

const pt=readFileSync("data/pool.js","utf8"); const pool=JSON.parse(pt.slice(pt.indexOf("["),pt.lastIndexOf("]")+1));
const nrm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
const havePid=new Set(pool.map(p=>p.id)), haveTA=new Set(pool.map(p=>nrm(p.title)+"|"+nrm(p.artist)));
const tt=readFileSync("data/teach-works.js","utf8"); const teach=JSON.parse(tt.slice(tt.indexOf("{",tt.indexOf(".work")),tt.lastIndexOf("}")+1));
const ht=readFileSync("data/hotspots.js","utf8"); const hot=JSON.parse(ht.slice(ht.indexOf("{"),ht.lastIndexOf("}")+1));

let added=0; const skip=[];
for(const f of files){ let arr; try{arr=JSON.parse(readFileSync(f,"utf8"));}catch(e){console.error("bad file",f,e.message);continue;}
 for(const r of arr){
   const why=[];
   if(!r||!r.id||!r.title){skip.push("no id/title");continue;}
   if(havePid.has(r.id)){skip.push(r.id+" dup-id");continue;}
   if(haveTA.has(nrm(r.title)+"|"+nrm(r.artist))){skip.push(r.title+" dup (title+artist)");continue;}
   if(!r.img){why.push("no img");}
   if(!BUCKETS.has(r.medium))why.push("bad medium "+r.medium);
   if(!r.style||!MOV.has(r.style))why.push("style not in MOVEMENTS: "+r.style);
   if(!isPlaceCanonical(r.place))why.push("place noncanon "+r.place);
   else { const c=continentOf(r.place); if(c&&c!==r.region)why.push(`region ${r.region}!=${c}`); }
   if(!(typeof r.lat==="number"&&typeof r.lng==="number"))why.push("no coords");
   const cues=Array.isArray(r.cues)?r.cues.filter(c=>typeof c==="string"&&c.includes("→")):[];
   const guide=Array.isArray(r.guide)?r.guide.filter(g=>g&&g.q&&g.a):[];
   const notes=Array.isArray(r.notes)?r.notes.filter(n=>n&&n.head&&n.body):[];
   if(cues.length!==4)why.push("cues!=4");
   if(guide.length<5)why.push("guide<5");
   if(notes.length<4)why.push("notes<4");
   if(why.length){skip.push(`${r.title}: ${why.join("; ")}`);continue;}
   // pool record
   const rec={id:r.id,title:r.title,artist:r.artist||"",y:r.y,lat:r.lat,lng:r.lng,place:r.place,region:r.region,medium:r.medium,style:r.style,styleKind:r.styleKind||"movement",fame:r.fame||1,img:r.img,src:"wd",cats:Array.isArray(r.cats)&&r.cats.length?r.cats:(r.artist?["when","where","medium","style","artist"]:["when","where","medium","style"])};
   pool.push(rec); havePid.add(r.id); haveTA.add(nrm(r.title)+"|"+nrm(r.artist));
   teach[r.id]={why:r.why,cues:cues.slice(0,4),guide:guide.map(g=>({q:g.q,a:g.a})),notes:notes.map(n=>{const o={head:n.head,body:n.body};if(okC(n.x)&&okC(n.y)){o.x=n.x;o.y=n.y;}return o;})};
   if(Array.isArray(r.hotspots)&&r.hotspots.length)hot[r.id]=r.hotspots.filter(h=>okC(h.x)&&okC(h.y)).map((h,i)=>({n:h.n||i+1,x:h.x,y:h.y}));
   added++;
 }
}
writeFileSync("data/pool.js","window.ARTEFACTUM_POOL = "+JSON.stringify(pool)+";\n");
writeFileSync("data/teach-works.js","window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(teach)+";\n");
writeFileSync("data/hotspots.js","window.ARTEFACTUM_HOTSPOTS="+JSON.stringify(hot)+";\n");
console.error(`added ${added} works | skipped ${skip.length}`);
for(const s of skip)console.error("  skip: "+s);
