import assert from "node:assert/strict";
import test from "node:test";

import { TrackingFrameDroppedError, WorkerFaceTrackingBackend, protocolEnvelope } from "../dist/packages/face-tracking/src/index.js";

const origin = "https://tryon.example";
const resources = {
  tasksVisionVersion: "1.0.1", visionModuleUrl: `${origin}/runtime/mediapipe/1.0.1/vision_bundle.mjs`,
  wasmBaseUrl: `${origin}/runtime/mediapipe/1.0.1/wasm`, modelAssetUrl: `${origin}/runtime/mediapipe/face_landmarker.task`,
  modelSha256: "a".repeat(64), modelByteLength: 100, allowedOrigin: origin, delegate: "GPU",
};

class FakeWorker {
  listeners = { message: new Set(), error: new Set(), messageerror: new Set() };
  posts = []; terminated = 0; throwOnPost = false;
  postMessage(message, transfer = []) { if (this.throwOnPost) throw new Error("post failed"); this.posts.push({ message, transfer }); }
  terminate() { this.terminated += 1; }
  addEventListener(type, listener) { this.listeners[type].add(listener); }
  removeEventListener(type, listener) { this.listeners[type].delete(listener); }
  emit(data) { for (const listener of this.listeners.message) listener({ data }); }
  crash() { for (const listener of this.listeners.error) listener(new Event("error")); }
}

function fakeClock() {
  let now = 0, id = 0; const tasks = new Map();
  return {
    scheduler: { setTimeout(callback, delay) { const key = ++id; tasks.set(key, { at: now + delay, callback }); return key; }, clearTimeout(key) { tasks.delete(key); } },
    advance(ms) { now += ms; for (const [key, task] of [...tasks]) if (task.at <= now) { tasks.delete(key); task.callback(); } },
  };
}

function bitmap(label) { return { label, width: 640, height: 480, closes: 0, close() { this.closes += 1; } }; }
function diagnostics(generation = 1, resourceOrigins = [origin]) { return { workerGeneration: generation, initializedAtMs: 0, resourceOrigins, framesReceived: 0, resultsSent: 0, noFaceSent: 0, errorsSent: 0, lastTimestampUs: null }; }
function response(kind, extra = {}, generation = 1, sessionId = "session") { return { ...protocolEnvelope(sessionId, generation), kind, ...extra, diagnostics: diagnostics(generation) }; }
function tracking(timestampUs) {
  return { timestampSeconds: timestampUs / 1e6, confidence: 0.9, landmarks: Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })), facialTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], imageSize: { width: 640, height: 480 } };
}
function harness(overrides = {}) {
  const workers = []; const made = [];
  const clock = overrides.clock ?? fakeClock();
  const backend = new WorkerFaceTrackingBackend({ workerUrl: `${origin}/src/tracking.worker.js`, resources, initializeTimeoutMs: 50, inferenceTimeoutMs: 300, disposeTimeoutMs: 10, scheduler: clock.scheduler, sessionIdFactory: () => "session", workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, createTransferable: overrides.createTransferable ?? (async (_, index = made.length) => { const value = bitmap(String(index)); made.push(value); return value; }) });
  return { backend, workers, made, clock };
}
async function ready(h) { const starting = h.backend.initialize(); h.workers[0].emit(response("ready")); await starting; }
async function ticks() { await Promise.resolve(); await Promise.resolve(); }

test("handshake succeeds only for the current generation and origin-audited diagnostics", async () => {
  const h = harness(); const starting = h.backend.initialize();
  h.workers[0].emit(response("ready", {}, 1, "stale"));
  h.workers[0].emit({ ...response("ready"), diagnostics: diagnostics(1, ["https://evil.example"]) });
  await assert.rejects(starting, /diagnostics violated/);
  assert.equal(h.workers[0].terminated, 1);
});

test("init error, timeout, crash, and malformed response terminate fail closed", async () => {
  for (const mode of ["error", "timeout", "crash", "malformed"]) {
    const h = harness(); const starting = h.backend.initialize();
    if (mode === "error") h.workers[0].emit(response("error", { phase: "initialize", code: "initialization-failed", message: "bad model", fatal: true }));
    if (mode === "timeout") h.clock.advance(50);
    if (mode === "crash") h.workers[0].crash();
    if (mode === "malformed") h.workers[0].emit({ nonsense: true });
    await assert.rejects(starting);
    assert.equal(h.workers[0].terminated, 1);
  }
});

test("one inference is in flight and only the latest queued frame survives", async () => {
  const h = harness(); await ready(h);
  const p1 = h.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  const p2 = h.backend.detect({ source: {}, timestampSeconds: 2 }); await ticks();
  const p3 = h.backend.detect({ source: {}, timestampSeconds: 3 }); const dropped = assert.rejects(p2, TrackingFrameDroppedError); await ticks();
  assert.equal(h.workers[0].posts.filter((post) => post.message.kind === "frame").length, 1);
  assert.equal(h.made[1].closes, 1);
  h.workers[0].emit(response("result", { requestId: 1, timestampUs: 1_000_000, result: tracking(1_000_000) }));
  assert.equal((await p1).timestampSeconds, 1); await ticks();
  assert.equal(h.workers[0].posts.filter((post) => post.message.kind === "frame").length, 2);
  h.workers[0].emit(response("no-face", { requestId: 3, timestampUs: 3_000_000 }));
  assert.equal(await p3, null); await dropped;
  assert.equal(h.backend.diagnostics().droppedFrames, 1);
});

