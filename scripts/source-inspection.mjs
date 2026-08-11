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
  if (
    bytes.length < 33
    || bytes.readUInt32BE(8) !== 13
    || bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    fail("INVALID_IMAGE", sourceId, "PNG is missing a complete IHDR header");
  }
  const widthPx = bytes.readUInt32BE(16);
  const heightPx = bytes.readUInt32BE(20);
  if (widthPx === 0 || heightPx === 0) {
    fail("INVALID_IMAGE", sourceId, "PNG dimensions must be greater than zero");
  }
  return { widthPx, heightPx };
}

function tiffOrientation(bytes, sourceId, label) {
  if (bytes.length < 8) fail("INVALID_IMAGE", sourceId, `${label} EXIF TIFF header is truncated`);
  const byteOrder = bytes.subarray(0, 2).toString("ascii");
  if (byteOrder !== "II" && byteOrder !== "MM") fail("INVALID_IMAGE", sourceId, `${label} EXIF byte order is invalid`);
  const littleEndian = byteOrder === "II";
  const u16 = (offset) => {
    if (offset < 0 || offset + 2 > bytes.length) fail("INVALID_IMAGE", sourceId, `${label} EXIF read exceeds its segment`);
    return littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  };
  const u32 = (offset) => {
    if (offset < 0 || offset + 4 > bytes.length) fail("INVALID_IMAGE", sourceId, `${label} EXIF read exceeds its segment`);
    return littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  };
  if (u16(2) !== 42) fail("INVALID_IMAGE", sourceId, `${label} EXIF TIFF magic is invalid`);
  const ifdOffset = u32(4);
  if (ifdOffset > bytes.length - 2) fail("INVALID_IMAGE", sourceId, `${label} EXIF IFD offset exceeds its segment`);
  const entryCount = u16(ifdOffset);
  if (entryCount > Math.floor((bytes.length - ifdOffset - 2) / 12)) {
    fail("INVALID_IMAGE", sourceId, `${label} EXIF IFD entries are truncated`);
  }
  let orientation;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (u16(entryOffset) !== 0x0112) continue;
    if (u16(entryOffset + 2) !== 3 || u32(entryOffset + 4) !== 1) {
      fail("INVALID_IMAGE", sourceId, `${label} EXIF orientation has an unsupported type or count`);
    }
    const value = u16(entryOffset + 8);
    if (value < 1 || value > 8) fail("INVALID_IMAGE", sourceId, `${label} EXIF orientation must be between 1 and 8`);
    if (orientation !== undefined && orientation !== value) fail("INVALID_IMAGE", sourceId, `${label} EXIF contains conflicting orientation values`);
    orientation = value;
  }
  return orientation;
}

function exifPayloadOrientation(payload, sourceId, label) {
  const prefix = Buffer.from("Exif\0\0", "binary");
  const tiff = payload.length >= prefix.length && payload.subarray(0, prefix.length).equals(prefix)
    ? payload.subarray(prefix.length)
    : payload;
  return tiffOrientation(tiff, sourceId, label);
}

function resolvedOrientation(values, sourceId, label) {
  const declared = values.filter((value) => value !== undefined);
  if (new Set(declared).size > 1) fail("INVALID_IMAGE", sourceId, `${label} contains conflicting EXIF orientation values`);
  return declared[0] ?? 1;
}

function pngOrientation(bytes, sourceId) {
  let offset = 8;
  const values = [];
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail("INVALID_IMAGE", sourceId, "PNG chunk exceeds file bounds");
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (offset === 8 && (type !== "IHDR" || length !== 13)) fail("INVALID_IMAGE", sourceId, "PNG must begin with a 13-byte IHDR chunk");
    if (type === "eXIf") values.push(exifPayloadOrientation(bytes.subarray(dataStart, dataEnd), sourceId, "PNG"));
    offset = dataEnd + 4;
    if (type === "IEND") {
      if (length !== 0) fail("INVALID_IMAGE", sourceId, "PNG IEND chunk must have zero length");
      sawIend = true;
      break;
    }
  }
  if (!sawIend) fail("INVALID_IMAGE", sourceId, "PNG is missing a complete zero-length IEND chunk");
  return resolvedOrientation(values, sourceId, "PNG");
}

