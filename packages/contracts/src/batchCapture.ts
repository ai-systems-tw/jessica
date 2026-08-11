import { canonicalJson, sha256Hex } from "./generationJob.js";

export const BATCH_CAPTURE_MAX_EVENTS = 1_000;
export const BATCH_CAPTURE_MAX_ITEMS = 100;
export const BATCH_CAPTURE_MAX_ISSUES = 16;
export const BATCH_CAPTURE_MAX_BYTES = 1_048_576;
export const BATCH_CAPTURE_ISSUE_CODES = [
  "BLUR", "GLARE", "CROP", "ANGLE", "LIGHTING", "BACKGROUND", "OCCLUSION",
  "MARKING_UNREADABLE", "WRONG_ITEM", "CAPTURE_MISSING", "OTHER_CLOSED",
] as const;
export type BatchCaptureIssueCode = (typeof BATCH_CAPTURE_ISSUE_CODES)[number];
export type BatchCaptureQualityDecision = "accept" | "retake" | "reject";

export type BatchCaptureBinding = Readonly<{
  tenantId: string; siteId: string; environment: "production"; operatorSessionId: string; batchId: string;
}>;
export type BatchCaptureProduct = Readonly<{
  itemId: string; sku: string; frameModelId: string; frameVariantId: string;
  productType: "optical-frame" | "sunglasses";
  variantClassification: "model-primary" | "color-variant";
}>;
type EventBase = BatchCaptureBinding & Readonly<{ schemaVersion: 1; eventId: string; sequence: number; occurredAt: string }>;
export type BatchCaptureEvent =
  | (EventBase & Readonly<{ type: "batch.capture-opened"; expectedItemCount: number }>)
  | (EventBase & Readonly<{ type: "batch.item-bound"; product: BatchCaptureProduct }>)
  | (EventBase & Readonly<{ type: "batch.raw-capture-recorded"; itemId: string; captureId: string; localRawRef: string; capabilityId: string }>)
  | (EventBase & Readonly<{ type: "batch.quality-decided"; itemId: string; captureId: string; decision: BatchCaptureQualityDecision; issueCodes: readonly BatchCaptureIssueCode[] }>)
  | (EventBase & Readonly<{ type: "batch.item-advanced"; itemId: string }>)
  | (EventBase & Readonly<{ type: "batch.capture-completed"; completedItemCount: number; operationalStatus: "local-preparation-only"; g5Ready: false }>);

export type BatchCaptureState = Readonly<{
  binding: BatchCaptureBinding; phase: "open" | "completed"; revision: number; expectedItemCount: number;
  operationalStatus: "local-preparation-only"; g5Ready: false;
  activeItem: Readonly<{ product: BatchCaptureProduct; captures: readonly string[]; latestCaptureId: string | null; quality: BatchCaptureQualityDecision | null }> | null;
  completedItems: readonly Readonly<{ product: BatchCaptureProduct; outcome: "accept" | "reject" }>[]; seenSkus: readonly string[]; seenItemIds: readonly string[];
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOCAL_REF = /^localraw:[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const MIN_TIME = Date.parse("2020-01-01T00:00:00.000Z");
const MAX_TIME = Date.parse("2100-01-01T00:00:00.000Z");

function plain(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} must contain enumerable data properties only`);
}
function dense(value: unknown, maximum: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.keys(value).length !== value.length) throw new TypeError(`${label} must be a bounded dense standard array`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new TypeError(`${label} must contain data properties only`);
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`);
}
function id(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} must be a bounded identifier`); }
function integer(value: unknown, minimum: number, maximum: number, label: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(`${label} must be a bounded integer`); }
function time(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a millisecond UTC timestamp`);
  const epoch = Date.parse(value); if (!Number.isFinite(epoch) || epoch < MIN_TIME || epoch > MAX_TIME) throw new TypeError(`${label} is outside the supported range`);
}
function binding(value: Record<string, unknown>, label: string): BatchCaptureBinding {
  id(value.tenantId, `${label} tenantId`); id(value.siteId, `${label} siteId`); id(value.operatorSessionId, `${label} operatorSessionId`); id(value.batchId, `${label} batchId`);
  if (value.environment !== "production") throw new TypeError(`${label} environment must be production`);
  return Object.freeze({ tenantId: value.tenantId, siteId: value.siteId, environment: "production", operatorSessionId: value.operatorSessionId, batchId: value.batchId });
}
export function parseBatchCaptureProduct(value: unknown): BatchCaptureProduct {
  plain(value, "batch product"); exact(value, ["itemId", "sku", "frameModelId", "frameVariantId", "productType", "variantClassification"], "batch product");
  id(value.itemId, "batch product itemId"); id(value.sku, "batch product sku"); id(value.frameModelId, "batch product frameModelId"); id(value.frameVariantId, "batch product frameVariantId");
  if (value.productType !== "optical-frame" && value.productType !== "sunglasses") throw new TypeError("batch product type is unsupported");
  if (value.variantClassification !== "model-primary" && value.variantClassification !== "color-variant") throw new TypeError("batch product variant classification is unsupported");
  return Object.freeze({ itemId: value.itemId, sku: value.sku, frameModelId: value.frameModelId, frameVariantId: value.frameVariantId, productType: value.productType, variantClassification: value.variantClassification });
}

