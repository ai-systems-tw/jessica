#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { verifyAuthoredProxyGeneratorInput } from "../../dist/packages/frame-generation/src/index.js";
import { PrivateArtifactStoreError, readPrivateArtifact } from "./private-capture-draft-store.mjs";
import { runProxyAutoProcessingWorker } from "./proxy-auto-processing-worker.mjs";

const INPUT_MAXIMUM_BYTES = 1024 * 1024;
const FLAGS = ["--ledger-path", "--output-path", "--evaluated-at", "--claimed-at", "--worker-id", "--claim-token", "--lease-expires-at", "--output-recorded-at", "--failed-at"];
const AUTHORITY = { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false };

function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function fail(code, message, exitCode = 1) {
  print({ ok: false, error: { code, message }, authority: AUTHORITY, g1: "active-not-ready", g2: "preparation-only-not-active-not-pass", g3: "not-pass" });
  process.exitCode = exitCode;
}

function parseArguments(args) {
  if (args.length !== 1 + FLAGS.length * 2 || args[0].startsWith("--") || FLAGS.some((flag) => args.filter((item) => item === flag).length !== 1)) return undefined;
  return { inputPath: args[0], values: Object.fromEntries(FLAGS.map((flag) => [flag, args[args.indexOf(flag) + 1]])) };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed) {
    fail("USAGE", "Usage: private-proxy-auto-worker-cli.mjs <relative-private-authored-input> --ledger-path <relative-ledger> --output-path <relative-output-dir> --evaluated-at <UTC> --claimed-at <UTC> --worker-id <id> --claim-token <token> --lease-expires-at <UTC> --output-recorded-at <UTC> --failed-at <UTC>", 2);
    return;
  }
  try {
    try { process.loadEnvFile(resolve(".env.local")); }
    catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) { fail("ENV_INVALID", "local environment file could not be loaded", 2); return; }
    }
    const root = process.env.JESSICA_PRIVATE_SOURCE_ROOT?.trim();
    if (!root) { fail("ROOT_REQUIRED", "JESSICA_PRIVATE_SOURCE_ROOT is required", 2); return; }
    const artifact = await readPrivateArtifact(root, parsed.inputPath, INPUT_MAXIMUM_BYTES);
    let wrapper;
    try { wrapper = JSON.parse(artifact.bytes.toString("utf8")); }
    catch { fail("INPUT_INVALID_JSON", "private authored input is not valid JSON"); return; }
    const verified = await verifyAuthoredProxyGeneratorInput(wrapper);
    const values = parsed.values;
    const result = await runProxyAutoProcessingWorker({
      proxyInput: verified.input,
      root,
      ledgerPath: values["--ledger-path"],
      outputPath: values["--output-path"],
      evaluatedAt: values["--evaluated-at"],
      claimedAt: values["--claimed-at"],
      workerId: values["--worker-id"],
      claimToken: values["--claim-token"],
      leaseExpiresAt: values["--lease-expires-at"],
      outputRecordedAt: values["--output-recorded-at"],
      failedAt: values["--failed-at"],
      privatePublication: true,
    });
    if (!result.ok) {
      print({ ok: false, error: result.error, failedEventRecorded: result.failedEventRecorded, recoveryRequired: result.recoveryRequired, authority: AUTHORITY, g1: result.g1, g2: result.g2, g3: result.g3 });
      process.exitCode = result.error.code === "CLAIM_CONTENTION" ? 3 : 1;
      return;
    }
    print({
      ok: true,
      state: { status: result.state.status, attempts: result.state.attempts },
      output: { existing: result.output.existing },
      authority: AUTHORITY,
      g1: result.g1,
      g2: result.g2,
      g3: result.g3,
    });
  } catch (error) {
    if (error instanceof PrivateArtifactStoreError) fail(error.code, error.message, 2);
    else if (error instanceof TypeError) fail("INPUT_INVALID", "private authored input failed strict validation");
    else fail("PRIVATE_PROCESSING_FAILED", "private proxy processing failed unexpectedly", 2);
  }
}

await main();
