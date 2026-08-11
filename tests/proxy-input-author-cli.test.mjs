import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test, { after } from "node:test";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";
import { writePrivateArtifact } from "../apps/frame-factory/private-capture-draft-store.mjs";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
const cli = new URL("../apps/frame-factory/proxy-input-author-cli.mjs", import.meta.url).pathname;
const generatorCli = new URL("../apps/frame-factory/proxy-generate-cli.mjs", import.meta.url).pathname;
const coreFixture = new URL("../fixtures/frame-generation/proxy-input-authoring.synthetic.json", import.meta.url);

async function run(envelopePath, privateRoot, outputPath = "authored/proxy-input.json", environment = {}) {
  return new Promise((resolveRun) => {
    const env = { ...process.env, ...environment };
    if (privateRoot === undefined) delete env.JESSICA_PRIVATE_SOURCE_ROOT;
    else env.JESSICA_PRIVATE_SOURCE_ROOT = privateRoot;
    const child = spawn(process.execPath, [cli, envelopePath, "--output-path", outputPath], {
      cwd: dirname(envelopePath), env,
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr, output: JSON.parse(stdout) }));
  });
}

async function runGenerator(inputPath, outputDirectory) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [generatorCli, inputPath, "--output-dir", outputDirectory]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr, output: JSON.parse(stdout) }));
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jessica-proxy-author-"));
  roots.push(root);
  await mkdir(join(root, "captures"));
  await mkdir(join(root, "authored"));
  const source = JSON.parse(await readFile(coreFixture, "utf8"));
  await writeFile(join(root, "captures/candidate.json"), `${canonicalJson(source.captureDraft)}\n`, { mode: 0o600 });
  const envelope = { schemaVersion: 1, captureDraftPath: "captures/candidate.json", authoring: source.authoring };
  const envelopePath = join(root, "author-envelope.json");
  await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
  return { root, source, envelope, envelopePath };
}

test("CLI persists a deterministic canonical authored wrapper and emits only a bounded private receipt", async () => {
  const { root, envelopePath } = await fixture();
  const first = await run(envelopePath, root, "authored/first.json");
  const second = await run(envelopePath, root, "authored/second.json");
  assert.equal(first.code, 0, first.stdout + first.stderr);
  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.equal(first.stderr, "");
  assert.deepEqual(Object.keys(first.output).sort(), ["artifact", "canonicalInputSha256", "ok", "provenance"]);
  assert.deepEqual(first.output.provenance.authority, {
    fixture: true, status: "draft", quality: "proxy", recommendedForLive: false,
    admission: "calibration-only", promotable: false,
  });
  const firstBytes = await readFile(join(root, "authored/first.json"));
  const secondBytes = await readFile(join(root, "authored/second.json"));
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal((await stat(join(root, "authored/first.json"))).mode & 0o777, 0o600);
  assert.equal(first.output.artifact.sha256, createHash("sha256").update(firstBytes).digest("hex"));
  assert.equal(first.output.artifact.byteLength, firstBytes.byteLength);
  const authored = JSON.parse(firstBytes);
  assert.deepEqual(firstBytes, Buffer.from(`${canonicalJson(authored)}\n`));
  assert.equal(authored.canonicalInputSha256, first.output.canonicalInputSha256);
  assert.deepEqual(authored.provenance.authority, first.output.provenance.authority);
  assert.equal((await generateProxyBundle(authored.input)).canonicalInputSha256, authored.canonicalInputSha256);
  assert.equal(first.stdout.includes(root), false);
  assert.equal(first.stdout.includes("synthetic-fixture-tenant"), false);
  assert.equal(first.stdout.includes("sourceAssetHashes"), false);
  assert.ok(first.stdout.length < 1024);
});

