import { COMMITTED_REVIEW_QA_PREVIEW_TRANSPORT_SCOPE, parseUnverifiedCommittedReviewQaPreviewTransportGrant, type UnverifiedCommittedReviewQaPreviewTransportGrantPayload } from "./committedReviewQaPreviewTransport.js";

export const COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAGIC = "JQAPB001" as const;
export const COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES = 64 * 1024;
export const COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES = 256 * 1024;
export const COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES = 32 * 1024 * 1024;

export type CommittedReviewQaPreviewBundleArtifactEvidence<ContentType extends string> = Readonly<{
  contentType: ContentType;
  sha256: string;
  byteLength: number;
}>;

export type CommittedReviewQaPreviewBundleRuntimeAssetProjection = Readonly<{
  id: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  version: number;
  quality: "standard" | "premium";
  generationMethod: "standard-auto" | "manual" | "external";
  status: "approved";
  fixture: false;
  sourceAssetHashes: readonly string[];
  attachmentMatrix: readonly number[];
  qualityEnvelope: Readonly<{
    maxYawDeg: number;
    maxPitchDeg: number;
    recommendedForLive: false;
    scaleConfidence: "low" | "medium" | "high";
  }>;
}>;

export type UnverifiedCommittedReviewQaPreviewBundleEnvelope = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-unverified-bundle-envelope";
  algorithm: "ES256";
  scope: typeof COMMITTED_REVIEW_QA_PREVIEW_TRANSPORT_SCOPE;
  bundleSignerAuthorityId: string;
  bundleSignerKeyId: string;
  /** Trusted server clock immediately before bundle signing. */
  composedAt: string;
  /** SHA-256 of canonical JSON for the full verified grant, including its signature. */
  transportGrantSha256: string;
  transport: UnverifiedCommittedReviewQaPreviewTransportGrantPayload;
  runtimeAssetProjection: CommittedReviewQaPreviewBundleRuntimeAssetProjection;
  manifest: CommittedReviewQaPreviewBundleArtifactEvidence<"application/json">;
  model: CommittedReviewQaPreviewBundleArtifactEvidence<"model/gltf-binary">;
  evidence: Readonly<{ verification: "required"; artifactContainerOnly: true; browserRuntimeUsable: false; publicLiveUsable: false }>;
  signatureBase64: string;
}>;

export type UnverifiedCommittedReviewQaPreviewBundleEnvelopePayload = Omit<UnverifiedCommittedReviewQaPreviewBundleEnvelope, "signatureBase64">;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROOT_KEYS = ["schemaVersion", "type", "algorithm", "scope", "bundleSignerAuthorityId", "bundleSignerKeyId", "composedAt", "transportGrantSha256", "transport", "runtimeAssetProjection", "manifest", "model", "evidence", "signatureBase64"] as const;
const ARTIFACT_KEYS = ["contentType", "sha256", "byteLength"] as const;
const PROJECTION_KEYS = ["id", "tenantId", "frameModelId", "frameVariantId", "version", "quality", "generationMethod", "status", "fixture", "sourceAssetHashes", "attachmentMatrix", "qualityEnvelope"] as const;
const QUALITY_ENVELOPE_KEYS = ["maxYawDeg", "maxPitchDeg", "recommendedForLive", "scaleConfidence"] as const;
const EVIDENCE_KEYS = ["verification", "artifactContainerOnly", "browserRuntimeUsable", "publicLiveUsable"] as const;

