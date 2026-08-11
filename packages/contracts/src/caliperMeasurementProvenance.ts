import { canonicalJson, sha256Hex } from "./generationJob.js";
import { FORMALIZATION_PHYSICAL_FIELDS, type FormalizationPhysicalField } from "./nonProxyFormalizationReadiness.js";

export const CALIPER_PROVENANCE_SCOPES = Object.freeze(["caliper-calibration", "caliper-measurement"] as const);
export type CaliperProvenanceScope = (typeof CALIPER_PROVENANCE_SCOPES)[number];

export type CaliperActualByteArtifact = {
  artifactId: string;
  kind: "caliper-calibration-record" | "caliper-measurement-session";
  sourceRole: null;
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
};

export type CaliperArtifactDescriptor = Omit<CaliperActualByteArtifact, "bytes">;

export type CaliperCalibrationRecord = {
  schemaVersion: 1;
  type: "caliper-calibration-record";
  tenantId: string;
  caliperId: string;
  serialNumber: string;
  calibratedByOperatorId: string;
  calibratedAt: string;
  validFrom: string;
  validUntil: string;
  unit: "mm";
  referenceStandardId: string;
  certificateId: string;
};

export type CaliperMeasurementSession = {
  schemaVersion: 1;
  type: "caliper-measurement-session";
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  specimenId: string;
  operatorId: string;
  observedAt: string;
  caliperId: string;
  calibrationRecordSha256: string;
  calibrationPayloadSha256: string;
  calibrationValidFrom: string;
  calibrationValidUntil: string;
  candidateSha256: string;
  jobId: string;
  sourceAssetSha256s: readonly string[];
  measurementSetSha256: string;
  captureProvenancePayloadSha256: string;
  observationMode: "direct-physical-caliper-observation";
  measurements: readonly {
    field: FormalizationPhysicalField;
    valueMm: number;
    unit: "mm";
    method: "caliper";
    sourceSha256: string;
    observedAt: string;
  }[];
};

export type CaliperCalibrationAttestation = {
  schemaVersion: 1;
  type: "caliper-calibration-attestation";
  algorithm: "ES256";
  scope: "caliper-calibration";
  authorityId: string;
  keyId: string;
  publicKeyFingerprintSha256: string;
  tenantId: string;
  caliperId: string;
  calibrationRecord: CaliperArtifactDescriptor;
  calibrationPayloadSha256: string;
  issuedAt: string;
  expiresAt: string;
  signatureBase64: string;
};

export type CaliperMeasurementAttestation = {
  schemaVersion: 1;
  type: "caliper-measurement-attestation";
  algorithm: "ES256";
  scope: "caliper-measurement";
  authorityId: string;
  keyId: string;
  publicKeyFingerprintSha256: string;
  tenantId: string;
  specimenId: string;
  caliperId: string;
  candidateSha256: string;
  jobId: string;
  measurementSetSha256: string;
  sourceAssetSha256s: readonly string[];
  captureProvenancePayloadSha256: string;
  calibrationRecordSha256: string;
  calibrationPayloadSha256: string;
  measurementSession: CaliperArtifactDescriptor;
  measurementSessionPayloadSha256: string;
  issuedAt: string;
  expiresAt: string;
  signatureBase64: string;
};

export type CaliperProvenanceAttestation = CaliperCalibrationAttestation | CaliperMeasurementAttestation;

export type CaliperProvenanceTrustConfiguration = {
  trustedKeys: Readonly<Record<string, {
    authorityId: string;
    tenantId: string;
    scopes: readonly CaliperProvenanceScope[];
    publicKeyFingerprintSha256: string;
    publicJwk: JsonWebKey;
  }>>;
  maximumAttestationLifetimeMs: number;
  maximumObservationAgeMs: number;
  maximumCalibrationAgeMs: number;
};

export const CALIPER_ARTIFACT_MAX_BYTES = Object.freeze({
  "caliper-calibration-record": 64 * 1024,
  "caliper-measurement-session": 128 * 1024,
} as const);
export const CALIPER_TOTAL_ARTIFACT_MAX_BYTES = 192 * 1024;

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`);
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

function id(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function hash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function finite(value: unknown, path: string): asserts value is number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 500) throw new TypeError(`${path} is outside its allowed range`); }
function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value); const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`);
}

function signature(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError(`${path} must be canonical raw ES256 base64`);
  let decoded: string; try { decoded = atob(value); } catch { throw new TypeError(`${path} must be canonical raw ES256 base64`); }
  if (decoded.length !== 64 || btoa(decoded) !== value) throw new TypeError(`${path} must encode one raw 64-byte ES256 signature`);
}

function sortedHashes(value: unknown, path: string): string[] {
  array(value, path, 32); if (value.length === 0) throw new TypeError(`${path} must be non-empty`);
  value.forEach((item, index) => hash(item, `${path}.${index}`));
  if (new Set(value).size !== value.length || canonicalJson(value) !== canonicalJson([...value].sort())) throw new TypeError(`${path} must be unique and sorted`);
  return [...value] as string[];
}

