import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseWidgetCommand, parseWidgetEvent, safeParseWidgetCommand, safeParseWidgetEvent, WIDGET_MAX_SESSION_MESSAGES } from "../dist/packages/contracts/src/index.js";
import { ParentWidgetHost, WidgetBridge } from "../dist/packages/widget-host/src/index.js";

const baseCommand = { protocol: "jessica-widget", version: 1, direction: "parent-to-widget", tenantId: "tenant-1", sessionId: "session-1", requestId: "p-1", replyTo: null };
const baseEvent = { protocol: "jessica-widget", version: 1, direction: "widget-to-parent", tenantId: "tenant-1", sessionId: "session-1", requestId: "w-1", replyTo: "p-1" };

test("camera-free protocol transcript remains strict and contains no prohibited media material", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/widget/camera-free-protocol-flow.json", import.meta.url), "utf8"));
  assert.equal(fixture.messages.length, 8);
  for (const message of fixture.messages) {
    if (message.direction === "parent-to-widget") parseWidgetCommand(message); else parseWidgetEvent(message);
  }
  assert.doesNotMatch(JSON.stringify(fixture), /biometric|landmark|data:image|base64|video|imageData|blob|bytes/i);
});

test("WidgetProtocol v1 accepts only exact commands, versions, fields, and correlation shape", () => {
  assert.equal(parseWidgetCommand({ ...baseCommand, type: "jessica.init", payload: { skuId: "sku/black-1" } }).type, "jessica.init");
  assert.equal(parseWidgetCommand({ ...baseCommand, type: "jessica.open", payload: {} }).type, "jessica.open");
  assert.equal(parseWidgetCommand({ ...baseCommand, type: "jessica.close", payload: { reason: "parent-request" } }).type, "jessica.close");
  assert.equal(parseWidgetCommand({ ...baseCommand, type: "jessica.skuChange", payload: { skuId: "sku-2" } }).type, "jessica.skuChange");
  assert.throws(() => parseWidgetCommand({ ...baseCommand, version: 2, type: "jessica.open", payload: {} }), /protocol\/version/);
  assert.throws(() => parseWidgetCommand({ ...baseCommand, type: "jessica.unknown", payload: {} }), /unknown widget command/);
  assert.throws(() => parseWidgetCommand({ ...baseCommand, extra: true, type: "jessica.open", payload: {} }), /unknown field/);
  assert.throws(() => parseWidgetCommand({ ...baseCommand, replyTo: "old", type: "jessica.open", payload: {} }), /replyTo must be null/);
  assert.throws(() => parseWidgetCommand({ ...baseCommand, requestId: "x".repeat(65), type: "jessica.open", payload: {} }), /bounded identifier/);
});

test("WidgetProtocol rejects prototype, accessor, cycle, nonfinite, excessive depth, and size", () => {
  const valid = { ...baseCommand, type: "jessica.open", payload: {} };
  const polluted = Object.assign(Object.create({ inherited: true }), valid);
  assert.throws(() => parseWidgetCommand(polluted), /plain records/);
  const accessor = { ...valid };
  Object.defineProperty(accessor, "payload", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => parseWidgetCommand(accessor), /accessors/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => parseWidgetCommand({ ...valid, payload: cycle }), /cycle/);
  assert.throws(() => parseWidgetEvent({ ...baseEvent, type: "jessica.cartRequested", payload: { skuId: "sku", quantity: Infinity } }), /finite/);
  let deep = {}; for (let index = 0; index < 10; index += 1) deep = { child: deep };
  assert.throws(() => parseWidgetCommand({ ...valid, payload: deep }), /depth/);
  assert.throws(() => parseWidgetCommand({ ...valid, payload: { items: Array.from({ length: 130 }, () => ({})) } }), /maximum size/);
  assert.throws(() => parseWidgetEvent({ ...baseEvent, type: "jessica.error", payload: { code: "INTERNAL_FAILURE", class: "internal", recoverable: false, message: "x".repeat(5000) } }), /string size/);
});

