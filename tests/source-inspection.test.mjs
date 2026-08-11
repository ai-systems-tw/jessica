import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test, { after } from "node:test";

import { inspectSourceSpec, SourceInspectionError } from "../scripts/source-inspection.mjs";

const temporaryRoots = [];
after(async () => Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))));

const execFileAsync = promisify(execFile);

function png(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webp() {
  return Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jessica-source-inspection-"));
  temporaryRoots.push(root);
  const sources = join(root, "sources");
  await mkdir(sources);
  const pngBytes = png(640, 480);
  const jpegBytes = jpeg(320, 200);
  const webpBytes = webp();
  await Promise.all([
    writeFile(join(sources, "front.png"), pngBytes),
    writeFile(join(sources, "side.jpg"), jpegBytes),
    writeFile(join(sources, "overview.webp"), webpBytes),
  ]);
  return { root, pngBytes, jpegBytes, webpBytes };
}

function spec(sources) {
  return {
    schemaVersion: 1,
    tenantId: "jessica-internal",
    frameModelId: "candidate-001",
    sources,
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SourceInspectionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("inspects JPEG, PNG, and WebP bytes into deterministic SourceAsset skeletons", async () => {
  const { root, pngBytes, jpegBytes } = await fixture();
  const result = await inspectSourceSpec(spec([
    {
      id: "candidate-front",
      kind: "front",
      relativePath: "sources/front.png",
      declaredMimeType: "image/png",
      expectedSha256: createHash("sha256").update(pngBytes).digest("hex"),
      expectedWidthPx: 640,
      expectedHeightPx: 480,
    },
    {
      id: "candidate-side",
      kind: "leftSide",
      relativePath: "sources/side.jpg",
      declaredMimeType: "image/jpeg",
      expectedSha256: createHash("sha256").update(jpegBytes).digest("hex"),
      expectedWidthPx: 320,
      expectedHeightPx: 200,
    },
    {
      id: "candidate-overview",
      kind: "annotatedOverview",
      relativePath: "sources/overview.webp",
      declaredMimeType: "image/webp",
    },
  ]), { manifestDirectory: root });

  assert.equal(result.sourceAssets.length, 3);
  const [front, side, overview] = result.sourceAssets;
  assert.deepEqual(
    { mimeType: front.mimeType, widthPx: front.widthPx, heightPx: front.heightPx },
    { mimeType: "image/png", widthPx: 640, heightPx: 480 },
  );
  assert.deepEqual(
    { mimeType: side.mimeType, widthPx: side.widthPx, heightPx: side.heightPx },
    { mimeType: "image/jpeg", widthPx: 320, heightPx: 200 },
  );
  assert.equal(overview.mimeType, "image/webp");
  assert.equal("widthPx" in overview, false);
  assert.equal(front.objectKey, `private/jessica-internal/sources/candidate-front/${front.sha256}.png`);
  assert.equal(front.captureMetadata.originalFilename, "front.png");
  assert.equal(front.captureMetadata.byteLength, pngBytes.length);
  assert.match(front.captureMetadata.fileModifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("CLI emits JSON SourceAssets without leaking the manifest absolute path", async () => {
  const { root } = await fixture();
  const manifestDirectory = join(root, "manifest");
  await mkdir(manifestDirectory);
  const specPath = join(manifestDirectory, "source-spec.json");
  await writeFile(specPath, JSON.stringify(spec([{
    id: "candidate-front",
    kind: "front",
    relativePath: "sources/front.png",
    declaredMimeType: "image/png",
  }])));
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [new URL("../apps/frame-factory/source-inspect-cli.mjs", import.meta.url).pathname, specPath],
    { env: { ...process.env, JESSICA_PRIVATE_SOURCE_ROOT: root } },
  );
  const output = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(output.ok, true);
  assert.equal(output.sourceAssets[0].captureMetadata.originalFilename, "front.png");
  assert.equal(stdout.includes(root), false);
});

test("rejects an expected SHA-256 that does not match the actual bytes", async () => {
  const { root } = await fixture();
  await rejectsCode(inspectSourceSpec(spec([{
    id: "front",
    kind: "front",
    relativePath: "sources/front.png",
    expectedSha256: "0".repeat(64),
  }]), { manifestDirectory: root }), "HASH_MISMATCH");
});

test("rejects traversal and absolute source paths", async () => {
  const { root } = await fixture();
  await rejectsCode(inspectSourceSpec(spec([{
    id: "escape",
    kind: "other",
    relativePath: "../outside.png",
  }]), { manifestDirectory: root }), "UNSAFE_PATH");
  await rejectsCode(inspectSourceSpec(spec([{
    id: "absolute",
    kind: "other",
    relativePath: join(root, "sources/front.png"),
  }]), { manifestDirectory: root }), "UNSAFE_PATH");
  await rejectsCode(inspectSourceSpec(spec([{
    id: "windows-escape",
    kind: "other",
    relativePath: "..\\outside.png",
  }]), { manifestDirectory: root }), "UNSAFE_PATH");
});

test("rejects missing sources without returning an absolute path", async () => {
  const { root } = await fixture();
  await assert.rejects(inspectSourceSpec(spec([{
    id: "missing",
    kind: "front",
    relativePath: "sources/missing.png",
  }]), { manifestDirectory: root }), (error) => {
    assert.equal(error.code, "SOURCE_MISSING");
    assert.equal(error.message.includes(root), false);
    return true;
  });
});

test("rejects declared MIME that disagrees with image magic bytes", async () => {
  const { root } = await fixture();
  await rejectsCode(inspectSourceSpec(spec([{
    id: "front",
    kind: "front",
    relativePath: "sources/front.png",
    declaredMimeType: "image/jpeg",
  }]), { manifestDirectory: root }), "MIME_MISMATCH");
});

test("rejects declared dimensions that disagree with the image header", async () => {
  const { root } = await fixture();
  await rejectsCode(inspectSourceSpec(spec([{
    id: "front",
    kind: "front",
    relativePath: "sources/front.png",
    expectedWidthPx: 641,
    expectedHeightPx: 480,
  }]), { manifestDirectory: root }), "DIMENSION_MISMATCH");
});
