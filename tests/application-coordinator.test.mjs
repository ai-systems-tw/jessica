import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ERROR_MESSAGES,
  ApplicationPreflightError,
  RuntimeApplicationCoordinator,
  applicationCaptureAvailable,
  applicationControlPolicy,
} from "../dist/apps/try-on-web/src/applicationCoordinator.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function view(state = "tracking") {
  return {
    state,
    opacity: state === "lost" ? 0 : 1,
    shouldRender: state !== "lost",
    belowExitSinceMs: null,
    hasFace: state !== "lost",
    scaleConfidence: "high",
    pose: null,
    millimetresPerPixel: 0.2,
    landmarkCount: 478,
    performance: {},
    reasons: [],
    angles: null,
    assetQuality: "production",
  };
}

class FakeCamera {
  status = { state: "idle", message: "idle" };
  starts = 0;
  stops = 0;
  startImplementation = async () => ({ state: "active", message: "raw active" });
  listeners = new Set();

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  emit(status) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  async start() {
    this.starts += 1;
    const status = await this.startImplementation();
    this.emit(status);
    return status;
  }

  stop() {
    this.stops += 1;
    this.emit({ state: "stopped", message: "raw stopped" });
    return this.status;
  }
}

class FakeRaf {
  next = 1;
  callbacks = new Map();
  cancelled = [];
  request(callback) {
    const handle = this.next++;
    this.callbacks.set(handle, callback);
    return handle;
  }
  cancel(handle) {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }
  fire(timestamp = 16) {
    const entry = this.callbacks.entries().next().value;
    assert.ok(entry, "expected a scheduled animation frame");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback(timestamp);
  }
}

class FakeRuntime {
  initializeImplementation = async () => undefined;
  processImplementation = async () => view();
  initializeCalls = 0;
  processCalls = 0;
  disposeCalls = 0;
  async initialize() { this.initializeCalls += 1; return this.initializeImplementation(); }
  async process() { this.processCalls += 1; return this.processImplementation(); }
  async dispose() { this.disposeCalls += 1; }
}

function harness(overrides = {}) {
  const camera = overrides.camera ?? new FakeCamera();
  const raf = overrides.raf ?? new FakeRaf();
  const runtimes = [];
  const contextCallbacks = [];
  const page = { hide: null, visibility: null };
  const video = { srcObject: { stale: true }, pauseCalls: 0, pause() { this.pauseCalls += 1; } };
  const states = [];
  let preflightCalls = 0;
  const coordinator = new RuntimeApplicationCoordinator({
    video,
    canvas: {},
    preflight: overrides.preflight ?? (async () => { preflightCalls += 1; return {}; }),
    camera,
    createRuntime: overrides.createRuntime ?? ((callbacks) => {
      const runtime = new FakeRuntime();
      runtimes.push(runtime);
      contextCallbacks.push(callbacks.onContextLost);
      return runtime;
    }),
    raf,
    pageLifecycle: overrides.pageLifecycle ?? {
      onPageHide(callback) { page.hide = callback; return () => { page.hide = null; }; },
      onVisibilityChange(callback) { page.visibility = callback; return () => { page.visibility = null; }; },
    },
    calibration: () => ({}),
    diagnostics: overrides.diagnostics,
    onPageHidden: overrides.onPageHidden,
    onDestroy: overrides.onDestroy,
  });
  coordinator.subscribe((status) => states.push(status));
  return { coordinator, camera, raf, runtimes, contextCallbacks, page, video, states, preflightCalls: () => preflightCalls };
}

test("preflight rejects immutable configuration before camera, backend, WebGL, or RAF construction", async () => {
  let runtimeConstructions = 0;
  const raw = "https://secret.example/private/model.glb?token=sk-secret /Users/private stack";
  const h = harness({
    preflight: async () => { void raw; throw new ApplicationPreflightError("CONFIGURATION_INVALID"); },
    createRuntime: () => { runtimeConstructions += 1; return new FakeRuntime(); },
  });
  const result = await h.coordinator.start();
  assert.equal(result.lifecycle.state, "error");
  assert.equal(result.errorCode, "CONFIGURATION_INVALID");
  assert.equal(result.message, APPLICATION_ERROR_MESSAGES.CONFIGURATION_INVALID);
  assert.equal(h.camera.starts, 0);
  assert.equal(runtimeConstructions, 0);
  assert.equal(h.raf.callbacks.size, 0);
  assert.equal(JSON.stringify(h.states).includes(raw), false);
});

