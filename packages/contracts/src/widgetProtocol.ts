export const WIDGET_PROTOCOL = "jessica-widget" as const;
export const WIDGET_PROTOCOL_VERSION = 1 as const;
export const WIDGET_MAX_SESSION_MESSAGES = 256 as const;

const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,63})$/;
const SKU = /^[A-Za-z0-9](?:[A-Za-z0-9._~:/-]{0,127})$/;
const CAPTURE_REF = /^local-capture:[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,95})$/;
const MAX_DEPTH = 8;
const MAX_NODES = 128;
const MAX_STRING_UNITS = 4096;

export type WidgetCommandType = "jessica.init" | "jessica.open" | "jessica.close" | "jessica.skuChange";
export type WidgetEventType =
  | "jessica.ready"
  | "jessica.opened"
  | "jessica.assetChanged"
  | "jessica.captureCreated"
  | "jessica.cartRequested"
  | "jessica.closed"
  | "jessica.error"
  | "jessica.cameraPermission"
  | "jessica.tryOnStarted";

type Envelope<TDirection extends "parent-to-widget" | "widget-to-parent", TType extends string, TPayload> = {
  protocol: typeof WIDGET_PROTOCOL;
  version: typeof WIDGET_PROTOCOL_VERSION;
  direction: TDirection;
  tenantId: string;
  sessionId: string;
  requestId: string;
  replyTo: string | null;
  type: TType;
  payload: TPayload;
};

export type WidgetInitCommand = Envelope<"parent-to-widget", "jessica.init", { skuId: string }>;
export type WidgetOpenCommand = Envelope<"parent-to-widget", "jessica.open", Record<string, never>>;
export type WidgetCloseCommand = Envelope<"parent-to-widget", "jessica.close", { reason: "parent-request" | "page-hidden" | "host-destroyed" }>;
export type WidgetSkuChangeCommand = Envelope<"parent-to-widget", "jessica.skuChange", { skuId: string }>;
export type WidgetCommand = WidgetInitCommand | WidgetOpenCommand | WidgetCloseCommand | WidgetSkuChangeCommand;

export type WidgetReadyEvent = Envelope<"widget-to-parent", "jessica.ready", { capabilities: readonly ("capture" | "cart" | "sku-change")[] }>;
export type WidgetOpenedEvent = Envelope<"widget-to-parent", "jessica.opened", { skuId: string }>;
export type WidgetAssetChangedEvent = Envelope<"widget-to-parent", "jessica.assetChanged", { skuId: string }>;
export type WidgetCaptureCreatedEvent = Envelope<"widget-to-parent", "jessica.captureCreated", { captureRef: string }>;
export type WidgetCartRequestedEvent = Envelope<"widget-to-parent", "jessica.cartRequested", { skuId: string; quantity: number }>;
export type WidgetClosedEvent = Envelope<"widget-to-parent", "jessica.closed", { reason: "parent-request" | "user-request" | "page-hidden" | "host-destroyed" | "runtime-error" }>;
export type WidgetErrorCode = "PROTOCOL_REJECTED" | "AUTH_REQUIRED" | "CAMERA_DENIED" | "CAMERA_UNAVAILABLE" | "ASSET_UNAVAILABLE" | "RUNTIME_UNAVAILABLE" | "INTERNAL_FAILURE";
export type WidgetErrorClass = "protocol" | "authentication" | "permission" | "catalog" | "runtime" | "internal";
export type WidgetErrorEvent = Envelope<"widget-to-parent", "jessica.error", { code: WidgetErrorCode; class: WidgetErrorClass; recoverable: boolean; message: string }>;
export type WidgetCameraPermissionEvent = Envelope<"widget-to-parent", "jessica.cameraPermission", { state: "granted" | "denied" | "unavailable" }>;
export type WidgetTryOnStartedEvent = Envelope<"widget-to-parent", "jessica.tryOnStarted", { skuId: string }>;
export type WidgetEvent = WidgetReadyEvent | WidgetOpenedEvent | WidgetAssetChangedEvent | WidgetCaptureCreatedEvent | WidgetCartRequestedEvent | WidgetClosedEvent | WidgetErrorEvent | WidgetCameraPermissionEvent | WidgetTryOnStartedEvent;

