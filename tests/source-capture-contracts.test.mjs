import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateG1CaptureReadiness,
  validateFrameCaptureDraft,
  validateMeasurementSet,
  validateSourceAsset,
} from "../dist/packages/contracts/src/sourceCapture.js";

const overviewHash = "a".repeat(64);
const requiredFields = ["lensWidthMm", "bridgeWidthMm", "templeLengthMm", "frameWidthMm", "lensHeightMm"];
const measurements = {
  lensWidthMm: 52,
  bridgeWidthMm: 18,
  templeLengthMm: 145,
  frameWidthMm: 140,
  lensHeightMm: 41,
};

function source(overrides = {}) {
  return {
    id: "source-overview",
    tenantId: "tenant-a",
    frameModelId: "sunglass-a",
    kind: "annotatedOverview",
    objectKey: "source/sunglass-a/overview.png",
    sha256: overviewHash,
    mimeType: "image/png",
    widthPx: 1600,
    heightPx: 1200,
    captureMetadata: { origin: "user-supplied", annotationsVisible: true },
    ...overrides,
  };
}

function measurementSet(overrides = {}) {
  return {
    id: "measurements-sunglass-a-v1",
    tenantId: "tenant-a",
    frameModelId: "sunglass-a",
    version: 1,
    measurements,
    method: "derived",
    ...overrides,
  };
}

function evidence(sourceSha256 = overviewHash, verification = "unverified") {
  return requiredFields.map((field, index) => ({
    field,
    valueMm: measurements[field],
    method: "annotated-image",
    verification,
    sourceSha256,
    rawLabel: `${measurements[field]} mm`,
    regionPx: { x: 20, y: 40 + index * 30, width: 120, height: 24 },
  }));
}

function draft(overrides = {}) {
  return {
    schemaVersion: 1,
    tenantId: "tenant-a",
    frameModelId: "sunglass-a",
    sources: [source()],
    measurementSet: measurementSet(),
    evidence: evidence(),
    ...overrides,
  };
}

test("source and measurement validators accept data-model-aligned records", () => {
  assert.deepEqual(validateSourceAsset(source()), []);
  assert.deepEqual(validateSourceAsset(source({ kind: "other" })), []);
  assert.deepEqual(validateMeasurementSet(measurementSet({ method: "mixed", verifiedBy: "reviewer-1" })), []);
});

test("source object keys and evidence regions cannot escape their boundaries", () => {
  assert.ok(validateSourceAsset(source({ objectKey: "../private/source.png" }))
    .some((issue) => issue.path === "objectKey"));
  const candidate = draft({
    evidence: evidence().map((item, index) => index === 0
      ? { ...item, regionPx: { x: 1590, y: 0, width: 20, height: 20 } }
      : item),
  });
  assert.ok(validateFrameCaptureDraft(candidate)
    .some((issue) => issue.path === "evidence.0.regionPx"));
});

test("validators return issues rather than throwing for unknown malformed input", () => {
  for (const malformed of [undefined, null, 1, "capture", [], {}]) {
    assert.doesNotThrow(() => validateSourceAsset(malformed));
    assert.doesNotThrow(() => validateMeasurementSet(malformed));
    assert.doesNotThrow(() => validateFrameCaptureDraft(malformed));
    assert.ok(validateFrameCaptureDraft(malformed).length > 0);
  }
});

test("one annotated overview with evidence is a valid draft but is not G1 ready", () => {
  const candidate = draft();
  assert.deepEqual(validateFrameCaptureDraft(candidate), []);
  const readiness = evaluateG1CaptureReadiness(candidate);
  assert.equal(readiness.ready, false);
  for (const kind of ["front", "left45", "right45", "leftSide", "rightSide", "marking"]) {
    assert.ok(readiness.issues.some((issue) => issue.message.includes(`G1 ${kind}`)));
  }
});

test("draft validation fails closed on ownership, hash binding, value binding, and missing evidence", () => {
  const candidate = draft({
    sources: [source({ tenantId: "tenant-b" })],
    measurementSet: measurementSet({ frameModelId: "different-model" }),
    evidence: [
      ...evidence("b".repeat(64)).slice(0, 3),
      { ...evidence()[3], valueMm: 999 },
    ],
  });
  const issues = validateFrameCaptureDraft(candidate);
  assert.ok(issues.some((issue) => issue.path === "sources.0.tenantId"));
  assert.ok(issues.some((issue) => issue.path === "measurementSet.frameModelId"));
  assert.ok(issues.some((issue) => issue.path.endsWith("sourceSha256")));
  assert.ok(issues.some((issue) => issue.path.endsWith("valueMm")));
  assert.ok(issues.some((issue) => issue.message.includes("lensHeightMm")));
});

test("G1 readiness requires six distinct capture roles and verified dimensional evidence", () => {
  const kinds = ["front", "left45", "right45", "leftSide", "rightSide", "marking"];
  const sources = kinds.map((kind, index) => source({
    id: `source-${kind}`,
    kind,
    objectKey: `source/sunglass-a/${kind}.png`,
    sha256: String(index + 1).repeat(64),
  }));
  const candidate = draft({ sources, evidence: evidence(sources[0].sha256, "verified") });
  const readiness = evaluateG1CaptureReadiness(candidate);
  assert.deepEqual(readiness, { ready: true, issues: [] });
});
