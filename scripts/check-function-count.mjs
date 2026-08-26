#!/usr/bin/env node
// Guard the Vercel Serverless-Function count. Vercel turns EVERY file under api/ (recursively) into a
// deployable function EXCEPT files whose basename starts with "_" (the utility-file convention). The Hobby
// plan permits at most 12 functions per deployment; exceeding it builds fine but FAILS at "Deploying outputs".
// This gate makes that limit visible pre-deploy so shared helpers are never accidentally counted again.
// Rule ref: https://vercel.com/docs/functions/configuring-functions/advanced-configuration
//   node scripts/check-function-count.mjs
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 12;
const API = new URL('../api/', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { out.push(...walk(full)); continue; }
    if (!/\.(js|mjs|ts)$/.test(e.name)) continue;      // only runtime source becomes a function
    if (e.name.startsWith('_')) continue;              // Vercel ignores underscore-prefixed utility files
    out.push(full.slice(API.length));                  // path relative to api/
  }
  return out;
}

let fns;
try { fns = walk(API).sort(); } catch (e) { console.error('❌ FAIL — cannot read api/:', e.message); process.exit(1); }

if (fns.length > LIMIT) {
  console.error(`❌ FAIL — ${fns.length} deployable functions under api/ (Hobby limit ${LIMIT}). Move shared helpers OUT of api/ (e.g. server/api/) or prefix utility files with "_":`);
  for (const f of fns) console.error('  - api/' + f);
  process.exit(1);
}
console.log(`✅ PASS — ${fns.length}/${LIMIT} deployable functions under api/ (underscore-utility files excluded): ${fns.map(f => f.replace(/\.js$/, '')).join(', ')}`);
