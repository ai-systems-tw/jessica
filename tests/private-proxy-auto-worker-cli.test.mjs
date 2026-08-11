import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { authorProxyGeneratorInput, generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";
import { createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { readImmutableGenerationJobLedger, writeImmutableGenerationJobEvent } from "../apps/frame-factory/generation-job-ledger-store.mjs";
import { writePrivateArtifact } from "../apps/frame-factory/private-capture-draft-store.mjs";
import { writeIdempotentPrivateProxyBundle } from "../apps/frame-factory/proxy-output.mjs";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
const cli = new URL("../apps/frame-factory/private-proxy-auto-worker-cli.mjs", import.meta.url).pathname;
const fixtureUrl = new URL("../fixtures/frame-generation/proxy-input-authoring.synthetic.json", import.meta.url);
const TIMES = {
  "--evaluated-at": "2026-08-11T00:04:30Z",
  "--claimed-at": "2026-08-11T00:00:01Z",
  "--worker-id": "private-worker-a",
  "--claim-token": "private-claim-a",
  "--lease-expires-at": "2026-08-11T00:05:01Z",
  "--output-recorded-at": "2026-08-11T00:00:03Z",
  "--failed-at": "2026-08-11T00:00:04Z",
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "jessica-private-worker-"));
  roots.push(root);
  await mkdir(join(root, "authored"));
  await mkdir(join(root, "jobs", "candidate"), { recursive: true });
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const authored = await authorProxyGeneratorInput(fixture.captureDraft, fixture.authoring);
  await writePrivateArtifact(root, "authored/input.json", Buffer.from(`${canonicalJson(authored)}\n`));
  const input = authored.input;
  const request = {
    schemaVersion: 1,
    tenantId: input.candidate.tenantId,
    frameModelId: input.candidate.frameModelId,
    method: "proxy-auto",
    generator: input.generator,
    sourceAssetSha256s: input.sourceAssetHashes,
    measurementSetSha256: input.measurementSet.sha256,
    generatorInputSha256: authored.canonicalInputSha256,
    maxAttempts: 2,
    createdAt: "2026-08-11T00:00:00Z",
  };
  const queued = await createQueuedGenerationJobEvent(request);
  const ledgerDirectory = join(root, "jobs", "candidate");
  await writeImmutableGenerationJobEvent(ledgerDirectory, queued, Buffer.from(`${canonicalJson(queued)}\n`));
  return { root, authored, input, ledgerDirectory, bundle: await generateProxyBundle(input) };
}

async function run(context, inputPath = "authored/input.json", overrides = {}) {
  const values = { ...TIMES, ...overrides };
  const args = [inputPath, "--ledger-path", "jobs/candidate", "--output-path", "outputs/candidate"];
  for (const [flag, value] of Object.entries(values)) args.push(flag, value);
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: dirname(cli),
      env: { ...process.env, JESSICA_PRIVATE_SOURCE_ROOT: context.root },
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr, output: JSON.parse(stdout) }));
  });
}

test("private adapter moves an exactly bound authored input to review and publishes only 0600 deterministic bytes", async () => {
  const context = await setup();
  const result = await run(context);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.output, {
    ok: true,
    state: { status: "review", attempts: 1 },
    output: { existing: false },
    authority: { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false },
    g1: "active-not-ready",
    g2: "preparation-only-not-active-not-pass",
    g3: "not-pass",
  });
  const outputDirectory = join(context.root, "outputs", "candidate");
  assert.deepEqual((await readdir(outputDirectory)).sort(), [context.bundle.glbFileName, context.bundle.manifestFileName].sort());
  assert.deepEqual(await readFile(join(outputDirectory, context.bundle.glbFileName)), Buffer.from(context.bundle.glb));
  assert.equal(await readFile(join(outputDirectory, context.bundle.manifestFileName), "utf8"), context.bundle.manifestJson);
  for (const name of await readdir(outputDirectory)) assert.equal((await stat(join(outputDirectory, name))).mode & 0o777, 0o600);
  const state = await replayGenerationJobLedger(await readImmutableGenerationJobLedger(context.ledgerDirectory), { evaluatedAt: "2026-08-11T00:20:00Z" });
  assert.equal(state.status, "review");
  assert.doesNotMatch(result.stdout, /[a-f0-9]{64}|synthetic-fixture-tenant|sourceAsset|manifest|\.glb|authored\/|outputs\/|jobs\/|\/tmp\//);
});

