import { canonicalJson, sha256Hex } from "./generationJob.js";
import {
  FORMALIZATION_ARTIFACT_MAX_BYTES,
  FORMALIZATION_TOTAL_ARTIFACT_MAX_BYTES,
  parseFormalizationCandidate,
  type FormalizationCandidate,
} from "./nonProxyFormalizationReadiness.js";

export const MARKING_CAPTURE_ROLES = Object.freeze([
  "front", "left45", "right45", "leftSide", "rightSide", "top", "marking",
] as const);

export const MARKING_INSPECTION_REQUIRED_SURFACES = Object.freeze([
  "left-temple-inner", "right-temple-inner", "bridge-inner",
] as const);

export const MARKING_PROVENANCE_SCOPES = Object.freeze([
  "reported-marking-observation", "capture-provenance", "marking-inspection",
] as const);

export type MarkingCaptureRole = (typeof MARKING_CAPTURE_ROLES)[number];
export type MarkingInspectionSurface = (typeof MARKING_INSPECTION_REQUIRED_SURFACES)[number];
export type MarkingProvenanceScope = (typeof MARKING_PROVENANCE_SCOPES)[number];
export type MarkingSurfaceResult = "no-dimension-marking-observed" | "dimension-marking-observed";

export const MARKING_INSPECTION_TOTAL_ARTIFACT_MAX_BYTES = FORMALIZATION_TOTAL_ARTIFACT_MAX_BYTES;

export type MarkingInspectionArtifact = {
  artifactId: string;
  kind: "source" | "reported-no-temple-marking-attestation";
  sourceRole: null;
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
};

export type MarkingSourceDescriptor = Omit<MarkingInspectionArtifact, "bytes" | "kind"> & { kind: "source" };

export type ReportedNoTempleMarkingAttestation = {
  schemaVersion: 1;
  type: "reported-no-temple-marking-attestation";
  algorithm: "ES256";
  scope: "reported-marking-observation";
  authorityId: string;
  keyId: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  specimenId: string;
  reportedByActorId: string;
  reportedAt: string;
  issuedAt: string;
  expiresAt: string;
  signatureBase64: string;
};

export type CaptureProvenanceAttestation = {
  schemaVersion: 1;
  type: "verified-capture-provenance-attestation";
  algorithm: "ES256";
  scope: "capture-provenance";
  authorityId: string;
  keyId: string;
  candidateSha256: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  jobId: string;
  specimenId: string;
  sourceAssetSha256s: readonly string[];
  artifacts: readonly MarkingSourceDescriptor[];
  captures: readonly {
    artifactId: string;
    captureRole: MarkingCaptureRole;
    specimenId: string;
    capturedAt: string;
  }[];
  issuedAt: string;
  expiresAt: string;
  signatureBase64: string;
};

export type MarkingInspectionAttestation = {
  schemaVersion: 1;
  type: "verified-marking-inspection-attestation";
  algorithm: "ES256";
  scope: "marking-inspection";
  authorityId: string;
  keyId: string;
  candidateSha256: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  jobId: string;
  specimenId: string;
  sourceAssetSha256s: readonly string[];
  captureProvenancePayloadSha256: string;
  reportArtifactId: string;
  supersedesAttestationSha256: string;
  policy: {
    policyId: "eyewear-dimension-marking-closed-surfaces";
    policyVersion: 1;
    hasTemples: true;
    markingClass: "dimension-markings-only";
    requiredSurfaces: readonly MarkingInspectionSurface[];
  };
  surfaceInspections: readonly {
    surface: MarkingInspectionSurface;
    sourceArtifactId: string;
    result: MarkingSurfaceResult;
  }[];
  inspectedByActorId: string;
  inspectedAt: string;
  issuedAt: string;
  expiresAt: string;
  signatureBase64: string;
};

export type MarkingProvenanceTrustConfiguration = {
  trustedKeys: Readonly<Record<string, {
    authorityId: string;
    tenantId: string;
    scopes: readonly MarkingProvenanceScope[];
    publicJwk: JsonWebKey;
  }>>;
  maximumAttestationLifetimeMs: number;
  maximumEvidenceAgeMs: number;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SOURCE_MAX = FORMALIZATION_ARTIFACT_MAX_BYTES.source;
const REPORT_MAX = 64 * 1024;

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`);
  }
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).find((key) => !expected.has(key));
  const missing = keys.find((key) => !(key in value));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function array(value: unknown, path: string, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense plain array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`);
  }
}

