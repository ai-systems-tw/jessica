import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { appendGenerationJobEvent, createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { generationJobEventFileName, writeImmutableGenerationJobEvent } from "../apps/frame-factory/generation-job-ledger-store.mjs";

const cli = new URL("../apps/frame-factory/generation-job-ledger-cli.mjs", import.meta.url);
const H = (digit) => digit.repeat(64);
const request = { schemaVersion: 1, tenantId: "synthetic-tenant", frameModelId: "synthetic-model-not-j1m", method: "proxy-auto", generator: { id: "synthetic-proxy", version: "1-test", configSha256: H("a") }, sourceAssetSha256s: [H("b")], measurementSetSha256: H("c"), generatorInputSha256: H("d"), maxAttempts: 2, createdAt: "2026-08-11T00:00:00Z" };
function run(args) { return spawnSync(process.execPath, [cli.pathname, ...args, "--evaluated-at", "2026-08-11T01:00:00Z"], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }); }
function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli.pathname, ...args, "--evaluated-at", "2026-08-11T01:00:00Z"], { cwd: new URL("..", import.meta.url).pathname });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
async function eventFile(root, event) { const path = join(root, "event.json"); await writeFile(path, `${JSON.stringify(event)}\n`); return path; }

test("CLI appends canonical digest-bound sequence bytes and accepts only exact idempotent replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-job-ledger-")); const event = await createQueuedGenerationJobEvent(request); const input = await eventFile(root, event);
  const first = run([input, "--root", root, "--output-path", "evidence/jobs/synthetic"]); assert.equal(first.status, 0, first.stdout + first.stderr);
  const report = JSON.parse(first.stdout); assert.equal(report.authority, "local-evidence-only"); assert.equal(report.promotable, false); assert.equal(report.g3, "not-pass");
  const output = join(root, "evidence/jobs/synthetic"); const names = await readdir(output); assert.deepEqual(names, [report.event.file]);
  assert.equal(await readFile(join(output, names[0]), "utf8"), `${canonicalJson(event)}\n`);
  const second = run([input, "--root", root, "--output-path", "evidence/jobs/synthetic"]); assert.equal(second.status, 0); assert.equal(JSON.parse(second.stdout).event.existing, true);
  await writeFile(join(output, names[0]), "tampered");
  const tamper = run([input, "--root", root, "--output-path", "evidence/jobs/synthetic"]); assert.notEqual(tamper.status, 0); assert.equal(JSON.parse(tamper.stdout).error.code, "LEDGER_INVALID");
});

test("CLI rejects traversal, symlink escape, event symlinks, malformed input, and hides paths/keys/stacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-job-privacy-")); const outside = await mkdtemp(join(tmpdir(), "jessica-job-outside-"));
  const event = await createQueuedGenerationJobEvent(request); const input = await eventFile(root, event);
  const traversal = run([input, "--root", root, "--output-path", "../escape"]); assert.equal(JSON.parse(traversal.stdout).error.code, "OUTPUT_PATH_INVALID");
  await symlink(outside, join(root, "linked")); const escaped = run([input, "--root", root, "--output-path", "linked/jobs"]); assert.equal(JSON.parse(escaped.stdout).error.code, "OUTPUT_CONTAINMENT");
  await assert.rejects(stat(join(outside, "jobs")), { code: "ENOENT" });
  const malformed = join(root, "customer-private-key.json"); await writeFile(malformed, `{\"/Users/customer/secret.pem\":`);
  const bad = run([malformed, "--root", root, "--output-path", "safe"]); assert.equal(JSON.parse(bad.stdout).error.code, "INPUT_INVALID_JSON"); assert.doesNotMatch(bad.stdout + bad.stderr, /customer-private|secret\.pem|\/Users\/customer| at /);

  const ledger = join(root, "symlink-ledger"); await mkdir(ledger); const target = join(outside, "target.json"); await writeFile(target, `${JSON.stringify(event)}\n`); await symlink(target, join(ledger, generationJobEventFileName(event)));
  const linkedEvent = run([input, "--root", root, "--output-path", "symlink-ledger"]); assert.equal(JSON.parse(linkedEvent.stdout).error.code, "LEDGER_INVALID");
});

test("atomic writer cleans partial temporary bytes and never overwrites a collision", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-job-atomic-")); const event = await createQueuedGenerationJobEvent(request); const bytes = Buffer.from(`${canonicalJson(event)}\n`);
  await assert.rejects(writeImmutableGenerationJobEvent(root, event, bytes, { linkFile: async () => { const error = new Error("injected"); error.code = "EIO"; throw error; } }), /injected/);
  assert.deepEqual(await readdir(root), []);
  const created = await writeImmutableGenerationJobEvent(root, event, bytes); const path = join(root, created.file); const before = await readFile(path);
  await assert.rejects(writeImmutableGenerationJobEvent(root, event, Buffer.from("mismatch")), { code: "EEXIST" });
  assert.deepEqual(await readFile(path), before); assert.equal((await stat(path)).isFile(), true);
});

test("concurrent competing claims use one atomic sequence slot and cannot fork the ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-job-cas-")); const ledgerPath = "evidence/jobs/cas";
  const queued = await createQueuedGenerationJobEvent(request); const queuedInput = await eventFile(root, queued);
  assert.equal(run([queuedInput, "--root", root, "--output-path", ledgerPath]).status, 0);
  const state = await replayGenerationJobLedger([queued], { evaluatedAt: "2026-08-11T00:00:00Z" });
  const firstClaim = await appendGenerationJobEvent(state, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker-a", claimToken: "claim-a", leaseExpiresAt: "2026-08-11T00:10:01Z" });
  const secondClaim = await appendGenerationJobEvent(state, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker-b", claimToken: "claim-b", leaseExpiresAt: "2026-08-11T00:10:01Z" });
  const firstInput = join(root, "claim-a.json"); const secondInput = join(root, "claim-b.json");
  await writeFile(firstInput, `${JSON.stringify(firstClaim)}\n`); await writeFile(secondInput, `${JSON.stringify(secondClaim)}\n`);
  const results = await Promise.all([
    runAsync([firstInput, "--root", root, "--output-path", ledgerPath]),
    runAsync([secondInput, "--root", root, "--output-path", ledgerPath]),
  ]);
  assert.equal(results.filter((result) => result.status === 0).length, 1, results.map((result) => result.stdout + result.stderr).join("\n"));
  const loser = results.find((result) => result.status !== 0); assert.equal(JSON.parse(loser.stdout).error.code, "OUTPUT_COLLISION");
  const winnerIndex = results.findIndex((result) => result.status === 0); const winnerInput = winnerIndex === 0 ? firstInput : secondInput;
  const replay = run([winnerInput, "--root", root, "--output-path", ledgerPath]); assert.equal(replay.status, 0, replay.stdout + replay.stderr); assert.equal(JSON.parse(replay.stdout).state.status, "running");
  assert.deepEqual((await readdir(join(root, ledgerPath))).sort(), [generationJobEventFileName(queued), generationJobEventFileName(firstClaim)].sort());
});
