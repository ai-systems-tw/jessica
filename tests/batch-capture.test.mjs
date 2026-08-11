import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_CAPTURE_MAX_EVENTS, batchCaptureLogSha256, parseBatchCaptureEvent, replayBatchCapture,
} from "../dist/packages/contracts/src/index.js";
import {
  appendAuthorizedRawCapture, appendBatchCaptureEvent, issuePrivateRawCaptureCapability,
} from "../dist/packages/batch-capture/src/index.js";

const binding = { tenantId: "tenant-1", siteId: "site-1", environment: "production", operatorSessionId: "operator-session-1", batchId: "batch-1" };
const at = (second) => `2026-08-11T00:00:${String(second).padStart(2, "0")}.000Z`;
const event = (type, sequence, extra = {}) => ({ schemaVersion: 1, type, eventId: `event-${sequence}`, sequence, occurredAt: at(sequence), ...binding, ...extra });
const product = (suffix = "1") => ({ itemId: `item-${suffix}`, sku: `SKU-${suffix}`, frameModelId: `model-${suffix}`, frameVariantId: `variant-${suffix}`, productType: "sunglasses", variantClassification: "color-variant" });

function opened(count = 1) { return appendBatchCaptureEvent([], event("batch.capture-opened", 1, { expectedItemCount: count })); }
function bound(log, suffix = "1") { return appendBatchCaptureEvent(log, event("batch.item-bound", log.length + 1, { product: product(suffix) })); }
function capture(log, suffix, sequence = log.length + 1) {
  const grant = { ...binding, capabilityId: `cap-${sequence}`, itemId: `item-${suffix}`, localRawRef: `localraw:batch-1-item-${suffix}-${sequence}`, expiresAt: at(50) };
  const capability = issuePrivateRawCaptureCapability(grant);
  return { capability, log: appendAuthorizedRawCapture(log, event("batch.raw-capture-recorded", sequence, { itemId: grant.itemId, captureId: `capture-${sequence}`, localRawRef: grant.localRawRef, capabilityId: grant.capabilityId }), capability, new Date(at(sequence))) };
}

test("local batch requires per-item quality before deterministic advance and completion", async () => {
  let log = bound(opened());
  log = capture(log, "1").log;
  log = appendBatchCaptureEvent(log, event("batch.quality-decided", 4, { itemId: "item-1", captureId: "capture-3", decision: "retake", issueCodes: ["BLUR"] }));
  assert.throws(() => appendBatchCaptureEvent(log, event("batch.item-advanced", 5, { itemId: "item-1" })), /terminal quality/);
  log = capture(log, "1", 5).log;
  log = appendBatchCaptureEvent(log, event("batch.quality-decided", 6, { itemId: "item-1", captureId: "capture-5", decision: "accept", issueCodes: [] }));
  log = appendBatchCaptureEvent(log, event("batch.item-advanced", 7, { itemId: "item-1" }));
  log = appendBatchCaptureEvent(log, event("batch.capture-completed", 8, { completedItemCount: 1, operationalStatus: "local-preparation-only", g5Ready: false }));
  const state = replayBatchCapture(log); assert.equal(state.phase, "completed"); assert.equal(state.revision, 8); assert.equal(state.completedItems[0].product.sku, "SKU-1"); assert.equal(state.completedItems[0].outcome, "accept"); assert.equal(state.operationalStatus, "local-preparation-only"); assert.equal(state.g5Ready, false);
  assert.equal(await batchCaptureLogSha256(log), await batchCaptureLogSha256(structuredClone(log)));
  const serialized = JSON.stringify(log); assert.match(serialized, /localraw:/); assert.doesNotMatch(serialized, /data:|https?:|\/Users\/|image|bytes|stack/i);
});

test("exact application retry is idempotent while event-id relabel fails", () => {
  const log = opened(); const same = event("batch.capture-opened", 1, { expectedItemCount: 1 });
  assert.deepEqual(appendBatchCaptureEvent(log, same), log);
  assert.throws(() => appendBatchCaptureEvent(log, { ...same, expectedItemCount: 2 }), /relabelled/);
});

