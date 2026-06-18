// Fixtures for the medium classifier — the domain rule that "medium" is the material/process, not the
// support. Runs each case against BOTH scripts/lib/domain.mjs AND the copy extracted from index.html,
// so the two can't silently drift. Run: node tests/medium.test.mjs
import { readFileSync } from "node:fs";
import { simplifyMedium as libSimplify } from "../scripts/lib/domain.mjs";

// extract the client's simplifyMedium straight from index.html so we test the shipped code
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const fnSrc = html.match(/function simplifyMedium\(s\)\{[\s\S]*?return s\s*\?\s*"Mixed media"\s*:\s*"";\s*\}/);
if(!fnSrc) throw new Error("could not extract client simplifyMedium from index.html");
const clientSimplify = new Function(fnSrc[0] + "\nreturn simplifyMedium;")();

const CASES = [
  ["Oil on panel", "Oil paint"],            // paint beats the wood support
  ["oil on canvas", "Oil paint"],
  ["Tempera on wood", "Tempera"],
  ["Gelatin silver print", "Photograph"],   // process, not the silver
  ["Silver", "Silver"],                       // a genuine silver object
  ["Copper", "Copper"],                       // not Bronze
  ["Engraving on copperplate", "Woodblock print"], // print signal wins over copper
  ["Bronze", "Bronze"],
  ["Wood", "Wood"],
  ["Carved olive pit", "Wood"],               // fruit-stone carving → Wood, not Mixed media
  ["Albumen silver print from glass negative", "Photograph"],
  ["Fritware, underglaze-painted", "Ceramic"],
  ["Ink and gold on paper", "Ink"],
  ["", ""],
  ["assemblage of found plastic and wire", "Mixed media"], // genuine fallback
];

let pass=0, fail=0;
for(const [input, expected] of CASES){
  const a=libSimplify(input), b=clientSimplify(input);
  if(a!==expected){ fail++; console.error(`  ✗ lib("${input}") = ${a}, expected ${expected}`); }
  else pass++;
  if(a!==b){ fail++; console.error(`  ✗ DRIFT: lib("${input}")=${a} but client=${b}`); }
  else pass++;
}
console.log(`\nmedium.test: ${pass} passed, ${fail} failed`);
if(fail) process.exit(1);
