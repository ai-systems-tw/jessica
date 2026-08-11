import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCE_BATCH_MAX_BYTES,
  COMMERCE_BATCH_MAX_EVENTS,
  COMMERCE_BATCH_TIMEOUT_MS,
  COMMERCE_EVENT_MAX_BYTES,
  canonicalJson,
  parseCommerceEvent,
  safeParseCommerceEvent,
} from "../dist/packages/contracts/src/index.js";
import {
  CommerceEventSession,
  buildCommerceEventBatch,
  createCommerceDispatchLedger,
  createCatalogUnavailableCommerceSink,
  createParentWidgetCommerceObserver,
  dispatchCommerceEventBatch,
  evaluateCommerceEventBatch,
  evaluateCommerceEvent,
  initialCommerceBatchLedgerState,
  initialCommerceLifecycleState,
  inspectCommerceDispatchLedger,
} from "../dist/packages/commerce-events/src/index.js";

const digest = (character) => character.repeat(64);
const product = (overrides = {}) => ({
  sku: "SKU-RED", frameModelId: "model-1", frameVariantId: "variant-red", assetId: "asset-1", assetVersion: 3,
  deploymentId: "deployment-7", catalogSha256: digest("a"), manifestSha256: digest("b"), modelSha256: digest("c"),
  ...overrides,
});
const at = (sequence) => new Date(Date.parse("2026-08-11T00:00:00.000Z") + sequence).toISOString();
const commerceEvent = (sequence, type, overrides = {}) => ({
  schemaVersion: 1, type, occurredAt: at(sequence), sequence, eventId: `event-${sequence}`, requestId: `request-${sequence}`,
  tenantId: "tenant-1", siteId: "site-1", environment: "production", sessionId: "session-1",
  product: ["commerce.open", "commerce.try-on-started", "commerce.product-changed", "commerce.capture-created", "commerce.cart-requested"].includes(type) ? product() : null,
  payload: type === "commerce.camera-permission-result" ? { state: "granted" }
    : type === "commerce.cart-requested" ? { quantity: 1 }
      : type === "commerce.close" ? { reason: "user-request" }
        : type === "commerce.error" ? { code: "INTERNAL_FAILURE", class: "internal", recoverable: true }
          : {},
  ...overrides,
});

function run(state, event) {
  const result = evaluateCommerceEvent(state, event);
  assert.equal(result.ok, true, result.ok ? undefined : result.code);
  return result.state;
}

test("commerce v1 rejects unknown/private fields and carries only closed stable errors", () => {
  const valid = commerceEvent(1, "commerce.error");
  assert.deepEqual(parseCommerceEvent(valid).payload, { code: "INTERNAL_FAILURE", class: "internal", recoverable: true });
  for (const forbidden of [
    { message: "raw exception" }, { stack: "secret path" }, { cameraFrame: "bytes" }, { imageUrl: "https://private" },
    { landmarks: [] }, { pose: {} }, { scale: 1 }, { captureRef: "local-capture:private" }, { properties: { anything: true } },
  ]) assert.equal(safeParseCommerceEvent({ ...valid, ...forbidden }).ok, false);
  assert.throws(() => parseCommerceEvent({ ...valid, payload: { code: "INTERNAL_FAILURE", class: "runtime", recoverable: true } }), /classification/);
  assert.throws(() => parseCommerceEvent({ ...commerceEvent(1, "commerce.capture-created"), product: null }), /product attribution/);
  let accessed = false;
  const hostile = commerceEvent(1, "commerce.open");
  Object.defineProperty(hostile, "payload", { enumerable: true, get() { accessed = true; throw new Error("secret getter"); } });
  assert.equal(safeParseCommerceEvent(hostile).ok, false);
  assert.equal(accessed, false);
  assert.equal(COMMERCE_EVENT_MAX_BYTES, 8_192);
});

test("lifecycle accepts the ordered funnel including an explicit product change", () => {
  let state = initialCommerceLifecycleState();
  state = run(state, commerceEvent(1, "commerce.open"));
  state = run(state, commerceEvent(2, "commerce.camera-permission-result"));
  state = run(state, commerceEvent(3, "commerce.try-on-started"));
  const blue = product({ sku: "SKU-BLUE", frameVariantId: "variant-blue", assetId: "asset-2", assetVersion: 4, deploymentId: "deployment-8", catalogSha256: digest("d"), manifestSha256: digest("e"), modelSha256: digest("f") });
  state = run(state, commerceEvent(4, "commerce.product-changed", { product: blue }));
  state = run(state, commerceEvent(5, "commerce.capture-created", { product: blue }));
  state = run(state, commerceEvent(6, "commerce.cart-requested", { product: blue, payload: { quantity: 2 } }));
  state = run(state, commerceEvent(7, "commerce.close"));
  assert.equal(state.phase, "closed");
  assert.equal(state.currentProduct.sku, "SKU-BLUE");
});

