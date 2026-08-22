
import {
  FORMALIZATION_PHYSICAL_FIELDS,
  MARKING_INSPECTION_REQUIRED_SURFACES,
  caliperAttestationPayload,
  caliperPublicJwkFingerprintSha256,
  canonicalJson,
  captureProvenanceAttestationPayload,
  formalizationCandidateSha256,
  markingInspectionAttestationPayload,
  reportedNoTempleMarkingAttestationPayload,
} from "../dist/packages/contracts/src/index.js";
import { evaluateCaliperMeasurementProvenance } from "../dist/packages/asset-review/src/index.js";
import { setup as setupFormalization } from "./non-proxy-formalization-readiness.fixture.mjs";

const AT = "2026-08-11T03:00:00Z";
const OBSERVED_AT = "2026-08-11T01:30:00Z";
const SPECIMEN = "specimen-synthetic-caliper-only";
const bytes = (value) => new TextEncoder().encode(value);
const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map((item) => item.toString(16).padStart(2, "0")).join("");
const descriptor = (artifact) => { const { bytes: _ignored, ...value } = artifact; return value; };
const denied = () => ({ qaApproved: false, assetVersionCreated: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false, publication: false, gates: false });

async function sign(value, privateKey, payload = (item) => item) {
  const signatureBase64 = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes(canonicalJson(payload(value))))).toString("base64");
  return { ...value, signatureBase64 };
}
export async function setup() {
  const formal = await setupFormalization();
  const candidate = formal.candidate;
  const candidateSha256 = await formalizationCandidateSha256(candidate);
  const sources = formal.artifacts.filter((artifact) => artifact.kind === "source").map((artifact) => ({ ...artifact, bytes: new Uint8Array(artifact.bytes) }));

  const reportKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const captureKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const inspectionKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const identity = { tenantId: candidate.tenantId, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId };
  const reportUnsigned = {
    schemaVersion: 1, type: "reported-no-temple-marking-attestation", algorithm: "ES256", scope: "reported-marking-observation",
    authorityId: "authority-reported-caliper-fixture", keyId: "key-reported-caliper-fixture", ...identity, specimenId: SPECIMEN,
    reportedByActorId: "synthetic-reporter", reportedAt: "2026-08-11T01:05:00Z", issuedAt: "2026-08-11T01:06:00Z", expiresAt: "2026-08-11T04:00:00Z",
  };
  const report = await sign(reportUnsigned, reportKey.privateKey, reportedNoTempleMarkingAttestationPayload);
  const reportBytes = bytes(canonicalJson(report));
  const reportArtifact = { artifactId: "reported-caliper-absence", kind: "reported-no-temple-marking-attestation", sourceRole: null, bytes: reportBytes, sha256: await digest(reportBytes), byteLength: reportBytes.byteLength };
  const captureUnsigned = {
    schemaVersion: 1, type: "verified-capture-provenance-attestation", algorithm: "ES256", scope: "capture-provenance",
    authorityId: "authority-capture-caliper-fixture", keyId: "key-capture-caliper-fixture", candidateSha256, ...identity,
    jobId: candidate.generation.jobId, specimenId: SPECIMEN, sourceAssetSha256s: candidate.sourceAssetHashes,
    artifacts: sources.map(descriptor).sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    captures: sources.map((artifact, index) => ({ artifactId: artifact.artifactId, captureRole: "marking", specimenId: SPECIMEN, capturedAt: `2026-08-11T01:${String(10 + index).padStart(2, "0")}:00Z` })).sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    issuedAt: "2026-08-11T01:15:00Z", expiresAt: "2026-08-11T04:00:00Z",
  };
  const capturePayloadSha256 = await digest(bytes(canonicalJson(captureProvenanceAttestationPayload(captureUnsigned))));
  const inspectionUnsigned = {
    schemaVersion: 1, type: "verified-marking-inspection-attestation", algorithm: "ES256", scope: "marking-inspection",
    authorityId: "authority-inspection-caliper-fixture", keyId: "key-inspection-caliper-fixture", candidateSha256, ...identity,
    jobId: candidate.generation.jobId, specimenId: SPECIMEN, sourceAssetSha256s: candidate.sourceAssetHashes,
    captureProvenancePayloadSha256: capturePayloadSha256, reportArtifactId: reportArtifact.artifactId, supersedesAttestationSha256: reportArtifact.sha256,
    policy: { policyId: "eyewear-dimension-marking-closed-surfaces", policyVersion: 1, hasTemples: true, markingClass: "dimension-markings-only", requiredSurfaces: [...MARKING_INSPECTION_REQUIRED_SURFACES] },
    surfaceInspections: MARKING_INSPECTION_REQUIRED_SURFACES.map((surface, index) => ({ surface, sourceArtifactId: sources[index].artifactId, result: "no-dimension-marking-observed" })),
    inspectedByActorId: "synthetic-inspector", inspectedAt: "2026-08-11T01:20:00Z", issuedAt: "2026-08-11T01:25:00Z", expiresAt: "2026-08-11T04:00:00Z",
  };
  const markingTrustKeys = {};
  for (const [unsigned, pair] of [[reportUnsigned, reportKey], [captureUnsigned, captureKey], [inspectionUnsigned, inspectionKey]]) {
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    markingTrustKeys[unsigned.keyId] = { authorityId: unsigned.authorityId, tenantId: candidate.tenantId, scopes: [unsigned.scope], publicJwk: { ...jwk, use: "sig", alg: "ES256" } };
  }
  const markingProvenanceRequest = {
    candidate, artifacts: [...sources, reportArtifact],
    captureProvenanceAttestation: await sign(captureUnsigned, captureKey.privateKey, captureProvenanceAttestationPayload),
    markingInspectionAttestation: await sign(inspectionUnsigned, inspectionKey.privateKey, markingInspectionAttestationPayload),
  };

  const calibrationKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const measurementKey = formal.keyPairs.get("physical-measurement");
  const calibrationJwk = { ...await crypto.subtle.exportKey("jwk", calibrationKey.publicKey), use: "sig", alg: "ES256" };
  const measurementJwk = { ...await crypto.subtle.exportKey("jwk", measurementKey.publicKey), use: "sig", alg: "ES256" };
  const calibrationFingerprint = await caliperPublicJwkFingerprintSha256(calibrationJwk);
  const measurementFingerprint = await caliperPublicJwkFingerprintSha256(measurementJwk);
  const calibration = {
    schemaVersion: 1, type: "caliper-calibration-record", tenantId: candidate.tenantId, caliperId: "caliper-synthetic-01",
    serialNumber: "serial-synthetic-01", calibratedByOperatorId: "calibration-operator", calibratedAt: "2026-08-11T00:50:00Z",
    validFrom: "2026-08-11T01:00:00Z", validUntil: "2026-08-11T04:00:00Z", unit: "mm", referenceStandardId: "reference-synthetic", certificateId: "certificate-synthetic",
  };
  const calibrationBytes = bytes(canonicalJson(calibration));
  const calibrationRecordArtifact = { artifactId: "calibration-record", kind: "caliper-calibration-record", sourceRole: null, bytes: calibrationBytes, sha256: await digest(calibrationBytes), byteLength: calibrationBytes.byteLength };
  const calibrationPayloadSha256 = await digest(bytes(canonicalJson(calibration)));
  const measurementSetSha256 = candidate.requirements.physical.measurementSetSha256;
  const session = {
    schemaVersion: 1, type: "caliper-measurement-session", ...identity, specimenId: SPECIMEN, operatorId: "measurement-operator", observedAt: OBSERVED_AT,
    caliperId: calibration.caliperId, calibrationRecordSha256: calibrationRecordArtifact.sha256, calibrationPayloadSha256,
    calibrationValidFrom: calibration.validFrom, calibrationValidUntil: calibration.validUntil, candidateSha256, jobId: candidate.generation.jobId,
    sourceAssetSha256s: candidate.sourceAssetHashes, measurementSetSha256, captureProvenancePayloadSha256: capturePayloadSha256,
    observationMode: "direct-physical-caliper-observation",
    measurements: formal.measurementDocument.measurements.map((item) => ({ ...item, unit: "mm", observedAt: OBSERVED_AT })),
  };
  const sessionBytes = bytes(canonicalJson(session));
  const measurementSessionArtifact = { artifactId: "measurement-session", kind: "caliper-measurement-session", sourceRole: null, bytes: sessionBytes, sha256: await digest(sessionBytes), byteLength: sessionBytes.byteLength };
  const sessionPayloadSha256 = await digest(bytes(canonicalJson(session)));
  const calibrationAttestationUnsigned = {
    schemaVersion: 1, type: "caliper-calibration-attestation", algorithm: "ES256", scope: "caliper-calibration", authorityId: "authority-calibration",
    keyId: "key-calibration", publicKeyFingerprintSha256: calibrationFingerprint, tenantId: candidate.tenantId, caliperId: calibration.caliperId,
    calibrationRecord: descriptor(calibrationRecordArtifact), calibrationPayloadSha256, issuedAt: "2026-08-11T01:05:00Z", expiresAt: "2026-08-11T04:00:00Z",
  };
  const measurementAttestationUnsigned = {
    schemaVersion: 1, type: "caliper-measurement-attestation", algorithm: "ES256", scope: "caliper-measurement", authorityId: "authority-physical-measurement",
    keyId: "key-physical-measurement", publicKeyFingerprintSha256: measurementFingerprint, tenantId: candidate.tenantId, specimenId: SPECIMEN, caliperId: calibration.caliperId,
    candidateSha256, jobId: candidate.generation.jobId, measurementSetSha256, sourceAssetSha256s: candidate.sourceAssetHashes, captureProvenancePayloadSha256: capturePayloadSha256,
    calibrationRecordSha256: calibrationRecordArtifact.sha256, calibrationPayloadSha256, measurementSession: descriptor(measurementSessionArtifact), measurementSessionPayloadSha256: sessionPayloadSha256,
    issuedAt: "2026-08-11T01:35:00Z", expiresAt: "2026-08-11T04:00:00Z",
  };
  const request = {
    formalizationRequest: { candidate, artifacts: formal.artifacts, attestations: formal.attestations }, markingProvenanceRequest,
    calibrationRecordArtifact, measurementSessionArtifact,
    calibrationAttestation: await sign(calibrationAttestationUnsigned, calibrationKey.privateKey, caliperAttestationPayload),
    measurementAttestation: await sign(measurementAttestationUnsigned, measurementKey.privateKey, caliperAttestationPayload),
  };
  const context = {
    evaluatedAt: AT, expectedSupersededAttestationSha256: reportArtifact.sha256, expectedCalibrationRecordSha256: calibrationRecordArtifact.sha256,
    expectedMeasurementSessionSha256: measurementSessionArtifact.sha256, formalizationTrust: formal.trust,
    markingProvenanceTrust: { trustedKeys: markingTrustKeys, maximumAttestationLifetimeMs: 24 * 60 * 60 * 1000, maximumEvidenceAgeMs: 24 * 60 * 60 * 1000 },
    caliperTrust: {
      trustedKeys: {
        "key-calibration": { authorityId: "authority-calibration", tenantId: candidate.tenantId, scopes: ["caliper-calibration"], publicKeyFingerprintSha256: calibrationFingerprint, publicJwk: calibrationJwk },
        "key-physical-measurement": { authorityId: "authority-physical-measurement", tenantId: candidate.tenantId, scopes: ["caliper-measurement"], publicKeyFingerprintSha256: measurementFingerprint, publicJwk: measurementJwk },
      },
      maximumAttestationLifetimeMs: 24 * 60 * 60 * 1000, maximumObservationAgeMs: 24 * 60 * 60 * 1000, maximumCalibrationAgeMs: 24 * 60 * 60 * 1000,
    },
  };
  async function replaceSession(mutator) {
    const next = structuredClone(session); mutator(next);
    const nextBytes = bytes(canonicalJson(next)); request.measurementSessionArtifact.bytes = nextBytes; request.measurementSessionArtifact.byteLength = nextBytes.byteLength; request.measurementSessionArtifact.sha256 = await digest(nextBytes);
    context.expectedMeasurementSessionSha256 = request.measurementSessionArtifact.sha256;
    const unsigned = {
      ...measurementAttestationUnsigned, tenantId: next.tenantId, specimenId: next.specimenId, caliperId: next.caliperId,
      candidateSha256: next.candidateSha256, jobId: next.jobId, measurementSetSha256: next.measurementSetSha256,
      sourceAssetSha256s: next.sourceAssetSha256s, captureProvenancePayloadSha256: next.captureProvenancePayloadSha256,
      calibrationRecordSha256: next.calibrationRecordSha256, calibrationPayloadSha256: next.calibrationPayloadSha256,
      measurementSession: descriptor(request.measurementSessionArtifact), measurementSessionPayloadSha256: await digest(bytes(canonicalJson(next))),
    };
    request.measurementAttestation = await sign(unsigned, measurementKey.privateKey, caliperAttestationPayload);
  }
  async function replaceCalibration(mutator) {
    const next = structuredClone(calibration); mutator(next);
    const nextBytes = bytes(canonicalJson(next)); request.calibrationRecordArtifact.bytes = nextBytes; request.calibrationRecordArtifact.byteLength = nextBytes.byteLength; request.calibrationRecordArtifact.sha256 = await digest(nextBytes);
    context.expectedCalibrationRecordSha256 = request.calibrationRecordArtifact.sha256;
    const payloadSha256 = await digest(bytes(canonicalJson(next)));
    request.calibrationAttestation = await sign({ ...calibrationAttestationUnsigned, caliperId: next.caliperId, calibrationRecord: descriptor(request.calibrationRecordArtifact), calibrationPayloadSha256: payloadSha256 }, calibrationKey.privateKey, caliperAttestationPayload);
    await replaceSession((nextSession) => { nextSession.caliperId = next.caliperId; nextSession.calibrationRecordSha256 = request.calibrationRecordArtifact.sha256; nextSession.calibrationPayloadSha256 = payloadSha256; nextSession.calibrationValidFrom = next.validFrom; nextSession.calibrationValidUntil = next.validUntil; });
  }
  return { request, context, formal, reportKey, captureKey, inspectionKey, calibrationKey, measurementKey, calibrationJwk, measurementJwk, calibration, session, replaceSession, replaceCalibration };
}