test("SKU/item/model/variant and all session bindings cannot be relabelled", () => {
  let log = bound(opened(2)); log = capture(log, "1").log; log = appendBatchCaptureEvent(log, event("batch.quality-decided", 4, { itemId: "item-1", captureId: "capture-3", decision: "reject", issueCodes: ["WRONG_ITEM"] })); log = appendBatchCaptureEvent(log, event("batch.item-advanced", 5, { itemId: "item-1" })); assert.equal(replayBatchCapture(log).completedItems[0].outcome, "reject");
  assert.throws(() => appendBatchCaptureEvent(log, event("batch.item-bound", 6, { product: { ...product("2"), sku: "SKU-1" } })), /SKU/);
  assert.throws(() => appendBatchCaptureEvent(log, event("batch.item-bound", 6, { product: { ...product("2"), frameVariantId: "variant-1" } })), /variant/);
  assert.throws(() => appendBatchCaptureEvent(log, { ...event("batch.item-bound", 6, { product: product("2") }), tenantId: "tenant-2" }), /binding/);
});

test("raw references require exact unforgeable, one-shot, live capability authority", () => {
  const log = bound(opened()); const grant = { ...binding, capabilityId: "cap-3", itemId: "item-1", localRawRef: "localraw:opaque-1", expiresAt: at(20) }; const capability = issuePrivateRawCaptureCapability(grant);
  const raw = event("batch.raw-capture-recorded", 3, { itemId: "item-1", captureId: "capture-3", localRawRef: grant.localRawRef, capabilityId: grant.capabilityId });
  assert.throws(() => appendAuthorizedRawCapture(log, raw, { kind: "private-raw-capture-capability" }, new Date(at(3))), /not authorized/);
  assert.throws(() => appendAuthorizedRawCapture(log, { ...raw, localRawRef: "localraw:other" }, capability, new Date(at(3))), /exceeds capability/);
  const next = appendAuthorizedRawCapture(log, raw, capability, new Date(at(3))); assert.equal(next.length, 3);
  assert.deepEqual(appendAuthorizedRawCapture(next, raw, capability, new Date(at(4))), next);
  assert.throws(() => appendAuthorizedRawCapture(log, { ...raw, eventId: "event-new", captureId: "capture-new" }, capability, new Date(at(4))), /not authorized/);
  const staleCapability = issuePrivateRawCaptureCapability({ ...grant, capabilityId: "cap-stale", localRawRef: "localraw:stale", expiresAt: at(2) });
  assert.throws(() => appendAuthorizedRawCapture(log, { ...raw, capabilityId: "cap-stale", localRawRef: "localraw:stale" }, staleCapability, new Date(at(3))), /stale/);
  const boundaryCapability = issuePrivateRawCaptureCapability({ ...grant, capabilityId: "cap-boundary", localRawRef: "localraw:boundary", expiresAt: at(3) });
  assert.equal(appendAuthorizedRawCapture(log, { ...raw, capabilityId: "cap-boundary", localRawRef: "localraw:boundary" }, boundaryCapability, new Date(at(3))).length, 3);
});

test("capture, capability and local reference identities are batch-global", () => {
  let log = bound(opened(2)); log = capture(log, "1").log; log = appendBatchCaptureEvent(log, event("batch.quality-decided", 4, { itemId: "item-1", captureId: "capture-3", decision: "accept", issueCodes: [] })); log = appendBatchCaptureEvent(log, event("batch.item-advanced", 5, { itemId: "item-1" })); log = bound(log, "2");
  for (const changed of [{ captureId: "capture-3", capabilityId: "cap-new", localRawRef: "localraw:new" }, { captureId: "capture-new", capabilityId: "cap-3", localRawRef: "localraw:new" }, { captureId: "capture-new", capabilityId: "cap-new", localRawRef: "localraw:batch-1-item-1-3" }]) {
    const capability = issuePrivateRawCaptureCapability({ ...binding, itemId: "item-2", expiresAt: at(50), capabilityId: changed.capabilityId, localRawRef: changed.localRawRef });
    assert.throws(() => appendAuthorizedRawCapture(log, event("batch.raw-capture-recorded", 7, { itemId: "item-2", ...changed }), capability, new Date(at(7))), /duplicated|relabelled/);
  }
});

