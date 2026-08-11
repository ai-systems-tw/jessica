import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleFrameCaptureDraft,
  evaluateG1CaptureReadiness,
  validateFrameCaptureAuthorInput,
  validateFrameCaptureDraft,
} from "../dist/packages/contracts/src/index.js";

const hash = "a".repeat(64);
const fields = ["lensWidthMm", "bridgeWidthMm", "templeLengthMm", "frameWidthMm", "lensHeightMm"];

function source(overrides = {}) {
  return {
    id: "overview",
    tenantId: "tenant-a",
    frameModelId: "model-a",
    kind: "annotatedOverview",
    objectKey: `private/tenant-a/sources/overview/${hash}.png`,
    sha256: hash,
    mimeType: "image/png",
    widthPx: 320,
    heightPx: 200,
    captureMetadata: {
      originalFilename: "overview.png",
      byteLength: 123,
      fileModifiedAt: "2099-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function author(overrides = {}) {
  return {
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
      regionPx: { x: 10, y: index * 20, width: 80, height: 15 },
    })),
    ...overrides,
  };
}

test("assembles a deterministic valid annotated overview draft that remains outside G1", () => {
  const first = assembleFrameCaptureDraft([source()], author());
  const second = assembleFrameCaptureDraft([
    source({ captureMetadata: { ...source().captureMetadata, fileModifiedAt: "2001-01-01T00:00:00.000Z" } }),
  ], author({ measurements: [...author().measurements].reverse() }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.draft, second.draft);
  assert.deepEqual(validateFrameCaptureDraft(first.draft), []);
  assert.equal("fileModifiedAt" in first.draft.sources[0].captureMetadata, false);
  assert.deepEqual(first.draft.evidence.map((item) => item.field), fields);
  assert.ok(first.draft.evidence.every((item) => (
    item.method === "annotated-image"
    && item.verification === "unverified"
    && item.sourceSha256 === hash
  )));
  const readiness = evaluateG1CaptureReadiness(first.draft);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some((issue) => issue.message.includes("missing required G1 front source")));
  assert.ok(readiness.issues.some((issue) => issue.message.includes("missing verified evidence for lensWidthMm")));
});

test("author input cannot assert provenance or verification and rejects unknown JSON", () => {
  for (const forbidden of [
    { sourceSha256: "b".repeat(64) },
    { objectKey: "private/forged.png" },
    { verification: "verified" },
    { verifiedBy: "self" },
    { method: "caliper" },
  ]) {
    const input = author({ measurements: [{ ...author().measurements[0], ...forbidden }, ...author().measurements.slice(1)] });
    assert.ok(validateFrameCaptureAuthorInput(input).some((issue) => issue.message === "is not allowed"));
    assert.equal(assembleFrameCaptureDraft([source()], input).ok, false);
  }
  assert.ok(validateFrameCaptureAuthorInput({ ...author(), unexpected: true })
    .some((issue) => issue.path === "unexpected"));
  assert.ok(validateFrameCaptureAuthorInput(author({
    measurements: [{ ...author().measurements[0], regionPx: { x: 0, y: 0, width: 1, height: 1, extra: 1 } }, ...author().measurements.slice(1)],
  })).some((issue) => issue.path.endsWith("regionPx.extra")));
});

test("assembly rejects missing, duplicate, invalid, unbound, out-of-bounds, and cross-owner data", () => {
  const cases = [
    author({ measurements: author().measurements.slice(0, 4) }),
    author({ measurements: [...author().measurements.slice(0, 4), { ...author().measurements[0] }] }),
    author({ measurements: [{ ...author().measurements[0], valueMm: Number.NaN }, ...author().measurements.slice(1)] }),
    author({ measurements: [{ ...author().measurements[0], valueMm: 0 }, ...author().measurements.slice(1)] }),
    author({ measurements: [{ ...author().measurements[0], sourceId: "unknown" }, ...author().measurements.slice(1)] }),
    author({ measurements: [{ ...author().measurements[0], regionPx: { x: 300, y: 0, width: 30, height: 10 } }, ...author().measurements.slice(1)] }),
  ];
  for (const input of cases) assert.equal(assembleFrameCaptureDraft([source()], input).ok, false);
  assert.equal(assembleFrameCaptureDraft([source({ tenantId: "tenant-b" })], author()).ok, false);
  assert.equal(assembleFrameCaptureDraft([source({ frameModelId: "model-b" })], author()).ok, false);
  assert.equal(assembleFrameCaptureDraft([source({ widthPx: undefined, heightPx: undefined })], author()).ok, false);
  assert.doesNotThrow(() => assembleFrameCaptureDraft([{ id: "overview", captureMetadata: null }], author()));
  assert.equal(assembleFrameCaptureDraft([{ id: "overview", captureMetadata: null }], author()).ok, false);
});
