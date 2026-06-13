// Hand-authored diagnostic notes for the 54 works Codex didn't finish (Codex usage-capped),
// + in-place geo patches for title-keyword mis-tags. Run: node scripts/manual-notes.mjs
import { readFileSync, writeFileSync } from "node:fs";

// ---- geo patches (title-keyword mis-tags in the current pool) ----
const PATCH = {
  met453351:{place:"Turkey",region:"Europe",lat:41.01,lng:28.98,style:"Ottoman",styleKind:"culture"}, // Islamic manuscript, was "Nigeria"
  met545168:{place:"Egypt",region:"Africa",lat:30.0,lng:31.2,style:"Egypt",styleKind:"culture"},       // Egyptian silver jug, was "China"
  met250931:{place:"Italy (Rome)",region:"Europe",lat:41.9,lng:12.5},                                   // Roman fresco, was "Egypt"
  met630999:{place:"Italy (Rome)",region:"Europe",lat:41.9,lng:12.5},                                   // Greek Tarentine relief, was "Iran"
};

// ---- notes: id -> {why, cues[]} ----
const NOTES = {
  // Egyptian metalwork (New Kingdom & later) — precious sheet metal, Nile imagery
  met547550:{why:"New Kingdom Egyptian royal silverwork, c. 15th c. BCE, read from the hammered precious-metal ritual form.",cues:["thin hammered silver shaped for libation → elite Egyptian temple/funerary use","restrained geometric profile → New Kingdom metal vessel canon","silver (rarer than gold in Egypt) → high-status royal commission"]},
  met544751:{why:"New Kingdom Egyptian goldwork, c. 13th c. BCE, given away by the Hathor-and-felines vessel imagery.",cues:["goddess Hathor flanked by felines → Egyptian divine iconography","worked sheet gold → elite Nile-valley luxury metalwork","symmetrical heraldic framing → New Kingdom decorative convention"]},
  met548220:{why:"New Kingdom Egyptian silver vessel, c. 13th c. BCE, placed by its tall hammered-metal jar form.",cues:["long elegant neck on hammered silver → Egyptian precious-metal vessel type","undecorated polished body → New Kingdom restraint","silver → imported, high-value material in Egypt"]},
  met548210:{why:"New Kingdom Egyptian situla, c. 13th c. BCE, identified by the bucket form and floral register.",cues:["situla (ritual bucket) shape → Egyptian temple libation use","lotus/floral band → Nile decorative repertoire","bronze/metal sheet → functional ceremonial ware"]},
  met545169:{why:"New Kingdom Egyptian gold strainer, c. 13th c. BCE — a luxury table implement in precious metal.",cues:["pierced gold strainer → elite Egyptian banqueting equipment","worked sheet gold → royal-tier material","plain functional form → New Kingdom metalcraft"]},
  met545170:{why:"New Kingdom Egyptian gold fitting, c. 13th c. BCE, from a precious-metal bowl.",cues:["conical repoussé boss → centerpiece of an Egyptian metal bowl","sheet gold → high-status commission","spare geometric form → New Kingdom metalwork"]},
  met568634:{why:"New Kingdom Egyptian bronze libation vessel, c. 13th c. BCE.",cues:["cast/hammered bronze for pouring → temple ritual function","simple swelling profile → Egyptian metal vessel canon","bronze → durable ceremonial ware"]},
  met544698:{why:"New Kingdom Egyptian silver bowl, c. 13th c. BCE, placed by Nile marsh imagery on elite metal.",cues:["marsh/fish/fowl scene → Egyptian Nile-landscape repertoire","chased silver → high-status luxury ware","low relief on a shallow bowl → New Kingdom metal decoration"]},
  met547673:{why:"New Kingdom Egyptian vessel imitating basketry, c. 15th c. BCE.",cues:["woven-basket texture rendered in a hard medium → Egyptian skeuomorph","tapered functional form → New Kingdom vessel type","craft imitation of organic material → Nile-valley taste"]},
  met545903:{why:"New Kingdom Egyptian vessel fitting, c. 15th c. BCE, given away by the ibex-head shoulder ornament.",cues:["ibex-head appliqué → Egyptian animal-form vessel decoration","attachment from a vessel shoulder → luxury metal/stone ware","naturalistic horned head → New Kingdom craftsmanship"]},
  met550061:{why:"New Kingdom Egyptian lidded jar, c. 14th c. BCE.",cues:["strap handles + fitted lid → Egyptian storage vessel form","balanced ovoid body → New Kingdom canon","sealed jar → tomb-goods context"]},
  // Egyptian glass — core-formed, pre-blown
  met549375:{why:"New Kingdom Egyptian core-formed glass, c. 13th c. BCE — among the earliest luxury glass.",cues:["small thick-walled vessel in strong color → core-formed (pre-blowing) glass","combed wavy bands → New Kingdom Egyptian glass technique","tiny precious scale → elite cosmetic/unguent use"]},
  met548499:{why:"New Kingdom Egyptian glass fragment, c. 14th c. BCE.",cues:["dense opaque color → core-formed Egyptian glass, not later clear blown glass","feathered/combed pattern → 18th-dynasty glassworking","fragment of a small luxury vessel → cosmetic ware"]},
  met550971:{why:"Late Period Egyptian glass unguent vessel, c. 6th c. BCE.",cues:["small core-formed flask → Egyptian cosmetic container","strong banded color → pre-blown glass technique","miniature scale → precious oils/unguents"]},
  met550972:{why:"Late Period Egyptian core-formed glass amphoriskos, c. 7th c. BCE.",cues:["miniature amphora shape → Mediterranean unguent flask","combed colored trails → core-formed glass","handles + pointed base → table/cosmetic vessel type"]},
  met576653:{why:"New Kingdom Egyptian glass fragment, c. 14th c. BCE.",cues:["thick richly colored shard → core-formed Egyptian glass","trail decoration → 18th-dynasty technique","luxury small-vessel scale → elite use"]},
  met573600:{why:"Roman-period Egyptian glass, c. 1st c. CE, when blowing had transformed the craft.",cues:["thin even walls → glass-blowing (Roman era), unlike earlier core-formed work","clear/lightly tinted body → Roman glass technology","plain practical form → everyday Roman Egypt ware"]},
  // Egyptian ceramic / stone / statuary
  met553259:{why:"Late Period Egyptian ceramic, c. 7th c. BCE — a small wheel-made offering vessel.",cues:["miniature pottery form → Egyptian votive/offering use","plain burnished surface → Late Period ware","ceramic, not metal → modest grave good"]},
  met590953:{why:"Roman-period Egyptian funerary ceramic, c. 2nd c. CE, mixing Egyptian and classical motifs.",cues:["theatrical masks + ram → Greco-Roman funerary imagery in Egypt","molded terracotta → Roman-Egyptian workshop production","hybrid iconography → Egypt under Rome"]},
  met550781:{why:"Ptolemaic Egyptian stone offering table, c. 2nd c. BCE, read from inscriptions and libation channels.",cues:["carved channels for libations → Egyptian temple offering equipment","hieroglyphic dedication → priestly funerary context","hard stone slab → durable ritual furniture"]},
  met553499:{why:"Late Period Egyptian vessel fragment naming Necho, c. 7th c. BCE.",cues:["royal name (Necho) inscription → datable Late Period context","fragment of a fine vessel → elite commission","Egyptian formal hieroglyphs → Nile-valley origin"]},
  met548395:{why:"Late Period Egyptian statuette of Horus with a vessel, c. 4th c. BCE.",cues:["falcon-god Horus figure → Egyptian divine statuary","held ritual vessel → temple/votive function","rigid frontal pose → Egyptian sculptural canon"]},
  met569685:{why:"Ptolemaic Egyptian zoomorphic vessel, c. 2nd c. BCE, in the shape of a horse.",cues:["animal-form vessel → Egyptian/Hellenistic luxury type","horse subject → Ptolemaic-era taste","molded body → Greco-Egyptian workshop"]},
  met545168:{why:"New Kingdom Egyptian silver jug, c. 13th c. BCE, named for Atum-em-tane — Nile-valley royal metalwork.",cues:["feline-head handle on hammered silver → Egyptian luxury vessel decoration","Egyptian royal name inscription → New Kingdom court context","precious silver → high-status commission"]},
  // Near Eastern
  met322869:{why:"Iron Age Iranian bronze, c. 8th–7th c. BCE — a Luristan-style ornament with animal terminals.",cues:["lion-mask terminals → Luristan/Iranian bronze repertoire","lost-wax cast bronze → western-Iranian metalwork","stylized animal heads → Iron Age Near Eastern style"]},
  met324575:{why:"Iron Age Iranian bronze disc, c. 8th–7th c. BCE.",cues:["cast bronze plaque → Iranian highland metalwork","geometric/animal ornament → Luristan tradition","ritual/votive disc → Iron Age Near East"]},
  met323721:{why:"Iron Age Iranian bronze pin, c. 8th–7th c. BCE.",cues:["disc-headed dress pin → Iranian highland type","cast bronze → Luristan metalwork","stylized ornament → Iron Age Near East"]},
  met324492:{why:"Parthian ceramic, c. 1st–2nd c. CE Iran, given away by the molded human-head spout.",cues:["molded face spout → Parthian zoomorphic/figural vessel taste","glazed/earthenware body → Parthian ceramic technique","stylized features → Iranian post-Hellenistic style"]},
  met327403:{why:"Hittite Anatolian gold pin, c. 13th c. BCE Turkey.",cues:["spherical-headed gold pin → Anatolian Bronze Age dress ornament","precious gold → elite Hittite commission","simple turned form → 2nd-millennium Anatolian metalwork"]},
  met324753:{why:"Assyrian/Phoenician carved ivory, c. 8th c. BCE, from the Levantine-Mesopotamian luxury trade.",cues:["carved ivory fitting → Phoenician/Assyrian elite furniture inlay","fine relief → Levantine ivory workshops","luxury imported material → Assyrian court taste"]},
  met323535:{why:"Old Assyrian clay sealing, c. 18th c. BCE, from the Anatolian trade colonies (Kültepe).",cues:["stamp-seal impressions of griffins → Old Assyrian glyptic","clay sealing → administrative/commercial use","Anatolian trade-colony context → Bronze Age Mesopotamian commerce"]},
  // Greek / Roman / Mediterranean
  met245840:{why:"Roman wall painting fragment, c. 2nd c. CE Italy — buon fresco from a domestic interior.",cues:["pigment fused into plaster → Roman fresco technique","architectural/figural fragment → Roman wall decoration","Italian domestic context → Roman painting tradition"]},
  met247010:{why:"Late Republican Roman fresco, c. 1st c. BCE, from the Villa of P. Fannius Synistor at Boscoreale.",cues:["illusionistic architecture → Roman Second-Style wall painting","buon fresco on plaster → Roman technique","villa interior scheme → Late Republican luxury"]},
  met247017:{why:"Late Republican Roman painted room (cubiculum), c. 1st c. BCE, Boscoreale Second Style.",cues:["fictive colonnades and vistas → Roman Second-Style illusionism","whole-wall fresco scheme → elite villa decor","Campanian provenance → Roman domestic painting"]},
  met250931:{why:"Roman wall painting, c. 1st c. BCE/CE, Pompeian style — an Egyptianizing scene on a black ground.",cues:["delicate motifs on a black field → Roman Third-Style fresco","Nilotic/Egyptianizing imagery → Roman vogue for Egypt, not Egyptian-made","buon fresco → Roman wall technique"]},
  met250944:{why:"Roman wall painting, c. 1st c. BCE/CE, Pompeian — a candelabrum on a white ground.",cues:["slender candelabrum ornament → Roman Third-Style delicacy","white ground with framed motifs → Roman fresco fashion","Campanian villa context → Roman domestic art"]},
  met250069:{why:"Provincial Roman ceramic beaker, c. 3rd c. CE, from the Rhineland.",cues:["barbotine/painted inscription → Rhenish Roman 'motto ware'","thin dark-slipped beaker → Roman provincial pottery","Latin drinking inscription → Roman tableware culture"]},
  met254649:{why:"South Italian (Apulian) red-figure krater, c. 4th c. BCE.",cues:["red figures reserved against black gloss → Greek red-figure technique","column-krater for mixing wine → Greek symposium vessel","Apulian workshop ornament → South Italian Greek pottery"]},
  met253315:{why:"Bronze Age Aegean (Helladic) pottery, c. 18th c. BCE.",cues:["burnished wheel-made vase → Middle Helladic ceramic","simple banded form → mainland Aegean Bronze Age","fragment of a storage/serving jar → Helladic ware"]},
  met246553:{why:"Etruscan architectural terracotta, c. 4th c. BCE central Italy.",cues:["lotus-and-palmette molded plaque → Etruscan building decoration","terracotta revetment → Italic temple cladding","stylized floral frieze → Etruscan ornament"]},
  met251763:{why:"Archaic Greek (Laconian) pottery, c. 6th c. BCE Sparta.",cues:["miniature two-handled jar → Laconian ceramic type","austere form → Spartan workshop","Archaic black-gloss → 6th-c. Greek pottery"]},
  met630999:{why:"South Italian Greek (Tarentine) limestone relief, c. 4th c. BCE, depicting a Persian.",cues:["soft limestone carving → Tarentine (South Italian Greek) workshop","'Persian' subject → Greek image of the eastern 'other', not Iranian-made","Hellenistic relief style → 4th-c. Magna Graecia"]},
  met249058:{why:"Classical Greek (Attic) marble grave stele, c. 6th–5th c. BCE Athens.",cues:["carved marble grave monument → Attic funerary sculpture","named deceased (Antigenes) → Athenian commemorative type","restrained relief → Classical Greek style"]},
  met255429:{why:"Classical Greek (Attic) marble pyxis, c. 5th–4th c. BCE.",cues:["lidded marble box (pyxis) → Greek toiletry/luxury object","Attic carving → Athenian workshop","clean classical profile → 5th–4th-c. Greek taste"]},
  met248185:{why:"South Italian Greek (Campanian) terracotta plate, c. 4th c. BCE.",cues:["black-gloss/red-figure plate → South Italian Greek pottery","Campanian fabric → Magna Graecia workshop","tableware form → Greek dining"]},
  met254830:{why:"East Greek (Clazomenian) pottery fragment, c. 6th c. BCE Ionia.",cues:["neck-amphora fragment → East Greek storage/serving vessel","Clazomenian decoration → Ionian workshop","Archaic ornament → 6th-c. Greek pottery"]},
  met247429:{why:"Classical Greek (Attic) askos, c. 4th c. BCE.",cues:["low spouted oil flask (askos) → Greek household vessel","Attic black-gloss → Athenian pottery","compact pouring form → Classical Greek tableware"]},
  met242336:{why:"Cypriot limestone head, c. 4th c. BCE — Cyprus's blend of Greek and Near Eastern style.",cues:["soft limestone votive head → Cypriot sculpture","wreathed youth → Greek-influenced subject","hybrid East-Greek manner → Cypriot workshops"]},
  met827078:{why:"An 18th-century European engraving (c. 1750) of a classical subject — a printed reproduction, not an antiquity.",cues:["incised line printed in ink on paper → intaglio engraving","classical/antique subject → 18th-c. taste for antiquity","reproductive print → European workshop, not ancient"]},
  met244545:{why:"Cypriot bronze lampstand, c. 6th c. BCE.",cues:["cast bronze stand → Cypriot metalwork","lamp support function → Mediterranean household object","Greek-Levantine hybrid form → Cypriot tradition"]},
  met247964:{why:"Classical Greek (Attic) red-figure volute-krater, c. 5th c. BCE Athens.",cues:["volute handles on a wine-mixing krater → Greek symposium vessel","red-figure mythological scene → Attic technique","Painter of the Woolly Satyrs hand → mid-5th-c. Athens"]},
  met256169:{why:"Classical Greek (Boeotian) kantharos, c. 5th c. BCE.",cues:["tall twin-handled drinking cup (kantharos) → Greek symposium ware","Boeotian fabric → central-Greek workshop","black-gloss body → Classical Greek pottery"]},
  met245580:{why:"Hellenistic Greek (Cretan) Hadra hydria, c. 3rd c. BCE — a painted funerary water-jar.",cues:["Hadra-ware painted bands → Hellenistic funerary urn type","hydria (water-jar) form reused for ashes → Greek burial use","Cretan/Ptolemaic-sphere fabric → 3rd-c. eastern Mediterranean"]},
  met252410:{why:"Minoan bronze votive figure, c. 12th c. BCE Crete.",cues:["small solid-cast bronze worshipper → Minoan/Aegean votive type","gesture of adoration → Bronze Age Cretan cult practice","lost-wax bronze → Aegean metalwork"]},
  // overwrite the previously-misplaced manuscript note
  met453351:{why:"Late-16th-century Ottoman manuscript painting (Siyer-i Nebi), placed by its jewel-toned Islamic narrative folio.",cues:["flat brilliant color and gold with fine ink line → Islamic manuscript painting","turbaned figures staged as narrative → Ottoman court book culture","prophetic/devotional subject (Life of the Prophet) → Siyer-i Nebi tradition"]},
};

