import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateQuality,
  median,
  percentile,
  rootMeanSquare,
} from "../dist/packages/quality/src/index.js";

test("statistics are deterministic", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([0, 10], 95), 9.5);
  assert.equal(rootMeanSquare([3, 4]), Math.sqrt(12.5));
});

test("quality evaluation passes compliant samples", () => {
  const result = evaluateQuality([
    {
      fixtureId: "a",
      bridgeErrorMm: 2,
      frameWidthErrorPct: 3,
      jitterRmsMm: 0.5,
      trackingSucceeded: true,
      renderFps: 30,
    },
    {
      fixtureId: "b",
      bridgeErrorMm: 2.5,
      frameWidthErrorPct: -4,
      jitterRmsMm: 0.7,
      trackingSucceeded: true,
      renderFps: 25,
    },
  ]);
  assert.equal(result.pass, true);
  assert.deepEqual(result.violations, []);
});

test("quality evaluation reports all failed gates", () => {
  const result = evaluateQuality([
    {
      fixtureId: "bad",
      bridgeErrorMm: 8,
      frameWidthErrorPct: 9,
      jitterRmsMm: 2,
      trackingSucceeded: false,
      renderFps: 12,
    },
  ]);
  assert.equal(result.pass, false);
  assert.ok(result.violations.length >= 5);
});
