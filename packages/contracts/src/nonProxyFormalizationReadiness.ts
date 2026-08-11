import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "./generationJob.js";
import type { Matrix4 } from "./frame.js";
import type { NonProxyQaGenerationMethod, NonProxyQaQuality, NonProxyQaRequirements } from "./nonProxyQaReview.js";

export const FORMALIZATION_SCOPES = [
  "physical-measurement",
  "visual-fidelity",
  "actual-wear-consent",
  "rights-clearance",
] as const;

export const FORMALIZATION_ARTIFACT_KINDS = [
  "source",
  "measurement-sheet",
  "visual-capture",
  "actual-wear-capture",
  "rights-record",
  "model",
  "manifest",
  "generation-ledger",
  "qa-decision",
] as const;

export const FORMALIZATION_PHYSICAL_FIELDS = [
  "lensWidthMm",
  "bridgeWidthMm",
  "templeLengthMm",
  "frameWidthMm",
  "lensHeightMm",
  "frameThicknessMm",
] as const;

export type FormalizationScope = (typeof FORMALIZATION_SCOPES)[number];
export type FormalizationArtifactKind = (typeof FORMALIZATION_ARTIFACT_KINDS)[number];
export type FormalizationPhysicalField = (typeof FORMALIZATION_PHYSICAL_FIELDS)[number];

export type ActualByteArtifact = {
  artifactId: string;
  kind: FormalizationArtifactKind;
  sourceRole: null;
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
};

export type SignedArtifactDescriptor = Omit<ActualByteArtifact, "bytes">;

export type FormalizationCandidate = {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  version: number;
  quality: NonProxyQaQuality;
  generationMethod: NonProxyQaGenerationMethod;
  modelUrl: string;
  modelSha256: string;
  modelByteLength: number;
  manifestUrl: string;
  manifestSha256: string;
  manifestByteLength: number;
  sourceAssetHashes: readonly string[];
  generation: {
    jobId: string;
    canonicalInputSha256: string;
    reviewHeadEventSha256: string;
    generatorInputSha256: string;
    generator: { id: string; version: string; configSha256: string };
    qaDecisionSha256: string;
  };
  attachmentMatrix: Matrix4;
  qualityEnvelope: {
    maxYawDeg: number;
    maxPitchDeg: number;
    recommendedForLive: false;
    scaleConfidence: "low" | "medium" | "high";
  };
  requirements: NonProxyQaRequirements;
  fixtureStatus: "unverified";
  admission: "unverified-evidence-candidate";
  promotable: false;
  status: "draft";
  authority: Readonly<{
    qaApproved: false;
    assetVersionCreated: false;
    assetVersionPromoted: false;
    recommendedForLive: false;
    activeDeployment: false;
    publication: false;
    gates: false;
  }>;
};

export type PhysicalMeasurementClaim = {
  kind: "physical";
  measurementArtifactId: string;
  measurements: readonly {
    field: FormalizationPhysicalField;
    valueMm: number;
    method: "caliper";
    sourceArtifactId: string;
  }[];
};

export type VerifiedPhysicalMeasurementDocument = {
  schemaVersion: 1;
  type: "verified-physical-measurement-set";
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  verifiedByAuthorityId: string;
  measuredAt: string;
  verification: "verified";
  measurements: readonly {
    field: FormalizationPhysicalField;
    valueMm: number;
    method: "caliper";
    sourceSha256: string;
  }[];
};

export type FormalizationClaim =
  | PhysicalMeasurementClaim
  | { kind: "visual"; visualArtifactId: string }
  | { kind: "actual-wear"; actualWearArtifactId: string }
  | { kind: "rights"; rightsArtifactId: string };

