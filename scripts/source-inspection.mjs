import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep, win32 } from "node:path";

const SOURCE_KINDS = new Set([
  "front",
  "left45",
  "right45",
  "leftSide",
  "rightSide",
  "top",
  "marking",
  "annotatedOverview",
  "other",
]);

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const SPEC_KEYS = new Set(["schemaVersion", "tenantId", "frameModelId", "frameVariantId", "sources"]);
const SOURCE_KEYS = new Set([
  "id",
  "kind",
  "relativePath",
  "declaredMimeType",
  "expectedSha256",
  "expectedWidthPx",
  "expectedHeightPx",
]);

export class SourceInspectionError extends Error {
  constructor(code, message, sourceId) {
    super(message);
    this.name = "SourceInspectionError";
    this.code = code;
    this.sourceId = sourceId;
  }
}

function fail(code, sourceId, message) {
  throw new SourceInspectionError(code, `source ${sourceId}: ${message}`, sourceId);
}

function rejectUnknownKeys(value, allowed, sourceId) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("INVALID_SPEC", sourceId, `${key} is not allowed`);
  }
}

function safeSegment(value, field, sourceId = "spec") {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    fail("INVALID_SPEC", sourceId, `${field} must be a non-blank path-safe identifier`);
  }
  return value;
}

function isInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function detectMimeType(bytes, sourceId) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  fail("UNSUPPORTED_IMAGE", sourceId, "magic bytes are not JPEG, PNG, or WebP");
}

function pngDimensions(bytes, sourceId) {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    fail("INVALID_IMAGE", sourceId, "PNG is missing a complete IHDR header");
  }
  const widthPx = bytes.readUInt32BE(16);
  const heightPx = bytes.readUInt32BE(20);
  if (widthPx === 0 || heightPx === 0) {
    fail("INVALID_IMAGE", sourceId, "PNG dimensions must be greater than zero");
  }
  return { widthPx, heightPx };
}

function jpegDimensions(bytes, sourceId) {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) break;
      const heightPx = bytes.readUInt16BE(offset + 3);
      const widthPx = bytes.readUInt16BE(offset + 5);
      if (widthPx === 0 || heightPx === 0) break;
      return { widthPx, heightPx };
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  fail("INVALID_IMAGE", sourceId, "JPEG is missing a readable start-of-frame dimension header");
}

function dimensionsFor(bytes, mimeType, sourceId) {
  if (mimeType === "image/png") return pngDimensions(bytes, sourceId);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes, sourceId);
  return {};
}

function validateExpectedDimension(value, name, sourceId) {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    fail("INVALID_SPEC", sourceId, `${name} must be a positive integer when provided`);
  }
}

async function resolveSourcePath(manifestRoot, relativePath, sourceId) {
  if (
    typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath.includes("\0")
    || isAbsolute(relativePath)
    || win32.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes("..")
  ) {
    fail("UNSAFE_PATH", sourceId, "relativePath must be a non-empty relative path inside the manifest directory");
  }
  const candidate = resolve(manifestRoot, relativePath);
  if (!isInside(manifestRoot, candidate)) {
    fail("UNSAFE_PATH", sourceId, "relativePath escapes the manifest directory");
  }
  let canonicalCandidate;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      fail("SOURCE_MISSING", sourceId, "file does not exist relative to the manifest");
    }
    fail("SOURCE_UNREADABLE", sourceId, "file could not be resolved");
  }
  if (!isInside(manifestRoot, canonicalCandidate)) {
    fail("UNSAFE_PATH", sourceId, "relativePath resolves outside the manifest directory");
  }
  return canonicalCandidate;
}

