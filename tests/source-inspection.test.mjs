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

function png(width, height, exifPayload) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  const exifChunk = exifPayload === undefined ? [] : (() => {
    const value = Buffer.alloc(12 + exifPayload.length); value.writeUInt32BE(exifPayload.length, 0); value.write("eXIf", 4, "ascii"); exifPayload.copy(value, 8); return [value];
  })();
  const iend = Buffer.alloc(12); iend.write("IEND", 4, "ascii");
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, ...exifChunk, iend]);
}

function exif(orientation, endian = "little") {
  const little = endian === "little";
  const tiff = Buffer.alloc(26);
  tiff.write(little ? "II" : "MM", 0, "ascii");
  little ? tiff.writeUInt16LE(42, 2) : tiff.writeUInt16BE(42, 2);
  little ? tiff.writeUInt32LE(8, 4) : tiff.writeUInt32BE(8, 4);
  little ? tiff.writeUInt16LE(1, 8) : tiff.writeUInt16BE(1, 8);
  little ? tiff.writeUInt16LE(0x0112, 10) : tiff.writeUInt16BE(0x0112, 10);
  little ? tiff.writeUInt16LE(3, 12) : tiff.writeUInt16BE(3, 12);
  little ? tiff.writeUInt32LE(1, 14) : tiff.writeUInt32BE(1, 14);
  little ? tiff.writeUInt16LE(orientation, 18) : tiff.writeUInt16BE(orientation, 18);
  return Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
}

function app1(payload) {
  const header = Buffer.alloc(4); header.set([0xff, 0xe1], 0); header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function jpeg(width, height, exifPayloads = []) {
  const frame = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...exifPayloads.map(app1), frame]);
}

function webpChunk(type, data) {
  const header = Buffer.alloc(8); header.write(type, 0, "ascii"); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
}

function webp(chunks = [webpVp8x(128, 64)]) {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8); header.write("RIFF", 0, "ascii"); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function webpVp8x(width, height) {
  const data = Buffer.alloc(10); data.writeUIntLE(width - 1, 4, 3); data.writeUIntLE(height - 1, 7, 3);
  return webpChunk("VP8X", data);
}

function webpVp8(width, height) {
  const data = Buffer.alloc(10); data.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a], 0); data.writeUInt16LE(width, 6); data.writeUInt16LE(height, 8);
  return webpChunk("VP8 ", data);
}