test("safe WidgetProtocol APIs never throw or disclose malformed getter, cycle, prototype, or field details", () => {
  const command = { ...baseCommand, type: "jessica.open", payload: {} };
  const accessor = { ...command };
  Object.defineProperty(accessor, "payload", { enumerable: true, get() { throw new Error("/private/path secret-field"); } });
  const cycle = {}; cycle.self = cycle;
  const customPrototype = Object.assign(Object.create({ privatePath: "/private/path" }), command);
  for (const malformed of [accessor, { ...command, payload: cycle }, customPrototype]) {
    let result;
    assert.doesNotThrow(() => { result = safeParseWidgetCommand(malformed); });
    assert.deepEqual(result, { ok: false, error: { code: "WIDGET_COMMAND_REJECTED", message: "Widget command rejected" } });
  }
  let eventResult;
  assert.doesNotThrow(() => { eventResult = safeParseWidgetEvent({ ...baseEvent, type: "jessica.error", payload: { unknownPrivatePath: "/secret" } }); });
  assert.deepEqual(eventResult, { ok: false, error: { code: "WIDGET_EVENT_REJECTED", message: "Widget event rejected" } });
});

test("all biometric/media/geometry/raw analytics aliases are denied, including nested aliases", () => {
  const denied = ["biometricPayload", "facial_data", "videoFrame", "imageData", "rawLandmarks", "headTransform", "poseVector", "scaleEstimate", "rawAnalytics", "pixelBuffer", "data_url", "blobBytes"];
  for (const name of denied) {
    assert.throws(() => parseWidgetCommand({ ...baseCommand, type: "jessica.open", payload: { nested: { [name]: "leak" } } }), /prohibited payload field/, name);
  }
});

test("capture crosses only as bounded local opaque reference and errors are stable and sanitized", () => {
  assert.equal(parseWidgetEvent({ ...baseEvent, replyTo: null, type: "jessica.captureCreated", payload: { captureRef: "local-capture:cap_123" } }).payload.captureRef, "local-capture:cap_123");
  for (const captureRef of ["data:image/png;base64,AA", "https://widget.example/c.png", "local-capture:" + "x".repeat(100)]) {
    assert.throws(() => parseWidgetEvent({ ...baseEvent, replyTo: null, type: "jessica.captureCreated", payload: { captureRef } }), /local opaque reference/);
  }
  assert.throws(() => parseWidgetEvent({ ...baseEvent, type: "jessica.error", payload: { code: "CAMERA_DENIED", class: "internal", recoverable: true, message: "Denied" } }), /mapping/);
  for (const message of ["at /Users/alice/app.ts", "stack: controller", "token=secret", "https://internal.example/error"]) {
    assert.throws(() => parseWidgetEvent({ ...baseEvent, type: "jessica.error", payload: { code: "INTERNAL_FAILURE", class: "internal", recoverable: false, message } }), /unsafe/);
  }
});

function harness(options = {}) {
  const parentOrigin = "https://shop.example";
  const widgetOrigin = "https://widget.example";
  const parentPosts = [], widgetPosts = [], events = [], rejects = [];
  let hostListener = () => {};
  const parentWindow = { postMessage(message, targetOrigin) { parentPosts.push({ message, targetOrigin }); hostListener({ origin: widgetOrigin, source: widgetWindow, data: message }); } };
  let bridge;
  const widgetWindow = { postMessage(message, targetOrigin) { widgetPosts.push({ message, targetOrigin }); if (!options.manualWidget) bridge.receive({ origin: parentOrigin, source: parentWindow, data: message }); } };
  const iframeValues = {};
  const iframe = { contentWindow: widgetWindow, setSource(value) { iframeValues.source = value; }, setSandbox(value) { iframeValues.sandbox = value; }, setAllow(value) { iframeValues.allow = value; } };
  const eventPort = { addMessageListener(listener) { hostListener = listener; this.dispatch = listener; }, removeMessageListener() { hostListener = () => {}; this.dispatch = null; }, addPageHideListener(listener) { this.pageHide = listener; }, removePageHideListener() { this.pageHide = null; } };
  let parentId = 0, widgetId = 0;
  const controllerCalls = [];
  bridge = new WidgetBridge({ parentOrigin, parentWindow, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: options.widgetIds ?? (() => `w-${++widgetId}`), controller: {
    initialize(sku) { controllerCalls.push(["init", sku]); }, open() { if (options.throwOpen) throw new Error("/secret/path token=x"); controllerCalls.push(["open"]); },
    changeSku(sku) { controllerCalls.push(["change", sku]); }, close(reason) { controllerCalls.push(["close", reason]); },
  }, onReject: (code) => rejects.push(["widget", code]) });
  const host = new ParentWidgetHost({ widgetUrl: `${widgetOrigin}/embed/v1/widget.html`, widgetOrigin, widgetPathPrefix: "/embed/v1", tenantId: "tenant-1", sessionId: "session-1", iframe, events: eventPort, nextRequestId: options.parentIds ?? (() => `p-${++parentId}`), onEvent: (event) => { events.push(event); if (options.throwParentEvent) throw new Error("observer failed"); }, onReject: (code) => { rejects.push(["parent", code]); if (options.throwParentReject) throw new Error("observer failed"); } });
  return { host, bridge, parentWindow, widgetWindow, parentPosts, widgetPosts, events, rejects, iframeValues, eventPort, controllerCalls, parentOrigin, widgetOrigin };
}

