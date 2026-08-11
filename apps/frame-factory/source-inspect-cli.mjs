#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { inspectSourceSpec, SourceInspectionError } from "../../scripts/source-inspection.mjs";

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const inputArgument = process.argv[2];
if (!inputArgument) {
  print({
    ok: false,
    error: {
      code: "USAGE",
      message: "Usage: node apps/frame-factory/source-inspect-cli.mjs <source-spec.json>",
    },
  });
  process.exitCode = 2;
} else {
  const inputPath = resolve(inputArgument);
  try {
    try {
      process.loadEnvFile(resolve(".env.local"));
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        throw new SourceInspectionError("ENV_INVALID", "local environment file could not be loaded", "spec");
      }
    }
    let sourceText;
    try {
      sourceText = await readFile(inputPath, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && error.code === "ENOENT"
        ? "SPEC_MISSING"
        : "SPEC_UNREADABLE";
      throw new SourceInspectionError(code, "source specification could not be read", "spec");
    }
    let spec;
    try {
      spec = JSON.parse(sourceText);
    } catch {
      throw new SourceInspectionError("SPEC_INVALID_JSON", "source specification is not valid JSON", "spec");
    }
    const configuredSourceRoot = process.env.JESSICA_PRIVATE_SOURCE_ROOT?.trim();
    const sourceRoot = configuredSourceRoot ? resolve(configuredSourceRoot) : dirname(inputPath);
    const result = await inspectSourceSpec(spec, { manifestDirectory: sourceRoot });
    print({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SourceInspectionError) {
      print({
        ok: false,
        error: { code: error.code, sourceId: error.sourceId, message: error.message },
      });
      process.exitCode = 1;
    } else {
      print({
        ok: false,
        error: { code: "INSPECTION_FAILED", message: "source inspection failed unexpectedly" },
      });
      process.exitCode = 2;
    }
  }
}
