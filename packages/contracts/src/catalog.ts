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
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  value.forEach((item, index) => hashes ? sha256(item, `${path}.${index}`) : stringValue(item, `${path}.${index}`));
  if (new Set(value).size !== value.length) throw new TypeError(`${path} must not contain duplicates`);
}

function vector(value: unknown, path: string): asserts value is [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new TypeError(`${path} must contain three finite numbers`);
  }
}

export function parseRuntimeCatalogDocument(value: unknown): RuntimeCatalogDocument {
  record(value, "catalog");
  if (value.schemaVersion !== 1) throw new TypeError("catalog.schemaVersion must be 1");
  stringValue(value.tenantId, "catalog.tenantId");
  stringValue(value.defaultSku, "catalog.defaultSku");
  if (!Array.isArray(value.entries) || value.entries.length === 0) throw new TypeError("catalog.entries must be a non-empty array");
  const skus = new Set<string>();
  for (const [index, candidate] of value.entries.entries()) {
    record(candidate, `catalog.entries.${index}`);
    record(candidate.model, `catalog.entries.${index}.model`);
    record(candidate.model.measurements, `catalog.entries.${index}.model.measurements`);
    record(candidate.variant, `catalog.entries.${index}.variant`);
    record(candidate.asset, `catalog.entries.${index}.asset`);
    record(candidate.asset.qualityEnvelope, `catalog.entries.${index}.asset.qualityEnvelope`);
    if (!Array.isArray(candidate.asset.attachmentMatrix)) throw new TypeError(`catalog.entries.${index}.asset.attachmentMatrix must be an array`);
    if (!Array.isArray(candidate.asset.sourceAssetHashes)) throw new TypeError(`catalog.entries.${index}.asset.sourceAssetHashes must be an array`);
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
  if (value.schemaVersion !== 1) throw new TypeError("manifest.schemaVersion must be 1");
  stringValue(value.assetId, "manifest.assetId");
  if (!Number.isInteger(value.assetVersion) || (value.assetVersion as number) < 1) throw new TypeError("manifest.assetVersion must be a positive integer");
  if (typeof value.fixture !== "boolean") throw new TypeError("manifest.fixture must be boolean");
  record(value.generator, "manifest.generator");
  stringValue(value.generator.name, "manifest.generator.name");
  stringValue(value.generator.version, "manifest.generator.version");
  record(value.model, "manifest.model");
  const model = value.model;
  stringValue(model.url, "manifest.model.url");
  sha256(model.sha256, "manifest.model.sha256");
  if (!Number.isSafeInteger(model.byteLength) || (model.byteLength as number) <= 0) throw new TypeError("manifest.model.byteLength must be positive");
  if (model.format !== "glb") throw new TypeError("manifest.model.format must be glb");
  if (model.unit !== "metre") throw new TypeError("manifest.model.unit must be metre");
  record(model.boundsMetres, "manifest.model.boundsMetres");
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