const COMMON = ["schemaVersion", "type", "eventId", "sequence", "occurredAt", "tenantId", "siteId", "environment", "operatorSessionId", "batchId"];
export function parseBatchCaptureEvent(value: unknown): BatchCaptureEvent {
  plain(value, "batch event"); const base = binding(value, "batch event");
  if (value.schemaVersion !== 1) throw new TypeError("batch event schema version is unsupported"); id(value.eventId, "batch event eventId"); integer(value.sequence, 1, BATCH_CAPTURE_MAX_EVENTS, "batch event sequence"); time(value.occurredAt, "batch event occurredAt");
  const common = { schemaVersion: 1 as const, eventId: value.eventId, sequence: value.sequence, occurredAt: value.occurredAt, ...base };
  if (value.type === "batch.capture-opened") { exact(value, [...COMMON, "expectedItemCount"], "batch event"); integer(value.expectedItemCount, 1, BATCH_CAPTURE_MAX_ITEMS, "batch expected item count"); return Object.freeze({ ...common, type: value.type, expectedItemCount: value.expectedItemCount }); }
  if (value.type === "batch.item-bound") { exact(value, [...COMMON, "product"], "batch event"); return Object.freeze({ ...common, type: value.type, product: parseBatchCaptureProduct(value.product) }); }
  if (value.type === "batch.raw-capture-recorded") { exact(value, [...COMMON, "itemId", "captureId", "localRawRef", "capabilityId"], "batch event"); id(value.itemId, "batch capture itemId"); id(value.captureId, "batch capture captureId"); id(value.capabilityId, "batch capture capabilityId"); if (typeof value.localRawRef !== "string" || !LOCAL_REF.test(value.localRawRef)) throw new TypeError("batch capture local reference is invalid"); return Object.freeze({ ...common, type: value.type, itemId: value.itemId, captureId: value.captureId, localRawRef: value.localRawRef, capabilityId: value.capabilityId }); }
  if (value.type === "batch.quality-decided") { exact(value, [...COMMON, "itemId", "captureId", "decision", "issueCodes"], "batch event"); id(value.itemId, "batch quality itemId"); id(value.captureId, "batch quality captureId"); if (!["accept", "retake", "reject"].includes(value.decision as string)) throw new TypeError("batch quality decision is unsupported"); dense(value.issueCodes, BATCH_CAPTURE_MAX_ISSUES, "batch quality issueCodes"); const issues = value.issueCodes.map((issue) => { if (!BATCH_CAPTURE_ISSUE_CODES.includes(issue as BatchCaptureIssueCode)) throw new TypeError("batch quality issue code is unsupported"); return issue as BatchCaptureIssueCode; }); if (new Set(issues).size !== issues.length || [...issues].sort().some((issue, index) => issue !== issues[index])) throw new TypeError("batch quality issue codes must be unique and sorted"); if ((value.decision === "accept") !== (issues.length === 0)) throw new TypeError("batch quality issues do not match decision"); return Object.freeze({ ...common, type: value.type, itemId: value.itemId, captureId: value.captureId, decision: value.decision as BatchCaptureQualityDecision, issueCodes: Object.freeze(issues) }); }
  if (value.type === "batch.item-advanced") { exact(value, [...COMMON, "itemId"], "batch event"); id(value.itemId, "batch advance itemId"); return Object.freeze({ ...common, type: value.type, itemId: value.itemId }); }
  if (value.type === "batch.capture-completed") { exact(value, [...COMMON, "completedItemCount", "operationalStatus", "g5Ready"], "batch event"); integer(value.completedItemCount, 1, BATCH_CAPTURE_MAX_ITEMS, "batch completed item count"); if (value.operationalStatus !== "local-preparation-only" || value.g5Ready !== false) throw new TypeError("batch completion authority is invalid"); return Object.freeze({ ...common, type: value.type, completedItemCount: value.completedItemCount, operationalStatus: value.operationalStatus, g5Ready: false }); }
  throw new TypeError("batch event type is unsupported");
}