function jpegGeometry(bytes, sourceId) {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  let dimensions;
  const orientations = [];
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) fail("INVALID_IMAGE", sourceId, "JPEG segment length is truncated");
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) fail("INVALID_IMAGE", sourceId, "JPEG segment exceeds file bounds");
    if (marker === 0xe1) {
      const payload = bytes.subarray(offset + 2, offset + segmentLength);
      if (payload.length >= 6 && payload.subarray(0, 6).equals(Buffer.from("Exif\0\0", "binary"))) {
        orientations.push(exifPayloadOrientation(payload, sourceId, "JPEG"));
      }
    }
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) fail("INVALID_IMAGE", sourceId, "JPEG start-of-frame header is truncated");
      const heightPx = bytes.readUInt16BE(offset + 3);
      const widthPx = bytes.readUInt16BE(offset + 5);
      if (widthPx === 0 || heightPx === 0) fail("INVALID_IMAGE", sourceId, "JPEG dimensions must be greater than zero");
      if (dimensions && (dimensions.widthPx !== widthPx || dimensions.heightPx !== heightPx)) fail("INVALID_IMAGE", sourceId, "JPEG contains conflicting encoded dimensions");
      dimensions = { widthPx, heightPx };
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  if (!dimensions) fail("INVALID_IMAGE", sourceId, "JPEG is missing a readable start-of-frame dimension header");
  return { ...dimensions, exifOrientation: resolvedOrientation(orientations, sourceId, "JPEG") };
}

function webpGeometry(bytes, sourceId) {
  if (bytes.length < 12) fail("INVALID_IMAGE", sourceId, "WebP RIFF header is truncated");
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize + 8 !== bytes.length) fail("INVALID_IMAGE", sourceId, "WebP RIFF size does not match file length");
  let offset = 12;
  let dimensions;
  const orientations = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("INVALID_IMAGE", sourceId, "WebP chunk header is truncated");
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) fail("INVALID_IMAGE", sourceId, "WebP chunk exceeds RIFF bounds");
    const data = bytes.subarray(dataStart, dataEnd);
    let candidate;
    if (type === "VP8X") {
      if (data.length < 10) fail("INVALID_IMAGE", sourceId, "WebP VP8X header is truncated");
      candidate = {
        widthPx: 1 + data.readUIntLE(4, 3),
        heightPx: 1 + data.readUIntLE(7, 3),
      };
    } else if (type === "VP8 ") {
      if (data.length < 10 || !data.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) fail("INVALID_IMAGE", sourceId, "WebP VP8 frame header is invalid");
      candidate = { widthPx: data.readUInt16LE(6) & 0x3fff, heightPx: data.readUInt16LE(8) & 0x3fff };
    } else if (type === "VP8L") {
      if (data.length < 5 || data[0] !== 0x2f) fail("INVALID_IMAGE", sourceId, "WebP VP8L frame header is invalid");
      candidate = {
        widthPx: 1 + data[1] + ((data[2] & 0x3f) << 8),
        heightPx: 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10),
      };
    } else if (type === "EXIF") {
      orientations.push(exifPayloadOrientation(data, sourceId, "WebP"));
    }
    if (candidate) {
      if (candidate.widthPx === 0 || candidate.heightPx === 0) fail("INVALID_IMAGE", sourceId, "WebP dimensions must be greater than zero");
      if (dimensions && (dimensions.widthPx !== candidate.widthPx || dimensions.heightPx !== candidate.heightPx)) {
        fail("INVALID_IMAGE", sourceId, "WebP contains conflicting encoded dimensions");
      }
      dimensions = candidate;
    }
    offset = dataEnd + (length % 2);
    if (offset > bytes.length) fail("INVALID_IMAGE", sourceId, "WebP chunk padding exceeds RIFF bounds");
  }
  if (!dimensions) fail("INVALID_IMAGE", sourceId, "WebP is missing a supported VP8X, VP8, or VP8L dimension header");
  return { ...dimensions, exifOrientation: resolvedOrientation(orientations, sourceId, "WebP") };
}

function geometryFor(bytes, mimeType, sourceId) {
  if (mimeType === "image/jpeg") return jpegGeometry(bytes, sourceId);
  if (mimeType === "image/webp") return webpGeometry(bytes, sourceId);
  const dimensions = pngDimensions(bytes, sourceId);
  return { ...dimensions, exifOrientation: pngOrientation(bytes, sourceId) };
}

function pixelGeometry(widthPx, heightPx, exifOrientation) {
  const swapsAxes = exifOrientation >= 5 && exifOrientation <= 8;
  return {
    coordinateSpace: "raw-encoded-pixels",
    regionConvention: "half-open-integer",
    encodedWidthPx: widthPx,
    encodedHeightPx: heightPx,
    exifOrientation,
    displayWidthPx: swapsAxes ? heightPx : widthPx,
    displayHeightPx: swapsAxes ? widthPx : heightPx,
    regionAuthoring: exifOrientation === 1 ? "allowed" : "requires-orientation-normalized-derived-source",
  };
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
  const geometry = geometryFor(bytes, mimeType, id);
  const dimensions = { widthPx: geometry.widthPx, heightPx: geometry.heightPx };
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
    pixelGeometry: pixelGeometry(geometry.widthPx, geometry.heightPx, geometry.exifOrientation),
    captureMetadata: {
      originalFilename: basename(source.relativePath),
      byteLength: bytes.length,
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
