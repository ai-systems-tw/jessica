import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LOW_VISION_COUNTDOWN_SECONDS,
  LowVisionCaptureController,
  createLowVisionCaptureIntegration,
  initialLowVisionState,
  parseLowVisionCaptureResult,
  parseLowVisionState,
  reduceLowVisionState,
  serializeLowVisionState,
} from "../dist/packages/low-vision-ux/src/index.js";
import { safeParseCommerceEvent, safeParseWidgetEvent } from "../dist/packages/contracts/src/index.js";

class FakeTimer {
  now = 0;
  nextId = 0;
  tasks = [];
  clearedCallbacks = [];

  set(delayMs, callback) {
    const task = { id: ++this.nextId, at: this.now + delayMs, callback, cleared: false };
    this.tasks.push(task);
    return task;
  }

  clear(task) {
    task.cleared = true;
    this.clearedCallbacks.push(task.callback);
  }

  advance(milliseconds) {
    const end = this.now + milliseconds;
    for (;;) {
      const next = this.tasks.filter((task) => !task.cleared && task.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      next.cleared = true;
      this.now = next.at;
      next.callback();
    }
    this.now = end;
  }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const reviewResult = (suffix = "one", hooks = {}) => ({
  captureRef: `local-capture:${suffix}`,
  review: { show: hooks.show ?? (() => undefined), dispose: hooks.dispose ?? (() => undefined) },
});

function harness(overrides = {}) {
  const timer = overrides.timer ?? new FakeTimer();
  const captures = [];
  const states = [];
  const capture = overrides.capture ?? (async (signal) => { captures.push(signal); return reviewResult(`capture-${captures.length}`); });
  const controller = new LowVisionCaptureController({
    timer,
    capture: { capture },
    audio: overrides.audio,
    integration: overrides.integration,
    reducedMotion: overrides.reducedMotion,
    onState: (state, review) => states.push({ state, review }),
  });
  controller.setAvailable(true);
  return { controller, timer, captures, states };
}

test("pure state reducer exposes explicit fail-closed phases", () => {
  const unavailable = initialLowVisionState(true);
  assert.deepEqual(unavailable, { phase: "unavailable", countdown: null, audio: "disabled", reducedMotion: true, failure: null });
  const ready = reduceLowVisionState(unavailable, { type: "availability", available: true });
  const countdown = reduceLowVisionState(ready, { type: "start" });
  assert.equal(countdown.phase, "countdown");
  assert.equal(countdown.countdown, LOW_VISION_COUNTDOWN_SECONDS);
  assert.equal(reduceLowVisionState(countdown, { type: "captured" }), countdown, "out-of-order capture result must be inert");
  assert.equal(reduceLowVisionState(countdown, { type: "tick", countdown: 1 }), countdown, "3 to 1 must be rejected");
  const two = reduceLowVisionState(countdown, { type: "tick", countdown: 2 });
  assert.equal(reduceLowVisionState(two, { type: "tick", countdown: 2 }), two, "repeated tick must be inert");
  const one = reduceLowVisionState(two, { type: "tick", countdown: 1 });
  assert.equal(reduceLowVisionState(one, { type: "tick", countdown: 2 }), one, "countdown must not move backward");
  const destroyed = reduceLowVisionState(countdown, { type: "destroy" });
  assert.equal(reduceLowVisionState(destroyed, { type: "availability", available: true }), destroyed);
});

test("3-2-1 boundaries are exact and produce one capture", async () => {
  const h = harness();
  h.controller.start();
  assert.equal(h.controller.view.countdown, 3);
  h.timer.advance(999); assert.equal(h.controller.view.countdown, 3);
  h.timer.advance(1); assert.equal(h.controller.view.countdown, 2);
  h.timer.advance(999); assert.equal(h.controller.view.countdown, 2);
  h.timer.advance(1); assert.equal(h.controller.view.countdown, 1);
  h.timer.advance(999); assert.equal(h.controller.view.phase, "countdown");
  h.timer.advance(1); assert.equal(h.controller.view.phase, "capturing");
  await flush();
  assert.equal(h.controller.view.phase, "review");
  assert.equal(h.captures.length, 1);
  h.timer.advance(10_000);
  assert.equal(h.captures.length, 1);
});

test("audio is opt-in, disabled means no playback, and failure is non-fatal", async () => {
  const calls = [];
  const h = harness({ audio: { async playCount(count) { calls.push(count); if (count === 2) throw new Error("autoplay denied"); } } });
  h.controller.start();
  h.timer.advance(1_000);
  assert.deepEqual(calls, []);
  h.controller.cancel();
  h.controller.setAudioEnabled(true);
  h.controller.start();
  assert.deepEqual(calls, [3]);
  h.timer.advance(1_000);
  await flush();
  assert.deepEqual(calls, [3, 2]);
  assert.equal(h.controller.view.audio, "unavailable");
  h.timer.advance(2_000);
  await flush();
  assert.equal(h.controller.view.phase, "review");
});

test("cancel invalidates stale timers and supports restart", async () => {
  const h = harness();
  h.controller.start();
  h.timer.advance(1_000);
  h.controller.cancel();
  assert.equal(h.controller.view.phase, "ready");
  for (const callback of h.timer.clearedCallbacks) callback();
  await flush();
  assert.equal(h.captures.length, 0);
  h.controller.start();
  h.timer.advance(3_000);
  await flush();
  assert.equal(h.captures.length, 1);
});

test("duplicate timer callbacks are one-shot and cannot produce multiple captures", async () => {
  const callbacks = [];
  const timer = { set(_delay, callback) { callbacks.push(callback); return callback; }, clear() {} };
  const h = harness({ timer });
  h.controller.start();
  callbacks[0](); callbacks[0]();
  assert.equal(h.controller.view.countdown, 2);
  callbacks[1](); callbacks[1]();
  assert.equal(h.controller.view.countdown, 1);
  callbacks[2](); callbacks[2]();
  await flush();
  assert.equal(h.captures.length, 1);
  assert.equal(h.controller.view.phase, "review");
});

test("synchronous reentrant timers fail closed without capturing", async () => {
  let callbacks = 0;
  const timer = { set(_delay, callback) { callbacks += 1; callback(); return callbacks; }, clear() {} };
  const h = harness({ timer });
  h.controller.start();
  await flush();
  assert.equal(callbacks, 1);
  assert.equal(h.captures.length, 0);
  assert.equal(h.controller.view.phase, "ready");
});

test("page hide pauses countdown and availability explicitly restarts it", async () => {
  const h = harness();
  h.controller.start();
  h.timer.advance(2_000);
  h.controller.pageHidden();
  assert.equal(h.controller.view.phase, "paused");
  h.timer.advance(5_000);
  await flush();
  assert.equal(h.captures.length, 0);
  h.controller.setAvailable(true);
  assert.equal(h.controller.view.phase, "ready");
});

test("cancel and destroy abort in-flight capture; stale results are disposed", async () => {
  const pending = deferred();
  let signal;
  let disposed = 0;
  const h = harness({ capture: (nextSignal) => { signal = nextSignal; return pending.promise; } });
  h.controller.start();
  h.timer.advance(3_000);
  assert.equal(h.controller.view.phase, "capturing");
  h.controller.destroy();
  assert.equal(signal.aborted, true);
  assert.equal(h.controller.view.phase, "destroyed");
  pending.resolve(reviewResult("stale", { dispose: () => { disposed += 1; } }));
  await flush();
  assert.equal(disposed, 1);
  assert.equal(h.controller.view.phase, "destroyed");
});

test("review is local, supports retake, and close disposes once", async () => {
  let disposed = 0;
  const h = harness({ capture: async () => reviewResult("review", { dispose: () => { disposed += 1; } }) });
  h.controller.start(); h.timer.advance(3_000); await flush();
  assert.equal(h.controller.view.phase, "review");
  assert.ok(h.states.at(-1).review);
  h.controller.retake();
  assert.equal(h.controller.view.phase, "ready");
  assert.equal(disposed, 1);
  h.controller.start(); h.timer.advance(3_000); await flush();
  h.controller.close(); h.controller.destroy();
  assert.equal(disposed, 2);
  assert.equal(h.controller.view.phase, "destroyed");
});

test("camera availability loss disposes a live review before hiding it", async () => {
  let disposed = 0;
  const h = harness({ capture: async () => reviewResult("camera-stop", { dispose: () => { disposed += 1; } }) });
  h.controller.start(); h.timer.advance(3_000); await flush();
  assert.equal(h.controller.view.phase, "review");
  h.controller.setAvailable(false);
  assert.equal(h.controller.view.phase, "unavailable");
  assert.equal(disposed, 1);
  assert.equal(h.states.at(-1).review, null);
});

test("capture rejection and hostile result validation fail closed", async () => {
  for (const result of [
    { captureRef: "https://example.test/image.jpg", review: { show() {}, dispose() {} } },
    { captureRef: "local-capture:ok", review: { show() {}, dispose() {}, bytes: new Uint8Array() } },
    Object.create({ captureRef: "local-capture:inherited" }),
  ]) assert.throws(() => parseLowVisionCaptureResult(result));

  let accessed = false;
  const hostile = {};
  Object.defineProperty(hostile, "captureRef", { enumerable: true, get() { accessed = true; throw new Error("secret"); } });
  Object.defineProperty(hostile, "review", { enumerable: true, value: { show() {}, dispose() {} } });
  assert.throws(() => parseLowVisionCaptureResult(hostile));
  assert.equal(accessed, false);

  const h = harness({ capture: async () => hostile });
  h.controller.start(); h.timer.advance(3_000); await flush();
  assert.equal(h.controller.view.phase, "failed");
  assert.equal(h.controller.view.failure, "CAPTURE_RESULT_REJECTED");
});

test("validated review capabilities preserve their receiver", () => {
  const observations = [];
  const capability = {
    show(target) { observations.push([this, target]); },
    dispose() { observations.push([this, "disposed"]); },
  };
  const parsed = parseLowVisionCaptureResult({ captureRef: "local-capture:receiver", review: capability });
  parsed.review.show("target");
  parsed.review.dispose();
  assert.deepEqual(observations, [[capability, "target"], [capability, "disposed"]]);
});

test("capture port failure is stable and restartable", async () => {
  let attempts = 0;
  const h = harness({ capture: async () => { attempts += 1; if (attempts === 1) throw new Error("raw private failure"); return reviewResult("retry"); } });
  h.controller.start(); h.timer.advance(3_000); await flush();
  assert.equal(h.controller.view.failure, "CAPTURE_FAILED");
  assert.equal(serializeLowVisionState(h.controller.view).includes("raw private failure"), false);
  h.controller.start(); h.timer.advance(3_000); await flush();
  assert.equal(h.controller.view.phase, "review");
});

test("E1 receives the bounded local reference while E3 records occurrence only", () => {
  const widget = [];
  const commerceArguments = [];
  const integration = createLowVisionCaptureIntegration({
    emitWidgetCaptureCreated: (captureRef) => widget.push(captureRef),
    recordCommerceCaptureOccurrence: (...args) => commerceArguments.push(args),
  });
  integration.captureCreated("local-capture:opaque-one");
  integration.captureCreated("data:image/jpeg;base64,private");
  assert.deepEqual(widget, ["local-capture:opaque-one"]);
  assert.deepEqual(commerceArguments, [[]]);
});

test("E4 callbacks remain valid at the actual E1 and E3 strict contract boundaries", () => {
  const accepted = [];
  const product = {
    sku: "SKU-ONE", frameModelId: "model-one", frameVariantId: "variant-one", assetId: "asset-one", assetVersion: 1,
    deploymentId: "deployment-one", catalogSha256: "a".repeat(64), manifestSha256: "b".repeat(64), modelSha256: "c".repeat(64),
  };
  const integration = createLowVisionCaptureIntegration({
    emitWidgetCaptureCreated(captureRef) {
      const result = safeParseWidgetEvent({
        protocol: "jessica-widget", version: 1, direction: "widget-to-parent", tenantId: "tenant-one", sessionId: "session-one",
        requestId: "capture-one", replyTo: null, type: "jessica.captureCreated", payload: { captureRef },
      });
      assert.equal(result.ok, true);
      accepted.push(result.value);
    },
    recordCommerceCaptureOccurrence() {
      const result = safeParseCommerceEvent({
        schemaVersion: 1, type: "commerce.capture-created", occurredAt: "2026-08-11T00:00:00.000Z", sequence: 4,
        eventId: "commerce-four", requestId: "capture-one", tenantId: "tenant-one", siteId: "site-one",
        environment: "production", sessionId: "session-one", product, payload: {},
      });
      assert.equal(result.ok, true);
      accepted.push(result.value);
    },
  });
  integration.captureCreated("local-capture:e4-one");
  assert.equal(accepted.length, 2);
  assert.equal(JSON.stringify(accepted[0]).includes("local-capture:e4-one"), true);
  assert.equal(JSON.stringify(accepted[1]).includes("captureRef"), false);
  assert.equal(JSON.stringify(accepted[1]).includes("local-capture:e4-one"), false);
});

test("E1/E3 observer failures are isolated from one another and review", async () => {
  let commerce = 0;
  const integration = createLowVisionCaptureIntegration({
    emitWidgetCaptureCreated() { throw new Error("widget unavailable"); },
    recordCommerceCaptureOccurrence() { commerce += 1; },
  });
  const h = harness({ integration });
  h.controller.start(); h.timer.advance(3_000); await flush();
  assert.equal(commerce, 1);
  assert.equal(h.controller.view.phase, "review");
});

test("public state serialization contains no media, geometry, capture ref, or free-form telemetry", () => {
  const serialized = serializeLowVisionState({ phase: "review", countdown: null, audio: "enabled", reducedMotion: false, failure: null });
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), ["audio", "countdown", "failure", "phase", "reducedMotion"]);
  for (const forbidden of ["captureRef", "image", "bytes", "landmark", "pose", "biometric", "telemetry", "properties"]) assert.equal(serialized.includes(forbidden), false);
  assert.throws(() => serializeLowVisionState({ ...JSON.parse(serialized), captureRef: "local-capture:private" }));
  assert.throws(() => parseLowVisionState({ ...JSON.parse(serialized), countdown: 3 }));
  let accessed = false;
  const hostile = {};
  Object.defineProperty(hostile, "phase", { enumerable: true, get() { accessed = true; throw new Error("secret"); } });
  for (const [key, value] of Object.entries({ countdown: null, audio: "disabled", reducedMotion: false, failure: null })) Object.defineProperty(hostile, key, { enumerable: true, value });
  assert.throws(() => serializeLowVisionState(hostile));
  assert.equal(accessed, false);
  const symbolState = JSON.parse(serialized);
  symbolState[Symbol("private")] = true;
  assert.throws(() => serializeLowVisionState(symbolState));
});