test("lifecycle rejects replay, reorder, relabel, impossible transitions, and terminal events", () => {
  const opened = run(initialCommerceLifecycleState(), commerceEvent(1, "commerce.open"));
  assert.equal(evaluateCommerceEvent(opened, commerceEvent(2, "commerce.cart-requested")).code, "IMPOSSIBLE_TRANSITION");
  assert.equal(evaluateCommerceEvent(opened, commerceEvent(2, "commerce.capture-created")).code, "IMPOSSIBLE_TRANSITION");
  assert.equal(evaluateCommerceEvent(opened, commerceEvent(3, "commerce.camera-permission-result")).code, "SEQUENCE");
  assert.equal(evaluateCommerceEvent(opened, { ...commerceEvent(2, "commerce.camera-permission-result"), requestId: "request-1" }).code, "REPLAY");
  assert.equal(evaluateCommerceEvent(opened, { ...commerceEvent(2, "commerce.camera-permission-result"), occurredAt: at(0) }).code, "TIME_REORDERED");
  assert.equal(evaluateCommerceEvent(opened, { ...commerceEvent(2, "commerce.camera-permission-result"), tenantId: "tenant-2" }).code, "IDENTITY_MISMATCH");
  assert.equal(evaluateCommerceEvent(opened, commerceEvent(2, "commerce.try-on-started")).code, "IMPOSSIBLE_TRANSITION");
  const permitted = run(opened, commerceEvent(2, "commerce.camera-permission-result"));
  assert.equal(evaluateCommerceEvent(permitted, commerceEvent(3, "commerce.try-on-started", { product: product({ sku: "RELABEL" }) })).code, "PRODUCT_RELABEL");
  const active = run(permitted, commerceEvent(3, "commerce.try-on-started"));
  assert.equal(evaluateCommerceEvent(active, commerceEvent(4, "commerce.cart-requested", { product: product({ modelSha256: digest("d") }) })).code, "PRODUCT_RELABEL");
  const closed = run(active, commerceEvent(4, "commerce.close"));
  assert.equal(evaluateCommerceEvent(closed, commerceEvent(5, "commerce.error")).code, "TERMINAL");
});

test("denied permission cannot be relabelled as an active try-on", () => {
  let state = run(initialCommerceLifecycleState(), commerceEvent(1, "commerce.open"));
  state = run(state, commerceEvent(2, "commerce.camera-permission-result", { payload: { state: "denied" } }));
  assert.equal(evaluateCommerceEvent(state, commerceEvent(3, "commerce.try-on-started")).code, "IMPOSSIBLE_TRANSITION");
  assert.equal(evaluateCommerceEvent(state, commerceEvent(3, "commerce.camera-permission-result")).code, "IMPOSSIBLE_TRANSITION");
});

test("nonrecoverable errors close immediately before open, during open, and after active", () => {
  const fatal = (sequence, productValue = null) => commerceEvent(sequence, "commerce.error", { product: productValue, payload: { code: "INTERNAL_FAILURE", class: "internal", recoverable: false } });
  const beforeOpen = run(initialCommerceLifecycleState(), fatal(1));
  assert.equal(beforeOpen.phase, "closed");
  assert.equal(evaluateCommerceEvent(beforeOpen, commerceEvent(2, "commerce.open")).code, "TERMINAL");

  const opened = run(initialCommerceLifecycleState(), commerceEvent(1, "commerce.open"));
  const duringOpen = run(opened, fatal(2, product()));
  assert.equal(duringOpen.phase, "closed");
  assert.equal(evaluateCommerceEvent(duringOpen, commerceEvent(3, "commerce.close")).code, "TERMINAL");

  let active = run(opened, commerceEvent(2, "commerce.camera-permission-result"));
  active = run(active, commerceEvent(3, "commerce.try-on-started"));
  const afterActive = run(active, fatal(4, product()));
  assert.equal(afterActive.phase, "closed");
  assert.equal(evaluateCommerceEvent(afterActive, commerceEvent(5, "commerce.cart-requested")).code, "TERMINAL");
});