function fail(message: string): never { throw new TypeError(message); }
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
  for (const [key, descriptor] of Object.entries(descriptors)) if (!keys.includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set) fail(`${label} fields are invalid`);
  return value as Record<string, unknown>;
}
function literal<T extends string | number | boolean>(value: unknown, expected: T, label: string): T { if (value !== expected) fail(`${label} is invalid`); return expected; }
function id(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) fail(`${label} is invalid`); return value; }
function hash(value: unknown, label: string): string { if (typeof value !== "string" || !HASH.test(value)) fail(`${label} is invalid`); return value; }
function timestamp(value: unknown, label: string): string { if (typeof value !== "string") fail(`${label} is invalid`); const epoch = Date.parse(value); if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) fail(`${label} is invalid`); return value; }
function byteLength(value: unknown, maximum: number, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) fail(`${label} is invalid`); return value; }
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T { if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} is invalid`); return value as T; }
function finite(value: unknown, minimum: number, maximum: number, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} is invalid`); return value; }
function signature(value: unknown): string {
  if (typeof value !== "string" || value.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(value)) fail("bundle signature must be canonical raw ES256 base64");
  let decoded: string; try { decoded = atob(value); } catch { fail("bundle signature must be canonical raw ES256 base64"); }
  if (decoded.length !== 64 || btoa(decoded) !== value) fail("bundle signature must encode one raw 64-byte ES256 signature");
  return value;
}
function artifact<ContentType extends "application/json" | "model/gltf-binary">(value: unknown, contentType: ContentType, maximum: number, label: string): CommittedReviewQaPreviewBundleArtifactEvidence<ContentType> {
  const row = exact(value, ARTIFACT_KEYS, label);
  return Object.freeze({ contentType: literal(row.contentType, contentType, `${label} contentType`), sha256: hash(row.sha256, `${label} sha256`), byteLength: byteLength(row.byteLength, maximum, `${label} byteLength`) });
}

function plainArray(value: unknown, length: number | undefined, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || (length !== undefined && value.length !== length) || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} is invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail(`${label} is invalid`); }
  return value;
}

function runtimeAssetProjection(value: unknown, transport: UnverifiedCommittedReviewQaPreviewTransportGrantPayload): CommittedReviewQaPreviewBundleRuntimeAssetProjection {
  const row = exact(value, PROJECTION_KEYS, "bundle runtime asset projection");
  const rawHashes = plainArray(row.sourceAssetHashes, undefined, "bundle sourceAssetHashes");
  if (rawHashes.length < 1 || rawHashes.length > 32) fail("bundle sourceAssetHashes is invalid");
  const sourceAssetHashes = rawHashes.map((value, index) => hash(value, `bundle sourceAssetHashes.${index}`));
  if (new Set(sourceAssetHashes).size !== sourceAssetHashes.length || sourceAssetHashes.some((value, index) => index > 0 && sourceAssetHashes[index - 1]! >= value)) fail("bundle sourceAssetHashes must be unique and sorted");
  const rawMatrix = plainArray(row.attachmentMatrix, 16, "bundle attachmentMatrix");
  const attachmentMatrix = rawMatrix.map((value, index) => finite(value, -Number.MAX_VALUE, Number.MAX_VALUE, `bundle attachmentMatrix.${index}`));
  const rawQuality = exact(row.qualityEnvelope, QUALITY_ENVELOPE_KEYS, "bundle qualityEnvelope");
  const projection = Object.freeze({
    id: id(row.id, "bundle asset id"), tenantId: id(row.tenantId, "bundle asset tenantId"), frameModelId: id(row.frameModelId, "bundle frameModelId"), frameVariantId: id(row.frameVariantId, "bundle frameVariantId"),
    version: byteLength(row.version, Number.MAX_SAFE_INTEGER, "bundle asset version"), quality: oneOf(row.quality, ["standard", "premium"] as const, "bundle asset quality"),
    generationMethod: oneOf(row.generationMethod, ["standard-auto", "manual", "external"] as const, "bundle generationMethod"), status: literal(row.status, "approved", "bundle asset status"), fixture: literal(row.fixture, false, "bundle fixture"),
    sourceAssetHashes: Object.freeze(sourceAssetHashes), attachmentMatrix: Object.freeze(attachmentMatrix),
    qualityEnvelope: Object.freeze({ maxYawDeg: finite(rawQuality.maxYawDeg, 0, 90, "bundle maxYawDeg"), maxPitchDeg: finite(rawQuality.maxPitchDeg, 0, 90, "bundle maxPitchDeg"), recommendedForLive: literal(rawQuality.recommendedForLive, false, "bundle recommendedForLive"), scaleConfidence: oneOf(rawQuality.scaleConfidence, ["low", "medium", "high"] as const, "bundle scaleConfidence") }),
  });
  if (projection.id !== transport.selection.assetVersionId || projection.tenantId !== transport.selection.tenantId || projection.version !== transport.selection.assetVersion) fail("bundle runtime asset projection does not match transport selection");
  return projection;
}