export type SignedEvidenceAttestation = {
  schemaVersion: 1;
  algorithm: "ES256";
  authorityId: string;
  keyId: string;
  scope: FormalizationScope;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  jobId: string;
  canonicalInputSha256: string;
  reviewHeadEventSha256: string;
  generatorInputSha256: string;
  measurementSetSha256: string;
  sourceAssetSha256s: readonly string[];
  output: GenerationJobOutputEvidence;
  candidateSha256: string;
  artifacts: readonly SignedArtifactDescriptor[];
  claim: FormalizationClaim;
  issuedAt: string;
  expiresAt: string;
  subjectId: string | null;
  consentId: string | null;
  retentionUntil: string | null;
  rightsScope: "internal-review-only" | null;
  signatureBase64: string;
};

export type FormalizationTrustConfiguration = {
  trustedKeys: Readonly<Record<string, {
    authorityId: string;
    tenantId: string;
    scopes: readonly FormalizationScope[];
    publicJwk: JsonWebKey;
  }>>;
  maximumAttestationLifetimeMs: number;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const REQUIREMENT_KEYS = ["physical", "visualFidelity", "actualWear", "rights"] as const;
const AUTHORITY_KEYS = ["qaApproved", "assetVersionCreated", "assetVersionPromoted", "recommendedForLive", "activeDeployment", "publication", "gates"] as const;

export const FORMALIZATION_ARTIFACT_MAX_BYTES: Readonly<Record<FormalizationArtifactKind, number>> = Object.freeze({
  source: 32 * 1024 * 1024,
  "measurement-sheet": 8 * 1024 * 1024,
  "visual-capture": 32 * 1024 * 1024,
  "actual-wear-capture": 32 * 1024 * 1024,
  "rights-record": 4 * 1024 * 1024,
  model: 32 * 1024 * 1024,
  manifest: 256 * 1024,
  "generation-ledger": 4 * 1024 * 1024,
  "qa-decision": 512 * 1024,
});

export const FORMALIZATION_TOTAL_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

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
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) {
    throw new TypeError(`${path} must be a bounded dense plain array`);
  }
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

function positiveInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`);
}

function finite(value: unknown, minimum: number, maximum: number, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${path} is outside its allowed range`);
}