function parseDescriptor(value: unknown, path: string, expectedKind: CaliperActualByteArtifact["kind"]): CaliperArtifactDescriptor {
  object(value, path); exact(value, ["artifactId", "kind", "sourceRole", "sha256", "byteLength"], path);
  id(value.artifactId, `${path}.artifactId`);
  if (value.kind !== expectedKind || value.sourceRole !== null) throw new TypeError(`${path} must preserve its exact kind and sourceRole:null`);
  hash(value.sha256, `${path}.sha256`);
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 || (value.byteLength as number) > CALIPER_ARTIFACT_MAX_BYTES[expectedKind]) throw new TypeError(`${path}.byteLength is invalid`);
  return structuredClone(value) as CaliperArtifactDescriptor;
}

export function parseCaliperActualByteArtifact(value: unknown): CaliperActualByteArtifact {
  object(value, "caliper artifact"); exact(value, ["artifactId", "kind", "sourceRole", "bytes", "sha256", "byteLength"], "caliper artifact");
  id(value.artifactId, "caliper artifact.artifactId");
  if (value.kind !== "caliper-calibration-record" && value.kind !== "caliper-measurement-session") throw new TypeError("caliper artifact.kind is unsupported");
  if (value.sourceRole !== null) throw new TypeError("caliper artifacts must preserve sourceRole:null");
  const maximum = CALIPER_ARTIFACT_MAX_BYTES[value.kind];
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength < 1 || value.bytes.byteLength > maximum) throw new TypeError("caliper artifact.bytes exceeds its kind-specific limit");
  hash(value.sha256, "caliper artifact.sha256");
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength !== value.bytes.byteLength) throw new TypeError("caliper artifact.byteLength must equal actual bytes");
  return { artifactId: value.artifactId, kind: value.kind, sourceRole: null, bytes: new Uint8Array(value.bytes), sha256: value.sha256, byteLength: value.byteLength };
}

export function parseCaliperCalibrationRecord(value: unknown): CaliperCalibrationRecord {
  object(value, "calibration record"); exact(value, ["schemaVersion", "type", "tenantId", "caliperId", "serialNumber", "calibratedByOperatorId", "calibratedAt", "validFrom", "validUntil", "unit", "referenceStandardId", "certificateId"], "calibration record");
  if (value.schemaVersion !== 1 || value.type !== "caliper-calibration-record" || value.unit !== "mm") throw new TypeError("calibration record must be the strict mm v1 contract");
  for (const key of ["tenantId", "caliperId", "serialNumber", "calibratedByOperatorId", "referenceStandardId", "certificateId"] as const) id(value[key], `calibration record.${key}`);
  timestamp(value.calibratedAt, "calibration record.calibratedAt"); timestamp(value.validFrom, "calibration record.validFrom"); timestamp(value.validUntil, "calibration record.validUntil");
  if (Date.parse(value.calibratedAt) > Date.parse(value.validFrom) || Date.parse(value.validUntil) <= Date.parse(value.validFrom)) throw new TypeError("calibration record validity order is invalid");
  return structuredClone(value) as CaliperCalibrationRecord;
}

export function parseCaliperMeasurementSession(value: unknown): CaliperMeasurementSession {
  object(value, "measurement session"); exact(value, ["schemaVersion", "type", "tenantId", "frameModelId", "frameVariantId", "specimenId", "operatorId", "observedAt", "caliperId", "calibrationRecordSha256", "calibrationPayloadSha256", "calibrationValidFrom", "calibrationValidUntil", "candidateSha256", "jobId", "sourceAssetSha256s", "measurementSetSha256", "captureProvenancePayloadSha256", "observationMode", "measurements"], "measurement session");
  if (value.schemaVersion !== 1 || value.type !== "caliper-measurement-session" || value.observationMode !== "direct-physical-caliper-observation") throw new TypeError("measurement session must be the strict direct physical caliper observation v1 contract");
  for (const key of ["tenantId", "frameModelId", "frameVariantId", "specimenId", "operatorId", "caliperId", "jobId"] as const) id(value[key], `measurement session.${key}`);
  timestamp(value.observedAt, "measurement session.observedAt"); timestamp(value.calibrationValidFrom, "measurement session.calibrationValidFrom"); timestamp(value.calibrationValidUntil, "measurement session.calibrationValidUntil");
  for (const key of ["calibrationRecordSha256", "calibrationPayloadSha256", "candidateSha256", "measurementSetSha256", "captureProvenancePayloadSha256"] as const) hash(value[key], `measurement session.${key}`);
  const sourceAssetSha256s = sortedHashes(value.sourceAssetSha256s, "measurement session.sourceAssetSha256s");
  array(value.measurements, "measurement session.measurements", FORMALIZATION_PHYSICAL_FIELDS.length);
  if (value.measurements.length !== FORMALIZATION_PHYSICAL_FIELDS.length) throw new TypeError("measurement session must contain exactly six observations");
  const measurements = value.measurements.map((item, index) => {
    object(item, `measurement session.measurements.${index}`); exact(item, ["field", "valueMm", "unit", "method", "sourceSha256", "observedAt"], `measurement session.measurements.${index}`);
    if (item.field !== FORMALIZATION_PHYSICAL_FIELDS[index]) throw new TypeError("measurement session must use the exact canonical six-field order without duplicates or reorder");
    finite(item.valueMm, `measurement session.measurements.${index}.valueMm`);
    if (item.unit !== "mm" || item.method !== "caliper") throw new TypeError("measurement observations must be direct caliper values in mm");
    hash(item.sourceSha256, `measurement session.measurements.${index}.sourceSha256`);
    timestamp(item.observedAt, `measurement session.measurements.${index}.observedAt`);
    if (item.observedAt !== value.observedAt) throw new TypeError("all six observations must belong to the one atomic measurement-session instant");
    return structuredClone(item) as CaliperMeasurementSession["measurements"][number];
  });
  return { ...structuredClone(value), sourceAssetSha256s, measurements } as unknown as CaliperMeasurementSession;
}

