import {
  parseAssetManifest,
  parseRuntimeCatalogDocument,
  type AssetManifest,
  type RuntimeCatalogEntry,
} from "../../../packages/contracts/src/index.js";
import { assertAssetAdmission, type RuntimeAsset, type RuntimeMode } from "../../../packages/runtime/src/index.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type VerifiedRuntimeAsset = RuntimeAsset & {
  verifiedGlb: { bytes: ArrayBuffer; baseUrl: string; sha256: string };
  catalogEntry: RuntimeCatalogEntry;
  manifest: AssetManifest;
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

function readGlb(bytes: ArrayBuffer): { json: Record<string, unknown>; binary: ArrayBuffer } {
  const view = new DataView(bytes);
  if (bytes.byteLength < 20) throw new Error("GLB is shorter than its header and JSON chunk");
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("GLB magic header is invalid");
  if (view.getUint32(4, true) !== 2) throw new Error("GLB version must be 2");
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error("GLB declared length does not match actual bytes");
  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let binary: ArrayBuffer | null = null;
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("GLB chunk header is truncated");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 !== 0 || offset + length > bytes.byteLength) throw new Error("GLB chunk length is invalid");
    if (chunkIndex === 0 && type !== 0x4e4f534a) throw new Error("GLB first chunk must be JSON");
    if (type === 0x4e4f534a) {
      if (json) throw new Error("GLB contains multiple JSON chunks");
      try {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, offset, length)).trim()) as Record<string, unknown>;
      } catch { throw new Error("GLB JSON chunk is invalid"); }
    } else if (type === 0x004e4942) {
      if (binary) throw new Error("GLB contains multiple BIN chunks");
      binary = bytes.slice(offset, offset + length);
    } else {
      throw new Error("GLB contains an unsupported chunk type");
    }
    offset += length;
    chunkIndex += 1;
  }
  if (offset !== bytes.byteLength || !json || !binary) throw new Error("GLB must contain exactly one JSON and one BIN chunk");
  return { json, binary };
}

function validateGlbDocument(json: Record<string, unknown>, binary: ArrayBuffer, manifest: AssetManifest): void {
  const asset = json.asset as Record<string, unknown> | undefined;
  if (!asset || asset.version !== "2.0") throw new Error("GLB glTF asset.version must be 2.0");
  if (!Array.isArray(json.nodes)) throw new Error("GLB nodes must be an array");
  if (!Array.isArray(json.scenes) || !Number.isInteger(json.scene)) throw new Error("GLB active scene is required");
  const activeScene = json.scenes[json.scene as number] as Record<string, unknown> | undefined;
  if (!activeScene || !Array.isArray(activeScene.nodes)) throw new Error("GLB active scene nodes are invalid");
  const reachable = new Set<number>();
  const visit = (index: number): void => {
    if (!Number.isInteger(index) || index < 0 || index >= (json.nodes as unknown[]).length) throw new Error("GLB scene node reference is invalid");
    if (reachable.has(index)) return;
    reachable.add(index);
    const children = ((json.nodes as unknown[])[index] as Record<string, unknown>).children;
    if (children === undefined) return;
    if (!Array.isArray(children)) throw new Error("GLB node children must be an array");
    children.forEach((child) => visit(child as number));
  };
  activeScene.nodes.forEach((node) => visit(node as number));
  const nodeNames = json.nodes.map((node) => (node as Record<string, unknown>)?.name).filter((name): name is string => typeof name === "string");
  for (const required of manifest.model.requiredNodes) {
    const count = nodeNames.filter((name) => name === required).length;
    if (count !== 1) throw new Error(`GLB required node must occur exactly once: ${required}`);
    const index = json.nodes.findIndex((node) => (node as Record<string, unknown>)?.name === required);
    if (!reachable.has(index)) throw new Error(`GLB required node is not reachable from the active scene: ${required}`);
  }
  if (!Array.isArray(json.meshes) || !Array.isArray(json.accessors) || !Array.isArray(json.bufferViews) || !Array.isArray(json.buffers)) throw new Error("GLB buffers, views, accessors, and meshes must be arrays");
  if (json.buffers.length !== 1) throw new Error("GLB supported profile requires exactly one embedded buffer");
  const buffer = json.buffers[0] as Record<string, unknown>;
  if (buffer.uri !== undefined || !Number.isInteger(buffer.byteLength) || (buffer.byteLength as number) > binary.byteLength) throw new Error("GLB embedded buffer declaration is invalid");
  const declaredBounds: number[][] = [];
  const actualBounds: number[][] = [];
  for (const mesh of json.meshes) {
    const primitives = (mesh as Record<string, unknown>).primitives;
    if (!Array.isArray(primitives)) throw new Error("GLB mesh primitives must be an array");
    for (const primitive of primitives) {
      const attributes = (primitive as Record<string, unknown>).attributes as Record<string, unknown> | undefined;
      const positionIndex = attributes?.POSITION;
      if (!Number.isInteger(positionIndex)) throw new Error("GLB primitive POSITION accessor is required");
      const accessor = json.accessors[positionIndex as number] as Record<string, unknown> | undefined;
      if (!accessor || accessor.type !== "VEC3" || accessor.componentType !== 5126) throw new Error("GLB POSITION accessor must be FLOAT VEC3");
      const min = accessor.min; const max = accessor.max;
      if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) throw new Error("GLB POSITION bounds are required");
      if ([...min, ...max].some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("GLB POSITION bounds must contain finite numbers");
      if (!Number.isInteger(accessor.bufferView) || !Number.isInteger(accessor.count) || (accessor.count as number) <= 0) throw new Error("GLB POSITION accessor range is invalid");
      const bufferView = json.bufferViews[accessor.bufferView as number] as Record<string, unknown> | undefined;
      if (!bufferView || bufferView.buffer !== 0 || !Number.isInteger(bufferView.byteLength)) throw new Error("GLB POSITION bufferView is invalid");
      const viewOffset = typeof bufferView.byteOffset === "number" ? bufferView.byteOffset : 0;
      const accessorOffset = typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0;
      const stride = typeof bufferView.byteStride === "number" ? bufferView.byteStride : 12;
      const count = accessor.count as number;
      const viewLength = bufferView.byteLength as number;
      const accessorEndInView = accessorOffset + (count - 1) * stride + 12;
      if (!Number.isInteger(viewOffset) || !Number.isInteger(accessorOffset) || !Number.isInteger(stride) || stride < 12 || viewOffset < 0 || accessorOffset < 0 || accessorEndInView > viewLength || viewOffset + viewLength > binary.byteLength) throw new Error("GLB POSITION bytes exceed bufferView or BIN chunk");
      const data = new DataView(binary);
      const actualMin = [Infinity, Infinity, Infinity];
      const actualMax = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < count; index += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = data.getFloat32(viewOffset + accessorOffset + index * stride + axis * 4, true);
          if (!Number.isFinite(value)) throw new Error("GLB POSITION contains a non-finite value");
          actualMin[axis] = Math.min(actualMin[axis]!, value);
          actualMax[axis] = Math.max(actualMax[axis]!, value);
        }
      }
      for (const axis of [0, 1, 2]) if (Math.abs(actualMin[axis]! - (min[axis] as number)) > 1e-6 || Math.abs(actualMax[axis]! - (max[axis] as number)) > 1e-6) throw new Error("GLB accessor bounds do not match POSITION bytes");
      declaredBounds.push(min as number[], max as number[]);
      actualBounds.push(actualMin, actualMax);
    }
  }
  if (declaredBounds.length === 0 || actualBounds.length === 0) throw new Error("GLB contains no POSITION bounds");
  const actualMin = [0, 1, 2].map((axis) => Math.min(...actualBounds.filter((_, index) => index % 2 === 0).map((item) => item[axis]!)));
  const actualMax = [0, 1, 2].map((axis) => Math.max(...actualBounds.filter((_, index) => index % 2 === 1).map((item) => item[axis]!)));
  for (const axis of [0, 1, 2]) {
    if (!Number.isFinite(actualMin[axis]) || !Number.isFinite(actualMax[axis]) || Math.abs(actualMin[axis]!) > 5 || Math.abs(actualMax[axis]!) > 5) throw new Error("GLB bounds are invalid for metre units");
    if (Math.abs(actualMin[axis]! - manifest.model.boundsMetres.min[axis]!) > 1e-6 || Math.abs(actualMax[axis]! - manifest.model.boundsMetres.max[axis]!) > 1e-6) throw new Error("GLB POSITION bounds do not match manifest boundsMetres");
  }
}