function id(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`);
}

function hash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
}

function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value);
  const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`);
}

function signature(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError(`${path} must be canonical raw ES256 base64`);
  let decoded: string;
  try { decoded = atob(value); } catch { throw new TypeError(`${path} must be canonical raw ES256 base64`); }
  if (decoded.length !== 64 || btoa(decoded) !== value) throw new TypeError(`${path} must encode one raw 64-byte ES256 signature`);
}

function sortedHashes(value: unknown, path: string): string[] {
  array(value, path, 32);
  if (value.length === 0) throw new TypeError(`${path} must be non-empty`);
  value.forEach((item, index) => hash(item, `${path}.${index}`));
  if (new Set(value).size !== value.length || canonicalJson(value) !== canonicalJson([...value].sort())) throw new TypeError(`${path} must be unique and sorted`);
  return [...value] as string[];
}

function parseDescriptor(value: unknown, path: string): MarkingSourceDescriptor {
  object(value, path);
  exact(value, ["artifactId", "kind", "sourceRole", "sha256", "byteLength"], path);
  id(value.artifactId, `${path}.artifactId`);
  if (value.kind !== "source" || value.sourceRole !== null) throw new TypeError(`${path} must preserve sourceRole:null and kind:source`);
  hash(value.sha256, `${path}.sha256`);
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 || (value.byteLength as number) > SOURCE_MAX) throw new TypeError(`${path}.byteLength is invalid`);
  return structuredClone(value) as MarkingSourceDescriptor;
}

export function parseMarkingInspectionArtifact(value: unknown): MarkingInspectionArtifact {
  object(value, "artifact");
  exact(value, ["artifactId", "kind", "sourceRole", "bytes", "sha256", "byteLength"], "artifact");
  id(value.artifactId, "artifact.artifactId");
  if (value.kind !== "source" && value.kind !== "reported-no-temple-marking-attestation") throw new TypeError("artifact.kind is unsupported");
  if (value.sourceRole !== null) throw new TypeError("JSC-0213 artifacts must preserve JSC-0212 sourceRole:null");
  const maximum = value.kind === "source" ? SOURCE_MAX : REPORT_MAX;
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength < 1 || value.bytes.byteLength > maximum) throw new TypeError("artifact.bytes exceeds its kind-specific byte limit");
  hash(value.sha256, "artifact.sha256");
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength !== value.bytes.byteLength) throw new TypeError("artifact.byteLength must equal actual bytes");
  return { artifactId: value.artifactId, kind: value.kind, sourceRole: null, bytes: new Uint8Array(value.bytes), sha256: value.sha256, byteLength: value.byteLength };
}

export function parseReportedNoTempleMarkingAttestation(value: unknown): ReportedNoTempleMarkingAttestation {
  object(value, "reported attestation");
  exact(value, ["schemaVersion", "type", "algorithm", "scope", "authorityId", "keyId", "tenantId", "frameModelId", "frameVariantId", "specimenId", "reportedByActorId", "reportedAt", "issuedAt", "expiresAt", "signatureBase64"], "reported attestation");
  if (value.schemaVersion !== 1 || value.type !== "reported-no-temple-marking-attestation" || value.algorithm !== "ES256" || value.scope !== "reported-marking-observation") throw new TypeError("reported attestation must remain a signed reported-no-temple-marking v1 statement");
  for (const key of ["authorityId", "keyId", "tenantId", "frameModelId", "frameVariantId", "specimenId", "reportedByActorId"] as const) id(value[key], `reported attestation.${key}`);
  timestamp(value.reportedAt, "reported attestation.reportedAt"); timestamp(value.issuedAt, "reported attestation.issuedAt"); timestamp(value.expiresAt, "reported attestation.expiresAt");
  if (Date.parse(value.reportedAt) > Date.parse(value.issuedAt) || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) throw new TypeError("reported attestation time order is invalid");
  signature(value.signatureBase64, "reported attestation.signatureBase64");
  return structuredClone(value) as ReportedNoTempleMarkingAttestation;
}

