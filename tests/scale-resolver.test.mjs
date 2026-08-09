import assert from "node:assert/strict";
import test from "node:test";

import { IrisScaleResolver, observeIrisScale } from "../dist/packages/scale/src/index.js";

test("iris observation maps MediaPipe landmarks into pixel measurements", () => {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  landmarks[469] = { x: 0.40, y: 0.5, z: 0 };
  landmarks[471] = { x: 0.42, y: 0.5, z: 0 };
  landmarks[474] = { x: 0.58, y: 0.5, z: 0 };
  landmarks[476] = { x: 0.60, y: 0.5, z: 0 };
  landmarks[468] = { x: 0.41, y: 0.5, z: 0 };
  landmarks[473] = { x: 0.59, y: 0.5, z: 0 };
  const observation = observeIrisScale({
    timestampSeconds: 2,
    confidence: 1,
    landmarks,
    facialTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1],
    imageSize: { width: 1000, height: 500 },
  });
  assert.ok(Math.abs(observation.leftIrisDiameterPx - 20) < 1e-10);
  assert.ok(Math.abs(observation.rightIrisDiameterPx - 20) < 1e-10);
  assert.ok(Math.abs(observation.interPupilDistancePx - 180) < 1e-10);
});

test("resolver reaches high confidence from stable bilateral samples", () => {
  const resolver = new IrisScaleResolver();
  let estimate;
  for (let timestampSeconds = 1; timestampSeconds <= 5; timestampSeconds += 1) {
    estimate = resolver.update({ timestampSeconds, leftIrisDiameterPx: 18, rightIrisDiameterPx: 18.2 });
  }
  assert.equal(estimate.confidence, "high");
  assert.equal(estimate.sampleCount, 5);
  assert.ok(Math.abs(estimate.millimetresPerPixel - 11.7 / 18.1) < 1e-12);
});

test("low-pixel and bilateral mismatch observations cannot claim high confidence", () => {
  const lowPixel = new IrisScaleResolver();
  assert.deepEqual(
    lowPixel.update({ timestampSeconds: 1, leftIrisDiameterPx: 4, rightIrisDiameterPx: 4.1 }),
    { millimetresPerPixel: null, confidence: "low", sampleCount: 0, reason: "iris-too-small" },
  );
  const mismatch = new IrisScaleResolver();
  assert.equal(
    mismatch.update({ timestampSeconds: 1, leftIrisDiameterPx: 10, rightIrisDiameterPx: 16 }).reason,
    "bilateral-mismatch",
  );
});

test("outlier rejection preserves the stable median", () => {
  const resolver = new IrisScaleResolver();
  for (let timestampSeconds = 1; timestampSeconds <= 3; timestampSeconds += 1) {
    resolver.update({ timestampSeconds, leftIrisDiameterPx: 18, rightIrisDiameterPx: 18 });
  }
  const estimate = resolver.update({ timestampSeconds: 4, leftIrisDiameterPx: 9, rightIrisDiameterPx: 9 });
  assert.equal(estimate.reason, "outlier-rejected");
  assert.equal(estimate.sampleCount, 3);
  assert.equal(estimate.millimetresPerPixel, 11.7 / 18);
});

test("manual override is explicit, reversible, and reset with the session", () => {
  const resolver = new IrisScaleResolver();
  resolver.setManualOverride(0.5);
  assert.deepEqual(
    resolver.update({ timestampSeconds: 1 }),
    { millimetresPerPixel: 0.5, confidence: "high", sampleCount: 0, reason: "manual-override" },
  );
  resolver.setManualOverride(null);
  assert.equal(resolver.update({ timestampSeconds: 2 }).millimetresPerPixel, null);
  resolver.reset();
  assert.equal(resolver.update({ timestampSeconds: 0 }).sampleCount, 0);
});