function transportPayload(value: unknown): UnverifiedCommittedReviewQaPreviewTransportGrantPayload {
  const row = exact(value, ["schemaVersion", "type", "algorithm", "scope", "issuerAuthorityId", "keyId", "grantId", "requestId", "audience", "tenantId", "actorId", "reviewerId", "sessionId", "selection", "commitment", "committedReviewValidUntil", "issuedAt", "notBefore", "expiresAt", "evidence"], "bundle transport binding");
  const parsed = parseUnverifiedCommittedReviewQaPreviewTransportGrant({ ...row, signatureBase64: btoa("\0".repeat(64)) });
  const { signatureBase64: _signatureBase64, ...payload } = parsed;
  return Object.freeze(payload);
}

/** Syntax-only. A canonical-looking signature is not cryptographic authority. */
export function parseUnverifiedCommittedReviewQaPreviewBundleEnvelope(value: unknown): UnverifiedCommittedReviewQaPreviewBundleEnvelope {
  const row = exact(value, ROOT_KEYS, "unverified QA-preview bundle envelope");
  const transport = transportPayload(row.transport);
  const bundleSignerAuthorityId = id(row.bundleSignerAuthorityId, "bundle signer authorityId"); const bundleSignerKeyId = id(row.bundleSignerKeyId, "bundle signer keyId");
  const composedAt = timestamp(row.composedAt, "bundle composedAt");
  if (Date.parse(composedAt) < Date.parse(transport.issuedAt) || Date.parse(composedAt) >= Date.parse(transport.expiresAt)) fail("bundle composedAt is outside the transport grant lifetime");
  const evidence = exact(row.evidence, EVIDENCE_KEYS, "bundle evidence");
  return Object.freeze({
    schemaVersion: literal(row.schemaVersion, 1, "bundle schemaVersion"), type: literal(row.type, "jessica.committed-review-qa-preview-unverified-bundle-envelope", "bundle type"),
    algorithm: literal(row.algorithm, "ES256", "bundle algorithm"), scope: literal(row.scope, COMMITTED_REVIEW_QA_PREVIEW_TRANSPORT_SCOPE, "bundle scope"), bundleSignerAuthorityId, bundleSignerKeyId, composedAt, transportGrantSha256: hash(row.transportGrantSha256, "bundle transportGrantSha256"), transport, runtimeAssetProjection: runtimeAssetProjection(row.runtimeAssetProjection, transport),
    manifest: artifact(row.manifest, "application/json", COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES, "bundle manifest"), model: artifact(row.model, "model/gltf-binary", COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES, "bundle model"),
    evidence: Object.freeze({ verification: literal(evidence.verification, "required", "bundle evidence verification"), artifactContainerOnly: literal(evidence.artifactContainerOnly, true, "bundle evidence artifactContainerOnly"), browserRuntimeUsable: literal(evidence.browserRuntimeUsable, false, "bundle evidence browserRuntimeUsable"), publicLiveUsable: literal(evidence.publicLiveUsable, false, "bundle evidence publicLiveUsable") }),
    signatureBase64: signature(row.signatureBase64),
  });
}

export function unverifiedCommittedReviewQaPreviewBundleEnvelopePayload(value: unknown): UnverifiedCommittedReviewQaPreviewBundleEnvelopePayload {
  const envelope = parseUnverifiedCommittedReviewQaPreviewBundleEnvelope(value);
  const { signatureBase64: _signatureBase64, ...payload } = envelope;
  return Object.freeze(payload);
}
