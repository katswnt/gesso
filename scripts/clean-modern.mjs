// Normalize fetched modern works: set place = artist's country of origin (the map answer is origin,
// NOT holding museum), recompute region, fill known missing years, drop any still year-less.
import { readFileSync, writeFileSync } from "node:fs";
const ORIGIN={ // artist surname → origin country (nationality, the map-round answer)
 "klimt":"Austria","schiele":"Austria","modigliani":"Italy","munch":"Norway","kandinsky":"Russia",
 "mondrian":"Netherlands","klee":"Switzerland","matisse":"France","léger":"France","leger":"France",
 "malevich":"Russia","boccioni":"Italy","marc":"Germany","macke":"Germany","rousseau":"France",
 "gérôme":"France","gerome":"France","coolidge":"United States of America","kirchner":"Germany",
 "monet":"France","modersohn-becker":"Germany" };
const REGION={"United States of America":"North America"}; // everything else here is Europe
const YEAR={"Music":1910,"The City":1919,"Three Women":1921}; // fill known gaps
const surname=a=>a.toLowerCase().split(/\s+/).pop();
let recs=JSON.parse(readFileSync("data/incoming/modern-fetched.json","utf8"));
const out=[];
for(const r of recs){
  if(r.y==null && YEAR[r.title]!=null) r.y=YEAR[r.title];
  if(r.y==null){ console.log("drop (no year):",r.title,"—",r.artist); continue; }
  const co=ORIGIN[surname(r.artist)];
  if(co){ r.place=co; r.region=REGION[co]||"Europe"; }
  out.push(r);
}
writeFileSync("data/incoming/modern-fetched.json",JSON.stringify(out,null,1));
console.log("clean modern set:",out.length);
for(const r of out) console.log(String(r.y).padEnd(6),r.place.padEnd(26),r.artist.padEnd(24),r.title);