function widgetEvent(type, requestId, payload, replyTo = null) {
  return { protocol: "jessica-widget", version: 1, direction: "widget-to-parent", tenantId: "tenant-1", sessionId: "session-1", requestId, replyTo, type, payload };
}

test("explicit widget adapter drops capture references and isolates observer failure", async () => {
  const emitted = [];
  let next = 0;
  const session = new CommerceEventSession({
    tenantId: "tenant-1", siteId: "site-1", environment: "production", sessionId: "session-1",
    nextEventId: () => `commerce-${++next}`, nowEpochMs: () => Date.parse("2026-08-11T00:00:00.000Z") + next,
    localProductForSku: (sku) => product({ sku }),
    emit(event) { emitted.push(event); if (event.type === "commerce.capture-created") throw new Error("observer secret path"); },
  });
  const observe = createParentWidgetCommerceObserver(session);
  observe(widgetEvent("jessica.opened", "widget-open", { skuId: "SKU-RED" }, "open-command"));
  observe(widgetEvent("jessica.cameraPermission", "widget-permission", { state: "granted" }));
  observe(widgetEvent("jessica.tryOnStarted", "widget-start", { skuId: "SKU-RED" }));
  observe(widgetEvent("jessica.captureCreated", "widget-capture", { captureRef: "local-capture:opaque-private-ref" }));
  observe(widgetEvent("jessica.cartRequested", "widget-cart", { skuId: "SKU-RED", quantity: 1 }));
  observe(widgetEvent("jessica.error", "widget-error", { code: "INTERNAL_FAILURE", class: "internal", recoverable: true, message: "Safe protocol message" }));
  await Promise.resolve();
  assert.deepEqual(emitted.map(({ type }) => type), ["commerce.open", "commerce.camera-permission-result", "commerce.try-on-started", "commerce.capture-created", "commerce.cart-requested", "commerce.error"]);
  const serialized = JSON.stringify(emitted);
  for (const forbidden of ["local-capture", "opaque-private-ref", "safe protocol message", "captureRef", "message"]) assert.equal(serialized.includes(forbidden), false);
  observe(widgetEvent("jessica.cartRequested", "widget-cart", { skuId: "SKU-RED", quantity: 1 }));
  assert.equal(emitted.length, 6, "replayed WidgetProtocol request must not double count");
});

test("explicit catalog adapter translates only a validated stable classification", () => {
  const emitted = [];
  let next = 0;
  const session = new CommerceEventSession({
    tenantId: "tenant-1", siteId: "site-1", environment: "production", sessionId: "session-1",
    nextEventId: () => `catalog-${++next}`, nowEpochMs: () => Date.parse("2026-08-11T00:00:00.000Z"), localProductForSku: () => product(), emit: (event) => emitted.push(event),
  });
  const sink = createCatalogUnavailableCommerceSink(session);
  sink.write({
    schemaVersion: 1, type: "catalog.asset-unavailable", occurredAt: "2026-08-11T00:00:00.000Z", requestId: "catalog-request",
    tenantId: "tenant-1", siteId: "site-1", environment: "production", requestedSku: "SKU-RED", requestedFrameModelId: "model-1",
    requestedFrameVariantId: "variant-red", fallbackKind: "none", reasonCode: "ASSET_CHAIN_REJECTED",
  });
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0].payload, { code: "CATALOG_UNAVAILABLE", class: "catalog", recoverable: true });
  assert.equal(emitted[0].product, null);
  assert.equal(JSON.stringify(emitted[0]).includes("ASSET_CHAIN_REJECTED"), false);
});

