// Data-quality audit for the pool. Read-only; prints a report + writes flag lists to data/incoming/audit/.
// Run: node scripts/audit-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
let overlay={}; try{ overlay=JSON.parse(readFileSync("data/fame.js","utf8").replace("window.ARTEFACTUM_FAME=","").replace(/;\s*$/,"")); }catch{}
const fameOf=id=>overlay[id]||0;
const dec=s=>{try{return decodeURIComponent(s)}catch{return s}};
mkdirSync("data/incoming/audit",{recursive:true});

// where famous artists actually WORKED (origin), to catch place mismatches (El Greco/Goya class)
const ARTIST_COUNTRY={ "el greco":"Spain","theotokop":"Spain","goya":"Spain","velazquez":"Spain","velázquez":"Spain","murillo":"Spain","zurbaran":"Spain","sorolla":"Spain","picasso":"Spain","miro":"Spain","dali":"Spain","dalí":"Spain",
 "van gogh":"Netherlands","rembrandt":"Netherlands","vermeer":"Netherlands","hals":"Netherlands","mondrian":"Netherlands","steen":"Netherlands","ruisdael":"Netherlands","hobbema":"Netherlands",
 "rubens":"Belgium","van eyck":"Belgium","van dyck":"Belgium","bruegel":"Belgium","brueghel":"Belgium","memling":"Belgium","bosch":"Netherlands",
 "durer":"Germany","dürer":"Germany","holbein":"Germany","cranach":"Germany","friedrich":"Germany","klee":"Germany","richter":"Germany","grünewald":"Germany",
 "monet":"France","manet":"France","renoir":"France","degas":"France","cezanne":"France","cézanne":"France","gauguin":"France","matisse":"France","ingres":"France","delacroix":"France","courbet":"France","david":"France","poussin":"France","fragonard":"France","watteau":"France","millet":"France","caillebotte":"France","seurat":"France","toulouse":"France","corot":"France","géricault":"France","gericault":"France","bonnard":"France","redon":"France","rodin":"France",
 "leonardo":"Italy","michelangelo":"Italy","raphael":"Italy","botticelli":"Italy","titian":"Italy","caravaggio":"Italy","tintoretto":"Italy","veronese":"Italy","bernini":"Italy","giotto":"Italy","bellini":"Italy","mantegna":"Italy","canaletto":"Italy","modigliani":"Italy","piero della":"Italy",
 "turner":"United Kingdom","constable":"United Kingdom","gainsborough":"United Kingdom","reynolds":"United Kingdom","blake":"United Kingdom","millais":"United Kingdom","rossetti":"United Kingdom","hogarth":"United Kingdom","bacon":"United Kingdom",
 "sargent":"United States","whistler":"United States","homer":"United States","eakins":"United States","cassatt":"United States","hopper":"United States","okeeffe":"United States","o'keeffe":"United States","pollock":"United States","warhol":"United States","copley":"United States","wood":"United States","wyeth":"United States","bierstadt":"United States","church":"United States","cole":"United States",
 "munch":"Norway","klimt":"Austria","schiele":"Austria","kandinsky":"Russia","malevich":"Russia","repin":"Russia","hokusai":"Japan","hiroshige":"Japan","utamaro":"Japan","kuniyoshi":"Japan" };

const flag={artistOrigin:[],fameCollision:[],entities:[],dupTitleArtist:[],sharedImage:[],badImageName:[],missing:[]};

// 1. artist-origin mismatch
for(const p of pool){ const a=(p.artist||"").toLowerCase(); if(!a||!p.place)continue;
  for(const k in ARTIST_COUNTRY){ if(a.includes(k)){ const want=ARTIST_COUNTRY[k];
    if(!p.place.includes(want)){ flag.artistOrigin.push({id:p.id,title:p.title,artist:p.artist,place:p.place,expect:want}); } break; } } }
// 2. fame collisions: anon + short generic-ish title + high fame
for(const p of pool){ if(!p.artist && fameOf(p.id)>300 && (p.title||"").split(/\s+/).length<=2 && !/[0-9]/.test(p.title)) flag.fameCollision.push({id:p.id,title:p.title,fame:fameOf(p.id)}); }
// 3. non-artwork entities (title is a bare country/region)
const PLACEY=/^(north|south|east|west|central)?\s*(africa|america|asia|europe|oceania|arabia)$|^(the )?(ottoman empire|roman empire|byzantine empire|holy roman empire|kingdom of \w+|republic of \w+|duchy of \w+)$/i;
for(const p of pool){ if(PLACEY.test((p.title||"").trim())) flag.entities.push({id:p.id,title:p.title}); }
// 4. duplicates: exact title+artist
const seen={}; for(const p of pool){ const k=(p.title+"|"+(p.artist||"")).toLowerCase().replace(/[^a-z0-9]/g,""); if(seen[k])flag.dupTitleArtist.push({id:p.id,title:p.title,artist:p.artist}); else seen[k]=p.id; }
// 4b. shared image
const im={}; for(const p of pool){ const k=dec((p.img||"").replace(/[?&]width=\d+/,"").toLowerCase()); if(!k)continue; (im[k]=im[k]||[]).push(p.id); }
for(const k in im) if(im[k].length>1) flag.sharedImage.push({image:k.split("/").pop(),ids:im[k]});
// 5. bad image filenames
const BAD=/wasserzeichen|watermark|^.*\bverso\b|röntgen|x-ray|infrared|underdrawing|diagram|schema|condition|cross-section/i;
const fn=p=>{const m=(p.img||"").match(/(FilePath\/|\/)([^\/?]+\.(jpg|jpeg|png|tif|tiff))/i);return m?dec(m[2]):"";};
for(const p of pool){ if(BAD.test(fn(p))) flag.badImageName.push({id:p.id,title:p.title,file:fn(p)}); }
// 6. missing critical fields
for(const p of pool){ const m=[]; if(!p.place)m.push("place"); if(!p.region)m.push("region"); if(!p.img)m.push("img"); if(!p.y&&p.y!==0)m.push("year"); if(m.length)flag.missing.push({id:p.id,title:p.title,missing:m}); }

console.log("=== DATA AUDIT ("+pool.length+" works) ===");
for(const k in flag) console.log(`  ${k.padEnd(16)} ${flag[k].length}`);
console.log("\n-- artist-origin mismatches (top 12) --");
flag.artistOrigin.slice(0,12).forEach(x=>console.log(`   ${x.title.slice(0,30)} — ${x.artist.slice(0,16)} | ${x.place} → expect ${x.expect}`));
console.log("\n-- fame collisions (top 12) --"); flag.fameCollision.sort((a,b)=>b.fame-a.fame).slice(0,12).forEach(x=>console.log(`   ${x.title} (fame ${x.fame})`));
for(const k in flag) writeFileSync(`data/incoming/audit/${k}.json`, JSON.stringify(flag[k],null,1));
console.log("\nwrote flag lists → data/incoming/audit/*.json");