function commonAttestation(value: Record<string, unknown>, path: string, scope: CaliperProvenanceScope): void {
  if (value.schemaVersion !== 1 || value.algorithm !== "ES256" || value.scope !== scope) throw new TypeError(`${path} discriminator is invalid`);
  for (const key of ["authorityId", "keyId", "tenantId", "caliperId"] as const) id(value[key], `${path}.${key}`);
  hash(value.publicKeyFingerprintSha256, `${path}.publicKeyFingerprintSha256`);
  timestamp(value.issuedAt, `${path}.issuedAt`); timestamp(value.expiresAt, `${path}.expiresAt`);
  if (Date.parse(value.expiresAt as string) <= Date.parse(value.issuedAt as string)) throw new TypeError(`${path} expiry must follow issuance`);
  signature(value.signatureBase64, `${path}.signatureBase64`);
}

export function parseCaliperCalibrationAttestation(value: unknown): CaliperCalibrationAttestation {
  object(value, "calibration attestation"); exact(value, ["schemaVersion", "type", "algorithm", "scope", "authorityId", "keyId", "publicKeyFingerprintSha256", "tenantId", "caliperId", "calibrationRecord", "calibrationPayloadSha256", "issuedAt", "expiresAt", "signatureBase64"], "calibration attestation");
  if (value.type !== "caliper-calibration-attestation") throw new TypeError("calibration attestation type is invalid"); commonAttestation(value, "calibration attestation", "caliper-calibration");
  hash(value.calibrationPayloadSha256, "calibration attestation.calibrationPayloadSha256");
  return { ...structuredClone(value), calibrationRecord: parseDescriptor(value.calibrationRecord, "calibration attestation.calibrationRecord", "caliper-calibration-record") } as unknown as CaliperCalibrationAttestation;
}

export function parseCaliperMeasurementAttestation(value: unknown): CaliperMeasurementAttestation {
  object(value, "measurement attestation"); exact(value, ["schemaVersion", "type", "algorithm", "scope", "authorityId", "keyId", "publicKeyFingerprintSha256", "tenantId", "specimenId", "caliperId", "candidateSha256", "jobId", "measurementSetSha256", "sourceAssetSha256s", "captureProvenancePayloadSha256", "calibrationRecordSha256", "calibrationPayloadSha256", "measurementSession", "measurementSessionPayloadSha256", "issuedAt", "expiresAt", "signatureBase64"], "measurement attestation");
  if (value.type !== "caliper-measurement-attestation") throw new TypeError("measurement attestation type is invalid"); commonAttestation(value, "measurement attestation", "caliper-measurement");
  id(value.specimenId, "measurement attestation.specimenId"); id(value.jobId, "measurement attestation.jobId");
  for (const key of ["candidateSha256", "measurementSetSha256", "captureProvenancePayloadSha256", "calibrationRecordSha256", "calibrationPayloadSha256", "measurementSessionPayloadSha256"] as const) hash(value[key], `measurement attestation.${key}`);
  const sourceAssetSha256s = sortedHashes(value.sourceAssetSha256s, "measurement attestation.sourceAssetSha256s");
  return { ...structuredClone(value), sourceAssetSha256s, measurementSession: parseDescriptor(value.measurementSession, "measurement attestation.measurementSession", "caliper-measurement-session") } as unknown as CaliperMeasurementAttestation;
}

export function caliperAttestationPayload<T extends CaliperProvenanceAttestation>(value: T): Omit<T, "signatureBase64"> { const { signatureBase64: _ignored, ...payload } = value; return payload; }
export async function caliperPublicJwkFingerprintSha256(value: JsonWebKey): Promise<string> { return sha256Hex(canonicalJson({ crv: value.crv, kty: value.kty, x: value.x, y: value.y })); }