test("deferred bitmap completion cannot reorder submitted timestamps", async () => {
  const deferred = [];
  const h = harness({ createTransferable: () => new Promise((resolve) => deferred.push(resolve)) }); await ready(h);
  const p1 = h.backend.detect({ source: {}, timestampSeconds: 1 });
  const p2 = h.backend.detect({ source: {}, timestampSeconds: 2 });
  const second = bitmap("second"); deferred[1](second); await ticks();
  assert.equal(h.workers[0].posts.filter((post) => post.message.kind === "frame").length, 0);
  deferred[0](bitmap("first")); await ticks();
  assert.equal(h.workers[0].posts.at(-1).message.timestampUs, 1_000_000);
  h.workers[0].emit(response("no-face", { requestId: 1, timestampUs: 1_000_000 })); await p1; await ticks();
  assert.equal(h.workers[0].posts.at(-1).message.timestampUs, 2_000_000);
  h.workers[0].emit(response("no-face", { requestId: 2, timestampUs: 2_000_000 })); await p2;
});

test("post failure closes on main; successful transfer is never closed on main", async () => {
  const h = harness(); await ready(h); h.workers[0].throwOnPost = true;
  await assert.rejects(h.backend.detect({ source: {}, timestampSeconds: 1 }), /post failed/);
  assert.equal(h.made[0].closes, 1); assert.equal(h.workers[0].terminated, 1);

  const ok = harness(); await ready(ok); const pending = ok.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  ok.workers[0].emit(response("no-face", { requestId: 1, timestampUs: 1_000_000 })); await pending;
  assert.equal(ok.made[0].closes, 0, "ownership moved to Worker after postMessage");
});

test("inference timeout terminates, closes untransferred latest frame, and can restart", async () => {
  const h = harness(); await ready(h);
  const first = h.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  const latest = h.backend.detect({ source: {}, timestampSeconds: 2 }); await ticks();
  h.clock.advance(300);
  await assert.rejects(first, /timed out/); await assert.rejects(latest, /timed out/);
  assert.equal(h.made[1].closes, 1); assert.equal(h.workers[0].terminated, 1); assert.equal(h.backend.diagnostics().inferenceTimeouts, 1);
  const restarting = h.backend.initialize(); h.workers[1].emit(response("ready", {}, 2)); await restarting;
  assert.equal(h.backend.diagnostics().generation, 2);
});

test("explicit restart disposes the old Worker and handshakes a new generation", async () => {
  const h = harness(); await ready(h);
  const restarting = h.backend.restart();
  h.workers[0].emit(response("disposed"));
  await ticks();
  assert.equal(h.workers.length, 2);
  h.workers[1].emit(response("ready", {}, 2));
  await restarting;
  assert.equal(h.workers[0].terminated, 1);
  assert.equal(h.backend.diagnostics().generation, 2);
  assert.equal(h.backend.diagnostics().state, "ready");
});

test("stale results are suppressed; mismatched and malformed current results fail closed", async () => {
  const h = harness(); await ready(h); const pending = h.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  h.workers[0].emit(response("result", { requestId: 1, timestampUs: 1_000_000, result: tracking(1_000_000) }, 2));
  h.workers[0].emit(response("result", { requestId: 99, timestampUs: 1_000_000, result: tracking(1_000_000) }));
  await assert.rejects(pending, /ordering mismatch/); assert.equal(h.workers[0].terminated, 1);
});

test("dispose during init/detect and worker crash reject pending work and terminate", async () => {
  const duringInit = harness(); const init = duringInit.backend.initialize(); const disposing = duringInit.backend.dispose();
  duringInit.workers[0].emit(response("disposed")); await disposing; await assert.rejects(init, /cancelled/); assert.equal(duringInit.workers[0].terminated, 1);

  const duringDetect = harness(); await ready(duringDetect); const pending = duringDetect.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  duringDetect.workers[0].crash(); await assert.rejects(pending, /crashed/); assert.equal(duringDetect.workers[0].terminated, 1);

  const disposedDetect = harness(); await ready(disposedDetect); const detecting = disposedDetect.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  const stop = disposedDetect.backend.dispose(); disposedDetect.workers[0].emit(response("disposed")); await stop;
  await assert.rejects(detecting, /disposed/); assert.equal(disposedDetect.workers[0].terminated, 1);
});

test("timestamps are strictly monotonic before transfer creation", async () => {
  const h = harness(); await ready(h); const first = h.backend.detect({ source: {}, timestampSeconds: 1 }); await ticks();
  await assert.rejects(h.backend.detect({ source: {}, timestampSeconds: 1 }), /strictly increasing/);
  assert.equal(h.made.length, 1);
  h.workers[0].emit(response("no-face", { requestId: 1, timestampUs: 1_000_000 })); await first;
});

test("constructor rejects unsupported or cross-origin production resources without fallback", () => {
  assert.throws(() => new WorkerFaceTrackingBackend({ workerUrl: "https://evil.example/worker.js", resources, workerFactory: () => new FakeWorker(), createTransferable: async () => bitmap("x") }), /same origin/);
  assert.throws(() => new WorkerFaceTrackingBackend({ workerUrl: `${origin}/worker.js`, resources: { ...resources, tasksVisionVersion: "2.0.0" }, workerFactory: () => new FakeWorker(), createTransferable: async () => bitmap("x") }), /version pin/);
});

test("invalid sessions and unexpected lifecycle responses fail before unsafe reuse", async () => {
  let factories = 0;
  const invalid = new WorkerFaceTrackingBackend({ workerUrl: `${origin}/worker.js`, resources, sessionIdFactory: () => "", workerFactory: () => { factories += 1; return new FakeWorker(); }, createTransferable: async () => bitmap("x") });
  await assert.rejects(invalid.initialize(), /sessionIdFactory/); assert.equal(factories, 0);

  const h = harness(); const starting = h.backend.initialize(); h.workers[0].emit(response("disposed"));
  await assert.rejects(starting, /unexpected.*disposed/); assert.equal(h.workers[0].terminated, 1);
});
