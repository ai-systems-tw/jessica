export type CatalogFallbackPolicy =
  | { kind: "none" }
  | {
    kind: "explicit-same-model";
    sku: string;
    frameModelId: string;
    frameVariantId: string;
  };

export type CatalogLookupRequest = {
  schemaVersion: 1;
  requestId: string;
  tenantId: string;
  siteId: string;
  environment: "production";
  sku: string;
  frameModelId: string;
  frameVariantId: string;
  fallback: CatalogFallbackPolicy;
};

export const CATALOG_UNAVAILABLE_REASON_CODES = [
  "REQUESTED_SKU_NOT_FOUND",
  "REQUEST_IDENTITY_MISMATCH",
  "REQUESTED_SKU_NOT_ACTIVE",
  "FALLBACK_SKU_NOT_FOUND",
  "FALLBACK_MODEL_MISMATCH",
  "FALLBACK_TARGET_NOT_ACTIVE",
  "DEPLOYMENT_REJECTED",
  "ASSET_CHAIN_REJECTED",
  "PREFETCH_CANCELLED",
  "PREFETCH_LIMIT_REACHED",
  "REQUEST_CANCELLED",
] as const;

export type CatalogUnavailableReasonCode = typeof CATALOG_UNAVAILABLE_REASON_CODES[number];

export type CatalogUnavailableEvent = {
  schemaVersion: 1;
  type: "catalog.asset-unavailable";
  occurredAt: string;
  requestId: string;
  tenantId: string;
  siteId: string;
  environment: "production";
  requestedSku: string;
  requestedFrameModelId: string;
  requestedFrameVariantId: string;
  fallbackKind: CatalogFallbackPolicy["kind"];
  reasonCode: CatalogUnavailableReasonCode;
};

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`);
  }
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).find((key) => !expected.has(key));
  if (unknown) throw new TypeError(`${path} contains an unknown field`);
  const missing = keys.find((key) => !(key in value));
  if (missing) throw new TypeError(`${path} is missing a required field`);
}

function identifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`${path} must be a bounded identifier`);
  }
}

function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  }
}

export function parseCatalogLookupRequest(value: unknown): CatalogLookupRequest {
  object(value, "catalog request");
  exact(value, ["schemaVersion", "requestId", "tenantId", "siteId", "environment", "sku", "frameModelId", "frameVariantId", "fallback"], "catalog request");
  if (value.schemaVersion !== 1) throw new TypeError("catalog request schemaVersion must be 1");
  identifier(value.requestId, "catalog request requestId");
  identifier(value.tenantId, "catalog request tenantId");
  identifier(value.siteId, "catalog request siteId");
  if (value.environment !== "production") throw new TypeError("catalog request environment must be production");
  identifier(value.sku, "catalog request sku");
  identifier(value.frameModelId, "catalog request frameModelId");
  identifier(value.frameVariantId, "catalog request frameVariantId");
  object(value.fallback, "catalog request fallback");
  if (value.fallback.kind === "none") {
    exact(value.fallback, ["kind"], "catalog request fallback");
  } else if (value.fallback.kind === "explicit-same-model") {
    exact(value.fallback, ["kind", "sku", "frameModelId", "frameVariantId"], "catalog request fallback");
    identifier(value.fallback.sku, "catalog request fallback sku");
    identifier(value.fallback.frameModelId, "catalog request fallback frameModelId");
    identifier(value.fallback.frameVariantId, "catalog request fallback frameVariantId");
    if (value.fallback.sku === value.sku) throw new TypeError("catalog request fallback SKU must differ from requested SKU");
    if (value.fallback.frameVariantId === value.frameVariantId) throw new TypeError("catalog request fallback variant must differ from requested variant");
  } else {
    throw new TypeError("catalog request fallback kind is unsupported");
  }
  const fallback: CatalogFallbackPolicy = value.fallback.kind === "none"
    ? Object.freeze({ kind: "none" })
    : Object.freeze({
      kind: "explicit-same-model",
      sku: value.fallback.sku as string,
      frameModelId: value.fallback.frameModelId as string,
      frameVariantId: value.fallback.frameVariantId as string,
    });
  return Object.freeze({
    schemaVersion: 1,
    requestId: value.requestId as string,
    tenantId: value.tenantId as string,
    siteId: value.siteId as string,
    environment: "production",
    sku: value.sku,
    frameModelId: value.frameModelId,
    frameVariantId: value.frameVariantId,
    fallback,
  });
}

export function parseCatalogUnavailableEvent(value: unknown): CatalogUnavailableEvent {
  object(value, "catalog unavailable event");
  exact(value, ["schemaVersion", "type", "occurredAt", "requestId", "tenantId", "siteId", "environment", "requestedSku", "requestedFrameModelId", "requestedFrameVariantId", "fallbackKind", "reasonCode"], "catalog unavailable event");
  if (value.schemaVersion !== 1 || value.type !== "catalog.asset-unavailable") throw new TypeError("catalog unavailable event version or type is unsupported");
  timestamp(value.occurredAt, "catalog unavailable event occurredAt");
  for (const key of ["requestId", "tenantId", "siteId", "requestedSku", "requestedFrameModelId", "requestedFrameVariantId"] as const) identifier(value[key], `catalog unavailable event ${key}`);
  if (value.environment !== "production") throw new TypeError("catalog unavailable event environment must be production");
  if (value.fallbackKind !== "none" && value.fallbackKind !== "explicit-same-model") throw new TypeError("catalog unavailable event fallbackKind is unsupported");
  if (!CATALOG_UNAVAILABLE_REASON_CODES.includes(value.reasonCode as CatalogUnavailableReasonCode)) throw new TypeError("catalog unavailable event reasonCode is unsupported");
  return Object.freeze({
    schemaVersion: 1,
    type: "catalog.asset-unavailable",
    occurredAt: value.occurredAt,
    requestId: value.requestId as string,
    tenantId: value.tenantId as string,
    siteId: value.siteId as string,
    environment: "production",
    requestedSku: value.requestedSku as string,
    requestedFrameModelId: value.requestedFrameModelId as string,
    requestedFrameVariantId: value.requestedFrameVariantId as string,
    fallbackKind: value.fallbackKind,
    reasonCode: value.reasonCode as CatalogUnavailableReasonCode,
  });
}
