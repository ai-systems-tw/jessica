#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { evaluateGroundTruthEvidence, parseGroundTruthEvidence } from "../../dist/packages/quality/src/index.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.log(JSON.stringify({ schemaVersion: 1, gateReady: false, issues: [{ code: "usage", path: "$", message: "Usage: node apps/quality-harness/g1-evidence-cli.mjs <evidence.json>" }] }, null, 2));
  process.exit(2);
}

try {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const parsed = parseGroundTruthEvidence(input);
  const evaluation = evaluateGroundTruthEvidence(input);
  console.log(JSON.stringify(evaluation, null, 2));
  process.exitCode = parsed.issues.length ? 2 : evaluation.gateReady ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ schemaVersion: 1, gateReady: false, issues: [{ code: error instanceof SyntaxError ? "malformed_json" : "io_error", path: "$", message: error instanceof SyntaxError ? "input is not valid JSON" : "unable to read evidence input" }] }, null, 2));
  process.exitCode = 2;
}
