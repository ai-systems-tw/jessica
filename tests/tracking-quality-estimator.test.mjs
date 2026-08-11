import assert from "node:assert/strict";
import test from "node:test";
import { estimateTrackingQuality } from "../dist/packages/tracking/src/index.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1];
function points({ width = 0.5, height = 0.5, visibility = 1 } = {}) {
  return Array.from({ length: 478 }, (_, index) => ({
    x: 0.5 - width / 2 + width * (index % 22) / 21,
    y: 0.5 - height / 2 + height * (Math.floor(index / 22) % 22) / 21,
    z: -0.1,
    visibility,
  }));
}
function observation(overrides = {}) {
  return {
    timestampSeconds: 1,
    imageSize: { width: 640, height: 480 },
    landmarks: points(),
    facialTransform: identity,
    ...overrides,
  };
}

test("geometric estimator is deterministic, non-binary, and visibility invariant", () => {
  const middle = estimateTrackingQuality(observation({ landmarks: points({ width: 0.2, height: 0.2, visibility: 0 }) }));
  const changedVisibility = estimateTrackingQuality(observation({ landmarks: points({ width: 0.2, height: 0.2, visibility: 1 }) }));
  assert.equal(middle.confidence, changedVisibility.confidence);
  assert.ok(middle.confidence > 0 && middle.confidence < 1);
  assert.deepEqual(middle.metrics, changedVisibility.metrics);
});

test("incomplete or non-finite landmark structures fail closed", () => {
  assert.equal(estimateTrackingQuality(observation({ landmarks: points().slice(1) })).confidence, 0);
  const invalid = points();
  invalid[20] = { ...invalid[20], x: NaN };
  const estimate = estimateTrackingQuality(observation({ landmarks: invalid }));
  assert.equal(estimate.confidence, 0);
  assert.ok(estimate.reasons.includes("non-finite-landmark"));
  const reflected = [...identity];
  reflected[10] = -1;
  assert.equal(estimateTrackingQuality(observation({ facialTransform: reflected })).confidence, 0);
});

test("temporal residual and transform jump lower quality without binary presence scores", () => {
  const first = estimateTrackingQuality(observation());
  const moved = points();
  for (let index = 0; index < 120; index += 1) moved[index] = { ...moved[index], z: moved[index].z + 0.1 };
  const second = estimateTrackingQuality(observation({ timestampSeconds: 1.05, landmarks: moved }), first.history);
  assert.ok(second.confidence < first.confidence);
  const jumpedMatrix = [...identity];
  jumpedMatrix[12] = 30;
  const jumped = estimateTrackingQuality(observation({ timestampSeconds: 1.05, facialTransform: jumpedMatrix }), first.history);
  assert.equal(jumped.confidence, 0);
  assert.ok(jumped.reasons.includes("transform-jump"));
});
