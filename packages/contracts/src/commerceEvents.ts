export const COMMERCE_EVENT_SCHEMA_VERSION = 1 as const;
export const COMMERCE_EVENT_MAX_SEQUENCE = 256 as const;
export const COMMERCE_EVENT_MAX_SESSION_MS = 14_400_000 as const;
export const COMMERCE_EVENT_MAX_BYTES = 8_192 as const;
export const COMMERCE_BATCH_MAX_EVENTS = 32 as const;
export const COMMERCE_BATCH_MAX_BYTES = 32_768 as const;
export const COMMERCE_BATCH_TIMEOUT_MS = 5_000 as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIN_OCCURRED_AT_MS = Date.parse("2020-01-01T00:00:00.000Z");
const MAX_OCCURRED_AT_MS = Date.parse("2100-01-01T00:00:00.000Z");

export type CommerceEnvironment = "staging" | "production";
export type CommerceEventType =
  | "commerce.open"
  | "commerce.camera-permission-result"
  | "commerce.try-on-started"
  | "commerce.product-changed"
  | "commerce.capture-created"
  | "commerce.cart-requested"
  | "commerce.close"
  | "commerce.error";

export type CommerceProductAttribution = {
  sku: string;
  frameModelId: string;
  frameVariantId: string;
  assetId: string;
  assetVersion: number;
  deploymentId: string;
  catalogSha256: string;
  manifestSha256: string;
  modelSha256: string;
};

export type CommerceErrorCode =
  | "PROTOCOL_REJECTED"
  | "AUTH_REQUIRED"
  | "CAMERA_DENIED"
  | "CAMERA_UNAVAILABLE"
  | "ASSET_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE"
  | "INTERNAL_FAILURE"
  | "CATALOG_UNAVAILABLE";
export type CommerceErrorClass = "protocol" | "authentication" | "permission" | "catalog" | "runtime" | "internal";

type CommerceEnvelope<TType extends CommerceEventType, TPayload, TProduct extends CommerceProductAttribution | null> = {
  schemaVersion: typeof COMMERCE_EVENT_SCHEMA_VERSION;
  type: TType;
  occurredAt: string;
  sequence: number;
  eventId: string;
  requestId: string;
  tenantId: string;
  siteId: string;
  environment: CommerceEnvironment;
  sessionId: string;
  product: TProduct;
  payload: TPayload;
};

export type CommerceOpenEvent = CommerceEnvelope<"commerce.open", Record<string, never>, CommerceProductAttribution>;
export type CommerceCameraPermissionEvent = CommerceEnvelope<"commerce.camera-permission-result", { state: "granted" | "denied" | "unavailable" }, null>;
export type CommerceTryOnStartedEvent = CommerceEnvelope<"commerce.try-on-started", Record<string, never>, CommerceProductAttribution>;
export type CommerceProductChangedEvent = CommerceEnvelope<"commerce.product-changed", Record<string, never>, CommerceProductAttribution>;
/** The capture reference is intentionally excluded: only the bounded occurrence is telemetry. */
export type CommerceCaptureCreatedEvent = CommerceEnvelope<"commerce.capture-created", Record<string, never>, CommerceProductAttribution>;
export type CommerceCartRequestedEvent = CommerceEnvelope<"commerce.cart-requested", { quantity: number }, CommerceProductAttribution>;
export type CommerceCloseEvent = CommerceEnvelope<"commerce.close", { reason: "parent-request" | "user-request" | "page-hidden" | "host-destroyed" | "runtime-error" }, null>;
export type CommerceErrorEvent = CommerceEnvelope<"commerce.error", { code: CommerceErrorCode; class: CommerceErrorClass; recoverable: boolean }, CommerceProductAttribution | null>;
export type CommerceEvent = CommerceOpenEvent | CommerceCameraPermissionEvent | CommerceTryOnStartedEvent | CommerceProductChangedEvent | CommerceCaptureCreatedEvent | CommerceCartRequestedEvent | CommerceCloseEvent | CommerceErrorEvent;

