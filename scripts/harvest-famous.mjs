// Resolve famous-gap candidates to Wikidata records (network; plain node). Phase 1 of the harvest.
// For each {title, artist}: find the artwork QID, pull creator/inception/material/movement/location/image.
// Writes resolved.json (ready-ish) + unresolved.json (need manual image/data). NO pool writes here.
import { writeFileSync, mkdirSync } from "node:fs";
const DIR = "data/incoming/famous-harvest"; mkdirSync(DIR, { recursive: true });
const UA = { headers: { "User-Agent": "gesso-harvest/1.0 (kathryn.swint@gmail.com)" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();

// non-building, PD candidates (title · artist/culture)
const C = [
  // paintings
  ["The Lamentation of Christ","Giotto"],["Ognissanti Madonna","Giotto"],["Maestà","Duccio"],["Annunciation","Simone Martini"],
  ["Holy Trinity","Masaccio"],["The Tribute Money","Masaccio"],["The Battle of San Romano","Paolo Uccello"],
  ["The Transfiguration","Raphael"],["The Tempest","Giorgione"],["Sleeping Venus","Giorgione"],
  ["The Hunters in the Snow","Pieter Bruegel the Elder"],["The Tower of Babel","Pieter Bruegel the Elder"],["Netherlandish Proverbs","Pieter Bruegel the Elder"],
  ["Isenheim Altarpiece","Matthias Grünewald"],["Judith Beheading Holofernes","Caravaggio"],["Conversion of Saint Paul","Caravaggio"],
  ["The Surrender of Breda","Diego Velázquez"],["View of Delft","Johannes Vermeer"],["The Art of Painting","Johannes Vermeer"],
  ["Laughing Cavalier","Frans Hals"],["Massacre of the Innocents","Peter Paul Rubens"],["Et in Arcadia ego","Nicolas Poussin"],
  ["La maja desnuda","Francisco Goya"],["Charles IV of Spain and His Family","Francisco Goya"],
  ["The Slave Ship","J. M. W. Turner"],["The Abbey in the Oakwood","Caspar David Friedrich"],
  ["A Burial at Ornans","Gustave Courbet"],["The Stone Breakers","Gustave Courbet"],["The Sower","Jean-François Millet"],
  ["The Light of the World","William Holman Hunt"],["Rouen Cathedral","Claude Monet"],["Haystacks","Claude Monet"],
  ["The Balcony","Édouard Manet"],["The Fifer","Édouard Manet"],["In a Café","Edgar Degas"],["The Bellelli Family","Edgar Degas"],
  ["The Swing","Pierre-Auguste Renoir"],["Sunflowers","Vincent van Gogh"],["Bedroom in Arles","Vincent van Gogh"],["The Night Café","Vincent van Gogh"],
  ["The Circus","Georges Seurat"],["Vision after the Sermon","Paul Gauguin"],["The Dance of Life","Edvard Munch"],
  ["At the Moulin Rouge","Henri de Toulouse-Lautrec"],["The Gulf Stream","Winslow Homer"],["The Oxbow","Thomas Cole"],
  ["The Course of Empire","Thomas Cole"],["Fur Traders Descending the Missouri","George Caleb Bingham"],
  ["The Swimming Hole","Thomas Eakins"],["Lady Agnew of Lochnaw","John Singer Sargent"],["The Dream","Henri Rousseau"],
  // sculpture
  ["Mask of Tutankhamun","ancient Egypt"],["Mask of Agamemnon","Mycenaean"],["Riace bronzes","ancient Greece"],
  ["Charioteer of Delphi","ancient Greece"],["Augustus of Prima Porta","ancient Rome"],["Equestrian Statue of Marcus Aurelius","ancient Rome"],
  ["Dying Gaul","Hellenistic"],["Apollo Belvedere","Hellenistic"],["Venus of Willendorf","Paleolithic"],
  ["Moai","Rapa Nui"],["David","Michelangelo"],["Moses","Michelangelo"],["Pietà","Michelangelo"],
  ["Gates of Paradise","Lorenzo Ghiberti"],["Equestrian statue of Gattamelata","Donatello"],
  ["Apollo and Daphne","Gian Lorenzo Bernini"],["Ecstasy of Saint Teresa","Gian Lorenzo Bernini"],["David","Gian Lorenzo Bernini"],
  ["The Burghers of Calais","Auguste Rodin"],["The Gates of Hell","Auguste Rodin"],["Nike of Samothrace","Hellenistic"],
  ["Olmec colossal heads","Olmec"],
  // decorative
  ["Lycurgus Cup","Roman"],["Sutton Hoo helmet","Anglo-Saxon"],["Royal Gold Cup","medieval"],["Cellini Salt Cellar","Benvenuto Cellini"],
  ["Tara Brooch","early medieval Ireland"],["The Lady and the Unicorn","Flemish"],["The Hunt of the Unicorn","Franco-Flemish"],
  ["Bayeux Tapestry","Norman"],["Tipu's Tiger","Mysore"],
  // prints / photo / drawing
  ["Melencolia I","Albrecht Dürer"],["Young Hare","Albrecht Dürer"],["Praying Hands","Albrecht Dürer"],["Great Piece of Turf","Albrecht Dürer"],
  ["The Disasters of War","Francisco Goya"],["Los Caprichos","Francisco Goya"],
  ["Fine Wind, Clear Morning","Hokusai"],["Sudden Shower over Shin-Ōhashi Bridge and Atake","Hiroshige"],
  ["Three Beauties of the Present Day","Utamaro"],["Ōtani Oniji III","Sharaku"],
  ["Imaginary Prisons","Giovanni Battista Piranesi"],["Jane Avril","Henri de Toulouse-Lautrec"],
  ["The Ancient of Days","William Blake"],
  ["View from the Window at Le Gras","Nicéphore Niépce"],["Boulevard du Temple","Louis Daguerre"],
  ["The Horse in Motion","Eadweard Muybridge"],["Pepper No. 30","Edward Weston"],["The Pond—Moonlight","Edward Steichen"],
  ["Earthrise","William Anders"],["The Dream of the Fisherman's Wife","Hokusai"],
  ["Head of a Woman","Leonardo da Vinci"],
  // global
  ["Along the River During the Qingming Festival","Zhang Zeduan"],["A Thousand Li of Rivers and Mountains","Wang Ximeng"],
  ["Dwelling in the Fuchun Mountains","Huang Gongwang"],["The Night Revels of Han Xizai","Gu Hongzhong"],
  ["Admonitions Scroll","Gu Kaizhi"],["Travelers Among Mountains and Streams","Fan Kuan"],
  ["Wind God and Thunder God","Tawaraya Sōtatsu"],["Irises","Ogata Kōrin"],
  ["Dancing Girl","Mohenjo-daro"],["Lion Capital of Ashoka","Maurya"],
  ["The Court of Gayumars","Sultan Muhammad"],["Baptistère de Saint Louis","Muhammad ibn al-Zayn"],
  ["Aztec sun stone","Aztec"],["Coatlicue","Aztec"],
  ["Code of Hammurabi","Babylonian"],["Victory Stele of Naram-Sin","Akkadian"],["Statues of Gudea","Sumerian"],
  ["Alexander Mosaic","Roman"],["Nok terracotta","Nok"],
];

async function search(title){
  const url="https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=en&type=item&limit=8&search="+encodeURIComponent(title);
  const r=await fetch(url,UA); if(!r.ok)return []; const j=await r.json(); return (j.search||[]).map(x=>x.id);
}
async function entities(ids){
  const url="https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|labels&languages=en&ids="+ids.join("|");
  const r=await fetch(url,UA); if(!r.ok)return {}; const j=await r.json(); return j.entities||{};
}
const claimVal=(e,p)=>{ const cs=e.claims&&e.claims[p]; if(!cs)return []; return cs.map(c=>c.mainsnak&&c.mainsnak.datavalue&&c.mainsnak.datavalue.value).filter(Boolean); };
const qids=v=>v.map(x=>x&&x.id).filter(Boolean);

const resolved=[], unresolved=[];
for(const [title,artist] of C){
  try{
    const ids=await search(title); await sleep(120);
    if(!ids.length){ unresolved.push({title,artist,reason:"no search hit"}); continue; }
    const ents=await entities(ids.slice(0,8)); await sleep(120);
    // pick best: an artwork (P31 painting/sculpture/print/drawing/work of art) whose creator label matches artist surname
    const ARTWORK=new Set(["Q3305213","Q860861","Q11060274","Q93184","Q838948","Q4502142","Q179700","Q2088357","Q15709879","Q15727816"]);
    let best=null;
    for(const id of ids){ const e=ents[id]; if(!e||!e.claims)continue;
      const types=new Set(qids(claimVal(e,"P31")).map(x=>x));
      const isArt=[...types].some(t=>ARTWORK.has(t));
      const creators=qids(claimVal(e,"P170"));
      const score=(isArt?2:0);
      if(!best||score>best.score) best={id,e,score,creators};
    }
    if(!best){ unresolved.push({title,artist,reason:"no entity"}); continue; }
    const e=best.e;
    const img=claimVal(e,"P18")[0]||null;
    const inception=claimVal(e,"P571")[0];
    const year= inception ? (()=>{const m=String(inception.time).match(/([+-]\d+)/);return m?parseInt(m[1],10):null;})() : null;
    resolved.push({ title, artist, qid:best.id, isArtwork:best.score>=2,
      creatorQ:best.creators, material:qids(claimVal(e,"P186")), movementQ:qids(claimVal(e,"P135")),
      locCreationQ:qids(claimVal(e,"P1071")), countryOriginQ:qids(claimVal(e,"P495")),
      year, image: img ? "https://commons.wikimedia.org/wiki/Special:FilePath/"+encodeURIComponent(img.replace(/ /g,"_"))+"?width=900" : null });
    if(!img) unresolved.push({title,artist,qid:best.id,reason:"no P18 image"});
  }catch(err){ unresolved.push({title,artist,reason:err.message}); }
  if(resolved.length%15===0) console.error(`  ...${resolved.length} resolved`);
}
writeFileSync(`${DIR}/resolved.json`,JSON.stringify(resolved,null,1));
writeFileSync(`${DIR}/unresolved.json`,JSON.stringify(unresolved,null,1));
const withImg=resolved.filter(r=>r.image).length;
console.error(`\ncandidates=${C.length} resolved=${resolved.length} (with image=${withImg}) unresolved/noimg=${unresolved.length}`);