test("final replay failure does not consume capability but successful append does", () => {
  let log = bound(opened(2)); log = capture(log, "1").log; log = appendBatchCaptureEvent(log, event("batch.quality-decided", 4, { itemId: "item-1", captureId: "capture-3", decision: "accept", issueCodes: [] })); log = appendBatchCaptureEvent(log, event("batch.item-advanced", 5, { itemId: "item-1" })); log = bound(log, "2");
  const grant = { ...binding, capabilityId: "cap-atomic", itemId: "item-2", localRawRef: "localraw:atomic", expiresAt: at(50) }; const capability = issuePrivateRawCaptureCapability(grant);
  const base = event("batch.raw-capture-recorded", 7, { itemId: "item-2", captureId: "capture-3", localRawRef: grant.localRawRef, capabilityId: grant.capabilityId });
  assert.throws(() => appendAuthorizedRawCapture(log, base, capability, new Date(at(7))), /captureId/);
  const corrected = { ...base, captureId: "capture-atomic" }; const next = appendAuthorizedRawCapture(log, corrected, capability, new Date(at(7))); assert.equal(next.length, 7);
  assert.throws(() => appendAuthorizedRawCapture(log, { ...corrected, eventId: "event-atomic-new", captureId: "capture-atomic-new" }, capability, new Date(at(8))), /not authorized/);
});

test("model product type is stable and only one variant may be model-primary", () => {
  let log = bound(opened(2)); log = capture(log, "1").log; log = appendBatchCaptureEvent(log, event("batch.quality-decided", 4, { itemId: "item-1", captureId: "capture-3", decision: "accept", issueCodes: [] })); log = appendBatchCaptureEvent(log, event("batch.item-advanced", 5, { itemId: "item-1" }));
  const firstAsPrimary = appendBatchCaptureEvent([], event("batch.capture-opened", 1, { expectedItemCount: 2 })); const primaryLog = appendBatchCaptureEvent(firstAsPrimary, event("batch.item-bound", 2, { product: { ...product("1"), variantClassification: "model-primary" } })); let advanced = capture(primaryLog, "1").log; advanced = appendBatchCaptureEvent(advanced, event("batch.quality-decided", 4, { itemId: "item-1", captureId: "capture-3", decision: "accept", issueCodes: [] })); advanced = appendBatchCaptureEvent(advanced, event("batch.item-advanced", 5, { itemId: "item-1" }));
  assert.throws(() => appendBatchCaptureEvent(advanced, event("batch.item-bound", 6, { product: { ...product("2"), frameModelId: "model-1", variantClassification: "model-primary" } })), /multiple primary/);
  assert.throws(() => appendBatchCaptureEvent(log, event("batch.item-bound", 6, { product: { ...product("2"), frameModelId: "model-1", productType: "optical-frame" } })), /product type/);
  assert.equal(appendBatchCaptureEvent(log, event("batch.item-bound", 6, { product: { ...product("2"), frameModelId: "model-1" } })).length, 6);
});

test("capability expiry uses the event timestamp supported range", () => {
  for (const expiresAt of ["2019-12-31T23:59:59.999Z", "2100-01-01T00:00:00.001Z"]) assert.throws(() => issuePrivateRawCaptureCapability({ ...binding, capabilityId: "cap-range", itemId: "item-1", localRawRef: "localraw:range", expiresAt }), /expiry/);
  assert.doesNotThrow(() => issuePrivateRawCaptureCapability({ ...binding, capabilityId: "cap-min", itemId: "item-1", localRawRef: "localraw:min", expiresAt: "2020-01-01T00:00:00.000Z" }));
  assert.doesNotThrow(() => issuePrivateRawCaptureCapability({ ...binding, capabilityId: "cap-max", itemId: "item-1", localRawRef: "localraw:max", expiresAt: "2100-01-01T00:00:00.000Z" }));
});