function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value);
  const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`);
}

function locator(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new TypeError(`${path} must be a bounded safe candidate locator`);
  if (/^https:\/\//.test(value)) {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.href !== value) throw new TypeError(`${path} must be an exact credential-free HTTPS URL without query or fragment`);
    return;
  }
  if (!value.startsWith("./") || value.includes("../") || value.includes("?") || value.includes("#")) throw new TypeError(`${path} must be a contained relative locator or exact HTTPS URL`);
}

function parseOutput(value: unknown, path: string): GenerationJobOutputEvidence {
  object(value, path);
  exact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], path);
  hash(value.manifestSha256, `${path}.manifestSha256`);
  hash(value.modelSha256, `${path}.modelSha256`);
  positiveInteger(value.manifestByteLength, `${path}.manifestByteLength`);
  positiveInteger(value.modelByteLength, `${path}.modelByteLength`);
  return structuredClone(value) as GenerationJobOutputEvidence;
}

function sortedHashes(value: unknown, path: string): string[] {
  array(value, path, 32);
  if (value.length === 0) throw new TypeError(`${path} must be non-empty`);
  value.forEach((candidate, index) => hash(candidate, `${path}.${index}`));
  if (new Set(value).size !== value.length || canonicalJson(value) !== canonicalJson([...value].sort())) throw new TypeError(`${path} must be unique and sorted`);
  return [...value] as string[];
}

function parseRequirement(value: unknown, path: string): { evidenceSha256: string; sourceAssetSha256: string; measurementSetSha256: string } {
  object(value, path);
  exact(value, ["evidenceSha256", "sourceAssetSha256", "measurementSetSha256"], path);
  hash(value.evidenceSha256, `${path}.evidenceSha256`);
  hash(value.sourceAssetSha256, `${path}.sourceAssetSha256`);
  hash(value.measurementSetSha256, `${path}.measurementSetSha256`);
  return structuredClone(value) as { evidenceSha256: string; sourceAssetSha256: string; measurementSetSha256: string };
}

function parseMatrix(value: unknown): Matrix4 {
  array(value, "candidate.attachmentMatrix", 16);
  if (value.length !== 16) throw new TypeError("candidate.attachmentMatrix must contain 16 values");
  value.forEach((candidate, index) => finite(candidate, -1_000_000, 1_000_000, `candidate.attachmentMatrix.${index}`));
  return [...value] as unknown as Matrix4;
}

export function parseFormalizationCandidate(value: unknown): FormalizationCandidate {
  object(value, "candidate");
  exact(value, ["schemaVersion", "id", "tenantId", "frameModelId", "frameVariantId", "version", "quality", "generationMethod", "modelUrl", "modelSha256", "modelByteLength", "manifestUrl", "manifestSha256", "manifestByteLength", "sourceAssetHashes", "generation", "attachmentMatrix", "qualityEnvelope", "requirements", "fixtureStatus", "admission", "promotable", "status", "authority"], "candidate");
  if (value.schemaVersion !== 1) throw new TypeError("candidate.schemaVersion must equal 1");
  for (const key of ["id", "tenantId", "frameModelId", "frameVariantId"] as const) id(value[key], `candidate.${key}`);
  positiveInteger(value.version, "candidate.version");
  if (value.quality !== "standard" && value.quality !== "premium") throw new TypeError("candidate.quality must be standard or premium");
  if (!(["standard-auto", "manual", "external"] as const).includes(value.generationMethod as NonProxyQaGenerationMethod)) throw new TypeError("candidate.generationMethod is unsupported");
  if (value.quality === "standard" && value.generationMethod === "external") throw new TypeError("external generation cannot be relabelled as a standard candidate");
  locator(value.modelUrl, "candidate.modelUrl");
  hash(value.modelSha256, "candidate.modelSha256");
  positiveInteger(value.modelByteLength, "candidate.modelByteLength");
  locator(value.manifestUrl, "candidate.manifestUrl");
  hash(value.manifestSha256, "candidate.manifestSha256");
  positiveInteger(value.manifestByteLength, "candidate.manifestByteLength");
  const sourceAssetHashes = sortedHashes(value.sourceAssetHashes, "candidate.sourceAssetHashes");

  object(value.generation, "candidate.generation");
  exact(value.generation, ["jobId", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "generator", "qaDecisionSha256"], "candidate.generation");
  id(value.generation.jobId, "candidate.generation.jobId");
  for (const key of ["canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "qaDecisionSha256"] as const) hash(value.generation[key], `candidate.generation.${key}`);
  object(value.generation.generator, "candidate.generation.generator");
  exact(value.generation.generator, ["id", "version", "configSha256"], "candidate.generation.generator");
  id(value.generation.generator.id, "candidate.generation.generator.id");
  id(value.generation.generator.version, "candidate.generation.generator.version");
  hash(value.generation.generator.configSha256, "candidate.generation.generator.configSha256");

  const attachmentMatrix = parseMatrix(value.attachmentMatrix);
  object(value.qualityEnvelope, "candidate.qualityEnvelope");
  exact(value.qualityEnvelope, ["maxYawDeg", "maxPitchDeg", "recommendedForLive", "scaleConfidence"], "candidate.qualityEnvelope");
  finite(value.qualityEnvelope.maxYawDeg, 0, 90, "candidate.qualityEnvelope.maxYawDeg");
  finite(value.qualityEnvelope.maxPitchDeg, 0, 90, "candidate.qualityEnvelope.maxPitchDeg");
  if (value.qualityEnvelope.recommendedForLive !== false || !(["low", "medium", "high"] as const).includes(value.qualityEnvelope.scaleConfidence as "low")) throw new TypeError("candidate quality envelope cannot assert live readiness");

  object(value.requirements, "candidate.requirements");
  const rawRequirements = value.requirements;
  exact(rawRequirements, REQUIREMENT_KEYS, "candidate.requirements");
  const requirements = Object.fromEntries(REQUIREMENT_KEYS.map((key) => [key, parseRequirement(rawRequirements[key], `candidate.requirements.${key}`)])) as unknown as NonProxyQaRequirements;
  const measurementSetHashes = new Set(REQUIREMENT_KEYS.map((key) => requirements[key].measurementSetSha256));
  if (measurementSetHashes.size !== 1) throw new TypeError("candidate requirements must bind one exact MeasurementSet");
  const evidenceHashes = REQUIREMENT_KEYS.map((key) => requirements[key].evidenceSha256);
  if (new Set(evidenceHashes).size !== evidenceHashes.length) throw new TypeError("candidate requirements cannot reuse evidence across incompatible scopes");
  for (const key of REQUIREMENT_KEYS) if (!sourceAssetHashes.includes(requirements[key].sourceAssetSha256)) throw new TypeError(`candidate ${key} requirement source is outside the candidate source set`);

  if (value.fixtureStatus !== "unverified" || value.admission !== "unverified-evidence-candidate" || value.promotable !== false || value.status !== "draft") throw new TypeError("candidate must remain an unverified non-promotable draft");
  object(value.authority, "candidate.authority");
  exact(value.authority, AUTHORITY_KEYS, "candidate.authority");
  for (const key of AUTHORITY_KEYS) if (value.authority[key] !== false) throw new TypeError(`candidate.authority.${key} cannot grant authority`);

  return {
    ...structuredClone(value),
    sourceAssetHashes,
    attachmentMatrix,
    requirements,
  } as unknown as FormalizationCandidate;
}

export function parseActualByteArtifact(value: unknown): ActualByteArtifact {
  object(value, "artifact");
  exact(value, ["artifactId", "kind", "sourceRole", "bytes", "sha256", "byteLength"], "artifact");
  id(value.artifactId, "artifact.artifactId");
  if (!FORMALIZATION_ARTIFACT_KINDS.includes(value.kind as FormalizationArtifactKind)) throw new TypeError("artifact.kind is unsupported");
  const kind = value.kind as FormalizationArtifactKind;
  if (value.sourceRole !== null) throw new TypeError("formalization artifacts do not assert unverified source roles");
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0 || value.bytes.byteLength > FORMALIZATION_ARTIFACT_MAX_BYTES[kind]) throw new TypeError("artifact.bytes exceeds its kind-specific byte limit");
  hash(value.sha256, "artifact.sha256");
  positiveInteger(value.byteLength, "artifact.byteLength");
  if (value.byteLength !== value.bytes.byteLength) throw new TypeError("artifact.byteLength must equal actual bytes");
  return { artifactId: value.artifactId, kind, sourceRole: null, bytes: new Uint8Array(value.bytes), sha256: value.sha256, byteLength: value.byteLength };
}

function parseDescriptor(value: unknown, path: string): SignedArtifactDescriptor {
  object(value, path);
  exact(value, ["artifactId", "kind", "sourceRole", "sha256", "byteLength"], path);
  id(value.artifactId, `${path}.artifactId`);
  if (!FORMALIZATION_ARTIFACT_KINDS.includes(value.kind as FormalizationArtifactKind)) throw new TypeError(`${path}.kind is unsupported`);
  const kind = value.kind as FormalizationArtifactKind;
  if (value.sourceRole !== null) throw new TypeError(`${path}.sourceRole must be null because this boundary does not verify capture roles`);
  hash(value.sha256, `${path}.sha256`);
  positiveInteger(value.byteLength, `${path}.byteLength`);
  if (value.byteLength > FORMALIZATION_ARTIFACT_MAX_BYTES[kind]) throw new TypeError(`${path}.byteLength exceeds the kind limit`);
  return structuredClone(value) as SignedArtifactDescriptor;
}

function parseClaim(value: unknown, scope: FormalizationScope): FormalizationClaim {
  object(value, "attestation.claim");
  if (scope === "physical-measurement") {
    exact(value, ["kind", "measurementArtifactId", "measurements"], "attestation.claim");
    if (value.kind !== "physical") throw new TypeError("physical attestation requires a physical claim");
    id(value.measurementArtifactId, "attestation.claim.measurementArtifactId");
    array(value.measurements, "attestation.claim.measurements", FORMALIZATION_PHYSICAL_FIELDS.length);
    if (value.measurements.length !== FORMALIZATION_PHYSICAL_FIELDS.length) throw new TypeError("physical claim must contain six measurements");
    const parsed = value.measurements.map((candidate, index) => {
      object(candidate, `attestation.claim.measurements.${index}`);
      exact(candidate, ["field", "valueMm", "method", "sourceArtifactId"], `attestation.claim.measurements.${index}`);
      if (candidate.field !== FORMALIZATION_PHYSICAL_FIELDS[index]) throw new TypeError("physical measurements must use the canonical six-field order");
      finite(candidate.valueMm, 0.1, 500, `attestation.claim.measurements.${index}.valueMm`);
      if (candidate.method !== "caliper") throw new TypeError("formalization currently requires verified caliper evidence; marking transcription needs the separate marking-inspection boundary");
      id(candidate.sourceArtifactId, `attestation.claim.measurements.${index}.sourceArtifactId`);
      return {
        field: candidate.field as FormalizationPhysicalField,
        valueMm: candidate.valueMm as number,
        method: "caliper" as const,
        sourceArtifactId: candidate.sourceArtifactId as string,
      };
    });
    return { kind: "physical", measurementArtifactId: value.measurementArtifactId, measurements: parsed } as PhysicalMeasurementClaim;
  }
  const mapping = {
    "visual-fidelity": ["visual", "visualArtifactId"],
    "actual-wear-consent": ["actual-wear", "actualWearArtifactId"],
    "rights-clearance": ["rights", "rightsArtifactId"],
  } as const;
  const [kind, key] = mapping[scope];
  exact(value, ["kind", key], "attestation.claim");
  if (value.kind !== kind) throw new TypeError("attestation claim kind does not match scope");
  id(value[key], `attestation.claim.${key}`);
  return structuredClone(value) as FormalizationClaim;
}

export function parseVerifiedPhysicalMeasurementDocument(value: unknown): VerifiedPhysicalMeasurementDocument {
  object(value, "measurement document");
  exact(value, ["schemaVersion", "type", "tenantId", "frameModelId", "frameVariantId", "verifiedByAuthorityId", "measuredAt", "verification", "measurements"], "measurement document");
  if (value.schemaVersion !== 1 || value.type !== "verified-physical-measurement-set" || value.verification !== "verified") {
    throw new TypeError("measurement document must be a verified physical measurement set v1");
  }
  for (const key of ["tenantId", "frameModelId", "frameVariantId", "verifiedByAuthorityId"] as const) id(value[key], `measurement document.${key}`);
  timestamp(value.measuredAt, "measurement document.measuredAt");
  array(value.measurements, "measurement document.measurements", FORMALIZATION_PHYSICAL_FIELDS.length);
  if (value.measurements.length !== FORMALIZATION_PHYSICAL_FIELDS.length) throw new TypeError("measurement document must contain six measurements");
  const measurements = value.measurements.map((candidate, index) => {
    object(candidate, `measurement document.measurements.${index}`);
    exact(candidate, ["field", "valueMm", "method", "sourceSha256"], `measurement document.measurements.${index}`);
    if (candidate.field !== FORMALIZATION_PHYSICAL_FIELDS[index]) throw new TypeError("measurement document must use the canonical six-field order");
    finite(candidate.valueMm, 0.1, 500, `measurement document.measurements.${index}.valueMm`);
    if (candidate.method !== "caliper") throw new TypeError("measurement document currently requires caliper measurements");
    hash(candidate.sourceSha256, `measurement document.measurements.${index}.sourceSha256`);
    return { field: candidate.field as FormalizationPhysicalField, valueMm: candidate.valueMm as number, method: "caliper" as const, sourceSha256: candidate.sourceSha256 as string };
  });
  return {
    schemaVersion: 1,
    type: "verified-physical-measurement-set",
    tenantId: value.tenantId as string,
    frameModelId: value.frameModelId as string,
    frameVariantId: value.frameVariantId as string,
    verifiedByAuthorityId: value.verifiedByAuthorityId as string,
    measuredAt: value.measuredAt,
    verification: "verified",
    measurements,
  };
}

function canonicalBase64Signature(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError("attestation.signatureBase64 must be canonical base64");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
  catch { throw new TypeError("attestation.signatureBase64 must be canonical base64"); }
  if (bytes.byteLength !== 64 || btoa(String.fromCharCode(...bytes)) !== value) throw new TypeError("attestation.signatureBase64 must encode one raw ES256 signature");
}

export function parseSignedEvidenceAttestation(value: unknown): SignedEvidenceAttestation {
  object(value, "attestation");
  exact(value, ["schemaVersion", "algorithm", "authorityId", "keyId", "scope", "tenantId", "frameModelId", "frameVariantId", "jobId", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "measurementSetSha256", "sourceAssetSha256s", "output", "candidateSha256", "artifacts", "claim", "issuedAt", "expiresAt", "subjectId", "consentId", "retentionUntil", "rightsScope", "signatureBase64"], "attestation");
  if (value.schemaVersion !== 1 || value.algorithm !== "ES256") throw new TypeError("attestation version and algorithm must be schema 1 / ES256");
  for (const key of ["authorityId", "keyId", "tenantId", "frameModelId", "frameVariantId", "jobId"] as const) id(value[key], `attestation.${key}`);
  if (!FORMALIZATION_SCOPES.includes(value.scope as FormalizationScope)) throw new TypeError("attestation.scope is unsupported");
  const scope = value.scope as FormalizationScope;
  for (const key of ["canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "measurementSetSha256", "candidateSha256"] as const) hash(value[key], `attestation.${key}`);
  const sourceAssetSha256s = sortedHashes(value.sourceAssetSha256s, "attestation.sourceAssetSha256s");
  const output = parseOutput(value.output, "attestation.output");
  array(value.artifacts, "attestation.artifacts", 40);
  if (value.artifacts.length === 0) throw new TypeError("attestation.artifacts must be non-empty");
  const artifacts = value.artifacts.map((candidate, index) => parseDescriptor(candidate, `attestation.artifacts.${index}`));
  if (new Set(artifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length || canonicalJson(artifacts) !== canonicalJson([...artifacts].sort((left, right) => left.artifactId.localeCompare(right.artifactId)))) throw new TypeError("attestation.artifacts must be unique and sorted by artifactId");
  const claim = parseClaim(value.claim, scope);
  timestamp(value.issuedAt, "attestation.issuedAt");
  timestamp(value.expiresAt, "attestation.expiresAt");
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) throw new TypeError("attestation expiry must follow issuance");
  for (const key of ["subjectId", "consentId"] as const) if (value[key] !== null) id(value[key], `attestation.${key}`);
  if (value.retentionUntil !== null) timestamp(value.retentionUntil, "attestation.retentionUntil");
  if (scope === "actual-wear-consent") {
    if (value.subjectId === null || value.consentId === null || value.retentionUntil === null) throw new TypeError("actual-wear consent must bind subject, consent, and retention");
  } else if (value.subjectId !== null || value.consentId !== null || value.retentionUntil !== null) throw new TypeError("only actual-wear scope may carry subject or consent fields");
  if (scope === "rights-clearance" ? value.rightsScope !== "internal-review-only" : value.rightsScope !== null) throw new TypeError("rights scope must be exactly internal-review-only for rights clearance");
  canonicalBase64Signature(value.signatureBase64);
  return { ...structuredClone(value), sourceAssetSha256s, output, artifacts, claim } as unknown as SignedEvidenceAttestation;
}

export function attestationPayload(value: SignedEvidenceAttestation): Omit<SignedEvidenceAttestation, "signatureBase64"> {
  const { signatureBase64: _ignored, ...payload } = value;
  return payload;
}

export async function formalizationCandidateSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(parseFormalizationCandidate(value)));
}
