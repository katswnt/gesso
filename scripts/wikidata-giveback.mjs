// Find Wikidata items that have a museum object ID but lack that museum's
// P195 (collection) statement, then prepare a small QuickStatements v1 batch.
// This script only reads Wikidata. It never authenticates or performs edits.
//
// Usage:
//   node scripts/wikidata-giveback.mjs <objectIdProperty> <collectionQID> [--limit N]
//
// P3634 is the Met object ID property, but the Met is already essentially
// complete for P195 and should not be used as a bulk-addition target.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "GessoWikidataGiveback/1.0 (collection-statement gap audit; contact: kathryn.swint@gmail.com)";
const DEFAULT_LIMIT = 5;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 45_000;

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    "Usage: node scripts/wikidata-giveback.mjs <objectIdProperty> <collectionQID> [--limit N]",
  );
  process.exit(1);
}

function parseArgs(args) {
  if (args.length < 2) usage();

  const objectIdProperty = args[0].toUpperCase();
  const collectionQID = args[1].toUpperCase();
  let limit = DEFAULT_LIMIT;

  if (!/^P[1-9]\d*$/.test(objectIdProperty)) {
    usage("objectIdProperty must look like P1234");
  }
  if (!/^Q[1-9]\d*$/.test(collectionQID)) {
    usage("collectionQID must look like Q1234");
  }

  for (let i = 2; i < args.length; i += 1) {
    if (args[i] !== "--limit" || i + 1 >= args.length) {
      usage(`unknown or incomplete option: ${args[i]}`);
    }
    if (!/^[1-9]\d*$/.test(args[i + 1])) {
      usage("--limit must be a positive integer");
    }
    limit = Number(args[i + 1]);
    if (!Number.isSafeInteger(limit)) usage("--limit is too large");
    i += 1;
  }

  return { objectIdProperty, collectionQID, limit };
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response, attempt) {
  const retryAfter = response?.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 30_000);
  }
  return 2 ** attempt * 1_000;
}

async function runSparql(query, label) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });

      if (response.status === 429 || response.status === 408 || response.status >= 500) {
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(`Wikidata returned HTTP ${response.status} after ${attempt} attempts`);
        }
        const waitMs = retryDelay(response, attempt);
        console.error(
          `${label}: Wikidata is busy (HTTP ${response.status}). Retrying in ${Math.ceil(waitMs / 1_000)}s...`,
        );
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Wikidata returned HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.results.bindings;
    } catch (error) {
      const timedOut = error.name === "AbortError";
      if (attempt === MAX_ATTEMPTS || (!timedOut && /^Wikidata returned HTTP/.test(error.message))) {
        throw error;
      }
      const waitMs = 2 ** attempt * 1_000;
      console.error(
        `${label}: ${timedOut ? "request timed out" : "network request failed"}. Retrying in ${waitMs / 1_000}s...`,
      );
      await sleep(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${label}: query failed`);
}

function itemQID(uri) {
  const match = uri.match(/\/Q[1-9]\d*$/);
  if (!match) throw new Error(`Unexpected Wikidata item URI: ${uri}`);
  return match[0].slice(1);
}

function formatObjectUrl(formatter, objectId) {
  if (!formatter?.includes("$1")) return null;
  return formatter.replaceAll("$1", encodeURIComponent(objectId));
}

function quoteQuickStatements(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

const { objectIdProperty, collectionQID, limit } = parseArgs(process.argv.slice(2));

const countQuery = `SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE {
  ?item wdt:${objectIdProperty} ?objectId.
  FILTER NOT EXISTS { ?item wdt:P195 wd:${collectionQID}. }
}`;

const batchQuery = `SELECT ?item (SAMPLE(STR(?objectIdValue)) AS ?objectId)
       (SAMPLE(STR(?formatterValue)) AS ?formatter) WHERE {
  ?item wdt:${objectIdProperty} ?objectIdValue.
  FILTER NOT EXISTS { ?item wdt:P195 wd:${collectionQID}. }
  OPTIONAL { wd:${objectIdProperty} wdt:P1630 ?formatterValue. }
}
GROUP BY ?item
ORDER BY ?item
LIMIT ${limit}`;

try {
  const countRows = await runSparql(countQuery, "Count query");
  const total = countRows[0]?.count?.value;
  if (!/^\d+$/.test(total ?? "")) throw new Error("Count query returned no usable count");
  console.log(
    `${total} item(s) have ${objectIdProperty} but lack P195=${collectionQID}.`,
  );

  const rows = await runSparql(batchQuery, "Batch query");
  const lines = rows.map((row) => {
    const qid = itemQID(row.item.value);
    const referenceUrl = formatObjectUrl(row.formatter?.value, row.objectId.value);
    if (referenceUrl) {
      return [qid, "P195", collectionQID, "S854", quoteQuickStatements(referenceUrl)].join("\t");
    }

    // TODO: Replace this same-project import fallback with a stronger museum
    // catalog reference before scaling up a batch. Q2013 is Wikidata.
    return [qid, "P195", collectionQID, "S143", "Q2013"].join("\t");
  });

  const outputPath = join("data", "incoming", "giveback", `${collectionQID}-testbatch.txt`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.length ? `${lines.join("\n")}\n` : "", "utf8");

  console.log(`Wrote ${lines.length} QuickStatements line(s) to ${outputPath}.`);
  if (rows.some((row) => !formatObjectUrl(row.formatter?.value, row.objectId.value))) {
    console.warn(
      "TODO: At least one line uses S143/Q2013. Add a stronger museum reference before scaling up.",
    );
  }
  console.log("No Wikidata edits were made.");
} catch (error) {
  console.error(`Could not prepare the test batch: ${error.message}`);
  console.error("No Wikidata edits were made. Please wait and try again later.");
  process.exitCode = 1;
}
