#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { evaluateRepresentativeCoverage } from "../../dist/packages/contracts/src/index.js";

const path = process.argv[2] ?? "fixtures/g2/representative-20.synthetic.json";
try { const result = evaluateRepresentativeCoverage(JSON.parse(await readFile(path, "utf8"))); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.selectionReady ? 0 : 1; }
catch (error) { const code = error instanceof SyntaxError ? "invalid_json" : error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? "input_unavailable" : "input_error"; console.log(JSON.stringify({ error: { code, message: code === "invalid_json" ? "input must be valid JSON" : "input could not be read" } }, null, 2)); process.exitCode = 2; }
