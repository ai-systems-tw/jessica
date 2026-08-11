import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, mkdtemp, mkdir, open, readFile, readdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";
import { appendGenerationJobEvent, createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { runProxyAutoProcessingWorker } from "../apps/frame-factory/proxy-auto-processing-worker.mjs";
import { readImmutableGenerationJobLedger, writeImmutableGenerationJobEvent } from "../apps/frame-factory/generation-job-ledger-store.mjs";

const fixtureUrl = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);
const cli = new URL("../apps/frame-factory/proxy-auto-worker-cli.mjs", import.meta.url);
const BASE = {
  evaluatedAt: "2026-08-11T00:04:30Z", claimedAt: "2026-08-11T00:00:01Z", workerId: "local-worker-a", claimToken: "claim-token-a",
  leaseExpiresAt: "2026-08-11T00:05:01Z", outputRecordedAt: "2026-08-11T00:00:03Z", failedAt: "2026-08-11T00:00:04Z",
};
const REPLAY_AT = "2026-08-11T00:20:00Z";

async function fixture() { return JSON.parse(await readFile(fixtureUrl, "utf8")); }
async function setup(requestOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "jessica-proxy-worker-"));
  const input = await fixture(); const bundle = await generateProxyBundle(input);
  const request = {
    schemaVersion: 1, tenantId: input.candidate.tenantId, frameModelId: input.candidate.frameModelId, method: "proxy-auto", generator: input.generator,
    sourceAssetSha256s: input.sourceAssetHashes, measurementSetSha256: input.measurementSet.sha256, generatorInputSha256: bundle.canonicalInputSha256,
    maxAttempts: 3, createdAt: "2026-08-11T00:00:00Z", ...requestOverrides,
  };
  const ledgerDirectory = join(root, "jobs", "synthetic"); await mkdir(ledgerDirectory, { recursive: true });
  const queued = await createQueuedGenerationJobEvent(request);
  await writeImmutableGenerationJobEvent(ledgerDirectory, queued, Buffer.from(`${canonicalJson(queued)}\n`));
  return { root, input, bundle, ledgerDirectory, options: { ...BASE, root, ledgerPath: "jobs/synthetic", outputPath: "outputs/synthetic", proxyInput: input } };
}
async function stateOf(context) { const events = await readImmutableGenerationJobLedger(context.ledgerDirectory); return replayGenerationJobLedger(events, { evaluatedAt: REPLAY_AT }); }
async function appendTo(context, type, at, payload) {
  const state = await stateOf(context); const event = await appendGenerationJobEvent(state, type, at, payload);
  await writeImmutableGenerationJobEvent(context.ledgerDirectory, event, Buffer.from(`${canonicalJson(event)}\n`)); return event;
}

test("queued proxy-auto runs claimed to review from independently reread actual bytes only", async () => {
  const context = await setup(); const result = await runProxyAutoProcessingWorker(context.options);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.state.status, "review"); assert.equal(result.output.existing, false);
  const state = await stateOf(context); assert.equal(state.status, "review"); assert.equal(state.sequence, 3); assert.equal(state.output.modelSha256, context.bundle.manifest.model.sha256);
  assert.deepEqual(result.authority, { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false });
  assert.equal(result.g3, "not-pass"); assert.deepEqual((await readImmutableGenerationJobLedger(context.ledgerDirectory)).map((event) => event.eventType), ["queued", "claimed", "output-recorded"]);
});

test("retry safely reuses the exact deterministic content pair and never overwrites it", async () => {
  const context = await setup(); const first = await runProxyAutoProcessingWorker(context.options, { afterWrite: async () => { throw Object.assign(new Error("injected"), { code: "EIO" }); } });
  assert.equal(first.ok, false); assert.equal(first.error.retryClassification, "retryable"); assert.equal(first.failedEventRecorded, true); assert.equal((await stateOf(context)).status, "failed");
  const failed = await stateOf(context); await appendTo(context, "retry-queued", "2026-08-11T00:00:05Z", { failureEventSha256: failed.failure.eventSha256 });
  const second = await runProxyAutoProcessingWorker({ ...context.options, evaluatedAt: "2026-08-11T00:00:09Z", claimedAt: "2026-08-11T00:00:06Z", claimToken: "claim-token-b", leaseExpiresAt: "2026-08-11T00:05:06Z", outputRecordedAt: "2026-08-11T00:00:07Z", failedAt: "2026-08-11T00:00:08Z" });
  assert.equal(second.ok, true, JSON.stringify(second)); assert.equal(second.output.existing, true); assert.equal((await stateOf(context)).status, "review");
});

