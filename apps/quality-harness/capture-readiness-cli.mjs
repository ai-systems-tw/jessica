#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  evaluateG1CaptureReadiness,
  validateFrameCaptureDraft,
} from "../../dist/packages/contracts/src/index.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node apps/quality-harness/capture-readiness-cli.mjs <capture-draft.json>");
  process.exit(2);
}

try {
  const draft = JSON.parse(await readFile(inputPath, "utf8"));
  const draftIssues = validateFrameCaptureDraft(draft);
  const g1 = evaluateG1CaptureReadiness(draft);
  const result = {
    draftValid: draftIssues.length === 0,
    g1Ready: g1.ready,
    draftIssues,
    g1Issues: g1.issues,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.g1Ready ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 2;
}