test("static UX uses semantic controls, live regions, focus support, contrast tokens, and reduced motion", async () => {
  const html = await readFile(new URL("../apps/try-on-web/public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../apps/try-on-web/public/styles.css", import.meta.url), "utf8");
  const browserSource = await readFile(new URL("../apps/try-on-web/src/lowVisionCapture.ts", import.meta.url), "utf8");
  for (const id of ["capture-still", "cancel-capture", "capture-audio", "retake-capture", "close-review"]) {
    assert.match(html, new RegExp(`<button id="${id}"[^>]*type="button"`));
  }
  assert.match(html, /id="capture-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="capture-countdown"[^>]*role="timer"[^>]*aria-live="assertive"[^>]*aria-atomic="true"/);
  assert.match(html, /id="still-review"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby=/);
  assert.match(html, /id="still-result" alt="[^"]+"/);
  assert.match(html, /id="capture-audio"[^>]*aria-pressed="false"/);
  assert.match(css, /min-height:\s*56px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--focus:\s*#ffcf33/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /content:\s*"注意: "/, "failure must have text meaning, not color alone");
  assert.match(browserSource, /event\.key !== "Escape"/);
  assert.match(browserSource, /element\.inert = open/);
  assert.match(browserSource, /removeEventListener\("keydown", keydown\)/);
  assert.ok(browserSource.indexOf("const captureRef = captureReference()") < browserSource.indexOf("const objectUrl = URL.createObjectURL(blob)"), "capture reference failure must happen before allocating an object URL");
  assert.match(browserSource, /width \* height > 33_554_432/);
});
