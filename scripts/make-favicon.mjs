// Generate real PNG favicons (cross-browser, incl. older Safari) — no external deps.
// Brand: cream ground, ultramarine rounded blob, soft cream "gesso dab" dot.
// Run: node scripts/make-favicon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const CREAM=[246,244,238,255], BLUE=[34,48,184,255];

function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(type,data){const t=Buffer.from(type,"ascii");const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const body=Buffer.concat([t,data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,crc]);}

function png(size){
  const px=Buffer.alloc(size*size*4);
  const cx=size*0.52, cy=size*0.5, r=size*0.46;        // blob (circle-ish)
  const dx=size*0.37, dy=size*0.37, dr=size*0.12;       // dab dot
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    let col=[0,0,0,0]; // transparent ground (favicons look best transparent)
    const inBlob=((x-cx)**2/(r*r)+(y-cy)**2/(r*r*0.92))<=1;
    if(inBlob) col=BLUE.slice();
    const inDab=((x-dx)**2+(y-dy)**2)<=dr*dr;
    if(inDab&&inBlob) col=[246,244,238,235];
    px[i]=col[0];px[i+1]=col[1];px[i+2]=col[2];px[i+3]=col[3];
  }
  // add filter byte (0) per row
  const raw=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;px.copy(raw,y*(size*4+1)+1,y*size*4,(y+1)*size*4);}
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}

const p64 = png(64);
writeFileSync("favicon.png", p64);
writeFileSync("apple-touch-icon.png", png(180));
// favicon.ico — ICO container wrapping the 64px PNG (modern browsers accept PNG-in-ICO)
const dir = Buffer.alloc(22);
dir.writeUInt16LE(0,0); dir.writeUInt16LE(1,2); dir.writeUInt16LE(1,4); // reserved, type=icon, count=1
dir.writeUInt8(64,6); dir.writeUInt8(64,7); dir.writeUInt8(0,8); dir.writeUInt8(0,9); // w,h,colors,reserved
dir.writeUInt16LE(1,10); dir.writeUInt16LE(32,12); // planes, bpp
dir.writeUInt32LE(p64.length,14); dir.writeUInt32LE(22,18); // size, offset
writeFileSync("favicon.ico", Buffer.concat([dir, p64]));
console.log("wrote favicon.png (64) + apple-touch-icon.png (180) + favicon.ico");
