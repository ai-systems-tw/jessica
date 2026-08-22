import {
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAGIC,
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES,
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES,
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES,
  canonicalJson,
  parseAssetManifest,
  parseUnverifiedCommittedReviewQaPreviewBundleEnvelope,
  sha256Hex,
  type AssetManifest,
  type CommittedReviewQaPreviewTransportSelection,
  type UnverifiedCommittedReviewQaPreviewBundleEnvelope,
} from "../../contracts/src/index.js";
import { validateGlb, type ValidatedGlb } from "./glbValidation.js";

export const COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES = 20;
const MAGIC_BYTES = new TextEncoder().encode(COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAGIC);
const MAX_TOTAL_BYTES = COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES + COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES + COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES + COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const arrayBufferSlice = ArrayBuffer.prototype.slice;
const uint8Slice = Uint8Array.prototype.slice;

export type InspectedCommittedReviewQaPreviewArtifacts = Readonly<{
  manifestBytes: Uint8Array<ArrayBuffer>;
  modelBytes: Uint8Array<ArrayBuffer>;
  manifest: AssetManifest;
  manifestSha256: string;
  modelSha256: string;
  validatedGlb: ValidatedGlb;
}>;

export type ParsedUnverifiedCommittedReviewQaPreviewBundle = Readonly<{
  envelope: UnverifiedCommittedReviewQaPreviewBundleEnvelope;
  manifestBytes: Uint8Array<ArrayBuffer>;
  modelBytes: Uint8Array<ArrayBuffer>;
  manifest: AssetManifest;
  validatedGlb: ValidatedGlb;
}>;

function fail(message: string): never { throw new TypeError(message); }
function intrinsicLength(value: ArrayBuffer | Uint8Array): number {
  try {
    if (value instanceof Uint8Array) {
      if (!typedArrayByteLength) fail("typed-array byteLength intrinsic is unavailable");
      return Reflect.apply(typedArrayByteLength, value, []) as number;
    }
    if (value instanceof ArrayBuffer) {
      if (!arrayBufferByteLength) fail("ArrayBuffer byteLength intrinsic is unavailable");
      return Reflect.apply(arrayBufferByteLength, value, []) as number;
    }
  } catch { fail("bundle bytes are invalid"); }
  return fail("bundle bytes must be an ArrayBuffer or Uint8Array");
}
function snapshotBytes(value: ArrayBuffer | Uint8Array, maximum: number, label: string): Uint8Array<ArrayBuffer> {
  const length = intrinsicLength(value); if (length < 1 || length > maximum) fail(`${label} byte length is invalid`);
  try {
    if (value instanceof Uint8Array) {
      if (!typedArrayBuffer || !typedArrayByteOffset || !typedArrayByteLength) fail("typed-array intrinsics are unavailable");
      const buffer = Reflect.apply(typedArrayBuffer, value, []); const offset = Reflect.apply(typedArrayByteOffset, value, []) as number; const byteLength = Reflect.apply(typedArrayByteLength, value, []) as number;
      if (!(buffer instanceof ArrayBuffer) || byteLength !== length) fail(`${label} backing buffer is invalid`);
      return Reflect.apply(uint8Slice, new Uint8Array(buffer, offset, byteLength), []) as Uint8Array<ArrayBuffer>;
    }
    const copy = Reflect.apply(arrayBufferSlice, value, [0, length]) as ArrayBuffer;
    return new Uint8Array(copy);
  } catch { return fail(`${label} bytes are invalid`); }
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean { return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]); }
function decodeUtf8(bytes: Uint8Array, label: string): string { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail(`${label} UTF-8 is invalid`); } }
function parseManifest(bytes: Uint8Array): AssetManifest {
  let value: unknown; try { value = JSON.parse(decodeUtf8(bytes, "manifest")); } catch (error) { if (error instanceof TypeError) throw error; return fail("manifest JSON is invalid"); }
  const manifest = parseAssetManifest(value);
  if (manifest.fixture !== false) fail("bundle manifest must be non-fixture");
  if (manifest.model.url !== "./model.glb") fail("bundle manifest model locator is not the canonical private-safe relative value");
  return manifest;
}
function sameSelection(manifest: AssetManifest, selection: CommittedReviewQaPreviewTransportSelection): boolean { return manifest.assetId === selection.assetVersionId && manifest.assetVersion === selection.assetVersion; }

export async function inspectCommittedReviewQaPreviewArtifacts(manifestInput: ArrayBuffer | Uint8Array, modelInput: ArrayBuffer | Uint8Array, selection?: CommittedReviewQaPreviewTransportSelection): Promise<InspectedCommittedReviewQaPreviewArtifacts> {
  const manifestBytes = snapshotBytes(manifestInput, COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES, "manifest");
  const modelBytes = snapshotBytes(modelInput, COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES, "model");
  const manifest = parseManifest(manifestBytes);
  if (selection && !sameSelection(manifest, selection)) fail("manifest identity does not match the verified transport selection");
  if (manifest.model.byteLength !== modelBytes.byteLength) fail("manifest model byte length does not match actual bytes");
  const [manifestSha256, modelSha256] = await Promise.all([sha256Hex(manifestBytes), sha256Hex(modelBytes)]);
  if (manifest.model.sha256 !== modelSha256) fail("manifest model SHA-256 does not match actual bytes");
  const validatedGlb = validateGlb(modelBytes, { requiredNodes: manifest.model.requiredNodes, unit: manifest.model.unit, expectedBoundsMetres: manifest.model.boundsMetres });
  return Object.freeze({ manifestBytes, modelBytes, manifest, manifestSha256, modelSha256, validatedGlb });
}