test("tenant/model/source/measurement/generator/config/full-input substitutions fail before claim", async () => {
  const mutations = [
    (value) => { value.candidate.tenantId = "other-tenant"; }, (value) => { value.candidate.frameModelId = "other-model"; },
    (value) => { value.sourceAssetHashes[0] = "e".repeat(64); }, (value) => { value.measurementSet.sha256 = "e".repeat(64); },
    (value) => { value.generator.id = "other-generator"; }, (value) => { value.generator.version = "2"; },
    (value) => { value.generator.configSha256 = "e".repeat(64); }, (value) => { value.profile.bridgeAnchors.left[1] = 1; },
    (value) => { value.measurementSet.version = 2; },
  ];
  for (const mutate of mutations) {
    const context = await setup(); mutate(context.options.proxyInput); const result = await runProxyAutoProcessingWorker(context.options);
    assert.equal(result.ok, false); assert.equal(result.failedEventRecorded, false); assert.equal((await stateOf(context)).status, "queued");
  }
});

test("non-proxy methods, active/expired claims, and overlong leases are never taken", async () => {
  const nonProxy = await setup({ method: "standard-auto" }); const rejected = await runProxyAutoProcessingWorker(nonProxy.options);
  assert.equal(rejected.ok, false); assert.equal((await stateOf(nonProxy)).status, "queued");
  for (const expiry of ["2026-08-11T00:05:01Z", "2026-08-11T00:00:02Z"]) {
    const context = await setup(); await appendTo(context, "claimed", BASE.claimedAt, { workerId: "other", claimToken: "other-claim", leaseExpiresAt: expiry });
    const result = await runProxyAutoProcessingWorker(context.options); assert.equal(result.ok, false); assert.equal(result.failedEventRecorded, false); assert.equal((await stateOf(context)).status, "running");
  }
  const overlong = await setup(); const result = await runProxyAutoProcessingWorker({ ...overlong.options, leaseExpiresAt: "2026-08-11T00:15:01.001Z" });
  assert.equal(result.ok, false); assert.equal((await stateOf(overlong)).status, "queued");
});

test("a proposed lease expired at evaluatedAt and non-live result timelines fail before claim", async () => {
  const cases = [
    { leaseExpiresAt: "2026-08-11T00:04:15Z" },
    { outputRecordedAt: BASE.claimedAt },
    { failedAt: BASE.claimedAt },
    { outputRecordedAt: "2026-08-11T00:04:31Z" },
    { failedAt: "2026-08-11T00:04:31Z" },
  ];
  for (const override of cases) {
    const context = await setup(); const result = await runProxyAutoProcessingWorker({ ...context.options, ...override });
    assert.equal(result.ok, false); assert.equal(result.error.code, "WORKER_TIMELINE_INVALID"); assert.equal(result.failedEventRecorded, false);
    assert.equal((await stateOf(context)).status, "queued"); assert.deepEqual((await readImmutableGenerationJobLedger(context.ledgerDirectory)).map((event) => event.eventType), ["queued"]);
  }
});

test("concurrent runners produce one claim owner and one review output", async () => {
  const context = await setup();
  const [first, second] = await Promise.all([
    runProxyAutoProcessingWorker(context.options),
    runProxyAutoProcessingWorker({ ...context.options, workerId: "local-worker-b", claimToken: "claim-token-b" }),
  ]);
  assert.equal([first, second].filter((item) => item.ok).length, 1, JSON.stringify([first, second]));
  const loser = [first, second].find((item) => !item.ok); assert.equal(loser.error.code, "CLAIM_CONTENTION");
  assert.equal((await stateOf(context)).status, "review"); assert.equal((await readImmutableGenerationJobLedger(context.ledgerDirectory)).length, 3);
});