export type WidgetMessage = WidgetCommand | WidgetEvent;
export type WidgetParseFailureCode = "WIDGET_COMMAND_REJECTED" | "WIDGET_EVENT_REJECTED";
export type WidgetParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: WidgetParseFailureCode; message: string } };

const FORBIDDEN_KEY_PARTS = [
  "biometric", "face", "facial", "video", "image", "photo", "picture", "landmark",
  "transform", "pose", "scale", "analytic", "telemetry", "pixel", "framebuffer", "raw",
  "blob", "byte", "base64", "dataurl", "stack", "filepath", "pathname", "secret", "apikey",
] as const;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function preflight(value: unknown): void {
  let nodes = 0;
  let stringUnits = 0;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number, key?: string): void => {
    if (depth > MAX_DEPTH) throw new TypeError("widget message exceeds maximum depth");
    if (key !== undefined) {
      const normalized = normalizedKey(key);
      if (FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part))) throw new TypeError(`widget message contains prohibited payload field ${key}`);
    }
    if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("widget message numbers must be finite");
    if (typeof item === "bigint" || typeof item === "function" || typeof item === "symbol" || item === undefined) throw new TypeError("widget message contains unsupported data");
    if (typeof item === "string") {
      stringUnits += item.length;
      if (stringUnits > MAX_STRING_UNITS) throw new TypeError("widget message exceeds maximum string size");
      return;
    }
    if (typeof item !== "object" || item === null) return;
    nodes += 1;
    if (nodes > MAX_NODES) throw new TypeError("widget message exceeds maximum size");
    if (active.has(item)) throw new TypeError("widget message contains a cycle");
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item)) {
      if (prototype !== Array.prototype) throw new TypeError("widget message arrays must use the standard prototype");
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("widget message objects must be plain records");
    }
    if (Object.getOwnPropertySymbols(item).length !== 0) throw new TypeError("widget message symbol fields are forbidden");
    active.add(item);
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (!("value" in descriptor)) throw new TypeError("widget message accessors are forbidden");
      visit(descriptor.value, depth + 1, name);
    }
    active.delete(item);
  };
  visit(value, 0);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be a record`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new TypeError(`${label} contains unknown field ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing field ${key}`);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} must be a bounded identifier`);
  return value;
}

function sku(value: unknown): string {
  if (typeof value !== "string" || !SKU.test(value)) throw new TypeError("payload.skuId must be a bounded SKU identifier");
  return value;
}

function emptyPayload(value: unknown): Record<string, never> {
  const item = record(value, "payload");
  exact(item, [], "payload");
  return Object.freeze({});
}

function base(value: unknown, direction: "parent-to-widget" | "widget-to-parent"): Record<string, unknown> {
  preflight(value);
  const item = record(value, "widget message");
  exact(item, ["protocol", "version", "direction", "tenantId", "sessionId", "requestId", "replyTo", "type", "payload"], "widget message");
  if (item.protocol !== WIDGET_PROTOCOL || item.version !== WIDGET_PROTOCOL_VERSION || item.direction !== direction) throw new TypeError("widget protocol/version/direction mismatch");
  identifier(item.tenantId, "tenantId"); identifier(item.sessionId, "sessionId"); identifier(item.requestId, "requestId");
  if (item.replyTo !== null) identifier(item.replyTo, "replyTo");
  if (typeof item.type !== "string") throw new TypeError("type must be a string");
  return item;
}

function common(item: Record<string, unknown>) {
  return { protocol: WIDGET_PROTOCOL, version: WIDGET_PROTOCOL_VERSION, direction: item.direction, tenantId: item.tenantId as string, sessionId: item.sessionId as string, requestId: item.requestId as string, replyTo: item.replyTo as string | null };
}

