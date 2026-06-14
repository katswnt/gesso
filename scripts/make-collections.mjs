// Compute Collections-page data from the pool → data/collections.js (window.ARTEFACTUM_COLLECTIONS).
// Run: node scripts/make-collections.mjs
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(readFileSync("data/pool.js","utf8").replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
const by=(f)=>{const o={};for(const p of pool){const k=f(p);if(k)o[k]=(o[k]||0)+1;}return Object.entries(o).sort((a,b)=>b[1]-a[1]);};
const era=p=>{const y=p.y;return y<0?"Before 1 CE":y<500?"1–500":y<1400?"500–1400":y<1600?"1400–1600":y<1750?"1600–1750":y<1860?"1750–1860":y<1900?"1860–1900":"1900+";};

// pull-pipeline src -> source bucket (the open collection/dataset we pulled from)
const BUCKET={aic:"aic",modern:"aic",met:"met","met-extra":"met",cleveland:"cleveland",harvard:"harvard",va:"va",
  smithsonian:"smithsonian",wd:"wiki",wikidata:"wiki",wdmus:"wiki",wdafrica:"wiki",wdculture:"wiki"};
const META={
  aic:{name:"Art Institute of Chicago",city:"Chicago, USA",lat:41.8796,lng:-87.6237,url:"https://www.artic.edu",blurb:"Open-access API; thousands of CC0 public-domain works."},
  met:{name:"The Metropolitan Museum of Art",city:"New York, USA",lat:40.7794,lng:-73.9632,url:"https://www.metmuseum.org",blurb:"CC0 open access — a global collection, strong outside the West."},
  wiki:{name:"Wikidata & Wikimedia Commons",city:"Distributed · online",lat:null,lng:null,url:"https://www.wikidata.org",blurb:"The famous canon: metadata from Wikidata, images from Commons; collections incl. the Prado, Uffizi, Tokyo & Cairo."},
  cleveland:{name:"Cleveland Museum of Art",city:"Cleveland, USA",lat:41.5085,lng:-81.6116,url:"https://www.clevelandart.org",blurb:"Open Access — CC0 images and data since 2019."},
  harvard:{name:"Harvard Art Museums",city:"Cambridge, USA",lat:42.3744,lng:-71.1144,url:"https://www.harvardartmuseums.org",blurb:"One open API across three museums; deep Asian & Islamic holdings."},
  va:{name:"Victoria and Albert Museum",city:"London, UK",lat:51.4966,lng:-0.1722,url:"https://www.vam.ac.uk",blurb:"The V&A — the world's leading art &amp; design collection, via API."},
  smithsonian:{name:"Smithsonian Open Access",city:"Washington, DC, USA",lat:38.8888,lng:-77.0260,url:"https://www.si.edu",blurb:"CC0 across the Smithsonian, incl. the National Museums of African & Asian Art."},
};
const counts={};for(const p of pool){const b=BUCKET[p.src]||"wiki";counts[b]=(counts[b]||0)+1;}
const sources=Object.keys(META).map(k=>({...META[k],count:counts[k]||0})).sort((a,b)=>b.count-a.count);

// the famous collections we actually source (most-recognized works, via Wikidata/Commons)
const canon=[
  {name:"Musée du Louvre",city:"Paris",url:"https://www.louvre.fr",work:"Mona Lisa"},
  {name:"Museo del Prado",city:"Madrid",url:"https://www.museodelprado.es",work:"Las Meninas"},
  {name:"National Gallery",city:"London",url:"https://www.nationalgallery.org.uk",work:"Sunflowers"},
  {name:"Galleria degli Uffizi",city:"Florence",url:"https://www.uffizi.it",work:"The Birth of Venus"},
  {name:"Rijksmuseum",city:"Amsterdam",url:"https://www.rijksmuseum.nl",work:"The Night Watch"},
  {name:"National Gallery of Art",city:"Washington, DC",url:"https://www.nga.gov",work:"Ginevra de' Benci"},
  {name:"Fine Arts Museums of SF",city:"San Francisco",url:"https://www.famsf.org",work:"de Young collection"},
  {name:"National Palace Museum",city:"Taipei",url:"https://www.npm.gov.tw",work:"Dwelling in the Fuchun Mountains"},
  {name:"Tokyo National Museum",city:"Tokyo",url:"https://www.tnm.jp",work:"Higashiyama screens"},
  {name:"National Museum of Korea",city:"Seoul",url:"https://www.museum.go.kr",work:"Pensive Bodhisattva"},
  {name:"Topkapı Palace Museum",city:"Istanbul",url:"https://www.millisaraylar.gov.tr",work:"Ottoman court arts"},
  {name:"Egyptian Museum",city:"Cairo",url:"https://egymonuments.gov.eg",work:"Narmer Palette"},
];
const out={ total:pool.length, region:by(p=>p.region), origins:by(p=>p.place).slice(0,20),
  eras:["Before 1 CE","1–500","500–1400","1400–1600","1600–1750","1750–1860","1860–1900","1900+"].map(k=>[k,pool.filter(p=>era(p)===k).length]),
  sources, canon };
writeFileSync("data/collections.js","window.ARTEFACTUM_COLLECTIONS="+JSON.stringify(out)+";\n");
console.log("wrote data/collections.js | total",out.total,"| sources",sources.map(s=>s.name.split(" ")[0]+":"+s.count).join(" "));