function webpVp8l(width, height) {
  const w = width - 1; const h = height - 1;
  const data = Buffer.from([0x2f, w & 0xff, ((w >> 8) & 0x3f) | ((h & 0x3) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f]);
  return webpChunk("VP8L", data);
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
  assert.equal(side.pixelGeometry.exifOrientation, 1);
  assert.deepEqual(side.pixelGeometry, { coordinateSpace: "raw-encoded-pixels", regionConvention: "half-open-integer", encodedWidthPx: 320, encodedHeightPx: 200, exifOrientation: 1, displayWidthPx: 320, displayHeightPx: 200, regionAuthoring: "allowed" });
  assert.equal(overview.mimeType, "image/webp");
  assert.equal(overview.widthPx, 128);
  assert.equal(overview.heightPx, 64);
  assert.equal(front.objectKey, `private/jessica-internal/sources/candidate-front/${front.sha256}.png`);
  assert.equal(front.captureMetadata.originalFilename, "front.png");
  assert.equal(front.captureMetadata.byteLength, pngBytes.length);
  assert.equal("fileModifiedAt" in front.captureMetadata, false);
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

test("rejects unknown source specification fields before reading bytes", async () => {
  const { root } = await fixture();
  const sourceWithUnknown = {
    id: "front",
    kind: "front",
    relativePath: "sources/front.png",
    objectKey: "private/author-asserted.png",
  };
  await rejectsCode(inspectSourceSpec(spec([sourceWithUnknown]), { manifestDirectory: root }), "INVALID_SPEC");
  await rejectsCode(inspectSourceSpec(spec([{
    id: "front", kind: "front", relativePath: "sources/front.png", exifOrientation: 1,
  }]), { manifestDirectory: root }), "INVALID_SPEC");
  await rejectsCode(inspectSourceSpec({ ...spec([{
    id: "front",
    kind: "front",
    relativePath: "sources/front.png",
  }]), verification: "verified" }, { manifestDirectory: root }), "INVALID_SPEC");
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

test("parses JPEG EXIF orientation deterministically across endian/order variants and swaps display geometry", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-source-orientation-")); temporaryRoots.push(root);
  const cases = [
    ["missing", jpeg(320, 200), 1, 320, 200],
    ["little-1", jpeg(320, 200, [exif(1, "little")]), 1, 320, 200],
    ["big-6", jpeg(320, 200, [exif(6, "big")]), 6, 200, 320],
    ["little-8", jpeg(320, 200, [exif(8, "little")]), 8, 200, 320],
  ];
  for (const [id, bytes] of cases) await writeFile(join(root, `${id}.jpg`), bytes);
  const result = await inspectSourceSpec(spec(cases.map(([id]) => ({ id, kind: "other", relativePath: `${id}.jpg` }))), { manifestDirectory: root });
  for (const [index, [, , orientation, displayWidthPx, displayHeightPx]] of cases.entries()) {
    const geometry = result.sourceAssets[index].pixelGeometry;
    assert.equal(geometry.exifOrientation, orientation);
    assert.equal(geometry.displayWidthPx, displayWidthPx);
    assert.equal(geometry.displayHeightPx, displayHeightPx);
    assert.equal(geometry.regionAuthoring, orientation === 1 ? "allowed" : "requires-orientation-normalized-derived-source");
    assert.equal(result.sourceAssets[index].sha256, createHash("sha256").update(cases[index][1]).digest("hex"));
  }
});

test("PNG eXIf orientation is byte-derived instead of assumed display geometry", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-source-png-exif-")); temporaryRoots.push(root);
  const bytes = png(90, 40, exif(8, "big").subarray(6));
  await writeFile(join(root, "oriented.png"), bytes);
  const result = await inspectSourceSpec(spec([{ id: "oriented", kind: "other", relativePath: "oriented.png" }]), { manifestDirectory: root });
  assert.deepEqual(result.sourceAssets[0].pixelGeometry, { coordinateSpace: "raw-encoded-pixels", regionConvention: "half-open-integer", encodedWidthPx: 90, encodedHeightPx: 40, exifOrientation: 8, displayWidthPx: 40, displayHeightPx: 90, regionAuthoring: "requires-orientation-normalized-derived-source" });
});

test("rejects malformed IHDR and truncated, nonzero, or missing PNG IEND", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-source-bad-png-")); temporaryRoots.push(root);
  const valid = png(90, 40);
  const malformedIhdr = Buffer.from(valid); malformedIhdr.writeUInt32BE(12, 8);
  const truncatedIend = valid.subarray(0, valid.length - 1);
  const missingIend = valid.subarray(0, valid.length - 12);
  const nonzeroIend = Buffer.concat([valid.subarray(0, valid.length - 12), (() => {
    const chunk = Buffer.alloc(13); chunk.writeUInt32BE(1, 0); chunk.write("IEND", 4, "ascii"); return chunk;
  })()]);
  for (const [id, bytes] of [["malformed-ihdr", malformedIhdr], ["truncated-iend", truncatedIend], ["missing-iend", missingIend], ["nonzero-iend", nonzeroIend]]) {
    await writeFile(join(root, `${id}.png`), bytes);
    await rejectsCode(inspectSourceSpec(spec([{ id, kind: "other", relativePath: `${id}.png` }]), { manifestDirectory: root }), "INVALID_IMAGE");
  }
});

test("rejects invalid, conflicting, and truncated JPEG EXIF orientation", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-source-bad-exif-")); temporaryRoots.push(root);
  const cases = [
    ["invalid", jpeg(10, 8, [exif(9)])],
    ["conflict", jpeg(10, 8, [exif(1), exif(6, "big")])],
    ["truncated", jpeg(10, 8, [Buffer.from("Exif\0\0II*\0\b\0", "binary")])],
  ];
  for (const [id, bytes] of cases) {
    await writeFile(join(root, `${id}.jpg`), bytes);
    await rejectsCode(inspectSourceSpec(spec([{ id, kind: "other", relativePath: `${id}.jpg` }]), { manifestDirectory: root }), "INVALID_IMAGE");
  }
});

test("reads VP8X, VP8, and VP8L WebP encoded dimensions and bounded EXIF orientation", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-source-webp-")); temporaryRoots.push(root);
  const fixtures = [
    ["extended", webp([webpVp8x(301, 199)]), 301, 199, 1],
    ["lossy", webp([webpVp8(222, 111)]), 222, 111, 1],
    ["lossless-oriented", webp([webpVp8l(77, 123), webpChunk("EXIF", exif(6))]), 77, 123, 6],
  ];
  for (const [id, bytes] of fixtures) await writeFile(join(root, `${id}.webp`), bytes);
  const result = await inspectSourceSpec(spec(fixtures.map(([id]) => ({ id, kind: "other", relativePath: `${id}.webp` }))), { manifestDirectory: root });
  fixtures.forEach(([, , width, height, orientation], index) => {
    assert.equal(result.sourceAssets[index].pixelGeometry.encodedWidthPx, width);
    assert.equal(result.sourceAssets[index].pixelGeometry.encodedHeightPx, height);
    assert.equal(result.sourceAssets[index].pixelGeometry.exifOrientation, orientation);
  });
});