export async function loadVerifiedRuntimeAsset(options: {
  catalogUrl: string | URL;
  mode: RuntimeMode;
  sku?: string;
  allowedOrigins?: readonly string[];
  fetchFn?: FetchLike;
}): Promise<VerifiedRuntimeAsset> {
  const fetchFn = options.fetchFn ?? fetch;
  const catalogUrl = new URL(options.catalogUrl, typeof location === "undefined" ? "http://localhost/" : location.href);
  const allowedOrigins = new Set(options.allowedOrigins ?? [catalogUrl.origin]);
  const catalogResponse = await checkedFetch(catalogUrl, fetchFn, allowedOrigins);
  const catalog = parseRuntimeCatalogDocument(await catalogResponse.json());
  const sku = options.sku ?? catalog.defaultSku;
  const entry = catalog.entries.find((candidate) => candidate.variant.sku === sku);
  if (!entry) throw new Error(`catalog SKU not found: ${sku}`);
  assertAssetAdmission({ mode: options.mode, asset: entry.asset, fixture: options.mode === "calibration" });
  const manifestUrl = new URL(entry.asset.manifestUrl, catalogUrl);
  const manifestResponse = await checkedFetch(manifestUrl, fetchFn, allowedOrigins);
  const manifestBytes = await manifestResponse.arrayBuffer();
  const manifestHash = await digestHex(manifestBytes);
  if (manifestHash !== entry.asset.manifestSha256?.toLowerCase()) throw new Error("asset manifest SHA-256 mismatch");
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
  const glb = readGlb(bytes);
  validateGlbDocument(glb.json, glb.binary, manifest);
  const widthMm = (manifest.model.boundsMetres.max[0] - manifest.model.boundsMetres.min[0]) * 1_000;
  const expectedWidthMm = entry.model.measurements.frameWidthMm;
  if (Math.abs(widthMm - expectedWidthMm) / expectedWidthMm > 0.15) throw new Error("GLB metre bounds are inconsistent with catalog frame width");
  return {
    asset: { ...entry.asset, modelUrl: modelUrl.href, manifestUrl: manifestUrl.href },
    verifiedGlb: { bytes, baseUrl: new URL("./", modelUrl).href, sha256: modelHash },
    catalogEntry: entry,
    manifest,
  };
}