test("batch digest, idempotency, exact envelope bytes, and chain are deterministic", async () => {
  const events = [commerceEvent(1, "commerce.open"), commerceEvent(2, "commerce.camera-permission-result")];
  const first = await buildCommerceEventBatch(events);
  const second = await buildCommerceEventBatch(events.map((event) => structuredClone(event)));
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.idempotencyKey, `ceb1_${first.batchSha256}`);
  assert.equal(first.priorBatchSha256, null);
  assert.equal(first.eventCount, 2);
  assert.equal(new TextEncoder().encode(canonicalJson(first)).byteLength, first.byteLength);
  assert.ok(first.byteLength > new TextEncoder().encode(canonicalJson(first.events)).byteLength, "budget must include envelope metadata");
  assert.ok(first.byteLength <= COMMERCE_BATCH_MAX_BYTES);
  assert.equal(COMMERCE_BATCH_MAX_EVENTS, 32);
  assert.equal(COMMERCE_BATCH_TIMEOUT_MS, 5_000);
  await assert.rejects(buildCommerceEventBatch(Array.from({ length: 33 }, (_, index) => commerceEvent(index + 1, index === 0 ? "commerce.open" : "commerce.error"))), /event count/);
  await assert.rejects(buildCommerceEventBatch([events[0], { ...events[1], sequence: 3 }]), /contiguous/);

  for (const mutate of [
    (value) => { value.events[0].product.modelSha256 = digest("d"); },
    (value) => { value.events[1].payload.state = "denied"; },
    (value) => { value.siteId = "site-2"; },
    (value) => { value.byteLength += 1; },
  ]) {
    const changed = structuredClone(first); mutate(changed);
    assert.equal((await evaluateCommerceEventBatch(initialCommerceBatchLedgerState(), changed)).ok, false);
  }
  const rebuiltMutation = await buildCommerceEventBatch([{ ...events[0], product: product({ modelSha256: digest("d") }) }, events[1]]);
  assert.notEqual(rebuiltMutation.batchSha256, first.batchSha256);
  assert.notEqual(rebuiltMutation.idempotencyKey, first.idempotencyKey);

  const firstEvaluation = await evaluateCommerceEventBatch(initialCommerceBatchLedgerState(), first);
  assert.equal(firstEvaluation.ok, true);
  const laterEvents = [commerceEvent(3, "commerce.try-on-started"), commerceEvent(4, "commerce.cart-requested")];
  const later = await buildCommerceEventBatch(laterEvents, first.batchSha256);
  const laterEvaluation = await evaluateCommerceEventBatch(firstEvaluation.state, later);
  assert.equal(laterEvaluation.ok, true);
  const wrongChain = await buildCommerceEventBatch(laterEvents, digest("f"));
  assert.equal((await evaluateCommerceEventBatch(firstEvaluation.state, wrongChain)).code, "BATCH_CHAIN");
  assert.equal((await evaluateCommerceEventBatch(initialCommerceBatchLedgerState(), later)).code, "BATCH_CHAIN");
  assert.equal((await evaluateCommerceEventBatch(firstEvaluation.state, first)).code, "BATCH_CHAIN", "accepted batch replay must fail");
  const skipped = await buildCommerceEventBatch([commerceEvent(4, "commerce.try-on-started")], first.batchSha256);
  assert.equal((await evaluateCommerceEventBatch(firstEvaluation.state, skipped)).code, "BATCH_SEQUENCE");
  const relabelled = await buildCommerceEventBatch([commerceEvent(3, "commerce.try-on-started", { product: product({ modelSha256: digest("d") }) })], first.batchSha256);
  assert.equal((await evaluateCommerceEventBatch(firstEvaluation.state, relabelled)).code, "PRODUCT_RELABEL");
  const impossible = await buildCommerceEventBatch([commerceEvent(1, "commerce.cart-requested")]);
  assert.equal((await evaluateCommerceEventBatch(initialCommerceBatchLedgerState(), impossible)).code, "IMPOSSIBLE_TRANSITION");
  const terminalFirst = await buildCommerceEventBatch([commerceEvent(1, "commerce.error", { payload: { code: "INTERNAL_FAILURE", class: "internal", recoverable: false } })]);
  const terminalState = await evaluateCommerceEventBatch(initialCommerceBatchLedgerState(), terminalFirst);
  assert.equal(terminalState.ok, true);
  const terminalContinuation = await buildCommerceEventBatch([commerceEvent(2, "commerce.open")], terminalFirst.batchSha256);
  assert.equal((await evaluateCommerceEventBatch(terminalState.state, terminalContinuation)).code, "TERMINAL");
});

