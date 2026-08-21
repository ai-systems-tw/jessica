import assert from "node:assert/strict";
import test from "node:test";

import { SingleFrameRuntime } from "../dist/apps/try-on-web/src/singleFrameRuntime.js";
import { ConfidenceGate } from "../dist/packages/tracking/src/index.js";

const runtimeAsset = {
  asset: {
    quality: "standard",
    qualityEnvelope: { maxYawDeg: 25, maxPitchDeg: 15, recommendedForLive: true, scaleConfidence: "medium" },
  },
};

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    now: () => now,
    scheduler: {
      setTimeout(callback, delayMs) { const id = nextId++; tasks.set(id, { at: now + delayMs, callback }); return id; },
      clearTimeout(id) { tasks.delete(id); },
    },
    advanceTo(target) {
      now = target;
      for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.callback(); }
    },
  };
}

function harness(detections, dependencies = {}) {
  const calls = { initialize: 0, dispose: 0, load: 0, rendererDispose: 0, hides: 0, renders: [] };
  const backend = dependencies.backend ?? {
    async initialize() { calls.initialize += 1; },
    async detect() { return await (detections.shift() ?? null); },
    async dispose() { calls.dispose += 1; },
  };
  const renderer = {
    async initialize() {},
    async loadAsset() { calls.load += 1; },
    render(frame) { calls.renders.push(frame); },
    hide() { calls.hides += 1; },
    dispose() { calls.rendererDispose += 1; },
  };
  const poseAdapter = {
    resolve(input) {
      return { position: { x: 0, y: 0, z: -0.5 }, rotation: input.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, sourceConfidence: input.confidence };
    },
  };
  const scaleResolver = dependencies.scaleResolver ?? {
    update() { return { millimetresPerPixel: 0.6, confidence: "medium", sampleCount: 3 }; },
    setManualOverride() {},
    reset() {},
  };
  const gate = dependencies.confidenceGate ?? new ConfidenceGate({
    enterThreshold: 0.8, exitThreshold: 0.6,
    acquireHoldMs: 0, degradeHoldMs: 0, recoverHoldMs: 0, falseAttachmentLimitMs: 0,
  });
  return {
    runtime: new SingleFrameRuntime({ backend, renderer, poseAdapter, scaleResolver, confidenceGate: gate, ...dependencies }),
    calls,
  };
}

function detection(timestampSeconds, confidence = 0.9, rotation) {
  const landmarks = Array.from({ length: 478 }, (_, index) => ({ x: 0.3 + (index % 22) / 55, y: 0.3 + (Math.floor(index / 22) % 22) / 55, z: 0 }));
  return {
    timestampSeconds, confidence, landmarks, rotation,
    facialTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1],
    imageSize: { width: 100, height: 100 },
  };
}

const camera = {
  projectionIdentity: { profileId: "fixture", profileSha256: "0".repeat(64), admission: "fixture-only" },
  sourceSize: { width: 100, height: 100 }, viewportSize: { width: 100, height: 100 },
  intrinsics: { fxPx: 80, fyPx: 75, cxPx: 50, cyPx: 50 }, displayMirror: "none", objectFit: "cover",
};

