#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const ENV_NAMES = ["JESSICA_POSTGRES_ACCEPTANCE_URL", "JESSICA_POSTGRES_EXPIRY_ACCEPTANCE_URL"];

function refuse(envName) {
  process.stderr.write(`${envName} must identify the dedicated local jessica_acceptance database\n`);
  process.exitCode = 2;
}

function validate(envName) {
  const raw = process.env[envName];
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) {
    refuse(envName);
    return false;
  }
  let target;
  try { target = new URL(raw); } catch { refuse(envName); }
  if (target) {
    const local = target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]";
    const hasQuery = target.href.includes("?");
    const hasFragment = target.href.includes("#");
    if (!local || !["postgres:", "postgresql:"].includes(target.protocol) || target.pathname !== "/jessica_acceptance" || hasQuery || hasFragment) {
      refuse(envName);
      return false;
    }
  }
  return Boolean(target);
}

if (ENV_NAMES.every(validate)) {
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "tests/committed-review-postgres-acceptance.test.mjs"], {
    stdio: "inherit",
    env: { ...process.env, JESSICA_POSTGRES_ACCEPTANCE_REQUIRED: "1" },
  });
  child.once("error", () => { process.exitCode = 1; });
  child.once("exit", (code, signal) => {
    process.exitCode = signal === null && code !== null ? code : 1;
  });
}
