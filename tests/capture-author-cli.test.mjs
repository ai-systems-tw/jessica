import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import test, { after } from "node:test";

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

async function run(inputPath, sourceRoot) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, inputPath], {
      env: { ...process.env, JESSICA_PRIVATE_SOURCE_ROOT: sourceRoot },
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