test("capability mismatch failures preserve the valid one-shot grant", () => {
  const log = bound(opened()); const grant = { ...binding, capabilityId: "cap-preserved", itemId: "item-1", localRawRef: "localraw:preserved", expiresAt: at(20) }; const capability = issuePrivateRawCaptureCapability(grant); const raw = event("batch.raw-capture-recorded", 3, { itemId: "item-1", captureId: "capture-preserved", localRawRef: grant.localRawRef, capabilityId: grant.capabilityId });
  assert.throws(() => appendAuthorizedRawCapture(log, { ...raw, siteId: "site-other" }, capability, new Date(at(3))), /authority/);
  assert.throws(() => appendAuthorizedRawCapture(log, { ...raw, operatorSessionId: "session-other" }, capability, new Date(at(3))), /authority/);
  assert.throws(() => appendAuthorizedRawCapture(log, { ...raw, itemId: "item-other" }, capability, new Date(at(3))), /authority/);
  assert.equal(appendAuthorizedRawCapture(log, raw, capability, new Date(at(3))).length, 3);
});

test("append snapshots and deeply freezes caller-owned nested values", () => {
  const original = event("batch.item-bound", 2, { product: product() }); const log = appendBatchCaptureEvent(opened(), original); original.product.sku = "MUTATED";
  assert.equal(log[1].product.sku, "SKU-1"); assert.equal(Object.isFrozen(log[1]), true); assert.equal(Object.isFrozen(log[1].product), true);
});

test("public/raw byte and path shaped references fail before state mutation", () => {
  for (const localRawRef of ["https://example.test/raw.jpg", "file:///private/raw.jpg", "/private/raw.jpg", "data:image/jpeg;base64,AA", "localraw:../raw.jpg", "localraw:"]) {
    assert.throws(() => parseBatchCaptureEvent(event("batch.raw-capture-recorded", 2, { itemId: "item-1", captureId: "capture-1", localRawRef, capabilityId: "cap-1" })), /local reference/);
  }
});

test("unknown, accessor, prototype, sparse, oversized and cyclic structures fail closed", () => {
  assert.throws(() => parseBatchCaptureEvent({ ...event("batch.capture-opened", 1, { expectedItemCount: 1 }), extra: true }), /fields/);
  let touched = false; const hostile = { ...event("batch.capture-opened", 1) }; Object.defineProperty(hostile, "expectedItemCount", { enumerable: true, get() { touched = true; return 1; } }); assert.throws(() => parseBatchCaptureEvent(hostile), /data properties/); assert.equal(touched, false);
  assert.throws(() => parseBatchCaptureEvent(Object.assign(Object.create({}), event("batch.capture-opened", 1, { expectedItemCount: 1 }))), /plain object/);
  const sparse = []; sparse.length = 2; assert.throws(() => replayBatchCapture(sparse), /dense/);
  assert.throws(() => replayBatchCapture(Array.from({ length: BATCH_CAPTURE_MAX_EVENTS + 1 }, () => null)), /dense/);
  const cyclic = event("batch.item-bound", 2, { product: {} }); cyclic.product.self = cyclic.product; assert.throws(() => parseBatchCaptureEvent(cyclic), /fields/);
});

test("replay, reorder, stale quality and premature completion are rejected", () => {
  const log = bound(opened());
  assert.throws(() => replayBatchCapture([...log, log[1]]), /sequence|replayed/);
  assert.throws(() => appendBatchCaptureEvent(log, event("batch.quality-decided", 3, { itemId: "item-1", captureId: "missing", decision: "accept", issueCodes: [] })), /stale/);
  assert.throws(() => appendBatchCaptureEvent(log, event("batch.capture-completed", 3, { completedItemCount: 1, operationalStatus: "local-preparation-only", g5Ready: false })), /complete/);
});
