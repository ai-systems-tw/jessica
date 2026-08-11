import {
  CALIPER_PROVENANCE_SCOPES,
  CALIPER_TOTAL_ARTIFACT_MAX_BYTES,
  caliperAttestationPayload,
  caliperPublicJwkFingerprintSha256,
  parseCaliperActualByteArtifact,
  parseCaliperCalibrationAttestation,
  parseCaliperCalibrationRecord,
  parseCaliperMeasurementAttestation,
  parseCaliperMeasurementSession,
  type CaliperActualByteArtifact,
  type CaliperCalibrationAttestation,
  type CaliperMeasurementAttestation,
  type CaliperProvenanceScope,
  type CaliperProvenanceTrustConfiguration,
} from "../../contracts/src/caliperMeasurementProvenance.js";
import { canonicalJson, sha256Hex } from "../../contracts/src/generationJob.js";
import {
  formalizationCandidateSha256,
  parseFormalizationCandidate,
  parseVerifiedPhysicalMeasurementDocument,
  type FormalizationCandidate,
  type SignedEvidenceAttestation,
} from "../../contracts/src/nonProxyFormalizationReadiness.js";
import { evaluateNonProxyFormalizationReadiness } from "./formalizationReadiness.js";
import { evaluateMarkingInspectionAndSourceProvenance } from "./markingInspectionProvenance.js";

export const CALIPER_PROVENANCE_AUTHORITY_DENIAL = Object.freeze({
  qaApproved: false,
  assetVersionCreated: false,
  assetVersionPromoted: false,
  recommendedForLive: false,
  activeDeployment: false,
  publication: false,
  gates: false,
} as const);

export type CaliperMeasurementProvenanceResult = Readonly<{
  readiness: "caliper-provenance-verified-for-authorized-human-review-input";
  candidateSha256: string;
  measurementSetSha256: string;
  calibrationRecordSha256: string;
  calibrationPayloadSha256: string;
  measurementSessionSha256: string;
  measurementSessionPayloadSha256: string;
  captureProvenancePayloadSha256: string;
  formalizationResultSha256: string;
  markingProvenanceResultSha256: string;
  evaluatedAt: string;
  validUntil: string;
  authority: typeof CALIPER_PROVENANCE_AUTHORITY_DENIAL;
}>;

const REQUEST_KEYS = ["formalizationRequest", "markingProvenanceRequest", "calibrationRecordArtifact", "measurementSessionArtifact", "calibrationAttestation", "measurementAttestation"] as const;
const CONTEXT_KEYS = ["evaluatedAt", "expectedSupersededAttestationSha256", "expectedCalibrationRecordSha256", "expectedMeasurementSessionSha256", "formalizationTrust", "markingProvenanceTrust", "caliperTrust"] as const;
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
  const expected = new Set(keys); const unknown = Object.keys(value).find((key) => !expected.has(key)); const missing = keys.find((key) => !(key in value));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`); if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function array(value: unknown, path: string, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense plain array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`); }
}

