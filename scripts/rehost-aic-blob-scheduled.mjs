#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.argv.length !== 2) {
  console.error("Scheduled AIC migration wrapper accepts no arguments.");
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.dirname(scriptDir);
const migrator = path.join(scriptDir, "rehost-aic-blob.mjs");
const result = spawnSync(process.execPath, [migrator, "--limit=10"], {
  cwd: repoDir,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Could not start AIC migration: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
