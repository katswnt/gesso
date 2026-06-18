// Single source of truth for medium classification (domain rule: "medium" = the art-making material or
// process, NOT the support). Imported by pipeline scripts; the client keeps a mirror in index.html that
// tests/medium.test.mjs asserts stays in sync. Keep this and the client copy identical.

// Normalize a Wikidata artist label so the same person doesn't appear under multiple spellings.
// Conservative: strips appended CJK/Japanese characters (and the space before them) and tidies
// whitespace — e.g. "Katsushika Hokusai 葛飾北斎" → "Katsushika Hokusai". Leaves Latin diacritics
// (ō/é/ʿ) intact and never merges genuinely different names (no hyphen/case guessing).
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿　]/;
export function normalizeArtist(name){
  let s = String(name||"");
  // drop a trailing run of CJK (optionally space-separated) at the end of the string
  s = s.replace(/[\s　]*[぀-ヿ㐀-䶿一-鿿豈-﫿　][぀-ヿ㐀-䶿一-鿿豈-﫿　\s]*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

// Player-facing medium → coarse family (used for "same family" partial credit + distractor selection).
export const MED_FAMILY = {
  "Oil paint":"paint","Tempera":"paint","Fresco":"paint","Watercolor":"paint","Ink":"paint","Woodblock print":"paint","Drawing":"paint",
  "Bronze":"sculpt","Copper":"sculpt","Marble":"sculpt","Stone":"sculpt","Wood":"sculpt","Ivory":"sculpt","Jade":"sculpt",
  "Ceramic":"craft","Glass":"craft","Textile":"craft","Gold":"craft","Silver":"craft","Lacquer":"craft","Photograph":"craft","Mixed media":"craft"
};

// Collapse a verbose catalogue medium string into one guessable bucket. ORDER MATTERS: a paint/print/
// photograph signal must win over a support material (panel/paper/copper) that appears later in the
// string — that's why those supports are tested last.
export function simplifyMedium(s){
  const raw = String(s||"").trim();
  if(!raw || raw==="—")return "";
  const tidyFallback = value => {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const firstToken = cleaned.split(/\s*(?:[,;]|\band\b|\bon\b)\s*/)[0].trim();
    const shortToken = firstToken.length > 28 ? firstToken.split(/\s+/)[0].trim() : firstToken;
    const fallback = (cleaned.length > 28 || /[,;]|\band\b|\bon\b/.test(cleaned)) && shortToken ? shortToken : cleaned;
    return fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : "";
  };
  const t = " " + raw.toLowerCase() + " ";
  if(/mixed[- ]media|multimedia|assemblage|mixed technique/.test(t))return "Mixed media";
  if(/\boil\b/.test(t))return "Oil paint"; if(/tempera|distemper/.test(t))return "Tempera"; if(/fresco/.test(t))return "Fresco";
  if(/water-?colou?r|gouache/.test(t))return "Watercolor";
  if(/photograph|gelatin|albumen|daguerreotype|collotype|platinum print|palladium print|carbon print|collodion/.test(t))return "Photograph"; // BEFORE the generic print rule (a "gelatin silver print" is a photo, not a woodblock)
  if(/woodcut|woodblock|engrav|etch|lithograph|screenprint|silkscreen|offset print|offset printing|printed matter|\bprint\b/.test(t))return "Woodblock print";
  if(/\bink\b/.test(t))return "Ink"; if(/chalk|charcoal|graphite|pencil|pastel|drawing|tracing|cartoon/.test(t))return "Drawing";
  if(/marble/.test(t))return "Marble"; if(/jade|nephrite/.test(t))return "Jade";
  if(/terracotta|porcelain|stoneware|earthenware|eartheneware|faience|fritware|pottery|ceramic|celadon ware|\bclay\b/.test(t))return "Ceramic";
  if(/lacquer|maki-e/.test(t))return "Lacquer"; if(/ivory|tusk|^\s*bone\s*$/.test(t))return "Ivory"; if(/glass|enamel|cloisonn/.test(t))return "Glass";
  if(/\bgold\b|gilt|gild|electrum/.test(t))return "Gold"; if(/silver/.test(t))return "Silver";
  if(/\bcopper\b/.test(t))return "Copper"; if(/bronze|brass|\btin\b|pewter|\bmetal\b|\blead\b|iron|steel|nickel/.test(t))return "Bronze";
  if(/silk|cotton|\bwool\b|linen|textile|tapestry|embroider|velvet|cloth|canvas|flax|raffia|fiber|fibre|carpet|thread|hessian/.test(t))return "Textile";
  if(/limestone|sandstone|granite|alabaster|steatite|soapstone|basalt|quartzite|greywacke|graywacke|granodiorite|diorite|gabbro|travertine|schist|serpentin(?:e|ite)|porphyry|gneiss|dolomite|calcite|gypsum|chlorite|argillite|malachite|fluorite|carnelian|lapis lazuli|chalcedony|quartz|chert|flint|andesite|dacite|feldspathoid|rock crystal|pietra serena|diamond|plaster|stucco|\bstone\b/.test(t))return "Stone";
  if(/lacquer|wood|panel|\boak\b|\bpine\b|walnut|bamboo|sugi|sycamore|sycomore|olive.?pit|fruit.?stone|nutshell|coquilla|\bnut\b|coconut|living tree/.test(t))return "Wood";
  if(/\bpaper\b|parchment|cardboard/.test(t))return "Ink";
  return tidyFallback(raw);
}