test("authored artifact feeds the generator CLI only after strict wrapper verification", async () => {
  const { root, envelopePath } = await fixture();
  const authored = await run(envelopePath, root);
  assert.equal(authored.code, 0, authored.stdout);
  const artifactPath = join(root, authored.output.artifact.relativePath);
  const generated = await runGenerator(artifactPath, join(root, "generated"));
  assert.equal(generated.code, 0, generated.stdout + generated.stderr);
  assert.equal(generated.output.canonicalInputSha256, authored.output.canonicalInputSha256);
  assert.deepEqual((await readdir(join(root, "generated"))).sort(), [
    `${authored.output.canonicalInputSha256}.manifest.json`,
    `${authored.output.canonicalInputSha256}.proxy.glb`,
  ]);

  const wrapper = JSON.parse(await readFile(artifactPath, "utf8"));
  wrapper.provenance.authority.recommendedForLive = true;
  const tamperedAuthority = join(root, "tampered-authority.json");
  await writeFile(tamperedAuthority, JSON.stringify(wrapper));
  const rejectedAuthority = await runGenerator(tamperedAuthority, join(root, "rejected-authority"));
  assert.equal(rejectedAuthority.code, 1);
  assert.equal(rejectedAuthority.output.error.code, "INPUT_INVALID");

  const tamperedDigestWrapper = JSON.parse(await readFile(artifactPath, "utf8"));
  tamperedDigestWrapper.canonicalInputSha256 = "f".repeat(64);
  const tamperedDigest = join(root, "tampered-digest.json");
  await writeFile(tamperedDigest, JSON.stringify(tamperedDigestWrapper));
  const rejectedDigest = await runGenerator(tamperedDigest, join(root, "rejected-digest"));
  assert.equal(rejectedDigest.code, 1);
  assert.equal(rejectedDigest.output.error.code, "INPUT_INVALID");

  const forgedLimitationsWrapper = JSON.parse(await readFile(artifactPath, "utf8"));
  const forgedLimitations = ["Self-consistent forged limitation text."];
  forgedLimitationsWrapper.input.authoringEvidence.profile.limitations = forgedLimitations;
  forgedLimitationsWrapper.provenance.profile.limitations = forgedLimitations;
  forgedLimitationsWrapper.canonicalInputSha256 = createHash("sha256")
    .update(canonicalJson(forgedLimitationsWrapper.input)).digest("hex");
  const forgedLimitationsPath = join(root, "forged-limitations.json");
  await writeFile(forgedLimitationsPath, `${canonicalJson(forgedLimitationsWrapper)}\n`);
  const rejectedLimitations = await runGenerator(forgedLimitationsPath, join(root, "rejected-limitations"));
  assert.equal(rejectedLimitations.code, 1);
  assert.equal(rejectedLimitations.output.error.code, "INPUT_INVALID");
});