test("camera permission denial is stable, sanitized, and terminal without runtime construction", async () => {
  const camera = new FakeCamera();
  camera.startImplementation = async () => ({ state: "permission-denied", message: "raw /camera URL token", errorName: "NotAllowedError" });
  let constructed = 0;
  const h = harness({ camera, createRuntime: () => { constructed += 1; return new FakeRuntime(); } });
  const result = await h.coordinator.start();
  assert.equal(result.errorCode, "CAMERA_PERMISSION_DENIED");
  assert.equal(result.lifecycle.state, "permission-denied");
  assert.equal(result.message, APPLICATION_ERROR_MESSAGES.CAMERA_PERMISSION_DENIED);
  assert.equal(constructed, 0);
  assert.equal(JSON.stringify(h.states).includes("raw /camera"), false);
  assert.equal(h.video.srcObject, null);
});

test("asset/model initialization failure closes runtime, camera, video, and RAF exactly once", async () => {
  const runtime = new FakeRuntime();
  runtime.initializeImplementation = async () => { throw new Error("https://host/model.glb secret stack"); };
  const h = harness({ createRuntime: (callbacks) => { h.contextCallbacks.push(callbacks.onContextLost); h.runtimes.push(runtime); return runtime; } });
  const result = await h.coordinator.start();
  assert.equal(result.errorCode, "RUNTIME_INITIALIZATION_FAILED");
  assert.equal(runtime.disposeCalls, 1);
  assert.ok(h.camera.stops >= 2);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.raf.callbacks.size, 0);
  assert.equal(JSON.stringify(h.states).includes("model.glb"), false);
  await h.coordinator.stop();
  assert.equal(runtime.disposeCalls, 1);
});

test("tracking failure closes everything and a late inference completion cannot revive the session", async () => {
  const pending = deferred();
  const runtime = new FakeRuntime();
  runtime.processImplementation = () => pending.promise;
  const h = harness({ createRuntime: (callbacks) => { h.runtimes.push(runtime); h.contextCallbacks.push(callbacks.onContextLost); return runtime; } });
  await h.coordinator.start();
  h.raf.fire();
  const stop = h.coordinator.stop();
  pending.resolve(view("tracking"));
  await stop;
  await Promise.resolve();
  assert.equal(h.coordinator.status.lifecycle.state, "idle");
  assert.equal(runtime.disposeCalls, 1);
  assert.equal(h.raf.callbacks.size, 0);
  assert.equal(h.video.srcObject, null);

  const failing = new FakeRuntime();
  failing.processImplementation = async () => { throw new Error("raw network URL / stack"); };
  const h2 = harness({ createRuntime: () => failing });
  await h2.coordinator.start();
  h2.raf.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h2.coordinator.status.errorCode, "TRACKING_FAILED");
  assert.equal(failing.disposeCalls, 1);
  assert.equal(h2.raf.callbacks.size, 0);
});

test("track-ended and context loss cancel RAF and dispose runtime without stale restoration", async () => {
  const h = harness();
  await h.coordinator.start();
  const runtime = h.runtimes[0];
  assert.equal(h.raf.callbacks.size, 1);
  h.camera.emit({ state: "stopped", message: "ended raw" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.errorCode, "CAMERA_ENDED");
  assert.equal(runtime.disposeCalls, 1);
  assert.equal(h.raf.callbacks.size, 0);

  await h.coordinator.start();
  const second = h.runtimes[1];
  h.contextCallbacks[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.errorCode, "WEBGL_CONTEXT_LOST");
  assert.equal(second.disposeCalls, 1);
  assert.equal(h.raf.callbacks.size, 0);
  h.contextCallbacks[1]();
  await Promise.resolve();
  assert.equal(second.disposeCalls, 1);
});

test("stop during preflight, camera start, runtime initialization, and inference invalidates late generations", async () => {
  const preflight = deferred();
  const h = harness({ preflight: () => preflight.promise });
  const starting = h.coordinator.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.phase, "preflight");
  assert.deepEqual(applicationControlPolicy(h.coordinator.status, false), { startDisabled: true, stopDisabled: false });
  await h.coordinator.stop();
  preflight.resolve({});
  await starting;
  assert.equal(h.camera.starts, 0);
  assert.equal(h.coordinator.status.lifecycle.state, "idle");

  const cameraPending = deferred();
  const camera = new FakeCamera();
  camera.startImplementation = () => cameraPending.promise;
  const h2 = harness({ camera });
  const startingCamera = h2.coordinator.start();
  await Promise.resolve();
  await Promise.resolve();
  const stopped = h2.coordinator.stop();
  cameraPending.resolve({ state: "active", message: "late" });
  await Promise.all([startingCamera, stopped]);
  assert.equal(h2.runtimes.length, 0);

  const initialization = deferred();
  const runtime = new FakeRuntime();
  runtime.initializeImplementation = () => initialization.promise;
  const h3 = harness({ createRuntime: () => runtime });
  const startingRuntime = h3.coordinator.start();
  await new Promise((resolve) => setImmediate(resolve));
  const stoppedRuntime = h3.coordinator.stop();
  initialization.resolve();
  await Promise.all([startingRuntime, stoppedRuntime]);
  assert.equal(runtime.disposeCalls, 1);
  assert.equal(h3.raf.callbacks.size, 0);
});