test("private adapter accepts only bounded no-follow root-relative authored wrappers without claiming the job", async () => {
  for (const inputPath of ["../outside.json", "/tmp/outside.json", "authored/linked.json", "authored/oversized.json", "authored/malformed.json"]) {
    const context = await setup();
    const outside = join(context.root, "outside.json");
    await writeFile(outside, "outside-private-bytes", { mode: 0o600 });
    await symlink(outside, join(context.root, "authored", "linked.json"));
    await writeFile(join(context.root, "authored", "oversized.json"), Buffer.alloc(1024 * 1024 + 1));
    await writeFile(join(context.root, "authored", "malformed.json"), `{\"privatePath\":\"/candidate/secret\"`);
    const result = await run(context, inputPath);
    assert.notEqual(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.output.ok, false);
    assert.equal(result.output.authority.recommendedForLive, false);
    assert.doesNotMatch(result.stdout, /candidate\/secret|outside-private|\/tmp\/|linked\.json|oversized\.json|malformed\.json| at /);
    const state = await replayGenerationJobLedger(await readImmutableGenerationJobLedger(context.ledgerDirectory), { evaluatedAt: "2026-08-11T00:20:00Z" });
    assert.equal(state.status, "queued");
  }
});

test("private publication never reuses permissive files and never overwrites a collision", async () => {
  const context = await setup();
  const outputDirectory = join(context.root, "outputs", "candidate");
  await mkdir(outputDirectory, { recursive: true });
  const collisionPath = join(outputDirectory, context.bundle.glbFileName);
  await writeFile(collisionPath, Buffer.from(context.bundle.glb), { mode: 0o644 });
  const result = await run(context);
  assert.notEqual(result.code, 0);
  assert.equal(result.output.error.code, "OUTPUT_COLLISION");
  assert.equal((await stat(collisionPath)).mode & 0o777, 0o644);
  assert.deepEqual(await readFile(collisionPath), Buffer.from(context.bundle.glb));
  assert.deepEqual((await readdir(outputDirectory)).sort(), [context.bundle.glbFileName]);
  assert.doesNotMatch(result.stdout, /[a-f0-9]{64}|\.glb|outputs\//);
});

test("private publication rejects an oversized 0600 collision without consuming it as candidate bytes", async () => {
  const context = await setup();
  const outputDirectory = join(context.root, "outputs", "candidate");
  await mkdir(outputDirectory, { recursive: true });
  const collisionPath = join(outputDirectory, context.bundle.glbFileName);
  const oversized = Buffer.alloc(context.bundle.glb.byteLength + 1024, 0x5a);
  await writeFile(collisionPath, oversized, { mode: 0o600 });
  const result = await run(context);
  assert.notEqual(result.code, 0);
  assert.equal(result.output.error.code, "OUTPUT_COLLISION");
  assert.equal((await stat(collisionPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(collisionPath), oversized);
  assert.doesNotMatch(result.stdout, /[a-f0-9]{64}|\.glb|outputs\//);
});

test("private bundle stages both files before exclusive publication and cleans an invocation-owned partial pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-private-publisher-")); roots.push(root);
  const glbPath = join(root, "model.glb"); const manifestPath = join(root, "manifest.json");
  let links = 0;
  await assert.rejects(writeIdempotentPrivateProxyBundle({ glbPath, manifestPath, glb: new Uint8Array([1, 2, 3]), manifestJson: "{}\n" }, {
    linkFile: async (temporary, final) => {
      links += 1;
      if (links === 2) throw Object.assign(new Error("injected link failure"), { code: "EIO" });
      return link(temporary, final);
    },
  }), /injected link failure/);
  assert.equal(links, 2);
  assert.deepEqual(await readdir(root), []);
});
