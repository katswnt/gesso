// Re-host Harvard images to Vercel Blob — some networks can't reach Harvard's servers at all (the image
// fails even on harvard's own site), so no URL tweak helps; serve from Blob instead. Downloads each at a
// zoom-friendly 1600px (one file used for both card + zoom), uploads to Blob harvard/<id>.jpg, rewrites
// img → Blob URL (src harvard-blob; keeps harvardOrig). Needs BLOB_READ_WRITE_TOKEN. Run after resolve-harvard.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
const env=(existsSync(".env.local")?readFileSync(".env.local","utf8"):"")+"\n"+(existsSync(".env")?readFileSync(".env","utf8"):"");
const TOKEN=process.env.BLOB_READ_WRITE_TOKEN||(env.match(/BLOB_READ_WRITE_TOKEN=(.+)/)||[])[1]?.trim().replace(/^["']|["']$/g,"");
if(!TOKEN){ console.error("✗ no BLOB_READ_WRITE_TOKEN"); process.exit(1); }
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const targets=pool.filter(p=>/ids\.lib\.harvard\.edu/.test(p.img||""));
console.log("Harvard images to re-host to Blob:",targets.length);
const save=()=>writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
let done=0,fail=0; const fails=[];
for(const p of targets){
  try{
    const src=p.img.replace(/\/full\/[^/]+\//,"/full/1600,/"); // zoom-friendly size
    const r=await fetch(src,{headers:{"User-Agent":UA}});
    if(!r.ok) throw new Error("download "+r.status);
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length<1000) throw new Error("tiny "+buf.length);
    const { url }=await put(`harvard/${p.id}.jpg`, buf, {access:"public",addRandomSuffix:false,allowOverwrite:true,contentType:"image/jpeg",token:TOKEN});
    if(!p.harvardOrig) p.harvardOrig=p.img;
    p.img=url; p.src="harvard-blob"; done++;
  }catch(e){ fail++; fails.push(p.id+" — "+e.message); }
  if((done+fail)%25===0){ save(); console.error(`  ${done+fail}/${targets.length} | ok ${done} fail ${fail}`); }
  await sleep(120);
}
save();
writeFileSync("data/incoming/harvard-blob-fails.json",JSON.stringify(fails,null,1));
console.log(`\nre-hosted ${done}/${targets.length} Harvard images to Blob | failed ${fail}`);