function sameBinding(left: BatchCaptureBinding, right: BatchCaptureBinding): boolean { return left.tenantId === right.tenantId && left.siteId === right.siteId && left.environment === right.environment && left.operatorSessionId === right.operatorSessionId && left.batchId === right.batchId; }
export function replayBatchCapture(value: unknown): BatchCaptureState {
  dense(value, BATCH_CAPTURE_MAX_EVENTS, "batch event log"); if (value.length === 0) throw new TypeError("batch event log must not be empty");
  const events = value.map(parseBatchCaptureEvent); if (new TextEncoder().encode(canonicalJson(events)).byteLength > BATCH_CAPTURE_MAX_BYTES) throw new TypeError("batch event log exceeds byte budget");
  const first = events[0]!; if (first.type !== "batch.capture-opened" || first.sequence !== 1) throw new TypeError("batch log must start with open");
  const eventIds = new Map<string, string>(); const seenSkus = new Map<string, string>(); const seenItems = new Map<string, string>(); const seenVariants = new Map<string, string>(); const modelTypes = new Map<string, BatchCaptureProduct["productType"]>(); const modelPrimary = new Map<string, string>();
  const seenCaptures = new Map<string, string>(); const seenCapabilities = new Map<string, string>(); const seenRawRefs = new Map<string, string>(); const completed: Array<Readonly<{ product: BatchCaptureProduct; outcome: "accept" | "reject" }>> = [];
  let active: { product: BatchCaptureProduct; captures: string[]; latestCaptureId: string | null; quality: BatchCaptureQualityDecision | null } | null = null; let phase: "open" | "completed" = "open"; let priorTime = Date.parse(first.occurredAt);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!; if (!sameBinding(event, first)) throw new TypeError("batch event crosses binding"); if (event.sequence !== index + 1) throw new TypeError("batch event sequence is stale or reordered");
    const fingerprint = canonicalJson(event); const priorId = eventIds.get(event.eventId); if (priorId !== undefined) throw new TypeError(priorId === fingerprint ? "batch event is replayed" : "batch event identity is relabelled"); eventIds.set(event.eventId, fingerprint);
    const eventTime = Date.parse(event.occurredAt); if (eventTime < priorTime) throw new TypeError("batch event time is reordered"); priorTime = eventTime;
    if (index === 0) continue; if (phase === "completed") throw new TypeError("batch event follows completion");
    if (event.type === "batch.item-bound") { if (active !== null || completed.length >= first.expectedItemCount) throw new TypeError("batch item cannot be bound now"); const productKey = canonicalJson(event.product); const priorSku = seenSkus.get(event.product.sku); const priorItem = seenItems.get(event.product.itemId); const skuKey = canonicalJson({ sku: event.product.sku, frameModelId: event.product.frameModelId, frameVariantId: event.product.frameVariantId }); if (priorSku !== undefined) throw new TypeError(priorSku === productKey ? "batch SKU is duplicated" : "batch SKU is relabelled"); if (priorItem !== undefined) throw new TypeError(priorItem === productKey ? "batch item is replayed" : "batch item is relabelled"); const priorVariant = seenVariants.get(event.product.frameVariantId); if (priorVariant !== undefined && priorVariant !== skuKey) throw new TypeError("batch variant is relabelled across SKU identity"); const priorType = modelTypes.get(event.product.frameModelId); if (priorType !== undefined && priorType !== event.product.productType) throw new TypeError("batch model product type is inconsistent"); if (event.product.variantClassification === "model-primary") { const priorPrimary = modelPrimary.get(event.product.frameModelId); if (priorPrimary !== undefined && priorPrimary !== skuKey) throw new TypeError("batch model has multiple primary variants"); modelPrimary.set(event.product.frameModelId, skuKey); } seenSkus.set(event.product.sku, productKey); seenItems.set(event.product.itemId, productKey); seenVariants.set(event.product.frameVariantId, skuKey); modelTypes.set(event.product.frameModelId, event.product.productType); active = { product: event.product, captures: [], latestCaptureId: null, quality: null }; }
    else if (event.type === "batch.raw-capture-recorded") { if (!active || event.itemId !== active.product.itemId) throw new TypeError("batch capture crosses active item"); const captureKey = canonicalJson({ itemId: event.itemId, captureId: event.captureId, capabilityId: event.capabilityId, localRawRef: event.localRawRef }); for (const [map, key, label] of [[seenCaptures, event.captureId, "captureId"], [seenCapabilities, event.capabilityId, "capabilityId"], [seenRawRefs, event.localRawRef, "localRawRef"]] as const) { const prior = map.get(key); if (prior !== undefined) throw new TypeError(prior === captureKey ? `batch ${label} is duplicated` : `batch ${label} is relabelled`); map.set(key, captureKey); } active.captures.push(event.captureId); active.latestCaptureId = event.captureId; active.quality = null; }
    else if (event.type === "batch.quality-decided") { if (!active || event.itemId !== active.product.itemId || event.captureId !== active.latestCaptureId) throw new TypeError("batch quality decision is stale or cross-item"); if (active.quality !== null) throw new TypeError("batch quality decision is duplicated"); active.quality = event.decision; }
    else if (event.type === "batch.item-advanced") { if (!active || event.itemId !== active.product.itemId || (active.quality !== "accept" && active.quality !== "reject")) throw new TypeError("batch item requires terminal quality decision before advance"); completed.push(Object.freeze({ product: active.product, outcome: active.quality })); active = null; }
    else if (event.type === "batch.capture-completed") { if (active !== null || completed.length !== first.expectedItemCount || event.completedItemCount !== completed.length) throw new TypeError("batch cannot complete before every item advances"); phase = "completed"; }
    else throw new TypeError("batch open may occur only once");
  }
  return Object.freeze({ binding: Object.freeze({ tenantId: first.tenantId, siteId: first.siteId, environment: "production", operatorSessionId: first.operatorSessionId, batchId: first.batchId }), phase, revision: events.length, expectedItemCount: first.expectedItemCount, operationalStatus: "local-preparation-only", g5Ready: false, activeItem: active ? Object.freeze({ product: active.product, captures: Object.freeze([...active.captures]), latestCaptureId: active.latestCaptureId, quality: active.quality }) : null, completedItems: Object.freeze([...completed]), seenSkus: Object.freeze([...seenSkus.keys()]), seenItemIds: Object.freeze([...seenItems.keys()]) });
}

export async function batchCaptureLogSha256(value: unknown): Promise<string> { const state = replayBatchCapture(value); void state; return sha256Hex(canonicalJson((value as unknown[]).map(parseBatchCaptureEvent))); }
