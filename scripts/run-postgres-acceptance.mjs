#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const ENV_NAME = "JESSICA_POSTGRES_ACCEPTANCE_URL";
const raw = process.env[ENV_NAME];

function refuse() {
  process.stderr.write(`${ENV_NAME} must identify the dedicated local jessica_acceptance database\n`);
  process.exitCode = 2;
}

if (typeof raw !== "string" || raw.length < 1 || raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) {
  refuse();
} else {
  let target;
  try { target = new URL(raw); } catch { refuse(); }
  if (target) {
    const local = target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]";
    if (!local || !["postgres:", "postgresql:"].includes(target.protocol) || target.pathname !== "/jessica_acceptance" || target.hash !== "") {
      refuse();
    } else {
      const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "tests/committed-review-postgres-acceptance.test.mjs"], {
        stdio: "inherit",
        env: { ...process.env, JESSICA_POSTGRES_ACCEPTANCE_REQUIRED: "1" },
      });
      child.once("error", () => { process.exitCode = 1; });
      child.once("exit", (code, signal) => {
        process.exitCode = signal === null && code !== null ? code : 1;
      });
    }
  }
}
