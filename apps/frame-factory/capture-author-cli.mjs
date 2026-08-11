#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import {
  assembleFrameCaptureDraft,
  canonicalJson,
  evaluateG1CaptureReadiness,
  validateFrameCaptureDraft,
} from "../../dist/packages/contracts/src/index.js";
import { inspectSourceSpec, SourceInspectionError } from "../../scripts/source-inspection.mjs";
import { PrivateCaptureDraftStoreError, resolvePrivateCaptureRoot, writePrivateCaptureDraftArtifact } from "./private-capture-draft-store.mjs";

const ENVELOPE_KEYS = new Set(["schemaVersion", "sourceSpec", "authoring"]);
const G1_UNAVAILABLE = [{ path: "draft", message: "G1 cannot be evaluated until the candidate draft is valid" }];

function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function failure(code, message, details = [], status = 1) {
  print({ ok: false, draftValid: false, g1Ready: false, draftIssues: details, g1Issues: G1_UNAVAILABLE, error: { code, message } });
  process.exitCode = status;
}

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [{ path: "input", message: "must be an object" }];
  const issues = [];
  for (const key of Object.keys(value)) if (!ENVELOPE_KEYS.has(key)) issues.push({ path: key, message: "is not allowed" });
  if (value.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "must equal 1" });
  if (!value.sourceSpec || typeof value.sourceSpec !== "object" || Array.isArray(value.sourceSpec)) issues.push({ path: "sourceSpec", message: "must be an object" });
  if (!value.authoring || typeof value.authoring !== "object" || Array.isArray(value.authoring)) issues.push({ path: "authoring", message: "must be an object" });
  return issues;
}

function parseArguments(args) {
  if (args.length === 1 && !args[0].startsWith("--")) return { inputArgument: args[0] };
  if (args.length === 3 && !args[0].startsWith("--") && args[1] === "--output-path" && args[2].length > 0) {
    return { inputArgument: args[0], outputPath: args[2] };
  }
  return undefined;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed) {
    failure("USAGE", "Usage: capture-author-cli.mjs <capture-author.json> [--output-path <relative-private-draft.json>]", [], 2);
    return;
  }
  try {
    try { process.loadEnvFile(resolve(".env.local")); }
    catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw new SourceInspectionError("ENV_INVALID", "local environment file could not be loaded", "input");
    }
    const inputPath = resolve(parsed.inputArgument);
    let inputText;
    try { inputText = await readFile(inputPath, "utf8"); }
    catch (error) {
      failure(error && typeof error === "object" && error.code === "ENOENT" ? "INPUT_MISSING" : "INPUT_UNREADABLE", "capture authoring input could not be read");
      return;
    }
    let input;
    try { input = JSON.parse(inputText); }
    catch { failure("INPUT_INVALID_JSON", "capture authoring input is not valid JSON"); return; }
    const envelopeIssues = validateEnvelope(input);
    if (envelopeIssues.length > 0) { failure("INPUT_INVALID", "capture authoring input failed validation", envelopeIssues); return; }

    const configuredSourceRoot = process.env.JESSICA_PRIVATE_SOURCE_ROOT?.trim();
    if (parsed.outputPath !== undefined && !configuredSourceRoot) {
      failure("ROOT_REQUIRED", "output mode requires JESSICA_PRIVATE_SOURCE_ROOT", [], 2);
      return;
    }
    const sourceRoot = parsed.outputPath !== undefined
      ? await resolvePrivateCaptureRoot(configuredSourceRoot)
      : configuredSourceRoot ? resolve(configuredSourceRoot) : dirname(inputPath);
    const inspection = await inspectSourceSpec(input.sourceSpec, { manifestDirectory: sourceRoot });
    const assembly = assembleFrameCaptureDraft(inspection.sourceAssets, input.authoring);
    if (!assembly.ok) { failure("AUTHORING_INVALID", "capture authoring input failed validation", assembly.issues); return; }
    const draftIssues = validateFrameCaptureDraft(assembly.draft);
    const g1 = evaluateG1CaptureReadiness(assembly.draft);
    const draftValid = draftIssues.length === 0;
    if (!draftValid) { failure("DRAFT_INVALID", "capture draft failed validation", draftIssues); return; }

    if (parsed.outputPath !== undefined) {
      const artifact = await writePrivateCaptureDraftArtifact(
        configuredSourceRoot,
        parsed.outputPath,
        Buffer.from(`${canonicalJson(assembly.draft)}\n`),
      );
      print({ ok: true, artifact, draftValid: true, g1Ready: g1.ready });
    } else {
      print({ ok: true, draftValid: true, g1Ready: g1.ready, draftIssues, g1Issues: g1.issues, draft: assembly.draft });
    }
  } catch (error) {
    if (error instanceof SourceInspectionError) failure(error.code, error.message);
    else if (error instanceof PrivateCaptureDraftStoreError) failure(error.code, error.message, [], 2);
    else failure("AUTHORING_FAILED", "capture authoring failed unexpectedly", [], 2);
  }
}

await main();
