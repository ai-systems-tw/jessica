import {
  parseAssetManifest,
  parseRuntimeCatalogDocument,
  type AssetManifest,
  type CatalogLookupRequest,
  type CatalogUnavailableReasonCode,
  type DeploymentPointer,
  type RuntimeCatalogEntry,
} from "../../../packages/contracts/src/index.js";
import { validateGlb } from "../../../packages/assets/src/index.js";
import { assertAssetAdmission, evaluateCatalogSelection, verifyCameraProjectionProfileSet, type CameraProjectionTrust, type RuntimeAsset, type RuntimeMode, type VerifiedCameraProjectionProfileSet } from "../../../packages/runtime/src/index.js";
import {
  acceptedDeploymentReceipt,
  verifyDeploymentEnvelope,
  type DeploymentReceiptStore,
  type DeploymentTrustConfiguration,
} from "./runtimeDeployment.js";
import type { DeploymentSelection } from "../../../packages/runtime/src/index.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type VerifiedRuntimeAsset = RuntimeAsset & {
  verifiedGlb: { bytes: ArrayBuffer; baseUrl: string; sha256: string };
  catalogEntry: RuntimeCatalogEntry;
  manifest: AssetManifest;
  deployment?: DeploymentPointer;
  deploymentFreshnessDeadlineEpochMs?: number;
  cameraProjectionProfileSet?: VerifiedCameraProjectionProfileSet;
  catalogResolution?: { requestedSku: string; selectedSku: string; fallbackApplied: boolean };
};

export type VerifiedPublicLiveAssetProof = Readonly<{
  tenantId: string;
  siteId: string;
  environment: "production";
  deploymentId: string;
  sku: string;
  frameModelId: string;
  frameVariantId: string;
  assetId: string;
  assetVersion: number;
  catalogSha256: string;
  manifestSha256: string;
  modelSha256: string;
  projectionProfileSetId: string;
  projectionProfileSetSha256: string;
}>;

type VerifiedPublicLiveRegistration = {
  proof: VerifiedPublicLiveAssetProof;
  integrityProjection: string;
  projectionProfileSet: VerifiedCameraProjectionProfileSet;
  runtimeAsset: RuntimeAsset["asset"];
  verifiedGlb: VerifiedRuntimeAsset["verifiedGlb"];
};
const VERIFIED_PUBLIC_LIVE_ASSETS = new WeakMap<object, VerifiedPublicLiveRegistration>();
const UNREADABLE = Symbol("unreadable");
const arrayBufferSlice = ArrayBuffer.prototype.slice;

function ownData(value: unknown, key: string): unknown | typeof UNREADABLE {
  if (typeof value !== "object" || value === null) return UNREADABLE;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && descriptor.enumerable ? descriptor.value : UNREADABLE;
  } catch { return UNREADABLE; }
}