function eventFor(h, requestId, replyTo, type, payload) {
  return { protocol: "jessica-widget", version: 1, direction: "widget-to-parent", tenantId: "tenant-1", sessionId: "session-1", requestId, replyTo, type, payload };
}

function dispatch(h, event) { h.eventPort.dispatch({ origin: h.widgetOrigin, source: h.widgetWindow, data: event }); }

test("safe init/open/change/cart/capture/close flow is exactly correlated and never uses wildcard targetOrigin", () => {
  const h = harness();
  h.host.initialize("sku-1"); assert.equal(h.host.state, "ready");
  h.host.open(); assert.equal(h.host.state, "open");
  h.bridge.cameraPermission("granted"); h.bridge.tryOnStarted();
  h.host.changeSku("sku-2"); h.bridge.captureCreated("local-capture:cap-1"); h.bridge.cartRequested(2);
  h.host.close(); assert.equal(h.host.state, "closed"); assert.equal(h.bridge.state, "closed");
  assert.deepEqual(h.controllerCalls, [["init", "sku-1"], ["open"], ["change", "sku-2"], ["close", "parent-request"]]);
  assert.deepEqual(h.events.map((event) => event.type), ["jessica.ready", "jessica.opened", "jessica.cameraPermission", "jessica.tryOnStarted", "jessica.assetChanged", "jessica.captureCreated", "jessica.cartRequested", "jessica.closed"]);
  assert.equal([...h.parentPosts, ...h.widgetPosts].some((post) => post.targetOrigin === "*"), false);
  assert.equal(h.iframeValues.sandbox, "allow-scripts allow-same-origin");
  assert.equal(h.iframeValues.allow, "camera https://widget.example");
  assert.equal(h.iframeValues.source, "https://widget.example/embed/v1/widget.html");
});

test("both sides reject wrong source/origin/tenant/session, replay, collision, and stale lifecycle", () => {
  const h = harness();
  const init = { ...baseCommand, type: "jessica.init", payload: { skuId: "sku-1" } };
  h.bridge.receive({ origin: "https://evil.example", source: h.parentWindow, data: init });
  h.bridge.receive({ origin: h.parentOrigin, source: {}, data: init });
  h.bridge.receive({ origin: h.parentOrigin, source: h.parentWindow, data: { ...init, tenantId: "other" } });
  h.host.initialize("sku-1");
  h.bridge.receive({ origin: h.parentOrigin, source: h.parentWindow, data: init });
  h.host.open();
  const boundEvent = { ...baseEvent, requestId: "bound-check", replyTo: null, type: "jessica.tryOnStarted", payload: { skuId: "sku-1" } };
  h.eventPort.dispatch({ origin: "https://evil.example", source: h.widgetWindow, data: boundEvent });
  h.eventPort.dispatch({ origin: h.widgetOrigin, source: {}, data: boundEvent });
  h.eventPort.dispatch({ origin: h.widgetOrigin, source: h.widgetWindow, data: { ...boundEvent, sessionId: "other-session" } });
  h.eventPort.dispatch({ origin: h.widgetOrigin, source: h.widgetWindow, data: { ...boundEvent, requestId: "p-1" } });
  const oldOpened = h.parentPosts.find((post) => post.message.type === "jessica.opened").message;
  const listener = h.eventPort.pageHide;
  h.parentWindow.postMessage(oldOpened, h.widgetOrigin);
  h.bridge.receive({ origin: h.parentOrigin, source: h.parentWindow, data: { ...baseCommand, requestId: "p-stale", type: "jessica.open", payload: {} } });
  assert.ok(h.rejects.some((entry) => entry[1] === "WRONG_BINDING"));
  assert.ok(h.rejects.some((entry) => entry[1] === "REPLAY"));
  assert.ok(h.rejects.some((entry) => entry[1] === "STALE_LIFECYCLE"));
  listener(); assert.equal(h.host.state, "closed");
});

