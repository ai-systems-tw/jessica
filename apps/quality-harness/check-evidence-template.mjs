#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { evaluateGroundTruthEvidence } from "../../dist/packages/quality/src/index.js";

const templateUrl = new URL("../../fixtures/ground-truth/canonical.template.json", import.meta.url);
const evaluation = evaluateGroundTruthEvidence(JSON.parse(await readFile(templateUrl, "utf8")));
if (evaluation.gateReady || evaluation.profile !== "canonical-validation") {
  console.error(JSON.stringify({ ok: false, message: "canonical template must be recognized and rejected as non-evidence", evaluation }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, expectedGateReady: false, issueCodes: evaluation.issues.map((issue) => issue.code) }, null, 2));