function compareEnvelopeArtifacts(envelope: UnverifiedCommittedReviewQaPreviewBundleEnvelope, inspected: InspectedCommittedReviewQaPreviewArtifacts): void {
  if (envelope.manifest.contentType !== "application/json" || envelope.manifest.byteLength !== inspected.manifestBytes.byteLength || envelope.manifest.sha256 !== inspected.manifestSha256
    || envelope.model.contentType !== "model/gltf-binary" || envelope.model.byteLength !== inspected.modelBytes.byteLength || envelope.model.sha256 !== inspected.modelSha256) fail("bundle artifact evidence does not match actual bytes");
  const projection = envelope.runtimeAssetProjection;
  if (projection.id !== inspected.manifest.assetId || projection.version !== inspected.manifest.assetVersion || projection.fixture !== inspected.manifest.fixture
    || projection.sourceAssetHashes.length !== inspected.manifest.sourceAssetHashes.length || projection.sourceAssetHashes.some((value, index) => value !== inspected.manifest.sourceAssetHashes[index])) fail("bundle runtime asset projection does not match manifest");
}

/** Composes exact bytes but neither signs nor verifies the unverified envelope. */
export async function composeUnverifiedCommittedReviewQaPreviewBundle(envelopeInput: unknown, manifestInput: ArrayBuffer | Uint8Array, modelInput: ArrayBuffer | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const envelope = parseUnverifiedCommittedReviewQaPreviewBundleEnvelope(envelopeInput);
  const inspected = await inspectCommittedReviewQaPreviewArtifacts(manifestInput, modelInput, envelope.transport.selection);
  compareEnvelopeArtifacts(envelope, inspected);
  const envelopeBytes = new TextEncoder().encode(canonicalJson(envelope)) as Uint8Array<ArrayBuffer>;
  if (envelopeBytes.byteLength < 1 || envelopeBytes.byteLength > COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES) fail("bundle envelope byte length is invalid");
  const total = COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES + envelopeBytes.byteLength + inspected.manifestBytes.byteLength + inspected.modelBytes.byteLength;
  const output = new Uint8Array(total); output.set(MAGIC_BYTES, 0);
  const header = new DataView(output.buffer); header.setUint32(8, envelopeBytes.byteLength, false); header.setUint32(12, inspected.manifestBytes.byteLength, false); header.setUint32(16, inspected.modelBytes.byteLength, false);
  let offset = COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES; output.set(envelopeBytes, offset); offset += envelopeBytes.byteLength; output.set(inspected.manifestBytes, offset); offset += inspected.manifestBytes.byteLength; output.set(inspected.modelBytes, offset);
  return output;
}

/** Parses and validates artifacts but does not establish browser/runtime authority. */
export async function parseUnverifiedCommittedReviewQaPreviewBundle(input: ArrayBuffer | Uint8Array): Promise<ParsedUnverifiedCommittedReviewQaPreviewBundle> {
  const bytes = snapshotBytes(input, MAX_TOTAL_BYTES, "bundle");
  if (bytes.byteLength < COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES || !equalBytes(bytes.subarray(0, 8), MAGIC_BYTES)) fail("bundle magic or header is invalid");
  const header = new DataView(bytes.buffer, bytes.byteOffset, COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES);
  const envelopeLength = header.getUint32(8, false); const manifestLength = header.getUint32(12, false); const modelLength = header.getUint32(16, false);
  if (envelopeLength < 1 || envelopeLength > COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES || manifestLength < 1 || manifestLength > COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES || modelLength < 1 || modelLength > COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES) fail("bundle section length is invalid");
  const expectedLength = COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES + envelopeLength + manifestLength + modelLength;
  if (expectedLength !== bytes.byteLength) fail("bundle is truncated or contains trailing bytes");
  let offset = COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES; const envelopeBytes = bytes.slice(offset, offset + envelopeLength); offset += envelopeLength; const manifestBytes = bytes.slice(offset, offset + manifestLength); offset += manifestLength; const modelBytes = bytes.slice(offset, offset + modelLength);
  const envelopeText = decodeUtf8(envelopeBytes, "bundle envelope"); let rawEnvelope: unknown; try { rawEnvelope = JSON.parse(envelopeText); } catch { return fail("bundle envelope JSON is invalid"); }
  const envelope = parseUnverifiedCommittedReviewQaPreviewBundleEnvelope(rawEnvelope);
  if (!equalBytes(new TextEncoder().encode(canonicalJson(envelope)), envelopeBytes)) fail("bundle envelope JSON is not canonical");
  const inspected = await inspectCommittedReviewQaPreviewArtifacts(manifestBytes, modelBytes, envelope.transport.selection); compareEnvelopeArtifacts(envelope, inspected);
  return Object.freeze({ envelope, manifestBytes: inspected.manifestBytes, modelBytes: inspected.modelBytes, manifest: inspected.manifest, validatedGlb: inspected.validatedGlb });
}