function publicLiveIntegrityProjection(value: unknown): string | null {
  const deployment = ownData(value, "deployment");
  const entry = ownData(value, "catalogEntry");
  const runtimeAsset = ownData(value, "asset");
  const manifest = ownData(value, "manifest");
  const verifiedGlb = ownData(value, "verifiedGlb");
  const projectionSet = ownData(value, "cameraProjectionProfileSet");
  const projectionBinding = ownData(deployment, "cameraProjectionProfileSet");
  const selector = ownData(deployment, "selector");
  const deploymentAsset = ownData(deployment, "asset");
  const model = ownData(entry, "model");
  const variant = ownData(entry, "variant");
  const catalogAsset = ownData(entry, "asset");
  const qualityEnvelope = ownData(catalogAsset, "qualityEnvelope");
  const runtimeQualityEnvelope = ownData(runtimeAsset, "qualityEnvelope");
  const manifestModel = ownData(manifest, "model");
  const fields = {
    tenantId: ownData(deployment, "tenantId"), siteId: ownData(deployment, "siteId"), environment: ownData(deployment, "environment"),
    deploymentId: ownData(deployment, "deploymentId"), selectorSku: ownData(selector, "sku"), selectorModel: ownData(selector, "frameModelId"), selectorVariant: ownData(selector, "frameVariantId"),
    deploymentAssetId: ownData(deploymentAsset, "assetId"), deploymentAssetVersion: ownData(deploymentAsset, "assetVersion"), catalogSha256: ownData(deploymentAsset, "catalogSha256"), deploymentManifestSha256: ownData(deploymentAsset, "manifestSha256"), deploymentModelSha256: ownData(deploymentAsset, "modelSha256"),
    modelTenantId: ownData(model, "tenantId"), modelId: ownData(model, "id"), variantTenantId: ownData(variant, "tenantId"), variantId: ownData(variant, "id"), variantModelId: ownData(variant, "frameModelId"), variantSku: ownData(variant, "sku"),
    catalogAssetTenantId: ownData(catalogAsset, "tenantId"), catalogAssetId: ownData(catalogAsset, "id"), catalogAssetModelId: ownData(catalogAsset, "frameModelId"), catalogAssetVersion: ownData(catalogAsset, "version"), catalogManifestSha256: ownData(catalogAsset, "manifestSha256"), catalogStatus: ownData(catalogAsset, "status"), recommendedForLive: ownData(qualityEnvelope, "recommendedForLive"),
    runtimeAssetId: ownData(runtimeAsset, "id"), runtimeAssetTenantId: ownData(runtimeAsset, "tenantId"), runtimeAssetFrameModelId: ownData(runtimeAsset, "frameModelId"), runtimeAssetVersion: ownData(runtimeAsset, "version"), runtimeAssetQuality: ownData(runtimeAsset, "quality"), runtimeAssetGenerationMethod: ownData(runtimeAsset, "generationMethod"), runtimeAssetModelUrl: ownData(runtimeAsset, "modelUrl"), runtimeAssetManifestUrl: ownData(runtimeAsset, "manifestUrl"), runtimeAssetManifestSha256: ownData(runtimeAsset, "manifestSha256"), runtimeAssetSourceHashes: ownData(runtimeAsset, "sourceAssetHashes"), runtimeAssetAttachmentMatrix: ownData(runtimeAsset, "attachmentMatrix"), runtimeAssetMaxYawDeg: ownData(runtimeQualityEnvelope, "maxYawDeg"), runtimeAssetMaxPitchDeg: ownData(runtimeQualityEnvelope, "maxPitchDeg"), runtimeAssetRecommendedForLive: ownData(runtimeQualityEnvelope, "recommendedForLive"), runtimeAssetScaleConfidence: ownData(runtimeQualityEnvelope, "scaleConfidence"), runtimeAssetStatus: ownData(runtimeAsset, "status"),
    manifestAssetId: ownData(manifest, "assetId"), manifestAssetVersion: ownData(manifest, "assetVersion"), manifestFixture: ownData(manifest, "fixture"), manifestModelSha256: ownData(manifestModel, "sha256"), verifiedModelSha256: ownData(verifiedGlb, "sha256"), verifiedModelBaseUrl: ownData(verifiedGlb, "baseUrl"),
    projectionProfileSetId: ownData(projectionBinding, "profileSetId"), projectionProfileSetSha256: ownData(projectionBinding, "sha256"), projectionProfileIds: ownData(projectionSet, "profileIds"),
  };
  if (Object.values(fields).includes(UNREADABLE)) return null;
  try { return JSON.stringify(fields); } catch { return null; }
}

/** Returns only the loader-captured proof for this exact object identity; structural lookalikes have no authority. */
export function verifiedPublicLiveAssetProof(value: unknown): VerifiedPublicLiveAssetProof | null {
  if (typeof value !== "object" || value === null) return null;
  const registered = VERIFIED_PUBLIC_LIVE_ASSETS.get(value);
  if (!registered
    || ownData(value, "asset") !== registered.runtimeAsset
    || ownData(value, "verifiedGlb") !== registered.verifiedGlb
    || ownData(value, "cameraProjectionProfileSet") !== registered.projectionProfileSet
    || publicLiveIntegrityProjection(value) !== registered.integrityProjection) return null;
  return registered.proof;
}

