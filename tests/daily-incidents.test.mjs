// Exact work-ID regressions found by the temporary manual daily-release bridge.
// These facts affect scored answers and must survive future corpus rewrites.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scope = {};
new Function("window", readFileSync(new URL("../data/pool.js", import.meta.url), "utf8"))(scope);
const byId = new Map((scope.ARTEFACTUM_POOL || []).map(work => [work.id, work]));

const walls = byId.get("http://www.wikidata.org/entity/Q15848824");
assert.ok(walls, "Elymian-Punic Walls fixture is missing from the pool");
assert.equal(walls.place, "Italy", "Elymian-Punic Walls must not regress to Tunisia");
assert.equal(walls.region, "Europe", "Elymian-Punic Walls must remain in Europe");
assert.deepEqual(walls.yr, [-800, -500], "Elymian-Punic Walls must retain its sourced BCE range");
assert.ok(walls.y >= walls.yr[0] && walls.y <= walls.yr[1], "canonical year must fall inside the BCE range");
assert.equal(walls.lat, 38.041583, "Elymian-Punic Walls latitude must remain at Erice");
assert.equal(walls.lng, 12.587964, "Elymian-Punic Walls longitude must remain at Erice");

const situla = byId.get("wikidata:Q109046361");
assert.ok(situla, "Tourdan Situla fixture is missing from the pool");
assert.equal(situla.medium, "Silver", "Tourdan Situla must keep a scoreable material");
assert.ok(situla.cats.includes("medium"), "Tourdan Situla's medium category must remain enabled");

const nio = byId.get("wikidata:Q17635755");
assert.ok(nio, "Nio at the Nandaimon fixture is missing from the pool");
assert.equal(nio.play, false, "mesh-obscured Nio image must remain blocked until its image is replaced and re-reviewed");
const dailyOrderSource = readFileSync(new URL("../data/daily-order.js", import.meta.url), "utf8");
assert.ok(!dailyOrderSource.includes(nio.id), "blocked Nio work must remain absent from dated schedules and rotations");

console.log("daily-incidents.test: 3 exact work-ID regressions passed");