test("stale valid inbound IDs remain spent across later lifecycle changes on both sides", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  dispatch(h, eventFor(h, "ready-1", initId, "jessica.ready", { capabilities: ["capture", "cart", "sku-change"] }));
  const stale = eventFor(h, "stale-event", null, "jessica.tryOnStarted", { skuId: "sku-1" });
  dispatch(h, stale);
  const openId = h.host.open();
  dispatch(h, eventFor(h, "opened-1", openId, "jessica.opened", { skuId: "sku-1" }));
  dispatch(h, stale);
  assert.equal(h.events.some((event) => event.requestId === "stale-event"), false);
  assert.deepEqual(h.rejects.slice(-2), [["parent", "STALE_LIFECYCLE"], ["parent", "REPLAY"]]);

  const posts = [], rejects = [], calls = [];
  let responseId = 0;
  const parentWindow = { postMessage(message) { posts.push(message); } };
  const bridge = new WidgetBridge({ parentOrigin: h.parentOrigin, parentWindow, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => `response-${++responseId}`, controller: { initialize(sku) { calls.push(["init", sku]); }, open() { calls.push(["open"]); }, changeSku() {}, close() {} }, onReject: (code) => rejects.push(code) });
  const staleOpen = { ...baseCommand, requestId: "stale-command", type: "jessica.open", payload: {} };
  bridge.receive({ origin: h.parentOrigin, source: parentWindow, data: staleOpen });
  bridge.receive({ origin: h.parentOrigin, source: parentWindow, data: { ...baseCommand, requestId: "init-command", type: "jessica.init", payload: { skuId: "sku-1" } } });
  bridge.receive({ origin: h.parentOrigin, source: parentWindow, data: staleOpen });
  assert.equal(bridge.state, "ready");
  assert.deepEqual(calls, [["init", "sku-1"]]);
  assert.deepEqual(rejects, ["STALE_LIFECYCLE", "REPLAY"]);
});

test("parent rolls back correlated recoverable errors for init, open, SKU change, and close from exact stable states", () => {
  const h = harness({ manualWidget: true });
  let id = h.host.initialize("sku-old");
  dispatch(h, eventFor(h, "err-init", id, "jessica.error", { code: "AUTH_REQUIRED", class: "authentication", recoverable: true, message: "Authentication required" }));
  assert.equal(h.host.state, "created");

  id = h.host.initialize("sku-current");
  dispatch(h, eventFor(h, "ready-current", id, "jessica.ready", { capabilities: ["capture", "cart", "sku-change"] }));
  id = h.host.open();
  dispatch(h, eventFor(h, "err-open", id, "jessica.error", { code: "CAMERA_DENIED", class: "permission", recoverable: true, message: "Camera denied" }));
  assert.equal(h.host.state, "ready");

  id = h.host.open();
  dispatch(h, eventFor(h, "opened-current", id, "jessica.opened", { skuId: "sku-current" }));
  id = h.host.changeSku("sku-rejected");
  dispatch(h, eventFor(h, "err-sku", id, "jessica.error", { code: "ASSET_UNAVAILABLE", class: "catalog", recoverable: true, message: "Asset unavailable" }));
  assert.equal(h.host.state, "open");
  id = h.host.close();
  dispatch(h, eventFor(h, "err-close-open", id, "jessica.error", { code: "RUNTIME_UNAVAILABLE", class: "runtime", recoverable: true, message: "Runtime unavailable" }));
  assert.equal(h.host.state, "open");

  id = h.host.close();
  dispatch(h, eventFor(h, "closed-open", id, "jessica.closed", { reason: "parent-request" }));
  const readyHost = harness({ manualWidget: true });
  id = readyHost.host.initialize("sku-ready");
  dispatch(readyHost, eventFor(readyHost, "ready-only", id, "jessica.ready", { capabilities: [] }));
  id = readyHost.host.close();
  dispatch(readyHost, eventFor(readyHost, "err-close-ready", id, "jessica.error", { code: "RUNTIME_UNAVAILABLE", class: "runtime", recoverable: true, message: "Runtime unavailable" }));
  assert.equal(readyHost.host.state, "ready");

  const fatal = harness({ manualWidget: true });
  id = fatal.host.initialize("sku-fatal");
  dispatch(fatal, eventFor(fatal, "err-fatal", id, "jessica.error", { code: "INTERNAL_FAILURE", class: "internal", recoverable: false, message: "Widget failed" }));
  assert.equal(fatal.host.state, "closed");
});