function verifiedGlbView(bytes: ArrayBuffer, baseUrl: string, sha256: string): VerifiedRuntimeAsset["verifiedGlb"] {
  const ownedBytes = Reflect.apply(arrayBufferSlice, bytes, [0]) as ArrayBuffer;
  return Object.freeze({
    get bytes(): ArrayBuffer { return Reflect.apply(arrayBufferSlice, ownedBytes, [0]) as ArrayBuffer; },
    baseUrl,
    sha256,
  });
}

export class CatalogSelectionError extends Error {
  readonly reasonCode: CatalogUnavailableReasonCode;

  constructor(reasonCode: CatalogUnavailableReasonCode) {
    super("catalog selection was unavailable");
    this.name = "CatalogSelectionError";
    this.reasonCode = reasonCode;
  }
}

const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MODEL_BYTES = 32 * 1024 * 1024;

function equalArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value.toLowerCase() === right[index]?.toLowerCase());
}

async function digestHex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function assertAllowedOrigin(url: URL, allowedOrigins: ReadonlySet<string>): void {
  if (url.username !== "" || url.password !== "") throw new Error("runtime asset URL must not contain credentials");
  if (!allowedOrigins.has(url.origin)) throw new Error(`runtime asset origin is not allowed: ${url.origin}`);
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function checkedFetch(url: URL, fetchFn: FetchLike, allowedOrigins: ReadonlySet<string>, signal?: AbortSignal): Promise<Response> {
  assertAllowedOrigin(url, allowedOrigins);
  const response = await fetchFn(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "follow", ...(signal ? { signal } : {}) });
  if (!response.ok) {
    await cancelBody(response);
    throw new Error(`${url.href} returned HTTP ${response.status}`);
  }
  if (response.url) {
    try { assertAllowedOrigin(new URL(response.url), allowedOrigins); }
    catch (error) { await cancelBody(response); throw error; }
  }
  return response;
}

async function boundedBytes(response: Response, maximumBytes: number, label: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await cancelBody(response);
    throw new Error(`${label} exceeds byte limit`);
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds byte limit`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds byte limit`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined.buffer;
}

