#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const ENV_NAMES = ["JESSICA_POSTGRES_ACCEPTANCE_URL", "JESSICA_POSTGRES_EXPIRY_ACCEPTANCE_URL", "JESSICA_POSTGRES_REPLAY_ACCEPTANCE_URL"];
const REPLAY_CONTAINER_ENV = "JESSICA_POSTGRES_REPLAY_CONTAINER_ID";

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
  return target ?? null;
}

function run(command, arguments_, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit", env: environment });
    child.once("error", reject);
    child.once("exit", (code, signal) => signal === null && code === 0 ? resolve() : reject(new Error("PostgreSQL acceptance child failed")));
  });
}

async function ready(containerId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "jessica_acceptance"]);
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error("restarted PostgreSQL replay service did not become ready");
}

let valid = true;
for (const envName of ENV_NAMES) {
  const target = validate(envName);
  if (!target) valid = false;
}
const replayContainerId = process.env[REPLAY_CONTAINER_ENV];
if (typeof replayContainerId !== "string" || !/^[a-f0-9]{64}$/.test(replayContainerId)) {
  process.stderr.write(`${REPLAY_CONTAINER_ENV} must be one exact Docker container ID\n`);
  process.exitCode = 2;
  valid = false;
}

if (valid) {
  const baseEnvironment = { ...process.env, JESSICA_POSTGRES_ACCEPTANCE_REQUIRED: "1" };
  try {
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/committed-review-postgres-acceptance.test.mjs"], baseEnvironment);
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/committed-review-replay-postgres-acceptance.test.mjs"], {
      ...baseEnvironment,
      JESSICA_POSTGRES_REPLAY_ACCEPTANCE_PHASE: "before-restart",
    });
    await run("docker", ["restart", replayContainerId]);
    await ready(replayContainerId);
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/committed-review-replay-postgres-acceptance.test.mjs"], {
      ...baseEnvironment,
      JESSICA_POSTGRES_REPLAY_ACCEPTANCE_PHASE: "after-restart",
    });
  } catch {
    process.exitCode = 1;
  }
}
