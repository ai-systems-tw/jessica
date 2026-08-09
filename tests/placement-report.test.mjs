import assert from "node:assert/strict";
import test from "node:test";

import { derivePlacementReport } from "../dist/packages/quality/src/index.js";

function annotation(overrides = {}) {
  return {
    schemaVersion: 1,
    fixtureId: "j1-m-front-01",
    subjectId: "subject-001",
    frameModelId: "j1-m",
    sourceImageSha256: "a".repeat(64),
    consentReference: "consent-001",
    actualFrameWidthMm: 140,
    actual: {
      bridgeCenter: { x: 500, y: 300 }, frameLeft: { x: 150, y: 300 }, frameRight: { x: 850, y: 300 },
      leftLensCenter: { x: 350, y: 300 }, rightLensCenter: { x: 650, y: 300 },
    },
    rendered: {
      bridgeCenter: { x: 510, y: 300 }, frameLeft: { x: 157, y: 307 }, frameRight: { x: 843, y: 307 },
      leftLensCenter: { x: 355, y: 303 }, rightLensCenter: { x: 645, y: 303 },
    },
    jitterRmsMm: 0.5,
    trackingSucceeded: true,
    renderFps: 30,
    ...overrides,
  };
}

test("placement annotations deterministically derive physical errors", () => {
  const report = derivePlacementReport(annotation());
  assert.equal(report.metrics.millimetresPerPixel, 0.2);
  assert.equal(report.metrics.bridgeErrorMm, 2);
  assert.equal(report.metrics.frameWidthErrorPct, -2);
  assert.ok(Math.abs(report.metrics.leftLensCenterErrorMm - Math.hypot(5, 3) * 0.2) < 1e-12);
  assert.equal(report.metrics.rollErrorDeg, 0);
  assert.equal(report.qualitySample.renderFps, 30);
});

test("placement annotations reject missing consent, hashes, and zero-width ground truth", () => {
  assert.throws(() => derivePlacementReport(annotation({ consentReference: "" })), /consentReference/);
  assert.throws(() => derivePlacementReport(annotation({ sourceImageSha256: "unknown" })), /SHA-256/);
  const zeroWidth = annotation();
  zeroWidth.actual.frameRight = zeroWidth.actual.frameLeft;
  assert.throws(() => derivePlacementReport(zeroWidth), /greater than zero pixels/);
});
