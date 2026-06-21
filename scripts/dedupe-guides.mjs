import { readGlobal, writeTeachWorks } from "./lib/static-module.mjs";

const TEACH_WORKS = "data/teach-works.js";
const GLOBAL_NAME = "ARTEFACTUM_CUES";
const MONA_LISA_ID = "http://www.wikidata.org/entity/Q12418";
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "it",
  "this",
  "that",
  "of",
  "to",
  "in",
  "on",
  "for",
  "why",
  "how",
  "what",
  "who",
  "does",
  "do",
  "we",
  "make",
  "makes",
  "made",
  "so",
]);

function questionTokens(question){
  return new Set(
    String(question || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(token => token && !STOPWORDS.has(token))
  );
}

function jaccard(a, b){
  if(a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for(const token of a) if(b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function duplicateClusters(guide){
  const tokens = guide.map(item => questionTokens(item?.q));
  const parent = guide.map((_, index) => index);

  function find(index){
    while(parent[index] !== index){
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }

  function union(a, b){
    const rootA = find(a);
    const rootB = find(b);
    if(rootA !== rootB) parent[rootB] = rootA;
  }

  for(let i = 0; i < guide.length; i++){
    for(let j = i + 1; j < guide.length; j++){
      if(jaccard(tokens[i], tokens[j]) >= 0.6) union(i, j);
    }
  }

  const clusters = new Map();
  for(let i = 0; i < guide.length; i++){
    const root = find(i);
    if(!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  }
  return [...clusters.values()].filter(cluster => cluster.length > 1);
}

function dedupeGuide(guide){
  if(!Array.isArray(guide) || guide.length < 2) return { guide, removed: 0 };

  const keep = new Set(guide.map((_, index) => index));
  for(const cluster of duplicateClusters(guide)){
    let winner = cluster[0];
    for(const index of cluster){
      const answerLength = String(guide[index]?.a || "").length;
      const winnerLength = String(guide[winner]?.a || "").length;
      if(answerLength > winnerLength) winner = index;
    }
    for(const index of cluster){
      if(index !== winner) keep.delete(index);
    }
  }

  const deduped = guide.filter((_, index) => keep.has(index));
  return { guide: deduped, removed: guide.length - deduped.length };
}

function questionList(workMap, id){
  return (workMap[id]?.guide || []).map(item => item.q);
}

function printQuestionList(label, questions){
  console.log(label);
  questions.forEach((question, index) => {
    console.log(`${index + 1}. ${question}`);
  });
}

const cues = readGlobal(TEACH_WORKS, GLOBAL_NAME);
const workMap = cues?.work;
if(!workMap || typeof workMap !== "object"){
  throw new Error(`Could not read ${GLOBAL_NAME}.work from ${TEACH_WORKS}`);
}

const monaBefore = questionList(workMap, MONA_LISA_ID);
let worksChanged = 0;
let totalRemoved = 0;

for(const work of Object.values(workMap)){
  if(!work || !Array.isArray(work.guide)) continue;
  const { guide, removed } = dedupeGuide(work.guide);
  if(removed > 0){
    work.guide = guide;
    worksChanged++;
    totalRemoved += removed;
  }
}

writeTeachWorks(TEACH_WORKS, workMap);

console.log(`works changed: ${worksChanged}`);
console.log(`questions removed: ${totalRemoved}`);
console.log("");
printQuestionList("Mona Lisa before:", monaBefore);
console.log("");
printQuestionList("Mona Lisa after:", questionList(workMap, MONA_LISA_ID));