test("unsupported cameras use the explicit reducer state and self-test mode disables live controls", async () => {
  const camera = new FakeCamera();
  camera.startImplementation = async () => ({ state: "unsupported", message: "raw browser detail" });
  const h = harness({ camera });
  const result = await h.coordinator.start();
  assert.equal(result.lifecycle.state, "unsupported");
  assert.equal(result.errorCode, "CAMERA_UNSUPPORTED");
  assert.deepEqual(applicationControlPolicy(result, true), { startDisabled: true, stopDisabled: true });
});

test("an active return whose camera capability already ended fails closed", async () => {
  const camera = new FakeCamera();
  camera.start = async function start() {
    this.starts += 1;
    this.emit({ state: "active", message: "active" });
    this.emit({ state: "stopped", message: "ended between await continuations" });
    return { state: "active", message: "stale active result" };
  };
  const h = harness({ camera });
  const result = await h.coordinator.start();
  assert.equal(result.errorCode, "CAMERA_ENDED");
  assert.equal(h.runtimes.length, 0);
  assert.equal(h.raf.callbacks.size, 0);
});

test("lifecycle listener registration failure rolls back partial hooks and permanently fails closed", async () => {
  let cameraRemoved = 0;
  let pageRemoved = 0;
  const camera = new FakeCamera();
  camera.subscribe = () => () => { cameraRemoved += 1; };
  const h = harness({
    camera,
    pageLifecycle: {
      onPageHide() { return () => { pageRemoved += 1; }; },
      onVisibilityChange() { throw new Error("registration raw URL"); },
    },
  });
  assert.equal(h.coordinator.status.errorCode, "APPLICATION_LIFECYCLE_UNAVAILABLE");
  assert.equal(h.coordinator.status.phase, "terminal");
  assert.equal(cameraRemoved, 1);
  assert.equal(pageRemoved, 1);
  await h.coordinator.start();
  assert.equal(h.camera.starts, 0);
});

test("slow obsolete stop/failure teardown cannot clobber or dispose a newer generation", async () => {
  const disposal = deferred();
  const oldRuntime = new FakeRuntime();
  oldRuntime.dispose = async function dispose() { this.disposeCalls += 1; await disposal.promise; };
  const newRuntime = new FakeRuntime();
  const available = [oldRuntime, newRuntime];
  const h = harness({ createRuntime: () => available.shift() });
  await h.coordinator.start();
  const oldStop = h.coordinator.stop();
  assert.equal(h.coordinator.status.phase, "stopping");
  assert.equal(applicationCaptureAvailable(h.coordinator.status), false);
  const newStart = h.coordinator.start();
  await Promise.resolve();
  assert.equal(h.camera.starts, 1);
  disposal.resolve();
  await Promise.all([oldStop, newStart]);
  assert.equal(h.coordinator.status.lifecycle.state, "acquiring");
  assert.equal(h.coordinator.status.phase, "running");
  assert.equal(oldRuntime.disposeCalls, 1);
  assert.equal(newRuntime.disposeCalls, 0);

  const failureDisposal = deferred();
  newRuntime.processImplementation = async () => { throw new Error("tracking raw"); };
  newRuntime.dispose = async function dispose() { this.disposeCalls += 1; await failureDisposal.promise; };
  h.raf.fire();
  await Promise.resolve();
  const third = new FakeRuntime();
  available.push(third);
  const restart = h.coordinator.start();
  failureDisposal.resolve();
  await restart;
  assert.equal(h.coordinator.status.lifecycle.state, "acquiring");
  assert.equal(newRuntime.disposeCalls, 1);
  assert.equal(third.disposeCalls, 0);
});

