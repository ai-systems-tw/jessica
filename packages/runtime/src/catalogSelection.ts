import type {
  CatalogLookupRequest,
  CatalogUnavailableReasonCode,
  DeploymentPointer,
  RuntimeCatalogEntry,
} from "../../contracts/src/index.js";

export type CatalogSelectionDecision =
  | { ok: true; entry: RuntimeCatalogEntry; fallbackApplied: boolean }
  | { ok: false; reasonCode: Extract<CatalogUnavailableReasonCode,
    "REQUESTED_SKU_NOT_FOUND" | "REQUEST_IDENTITY_MISMATCH" | "REQUESTED_SKU_NOT_ACTIVE" |
    "FALLBACK_SKU_NOT_FOUND" | "FALLBACK_MODEL_MISMATCH" | "FALLBACK_TARGET_NOT_ACTIVE"> };

function matchesRequest(entry: RuntimeCatalogEntry, request: CatalogLookupRequest): boolean {
  return entry.model.id === request.frameModelId && entry.variant.id === request.frameVariantId;
}

function matchesDeployment(entry: RuntimeCatalogEntry, pointer: DeploymentPointer): boolean {
  return entry.tenantId === pointer.tenantId
    && entry.variant.sku === pointer.selector.sku
    && entry.model.id === pointer.selector.frameModelId
    && entry.variant.id === pointer.selector.frameVariantId
    && entry.asset.id === pointer.asset.assetId
    && entry.asset.version === pointer.asset.assetVersion
    && entry.asset.manifestSha256?.toLowerCase() === pointer.asset.manifestSha256;
}

export function evaluateCatalogSelection(input: {
  request: CatalogLookupRequest;
  entries: readonly RuntimeCatalogEntry[];
  deployment: DeploymentPointer;
}): CatalogSelectionDecision {
  const { request, entries, deployment } = input;
  const requested = entries.find((entry) => entry.variant.sku === request.sku);
  if (requested) {
    if (!matchesRequest(requested, request)) return { ok: false, reasonCode: "REQUEST_IDENTITY_MISMATCH" };
    if (!matchesDeployment(requested, deployment)) return { ok: false, reasonCode: "REQUESTED_SKU_NOT_ACTIVE" };
    return { ok: true, entry: requested, fallbackApplied: false };
  }
  if (request.fallback.kind === "none") return { ok: false, reasonCode: "REQUESTED_SKU_NOT_FOUND" };
  const policy = request.fallback;
  if (policy.frameModelId !== request.frameModelId) return { ok: false, reasonCode: "FALLBACK_MODEL_MISMATCH" };
  const fallback = entries.find((entry) => entry.variant.sku === policy.sku);
  if (!fallback) return { ok: false, reasonCode: "FALLBACK_SKU_NOT_FOUND" };
  if (fallback.model.id !== request.frameModelId
    || fallback.variant.id !== policy.frameVariantId
    || fallback.model.id !== policy.frameModelId) {
    return { ok: false, reasonCode: "FALLBACK_MODEL_MISMATCH" };
  }
  if (!matchesDeployment(fallback, deployment)) return { ok: false, reasonCode: "FALLBACK_TARGET_NOT_ACTIVE" };
  return { ok: true, entry: fallback, fallbackApplied: true };
}