async function inspectSource(source, context) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("INVALID_SPEC", "unknown", "source entry must be an object");
  }
  const id = safeSegment(source.id, "id");
  rejectUnknownKeys(source, SOURCE_KEYS, id);
  if (!SOURCE_KINDS.has(source.kind)) {
    fail("INVALID_SPEC", id, "kind is unsupported");
  }
  if (source.declaredMimeType !== undefined && !MIME_EXTENSIONS.has(source.declaredMimeType)) {
    fail("INVALID_SPEC", id, "declaredMimeType must be image/jpeg, image/png, or image/webp");
  }
  if (source.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(source.expectedSha256)) {
    fail("INVALID_SPEC", id, "expectedSha256 must be a 64-character hexadecimal digest");
  }
  validateExpectedDimension(source.expectedWidthPx, "expectedWidthPx", id);
  validateExpectedDimension(source.expectedHeightPx, "expectedHeightPx", id);

  const sourcePath = await resolveSourcePath(context.manifestRoot, source.relativePath, id);
  let fileStats;
  let bytes;
  try {
    [fileStats, bytes] = await Promise.all([stat(sourcePath), readFile(sourcePath)]);
  } catch {
    fail("SOURCE_UNREADABLE", id, "file could not be read");
  }
  if (!fileStats.isFile()) fail("SOURCE_NOT_FILE", id, "relativePath must resolve to a regular file");

  const mimeType = detectMimeType(bytes, id);
  if (source.declaredMimeType !== undefined && source.declaredMimeType !== mimeType) {
    fail("MIME_MISMATCH", id, `declared ${source.declaredMimeType} but magic bytes identify ${mimeType}`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (source.expectedSha256 !== undefined && source.expectedSha256.toLowerCase() !== sha256) {
    fail("HASH_MISMATCH", id, "actual SHA-256 does not match expectedSha256");
  }
  const dimensions = dimensionsFor(bytes, mimeType, id);
  if (source.expectedWidthPx !== undefined && source.expectedWidthPx !== dimensions.widthPx) {
    fail("DIMENSION_MISMATCH", id, `expected width ${source.expectedWidthPx}px but detected ${dimensions.widthPx ?? "unavailable"}px`);
  }
  if (source.expectedHeightPx !== undefined && source.expectedHeightPx !== dimensions.heightPx) {
    fail("DIMENSION_MISMATCH", id, `expected height ${source.expectedHeightPx}px but detected ${dimensions.heightPx ?? "unavailable"}px`);
  }

  const extension = MIME_EXTENSIONS.get(mimeType);
  return {
    id,
    tenantId: context.tenantId,
    ...(context.frameModelId === undefined ? {} : { frameModelId: context.frameModelId }),
    ...(context.frameVariantId === undefined ? {} : { frameVariantId: context.frameVariantId }),
    kind: source.kind,
    objectKey: `private/${context.tenantId}/sources/${id}/${sha256}.${extension}`,
    sha256,
    mimeType,
    ...dimensions,
    captureMetadata: {
      originalFilename: basename(source.relativePath),
      byteLength: bytes.length,
      fileModifiedAt: fileStats.mtime.toISOString(),
    },
  };
}

export async function inspectSourceSpec(spec, options) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    fail("INVALID_SPEC", "spec", "document must be an object");
  }
  rejectUnknownKeys(spec, SPEC_KEYS, "spec");
  if (spec.schemaVersion !== 1) fail("INVALID_SPEC", "spec", "schemaVersion must equal 1");
  if (!options || typeof options.manifestDirectory !== "string") {
    fail("INVALID_SPEC", "spec", "manifestDirectory is required");
  }
  let manifestRoot;
  try {
    manifestRoot = await realpath(options.manifestDirectory);
  } catch {
    fail("INVALID_SPEC", "spec", "manifest directory does not exist");
  }
  const tenantId = safeSegment(spec.tenantId, "tenantId");
  const frameModelId = spec.frameModelId === undefined
    ? undefined
    : safeSegment(spec.frameModelId, "frameModelId");
  const frameVariantId = spec.frameVariantId === undefined
    ? undefined
    : safeSegment(spec.frameVariantId, "frameVariantId");
  if (!Array.isArray(spec.sources) || spec.sources.length === 0) {
    fail("INVALID_SPEC", "spec", "sources must be a non-empty array");
  }
  const ids = new Set();
  const context = { manifestRoot, tenantId, frameModelId, frameVariantId };
  const sourceAssets = [];
  for (const source of spec.sources) {
    const sourceAsset = await inspectSource(source, context);
    if (ids.has(sourceAsset.id)) fail("INVALID_SPEC", sourceAsset.id, "source id must be unique");
    ids.add(sourceAsset.id);
    sourceAssets.push(sourceAsset);
  }
  return { schemaVersion: 1, tenantId, sourceAssets };
}
