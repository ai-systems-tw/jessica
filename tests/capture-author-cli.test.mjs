import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import test, { after } from "node:test";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { writePrivateCaptureDraftArtifact } from "../apps/frame-factory/private-capture-draft-store.mjs";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
const cli = new URL("../apps/frame-factory/capture-author-cli.mjs", import.meta.url).pathname;
const fields = ["lensWidthMm", "bridgeWidthMm", "templeLengthMm", "frameWidthMm", "lensHeightMm"];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function input(relativePath = "sources/overview.png") {
  return {
    schemaVersion: 1,
    sourceSpec: {
      schemaVersion: 1,
      tenantId: "tenant-a",
      frameModelId: "model-a",
      sources: [{ id: "overview", kind: "annotatedOverview", relativePath, declaredMimeType: "image/png" }],
    },
    authoring: {
      schemaVersion: 1,
      tenantId: "tenant-a",
      frameModelId: "model-a",
      measurementSetId: "model-a-measurements-v1",
      measurementSetVersion: 1,
      measurements: fields.map((field, index) => ({
        field,
        sourceId: "overview",
        valueMm: [52, 18, 145, 140, 41][index],
        rawLabel: `${[52, 18, 145, 140, 41][index]} mm`,
        regionPx: { x: 5, y: index * 20, width: 80, height: 15 },
      })),
    },
  };
}

async function run(inputPath, sourceRoot, extraArgs = []) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (sourceRoot === undefined) delete env.JESSICA_PRIVATE_SOURCE_ROOT;
    else env.JESSICA_PRIVATE_SOURCE_ROOT = sourceRoot;
    const child = spawn(process.execPath, [cli, inputPath, ...extraArgs], {
      cwd: dirname(inputPath),
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("close", (code) => resolve({ code, stdout, stderr, output: JSON.parse(stdout) }));
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jessica-capture-author-"));
  roots.push(root);
  await mkdir(join(root, "sources"));
  const bytes = png(320, 200);
  await writeFile(join(root, "sources/overview.png"), bytes);
  const inputPath = join(root, "capture-author.json");
  await writeFile(inputPath, JSON.stringify(input()));
  return { root, bytes, inputPath };
}

test("CLI inspects real image bytes and exits zero for a valid draft while retaining G1 blockers", async () => {
  const { root, bytes, inputPath } = await fixture();
  const result = await run(inputPath, root);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.output.ok, true);
  assert.equal(result.output.draftValid, true);
  assert.equal(result.output.g1Ready, false);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(result.output.draft.sources[0].sha256, actualHash);
  assert.equal(result.output.draft.sources[0].objectKey, `private/tenant-a/sources/overview/${actualHash}.png`);
  assert.ok(result.output.draft.evidence.every((item) => item.verification === "unverified"));
  assert.ok(result.output.g1Issues.some((issue) => issue.message.includes("missing required G1 front source")));
  assert.ok(result.output.g1Issues.some((issue) => issue.message.includes("missing verified evidence")));
  assert.equal(result.stdout.includes(root), false);
  assert.equal(result.stdout.includes("at file:"), false);

  await utimes(join(root, "sources/overview.png"), new Date(1_000_000), new Date(2_000_000));
  const repeated = await run(inputPath, root);
  assert.deepEqual(repeated.output.draft, result.output.draft);
});

test("CLI fails privately for tampered, missing, invalid-region, and unknown input", async () => {
  const { root, inputPath } = await fixture();
  const cases = [
    { name: "tampered", mutate: (value) => { value.sourceSpec.sources[0].expectedSha256 = "0".repeat(64); } },
    { name: "missing", mutate: (value) => { value.sourceSpec.sources[0].relativePath = "sources/private-missing.png"; } },
    { name: "region", mutate: (value) => { value.authoring.measurements[0].regionPx = { x: 319, y: 0, width: 2, height: 1 }; } },
    { name: "unknown", mutate: (value) => { value.authoring.measurements[0].verification = "verified"; } },
  ];
  for (const item of cases) {
    const value = input();
    item.mutate(value);
    const path = join(root, `${item.name}.json`);
    await writeFile(path, JSON.stringify(value));
    const result = await run(path, root);
    assert.equal(result.code, 1);
    assert.equal(result.output.draftValid, false);
    assert.equal(result.output.g1Ready, false);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.includes(root), false);
    assert.equal(result.stdout.includes("at file:"), false);
  }

  const missingInput = await run(join(root, "does-not-exist.json"), root);
  assert.equal(missingInput.code, 1);
  assert.equal(missingInput.output.error.code, "INPUT_MISSING");
  assert.equal(missingInput.stdout.includes(root), false);
  assert.equal(inputPath.includes(root), true);
});