test("capture, evidence, and authoring mutations alter authored identity", async () => {
  const { root, source, envelopePath } = await fixture();
  const baseline = await run(envelopePath, root, "authored/baseline.json");
  const mutations = [
    (copy) => {
      copy.captureDraft.sources[0].sha256 = "c".repeat(64);
      copy.captureDraft.evidence.forEach((item) => { if (item.sourceSha256 === "a".repeat(64)) item.sourceSha256 = "c".repeat(64); });
    },
    (copy) => { copy.captureDraft.evidence[0].rawLabel = "SYNTHETIC LENS 52 mm"; },
    (copy) => { copy.authoring.candidate.assetVersion = 2; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const copy = structuredClone(source); mutate(copy);
    const draftPath = `captures/mutated-${index}.json`;
    await writeFile(join(root, draftPath), `${canonicalJson(copy.captureDraft)}\n`, { mode: 0o600 });
    const envelope = { schemaVersion: 1, captureDraftPath: draftPath, authoring: copy.authoring };
    const path = join(root, `mutated-${index}.envelope.json`);
    await writeFile(path, JSON.stringify(envelope));
    const result = await run(path, root, `authored/mutated-${index}.json`);
    assert.equal(result.code, 0, result.stdout);
    assert.notEqual(result.output.canonicalInputSha256, baseline.output.canonicalInputSha256);
  }
});

test("envelope and core authoring reject unknown digest, authority, media, and publication fields", async () => {
  const { root, envelope, envelopePath } = await fixture();
  const cases = [
    (copy) => { copy.sourceAssetHashes = ["f".repeat(64)]; },
    (copy) => { copy.outputSha256 = "f".repeat(64); },
    (copy) => { copy.rawMedia = "data:image/jpeg;base64,private"; },
    (copy) => { copy.authoring.status = "published"; },
    (copy) => { copy.authoring.recommendedForLive = true; },
    (copy) => { copy.authoring.measurementSetSha256 = "f".repeat(64); },
  ];
  for (const [index, mutate] of cases.entries()) {
    const copy = structuredClone(envelope); mutate(copy);
    const path = join(root, `hostile-${index}.json`);
    await writeFile(path, JSON.stringify(copy));
    const result = await run(path, root, `authored/hostile-${index}.json`);
    assert.equal(result.code, 1);
    assert.match(result.output.error.code, /INPUT_INVALID|AUTHORING_INVALID/);
    assert.equal(result.stdout.includes(root), false);
    assert.equal(result.stderr, "");
  }
  assert.equal((await run(envelopePath, undefined)).output.error.code, "ROOT_REQUIRED");
});

test("private input traversal, symlinks, non-files, oversized bytes, and input/output collision fail closed", async () => {
  const { root, envelope, envelopePath } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "jessica-proxy-author-outside-"));
  roots.push(outside);
  await writeFile(join(outside, "outside.json"), JSON.stringify({ private: true }));
  await symlink(join(outside, "outside.json"), join(root, "captures/linked.json"));
  await symlink(outside, join(root, "linked-parent"));
  const cases = [
    ["../outside.json", "INPUT_INVALID"],
    ["/tmp/outside.json", "INPUT_INVALID"],
    ["captures/linked.json", "INPUT_NOT_REGULAR"],
    ["linked-parent/outside.json", "INPUT_PARENT_INVALID"],
    ["captures", "INPUT_NOT_REGULAR"],
  ];
  for (const [captureDraftPath, expected] of cases) {
    const path = join(root, `unsafe-${createHash("sha256").update(captureDraftPath).digest("hex").slice(0, 8)}.json`);
    await writeFile(path, JSON.stringify({ ...envelope, captureDraftPath }));
    const result = await run(path, root, `authored/${createHash("sha256").update(expected + captureDraftPath).digest("hex")}.json`);
    assert.equal(result.output.error.code, expected, result.stdout);
    assert.equal(result.stdout.includes(root), false);
  }
  await writeFile(join(root, "captures/oversized.json"), Buffer.alloc(1024 * 1024 + 1, 0x20));
  const oversizedEnvelope = join(root, "oversized-envelope.json");
  await writeFile(oversizedEnvelope, JSON.stringify({ ...envelope, captureDraftPath: "captures/oversized.json" }));
  assert.equal((await run(oversizedEnvelope, root)).output.error.code, "INPUT_TOO_LARGE");
  const collision = await run(envelopePath, root, "captures/candidate.json");
  assert.equal(collision.code, 2);
  assert.equal(collision.output.error.code, "INPUT_OUTPUT_COLLISION");
});

test("output collision and symlink parents/targets never overwrite, while injected write failure cleans temporary state", async () => {
  const { root, envelopePath } = await fixture();
  await writeFile(join(root, "authored/existing.json"), "existing-private-bytes", { mode: 0o600 });
  const collision = await run(envelopePath, root, "authored/existing.json");
  assert.equal(collision.code, 2);
  assert.equal(collision.output.error.code, "OUTPUT_COLLISION");
  assert.equal(await readFile(join(root, "authored/existing.json"), "utf8"), "existing-private-bytes");
  const outside = await mkdtemp(join(tmpdir(), "jessica-proxy-output-outside-"));
  roots.push(outside);
  await symlink(outside, join(root, "linked-output-parent"));
  assert.equal((await run(envelopePath, root, "linked-output-parent/escape.json")).output.error.code, "OUTPUT_PARENT_INVALID");
  await writeFile(join(outside, "target.json"), "outside-private-bytes");
  await symlink(join(outside, "target.json"), join(root, "authored/linked-target.json"));
  assert.equal((await run(envelopePath, root, "authored/linked-target.json")).output.error.code, "OUTPUT_COLLISION");
  assert.equal(await readFile(join(outside, "target.json"), "utf8"), "outside-private-bytes");

  const writeRoot = await mkdtemp(join(tmpdir(), "jessica-proxy-write-failure-")); roots.push(writeRoot);
  await assert.rejects(writePrivateArtifact(writeRoot, "failed.json", Buffer.from("canonical\n"), {
    writeBytes: async (handle) => { await handle.write(Buffer.from("partial")); throw new Error("injected failure"); },
  }), /injected failure/);
  assert.deepEqual(await readdir(writeRoot), []);
});
