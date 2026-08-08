#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { evaluateQuality } from "../../dist/packages/quality/src/index.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node apps/quality-harness/cli.mjs <fixture.json>");
  process.exit(2);
}

try {
  const document = JSON.parse(await readFile(inputPath, "utf8"));
  const samples = Array.isArray(document) ? document : document.samples;
  const thresholds = Array.isArray(document) ? undefined : document.thresholds;
  const evaluation = evaluateQuality(samples, thresholds);
  console.log(JSON.stringify(evaluation, null, 2));
  process.exitCode = evaluation.pass ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 2;
}
