import assert from "node:assert/strict";
import test from "node:test";

import { SingleFrameRuntime } from "../dist/apps/try-on-web/src/singleFrameRuntime.js";
import { ConfidenceGate } from "../dist/packages/tracking/src/index.js";

function harness(detections, dependencies = {}) {
  const calls = { initialize: 0, dispose: 0, load: 0, renders: [] };
  const backend = {
    async initialize() { calls.initialize += 1; },
    async detect() { return detections.shift() ?? null; },
    async dispose() { calls.dispose += 1; },
  };
  const renderer = {
    async initialize() {},
    async loadAsset() { calls.load += 1; },
    render(frame) { calls.renders.push(frame); },
    dispose() {},
  };
  const poseAdapter = {
    resolve(input) {
      return { position: { x: 0, y: 0, z: -0.5 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, sourceConfidence: input.confidence };
    },
  };
  const scaleResolver = {
    update() { return { millimetresPerPixel: 0.6, confidence: "medium", sampleCount: 3 }; },
    setManualOverride() {},
    reset() {},
  };
  const gate = new ConfidenceGate({
    enterThreshold: 0.8, exitThreshold: 0.6, lostThreshold: 0.2,
    acquireHoldMs: 0, degradeHoldMs: 0, lostHoldMs: 0, recoverHoldMs: 0,
  });
  return {
    runtime: new SingleFrameRuntime({ backend, renderer, poseAdapter, scaleResolver, confidenceGate: gate, ...dependencies }),
    calls,
  };
}

function detection(timestampSeconds, confidence = 0.9) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  return {
    timestampSeconds,
    confidence,
    landmarks,
    facialTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1],
    imageSize: { width: 100, height: 100 },
  };
}

const camera = {
  sourceSize: { width: 100, height: 100 },
  viewportSize: { width: 100, height: 100 },
  mirrored: true,
  verticalFovDeg: 50,
  objectFit: "cover",
};

test("vertical slice initializes adapters and renders a filtered tracking frame", async () => {
  const { runtime, calls } = harness([detection(1)]);
  await runtime.initialize({}, { asset: {} });
  const view = await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  assert.equal(view.state, "tracking");
  assert.equal(view.scaleConfidence, "medium");
  assert.equal(view.landmarkCount, 478);
  assert.equal(calls.initialize, 1);
  assert.equal(calls.load, 1);
  assert.equal(calls.renders.length, 1);
  assert.equal(calls.renders[0].opacity, 1);
  assert.equal(calls.renders[0].faceLandmarks.length, 478);
});

test("no-face transition reuses only the last pose and fails closed", async () => {
  const { runtime, calls } = harness([detection(1), null, null]);
  await runtime.initialize({}, { asset: {} });
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const degraded = await runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  const lost = await runtime.process({ source: {}, timestampSeconds: 3 }, camera);
  assert.equal(degraded.state, "degraded");
  assert.equal(lost.state, "lost");
  assert.equal(calls.renders.at(-1).opacity, 0);
});

test("dispose resets and releases backend resources", async () => {
  const { runtime, calls } = harness([]);
  await runtime.initialize({}, { asset: {} });
  await runtime.dispose();
  assert.equal(calls.dispose, 1);
  await assert.rejects(runtime.process({ source: {}, timestampSeconds: 1 }, camera), /must be initialized/);
});

test("vertical slice exposes initialization, first-use, detection, and render timings", async () => {
  const timestamps = [0, 10, 11, 14, 15, 16, 18, 19];
  const { runtime } = harness([detection(1)], { now: () => timestamps.shift() });
  await runtime.initialize({}, { asset: {} });
  const view = await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  assert.deepEqual(view.performance, {
    initializationMs: 10,
    firstDetectionMs: 15,
    firstRenderMs: 19,
    detectionCount: 1,
    faceDetectionCount: 1,
    renderCount: 1,
    averageDetectionMs: 3,
    maximumDetectionMs: 3,
    averageRenderMs: 2,
    maximumRenderMs: 2,
  });
});

test("dispose cancels in-flight initialization before an asset can be loaded", async () => {
  let releaseInitialization;
  const initialized = new Promise((resolve) => { releaseInitialization = resolve; });
  const backend = {
    initialize: () => initialized,
    async detect() { return null; },
    async dispose() {},
  };
  const { runtime, calls } = harness([], { backend });
  const starting = runtime.initialize({}, { asset: {} });
  await runtime.dispose();
  releaseInitialization();
  await assert.rejects(starting, /initialization cancelled/);
  assert.equal(calls.load, 0);
});
