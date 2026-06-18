// Single source of truth for medium classification (domain rule: "medium" = the art-making material or
// process, NOT the support). Imported by pipeline scripts; the client keeps a mirror in index.html that
// tests/medium.test.mjs asserts stays in sync. Keep this and the client copy identical.

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
  const t = " " + String(s||"").toLowerCase() + " ";
  if(/\boil\b/.test(t))return "Oil paint"; if(/tempera/.test(t))return "Tempera"; if(/fresco/.test(t))return "Fresco";
  if(/water-?colou?r|gouache/.test(t))return "Watercolor";
  if(/photograph|gelatin|albumen|daguerreotype|collotype|platinum print|palladium print|carbon print|collodion/.test(t))return "Photograph"; // BEFORE the generic print rule (a "gelatin silver print" is a photo, not a woodblock)
  if(/woodcut|woodblock|engrav|etch|lithograph|\bprint\b/.test(t))return "Woodblock print";
  if(/\bink\b/.test(t))return "Ink"; if(/chalk|charcoal|graphite|pencil|pastel|drawing/.test(t))return "Drawing";
  if(/marble/.test(t))return "Marble"; if(/jade|nephrite/.test(t))return "Jade";
  if(/terracotta|porcelain|stoneware|earthenware|faience|fritware|pottery|ceramic|\bclay\b/.test(t))return "Ceramic";
  if(/lacquer|maki-e/.test(t))return "Lacquer"; if(/ivory/.test(t))return "Ivory"; if(/glass/.test(t))return "Glass";
  if(/\bgold\b|gilt|gild/.test(t))return "Gold"; if(/silver/.test(t))return "Silver";
  if(/\bcopper\b/.test(t))return "Copper"; if(/bronze|brass|\btin\b|pewter|\bmetal\b/.test(t))return "Bronze";
  if(/silk|cotton|\bwool\b|linen|textile|tapestry|embroider|velvet/.test(t))return "Textile";
  if(/limestone|sandstone|granite|alabaster|steatite|soapstone|basalt|\bstone\b/.test(t))return "Stone";
  if(/lacquer|wood|panel|\boak\b|\bpine\b|olive.?pit|fruit.?stone|nutshell|coquilla|\bnut\b|coconut/.test(t))return "Wood";
  if(/\bpaper\b/.test(t))return "Ink";
  return s ? "Mixed media" : "";
}
