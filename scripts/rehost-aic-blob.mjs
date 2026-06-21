// Re-host AIC images to Vercel Blob (a CDN that gatekeeps no one) — AIC's Cloudflare blocks proxies
// and challenges mobile IPs, so its images break for phone users. Downloads each AIC image (this
// machine's residential IP is allowed), uploads to Blob at aic/<id>.jpg, rewrites pool img -> Blob URL
// (keeps the AIC original in aicImg). Idempotent + resumable. Needs BLOB_READ_WRITE_TOKEN in .env.
// Run: node scripts/rehost-aic-blob.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { put } from "@vercel/blob";
// load token from .env.local or .env (no dotenv dep)
const env=(existsSync(".env.local")?readFileSync(".env.local","utf8"):"")+"\n"+(existsSync(".env")?readFileSync(".env","utf8"):"");
const TOKEN=process.env.BLOB_READ_WRITE_TOKEN||(env.match(/BLOB_READ_WRITE_TOKEN=(.+)/)||[])[1]?.trim().replace(/^["']|["']$/g,"");
if(!TOKEN){ console.error("✗ BLOB_READ_WRITE_TOKEN not found in .env.local / .env"); process.exit(1); }
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const raw=readFileSync("data/pool.js","utf8");
const pool=JSON.parse(raw.slice(raw.indexOf("["),raw.lastIndexOf("]")+1));
const targets=pool.filter(p=>/artic\.edu\/iiif/.test(p.img||""));
console.log("AIC works to re-host to Blob:",targets.length);
const save=()=>writeFileSync("data/pool.js", raw.slice(0,raw.indexOf("["))+JSON.stringify(pool)+raw.slice(raw.lastIndexOf("]")+1));
let done=0, fail=0; const fails=[];
for(const p of targets){
  try{
    const r=await fetch(p.img,{headers:{"User-Agent":UA,"Accept":"image/*","Referer":"https://www.artic.edu/"}});
    if(!r.ok){ throw new Error("download "+r.status); }
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length<1000) throw new Error("tiny file "+buf.length);
    const { url }=await put(`aic/${p.id}.jpg`, buf, {access:"public", addRandomSuffix:false, allowOverwrite:true, contentType:"image/jpeg", token:TOKEN});
    if(!p.aicImg) p.aicImg=p.img;
    p.img=url; p.src="aic-blob";
    done++;
  }catch(e){ fail++; fails.push(p.id+" "+(p.title||"").slice(0,30)+" — "+e.message); }
  if((done+fail)%25===0){ save(); console.error(`  ${done+fail}/${targets.length} | ok ${done} fail ${fail}`); }
  await sleep(120);
}
save();
writeFileSync("data/incoming/aic-blob-fails.json",JSON.stringify(fails,null,1));
console.log(`\nre-hosted ${done}/${targets.length} to Blob | failed ${fail}`);
if(fails.length) console.log("fails -> data/incoming/aic-blob-fails.json (stay on AIC)");
const left=pool.filter(p=>/artic\.edu\/iiif/.test(p.img||"")).length;
console.log("AIC-direct remaining:",left);
