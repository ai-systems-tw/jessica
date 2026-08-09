import assert from "node:assert/strict";
import test from "node:test";

import { INITIAL_RUNTIME_LIFECYCLE, reduceRuntimeLifecycle } from "../dist/packages/runtime/src/index.js";
import { RuntimePerformanceMonitor } from "../dist/packages/quality/src/index.js";

test("runtime lifecycle follows camera, model, and tracking states", () => {
  let state = reduceRuntimeLifecycle(INITIAL_RUNTIME_LIFECYCLE, { type: "CAMERA_REQUESTED" });
  assert.equal(state.state, "requesting-camera");
  state = reduceRuntimeLifecycle(state, { type: "CAMERA_GRANTED" });
  assert.equal(state.state, "loading-model");
  state = reduceRuntimeLifecycle(state, { type: "MODEL_READY" });
  state = reduceRuntimeLifecycle(state, { type: "TRACKING_UPDATED", trackingState: "tracking" });
  assert.equal(state.state, "tracking");
  state = reduceRuntimeLifecycle(state, { type: "TRACKING_UPDATED", trackingState: "degraded" });
  assert.equal(state.state, "degraded");
  state = reduceRuntimeLifecycle(state, { type: "TRACKING_UPDATED", trackingState: "lost" });
  assert.equal(state.state, "lost");
  assert.deepEqual(reduceRuntimeLifecycle(state, { type: "RESET" }), { state: "idle" });
});

test("runtime lifecycle fails closed and rejects invalid transitions", () => {
  assert.deepEqual(
    reduceRuntimeLifecycle(INITIAL_RUNTIME_LIFECYCLE, { type: "CAMERA_DENIED" }),
    { state: "permission-denied" },
  );
  assert.deepEqual(
    reduceRuntimeLifecycle(INITIAL_RUNTIME_LIFECYCLE, { type: "FAILED", errorCode: "model-load" }),
    { state: "error", errorCode: "model-load" },
  );
  assert.throws(
    () => reduceRuntimeLifecycle(INITIAL_RUNTIME_LIFECYCLE, { type: "MODEL_READY" }),
    /invalid from idle/,
  );
});

test("runtime performance monitor records deterministic first-use and duration metrics", () => {
  let now = 100;
  const monitor = new RuntimePerformanceMonitor(() => now);
  monitor.start();
  now = 140;
  monitor.markInitialized();
  now = 150;
  monitor.recordDetection(8, false);
  now = 175;
  monitor.recordDetection(7, true);
  now = 180;
  monitor.recordRender(3);
  monitor.recordRender(5);
  assert.deepEqual(monitor.summary(), {
    initializationMs: 40,
    firstDetectionMs: 75,
    firstRenderMs: 80,
    detectionCount: 2,
    faceDetectionCount: 1,
    renderCount: 2,
    averageDetectionMs: 7.5,
    maximumDetectionMs: 8,
    averageRenderMs: 4,
    maximumRenderMs: 5,
  });
});