async function loadCatalogAsset(options: {
  catalogUrl: string | URL;
  mode: RuntimeMode;
  sku?: string;
  allowedOrigins?: readonly string[];
  fetchFn?: FetchLike;
  deployment?: DeploymentPointer;
  catalogRequest?: CatalogLookupRequest;
  signal?: AbortSignal;
  deploymentFreshnessDeadlineEpochMs?: number;
  cameraProjectionProfileSet?: VerifiedCameraProjectionProfileSet;
}): Promise<VerifiedRuntimeAsset> {
  const fetchFn = options.fetchFn ?? fetch;
  const catalogUrl = new URL(options.catalogUrl, typeof location === "undefined" ? "http://localhost/" : location.href);
  const allowedOrigins = new Set((options.allowedOrigins ?? [catalogUrl.origin]).map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) throw new Error("runtime asset origins must be canonical origins");
    return parsed.origin;
  }));
  if (options.mode === "public-live" && !options.deployment) throw new Error("public-live requires a verified active deployment");
  if (options.deployment && catalogUrl.href !== options.deployment.catalogUrl) throw new Error("catalog URL does not match verified deployment");
  const catalogResponse = await checkedFetch(catalogUrl, fetchFn, allowedOrigins, options.signal);
  const catalogBytes = await boundedBytes(catalogResponse, MAX_CATALOG_BYTES, "runtime catalog", options.signal);
  const catalogHash = await digestHex(catalogBytes);
  if (options.deployment && catalogHash !== options.deployment.asset.catalogSha256) throw new Error("catalog SHA-256 does not match verified deployment");
  let catalogValue: unknown;
  try { catalogValue = JSON.parse(new TextDecoder().decode(catalogBytes)); } catch { throw new Error("runtime catalog JSON is invalid"); }
  const catalog = parseRuntimeCatalogDocument(catalogValue);
  if (options.deployment && catalog.tenantId !== options.deployment.tenantId) throw new Error("catalog tenant does not match verified deployment");
  let selectedEntry: RuntimeCatalogEntry | undefined;
  let fallbackApplied = false;
  if (options.catalogRequest) {
    if (!options.deployment) throw new Error("catalog application requests require a verified active deployment");
    const request = options.catalogRequest;
    if (request.tenantId !== options.deployment.tenantId || request.siteId !== options.deployment.siteId || request.environment !== options.deployment.environment) {
      throw new CatalogSelectionError("DEPLOYMENT_REJECTED");
    }
    const decision = evaluateCatalogSelection({ request, entries: catalog.entries, deployment: options.deployment });
    if (!decision.ok) throw new CatalogSelectionError(decision.reasonCode);
    selectedEntry = decision.entry;
    fallbackApplied = decision.fallbackApplied;
  }
  const sku = selectedEntry?.variant.sku ?? options.deployment?.selector.sku ?? options.sku ?? catalog.defaultSku;
  if (options.deployment && options.sku !== undefined && options.sku !== sku) throw new Error("requested SKU does not match verified deployment");
  const entry = selectedEntry ?? catalog.entries.find((candidate) => candidate.variant.sku === sku);
  if (!entry) throw new Error(`catalog SKU not found: ${sku}`);
  if (options.deployment) {
    const pointer = options.deployment;
    if (entry.model.id !== pointer.selector.frameModelId || entry.variant.id !== pointer.selector.frameVariantId) throw new Error("catalog frame selection does not match verified deployment");
    if (entry.asset.id !== pointer.asset.assetId || entry.asset.version !== pointer.asset.assetVersion) throw new Error("catalog asset identity does not match verified deployment");
    if (entry.asset.manifestSha256?.toLowerCase() !== pointer.asset.manifestSha256) throw new Error("catalog manifest hash does not match verified deployment");
  }
  assertAssetAdmission({ mode: options.mode, asset: entry.asset, fixture: options.mode === "calibration" });
  const manifestUrl = new URL(entry.asset.manifestUrl, catalogUrl);
  const manifestResponse = await checkedFetch(manifestUrl, fetchFn, allowedOrigins, options.signal);
  const manifestBytes = await boundedBytes(manifestResponse, MAX_MANIFEST_BYTES, "asset manifest", options.signal);
  const manifestHash = await digestHex(manifestBytes);
  if (manifestHash !== entry.asset.manifestSha256?.toLowerCase()) throw new Error("asset manifest SHA-256 mismatch");
  if (options.deployment && manifestHash !== options.deployment.asset.manifestSha256) throw new Error("manifest SHA-256 does not match verified deployment");
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new Error("asset manifest JSON is invalid"); }
  const manifest = parseAssetManifest(manifestValue);
  if (manifest.model.byteLength > MAX_MODEL_BYTES) throw new Error("GLB model exceeds byte limit");
  assertAssetAdmission({ mode: options.mode, asset: entry.asset, fixture: manifest.fixture });
  if (manifest.assetId !== entry.asset.id || manifest.assetVersion !== entry.asset.version) throw new Error("manifest identity does not match catalog asset");
  if (!equalArrays(manifest.sourceAssetHashes, entry.asset.sourceAssetHashes)) throw new Error("manifest source hashes do not match catalog provenance");
  if (!manifest.fixture && manifest.sourceAssetHashes.length === 0) throw new Error("published runtime assets require source hashes");
  const modelUrl = new URL(manifest.model.url, manifestUrl);
  if (modelUrl.href !== new URL(entry.asset.modelUrl, catalogUrl).href) throw new Error("manifest model URL does not match catalog asset");
  const modelResponse = await checkedFetch(modelUrl, fetchFn, allowedOrigins, options.signal);
  const bytes = await boundedBytes(modelResponse, MAX_MODEL_BYTES, "GLB model", options.signal);
  if (bytes.byteLength !== manifest.model.byteLength) throw new Error("GLB byte length does not match manifest");
  const modelHash = await digestHex(bytes);
  if (modelHash !== manifest.model.sha256.toLowerCase()) throw new Error("GLB SHA-256 mismatch");
  if (options.deployment && modelHash !== options.deployment.asset.modelSha256) throw new Error("GLB SHA-256 does not match verified deployment");
  validateGlb(bytes, {
    requiredNodes: manifest.model.requiredNodes,
    unit: manifest.model.unit,
    expectedBoundsMetres: manifest.model.boundsMetres,
  });
  const widthMm = (manifest.model.boundsMetres.max[0] - manifest.model.boundsMetres.min[0]) * 1_000;
  const expectedWidthMm = entry.model.measurements.frameWidthMm;
  if (Math.abs(widthMm - expectedWidthMm) / expectedWidthMm > 0.15) throw new Error("GLB metre bounds are inconsistent with catalog frame width");
  const runtimeAsset = Object.freeze({
    ...entry.asset,
    modelUrl: modelUrl.href,
    manifestUrl: manifestUrl.href,
    sourceAssetHashes: Object.freeze([...entry.asset.sourceAssetHashes]),
    attachmentMatrix: Object.freeze([...entry.asset.attachmentMatrix]) as RuntimeAsset["asset"]["attachmentMatrix"],
    qualityEnvelope: Object.freeze({ ...entry.asset.qualityEnvelope }),
  });
  const verifiedGlb = verifiedGlbView(bytes, new URL("./", modelUrl).href, modelHash);
  const result: VerifiedRuntimeAsset = {
    asset: runtimeAsset,
    verifiedGlb,
    catalogEntry: entry,
    manifest,
    ...(options.catalogRequest ? { catalogResolution: { requestedSku: options.catalogRequest.sku, selectedSku: entry.variant.sku, fallbackApplied } } : {}),
    ...(options.deployment ? { deployment: options.deployment } : {}),
    ...(options.deploymentFreshnessDeadlineEpochMs !== undefined ? { deploymentFreshnessDeadlineEpochMs: options.deploymentFreshnessDeadlineEpochMs } : {}),
    ...(options.cameraProjectionProfileSet ? { cameraProjectionProfileSet: options.cameraProjectionProfileSet } : {}),
  };
  Object.freeze(result);
  if (options.deployment) {
    const pointer = options.deployment;
    if (pointer.environment !== "production") throw new Error("commerce attribution requires a production deployment");
    if (!pointer.cameraProjectionProfileSet || !options.cameraProjectionProfileSet) throw new Error("public-live requires a Deployment-bound verified camera projection profile set");
    const proof = Object.freeze({
      tenantId: pointer.tenantId, siteId: pointer.siteId, environment: "production", deploymentId: pointer.deploymentId,
      sku: entry.variant.sku, frameModelId: entry.model.id, frameVariantId: entry.variant.id,
      assetId: entry.asset.id, assetVersion: entry.asset.version, catalogSha256: pointer.asset.catalogSha256,
      manifestSha256: manifestHash, modelSha256: modelHash,
      projectionProfileSetId: pointer.cameraProjectionProfileSet.profileSetId,
      projectionProfileSetSha256: pointer.cameraProjectionProfileSet.sha256,
    } satisfies VerifiedPublicLiveAssetProof);
    const integrityProjection = publicLiveIntegrityProjection(result);
    if (integrityProjection === null) throw new Error("verified public-live asset proof could not be registered");
    VERIFIED_PUBLIC_LIVE_ASSETS.set(result, { proof, integrityProjection, projectionProfileSet: options.cameraProjectionProfileSet, runtimeAsset, verifiedGlb });
  }
  return result;
}