function exactPayload(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const payload = record(value, "payload"); exact(payload, keys, "payload"); return payload;
}

export function parseWidgetCommand(value: unknown): WidgetCommand {
  const item = base(value, "parent-to-widget");
  if (item.replyTo !== null) throw new TypeError("command replyTo must be null");
  if (item.type === "jessica.init") {
    const payload = exactPayload(item.payload, ["skuId"]);
    return Object.freeze({ ...common(item), direction: "parent-to-widget", type: item.type, payload: Object.freeze({ skuId: sku(payload.skuId) }) });
  }
  if (item.type === "jessica.open") return Object.freeze({ ...common(item), direction: "parent-to-widget", type: item.type, payload: emptyPayload(item.payload) });
  if (item.type === "jessica.close") {
    const payload = exactPayload(item.payload, ["reason"]);
    if (!(["parent-request", "page-hidden", "host-destroyed"] as unknown[]).includes(payload.reason)) throw new TypeError("close reason is invalid");
    return Object.freeze({ ...common(item), direction: "parent-to-widget", type: item.type, payload: Object.freeze({ reason: payload.reason as WidgetCloseCommand["payload"]["reason"] }) });
  }
  if (item.type === "jessica.skuChange") {
    const payload = exactPayload(item.payload, ["skuId"]);
    return Object.freeze({ ...common(item), direction: "parent-to-widget", type: item.type, payload: Object.freeze({ skuId: sku(payload.skuId) }) });
  }
  throw new TypeError("unknown widget command type");
}

const ERROR_CODES = new Set<WidgetErrorCode>(["PROTOCOL_REJECTED", "AUTH_REQUIRED", "CAMERA_DENIED", "CAMERA_UNAVAILABLE", "ASSET_UNAVAILABLE", "RUNTIME_UNAVAILABLE", "INTERNAL_FAILURE"]);
const ERROR_CLASSES = new Set<WidgetErrorClass>(["protocol", "authentication", "permission", "catalog", "runtime", "internal"]);

