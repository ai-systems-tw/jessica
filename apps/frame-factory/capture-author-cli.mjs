#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import {
  assembleFrameCaptureDraft,
  evaluateG1CaptureReadiness,
  validateFrameCaptureDraft,
} from "../../dist/packages/contracts/src/index.js";
import { inspectSourceSpec, SourceInspectionError } from "../../scripts/source-inspection.mjs";

const ENVELOPE_KEYS = new Set(["schemaVersion", "sourceSpec", "authoring"]);

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function failure(code, message, details = []) {
  print({
    ok: false,
    draftValid: false,
    g1Ready: false,
    draftIssues: details,
    g1Issues: [{ path: "draft", message: "G1 cannot be evaluated until the candidate draft is valid" }],
    error: { code, message },
  });
  process.exitCode = 1;
}

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: "input", message: "must be an object" }];
  }
  const issues = [];
  for (const key of Object.keys(value)) {
    if (!ENVELOPE_KEYS.has(key)) issues.push({ path: key, message: "is not allowed" });
  }
  if (value.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "must equal 1" });
  if (!value.sourceSpec || typeof value.sourceSpec !== "object" || Array.isArray(value.sourceSpec)) {
    issues.push({ path: "sourceSpec", message: "must be an object" });
  }
  if (!value.authoring || typeof value.authoring !== "object" || Array.isArray(value.authoring)) {
    issues.push({ path: "authoring", message: "must be an object" });
  }
  return issues;
}

const inputArgument = process.argv[2];
if (!inputArgument) {
  failure("USAGE", "Usage: node apps/frame-factory/capture-author-cli.mjs <capture-author.json>");
} else {
  const inputPath = resolve(inputArgument);
  try {
    try {
      process.loadEnvFile(resolve(".env.local"));
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        throw new SourceInspectionError("ENV_INVALID", "local environment file could not be loaded", "input");
      }
    }
    let inputText;
    try {
      inputText = await readFile(inputPath, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && error.code === "ENOENT"
        ? "INPUT_MISSING"
        : "INPUT_UNREADABLE";
      failure(code, "capture authoring input could not be read");
    }
    if (inputText !== undefined) {
      let input;
      try {
        input = JSON.parse(inputText);
      } catch {
        failure("INPUT_INVALID_JSON", "capture authoring input is not valid JSON");
      }
      if (input !== undefined) {
        const envelopeIssues = validateEnvelope(input);
        if (envelopeIssues.length > 0) {
          failure("INPUT_INVALID", "capture authoring input failed validation", envelopeIssues);
        } else {
          const configuredSourceRoot = process.env.JESSICA_PRIVATE_SOURCE_ROOT?.trim();
          const sourceRoot = configuredSourceRoot ? resolve(configuredSourceRoot) : dirname(inputPath);
          const inspection = await inspectSourceSpec(input.sourceSpec, { manifestDirectory: sourceRoot });
          const assembly = assembleFrameCaptureDraft(inspection.sourceAssets, input.authoring);
          if (!assembly.ok) {
            failure("AUTHORING_INVALID", "capture authoring input failed validation", assembly.issues);
          } else {
            const draftIssues = validateFrameCaptureDraft(assembly.draft);
            const g1 = evaluateG1CaptureReadiness(assembly.draft);
            print({
              ok: draftIssues.length === 0,
              draftValid: draftIssues.length === 0,
              g1Ready: g1.ready,
              draftIssues,
              g1Issues: g1.issues,
              draft: assembly.draft,
            });
            process.exitCode = draftIssues.length === 0 ? 0 : 1;
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof SourceInspectionError) {
      failure(error.code, error.message);
    } else {
      print({
        ok: false,
        draftValid: false,
        g1Ready: false,
        draftIssues: [],
        g1Issues: [{ path: "draft", message: "G1 cannot be evaluated until the candidate draft is valid" }],
        error: { code: "AUTHORING_FAILED", message: "capture authoring failed unexpectedly" },
      });
      process.exitCode = 2;
    }
  }
}
