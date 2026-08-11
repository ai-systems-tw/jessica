#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { runProxyAutoProcessingWorker } from "./proxy-auto-processing-worker.mjs";

const FLAGS = ["--root", "--ledger-path", "--output-path", "--evaluated-at", "--claimed-at", "--worker-id", "--claim-token", "--lease-expires-at", "--output-recorded-at", "--failed-at"];
function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function usage() { print({ ok: false, error: { code: "USAGE", message: "Usage: proxy-auto-worker-cli.mjs <proxy-input.json> --root <existing-local-root> --ledger-path <relative-existing-ledger> --output-path <relative-output-dir> --evaluated-at <UTC> --claimed-at <UTC> --worker-id <id> --claim-token <token> --lease-expires-at <UTC> --output-recorded-at <UTC> --failed-at <UTC>" }, promotable: false }); process.exitCode = 2; }

const args = process.argv.slice(2);
if (args.length !== 1 + FLAGS.length * 2 || FLAGS.some((flag) => args.filter((item) => item === flag).length !== 1)) usage();
else {
  const values = Object.fromEntries(FLAGS.map((flag) => [flag, args[args.indexOf(flag) + 1]]));
  let proxyInput;
  try { proxyInput = JSON.parse(await readFile(args[0], "utf8")); }
  catch { print({ ok: false, error: { code: "INPUT_UNREADABLE", message: "proxy input could not be read as strict JSON" }, promotable: false }); process.exitCode = 2; }
  if (proxyInput !== undefined) {
    const result = await runProxyAutoProcessingWorker({
      proxyInput, root: values["--root"], ledgerPath: values["--ledger-path"], outputPath: values["--output-path"],
      evaluatedAt: values["--evaluated-at"], claimedAt: values["--claimed-at"], workerId: values["--worker-id"], claimToken: values["--claim-token"],
      leaseExpiresAt: values["--lease-expires-at"], outputRecordedAt: values["--output-recorded-at"], failedAt: values["--failed-at"],
    });
    print(result); process.exitCode = result.ok ? 0 : result.error.code === "CLAIM_CONTENTION" ? 3 : 1;
  }
}