export type CommerceParseResult<T> = { ok: true; value: T } | { ok: false; error: { code: "COMMERCE_EVENT_REJECTED" } };

function dataObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} must contain enumerable data properties only`);
  }
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key))) throw new TypeError(`${path} contains an unknown field`);
  if (keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${path} is missing a field`);
}

function identifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`${path} must be a bounded identifier`);
}

function digest(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256`);
}

function parseProduct(value: unknown): CommerceProductAttribution {
  dataObject(value, "commerce event product");
  exact(value, ["sku", "frameModelId", "frameVariantId", "assetId", "assetVersion", "deploymentId", "catalogSha256", "manifestSha256", "modelSha256"], "commerce event product");
  for (const key of ["sku", "frameModelId", "frameVariantId", "assetId", "deploymentId"] as const) identifier(value[key], `commerce event product ${key}`);
  if (!Number.isSafeInteger(value.assetVersion) || (value.assetVersion as number) < 1 || (value.assetVersion as number) > 1_000_000_000) throw new TypeError("commerce event assetVersion is invalid");
  for (const key of ["catalogSha256", "manifestSha256", "modelSha256"] as const) digest(value[key], `commerce event product ${key}`);
  return Object.freeze({
    sku: value.sku as string, frameModelId: value.frameModelId as string, frameVariantId: value.frameVariantId as string,
    assetId: value.assetId as string, assetVersion: value.assetVersion as number, deploymentId: value.deploymentId as string,
    catalogSha256: value.catalogSha256 as string, manifestSha256: value.manifestSha256 as string, modelSha256: value.modelSha256 as string,
  });
}

export function parseCommerceProductAttribution(value: unknown): CommerceProductAttribution { return parseProduct(value); }

const PRODUCT_TYPES = new Set<CommerceEventType>(["commerce.open", "commerce.try-on-started", "commerce.product-changed", "commerce.capture-created", "commerce.cart-requested"]);
const ERROR_CODES = new Set<CommerceErrorCode>(["PROTOCOL_REJECTED", "AUTH_REQUIRED", "CAMERA_DENIED", "CAMERA_UNAVAILABLE", "ASSET_UNAVAILABLE", "RUNTIME_UNAVAILABLE", "INTERNAL_FAILURE", "CATALOG_UNAVAILABLE"]);
const ERROR_CLASSES = new Set<CommerceErrorClass>(["protocol", "authentication", "permission", "catalog", "runtime", "internal"]);
const ERROR_CLASS_BY_CODE: Record<CommerceErrorCode, CommerceErrorClass> = {
  PROTOCOL_REJECTED: "protocol", AUTH_REQUIRED: "authentication", CAMERA_DENIED: "permission", CAMERA_UNAVAILABLE: "permission",
  ASSET_UNAVAILABLE: "catalog", RUNTIME_UNAVAILABLE: "runtime", INTERNAL_FAILURE: "internal", CATALOG_UNAVAILABLE: "catalog",
};

export function parseCommerceEvent(value: unknown): CommerceEvent {
  dataObject(value, "commerce event");
  exact(value, ["schemaVersion", "type", "occurredAt", "sequence", "eventId", "requestId", "tenantId", "siteId", "environment", "sessionId", "product", "payload"], "commerce event");
  if (value.schemaVersion !== COMMERCE_EVENT_SCHEMA_VERSION || typeof value.type !== "string" || !new Set<CommerceEventType>(["commerce.open", "commerce.camera-permission-result", "commerce.try-on-started", "commerce.product-changed", "commerce.capture-created", "commerce.cart-requested", "commerce.close", "commerce.error"]).has(value.type as CommerceEventType)) throw new TypeError("commerce event version or type is unsupported");
  if (typeof value.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurredAt)) throw new TypeError("commerce event occurredAt must be a millisecond UTC timestamp");
  const epochMs = Date.parse(value.occurredAt);
  if (!Number.isFinite(epochMs) || epochMs < MIN_OCCURRED_AT_MS || epochMs > MAX_OCCURRED_AT_MS) throw new TypeError("commerce event occurredAt is outside the supported range");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 || (value.sequence as number) > COMMERCE_EVENT_MAX_SEQUENCE) throw new TypeError("commerce event sequence is invalid");
  for (const key of ["eventId", "requestId", "tenantId", "siteId", "sessionId"] as const) identifier(value[key], `commerce event ${key}`);
  if (value.environment !== "staging" && value.environment !== "production") throw new TypeError("commerce event environment is invalid");
  const type = value.type as CommerceEventType;
  const product = value.product === null ? null : parseProduct(value.product);
  if ((PRODUCT_TYPES.has(type) && product === null) || ((type === "commerce.camera-permission-result" || type === "commerce.close") && product !== null)) throw new TypeError("commerce event product attribution is invalid for type");
  dataObject(value.payload, "commerce event payload");
  let payload: CommerceEvent["payload"];
  if (["commerce.open", "commerce.try-on-started", "commerce.product-changed", "commerce.capture-created"].includes(type)) {
    exact(value.payload, [], "commerce event payload"); payload = Object.freeze({});
  } else if (type === "commerce.camera-permission-result") {
    exact(value.payload, ["state"], "commerce event payload");
    if (!(["granted", "denied", "unavailable"] as unknown[]).includes(value.payload.state)) throw new TypeError("commerce camera permission state is invalid");
    payload = Object.freeze({ state: value.payload.state as CommerceCameraPermissionEvent["payload"]["state"] });
  } else if (type === "commerce.cart-requested") {
    exact(value.payload, ["quantity"], "commerce event payload");
    if (!Number.isSafeInteger(value.payload.quantity) || (value.payload.quantity as number) < 1 || (value.payload.quantity as number) > 99) throw new TypeError("commerce cart quantity is invalid");
    payload = Object.freeze({ quantity: value.payload.quantity as number });
  } else if (type === "commerce.close") {
    exact(value.payload, ["reason"], "commerce event payload");
    if (!(["parent-request", "user-request", "page-hidden", "host-destroyed", "runtime-error"] as unknown[]).includes(value.payload.reason)) throw new TypeError("commerce close reason is invalid");
    payload = Object.freeze({ reason: value.payload.reason as CommerceCloseEvent["payload"]["reason"] });
  } else {
    exact(value.payload, ["code", "class", "recoverable"], "commerce event payload");
    if (!ERROR_CODES.has(value.payload.code as CommerceErrorCode) || !ERROR_CLASSES.has(value.payload.class as CommerceErrorClass) || ERROR_CLASS_BY_CODE[value.payload.code as CommerceErrorCode] !== value.payload.class || typeof value.payload.recoverable !== "boolean") throw new TypeError("commerce error classification is invalid");
    payload = Object.freeze({ code: value.payload.code as CommerceErrorCode, class: value.payload.class as CommerceErrorClass, recoverable: value.payload.recoverable });
  }
  const parsed = Object.freeze({
    schemaVersion: COMMERCE_EVENT_SCHEMA_VERSION, type, occurredAt: value.occurredAt, sequence: value.sequence as number,
    eventId: value.eventId as string, requestId: value.requestId as string, tenantId: value.tenantId as string,
    siteId: value.siteId as string, environment: value.environment, sessionId: value.sessionId as string, product, payload,
  }) as CommerceEvent;
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > COMMERCE_EVENT_MAX_BYTES) throw new TypeError("commerce event exceeds its byte budget");
  return parsed;
}

export function safeParseCommerceEvent(value: unknown): CommerceParseResult<CommerceEvent> {
  try { return { ok: true, value: parseCommerceEvent(value) }; }
  catch { return { ok: false, error: { code: "COMMERCE_EVENT_REJECTED" } }; }
}