test("batch budget rejects exact canonical envelope bytes over the boundary", async () => {
  const long = (prefix, index) => `${prefix}${String(index).padStart(3, "0")}${"x".repeat(124 - prefix.length)}`;
  const large = (sequence, type) => commerceEvent(sequence, type, {
    eventId: long("e", sequence), requestId: long("r", sequence), tenantId: long("t", 1), siteId: long("s", 1), sessionId: long("n", 1),
    product: product({ sku: long("k", 1), frameModelId: long("m", 1), frameVariantId: long("v", 1), assetId: long("a", 1), deploymentId: long("d", 1) }),
  });
  const values = [];
  let lastGood = null;
  for (let sequence = 1; sequence <= COMMERCE_BATCH_MAX_EVENTS; sequence += 1) {
    values.push(large(sequence, sequence === 1 ? "commerce.open" : "commerce.error"));
    try { lastGood = await buildCommerceEventBatch(values); }
    catch (error) {
      assert.match(error.message, /byte budget/);
      assert.ok(lastGood);
      assert.equal(new TextEncoder().encode(canonicalJson(lastGood)).byteLength, lastGood.byteLength);
      assert.ok(lastGood.byteLength <= COMMERCE_BATCH_MAX_BYTES);
      assert.ok(sequence <= COMMERCE_BATCH_MAX_EVENTS);
      return;
    }
  }
  assert.fail("large valid events should reach the canonical batch byte boundary before the event-count boundary");
});

test("evaluate-then-dispatch advances ledger only on accepted and contains hostile sinks/clocks", async () => {
  const first = await buildCommerceEventBatch([commerceEvent(1, "commerce.open"), commerceEvent(2, "commerce.camera-permission-result")]);
  const ledger = createCommerceDispatchLedger();
  const accepted = await dispatchCommerceEventBatch(first, ledger, { async send(batch, { canonicalBytes }) { assert.equal(canonicalBytes.byteLength, batch.byteLength); assert.equal(new TextDecoder().decode(canonicalBytes), canonicalJson(batch)); return { status: "accepted" }; } });
  assert.equal(accepted.result.status, "accepted");
  assert.equal(inspectCommerceDispatchLedger(accepted.ledger).priorBatchSha256, first.batchSha256);
  const later = await buildCommerceEventBatch([commerceEvent(3, "commerce.try-on-started")], first.batchSha256);
  const forgedCrossScopeState = structuredClone(inspectCommerceDispatchLedger(accepted.ledger));
  forgedCrossScopeState.lifecycle.tenantId = "tenant-forged";
  forgedCrossScopeState.lifecycle.sessionId = "session-forged";
  assert.deepEqual((await dispatchCommerceEventBatch(later, forgedCrossScopeState, { async send() { assert.fail("forged structural ledger must not reach sink"); } })).result, { status: "terminal", reason: "invalid-batch" });
  const cartBeforeOpen = await buildCommerceEventBatch([commerceEvent(1, "commerce.cart-requested")]);
  const forgedActive = structuredClone(initialCommerceBatchLedgerState());
  forgedActive.lifecycle.phase = "active";
  forgedActive.lifecycle.currentProduct = product();
  assert.deepEqual((await dispatchCommerceEventBatch(cartBeforeOpen, forgedActive, { async send() { assert.fail("plain active state must not reach sink"); } })).result, { status: "terminal", reason: "invalid-batch" });
  const retryLedger = createCommerceDispatchLedger();
  const failed = await dispatchCommerceEventBatch(first, retryLedger, { async send() { throw new Error("secret stack"); } });
  assert.deepEqual(failed.result, { status: "retryable", reason: "sink-failure", retryAfterMs: null });
  assert.equal(failed.ledger, retryLedger);
  const throttled = await dispatchCommerceEventBatch(first, retryLedger, { async send() { return { status: "retryable", reason: "throttled", retryAfterMs: 500 }; } });
  assert.deepEqual(throttled.result, { status: "retryable", reason: "throttled", retryAfterMs: 500 });
  const invalid = await dispatchCommerceEventBatch({ ...first, byteLength: first.byteLength + 1 }, retryLedger, { async send() { assert.fail("invalid batch must not reach sink"); } });
  assert.deepEqual(invalid.result, { status: "terminal", reason: "invalid-batch" });

  let accessed = false;
  const getter = {};
  Object.defineProperty(getter, "status", { enumerable: true, get() { accessed = true; throw new Error("secret getter"); } });
  for (const response of [getter, Object.assign(Object.create({}), { status: "accepted" }), { status: "accepted", extra: true }, Object.assign({ status: "accepted" }, { [Symbol("secret")]: true })]) {
    const outcome = await dispatchCommerceEventBatch(first, retryLedger, { async send() { return response; } });
    assert.deepEqual(outcome.result, { status: "terminal", reason: "sink-response-rejected" });
  }
  assert.equal(accessed, false);

  let timeoutDelay = null;
  const clock = { setTimeout(callback, delay) { timeoutDelay = delay; callback(); return "timer"; }, clearTimeout(handle) { assert.equal(handle, "timer"); } };
  assert.deepEqual((await dispatchCommerceEventBatch(first, retryLedger, { async send() { return new Promise(() => {}); } }, undefined, clock)).result, { status: "retryable", reason: "timeout", retryAfterMs: null });
  assert.equal(timeoutDelay, COMMERCE_BATCH_TIMEOUT_MS);
  const controller = new AbortController(); controller.abort();
  assert.deepEqual((await dispatchCommerceEventBatch(first, retryLedger, { async send() { assert.fail("must not call"); } }, controller.signal)).result, { status: "terminal", reason: "aborted" });
  const inFlight = new AbortController();
  assert.deepEqual((await dispatchCommerceEventBatch(first, retryLedger, { async send() { inFlight.abort(); return new Promise(() => {}); } }, inFlight.signal)).result, { status: "terminal", reason: "aborted" });

  const setupFailure = await dispatchCommerceEventBatch(first, retryLedger, { async send() { assert.fail("must not call"); } }, undefined, { setTimeout() { throw new Error("clock secret"); }, clearTimeout() {} });
  assert.deepEqual(setupFailure.result, { status: "retryable", reason: "sink-failure", retryAfterMs: null });
  let removedAfterAddFailure = false;
  const addFailureSignal = { aborted: false, reason: undefined, addEventListener() { throw new Error("listener setup secret"); }, removeEventListener() { removedAfterAddFailure = true; } };
  assert.deepEqual((await dispatchCommerceEventBatch(first, retryLedger, { async send() { assert.fail("must not call"); } }, addFailureSignal)).result, { status: "terminal", reason: "aborted" });
  assert.equal(removedAfterAddFailure, true);
  let removedAfterClockFailure = false;
  const clockFailureSignal = { aborted: false, reason: undefined, addEventListener() {}, removeEventListener() { removedAfterClockFailure = true; } };
  await dispatchCommerceEventBatch(first, retryLedger, { async send() { assert.fail("must not call"); } }, clockFailureSignal, { setTimeout() { throw new Error("clock setup secret"); }, clearTimeout() {} });
  assert.equal(removedAfterClockFailure, true);
  const cleanupFailure = await dispatchCommerceEventBatch(first, retryLedger, { async send() { return { status: "accepted" }; } }, undefined, { setTimeout() { return "timer"; }, clearTimeout() { throw new Error("clock cleanup secret"); } });
  assert.equal(cleanupFailure.result.status, "accepted");
});

