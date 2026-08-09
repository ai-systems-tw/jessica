#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { validateSingleFrameAssetIntake } from "../../dist/packages/contracts/src/index.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node apps/quality-harness/j1m-readiness-cli.mjs <intake.json>");
  process.exit(2);
}

try {
  const intake = JSON.parse(await readFile(inputPath, "utf8"));
  const issues = validateSingleFrameAssetIntake(intake);
  const result = { ready: issues.length === 0, issueCount: issues.length, issues };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 2;
}
