import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

import { canonicalJson, sha256Hex } from "../dist/packages/contracts/src/index.js";
import { authorProxyGeneratorInput } from "../dist/packages/frame-generation/src/index.js";
import { createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { GENERATION_JOB_EVENT_MAXIMUM_BYTES, generationJobEventFileName, readImmutableGenerationJobLedger, writeImmutableGenerationJobEvent } from "../apps/frame-factory/generation-job-ledger-store.mjs";
import { writePrivateArtifact } from "../apps/frame-factory/private-capture-draft-store.mjs";
import { submitPrivateProxyGenerationJob } from "../apps/frame-factory/private-proxy-job-submission.mjs";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
const cli = new URL("../apps/frame-factory/private-proxy-job-submit-cli.mjs", import.meta.url).pathname;
const fixtureUrl = new URL("../fixtures/frame-generation/proxy-input-authoring.synthetic.json", import.meta.url);
const CREATED_AT = "2026-08-11T00:00:00Z";

async function authoredWrapper(mutateFixture) {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  mutateFixture?.(fixture);
  return authorProxyGeneratorInput(fixture.captureDraft, fixture.authoring);
}

async function setup(wrapper) {
  wrapper ??= await authoredWrapper();
  const root = await mkdtemp(join(tmpdir(), "jessica-private-submit-")); roots.push(root);
  await mkdir(join(root, "authored"), { mode: 0o700 });
  await writePrivateArtifact(root, "authored/input.json", Buffer.from(`${canonicalJson(wrapper)}\n`));
  return { root, wrapper, ledger: join(root, "jobs", "synthetic") };
}

function run(context, overrides = {}) {
  const args = [
    overrides.inputPath ?? "authored/input.json",
    "--ledger-path", overrides.ledgerPath ?? "jobs/synthetic",
    "--max-attempts", overrides.maxAttempts ?? "2",
    "--created-at", overrides.createdAt ?? CREATED_AT,
  ];
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: dirname(cli), env: { ...process.env, JESSICA_PRIVATE_SOURCE_ROOT: context.root },
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr, output: JSON.parse(stdout) }));
  });
}

function submit(context, operations) {
  return submitPrivateProxyGenerationJob({
    root: context.root, authoredInputPath: "authored/input.json", ledgerPath: "jobs/synthetic", maxAttempts: 2, createdAt: CREATED_AT,
  }, operations);
}

test("private submission derives and appends only the canonical queued event with 0700/0600 storage", async () => {
  const context = await setup();
  const result = await run(context);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.output, {
    ok: true,
    submission: { status: "queued", existing: false, attempts: 0, maxAttempts: 2 },
    authority: "local-evidence-only", promotable: false, processingStarted: false,
  });
  const events = await readImmutableGenerationJobLedger(context.ledger);
  const state = await replayGenerationJobLedger(events, { evaluatedAt: CREATED_AT });
  assert.equal(events.length, 1); assert.equal(events[0].eventType, "queued"); assert.equal(state.status, "queued");
  assert.equal(state.request.tenantId, context.wrapper.input.candidate.tenantId);
  assert.equal(state.request.frameModelId, context.wrapper.input.candidate.frameModelId);
  assert.deepEqual(state.request.generator, context.wrapper.input.generator);
  assert.deepEqual(state.request.sourceAssetSha256s, context.wrapper.input.sourceAssetHashes);
  assert.equal(state.request.measurementSetSha256, context.wrapper.input.measurementSet.sha256);
  assert.equal(state.request.generatorInputSha256, context.wrapper.canonicalInputSha256);
  assert.equal((await stat(join(context.root, "jobs"))).mode & 0o777, 0o700);
  assert.equal((await stat(context.ledger)).mode & 0o777, 0o700);
  const [eventName] = await readdir(context.ledger);
  assert.equal((await stat(join(context.ledger, eventName))).mode & 0o777, 0o600);
  assert.doesNotMatch(result.stdout, /[a-f0-9]{64}|synthetic-fixture|authored\/|jobs\/|\.json|\/tmp\//);
});

test("exact duplicate submission is idempotent and exact replay remains queued", async () => {
  const context = await setup();
  assert.equal((await run(context)).status, 0);
  const duplicate = await run(context);
  assert.equal(duplicate.status, 0, duplicate.stdout + duplicate.stderr);
  assert.equal(duplicate.output.submission.existing, true);
  const events = await readImmutableGenerationJobLedger(context.ledger);
  assert.equal(events.length, 1);
  assert.equal((await replayGenerationJobLedger(events, { evaluatedAt: CREATED_AT })).status, "queued");
});

