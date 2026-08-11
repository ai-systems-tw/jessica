#!/usr/bin/env node
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

import { generateProxyBundle, verifyAuthoredProxyGeneratorInput } from "../../dist/packages/frame-generation/src/index.js";
import { writeExclusiveProxyBundle } from "./proxy-output.mjs";

function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function fail(code, message, exitCode = 1) {
  print({ ok: false, error: { code, message }, status: "draft", quality: "proxy", recommendedForLive: false });
  process.exitCode = exitCode;
}
function contained(root, candidate) {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !path.includes("/../") && !resolve(candidate).startsWith(`${resolve(root)}/../`);
}
async function exists(path) {
  try { const handle = await open(path, "r"); await handle.close(); return true; } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

const args = process.argv.slice(2);
const outputFlag = args.indexOf("--output-dir");
if (args.length !== 3 || outputFlag < 0 || outputFlag === 0 || outputFlag === args.length - 1) {
  fail("USAGE", "Usage: proxy-generate-cli.mjs <input.json> --output-dir <local-directory>");
} else {
  try {
    const inputPath = resolve(args[0]);
    const outputDirectory = resolve(args[outputFlag + 1]);
    let inputText;
    try { inputText = await readFile(inputPath, "utf8"); } catch (error) {
      fail(error && typeof error === "object" && error.code === "ENOENT" ? "INPUT_MISSING" : "INPUT_UNREADABLE", "proxy input could not be read");
    }
    if (inputText !== undefined) {
      let input;
      try { input = JSON.parse(inputText); } catch { fail("INPUT_INVALID_JSON", "proxy input is not valid JSON"); }
      if (input !== undefined) {
        const generatorInput = input && typeof input === "object" && !Array.isArray(input)
          && ("input" in input || "canonicalInputSha256" in input || "provenance" in input)
          ? (await verifyAuthoredProxyGeneratorInput(input)).input
          : input;
        const bundle = await generateProxyBundle(generatorInput);
        await mkdir(outputDirectory, { recursive: true });
        const actualOutputDirectory = await realpath(outputDirectory);
        const glbPath = resolve(actualOutputDirectory, bundle.glbFileName);
        const manifestPath = resolve(actualOutputDirectory, bundle.manifestFileName);
        if (!contained(actualOutputDirectory, glbPath) || !contained(actualOutputDirectory, manifestPath) || dirname(glbPath) !== actualOutputDirectory || dirname(manifestPath) !== actualOutputDirectory) {
          fail("OUTPUT_CONTAINMENT", "generated output names did not remain inside the explicit output directory", 2);
        } else if (await exists(glbPath) || await exists(manifestPath)) {
          fail("OUTPUT_COLLISION", "content-addressed output already exists; overwrite is refused");
        } else {
          try {
            await writeExclusiveProxyBundle({ glbPath, manifestPath, glb: bundle.glb, manifestJson: bundle.manifestJson });
          } catch (error) {
            if (error && typeof error === "object" && error.code === "EEXIST") fail("OUTPUT_COLLISION", "content-addressed output collision or tamper was detected");
            else throw error;
          }
          if (process.exitCode === undefined) {
            print({
              ok: true,
              files: { glb: bundle.glbFileName, manifest: bundle.manifestFileName },
              canonicalInputSha256: bundle.canonicalInputSha256,
              manifestSha256: bundle.manifestSha256,
              outputGlb: bundle.manifest.proxyGeneration.outputGlb,
              actualBoundsMetres: bundle.manifest.model.boundsMetres,
              status: "draft", quality: "proxy", recommendedForLive: false,
              admission: "calibration-only", g1: "active-not-ready", g2: "preparation-only-not-active-not-pass",
            });
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof TypeError) fail("INPUT_INVALID", "proxy input failed strict validation");
    else fail("GENERATION_FAILED", "proxy generation failed unexpectedly", 2);
  }
}