test("recoverable spontaneous errors mutate no stable state and cannot become valid after transitional rejection", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  const transitional = eventFor(h, "spontaneous-transitional", null, "jessica.error", { code: "CAMERA_DENIED", class: "permission", recoverable: true, message: "Camera denied" });
  dispatch(h, transitional); assert.equal(h.host.state, "initializing");
  dispatch(h, eventFor(h, "ready-spontaneous", initId, "jessica.ready", { capabilities: [] }));
  dispatch(h, transitional); assert.equal(h.host.state, "ready");
  const stable = eventFor(h, "spontaneous-stable", null, "jessica.error", { code: "CAMERA_DENIED", class: "permission", recoverable: true, message: "Camera denied" });
  dispatch(h, stable); assert.equal(h.host.state, "ready");
  assert.deepEqual(h.rejects.slice(-2), [["parent", "STALE_LIFECYCLE"], ["parent", "REPLAY"]]);
});

test("correlated closed reason substitution is stale, spent, and cannot close the host", () => {
  const h = harness({ manualWidget: true });
  let id = h.host.initialize("sku-1");
  dispatch(h, eventFor(h, "ready-close", id, "jessica.ready", { capabilities: [] }));
  id = h.host.open(); dispatch(h, eventFor(h, "opened-close", id, "jessica.opened", { skuId: "sku-1" }));
  const closeId = h.host.close();
  const substituted = eventFor(h, "closed-substitution", closeId, "jessica.closed", { reason: "page-hidden" });
  dispatch(h, substituted); assert.equal(h.host.state, "closing");
  dispatch(h, substituted); assert.equal(h.host.state, "closing");
  dispatch(h, eventFor(h, "closed-exact", closeId, "jessica.closed", { reason: "parent-request" }));
  assert.equal(h.host.state, "closed");
  assert.deepEqual(h.rejects.slice(-2), [["parent", "STALE_LIFECYCLE"], ["parent", "REPLAY"]]);
});

test("widget response ID collision and transport failure close without throwing or repeating controller effects", () => {
  const collisionCalls = [], collisionRejects = [], collisionPosts = [];
  const collisionParent = { postMessage(message) { collisionPosts.push(message); } };
  const collisionBridge = new WidgetBridge({ parentOrigin: "https://shop.example", parentWindow: collisionParent, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => "same-command", controller: { initialize() { collisionCalls.push("init"); }, open() {}, changeSku() {}, close() {} }, onReject: (code) => collisionRejects.push(code) });
  const collisionCommand = { ...baseCommand, requestId: "same-command", type: "jessica.init", payload: { skuId: "sku-1" } };
  assert.doesNotThrow(() => collisionBridge.receive({ origin: "https://shop.example", source: collisionParent, data: collisionCommand }));
  assert.equal(collisionBridge.state, "closed"); assert.deepEqual(collisionCalls, ["init"]); assert.deepEqual(collisionPosts, []); assert.deepEqual(collisionRejects, ["TRANSPORT_FAILURE"]);

  const transportCalls = [], transportRejects = [];
  const brokenParent = { postMessage() { throw new Error("transport down"); } };
  let transportId = 0;
  const transportBridge = new WidgetBridge({ parentOrigin: "https://shop.example", parentWindow: brokenParent, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => `transport-${++transportId}`, controller: { initialize() { transportCalls.push("init"); }, open() {}, changeSku() {}, close() {} }, onReject: (code) => transportRejects.push(code) });
  const transportCommand = { ...baseCommand, requestId: "transport-command", type: "jessica.init", payload: { skuId: "sku-1" } };
  assert.doesNotThrow(() => transportBridge.receive({ origin: "https://shop.example", source: brokenParent, data: transportCommand }));
  assert.doesNotThrow(() => transportBridge.receive({ origin: "https://shop.example", source: brokenParent, data: transportCommand }));
  assert.equal(transportBridge.state, "closed"); assert.deepEqual(transportCalls, ["init"]); assert.deepEqual(transportRejects, ["TRANSPORT_FAILURE", "REPLAY"]);
});

test("page hide during opening posts terminal close and queued opened cannot reopen", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  dispatch(h, eventFor(h, "ready-pagehide", initId, "jessica.ready", { capabilities: [] }));
  const openId = h.host.open();
  const queuedOpened = eventFor(h, "queued-opened", openId, "jessica.opened", { skuId: "sku-1" });
  h.eventPort.pageHide();
  assert.equal(h.host.state, "closed");
  const close = h.widgetPosts.at(-1).message;
  assert.equal(close.type, "jessica.close");
  assert.deepEqual(close.payload, { reason: "page-hidden" });
  dispatch(h, queuedOpened);
  assert.equal(h.host.state, "closed");
  assert.equal(h.events.some((event) => event.requestId === "queued-opened"), false);
  assert.deepEqual(h.rejects.at(-1), ["parent", "REPLAY"]);
});

