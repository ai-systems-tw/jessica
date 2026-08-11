import { parseCommerceProductAttribution, type CommerceEvent, type CommerceProductAttribution } from "../../../packages/contracts/src/index.js";
import { CommerceEventSession, type CommerceEventSessionOptions } from "../../../packages/commerce-events/src/index.js";
import { verifiedPublicLiveAssetProof, type VerifiedRuntimeAsset } from "./runtimeCatalog.js";

function sameProduct(left: CommerceProductAttribution, right: CommerceProductAttribution): boolean {
  return left.sku === right.sku && left.frameModelId === right.frameModelId && left.frameVariantId === right.frameVariantId
    && left.assetId === right.assetId && left.assetVersion === right.assetVersion && left.deploymentId === right.deploymentId
    && left.catalogSha256 === right.catalogSha256 && left.manifestSha256 === right.manifestSha256 && left.modelSha256 === right.modelSha256;
}

export function commerceProductAttributionFromVerifiedRuntimeAsset(value: unknown): CommerceProductAttribution | null {
  const proof = verifiedPublicLiveAssetProof(value);
  if (proof === null) return null;
  try {
    return parseCommerceProductAttribution({
      sku: proof.sku, frameModelId: proof.frameModelId, frameVariantId: proof.frameVariantId,
      assetId: proof.assetId, assetVersion: proof.assetVersion, deploymentId: proof.deploymentId,
      catalogSha256: proof.catalogSha256, manifestSha256: proof.manifestSha256, modelSha256: proof.modelSha256,
    });
  } catch { return null; }
}

export type VerifiedRuntimeCommerceScope = Readonly<{ tenantId: string; siteId: string; environment: "production" }>;
const VERIFIED_COMMERCE_REGISTRIES = new WeakSet<object>();

function parseScope(value: unknown): VerifiedRuntimeCommerceScope {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("commerce registry scope must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== 3 || !descriptors.tenantId || !descriptors.siteId || !descriptors.environment || Object.values(descriptors).some((descriptor) => !descriptor.enumerable || descriptor.get || descriptor.set)) throw new TypeError("commerce registry scope fields are invalid");
  const tenantId = descriptors.tenantId.value;
  const siteId = descriptors.siteId.value;
  const environment = descriptors.environment.value;
  if (typeof tenantId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(tenantId)) throw new TypeError("commerce registry tenantId is invalid");
  if (typeof siteId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(siteId)) throw new TypeError("commerce registry siteId is invalid");
  if (environment !== "production") throw new TypeError("commerce registry environment must be production");
  return Object.freeze({ tenantId, siteId, environment: "production" });
}

export class VerifiedRuntimeCommerceProductRegistry {
  readonly #products = new Map<string, CommerceProductAttribution>();
  readonly #scope: VerifiedRuntimeCommerceScope;

  constructor(scope: unknown) { this.#scope = parseScope(scope); VERIFIED_COMMERCE_REGISTRIES.add(this); }
  get scope(): VerifiedRuntimeCommerceScope { return this.#scope; }

  register(value: VerifiedRuntimeAsset | unknown): boolean {
    const proof = verifiedPublicLiveAssetProof(value);
    if (proof === null || proof.tenantId !== this.#scope.tenantId || proof.siteId !== this.#scope.siteId || proof.environment !== this.#scope.environment) return false;
    const attribution = commerceProductAttributionFromVerifiedRuntimeAsset(value);
    if (attribution === null) return false;
    const existing = this.#products.get(attribution.sku);
    if (existing && !sameProduct(existing, attribution)) return false;
    this.#products.set(attribution.sku, attribution);
    return true;
  }

  resolve(scope: unknown, sku: string): CommerceProductAttribution | null {
    let requested: VerifiedRuntimeCommerceScope;
    try { requested = parseScope(scope); } catch { return null; }
    if (requested.tenantId !== this.#scope.tenantId || requested.siteId !== this.#scope.siteId || requested.environment !== this.#scope.environment) return null;
    return this.#products.get(sku) ?? null;
  }
}

export type ProductionCommerceEventSessionOptions = Omit<CommerceEventSessionOptions, "environment" | "localProductForSku"> & {
  environment: "production";
  productRegistry: VerifiedRuntimeCommerceProductRegistry;
  emit(event: CommerceEvent): void | Promise<void>;
};

/** The production construction path accepts only loader-registered public-live products. */
export function createProductionCommerceEventSession(options: ProductionCommerceEventSessionOptions): CommerceEventSession {
  if (!VERIFIED_COMMERCE_REGISTRIES.has(options.productRegistry)) throw new TypeError("production commerce session requires a verified scoped registry");
  if (options.environment !== "production") throw new TypeError("production commerce session environment must be production");
  if (options.tenantId !== options.productRegistry.scope.tenantId || options.siteId !== options.productRegistry.scope.siteId || options.environment !== options.productRegistry.scope.environment) throw new TypeError("production commerce session scope does not match product registry");
  return new CommerceEventSession({
    tenantId: options.tenantId, siteId: options.siteId, environment: "production", sessionId: options.sessionId,
    nextEventId: options.nextEventId, nowEpochMs: options.nowEpochMs,
    localProductForSku: (sku) => options.productRegistry.resolve(options.productRegistry.scope, sku), emit: options.emit,
  });
}
