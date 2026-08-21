import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ERROR_MESSAGES,
  ApplicationPreflightError,
  RuntimeApplicationCoordinator,
  applicationCaptureAvailable,
  applicationControlPolicy,
} from "../dist/apps/try-on-web/src/applicationCoordinator.js";
import { cameraCalibrationFromProjection, cameraDeviceBindingSha256, cameraProjectionProfileSigningPayload, createSyntheticFixtureCameraProjection, resolveCameraProjection, verifyCameraProjectionProfileSet } from "../dist/packages/runtime/src/index.js";
import { cameraProjectionProfileIdentity, canonicalJson } from "../dist/packages/contracts/src/index.js";

const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), use: "sig", alg: "ES256", key_ops: ["verify"], ext: true };
const binding = await cameraDeviceBindingSha256("fixture-device");
const identity = { schemaVersion: 1, type: "jessica.camera-projection-profile", binding: { scheme: "sha256-media-device-id-v1", deviceIdSha256: binding }, stream: { widthPx: 1280, heightPx: 720, aspectRatio: 1280 / 720, facingMode: "user", orientation: "landscape" }, intrinsics: { fxPx: 800, fyPx: 790, cxPx: 635, cyPx: 358 }, distortionModel: "none", display: { objectFit: "cover", objectPosition: "center", mirrorMode: "css-compositor-x" }, calibrationArtifact: { sha256: "a".repeat(64), byteLength: 123 }, authority: { class: "production", authorityId: "test-projection-authority", provenance: "physical-camera-calibration" }, issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z" };
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(identity)));
const profileSha256 = Buffer.from(digest).toString("hex");
const unsigned = { ...identity, profileId: `cppv1_${profileSha256}`, profileSha256 };
const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(canonicalJson(unsigned)))).toString("base64");
const PROJECTION_SET = await verifyCameraProjectionProfileSet([{ ...unsigned, signature: { algorithm: "ES256", keyId: "test-key", signatureBase64: signature } }], { trustedKeys: { "test-key": { authorityId: "test-projection-authority", authorityClass: "production", publicJwk } }, nowEpochMs: Date.parse("2026-01-01T01:00:00Z"), maximumClockSkewMs: 1000, maximumProfileLifetimeMs: 172800000, maximumProfileAgeMs: 172800000 });
const EVIDENCE = { trackSettings: { width: 1280, height: 720, aspectRatio: 1280 / 720, facingMode: "user", deviceId: "fixture-device", resizeMode: "none", zoom: 1, pan: 0, tilt: 0 }, videoSize: { width: 1280, height: 720 } };
const PROJECTION = await resolveCameraProjection(PROJECTION_SET, EVIDENCE, Date.parse("2026-01-01T01:00:00Z"));
const DEFAULT_NOW = Date.parse("2026-01-01T01:00:00Z");
const DEFAULT_ADMISSION_DEADLINE = Date.parse("2026-01-01T23:00:00Z");

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
  evidence = EVIDENCE;
  projectionEvidence() { return this.evidence; }

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
    preflight: async (signal) => {
      const asset = overrides.preflight ? await overrides.preflight(signal) : (preflightCalls += 1, {});
      if (asset?.asset && asset?.projectionProfileSet) return asset;
      return { asset, projectionProfileSet: PROJECTION_SET, admissionDeadlineEpochMs: overrides.admissionDeadlineEpochMs ?? DEFAULT_ADMISSION_DEADLINE };
    },
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
    resolveProjection: overrides.resolveProjection ?? (async () => PROJECTION),
    calibration: overrides.calibration ?? (() => cameraCalibrationFromProjection(PROJECTION, { width: 390, height: 844 })),
    nowEpochMs: overrides.nowEpochMs ?? (() => DEFAULT_NOW),
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

test("projection expiry while camera permission is pending stops camera before runtime construction", async () => {
  const pending = deferred(); const camera = new FakeCamera(); camera.startImplementation = () => pending.promise;
  let now = Date.parse("2026-01-01T01:00:00Z"); let constructed = 0;
  const h = harness({ camera, resolveProjection: (set, source) => resolveCameraProjection(set, source, now), createRuntime: () => { constructed += 1; return new FakeRuntime(); } });
  const starting = h.coordinator.start(); await new Promise((resolve) => setImmediate(resolve));
  now = PROJECTION_SET.admissionDeadlineEpochMs; pending.resolve({ state: "active", message: "active" });
  const result = await starting;
  assert.equal(result.errorCode, "CAMERA_PROJECTION_UNAVAILABLE"); assert.equal(constructed, 0); assert.ok(camera.stops > 0); assert.equal(h.raf.callbacks.size, 0);
});

test("source drift while projection resolution is pending prevents runtime construction", async () => {
  const pending = deferred(); const camera = new FakeCamera(); let constructions = 0;
  const h = harness({
    camera,
    resolveProjection: () => pending.promise,
    createRuntime: () => { constructions += 1; return new FakeRuntime(); },
  });
  const starting = h.coordinator.start(); await new Promise((resolve) => setImmediate(resolve));
  camera.evidence = { ...EVIDENCE, trackSettings: { ...EVIDENCE.trackSettings, zoom: 2 } };
  pending.resolve(PROJECTION);
  const result = await starting;
  assert.equal(result.errorCode, "CAMERA_PROJECTION_UNAVAILABLE");
  assert.equal(constructions, 0); assert.equal(h.raf.callbacks.size, 0); assert.ok(camera.stops > 0);
});