test("destroy during initialization posts terminal close and queued listener callback is inert", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  const queuedListener = h.eventPort.dispatch;
  const beforeEvents = h.events.length, beforeRejects = h.rejects.length;
  h.host.destroy();
  assert.equal(h.host.state, "destroyed");
  const close = h.widgetPosts.at(-1).message;
  assert.equal(close.type, "jessica.close");
  assert.deepEqual(close.payload, { reason: "host-destroyed" });
  assert.doesNotThrow(() => queuedListener({ origin: h.widgetOrigin, source: h.widgetWindow, data: eventFor(h, "queued-ready-destroyed", initId, "jessica.ready", { capabilities: [] }) }));
  assert.equal(h.host.state, "destroyed");
  assert.equal(h.events.length, beforeEvents);
  assert.equal(h.rejects.length, beforeRejects);
});

test("widget public outbound APIs never post after closed or destroyed", () => {
  const posts = [];
  const parentWindow = { postMessage(message) { posts.push(message); } };
  let responseId = 0;
  const bridge = new WidgetBridge({ parentOrigin: "https://shop.example", parentWindow, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => `guard-${++responseId}`, controller: { initialize() {}, open() {}, changeSku() {}, close() {} } });
  bridge.receive({ origin: "https://shop.example", source: parentWindow, data: { ...baseCommand, requestId: "guard-init", type: "jessica.init", payload: { skuId: "sku-1" } } });
  bridge.receive({ origin: "https://shop.example", source: parentWindow, data: { ...baseCommand, requestId: "guard-close", type: "jessica.close", payload: { reason: "parent-request" } } });
  posts.length = 0;
  bridge.error("INTERNAL_FAILURE", "internal", false, "Widget failed");
  assert.throws(() => bridge.captureCreated("local-capture:x"), /not open/);
  assert.equal(posts.length, 0);
  bridge.destroy();
  bridge.error("INTERNAL_FAILURE", "internal", false, "Widget failed");
  assert.throws(() => bridge.cartRequested(), /not open/);
  assert.equal(posts.length, 0);
});

test("throwing parent observers cannot escape or corrupt message-listener state", () => {
  const h = harness({ manualWidget: true, throwParentEvent: true, throwParentReject: true });
  const initId = h.host.initialize("sku-1");
  assert.doesNotThrow(() => h.eventPort.dispatch({ origin: "https://evil.example", source: h.widgetWindow, data: {} }));
  assert.doesNotThrow(() => dispatch(h, eventFor(h, "ready-throwing-observer", initId, "jessica.ready", { capabilities: [] })));
  assert.equal(h.host.state, "ready");
  assert.deepEqual(h.rejects, [["parent", "WRONG_BINDING"]]);
  assert.equal(h.events.at(-1).type, "jessica.ready");
});

test("parent constructor cleans message listener when page-hide registration fails", () => {
  const target = { postMessage() {} };
  let addedMessage = null, removedMessage = null, removedPageHide = null, messageAdds = 0;
  const events = {
    addMessageListener(listener) { addedMessage = listener; messageAdds += 1; },
    removeMessageListener(listener) { removedMessage = listener; },
    addPageHideListener() { throw new Error("page-hide registration failed"); },
    removePageHideListener(listener) { removedPageHide = listener; },
  };
  const iframe = { contentWindow: target, setSource() {}, setSandbox() {}, setAllow() {} };
  assert.throws(() => new ParentWidgetHost({ widgetUrl: "https://widget.example/embed/v1/widget.html", widgetOrigin: "https://widget.example", widgetPathPrefix: "/embed/v1", tenantId: "tenant-1", sessionId: "session-1", iframe, events, nextRequestId: () => "p-1", onEvent() {} }), /page-hide registration failed/);
  assert.equal(messageAdds, 1);
  assert.equal(removedMessage, addedMessage);
  assert.equal(typeof removedPageHide, "function");

  let listenerAddsAfterSetterFailure = 0;
  const setterFailureEvents = { ...events, addMessageListener() { listenerAddsAfterSetterFailure += 1; }, addPageHideListener() {} };
  assert.throws(() => new ParentWidgetHost({ widgetUrl: "https://widget.example/embed/v1/widget.html", widgetOrigin: "https://widget.example", widgetPathPrefix: "/embed/v1", tenantId: "tenant-1", sessionId: "session-1", iframe: { ...iframe, setSource() { throw new Error("source failed"); } }, events: setterFailureEvents, nextRequestId: () => "p-1", onEvent() {} }), /source failed/);
  assert.equal(listenerAddsAfterSetterFailure, 0);
});

