// Harvest National Gallery of Victoria works via Wikidata/Commons (NOT ngv.vic.gov.au — its own site is
// JS-rendered with 694px images). Wikidata has ~319 NGV-held works (P195=Q1464509) with P18 Commons images
// (high-res, PD). Stages a promotable set: dedup vs pool, resolution-gate ≥1000px, PD-only, valid-style-or-
// artist, genid→anon. Review data/incoming/ngv/candidates.json, then promote with promote-coverage.mjs.
//   node scripts/harvest-ngv.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { normalizeArtist, canonicalizeStyle, isInCopyright } from "./lib/domain.mjs";
import { canonicalizePlace, continentOf } from "./lib/places.mjs";
const UA = { "User-Agent": "GessoNGV/1.0 (kathryn.swint@gmail.com)", Accept: "application/sparql-results+json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 1000;

const w = {}; new Function("window", readFileSync("data/pool.js", "utf8"))(w);
const pool = w.ARTEFACTUM_POOL || [];
const poolQs = new Set(pool.map(p => (String(p.id).match(/Q\d+/) || [])[0]).filter(Boolean));
const poolImgs = new Set(pool.map(p => p.img));
const html = readFileSync("index.html", "utf8");
const a = html.indexOf("const MOVEMENTS={"), b = html.indexOf("const MOV_FAMILY=");
const movKeys = new Set([...html.slice(a, b).matchAll(/"([^"]+)":\{dates:/g)].map(m => m[1]));
const poolStyles = new Set(pool.map(p => p.style).filter(Boolean));
const cw = {}; new Function("window", readFileSync("data/countries.js", "utf8"))(cw);
const placeNames = new Set((cw.ARTEFACTUM_COUNTRIES || []).map(c => c.n.toLowerCase()));
const validStyle = s => s && (movKeys.has(s) || poolStyles.has(s)) && !placeNames.has(String(s).toLowerCase());

const isAnon = s => { s = String(s || "").trim(); return !s || /^https?:|genid|\.well-known/i.test(s) || /^(unknown|anonymous|unidentified|attributed|manner of|circle of|workshop|follower|after )/i.test(s); };
const junk = t => /\d{2,}[.\-]\d|[-_]\d{3,}|inv\.?|\bMS\b|\d{5,}|volume|\bvol\.|\bno\.\s*\d|newspaper|\btimes\b/i.test(t || "");

const q = `SELECT ?item ?itemLabel ?creatorLabel ?date ?img ?movementLabel ?genreLabel ?countryLabel ?matLabel
  (COUNT(DISTINCT ?sl) AS ?sitelinks) WHERE {
  ?item wdt:P195 wd:Q1464509; wdt:P18 ?img.
  OPTIONAL{?item wdt:P571 ?date} OPTIONAL{?item wdt:P170 ?creator} OPTIONAL{?item wdt:P135 ?movement}
  OPTIONAL{?item wdt:P136 ?genre} OPTIONAL{?item wdt:P495 ?country} OPTIONAL{?item wdt:P186 ?mat}
  OPTIONAL{?sl schema:about ?item}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?creatorLabel ?date ?img ?movementLabel ?genreLabel ?countryLabel ?matLabel`;
const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: UA });
const rows = (await r.json()).results.bindings;
process.stderr.write(`NGV works from Wikidata: ${rows.length}\n`);

// normalize + first-pass filter (year, PD, dedup, junk, style/artist)
const MED = { oil:"Oil paint",watercolour:"Watercolor",watercolor:"Watercolor",tempera:"Tempera",bronze:"Bronze",marble:"Marble",wood:"Wood",gold:"Gold",silver:"Silver",ivory:"Ivory",ceramic:"Ceramic",porcelain:"Ceramic",stoneware:"Ceramic",earthenware:"Ceramic",glass:"Glass",silk:"Textile",cotton:"Textile",wool:"Textile",paper:"Ink",ink:"Ink",engraving:"Engraving",etching:"Engraving",woodcut:"Woodblock print",lithograph:"Lithograph",gouache:"Gouache" };
const medBucket = m => { const s = (m || "").toLowerCase(); for (const k in MED) if (s.includes(k)) return MED[k]; return ""; };
const prelim = [];
for (const x of rows) {
  const qid = x.item.value.match(/Q\d+/)[0];
  if (poolQs.has(qid)) continue;
  const title = x.itemLabel?.value || ""; if (junk(title) || /^Q\d+$/.test(title)) continue;
  let y = null; if (x.date) { const m = (x.date.value.match(/-?\d{1,4}/) || [])[0]; if (m) y = x.date.value.startsWith("-") ? -parseInt(m) : parseInt(m); }
  if (y == null || y > 1928) continue;
  const artist = isAnon(x.creatorLabel?.value) ? "" : normalizeArtist(x.creatorLabel.value);
  if (artist && isInCopyright(artist)) continue;
  const rawMov = canonicalizeStyle(x.movementLabel?.value || x.genreLabel?.value || "");
  const style = validStyle(rawMov) ? rawMov : "";
  if (!style && !artist) continue;
  const img = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(decodeURIComponent(x.img.value.split("/").pop())) + "?width=1600";
  if (poolImgs.has(img)) continue;
  const place = x.countryLabel?.value || "";
  const cats = ["when", "where"]; const medium = medBucket(x.matLabel?.value);
  if (medium) cats.push("medium"); if (style) cats.push("style"); if (artist) cats.push("artist");
  prelim.push({ id: "wikidata:" + qid, wikidataid: qid, title, artist, y, place: canonicalizePlace(place), region: continentOf(place) || "", medium, style, styleKind: style ? "movement" : "", fame: Math.round(120 * Math.log((+x.sitelinks?.value || 0) + 1)), img, src: "ngv", cats, _file: decodeURIComponent(x.img.value.split("/").pop()) });
}
process.stderr.write(`after prelim filter: ${prelim.length}\n`);

// resolution gate — Commons imageinfo (batched)
const canon = s => { const t = decodeURIComponent(String(s)).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const cW = {};
const files = [...new Set(prelim.map(p => p._file))];
for (let i = 0; i < files.length; i += 40) {
  const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(files.slice(i, i + 40).map(f => "File:" + f).join("|"));
  try { const jr = await fetch(u, { headers: { "User-Agent": UA["User-Agent"] } }); const pages = (await jr.json()).query?.pages || {}; for (const k in pages) { const t = canon((pages[k].title || "").replace(/^File:/, "")); cW[t] = pages[k].imageinfo?.[0]?.width || 0; } } catch {}
  await sleep(60);
}
const kept = prelim.filter(p => (cW[canon(p._file)] || 0) >= MIN).map(({ _file, ...p }) => p);

mkdirSync("data/incoming/ngv", { recursive: true });
writeFileSync("data/incoming/ngv/candidates.json", JSON.stringify(kept, null, 1));
writeFileSync("data/incoming/promote-final.json", JSON.stringify({ ready: kept }, null, 1)); // ready for promote-coverage.mjs
console.log(`\nNGV → ${kept.length} promotable works (dedup vs pool, PD, ≥${MIN}px, valid style/artist)`);
console.log("region:", JSON.stringify(kept.reduce((o, p) => { o[p.region || "?"] = (o[p.region || "?"] || 0) + 1; return o; }, {})));
console.log("with artist:", kept.filter(p => p.artist).length, "| styled:", kept.filter(p => p.style).length);
console.log("samples:"); kept.slice(0, 10).forEach(p => console.log(`  "${p.title.slice(0, 34)}" — ${p.artist || "anon"} (${p.y}) [${p.style || "—"}] ${p.region}`));
