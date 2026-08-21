import assert from "node:assert/strict";
import test from "node:test";
import { CalibrationSelfTestSession } from "../dist/apps/try-on-web/src/calibrationSelfTestSession.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(stage, pending) {
  const events = [];
  const runtime = {
    disposeCalls: 0,
    initialize: () => stage === "initialize" ? pending.promise : Promise.resolve(),
    async dispose() { this.disposeCalls += 1; },
  };
  const frame = { closeCalls: 0, close() { this.closeCalls += 1; } };
  const session = new CalibrationSelfTestSession({
    canvas: {},
    loadAsset: () => stage === "catalog" ? pending.promise : Promise.resolve({}),
    createRuntime: () => runtime,
    loadFrame: () => stage === "fetch" ? pending.promise : Promise.resolve(frame),
    execute: () => stage === "process" ? pending.promise : Promise.resolve({ pass: true }),
    publish: () => events.push("PASS"),
    fail: () => events.push("FAIL"),
  });
  return { session, runtime, frame, events };
}

for (const stage of ["catalog", "initialize", "fetch", "process"]) {
  test(`pagehide/destroy during delayed self-test ${stage} cannot publish or revive resources`, async () => {
    const pending = deferred();
    const h = setup(stage, pending);
    const starting = h.session.start();
    await new Promise((resolve) => setImmediate(resolve));
    await h.session.destroy();
    pending.resolve(stage === "fetch" ? h.frame : stage === "process" ? { pass: true } : {});
    await starting;
    assert.deepEqual(h.events, []);
    assert.equal(h.runtime.disposeCalls, stage === "catalog" || stage === "fetch" ? 0 : 1);
    assert.ok(h.frame.closeCalls <= 1);
    await h.session.start();
    assert.deepEqual(h.events, []);
  });
}

test("a stale self-test success callback cannot update after later stop", async () => {
  let current;
  const runtime = { async initialize() {}, async dispose() {} };
  const frame = { close() {} };
  const events = [];
  const session = new CalibrationSelfTestSession({
    canvas: {}, loadAsset: async () => ({}), createRuntime: () => runtime,
    loadFrame: async () => frame, execute: async () => ({ pass: true }),
    publish(_result, _runtime, isCurrent) { current = isCurrent; events.push("PASS"); },
    fail() { events.push("FAIL"); },
  });
  await session.start();
  assert.equal(current(), true);
  await session.stop();
  assert.equal(current(), false);
  assert.deepEqual(events, ["PASS"]);
});

test("obsolete rejected self-test cannot publish FAIL after stop during slow disposal", async () => {
  const execution = deferred();
  const disposal = deferred();
  const events = [];
  const runtime = {
    async initialize() {},
    async dispose() { await disposal.promise; },
  };
  const session = new CalibrationSelfTestSession({
    canvas: {}, loadAsset: async () => ({}), createRuntime: () => runtime,
    loadFrame: async () => ({ close() {} }), execute: () => execution.promise,
    publish() { events.push("PASS"); }, fail() { events.push("FAIL"); },
  });
  const starting = session.start();
  await new Promise((resolve) => setImmediate(resolve));
  execution.reject(new Error("raw failure"));
  await Promise.resolve();
  const stopping = session.stop();
  disposal.resolve();
  await Promise.all([starting, stopping]);
  assert.deepEqual(events, []);
});

test("stop and destroy during async fixture runtime creation dispose the stale runtime without initialize", async () => {
  for (const operation of ["stop", "destroy"]) {
    const created = deferred(); const events = [];
    const runtime = { initializeCalls: 0, disposeCalls: 0, async initialize() { this.initializeCalls += 1; }, async dispose() { this.disposeCalls += 1; } };
    const session = new CalibrationSelfTestSession({ canvas: {}, loadAsset: async () => ({}), loadFrame: async () => ({ close() {} }), createRuntime: () => created.promise, execute: async () => ({}), publish: () => events.push("PASS"), fail: () => events.push("FAIL") });
    const starting = session.start(); await new Promise((resolve) => setImmediate(resolve)); const stopping = session[operation](); created.resolve(runtime); await Promise.all([starting, stopping]);
    assert.equal(runtime.initializeCalls, 0); assert.equal(runtime.disposeCalls, 1); assert.deepEqual(events, []);
  }
});