// ---- apply geo patches ----
const pf="data/pool.js"; let praw=readFileSync(pf,"utf8");
let pool=JSON.parse(praw.replace("window.ARTEFACTUM_POOL = ","").replace(/;\s*$/,""));
let patched=0; for(const p of pool){ if(PATCH[p.id]){ Object.assign(p,PATCH[p.id]); patched++; } }
writeFileSync(pf,"window.ARTEFACTUM_POOL = "+JSON.stringify(pool)+";\n");

// ---- merge notes ----
const tf="data/teach-works.js"; let t=readFileSync(tf,"utf8");
const notes=JSON.parse(t.slice(t.indexOf("{",t.indexOf(".work")), t.lastIndexOf("}")+1));
let added=0; for(const id in NOTES){ notes[id]={why:NOTES[id].why,cues:NOTES[id].cues.slice(0,4)}; added++; }
writeFileSync(tf,"window.ARTEFACTUM_CUES=window.ARTEFACTUM_CUES||{};\nwindow.ARTEFACTUM_CUES.work="+JSON.stringify(notes)+";\n");

const missing=pool.filter(p=>!notes[p.id]).length;
console.log(`patched geo: ${patched}; notes written: ${added}; total notes: ${Object.keys(notes).length}; still missing: ${missing}`);