export function parseCaptureProvenanceAttestation(value: unknown): CaptureProvenanceAttestation {
  object(value, "capture provenance attestation");
  exact(value, ["schemaVersion", "type", "algorithm", "scope", "authorityId", "keyId", "candidateSha256", "tenantId", "frameModelId", "frameVariantId", "jobId", "specimenId", "sourceAssetSha256s", "artifacts", "captures", "issuedAt", "expiresAt", "signatureBase64"], "capture provenance attestation");
  if (value.schemaVersion !== 1 || value.type !== "verified-capture-provenance-attestation" || value.algorithm !== "ES256" || value.scope !== "capture-provenance") throw new TypeError("capture provenance attestation discriminator is invalid");
  for (const key of ["authorityId", "keyId", "tenantId", "frameModelId", "frameVariantId", "jobId", "specimenId"] as const) id(value[key], `capture provenance attestation.${key}`);
  hash(value.candidateSha256, "capture provenance attestation.candidateSha256");
  const sourceAssetSha256s = sortedHashes(value.sourceAssetSha256s, "capture provenance attestation.sourceAssetSha256s");
  array(value.artifacts, "capture provenance attestation.artifacts", 32);
  const artifacts = value.artifacts.map((item, index) => parseDescriptor(item, `capture provenance attestation.artifacts.${index}`));
  if (artifacts.length === 0 || new Set(artifacts.map((item) => item.artifactId)).size !== artifacts.length || canonicalJson(artifacts) !== canonicalJson([...artifacts].sort((a, b) => a.artifactId.localeCompare(b.artifactId)))) throw new TypeError("capture provenance artifacts must be non-empty, unique, and sorted");
  array(value.captures, "capture provenance attestation.captures", 32);
  const captures = value.captures.map((item, index) => {
    object(item, `capture provenance attestation.captures.${index}`);
    exact(item, ["artifactId", "captureRole", "specimenId", "capturedAt"], `capture provenance attestation.captures.${index}`);
    id(item.artifactId, `capture provenance attestation.captures.${index}.artifactId`);
    if (!MARKING_CAPTURE_ROLES.includes(item.captureRole as MarkingCaptureRole)) throw new TypeError("capture role is unsupported");
    id(item.specimenId, `capture provenance attestation.captures.${index}.specimenId`);
    timestamp(item.capturedAt, `capture provenance attestation.captures.${index}.capturedAt`);
    return structuredClone(item) as CaptureProvenanceAttestation["captures"][number];
  });
  if (captures.length !== artifacts.length || new Set(captures.map((item) => item.artifactId)).size !== captures.length || canonicalJson(captures) !== canonicalJson([...captures].sort((a, b) => a.artifactId.localeCompare(b.artifactId)))) throw new TypeError("capture provenance must contain one sorted capture claim per source artifact");
  timestamp(value.issuedAt, "capture provenance attestation.issuedAt"); timestamp(value.expiresAt, "capture provenance attestation.expiresAt");
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) throw new TypeError("capture provenance expiry must follow issuance");
  signature(value.signatureBase64, "capture provenance attestation.signatureBase64");
  return { ...structuredClone(value), sourceAssetSha256s, artifacts, captures } as unknown as CaptureProvenanceAttestation;
}