export function parseWidgetEvent(value: unknown): WidgetEvent {
  const item = base(value, "widget-to-parent");
  const finish = <T extends WidgetEvent>(payload: T["payload"]): T => Object.freeze({ ...common(item), direction: "widget-to-parent", type: item.type, payload: Object.freeze(payload) }) as T;
  if (item.type === "jessica.ready") {
    if (item.replyTo === null) throw new TypeError("ready must correlate to init");
    const payload = exactPayload(item.payload, ["capabilities"]);
    if (!Array.isArray(payload.capabilities) || payload.capabilities.length > 3 || new Set(payload.capabilities).size !== payload.capabilities.length || payload.capabilities.some((v) => !(["capture", "cart", "sku-change"] as unknown[]).includes(v))) throw new TypeError("capabilities are invalid");
    return finish<WidgetReadyEvent>({ capabilities: Object.freeze([...payload.capabilities]) as WidgetReadyEvent["payload"]["capabilities"] });
  }
  if (item.type === "jessica.opened" || item.type === "jessica.assetChanged" || item.type === "jessica.tryOnStarted") {
    if (item.type !== "jessica.tryOnStarted" && item.replyTo === null) throw new TypeError(`${item.type} must correlate to a command`);
    if (item.type === "jessica.tryOnStarted" && item.replyTo !== null) throw new TypeError("tryOnStarted must be an uncorrelated lifecycle event");
    const payload = exactPayload(item.payload, ["skuId"]);
    return finish({ skuId: sku(payload.skuId) } as WidgetOpenedEvent["payload"]) as WidgetOpenedEvent | WidgetAssetChangedEvent | WidgetTryOnStartedEvent;
  }
  if (item.type === "jessica.captureCreated") {
    if (item.replyTo !== null) throw new TypeError("captureCreated must be an uncorrelated user event");
    const payload = exactPayload(item.payload, ["captureRef"]);
    if (typeof payload.captureRef !== "string" || !CAPTURE_REF.test(payload.captureRef)) throw new TypeError("captureRef must be a bounded local opaque reference");
    return finish<WidgetCaptureCreatedEvent>({ captureRef: payload.captureRef });
  }
  if (item.type === "jessica.cartRequested") {
    if (item.replyTo !== null) throw new TypeError("cartRequested must be an uncorrelated user event");
    const payload = exactPayload(item.payload, ["skuId", "quantity"]);
    if (!Number.isSafeInteger(payload.quantity) || (payload.quantity as number) < 1 || (payload.quantity as number) > 99) throw new TypeError("cart quantity must be an integer in [1,99]");
    return finish<WidgetCartRequestedEvent>({ skuId: sku(payload.skuId), quantity: payload.quantity as number });
  }
  if (item.type === "jessica.closed") {
    const payload = exactPayload(item.payload, ["reason"]);
    if (!(["parent-request", "user-request", "page-hidden", "host-destroyed", "runtime-error"] as unknown[]).includes(payload.reason)) throw new TypeError("closed reason is invalid");
    return finish<WidgetClosedEvent>({ reason: payload.reason as WidgetClosedEvent["payload"]["reason"] });
  }
  if (item.type === "jessica.cameraPermission") {
    if (item.replyTo !== null) throw new TypeError("cameraPermission must be an uncorrelated lifecycle event");
    const payload = exactPayload(item.payload, ["state"]);
    if (!(["granted", "denied", "unavailable"] as unknown[]).includes(payload.state)) throw new TypeError("camera permission state is invalid");
    return finish<WidgetCameraPermissionEvent>({ state: payload.state as WidgetCameraPermissionEvent["payload"]["state"] });
  }
  if (item.type === "jessica.error") {
    const payload = exactPayload(item.payload, ["code", "class", "recoverable", "message"]);
    if (!ERROR_CODES.has(payload.code as WidgetErrorCode) || !ERROR_CLASSES.has(payload.class as WidgetErrorClass)) throw new TypeError("error code/class is invalid");
    const expectedClass: Record<WidgetErrorCode, WidgetErrorClass> = { PROTOCOL_REJECTED: "protocol", AUTH_REQUIRED: "authentication", CAMERA_DENIED: "permission", CAMERA_UNAVAILABLE: "permission", ASSET_UNAVAILABLE: "catalog", RUNTIME_UNAVAILABLE: "runtime", INTERNAL_FAILURE: "internal" };
    if (expectedClass[payload.code as WidgetErrorCode] !== payload.class) throw new TypeError("error code/class mapping is invalid");
    if (typeof payload.recoverable !== "boolean") throw new TypeError("error recoverable must be boolean");
    if (typeof payload.message !== "string" || payload.message.length < 1 || payload.message.length > 160 || /(?:\/|\\|https?:|stack|token|secret|key)/i.test(payload.message)) throw new TypeError("error message is unsafe");
    return finish<WidgetErrorEvent>({ code: payload.code as WidgetErrorCode, class: payload.class as WidgetErrorClass, recoverable: payload.recoverable, message: payload.message });
  }
  throw new TypeError("unknown widget event type");
}

export function safeParseWidgetCommand(value: unknown): WidgetParseResult<WidgetCommand> {
  try { return { ok: true, value: parseWidgetCommand(value) }; }
  catch { return { ok: false, error: { code: "WIDGET_COMMAND_REJECTED", message: "Widget command rejected" } }; }
}

export function safeParseWidgetEvent(value: unknown): WidgetParseResult<WidgetEvent> {
  try { return { ok: true, value: parseWidgetEvent(value) }; }
  catch { return { ok: false, error: { code: "WIDGET_EVENT_REJECTED", message: "Widget event rejected" } }; }
}

export function widgetCommand<T extends WidgetCommand>(message: T): T { return parseWidgetCommand(message) as T; }
export function widgetEvent<T extends WidgetEvent>(message: T): T { return parseWidgetEvent(message) as T; }