function id(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function hash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value); const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value); const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`);
}

function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

function snapshot(value: unknown, path: string, state = { nodes: 0, bytes: 0 }): unknown {
  state.nodes += 1; if (state.nodes > 20_000) throw new TypeError("composed request exceeds the structural budget");
  if (value instanceof Uint8Array) {
    state.bytes += value.byteLength; if (!Number.isSafeInteger(state.bytes) || state.bytes > 512 * 1024 * 1024) throw new TypeError("composed request exceeds the pre-snapshot byte budget");
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) { array(value, path, 512); return value.map((item, index) => snapshot(item, `${path}.${index}`, state)); }
  if (typeof value === "object" && value !== null) {
    object(value, path); const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) copy[key] = snapshot(value[key], `${path}.${key}`, state);
    return copy;
  }
  if (typeof value === "string" && value.length > 1_000_000) throw new TypeError(`${path} exceeds the string budget`);
  return value;
}

function parseTrust(value: unknown): CaliperProvenanceTrustConfiguration {
  object(value, "caliper trust"); exact(value, ["trustedKeys", "maximumAttestationLifetimeMs", "maximumObservationAgeMs", "maximumCalibrationAgeMs"], "caliper trust");
  for (const key of ["maximumAttestationLifetimeMs", "maximumObservationAgeMs", "maximumCalibrationAgeMs"] as const) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1 || (value[key] as number) > 366 * 24 * 60 * 60 * 1000) throw new TypeError(`caliper trust.${key} is invalid`);
  object(value.trustedKeys, "caliper trust.trustedKeys"); const entries = Object.entries(value.trustedKeys);
  if (entries.length !== CALIPER_PROVENANCE_SCOPES.length) throw new TypeError("caliper trust must contain exactly independent calibration and measurement keys");
  const trustedKeys: Record<string, CaliperProvenanceTrustConfiguration["trustedKeys"][string]> = {}; const fingerprints = new Set<string>();
  for (const [keyId, raw] of entries) {
    id(keyId, "caliper trust keyId"); object(raw, `caliper trust.trustedKeys.${keyId}`); exact(raw, ["authorityId", "tenantId", "scopes", "publicKeyFingerprintSha256", "publicJwk"], `caliper trust.trustedKeys.${keyId}`);
    id(raw.authorityId, `caliper trust.trustedKeys.${keyId}.authorityId`); id(raw.tenantId, `caliper trust.trustedKeys.${keyId}.tenantId`); hash(raw.publicKeyFingerprintSha256, `caliper trust.trustedKeys.${keyId}.publicKeyFingerprintSha256`);
    array(raw.scopes, `caliper trust.trustedKeys.${keyId}.scopes`, 1);
    if (raw.scopes.length !== 1 || !CALIPER_PROVENANCE_SCOPES.includes(raw.scopes[0] as CaliperProvenanceScope)) throw new TypeError("each caliper trust key must have exactly one supported scope");
    object(raw.publicJwk, `caliper trust.trustedKeys.${keyId}.publicJwk`); exact(raw.publicJwk, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"], `caliper trust.trustedKeys.${keyId}.publicJwk`);
    array(raw.publicJwk.key_ops, `caliper trust.trustedKeys.${keyId}.publicJwk.key_ops`, 1);
    if (raw.publicJwk.key_ops.length !== 1 || raw.publicJwk.key_ops[0] !== "verify" || raw.publicJwk.ext !== true || raw.publicJwk.kty !== "EC" || raw.publicJwk.crv !== "P-256" || raw.publicJwk.use !== "sig" || raw.publicJwk.alg !== "ES256" || typeof raw.publicJwk.x !== "string" || typeof raw.publicJwk.y !== "string" || raw.publicJwk.x.length !== 43 || raw.publicJwk.y.length !== 43) throw new TypeError("caliper trusted JWK must be an ES256 public P-256 verify-only key");
    if (fingerprints.has(raw.publicKeyFingerprintSha256 as string)) throw new TypeError("calibration and measurement trust require independent public-key fingerprints"); fingerprints.add(raw.publicKeyFingerprintSha256 as string);
    trustedKeys[keyId] = { authorityId: raw.authorityId, tenantId: raw.tenantId, scopes: [raw.scopes[0] as CaliperProvenanceScope], publicKeyFingerprintSha256: raw.publicKeyFingerprintSha256, publicJwk: structuredClone(raw.publicJwk) };
  }
  return { trustedKeys, maximumAttestationLifetimeMs: value.maximumAttestationLifetimeMs as number, maximumObservationAgeMs: value.maximumObservationAgeMs as number, maximumCalibrationAgeMs: value.maximumCalibrationAgeMs as number };
}

function decodeCanonicalJson(artifact: CaliperActualByteArtifact, label: string): unknown {
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes); } catch { throw new TypeError(`${label} must be canonical UTF-8 JSON`); }
  let parsed: unknown; try { parsed = JSON.parse(text) as unknown; } catch { throw new TypeError(`${label} must be canonical JSON`); }
  if (canonicalJson(parsed) !== text) throw new TypeError(`${label} bytes must be canonical JSON`); return parsed;
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> { const decoded = atob(value); const bytes = new Uint8Array(new ArrayBuffer(decoded.length)); for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index); return bytes; }

async function verifyAttestation(attestation: CaliperCalibrationAttestation | CaliperMeasurementAttestation, trust: CaliperProvenanceTrustConfiguration, tenantId: string, evaluatedAt: number): Promise<string> {
  const trusted = trust.trustedKeys[attestation.keyId];
  if (!trusted || trusted.authorityId !== attestation.authorityId || trusted.tenantId !== tenantId || trusted.scopes.length !== 1 || trusted.scopes[0] !== attestation.scope) throw new TypeError("caliper attestation key is not host-trusted for this tenant, authority, and scope");
  const fingerprint = await caliperPublicJwkFingerprintSha256(trusted.publicJwk);
  if (fingerprint !== trusted.publicKeyFingerprintSha256 || fingerprint !== attestation.publicKeyFingerprintSha256) throw new TypeError("caliper public-key fingerprint does not match the exact host-trusted JWK");
  const issuedAt = Date.parse(attestation.issuedAt); const expiresAt = Date.parse(attestation.expiresAt);
  if (issuedAt > evaluatedAt || expiresAt <= evaluatedAt || expiresAt - issuedAt > trust.maximumAttestationLifetimeMs) throw new TypeError("caliper attestation is outside its allowed time window");
  const key = await crypto.subtle.importKey("jwk", trusted.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const payload = caliperAttestationPayload(attestation);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64Bytes(attestation.signatureBase64), new TextEncoder().encode(canonicalJson(payload)))) throw new TypeError("caliper attestation ES256 signature verification failed");
  return sha256Hex(canonicalJson(payload));
}

function findFormalizationParts(request: Record<string, unknown>): { candidate: FormalizationCandidate; measurementArtifact: Record<string, unknown>; physical: SignedEvidenceAttestation } {
  const candidate = parseFormalizationCandidate(request.candidate);
  array(request.artifacts, "formalizationRequest.artifacts", 40); const measurementArtifact = request.artifacts.find((item) => typeof item === "object" && item !== null && (item as Record<string, unknown>).kind === "measurement-sheet");
  if (!measurementArtifact || typeof measurementArtifact !== "object") throw new TypeError("formalization request requires the exact measurement-sheet actual bytes");
  array(request.attestations, "formalizationRequest.attestations", 4); const physical = request.attestations.find((item) => typeof item === "object" && item !== null && (item as Record<string, unknown>).scope === "physical-measurement");
  if (!physical) throw new TypeError("formalization request requires the physical-measurement attestation");
  return { candidate, measurementArtifact: measurementArtifact as Record<string, unknown>, physical: structuredClone(physical) as SignedEvidenceAttestation };
}

export async function evaluateCaliperMeasurementProvenance(value: unknown, contextValue: unknown): Promise<CaliperMeasurementProvenanceResult> {
  object(value, "request"); exact(value, REQUEST_KEYS, "request"); object(contextValue, "verification context"); exact(contextValue, CONTEXT_KEYS, "verification context");
  const request = snapshot(value, "request") as Record<string, unknown>; const context = snapshot(contextValue, "verification context") as Record<string, unknown>;
  timestamp(context.evaluatedAt, "verification context.evaluatedAt"); for (const key of ["expectedSupersededAttestationSha256", "expectedCalibrationRecordSha256", "expectedMeasurementSessionSha256"] as const) hash(context[key], `verification context.${key}`);
  object(request.formalizationRequest, "formalizationRequest"); object(request.markingProvenanceRequest, "markingProvenanceRequest");
  const formalizationRequest = request.formalizationRequest; const markingRequest = request.markingProvenanceRequest;
  const formalParts = findFormalizationParts(formalizationRequest);
  const markingCandidate = parseFormalizationCandidate(markingRequest.candidate);
  if (!same(formalParts.candidate, markingCandidate)) throw new TypeError("JSC-0212 and JSC-0213 requests must bind the exact same candidate");

  const calibrationArtifact = parseCaliperActualByteArtifact(request.calibrationRecordArtifact); const sessionArtifact = parseCaliperActualByteArtifact(request.measurementSessionArtifact);
  if (calibrationArtifact.kind !== "caliper-calibration-record" || sessionArtifact.kind !== "caliper-measurement-session") throw new TypeError("calibration and measurement session actual-byte kinds cannot be substituted");
  if (calibrationArtifact.artifactId === sessionArtifact.artifactId || calibrationArtifact.sha256 === sessionArtifact.sha256 || calibrationArtifact.byteLength + sessionArtifact.byteLength > CALIPER_TOTAL_ARTIFACT_MAX_BYTES) throw new TypeError("calibration and measurement session artifacts must have unique identities, digests, and bounded bytes");
  const nestedDigests = new Set<string>();
  for (const nested of [formalizationRequest.artifacts, markingRequest.artifacts]) if (Array.isArray(nested)) for (const artifact of nested) if (typeof artifact === "object" && artifact !== null && typeof (artifact as Record<string, unknown>).sha256 === "string") nestedDigests.add((artifact as Record<string, unknown>).sha256 as string);
  if (nestedDigests.has(calibrationArtifact.sha256) || nestedDigests.has(sessionArtifact.sha256)) throw new TypeError("source or existing evidence bytes cannot be relabelled as calibration or measurement-session bytes");
  if (await sha256Hex(calibrationArtifact.bytes) !== calibrationArtifact.sha256 || await sha256Hex(sessionArtifact.bytes) !== sessionArtifact.sha256) throw new TypeError("caliper artifact actual bytes do not match their declared SHA-256");
  if (calibrationArtifact.sha256 !== context.expectedCalibrationRecordSha256 || sessionArtifact.sha256 !== context.expectedMeasurementSessionSha256) throw new TypeError("caliper actual bytes do not match the host-expected lineage heads");

  const formalization = await evaluateNonProxyFormalizationReadiness(formalizationRequest, { evaluatedAt: context.evaluatedAt, trust: context.formalizationTrust });
  const marking = await evaluateMarkingInspectionAndSourceProvenance(markingRequest, { evaluatedAt: context.evaluatedAt, expectedSupersededAttestationSha256: context.expectedSupersededAttestationSha256, trust: context.markingProvenanceTrust });
  const candidateSha256 = await formalizationCandidateSha256(formalParts.candidate);
  if (formalization.candidateSha256 !== candidateSha256 || marking.candidateSha256 !== candidateSha256) throw new TypeError("internally recomputed provenance results cannot substitute the candidate");

  const calibration = parseCaliperCalibrationRecord(decodeCanonicalJson(calibrationArtifact, "calibration record"));
  const session = parseCaliperMeasurementSession(decodeCanonicalJson(sessionArtifact, "measurement session"));
  const calibrationPayloadSha256 = await sha256Hex(canonicalJson(calibration)); const measurementSessionPayloadSha256 = await sha256Hex(canonicalJson(session));
  const calibrationAttestation = parseCaliperCalibrationAttestation(request.calibrationAttestation); const measurementAttestation = parseCaliperMeasurementAttestation(request.measurementAttestation);
  const caliperTrust = parseTrust(context.caliperTrust); const evaluatedAt = Date.parse(context.evaluatedAt as string);
  if (calibrationAttestation.authorityId === measurementAttestation.authorityId || calibrationAttestation.keyId === measurementAttestation.keyId || calibrationAttestation.publicKeyFingerprintSha256 === measurementAttestation.publicKeyFingerprintSha256) throw new TypeError("calibration and measurement require independent authorities, keys, and public-key fingerprints");

  const calibrationDescriptor = { artifactId: calibrationArtifact.artifactId, kind: calibrationArtifact.kind, sourceRole: null, sha256: calibrationArtifact.sha256, byteLength: calibrationArtifact.byteLength };
  const sessionDescriptor = { artifactId: sessionArtifact.artifactId, kind: sessionArtifact.kind, sourceRole: null, sha256: sessionArtifact.sha256, byteLength: sessionArtifact.byteLength };
  if (!same(calibrationAttestation.calibrationRecord, calibrationDescriptor) || calibrationAttestation.calibrationPayloadSha256 !== calibrationPayloadSha256) throw new TypeError("calibration attestation must bind the exact canonical calibration actual bytes");
  if (!same(measurementAttestation.measurementSession, sessionDescriptor) || measurementAttestation.measurementSessionPayloadSha256 !== measurementSessionPayloadSha256) throw new TypeError("measurement attestation must bind the exact canonical measurement-session actual bytes");

  const measurementArtifactBytes = formalParts.measurementArtifact.bytes;
  if (!(measurementArtifactBytes instanceof Uint8Array)) throw new TypeError("JSC-0212 measurement document requires actual byte storage");
  let measurementText: string; try { measurementText = new TextDecoder("utf-8", { fatal: true }).decode(measurementArtifactBytes); } catch { throw new TypeError("JSC-0212 measurement document must be canonical UTF-8 JSON"); }
  let measurementValue: unknown; try { measurementValue = JSON.parse(measurementText) as unknown; } catch { throw new TypeError("JSC-0212 measurement document must be canonical JSON"); }
  if (canonicalJson(measurementValue) !== measurementText) throw new TypeError("JSC-0212 measurement document bytes must be canonical JSON");
  const measurementDocument = parseVerifiedPhysicalMeasurementDocument(measurementValue);
  const measurementSetSha256 = formalParts.candidate.requirements.physical.measurementSetSha256;

  const expectedSession = {
    tenantId: formalParts.candidate.tenantId, frameModelId: formalParts.candidate.frameModelId, frameVariantId: formalParts.candidate.frameVariantId,
    specimenId: marking.specimenId, caliperId: calibration.caliperId, calibrationRecordSha256: calibrationArtifact.sha256, calibrationPayloadSha256,
    calibrationValidFrom: calibration.validFrom, calibrationValidUntil: calibration.validUntil, candidateSha256, jobId: formalParts.candidate.generation.jobId,
    sourceAssetSha256s: formalParts.candidate.sourceAssetHashes, measurementSetSha256, captureProvenancePayloadSha256: marking.captureProvenancePayloadSha256,
  };
  for (const [key, expected] of Object.entries(expectedSession)) if (!same((session as unknown as Record<string, unknown>)[key], expected)) throw new TypeError(`measurement session cannot substitute composed ${key}`);
  const expectedAttestation = { tenantId: session.tenantId, specimenId: session.specimenId, caliperId: session.caliperId, candidateSha256, jobId: session.jobId, measurementSetSha256, sourceAssetSha256s: session.sourceAssetSha256s, captureProvenancePayloadSha256: session.captureProvenancePayloadSha256, calibrationRecordSha256: calibrationArtifact.sha256, calibrationPayloadSha256 };
  for (const [key, expected] of Object.entries(expectedAttestation)) if (!same((measurementAttestation as unknown as Record<string, unknown>)[key], expected)) throw new TypeError(`measurement attestation cannot substitute composed ${key}`);
  if (calibration.tenantId !== session.tenantId || calibrationAttestation.tenantId !== session.tenantId || calibrationAttestation.caliperId !== session.caliperId) throw new TypeError("calibration and session must bind the same tenant and caliper");
  if (measurementAttestation.authorityId !== measurementDocument.verifiedByAuthorityId || measurementAttestation.authorityId !== formalParts.physical.authorityId || measurementAttestation.keyId !== formalParts.physical.keyId) throw new TypeError("measurement authority and key must exactly match the internally verified JSC-0212 physical authority");
  const formalTrust = context.formalizationTrust as Record<string, unknown>; object(formalTrust, "formalization trust"); object(formalTrust.trustedKeys, "formalization trust.trustedKeys");
  const physicalTrusted = formalTrust.trustedKeys[formalParts.physical.keyId] as Record<string, unknown> | undefined;
  if (!physicalTrusted) throw new TypeError("JSC-0212 physical key must remain host-trusted"); object(physicalTrusted.publicJwk, "formalization physical publicJwk");
  const physicalFingerprint = await caliperPublicJwkFingerprintSha256(physicalTrusted.publicJwk as JsonWebKey);
  if (physicalFingerprint !== measurementAttestation.publicKeyFingerprintSha256) throw new TypeError("measurement JWK must exactly match the internally verified JSC-0212 physical key");

  for (const [index, observed] of session.measurements.entries()) {
    const documented = measurementDocument.measurements[index]!;
    if (observed.field !== documented.field || observed.valueMm !== documented.valueMm || observed.method !== documented.method || observed.sourceSha256 !== documented.sourceSha256) throw new TypeError("each direct caliper observation must exactly match the JSC-0212 measurement document value, source, method, and order");
  }
  if (session.observedAt !== measurementDocument.measuredAt) throw new TypeError("measurement session observation instant must exactly match the JSC-0212 measurement document");
  const observedAt = Date.parse(session.observedAt); const calibratedAt = Date.parse(calibration.calibratedAt); const validFrom = Date.parse(calibration.validFrom); const validUntil = Date.parse(calibration.validUntil);
  if (calibratedAt > validFrom || validFrom > observedAt || observedAt >= validUntil || validUntil <= evaluatedAt) throw new TypeError("all six observations require a currently valid calibration issued before observation");
  if (calibratedAt > Date.parse(calibrationAttestation.issuedAt)) throw new TypeError("calibration attestation cannot predate the calibration operation");
  if (Date.parse(calibrationAttestation.issuedAt) > observedAt || Date.parse(measurementAttestation.issuedAt) < observedAt) throw new TypeError("calibration attestation must precede observations and measurement attestation must follow them");
  if (evaluatedAt - observedAt > caliperTrust.maximumObservationAgeMs || observedAt - calibratedAt > caliperTrust.maximumCalibrationAgeMs || observedAt > evaluatedAt) throw new TypeError("calibration or measurement evidence is stale or future-dated");
  if (marking.verifiedCaptureProvenance.some((capture) => Date.parse(capture.capturedAt) > observedAt)) throw new TypeError("measurement observations cannot predate the verified specimen captures");

  await verifyAttestation(calibrationAttestation, caliperTrust, session.tenantId, evaluatedAt);
  await verifyAttestation(measurementAttestation, caliperTrust, session.tenantId, evaluatedAt);
  const validUntilResult = new Date(Math.min(
    Date.parse(formalization.validUntil), Date.parse(marking.validUntil), validUntil,
    Date.parse(calibrationAttestation.expiresAt), Date.parse(measurementAttestation.expiresAt),
    observedAt + caliperTrust.maximumObservationAgeMs, calibratedAt + caliperTrust.maximumCalibrationAgeMs,
  )).toISOString();
  return Object.freeze({
    readiness: "caliper-provenance-verified-for-authorized-human-review-input",
    candidateSha256, measurementSetSha256, calibrationRecordSha256: calibrationArtifact.sha256, calibrationPayloadSha256,
    measurementSessionSha256: sessionArtifact.sha256, measurementSessionPayloadSha256, captureProvenancePayloadSha256: marking.captureProvenancePayloadSha256,
    formalizationResultSha256: await sha256Hex(canonicalJson(formalization)), markingProvenanceResultSha256: await sha256Hex(canonicalJson(marking)),
    evaluatedAt: context.evaluatedAt as string, validUntil: validUntilResult, authority: CALIPER_PROVENANCE_AUTHORITY_DENIAL,
  });
}
