import {
  parseAssetManifest,
  parseRuntimeCatalogDocument,
  type AssetManifest,
  type DeploymentPointer,
  type RuntimeCatalogEntry,
} from "../../../packages/contracts/src/index.js";
import { validateGlb } from "../../../packages/assets/src/index.js";
import { assertAssetAdmission, type RuntimeAsset, type RuntimeMode } from "../../../packages/runtime/src/index.js";
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
};

function equalArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value.toLowerCase() === right[index]?.toLowerCase());
}

async function digestHex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function assertAllowedOrigin(url: URL, allowedOrigins: ReadonlySet<string>): void {
  if (!allowedOrigins.has(url.origin)) throw new Error(`runtime asset origin is not allowed: ${url.origin}`);
}

async function checkedFetch(url: URL, fetchFn: FetchLike, allowedOrigins: ReadonlySet<string>): Promise<Response> {
  assertAllowedOrigin(url, allowedOrigins);
  const response = await fetchFn(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  if (!response.ok) throw new Error(`${url.href} returned HTTP ${response.status}`);
  if (response.url) assertAllowedOrigin(new URL(response.url), allowedOrigins);
  return response;
}

async function loadCatalogAsset(options: {
  catalogUrl: string | URL;
  mode: RuntimeMode;
  sku?: string;
  allowedOrigins?: readonly string[];
  fetchFn?: FetchLike;
  deployment?: DeploymentPointer;
}): Promise<VerifiedRuntimeAsset> {
  const fetchFn = options.fetchFn ?? fetch;
  const catalogUrl = new URL(options.catalogUrl, typeof location === "undefined" ? "http://localhost/" : location.href);
  const allowedOrigins = new Set(options.allowedOrigins ?? [catalogUrl.origin]);
  if (options.mode === "public-live" && !options.deployment) throw new Error("public-live requires a verified active deployment");
  if (options.deployment && catalogUrl.href !== options.deployment.catalogUrl) throw new Error("catalog URL does not match verified deployment");
  const catalogResponse = await checkedFetch(catalogUrl, fetchFn, allowedOrigins);
  const catalogBytes = await catalogResponse.arrayBuffer();
  const catalogHash = await digestHex(catalogBytes);
  if (options.deployment && catalogHash !== options.deployment.asset.catalogSha256) throw new Error("catalog SHA-256 does not match verified deployment");
  let catalogValue: unknown;
  try { catalogValue = JSON.parse(new TextDecoder().decode(catalogBytes)); } catch { throw new Error("runtime catalog JSON is invalid"); }
  const catalog = parseRuntimeCatalogDocument(catalogValue);
  if (options.deployment && catalog.tenantId !== options.deployment.tenantId) throw new Error("catalog tenant does not match verified deployment");
  const sku = options.deployment?.selector.sku ?? options.sku ?? catalog.defaultSku;
  if (options.deployment && options.sku !== undefined && options.sku !== sku) throw new Error("requested SKU does not match verified deployment");
  const entry = catalog.entries.find((candidate) => candidate.variant.sku === sku);
  if (!entry) throw new Error(`catalog SKU not found: ${sku}`);
  if (options.deployment) {
    const pointer = options.deployment;
    if (entry.model.id !== pointer.selector.frameModelId || entry.variant.id !== pointer.selector.frameVariantId) throw new Error("catalog frame selection does not match verified deployment");
    if (entry.asset.id !== pointer.asset.assetId || entry.asset.version !== pointer.asset.assetVersion) throw new Error("catalog asset identity does not match verified deployment");
    if (entry.asset.manifestSha256?.toLowerCase() !== pointer.asset.manifestSha256) throw new Error("catalog manifest hash does not match verified deployment");
  }
  assertAssetAdmission({ mode: options.mode, asset: entry.asset, fixture: options.mode === "calibration" });
  const manifestUrl = new URL(entry.asset.manifestUrl, catalogUrl);
  const manifestResponse = await checkedFetch(manifestUrl, fetchFn, allowedOrigins);
  const manifestBytes = await manifestResponse.arrayBuffer();
  const manifestHash = await digestHex(manifestBytes);
  if (manifestHash !== entry.asset.manifestSha256?.toLowerCase()) throw new Error("asset manifest SHA-256 mismatch");
  if (options.deployment && manifestHash !== options.deployment.asset.manifestSha256) throw new Error("manifest SHA-256 does not match verified deployment");
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new Error("asset manifest JSON is invalid"); }
  const manifest = parseAssetManifest(manifestValue);
  assertAssetAdmission({ mode: options.mode, asset: entry.asset, fixture: manifest.fixture });
  if (manifest.assetId !== entry.asset.id || manifest.assetVersion !== entry.asset.version) throw new Error("manifest identity does not match catalog asset");
  if (!equalArrays(manifest.sourceAssetHashes, entry.asset.sourceAssetHashes)) throw new Error("manifest source hashes do not match catalog provenance");
  if (!manifest.fixture && manifest.sourceAssetHashes.length === 0) throw new Error("published runtime assets require source hashes");
  const modelUrl = new URL(manifest.model.url, manifestUrl);
  if (modelUrl.href !== new URL(entry.asset.modelUrl, catalogUrl).href) throw new Error("manifest model URL does not match catalog asset");
  const modelResponse = await checkedFetch(modelUrl, fetchFn, allowedOrigins);
  const bytes = await modelResponse.arrayBuffer();
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
  return {
    asset: { ...entry.asset, modelUrl: modelUrl.href, manifestUrl: manifestUrl.href },
    verifiedGlb: { bytes, baseUrl: new URL("./", modelUrl).href, sha256: modelHash },
    catalogEntry: entry,
    manifest,
    ...(options.deployment ? { deployment: options.deployment } : {}),
  };
}

export async function loadVerifiedRuntimeAsset(options: {
  catalogUrl: string | URL;
  mode: RuntimeMode;
  sku?: string;
  allowedOrigins?: readonly string[];
  fetchFn?: FetchLike;
}): Promise<VerifiedRuntimeAsset> {
  if (options.mode === "public-live") throw new Error("public-live is available only through loadDeployedRuntimeAsset");
  return loadCatalogAsset(options);
}

export async function loadDeployedRuntimeAsset(options: {
  deploymentUrl: string | URL;
  selection: DeploymentSelection;
  trust: DeploymentTrustConfiguration;
  receiptStore: DeploymentReceiptStore;
  fetchFn?: FetchLike;
  nowEpochMs?: number;
}): Promise<VerifiedRuntimeAsset> {
  if (options.selection.environment !== "production") throw new Error("public-live requires a production deployment selection");
  if (!options.receiptStore || typeof options.receiptStore.read !== "function" || typeof options.receiptStore.commit !== "function") {
    throw new Error("public-live requires a monotonic deployment receipt store");
  }
  const fetchFn = options.fetchFn ?? fetch;
  const verified = await verifyDeploymentEnvelope({
    deploymentUrl: options.deploymentUrl,
    selection: options.selection,
    trust: options.trust,
    receiptStore: options.receiptStore,
    fetchFn,
    nowEpochMs: options.nowEpochMs ?? Date.now(),
  });
  const asset = await loadCatalogAsset({
    catalogUrl: verified.pointer.catalogUrl,
    mode: "public-live",
    sku: verified.pointer.selector.sku,
    allowedOrigins: [verified.pointer.allowedOrigin],
    fetchFn,
    deployment: verified.pointer,
  });
  await options.receiptStore.commit(verified.scope, verified.priorReceipt, acceptedDeploymentReceipt(verified));
  return asset;
}