test("Deployment freshness expiring during camera permission fails at the exact runtime-admission boundary", async () => {
  const pending = deferred(); const camera = new FakeCamera(); camera.startImplementation = () => pending.promise;
  const deadline = DEFAULT_NOW + 1_000; let now = DEFAULT_NOW; let constructions = 0;
  const h = harness({
    camera, admissionDeadlineEpochMs: deadline, nowEpochMs: () => now,
    createRuntime: () => { constructions += 1; return new FakeRuntime(); },
  });
  const starting = h.coordinator.start(); await new Promise((resolve) => setImmediate(resolve));
  now = deadline; pending.resolve({ state: "active", message: "active" });
  const result = await starting;
  assert.equal(result.errorCode, "ASSET_PREFLIGHT_FAILED");
  assert.equal(result.message, APPLICATION_ERROR_MESSAGES.ASSET_PREFLIGHT_FAILED);
  assert.equal(constructions, 0); assert.equal(h.raf.callbacks.size, 0); assert.ok(camera.stops > 0);
});

test("public-live rejects fixture projection and calibration-owner substitution before runtime construction", async () => {
  const fixture = await createSyntheticFixtureCameraProjection({ widthPx: 1280, heightPx: 720, fxPx: 800, fyPx: 790, cxPx: 635, cyPx: 358 });
  for (const overrides of [
    { resolveProjection: async () => fixture },
    { calibration: () => cameraCalibrationFromProjection(fixture, { width: 390, height: 844 }) },
  ]) {
    let constructions = 0;
    const h = harness({ ...overrides, createRuntime: () => { constructions += 1; return new FakeRuntime(); } });
    const result = await h.coordinator.start();
    assert.equal(result.errorCode, "CAMERA_PROJECTION_UNAVAILABLE");
    assert.equal(constructions, 0);
    assert.ok(h.camera.stops > 0);
  }
});

test("post-admission source and optical drift fail closed even on a no-face frame", async () => {
  for (const evidence of [
    { ...EVIDENCE, videoSize: { width: 640, height: 360 } },
    { ...EVIDENCE, trackSettings: { ...EVIDENCE.trackSettings, zoom: 2 } },
  ]) {
    const camera = new FakeCamera();
    const runtime = new FakeRuntime();
    runtime.processImplementation = async () => view("lost");
    const h = harness({ camera, createRuntime: () => runtime });
    await h.coordinator.start();
    camera.evidence = evidence;
    h.raf.fire();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.coordinator.status.errorCode, "CAMERA_PROJECTION_UNAVAILABLE");
    assert.equal(runtime.processCalls, 0);
    assert.equal(runtime.disposeCalls, 1);
    assert.ok(camera.stops > 0);
  }
});

test("viewport resize atomically supplies a new same-projection calibration snapshot", async () => {
  const viewport = { width: 390, height: 844 };
  const seen = [];
  const runtime = new FakeRuntime();
  runtime.process = async function process(_frame, calibration) { this.processCalls += 1; seen.push(calibration); return view("lost"); };
  const h = harness({
    calibration: () => cameraCalibrationFromProjection(PROJECTION, viewport),
    createRuntime: () => runtime,
  });
  await h.coordinator.start();
  h.raf.fire(); await new Promise((resolve) => setImmediate(resolve));
  viewport.width = 844; viewport.height = 390;
  h.raf.fire(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.phase, "running");
  assert.deepEqual(seen.map(({ viewportSize }) => viewportSize), [{ width: 390, height: 844 }, { width: 844, height: 390 }]);
  assert.notEqual(seen[0], seen[1]);
  assert.equal(seen[0].projectionIdentity.profileId, seen[1].projectionIdentity.profileId);
});

test("source drift during inference is rejected by the runtime lease before render", async () => {
  const pending = deferred(); const camera = new FakeCamera(); let renders = 0;
  const h = harness({
    camera,
    createRuntime: ({ sourceGuard }) => ({
      async initialize() {},
      async process() { await pending.promise; if (!sourceGuard()) throw new Error("source changed"); renders += 1; return view(); },
      async dispose() {},
    }),
  });
  await h.coordinator.start(); h.raf.fire();
  camera.evidence = { ...EVIDENCE, trackSettings: { ...EVIDENCE.trackSettings, zoom: 2 } };
  pending.resolve(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 0);
  assert.equal(h.coordinator.status.errorCode, "CAMERA_PROJECTION_UNAVAILABLE");
  assert.ok(camera.stops > 0);
});

test("runtime watchdog source-invalid callback terminalizes while inference remains pending", async () => {
  const camera = new FakeCamera(); const never = deferred(); let callbacks;
  const h = harness({ camera, createRuntime: (next) => {
    callbacks = next;
    return { async initialize() {}, process: () => never.promise, async dispose() {} };
  } });
  await h.coordinator.start(); h.raf.fire();
  camera.evidence = { ...EVIDENCE, videoSize: { width: 640, height: 360 } };
  callbacks.onSourceInvalid(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.errorCode, "CAMERA_PROJECTION_UNAVAILABLE");
  assert.ok(camera.stops > 0); assert.equal(h.raf.callbacks.size, 0);
  never.resolve(view()); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.coordinator.status.errorCode, "CAMERA_PROJECTION_UNAVAILABLE");
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
