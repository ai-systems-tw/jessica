import type { RuntimeCatalogEntry } from "./frame.js";
import { validateRuntimeCatalogEntry } from "./frame.js";

export type Vector3Tuple = readonly [number, number, number];

export type AssetManifest = {
  schemaVersion: 1;
  assetId: string;
  assetVersion: number;
  fixture: boolean;
  generator: { name: string; version: string };
  model: {
    url: string;
    sha256: string;
    byteLength: number;
    format: "glb";
    unit: "metre";
    boundsMetres: { min: Vector3Tuple; max: Vector3Tuple };
    requiredNodes: readonly string[];
  };
  sourceAssetHashes: readonly string[];
};

export type RuntimeCatalogDocument = {
  schemaVersion: 1;
  tenantId: string;
  defaultSku: string;
  entries: readonly RuntimeCatalogEntry[];
};

function record(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`);
  }
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path} contains an unknown field`);
  const missing = required.find((key) => !(key in value));
  if (missing) throw new TypeError(`${path} is missing a required field`);
}

function array(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${path} must be a plain array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const unexpected = Object.keys(descriptors).find((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key));
  if (unexpected) throw new TypeError(`${path} contains an invalid array field`);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`);
  }
}

function stringValue(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-blank string`);
}

function sha256(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a 64-character SHA-256 hex digest`);
  }
}

function stringArray(value: unknown, path: string, hashes = false): asserts value is string[] {
  array(value, path);
  value.forEach((item, index) => hashes ? sha256(item, `${path}.${index}`) : stringValue(item, `${path}.${index}`));
  if (new Set(value).size !== value.length) throw new TypeError(`${path} must not contain duplicates`);
}

function vector(value: unknown, path: string): asserts value is [number, number, number] {
  array(value, path);
  if (value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new TypeError(`${path} must contain three finite numbers`);
  }
}

export function parseRuntimeCatalogDocument(value: unknown): RuntimeCatalogDocument {
  record(value, "catalog");
  exactKeys(value, ["schemaVersion", "tenantId", "defaultSku", "entries"], [], "catalog");
  if (value.schemaVersion !== 1) throw new TypeError("catalog.schemaVersion must be 1");
  stringValue(value.tenantId, "catalog.tenantId");
  stringValue(value.defaultSku, "catalog.defaultSku");
  array(value.entries, "catalog.entries");
  if (value.entries.length === 0) throw new TypeError("catalog.entries must be a non-empty array");
  const skus = new Set<string>();
  for (const [index, candidate] of value.entries.entries()) {
    record(candidate, `catalog.entries.${index}`);
    record(candidate.model, `catalog.entries.${index}.model`);
    record(candidate.model.measurements, `catalog.entries.${index}.model.measurements`);
    record(candidate.variant, `catalog.entries.${index}.variant`);
    record(candidate.asset, `catalog.entries.${index}.asset`);
    record(candidate.asset.qualityEnvelope, `catalog.entries.${index}.asset.qualityEnvelope`);
    exactKeys(candidate, ["schemaVersion", "tenantId", "model", "variant", "asset"], [], `catalog.entries.${index}`);
    exactKeys(candidate.model, ["id", "tenantId", "modelCode", "name", "measurements"], [], `catalog.entries.${index}.model`);
    exactKeys(candidate.model.measurements, ["lensWidthMm", "bridgeWidthMm", "templeLengthMm", "frameWidthMm", "lensHeightMm"], ["frameThicknessMm", "pantoscopicTiltDeg", "faceWrapDeg"], `catalog.entries.${index}.model.measurements`);
    exactKeys(candidate.variant, ["id", "tenantId", "frameModelId", "sku", "frameColor", "frameMaterial", "lensType"], ["lensColor", "visibleLightTransmissionPct", "commerceProductId"], `catalog.entries.${index}.variant`);
    exactKeys(candidate.asset, ["id", "tenantId", "frameModelId", "version", "quality", "generationMethod", "modelUrl", "manifestUrl", "manifestSha256", "sourceAssetHashes", "attachmentMatrix", "qualityEnvelope", "status"], [], `catalog.entries.${index}.asset`);
    exactKeys(candidate.asset.qualityEnvelope, ["maxYawDeg", "maxPitchDeg", "recommendedForLive", "scaleConfidence"], [], `catalog.entries.${index}.asset.qualityEnvelope`);
    array(candidate.asset.attachmentMatrix, `catalog.entries.${index}.asset.attachmentMatrix`);
    array(candidate.asset.sourceAssetHashes, `catalog.entries.${index}.asset.sourceAssetHashes`);
    const entry = candidate as RuntimeCatalogEntry;
    const issues = validateRuntimeCatalogEntry(entry);
    if (issues.length > 0) throw new TypeError(`catalog.entries.${index}.${issues[0]?.path}: ${issues[0]?.message}`);
    if (entry.tenantId !== value.tenantId) throw new TypeError(`catalog.entries.${index}.tenantId must match catalog tenant`);
    sha256(entry.asset.manifestSha256, `catalog.entries.${index}.asset.manifestSha256`);
    stringArray(entry.asset.sourceAssetHashes, `catalog.entries.${index}.asset.sourceAssetHashes`, true);
    if (skus.has(entry.variant.sku)) throw new TypeError(`catalog.entries.${index}.variant.sku must be unique`);
    skus.add(entry.variant.sku);
  }
  if (!skus.has(value.defaultSku)) throw new TypeError("catalog.defaultSku must reference an entry");
  return value as unknown as RuntimeCatalogDocument;
}

export function parseAssetManifest(value: unknown): AssetManifest {
  record(value, "manifest");
  // `proxyGeneration` is the established calibration-only manifest extension. It is
  // parsed by the frame-generation boundary; the runtime never reads it as authority.
  exactKeys(value, ["schemaVersion", "assetId", "assetVersion", "fixture", "generator", "model", "sourceAssetHashes"], ["proxyGeneration"], "manifest");
  if (value.schemaVersion !== 1) throw new TypeError("manifest.schemaVersion must be 1");
  stringValue(value.assetId, "manifest.assetId");
  if (!Number.isInteger(value.assetVersion) || (value.assetVersion as number) < 1) throw new TypeError("manifest.assetVersion must be a positive integer");
  if (typeof value.fixture !== "boolean") throw new TypeError("manifest.fixture must be boolean");
  record(value.generator, "manifest.generator");
  exactKeys(value.generator, ["name", "version"], [], "manifest.generator");
  stringValue(value.generator.name, "manifest.generator.name");
  stringValue(value.generator.version, "manifest.generator.version");
  record(value.model, "manifest.model");
  const model = value.model;
  exactKeys(model, ["url", "sha256", "byteLength", "format", "unit", "boundsMetres", "requiredNodes"], [], "manifest.model");
  stringValue(model.url, "manifest.model.url");
  sha256(model.sha256, "manifest.model.sha256");
  if (!Number.isSafeInteger(model.byteLength) || (model.byteLength as number) <= 0) throw new TypeError("manifest.model.byteLength must be positive");
  if (model.format !== "glb") throw new TypeError("manifest.model.format must be glb");
  if (model.unit !== "metre") throw new TypeError("manifest.model.unit must be metre");
  record(model.boundsMetres, "manifest.model.boundsMetres");
  exactKeys(model.boundsMetres, ["min", "max"], [], "manifest.model.boundsMetres");
  const bounds = model.boundsMetres;
  const min = bounds.min;
  const max = bounds.max;
  vector(min, "manifest.model.boundsMetres.min");
  vector(max, "manifest.model.boundsMetres.max");
  if (min.some((item, index) => item >= max[index]!)) throw new TypeError("manifest.model.boundsMetres must have positive extent");
  stringArray(model.requiredNodes, "manifest.model.requiredNodes");
  if (model.requiredNodes.length === 0) throw new TypeError("manifest.model.requiredNodes must not be empty");
  stringArray(value.sourceAssetHashes, "manifest.sourceAssetHashes", true);
  return value as unknown as AssetManifest;
}