test("output mode publishes canonical 0600 draft bytes and reports their exact reread digest without disclosing the draft", async () => {
  const { root, bytes, inputPath } = await fixture();
  await mkdir(join(root, "drafts"));
  const result = await run(inputPath, root, ["--output-path", "drafts/candidate.json"]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(Object.keys(result.output).sort(), ["artifact", "draftValid", "g1Ready", "ok"]);
  assert.equal(result.output.ok, true);
  assert.equal(result.output.draftValid, true);
  assert.equal(result.output.g1Ready, false);
  assert.equal(result.output.artifact.relativePath, "drafts/candidate.json");
  assert.deepEqual(await readdir(join(root, "drafts")), ["candidate.json"]);
  const artifactPath = join(root, "drafts/candidate.json");
  const artifactBytes = await readFile(artifactPath);
  assert.equal(result.output.artifact.sha256, createHash("sha256").update(artifactBytes).digest("hex"));
  assert.equal(result.output.artifact.byteLength, artifactBytes.byteLength);
  assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
  const draft = JSON.parse(artifactBytes);
  assert.deepEqual(artifactBytes, Buffer.from(`${canonicalJson(draft)}\n`));
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(draft.sources[0].sha256, sourceHash);
  assert.doesNotMatch(result.stdout, new RegExp(sourceHash));
  assert.equal(result.stdout.includes(root), false);
  assert.equal(result.stdout.includes("tenant-a"), false);
  assert.equal(result.stdout.includes("model-a"), false);
  assert.equal(result.stdout.includes("measurements"), false);
});

test("output mode never overwrites collisions and rejects unsafe paths and roots with sanitized errors", async () => {
  const { root, inputPath } = await fixture();
  await mkdir(join(root, "drafts"));
  const target = join(root, "drafts/candidate.json");
  await writeFile(target, "existing-private-bytes", { mode: 0o600 });
  const collision = await run(inputPath, root, ["--output-path", "drafts/candidate.json"]);
  assert.equal(collision.code, 2);
  assert.equal(collision.output.error.code, "OUTPUT_COLLISION");
  assert.equal(await readFile(target, "utf8"), "existing-private-bytes");
  await writeFile(join(root, "not-a-directory"), "private-parent-bytes");
  const nonDirectory = await run(inputPath, root, ["--output-path", "not-a-directory/candidate.json"]);
  assert.equal(nonDirectory.code, 2);
  assert.equal(nonDirectory.output.error.code, "OUTPUT_PARENT_INVALID");
  assert.equal(await readFile(join(root, "not-a-directory"), "utf8"), "private-parent-bytes");
  for (const unsafe of ["../escape.json", "/tmp/escape.json", "C:\\private\\escape.json", "drafts/./escape.json", "drafts\\..\\escape.json"]) {
    const result = await run(inputPath, root, ["--output-path", unsafe]);
    assert.equal(result.code, 2, unsafe);
    assert.equal(result.output.error.code, "OUTPUT_PATH_INVALID", unsafe);
    assert.equal(result.stdout.includes(root), false);
  }
  const missingEnv = await run(inputPath, undefined, ["--output-path", "candidate.json"]);
  assert.equal(missingEnv.code, 2);
  assert.equal(missingEnv.output.error.code, "ROOT_REQUIRED");
  const invalidRoot = await run(inputPath, join(root, "missing-root"), ["--output-path", "candidate.json"]);
  assert.equal(invalidRoot.code, 2);
  assert.equal(invalidRoot.output.error.code, "ROOT_INVALID");
  assert.doesNotMatch(invalidRoot.stdout, /missing-root| at /);
});

test("output mode rejects symlinked parents and targets without touching their destinations", async () => {
  const { root, inputPath } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "jessica-capture-outside-"));
  roots.push(outside);
  await symlink(outside, join(root, "linked-parent"));
  const parent = await run(inputPath, root, ["--output-path", "linked-parent/escape.json"]);
  assert.equal(parent.code, 2);
  assert.equal(parent.output.error.code, "OUTPUT_PARENT_INVALID");
  assert.deepEqual(await readdir(outside), []);

  const outsideTarget = join(outside, "private-target.json");
  await writeFile(outsideTarget, "outside-private-bytes");
  await symlink(outsideTarget, join(root, "linked-target.json"));
  const target = await run(inputPath, root, ["--output-path", "linked-target.json"]);
  assert.equal(target.code, 2);
  assert.equal(target.output.error.code, "OUTPUT_COLLISION");
  assert.equal(await readFile(outsideTarget, "utf8"), "outside-private-bytes");
});

test("artifact adapter cleans invocation-created partial bytes after an injected write failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-capture-partial-"));
  roots.push(root);
  const bytes = Buffer.from("canonical-private-draft\n");
  await assert.rejects(
    writePrivateCaptureDraftArtifact(root, "candidate.json", bytes, {
      writeBytes: async (handle) => {
        await handle.write(Buffer.from("partial"));
        throw new Error("injected partial write failure");
      },
    }),
    /injected partial write failure/,
  );
  assert.deepEqual(await readdir(root), []);
});

test("artifact adapter preserves a racing EEXIST target and removes its invocation temporary file", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-capture-race-"));
  roots.push(root);
  const racingBytes = Buffer.from("racing-pre-existing-private-bytes");
  await assert.rejects(
    writePrivateCaptureDraftArtifact(root, "candidate.json", Buffer.from("canonical-private-draft\n"), {
      linkFile: async (_temporaryPath, targetPath) => {
        await writeFile(targetPath, racingBytes, { flag: "wx", mode: 0o600 });
        const error = new Error("injected EEXIST race");
        error.code = "EEXIST";
        throw error;
      },
    }),
    (error) => error?.code === "OUTPUT_COLLISION",
  );
  assert.deepEqual(await readdir(root), ["candidate.json"]);
  assert.deepEqual(await readFile(join(root, "candidate.json")), racingBytes);
});