test("rapid starts, repeated stop/dispose, observer throws, and page hide remain deterministic", async () => {
  const first = deferred();
  let preflights = 0;
  let hiddenCalls = 0;
  const diagnostics = [];
  const h = harness({
    preflight: () => preflights++ === 0 ? first.promise : Promise.resolve({}),
    diagnostics: { report(event) { diagnostics.push(event); throw new Error("diagnostic observer raw"); } },
    onPageHidden: () => { hiddenCalls += 1; throw new Error("page observer raw"); },
  });
  h.coordinator.subscribe(() => { throw new Error("public observer raw URL"); });
  const oldStart = h.coordinator.start();
  await Promise.resolve();
  const newStart = h.coordinator.start();
  first.resolve({});
  await Promise.all([oldStart, newStart]);
  assert.equal(h.runtimes.length, 1);
  assert.equal(h.coordinator.status.lifecycle.state, "acquiring");

  h.page.visibility(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hiddenCalls, 1);
  assert.equal(h.coordinator.status.lifecycle.state, "idle");
  assert.equal(h.runtimes[0].disposeCalls, 1);
  assert.ok(diagnostics.some((event) => event.type === "observer-failed"));

  await h.coordinator.start();
  const current = h.runtimes[1];
  h.page.hide();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.disposeCalls, 1);
  await h.coordinator.stop();
  await h.coordinator.stop();
  await h.coordinator.dispose();
  await h.coordinator.dispose();
  assert.equal(current.disposeCalls, 1);
  assert.equal(h.page.hide, null);
});

test("restart succeeds after each terminal failure without reviving the failed runtime", async () => {
  const bad = new FakeRuntime();
  bad.initializeImplementation = async () => { throw new Error("bad raw path"); };
  const good = new FakeRuntime();
  const runtimes = [bad, good];
  const h = harness({ createRuntime: () => runtimes.shift() });
  assert.equal((await h.coordinator.start()).errorCode, "RUNTIME_INITIALIZATION_FAILED");
  assert.equal((await h.coordinator.start()).lifecycle.state, "acquiring");
  h.raf.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.lifecycle.state, "tracking");
  assert.equal(bad.disposeCalls, 1);
  assert.equal(good.disposeCalls, 0);
});

test("RAF request failures and synchronous callbacks cannot strand an initialized runtime", async () => {
  const throwingRaf = { callbacks: new Map(), request() { throw new Error("raw RAF failure"); }, cancel() {} };
  const failed = harness({ raf: throwingRaf });
  await failed.coordinator.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failed.coordinator.status.errorCode, "TRACKING_FAILED");
  assert.equal(failed.runtimes[0].disposeCalls, 1);
  assert.equal(failed.video.srcObject, null);

  let requests = 0;
  let queued = null;
  const reentrantRaf = {
    request(callback) {
      requests += 1;
      if (requests === 1) callback(16);
      else queued = callback;
      return requests;
    },
    cancel() {},
  };
  const synchronous = harness({ raf: reentrantRaf });
  await synchronous.coordinator.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(synchronous.coordinator.status.lifecycle.state, "tracking");
  assert.equal(requests, 2);
  assert.equal(typeof queued, "function");
  await synchronous.coordinator.stop();
  assert.equal(synchronous.runtimes[0].disposeCalls, 1);
});

test("malicious status consumers cannot mutate coordinator lifecycle ownership", async () => {
  const h = harness();
  h.coordinator.subscribe((status) => {
    Reflect.set(status.lifecycle, "state", "error");
    Reflect.set(status, "phase", "terminal");
  });
  const exposed = h.coordinator.status;
  assert.equal(Reflect.set(exposed.lifecycle, "state", "error"), false);
  assert.equal(Reflect.set(exposed, "message", "raw attacker message"), false);
  await h.coordinator.start();
  assert.equal(h.coordinator.status.lifecycle.state, "acquiring");
  assert.equal(h.coordinator.status.phase, "running");
  assert.equal(Object.isFrozen(h.coordinator.status), true);
  assert.equal(Object.isFrozen(h.coordinator.status.lifecycle), true);
  await h.coordinator.stop();
  assert.equal(h.coordinator.status.lifecycle.state, "idle");
  assert.equal(h.runtimes[0].disposeCalls, 1);
});