export function parseMarkingInspectionAttestation(value: unknown): MarkingInspectionAttestation {
  object(value, "marking inspection attestation");
  exact(value, ["schemaVersion", "type", "algorithm", "scope", "authorityId", "keyId", "candidateSha256", "tenantId", "frameModelId", "frameVariantId", "jobId", "specimenId", "sourceAssetSha256s", "captureProvenancePayloadSha256", "reportArtifactId", "supersedesAttestationSha256", "policy", "surfaceInspections", "inspectedByActorId", "inspectedAt", "issuedAt", "expiresAt", "signatureBase64"], "marking inspection attestation");
  if (value.schemaVersion !== 1 || value.type !== "verified-marking-inspection-attestation" || value.algorithm !== "ES256" || value.scope !== "marking-inspection") throw new TypeError("marking inspection attestation discriminator is invalid");
  for (const key of ["authorityId", "keyId", "tenantId", "frameModelId", "frameVariantId", "jobId", "specimenId", "reportArtifactId", "inspectedByActorId"] as const) id(value[key], `marking inspection attestation.${key}`);
  for (const key of ["candidateSha256", "captureProvenancePayloadSha256", "supersedesAttestationSha256"] as const) hash(value[key], `marking inspection attestation.${key}`);
  const sourceAssetSha256s = sortedHashes(value.sourceAssetSha256s, "marking inspection attestation.sourceAssetSha256s");
  object(value.policy, "marking inspection attestation.policy");
  exact(value.policy, ["policyId", "policyVersion", "hasTemples", "markingClass", "requiredSurfaces"], "marking inspection attestation.policy");
  if (value.policy.policyId !== "eyewear-dimension-marking-closed-surfaces" || value.policy.policyVersion !== 1 || value.policy.hasTemples !== true || value.policy.markingClass !== "dimension-markings-only") throw new TypeError("marking inspection must use the closed eyewear dimension-marking policy v1");
  array(value.policy.requiredSurfaces, "marking inspection attestation.policy.requiredSurfaces", MARKING_INSPECTION_REQUIRED_SURFACES.length);
  if (canonicalJson(value.policy.requiredSurfaces) !== canonicalJson(MARKING_INSPECTION_REQUIRED_SURFACES)) throw new TypeError("marking inspection policy must contain the exact closed required-surface set in canonical order");
  array(value.surfaceInspections, "marking inspection attestation.surfaceInspections", MARKING_INSPECTION_REQUIRED_SURFACES.length);
  const surfaceInspections = value.surfaceInspections.map((item, index) => {
    object(item, `marking inspection attestation.surfaceInspections.${index}`);
    exact(item, ["surface", "sourceArtifactId", "result"], `marking inspection attestation.surfaceInspections.${index}`);
    if (item.surface !== MARKING_INSPECTION_REQUIRED_SURFACES[index]) throw new TypeError("surface inspections must cover the exact closed surface set in canonical order");
    id(item.sourceArtifactId, `marking inspection attestation.surfaceInspections.${index}.sourceArtifactId`);
    if (item.result !== "no-dimension-marking-observed" && item.result !== "dimension-marking-observed") throw new TypeError("surface inspection result is unsupported");
    return structuredClone(item) as MarkingInspectionAttestation["surfaceInspections"][number];
  });
  if (new Set(surfaceInspections.map((item) => item.sourceArtifactId)).size !== surfaceInspections.length) throw new TypeError("each required surface must use distinct actual capture bytes");
  timestamp(value.inspectedAt, "marking inspection attestation.inspectedAt"); timestamp(value.issuedAt, "marking inspection attestation.issuedAt"); timestamp(value.expiresAt, "marking inspection attestation.expiresAt");
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) throw new TypeError("marking inspection expiry must follow issuance");
  signature(value.signatureBase64, "marking inspection attestation.signatureBase64");
  return { ...structuredClone(value), sourceAssetSha256s, surfaceInspections, policy: { ...structuredClone(value.policy), requiredSurfaces: [...MARKING_INSPECTION_REQUIRED_SURFACES] } } as unknown as MarkingInspectionAttestation;
}

export function captureProvenanceAttestationPayload(value: CaptureProvenanceAttestation): Omit<CaptureProvenanceAttestation, "signatureBase64"> {
  const { signatureBase64: _ignored, ...payload } = value; return payload;
}

export function markingInspectionAttestationPayload(value: MarkingInspectionAttestation): Omit<MarkingInspectionAttestation, "signatureBase64"> {
  const { signatureBase64: _ignored, ...payload } = value; return payload;
}

export function reportedNoTempleMarkingAttestationPayload(value: ReportedNoTempleMarkingAttestation): Omit<ReportedNoTempleMarkingAttestation, "signatureBase64"> {
  const { signatureBase64: _ignored, ...payload } = value; return payload;
}

export async function markingCandidateSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(parseFormalizationCandidate(value)));
}

export function parseMarkingCandidate(value: unknown): FormalizationCandidate {
  return parseFormalizationCandidate(value);
}
