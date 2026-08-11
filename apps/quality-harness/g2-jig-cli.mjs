#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { evaluateCaptureJigReadiness } from "../../dist/packages/contracts/src/index.js";

const path = process.argv[2] ?? "fixtures/g2/capture-jig-v1.template.json";
const artifactArgument = process.argv[3];
try {
  const profile = JSON.parse(await readFile(path, "utf8"));
  let inspection;
  if (artifactArgument !== undefined) {
    if (isAbsolute(artifactArgument) || artifactArgument.split(/[\\/]/).includes("..") || profile?.calibrationArtifact?.objectKey !== artifactArgument) throw Object.assign(new Error(), { safeCode: "unsafe_artifact_path" });
    const profileDirectory = await realpath(dirname(resolve(path))); const artifactPath = resolve(profileDirectory, artifactArgument); const actualArtifactPath = await realpath(artifactPath); const contained = relative(profileDirectory, actualArtifactPath);
    if (!contained || contained.startsWith("..") || isAbsolute(contained)) throw Object.assign(new Error(), { safeCode: "unsafe_artifact_path" });
    const bytes = await readFile(actualArtifactPath); inspection = { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength };
  }
  const result = evaluateCaptureJigReadiness(profile, inspection); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.runReady ? 0 : 1;
} catch (error) {
  const code = error instanceof SyntaxError ? "invalid_json" : error && typeof error === "object" && "safeCode" in error ? error.safeCode : error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? "input_unavailable" : "input_error";
  console.log(JSON.stringify({ error: { code, message: code === "invalid_json" ? "input must be valid JSON" : code === "unsafe_artifact_path" ? "artifact path is not an allowed relative profile artifact" : "input could not be read" } }, null, 2)); process.exitCode = 2;
}