test("parent stale-message flood reaches a terminal bounded ledger and never accepts later IDs", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  dispatch(h, eventFor(h, "limit-ready", initId, "jessica.ready", { capabilities: [] }));
  for (let index = 0; index < WIDGET_MAX_SESSION_MESSAGES - 1; index += 1) {
    dispatch(h, eventFor(h, `limit-stale-${index}`, null, "jessica.tryOnStarted", { skuId: "sku-1" }));
  }
  assert.equal(h.host.state, "closed");
  assert.deepEqual(h.rejects.at(-1), ["parent", "MESSAGE_LIMIT"]);
  const rejects = h.rejects.length, events = h.events.length, posts = h.widgetPosts.length;
  dispatch(h, eventFor(h, "limit-after-terminal", null, "jessica.error", { code: "CAMERA_DENIED", class: "permission", recoverable: true, message: "Camera denied" }));
  assert.equal(h.rejects.length, rejects); assert.equal(h.events.length, events); assert.equal(h.widgetPosts.length, posts);
});

test("parent reserves correlated-response capacity before outbound command", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  dispatch(h, eventFor(h, "outbound-ready", initId, "jessica.ready", { capabilities: [] }));
  for (let index = 0; index < WIDGET_MAX_SESSION_MESSAGES - 3; index += 1) {
    dispatch(h, eventFor(h, `outbound-stale-${index}`, null, "jessica.tryOnStarted", { skuId: "sku-1" }));
  }
  const posts = h.widgetPosts.length;
  assert.throws(() => h.host.open(), /message limit/);
  assert.equal(h.host.state, "closed");
  assert.equal(h.widgetPosts.length, posts);
  assert.deepEqual(h.rejects.at(-1), ["parent", "MESSAGE_LIMIT"]);
});

test("widget stale inbound and outbound floods terminate at the shared message budget", () => {
  const inboundPosts = [], inboundRejects = [], inboundCalls = [];
  const inboundParent = { postMessage(message) { inboundPosts.push(message); } };
  let responseId = 0;
  const inboundBridge = new WidgetBridge({ parentOrigin: "https://shop.example", parentWindow: inboundParent, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => `limit-response-${++responseId}`, controller: { initialize() { inboundCalls.push("init"); }, open() { inboundCalls.push("open"); }, changeSku() { inboundCalls.push("change"); }, close() { inboundCalls.push("close"); } }, onReject: (code) => inboundRejects.push(code) });
  for (let index = 0; index < WIDGET_MAX_SESSION_MESSAGES + 1; index += 1) {
    inboundBridge.receive({ origin: "https://shop.example", source: inboundParent, data: { ...baseCommand, requestId: `limit-command-${index}`, type: "jessica.open", payload: {} } });
  }
  assert.equal(inboundBridge.state, "closed"); assert.deepEqual(inboundCalls, []); assert.deepEqual(inboundPosts, []); assert.equal(inboundRejects.at(-1), "MESSAGE_LIMIT");
  const inboundRejectCount = inboundRejects.length;
  inboundBridge.receive({ origin: "https://shop.example", source: inboundParent, data: { ...baseCommand, requestId: "limit-valid-after", type: "jessica.init", payload: { skuId: "sku-1" } } });
  assert.equal(inboundRejects.length, inboundRejectCount); assert.deepEqual(inboundCalls, []); assert.deepEqual(inboundPosts, []);

  const outboundPosts = [], outboundRejects = [], outboundCalls = [];
  const outboundParent = { postMessage(message) { outboundPosts.push(message); } };
  let outboundId = 0;
  const outboundBridge = new WidgetBridge({ parentOrigin: "https://shop.example", parentWindow: outboundParent, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => `outbound-event-${++outboundId}`, controller: { initialize() { outboundCalls.push("init"); }, open() { outboundCalls.push("open"); }, changeSku() { outboundCalls.push("change"); }, close() { outboundCalls.push("close"); } }, onReject: (code) => outboundRejects.push(code) });
  for (let index = 0; index < WIDGET_MAX_SESSION_MESSAGES; index += 1) outboundBridge.error("CAMERA_DENIED", "permission", true, "Camera denied");
  assert.equal(outboundPosts.length, WIDGET_MAX_SESSION_MESSAGES);
  outboundBridge.error("CAMERA_DENIED", "permission", true, "Camera denied");
  assert.equal(outboundBridge.state, "closed"); assert.equal(outboundPosts.length, WIDGET_MAX_SESSION_MESSAGES); assert.deepEqual(outboundCalls, []); assert.deepEqual(outboundRejects, ["MESSAGE_LIMIT"]);
  outboundBridge.error("CAMERA_DENIED", "permission", true, "Camera denied");
  assert.equal(outboundPosts.length, WIDGET_MAX_SESSION_MESSAGES); assert.deepEqual(outboundCalls, []);
});