test("a post-hard-link writer throw recovers only the exact canonical queued replay", async () => {
  const context = await setup();
  const receipt = await submit(context, {
    writeEvent: (directory, event, bytes) => writeImmutableGenerationJobEvent(directory, event, bytes, {
      linkFile: async (...args) => {
        await link(...args);
        throw Object.assign(new Error("private-post-link-detail"), { code: "EIO" });
      },
    }),
  });
  assert.deepEqual(receipt, { status: "queued", existing: true, recovered: true, attempts: 0, maxAttempts: 2 });
  assert.equal((await readImmutableGenerationJobLedger(context.ledger)).length, 1);
  assert.doesNotMatch(JSON.stringify(receipt), /private-post-link-detail|[a-f0-9]{64}|authored\/|jobs\/|\/tmp\//);
});

test("a pre-publication writer throw propagates only when the ledger remains proven empty", async () => {
  const context = await setup();
  const failure = Object.assign(new Error("private-writer-detail"), { code: "EIO" });
  await assert.rejects(submit(context, { writeEvent: async () => { throw failure; } }), (error) => error === failure);
  assert.deepEqual(await readImmutableGenerationJobLedger(context.ledger), []);
});

test("different, malformed, and unreadable post-error ledgers are append-unproven", async () => {
  const cases = [
    async (directory, event) => {
      const different = await createQueuedGenerationJobEvent({ ...event.payload.request, maxAttempts: 3 });
      await writeImmutableGenerationJobEvent(directory, different, Buffer.from(`${canonicalJson(different)}\n`));
      throw new Error("private-different-detail");
    },
    async (directory, event) => {
      await writeFile(join(directory, generationJobEventFileName(event)), "private-malformed-detail", { mode: 0o600 });
      throw new Error("private-malformed-writer-detail");
    },
  ];
  for (const writeEvent of cases) {
    const context = await setup();
    await assert.rejects(submit(context, { writeEvent }), (error) => {
      assert.equal(error.code, "EAPPENDUNPROVEN");
      assert.equal(error.message, "private queued append outcome is not exact");
      assert.doesNotMatch(error.message, /different-detail|malformed-detail|\/tmp\//);
      return true;
    });
  }

  const unreadable = await setup(); let reads = 0;
  await assert.rejects(submit(unreadable, {
    writeEvent: async () => { throw new Error("private-read-writer-detail"); },
    readLedger: async (directory) => {
      reads += 1;
      if (reads === 1) return readImmutableGenerationJobLedger(directory);
      throw new Error("private-unreadable-ledger-detail");
    },
  }), (error) => {
    assert.equal(error.code, "EAPPENDUNPROVEN");
    assert.doesNotMatch(error.message, /unreadable-ledger-detail|read-writer-detail/);
    return true;
  });
});

test("a successful writer with an unreadable verification replay is append-unproven", async () => {
  const context = await setup(); let reads = 0;
  await assert.rejects(submit(context, {
    readLedger: async (directory) => {
      reads += 1;
      if (reads === 1) return readImmutableGenerationJobLedger(directory);
      throw new Error("private-post-success-read-detail");
    },
  }), (error) => {
    assert.equal(error.code, "EAPPENDUNPROVEN");
    assert.doesNotMatch(error.message, /post-success-read-detail|\/tmp\//);
    return true;
  });
  assert.equal((await readImmutableGenerationJobLedger(context.ledger)).length, 1);
});

test("wrapper relabel, copied-digest tamper, and unbounded policy fail before ledger creation", async () => {
  for (const mutation of [
    async (wrapper) => { wrapper.input.candidate.tenantId = "relabelled-tenant"; },
    async (wrapper) => { wrapper.input.sourceAssetHashes[0] = "f".repeat(64); },
    async (wrapper) => { wrapper.input.measurementSet.sha256 = "e".repeat(64); wrapper.canonicalInputSha256 = await sha256Hex(canonicalJson(wrapper.input)); },
  ]) {
    const wrapper = structuredClone(await authoredWrapper()); await mutation(wrapper);
    const context = await setup(wrapper); const result = await run(context);
    assert.notEqual(result.status, 0); assert.equal(result.output.error.code, "SUBMISSION_INVALID");
    await assert.rejects(stat(context.ledger), { code: "ENOENT" });
  }
  const context = await setup();
  for (const maxAttempts of ["0", "11", "1.5", "not-a-number"]) {
    const result = await run(context, { maxAttempts });
    assert.notEqual(result.status, 0); assert.equal(result.output.error.code, "SUBMISSION_INVALID");
  }
});

test("private locators reject traversal, symlinks, permissive directories, oversized and malformed wrappers", async () => {
  const context = await setup();
  const outside = await mkdtemp(join(tmpdir(), "jessica-private-submit-outside-")); roots.push(outside);
  await symlink(outside, join(context.root, "linked"));
  for (const overrides of [
    { inputPath: "../private.json" }, { inputPath: "/tmp/private.json" },
    { ledgerPath: "../escaped" }, { ledgerPath: "linked/escaped" },
  ]) {
    const result = await run(context, overrides); assert.notEqual(result.status, 0); assert.equal(result.output.processingStarted, false);
  }
  await mkdir(join(context.root, "permissive"), { mode: 0o700 }); await chmod(join(context.root, "permissive"), 0o755);
  const permissive = await run(context, { ledgerPath: "permissive/ledger" });
  assert.equal(permissive.output.error.code, "LEDGER_CONTAINMENT");
  await writeFile(join(context.root, "authored", "large.json"), Buffer.alloc(1024 * 1024 + 1), { mode: 0o600 });
  assert.equal((await run(context, { inputPath: "authored/large.json" })).output.error.code, "INPUT_TOO_LARGE");
  await writeFile(join(context.root, "authored", "bad.json"), `{"candidate-secret":"/private/candidate/path"`, { mode: 0o600 });
  const malformed = await run(context, { inputPath: "authored/bad.json" });
  assert.equal(malformed.output.error.code, "INPUT_INVALID_JSON");
  assert.doesNotMatch(malformed.stdout + malformed.stderr, /candidate-secret|private\/candidate| at /);
  await assert.rejects(stat(join(outside, "escaped")), { code: "ENOENT" });
});

test("concurrent exact duplicates converge and different authored jobs cannot fork sequence one", async () => {
  const exact = await setup();
  const exactResults = await Promise.all([run(exact), run(exact)]);
  assert.equal(exactResults.filter((result) => result.status === 0).length, 2, exactResults.map((result) => result.stdout).join("\n"));
  assert.equal((await readImmutableGenerationJobLedger(exact.ledger)).length, 1);

  const first = await authoredWrapper();
  const second = await authoredWrapper((fixture) => { fixture.authoring.candidate.assetVersion += 1; });
  const competing = await setup(first);
  await writePrivateArtifact(competing.root, "authored/second.json", Buffer.from(`${canonicalJson(second)}\n`));
  const results = await Promise.all([run(competing), run(competing, { inputPath: "authored/second.json" })]);
  assert.equal(results.filter((result) => result.status === 0).length, 1, results.map((result) => result.stdout).join("\n"));
  const rejected = results.find((result) => result.status !== 0);
  assert.ok(
    ["LEDGER_COLLISION", "APPEND_UNPROVEN"].includes(rejected.output.error.code),
    rejected.stdout,
  );
  assert.equal(rejected.output.processingStarted, false);
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /[a-f0-9]{64}|authored\/|jobs\/|\.json|\/tmp\/| at /);
  assert.equal((await readImmutableGenerationJobLedger(competing.ledger)).length, 1);
});

test("tampered or symlinked ledger evidence is rejected without overwrite and receipts stay sanitized", async () => {
  const context = await setup(); assert.equal((await run(context)).status, 0);
  const [name] = await readdir(context.ledger); const eventPath = join(context.ledger, name);
  await writeFile(eventPath, `{"candidate-id":"private-candidate-8844"}`);
  const tampered = await run(context);
  assert.notEqual(tampered.status, 0); assert.equal(tampered.output.error.code, "SUBMISSION_INVALID");
  assert.doesNotMatch(tampered.stdout + tampered.stderr, /private-candidate-8844|[a-f0-9]{64}|\/tmp\/| at /);
  assert.equal(await readFile(eventPath, "utf8"), `{"candidate-id":"private-candidate-8844"}`);

  const linked = await setup(); await mkdir(join(linked.root, "jobs"), { mode: 0o700 }); await mkdir(linked.ledger, { mode: 0o700 });
  const outside = join(linked.root, "outside-event.json"); await writeFile(outside, "outside", { mode: 0o600 });
  await symlink(outside, join(linked.ledger, "00000001.job-event.json"));
  const symlinked = await run(linked); assert.notEqual(symlinked.status, 0); assert.equal(symlinked.output.error.code, "SUBMISSION_INVALID");
  assert.equal(await readFile(outside, "utf8"), "outside");

  const oversized = await setup(); await mkdir(join(oversized.root, "jobs"), { mode: 0o700 }); await mkdir(oversized.ledger, { mode: 0o700 });
  const oversizedPath = join(oversized.ledger, "00000001.job-event.json");
  const oversizedBytes = Buffer.alloc(GENERATION_JOB_EVENT_MAXIMUM_BYTES + 1, 0x5a);
  await writeFile(oversizedPath, oversizedBytes, { mode: 0o600 });
  const oversizedResult = await run(oversized); assert.notEqual(oversizedResult.status, 0); assert.equal(oversizedResult.output.error.code, "SUBMISSION_INVALID");
  assert.deepEqual(await readFile(oversizedPath), oversizedBytes);
});
