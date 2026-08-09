#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { derivePlacementReport, evaluateQuality } from "../../dist/packages/quality/src/index.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node apps/quality-harness/placement-cli.mjs <annotation.json>");
  process.exit(2);
}

try {
  const annotation = JSON.parse(await readFile(inputPath, "utf8"));
  const report = derivePlacementReport(annotation);
  const evaluation = evaluateQuality([report.qualitySample]);
  console.log(JSON.stringify({ report, evaluation }, null, 2));
  process.exitCode = evaluation.pass ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 2;
}