test("claim hard-link success followed by an I/O error is replay-proven and continues safely", async () => {
  const context = await setup(); let links = 0;
  const result = await runProxyAutoProcessingWorker(context.options, { ledgerWrite: {
    linkFile: async (temporary, final) => { links += 1; await link(temporary, final); if (links === 1) throw Object.assign(new Error("reported after publish"), { code: "EIO" }); },
  } });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.state.status, "review");
  assert.deepEqual((await readImmutableGenerationJobLedger(context.ledgerDirectory)).map((event) => event.eventType), ["queued", "claimed", "output-recorded"]);
});

test("unprovable claim append outcome reports recoveryRequired and never claims no mutation", async () => {
  const context = await setup();
  const result = await runProxyAutoProcessingWorker(context.options, { ledgerWrite: {
    linkFile: async (temporary, final) => { await link(temporary, final); await writeFile(final, "ambiguous-tampered-claim"); throw Object.assign(new Error("ambiguous"), { code: "EIO" }); },
  } });
  assert.equal(result.ok, false); assert.equal(result.error.code, "CLAIM_COMMIT_UNPROVEN"); assert.equal(result.error.retryClassification, "terminal");
  assert.equal(result.failedEventRecorded, false); assert.equal(result.recoveryRequired, true);
  assert.equal((await readdir(context.ledgerDirectory)).some((name) => name === "00000002.job-event.json"), true, "ambiguous published slot remains for operator recovery");
  await assert.rejects(readImmutableGenerationJobLedger(context.ledgerDirectory));
});

test("manifest and GLB tamper/hash/length/URL/identity/structure mismatches are terminal and cleaned only when invocation-created", async () => {
  const tamperers = [
    async ({ manifestPath }) => { const value = JSON.parse(await readFile(manifestPath, "utf8")); value.model.url = "./other.glb"; await writeFile(manifestPath, JSON.stringify(value)); },
    async ({ manifestPath }) => { const bytes = await readFile(manifestPath); await writeFile(manifestPath, bytes.subarray(0, bytes.length - 1)); },
    async ({ glbPath }) => { const bytes = await readFile(glbPath); bytes[0] ^= 1; await writeFile(glbPath, bytes); },
    async ({ glbPath }) => { const bytes = await readFile(glbPath); await writeFile(glbPath, bytes.subarray(0, bytes.length - 4)); },
  ];
  for (const afterWrite of tamperers) {
    const context = await setup(); const result = await runProxyAutoProcessingWorker(context.options, { afterWrite });
    assert.equal(result.ok, false); assert.equal(result.error.code, "OUTPUT_VALIDATION"); assert.equal(result.error.retryClassification, "terminal"); assert.equal(result.failedEventRecorded, true);
    assert.deepEqual(await readdir(join(context.root, "outputs", "synthetic")), []); assert.equal((await stateOf(context)).status, "failed");
  }
  const collision = await setup(); const output = join(collision.root, "outputs", "synthetic"); await mkdir(output, { recursive: true }); await writeFile(join(output, collision.bundle.glbFileName), "pre-existing-tamper");
  const result = await runProxyAutoProcessingWorker(collision.options); assert.equal(result.error.code, "OUTPUT_COLLISION"); assert.equal(await readFile(join(output, collision.bundle.glbFileName), "utf8"), "pre-existing-tamper");
});

test("injected partial local I/O is cleaned and recorded with safe retry classification", async () => {
  const context = await setup(); let opens = 0;
  const result = await runProxyAutoProcessingWorker(context.options, { bundleWrite: {
    openFile: async (path, flags) => {
      const handle = await open(path, flags); opens += 1; if (opens === 1) return handle;
      return { writeFile: async () => { throw Object.assign(new Error("injected"), { code: "EIO" }); }, close: () => handle.close() };
    }, removeFile: unlink,
  } });
  assert.equal(result.ok, false); assert.equal(result.error.code, "LOCAL_IO_CLEAN"); assert.equal(result.error.retryClassification, "retryable"); assert.equal(result.failedEventRecorded, true);
  assert.deepEqual(await readdir(join(context.root, "outputs", "synthetic")), []);
});