test("vertical slice exposes angles, reasons, asset tier and renders final policy opacity", async () => {
  const { runtime, calls } = harness([detection(1)]);
  await runtime.initialize({}, runtimeAsset);
  const view = await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  assert.equal(view.state, "tracking");
  assert.equal(view.assetQuality, "standard");
  assert.deepEqual(view.reasons, []);
  assert.deepEqual(view.angles, { yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  assert.equal(calls.renders[0].opacity, 1);
  assert.equal(calls.renders[0].faceLandmarks.length, 478);
  await runtime.dispose();
});

test("source capability drift during detection prevents every render and state commit", async () => {
  let resolveDetection;
  const pending = new Promise((resolve) => { resolveDetection = resolve; });
  let current = true;
  const { runtime, calls } = harness([pending], { sourceGuard: () => current });
  await runtime.initialize({}, runtimeAsset);
  const processing = runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  current = false;
  resolveDetection(detection(1));
  await assert.rejects(processing, /source capability changed/);
  assert.equal(calls.renders.length, 0);
  assert.equal(runtime.view(), null);
});

test("a rejected stale-source frame cannot replace the last successfully rendered frame", async () => {
  const clock = fakeClock(); let current = true;
  const { runtime, calls } = harness([detection(1), detection(2)], { sourceGuard: () => current, now: clock.now, scheduler: clock.scheduler });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  current = false;
  await assert.rejects(runtime.process({ source: {}, timestampSeconds: 2 }, camera), /source capability changed/);
  current = true; clock.advanceTo(250);
  assert.equal(calls.renders.at(-1).timestampSeconds, 1);
  assert.equal(calls.renders.at(-1).opacity, 0);
});

test("watchdog hides and reports invalid source while detection remains pending", async () => {
  const clock = fakeClock(); let current = true; let invalidations = 0; let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  const { runtime, calls } = harness([detection(1), late], {
    sourceGuard: () => current, onSourceInvalid: () => { invalidations += 1; }, now: clock.now, scheduler: clock.scheduler,
  });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const pending = runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  current = false; clock.advanceTo(250);
  assert.equal(current, false); assert.equal(calls.hides, 1); assert.equal(invalidations, 1); assert.equal(runtime.view().opacity, 0);
  resolveLate(detection(2)); await assert.rejects(pending, /source capability changed/);
});

test("dispose clears independently when projection source guard is false", async () => {
  let current = true;
  const { runtime, calls } = harness([detection(1)], { sourceGuard: () => current });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  current = false; await runtime.dispose();
  assert.equal(calls.hides, 1);
  assert.equal(calls.renders.filter(({ opacity }) => opacity === 0).length, 0);
  assert.equal(calls.rendererDispose, 1);
});

test("hard raw-angle and scale violations hide on the same frame", async () => {
  const yaw30 = { x: 0, y: Math.sin(Math.PI / 12), z: 0, w: Math.cos(Math.PI / 12) };
  const lowScale = { update: () => ({ millimetresPerPixel: null, confidence: "low", sampleCount: 0 }), setManualOverride() {}, reset() {} };
  const { runtime, calls } = harness([detection(1, 0.9, yaw30)], { scaleResolver: lowScale });
  await runtime.initialize({}, runtimeAsset);
  const view = await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  assert.equal(view.opacity, 0);
  assert.deepEqual(view.reasons, ["yaw-out-of-envelope", "scale-confidence-insufficient", "scale-unavailable"]);
  assert.equal(calls.renders.at(-1).opacity, 0);
});

test("invalid raw quaternion hides without reaching rotation filters", async () => {
  const { runtime, calls } = harness([detection(1, 0.9, { x: 0, y: 0, z: 0, w: 0 })]);
  await runtime.initialize({}, runtimeAsset);
  const view = await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  assert.equal(view.opacity, 0);
  assert.deepEqual(view.reasons, ["invalid-head-rotation"]);
  assert.equal(calls.renders.at(-1).opacity, 0);
});

test("no-face transition reuses only the last pose and fails closed", async () => {
  const { runtime, calls } = harness([detection(1), null]);
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const lost = await runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  assert.equal(lost.state, "lost");
  assert.equal(calls.renders.at(-1).opacity, 0);
});

test("watchdog hides at 250ms, not 249ms, when frames stop", async () => {
  const clock = fakeClock();
  const { runtime, calls } = harness([detection(1)], { now: clock.now, scheduler: clock.scheduler });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  clock.advanceTo(249);
  assert.equal(calls.renders.at(-1).opacity, 1);
  clock.advanceTo(250);
  assert.equal(calls.renders.at(-1).opacity, 0);
  assert.equal(runtime.view().reasons[0], "watchdog-expired");
});

test("watchdog expiry suppresses a late in-flight detection", async () => {
  const clock = fakeClock();
  let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  const { runtime, calls } = harness([detection(1), late], { now: clock.now, scheduler: clock.scheduler });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const pending = runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  clock.advanceTo(249);
  assert.equal(calls.renders.at(-1).opacity, 1);
  clock.advanceTo(250);
  resolveLate(detection(2));
  const view = await pending;
  assert.equal(view.opacity, 0);
  assert.equal(calls.renders.filter((frame) => frame.opacity === 1).length, 1);
});

test("watchdog remains hidden when pending Worker-style inference fails late", async () => {
  const clock = fakeClock();
  let rejectLate;
  const late = new Promise((_, reject) => { rejectLate = reject; });
  const { runtime, calls } = harness([detection(1), late], { now: clock.now, scheduler: clock.scheduler });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const pending = runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  clock.advanceTo(250);
  rejectLate(new Error("Worker inference timeout"));
  await assert.rejects(pending, /inference timeout/);
  assert.equal(runtime.view().opacity, 0);
  assert.equal(calls.renders.filter((frame) => frame.opacity === 1).length, 1);
});

test("dispose synchronously hides and cancels in-flight work", async () => {
  let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  const { runtime, calls } = harness([detection(1), late]);
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const pending = runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  const disposing = runtime.dispose();
  assert.equal(calls.hides, 1);
  resolveLate(detection(2));
  await assert.rejects(pending, /process cancelled/);
  await disposing;
  assert.equal(calls.rendererDispose, 1);
});

test("a queued callback from a disposed generation cannot hide a restarted session", async () => {
  const queued = [];
  const scheduler = {
    setTimeout(callback) { queued.push(callback); return queued.length; },
    clearTimeout() {},
  };
  const { runtime, calls } = harness([detection(1), detection(2)], { now: () => 0, scheduler });
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  const staleCallback = queued[0];
  await runtime.dispose();
  await runtime.initialize({}, runtimeAsset);
  await runtime.process({ source: {}, timestampSeconds: 2 }, camera);
  const renderCount = calls.renders.length;
  staleCallback();
  assert.equal(calls.renders.length, renderCount);
  assert.equal(calls.renders.at(-1).opacity, 1);
  assert.equal(runtime.view().opacity, 1);
});

test("dispose resets and releases backend resources", async () => {
  const { runtime, calls } = harness([]);
  await runtime.initialize({}, runtimeAsset);
  await runtime.dispose();
  assert.equal(calls.dispose, 1);
  await assert.rejects(runtime.process({ source: {}, timestampSeconds: 1 }, camera), /must be initialized/);
});

test("vertical slice exposes deterministic performance counters", async () => {
  let now = 0;
  const { runtime } = harness([detection(1)], { now: () => now++ });
  await runtime.initialize({}, runtimeAsset);
  const view = await runtime.process({ source: {}, timestampSeconds: 1 }, camera);
  assert.equal(view.performance.detectionCount, 1);
  assert.equal(view.performance.faceDetectionCount, 1);
  assert.equal(view.performance.renderCount, 1);
});

test("dispose cancels in-flight initialization before an asset can be loaded", async () => {
  let releaseInitialization;
  const initialized = new Promise((resolve) => { releaseInitialization = resolve; });
  const backend = { initialize: () => initialized, async detect() { return null; }, async dispose() {} };
  const { runtime, calls } = harness([], { backend });
  const starting = runtime.initialize({}, runtimeAsset);
  await runtime.dispose();
  releaseInitialization();
  await assert.rejects(starting, /initialization cancelled/);
  assert.equal(calls.load, 0);
});

test("dispose immediately cancels a pending backend initialization", async () => {
  let rejectInitialization;
  let disposeCalls = 0;
  const backend = {
    initialize: () => new Promise((_resolve, reject) => { rejectInitialization = reject; }),
    async detect() { return null; },
    async dispose() {
      disposeCalls += 1;
      rejectInitialization(new Error("cancelled by backend dispose"));
    },
  };
  const { runtime } = harness([], { backend });
  const initialization = runtime.initialize({}, runtimeAsset);
  await Promise.resolve();
  await Promise.resolve();
  const disposal = runtime.dispose();
  assert.equal(disposeCalls, 1);
  await disposal;
  await assert.rejects(initialization, /cancelled/);
});

test("old backend completion cannot dispose or overlap a reinitialized capability", async () => {
  let resolveOld;
  let initializeCalls = 0;
  let disposeCalls = 0;
  const backend = {
    initialize() {
      initializeCalls += 1;
      if (initializeCalls === 1) return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve();
    },
    async detect() { return null; },
    async dispose() { disposeCalls += 1; },
  };
  const { runtime } = harness([], { backend });
  const oldInitialization = runtime.initialize({}, runtimeAsset);
  await Promise.resolve();
  await Promise.resolve();
  await runtime.dispose();
  const replacementInitialization = runtime.initialize({}, runtimeAsset);
  await Promise.resolve();
  assert.equal(initializeCalls, 1, "replacement waits for the old backend operation to settle");
  resolveOld();
  await assert.rejects(oldInitialization, /cancelled/);
  await replacementInitialization;
  assert.equal(initializeCalls, 2);
  assert.equal(disposeCalls, 1);
  await runtime.dispose();
  assert.equal(disposeCalls, 2);
});
