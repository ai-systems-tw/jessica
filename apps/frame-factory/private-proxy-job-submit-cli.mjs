#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { PrivateArtifactStoreError } from "./private-capture-draft-store.mjs";
import { submitPrivateProxyGenerationJob } from "./private-proxy-job-submission.mjs";

const AUTHORITY = "local-evidence-only";
function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function fail(code, message, status = 1) {
  print({ ok: false, error: { code, message }, authority: AUTHORITY, promotable: false, processingStarted: false });
  process.exitCode = status;
}

function parseArguments(args) {
  const flags = ["--ledger-path", "--max-attempts", "--created-at"];
  if (args.length !== 7 || args[0]?.startsWith("--") || flags.some((flag) => args.filter((item) => item === flag).length !== 1)) return undefined;
  const values = Object.fromEntries(flags.map((flag) => [flag, args[args.indexOf(flag) + 1]]));
  if (Object.values(values).some((value) => value === undefined || value.startsWith("--"))) return undefined;
  return { authoredInputPath: args[0], ledgerPath: values["--ledger-path"], maxAttempts: Number(values["--max-attempts"]), createdAt: values["--created-at"] };
}

const parsed = parseArguments(process.argv.slice(2));
if (!parsed) {
  fail("USAGE", "Usage: private-proxy-job-submit-cli.mjs <relative-private-authored-input> --ledger-path <relative-private-ledger> --max-attempts <1-10> --created-at <RFC3339-UTC>", 2);
} else {
  try {
    try { process.loadEnvFile(resolve(".env.local")); }
    catch (error) { if (!error || typeof error !== "object" || error.code !== "ENOENT") throw Object.assign(new Error("environment load failed"), { code: "EENV" }); }
    const root = process.env.JESSICA_PRIVATE_SOURCE_ROOT?.trim();
    if (!root) fail("ROOT_REQUIRED", "JESSICA_PRIVATE_SOURCE_ROOT is required", 2);
    else {
      const result = await submitPrivateProxyGenerationJob({ root, ...parsed });
      print({ ok: true, submission: result, authority: AUTHORITY, promotable: false, processingStarted: false });
    }
  } catch (error) {
    if (error instanceof PrivateArtifactStoreError) fail(error.code, error.message, 2);
    else if (error && typeof error === "object" && error.code === "EINPUTJSON") fail("INPUT_INVALID_JSON", "private authored wrapper is not valid JSON", 2);
    else if (error && typeof error === "object" && error.code === "EROOTINVALID") fail("ROOT_INVALID", "private root failed strict validation", 2);
    else if (error && typeof error === "object" && error.code === "EOUTPUTCONTAINMENT") fail("LEDGER_CONTAINMENT", "private ledger path failed strict containment or mode policy", 2);
    else if (error && typeof error === "object" && (error.code === "EEXIST" || error.code === "ESEQUENCECOLLISION")) fail("LEDGER_COLLISION", "private ledger sequence is occupied by different evidence", 3);
    else if (error && typeof error === "object" && error.code === "EAPPENDUNPROVEN") fail("APPEND_UNPROVEN", "private queued append could not be proven by replay", 2);
    else if (error instanceof TypeError || error instanceof SyntaxError) fail("SUBMISSION_INVALID", "private submission failed strict authored-input, policy, timestamp, or ledger validation", 2);
    else fail("SUBMISSION_IO", "private queued submission failed without processing", 2);
  }
}