test("malformed and wrong-binding floods do not consume either replay ledger", () => {
  const h = harness({ manualWidget: true });
  const initId = h.host.initialize("sku-1");
  for (let index = 0; index < WIDGET_MAX_SESSION_MESSAGES + 20; index += 1) {
    h.eventPort.dispatch({ origin: "https://evil.example", source: h.widgetWindow, data: eventFor(h, `unbound-event-${index}`, initId, "jessica.ready", { capabilities: [] }) });
    h.eventPort.dispatch({ origin: h.widgetOrigin, source: h.widgetWindow, data: { malformed: index } });
  }
  dispatch(h, eventFor(h, "ready-after-invalid-flood", initId, "jessica.ready", { capabilities: [] }));
  assert.equal(h.host.state, "ready");
  assert.equal(h.rejects.some((entry) => entry[1] === "MESSAGE_LIMIT"), false);

  const posts = [], calls = [], rejects = [];
  const parentWindow = { postMessage(message) { posts.push(message); } };
  let responseId = 0;
  const bridge = new WidgetBridge({ parentOrigin: "https://shop.example", parentWindow, tenantId: "tenant-1", sessionId: "session-1", nextRequestId: () => `invalid-response-${++responseId}`, controller: { initialize() { calls.push("init"); }, open() {}, changeSku() {}, close() {} }, onReject: (code) => rejects.push(code) });
  for (let index = 0; index < WIDGET_MAX_SESSION_MESSAGES + 20; index += 1) {
    bridge.receive({ origin: "https://evil.example", source: parentWindow, data: { ...baseCommand, requestId: `unbound-command-${index}`, type: "jessica.init", payload: { skuId: "sku-1" } } });
    bridge.receive({ origin: "https://shop.example", source: parentWindow, data: { malformed: index } });
  }
  bridge.receive({ origin: "https://shop.example", source: parentWindow, data: { ...baseCommand, requestId: "valid-after-invalid-flood", type: "jessica.init", payload: { skuId: "sku-1" } } });
  assert.equal(bridge.state, "ready"); assert.deepEqual(calls, ["init"]); assert.equal(posts.length, 1); assert.equal(rejects.includes("MESSAGE_LIMIT"), false);
});

test("request-id collisions fail closed and controller failures expose only sanitized stable errors", () => {
  const collision = harness({ parentIds: () => "same-id" });
  collision.host.initialize("sku-1");
  assert.throws(() => collision.host.open(), /collision/);
  assert.equal(collision.host.state, "ready");
  const failed = harness({ throwOpen: true });
  failed.host.initialize("sku-1"); failed.host.open();
  const error = failed.events.at(-1);
  assert.equal(error.type, "jessica.error");
  assert.equal(failed.host.state, "closed");
  assert.deepEqual(error.payload, { code: "INTERNAL_FAILURE", class: "internal", recoverable: false, message: "Widget operation failed" });
});

test("widget URL/origin containment is exact HTTPS and rejects path escape or URL authority tricks", () => {
  const make = (widgetUrl, widgetOrigin = "https://widget.example") => () => new ParentWidgetHost({ widgetUrl, widgetOrigin, widgetPathPrefix: "/embed/v1", tenantId: "tenant-1", sessionId: "session-1", iframe: { contentWindow: null, setSource() {}, setSandbox() {}, setAllow() {} }, events: { addMessageListener() {}, removeMessageListener() {}, addPageHideListener() {}, removePageHideListener() {} }, nextRequestId: () => "p-1", onEvent() {} });
  assert.throws(make("http://widget.example/embed/v1/widget.html"), /HTTPS URL/);
  assert.throws(make("https://widget.example.evil/embed/v1/widget.html"), /contained HTTPS URL/);
  assert.throws(make("https://widget.example/embed/v10/widget.html"), /escapes/);
  assert.throws(make("https://widget.example/embed/v1/%2F..%2Fadmin"), /escapes/);
  assert.throws(make("https://widget.example/embed/v1/widget.html?origin=https://evil.example"), /without credentials/);
  assert.throws(make("https://widget.example/embed/v1/widget.html", "https://widget.example/"), /exact HTTPS origin/);
});