export async function loadVerifiedRuntimeAsset(options: {
  catalogUrl: string | URL;
  mode: RuntimeMode;
  sku?: string;
  allowedOrigins?: readonly string[];
  fetchFn?: FetchLike;
  signal?: AbortSignal;
}): Promise<VerifiedRuntimeAsset> {
  if (options.mode === "public-live") throw new Error("public-live is available only through loadDeployedRuntimeAsset");
  if (options.mode === "qa-preview") throw new Error("qa-preview runtime integration is unavailable until the authenticated transport is implemented");
  return loadCatalogAsset(options);
}

export async function loadDeployedRuntimeAsset(options: {
  deploymentUrl: string | URL;
  selection: DeploymentSelection;
  trust: DeploymentTrustConfiguration;
  projectionTrust?: CameraProjectionTrust;
  receiptStore: DeploymentReceiptStore;
  fetchFn?: FetchLike;
  nowEpochMs?: number;
  catalogRequest?: CatalogLookupRequest;
  signal?: AbortSignal;
}): Promise<VerifiedRuntimeAsset> {
  if (options.selection.environment !== "production") throw new Error("public-live requires a production deployment selection");
  if (!options.receiptStore || typeof options.receiptStore.read !== "function" || typeof options.receiptStore.commit !== "function") {
    throw new Error("public-live requires a monotonic deployment receipt store");
  }
  if (options.catalogRequest && (options.catalogRequest.tenantId !== options.selection.tenantId
    || options.catalogRequest.siteId !== options.selection.siteId
    || options.catalogRequest.environment !== options.selection.environment)) {
    throw new CatalogSelectionError("DEPLOYMENT_REJECTED");
  }
  const fetchFn = options.fetchFn ?? fetch;
  let verified;
  try {
    verified = await verifyDeploymentEnvelope({
      deploymentUrl: options.deploymentUrl,
      selection: options.selection,
      trust: options.trust,
      receiptStore: options.receiptStore,
      fetchFn,
      nowEpochMs: options.nowEpochMs ?? Date.now(),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.catalogRequest && !options.signal?.aborted) throw new CatalogSelectionError("DEPLOYMENT_REJECTED");
    throw error;
  }
  let asset: VerifiedRuntimeAsset;
  let cameraProjectionProfileSet: VerifiedCameraProjectionProfileSet | undefined;
  try {
    const binding = verified.pointer.cameraProjectionProfileSet;
    if (options.projectionTrust) {
      if (!binding || !options.trust.allowedCatalogOrigins.includes(binding.allowedOrigin)) throw new Error("deployment camera projection profile set binding is unavailable or outside host policy");
      const response = await checkedFetch(new URL(binding.url), fetchFn, new Set([binding.allowedOrigin]), options.signal);
      const bytes = await boundedBytes(response, 512 * 1024, "camera projection profile set", options.signal);
      if (bytes.byteLength !== binding.byteLength || await digestHex(bytes) !== binding.sha256) throw new Error("camera projection profile set bytes do not match signed Deployment binding");
      let value: unknown; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("camera projection profile set JSON is invalid"); }
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("camera projection profile set document is invalid");
      const document = value as Record<string, unknown>;
      const keys = ["schemaVersion", "type", "profileSetId", "profileSetVersion", "profiles"];
      if (Object.keys(document).length !== keys.length || keys.some((key) => !Object.hasOwn(document, key)) || document.schemaVersion !== 1 || document.type !== "jessica.camera-projection-profile-set" || document.profileSetId !== binding.profileSetId || document.profileSetVersion !== binding.profileSetVersion) throw new Error("camera projection profile set document does not match signed Deployment identity");
      cameraProjectionProfileSet = await verifyCameraProjectionProfileSet(document.profiles, options.projectionTrust);
    } else if (binding) {
      throw new Error("Deployment-bound camera projection profiles require host projection trust");
    }
    asset = await loadCatalogAsset({
      catalogUrl: verified.pointer.catalogUrl,
      mode: "public-live",
      sku: verified.pointer.selector.sku,
      allowedOrigins: [verified.pointer.allowedOrigin],
      fetchFn,
      deployment: verified.pointer,
      deploymentFreshnessDeadlineEpochMs: cameraProjectionProfileSet
        ? Math.min(verified.freshnessDeadlineEpochMs, cameraProjectionProfileSet.admissionDeadlineEpochMs)
        : verified.freshnessDeadlineEpochMs,
      ...(cameraProjectionProfileSet ? { cameraProjectionProfileSet } : {}),
      ...(options.catalogRequest ? { catalogRequest: options.catalogRequest } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof CatalogSelectionError || !options.catalogRequest || options.signal?.aborted) throw error;
    throw new CatalogSelectionError("ASSET_CHAIN_REJECTED");
  }
  await options.receiptStore.commit(verified.scope, verified.priorReceipt, acceptedDeploymentReceipt(verified));
  return asset;
}