test("output-record append I/O records a retryable failure only while the exact claim remains owned", async () => {
  const context = await setup(); let links = 0;
  const result = await runProxyAutoProcessingWorker(context.options, { ledgerWrite: {
    linkFile: async (temporary, final) => { links += 1; if (links === 2) throw Object.assign(new Error("injected"), { code: "EIO" }); return link(temporary, final); },
  } });
  assert.equal(result.ok, false); assert.equal(result.error.code, "OUTPUT_RECORD_IO"); assert.equal(result.error.retryClassification, "retryable");
  assert.equal(result.failedEventRecorded, true); assert.equal((await stateOf(context)).status, "failed");
  assert.equal((await readdir(join(context.root, "outputs", "synthetic"))).length, 2, "complete verified content-addressed output remains reusable");
});

test("post-write missing or symlink-swapped invocation output is terminal, never followed, and cleaned", async () => {
  for (const mode of ["missing", "symlink"]) {
    const context = await setup(); const outside = join(context.root, "outside-private-bytes"); await writeFile(outside, "must-not-be-followed-or-changed");
    const result = await runProxyAutoProcessingWorker(context.options, { afterWrite: async ({ glbPath }) => {
      await unlink(glbPath); if (mode === "symlink") await symlink(outside, glbPath);
    } });
    assert.equal(result.ok, false); assert.equal(result.error.code, "OUTPUT_VALIDATION"); assert.equal(result.error.retryClassification, "terminal");
    assert.equal(result.failedEventRecorded, true); assert.equal(result.recoveryRequired, false); assert.equal((await stateOf(context)).status, "failed");
    assert.deepEqual(await readdir(join(context.root, "outputs", "synthetic")), []);
    assert.equal(await readFile(outside, "utf8"), "must-not-be-followed-or-changed");
  }
});

test("CLI rejects traversal/symlink paths and sanitizes private input/path/key details", async () => {
  const context = await setup(); const inputPath = join(context.root, "proxy-input.json"); await writeFile(inputPath, JSON.stringify(context.input));
  const common = [inputPath, "--root", context.root, "--ledger-path", "jobs/synthetic", "--output-path", "../private-output", "--evaluated-at", BASE.evaluatedAt, "--claimed-at", BASE.claimedAt, "--worker-id", BASE.workerId, "--claim-token", BASE.claimToken, "--lease-expires-at", BASE.leaseExpiresAt, "--output-recorded-at", BASE.outputRecordedAt, "--failed-at", BASE.failedAt];
  const traversal = spawnSync(process.execPath, [cli.pathname, ...common], { encoding: "utf8" }); assert.notEqual(traversal.status, 0); assert.equal(JSON.parse(traversal.stdout).error.code, "OUTPUT_CONTAINMENT"); assert.doesNotMatch(traversal.stdout + traversal.stderr, /\/private\/| at /);
  const outside = await mkdtemp(join(tmpdir(), "jessica-worker-outside-")); await symlink(outside, join(context.root, "linked")); common[common.indexOf("../private-output")] = "linked/output";
  const linked = spawnSync(process.execPath, [cli.pathname, ...common], { encoding: "utf8" }); assert.notEqual(linked.status, 0); assert.equal(JSON.parse(linked.stdout).error.code, "OUTPUT_CONTAINMENT"); await assert.rejects(stat(join(outside, "output")), { code: "ENOENT" });
  const invalidRoot = await runProxyAutoProcessingWorker({ ...context.options, root: join(context.root, "missing-root") }); assert.equal(invalidRoot.error.code, "ROOT_INVALID"); assert.equal(invalidRoot.error.retryClassification, "terminal");
  const malformed = join(context.root, "customer-private-key.json"); await writeFile(malformed, `{"/Users/customer/private.pem":`); common[0] = malformed;
  const bad = spawnSync(process.execPath, [cli.pathname, ...common], { encoding: "utf8" }); assert.doesNotMatch(bad.stdout + bad.stderr, /customer|private\.pem|\/Users| at /);
});