test("dispatch ledger prevents concurrent sends and accepted-ledger replay while preserving retry", async () => {
  const first = await buildCommerceEventBatch([commerceEvent(1, "commerce.open")]);
  const ledger = createCommerceDispatchLedger();
  let releaseSend;
  let confirmEntered;
  const entered = new Promise((resolve) => { confirmEntered = resolve; });
  let sendCount = 0;
  const pending = dispatchCommerceEventBatch(first, ledger, {
    async send() {
      sendCount += 1;
      confirmEntered();
      return new Promise((resolve) => { releaseSend = resolve; });
    },
  });
  await entered;
  const concurrent = await dispatchCommerceEventBatch(first, ledger, {
    async send() { assert.fail("an in-flight ledger must not reach the sink"); },
  });
  assert.deepEqual(concurrent.result, { status: "terminal", reason: "dispatch-in-progress" });
  assert.equal(sendCount, 1);
  releaseSend({ status: "accepted" });
  const accepted = await pending;
  assert.equal(accepted.result.status, "accepted");

  const replay = await dispatchCommerceEventBatch(first, ledger, {
    async send() { assert.fail("a consumed ledger must not reach the sink"); },
  });
  assert.deepEqual(replay.result, { status: "terminal", reason: "ledger-consumed" });
  assert.equal(sendCount, 1);

  const retryLedger = createCommerceDispatchLedger();
  const failed = await dispatchCommerceEventBatch(first, retryLedger, {
    async send() { throw new Error("temporary failure"); },
  });
  assert.equal(failed.result.status, "retryable");
  const retried = await dispatchCommerceEventBatch(first, retryLedger, {
    async send() { return { status: "accepted" }; },
  });
  assert.equal(retried.result.status, "accepted");
});
