import assert from "node:assert/strict";
import test from "node:test";

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
import { setup as setupFormalization } from "./non-proxy-formalization-readiness.test.mjs";

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

async function setup() {
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
  return { request, context, formal, calibrationKey, measurementKey, calibrationJwk, measurementJwk, calibration, session, replaceSession, replaceCalibration };
}

test("composes internally replayed JSC-0212/JSC-0213 with direct calibrated observations into only a digest result", async () => {
  const input = await setup(); const result = await evaluateCaliperMeasurementProvenance(input.request, input.context);
  assert.equal(result.readiness, "caliper-provenance-verified-for-authorized-human-review-input");
  assert.deepEqual(result.authority, denied()); assert.equal(Object.values(result.authority).every((value) => value === false), true);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.authority), true);
  for (const forbidden of ["candidate", "specimenId", "operatorId", "caliperId", "measurements", "calibration", "session", "qaDecision", "assetVersion"]) assert.equal(forbidden in result, false);
});

test("annotated image, marking transcription, user absence, and assumed thickness cannot be relabelled as caliper", async () => {
  for (const mode of ["annotated-image", "marking-transcription", "reported-user-absence", "assumed-thickness"]) {
    const input = await setup(); await input.replaceSession((session) => { session.observationMode = mode; });
    await assert.rejects(evaluateCaliperMeasurementProvenance(input.request, input.context), /direct physical caliper observation/);
  }
  const image = await setup(); image.request.measurementSessionArtifact = structuredClone(image.request.formalizationRequest.artifacts.find((artifact) => artifact.kind === "source"));
  image.request.measurementSessionArtifact.kind = "caliper-measurement-session"; image.context.expectedMeasurementSessionSha256 = image.request.measurementSessionArtifact.sha256;
  await assert.rejects(evaluateCaliperMeasurementProvenance(image.request, image.context), /relabelled|canonical JSON|measurement session/);
});

test("same specimen, candidate, job, source set, MeasurementSet, capture payload and exact JSC-0212 values are mandatory", async () => {
  const mutations = [
    [(session) => { session.specimenId = "other-specimen"; }, /specimenId/],
    [(session) => { session.candidateSha256 = "9".repeat(64); }, /candidateSha256/],
    [(session) => { session.jobId = `gj_${"9".repeat(64)}`; }, /jobId/],
    [(session) => { session.sourceAssetSha256s = session.sourceAssetSha256s.slice(1); }, /sourceAssetSha256s/],
    [(session) => { session.measurementSetSha256 = "9".repeat(64); }, /measurementSetSha256/],
    [(session) => { session.captureProvenancePayloadSha256 = "9".repeat(64); }, /captureProvenancePayloadSha256/],
    [(session) => { session.measurements[0].valueMm += 0.01; }, /exactly match/],
    [(session) => { session.measurements[0].sourceSha256 = "9".repeat(64); }, /exactly match/],
  ];
  for (const [mutate, pattern] of mutations) { const input = await setup(); await input.replaceSession(mutate); await assert.rejects(evaluateCaliperMeasurementProvenance(input.request, input.context), pattern); }
});

test("six atomic observations require exact field order, mm, caliper method, and one observation instant", async () => {
  const mutations = [
    (session) => { session.measurements.pop(); },
    (session) => { session.measurements[1].field = session.measurements[0].field; },
    (session) => { session.measurements.reverse(); },
    (session) => { session.measurements[0].unit = "cm"; },
    (session) => { session.measurements[0].method = "marking"; },
    (session) => { session.measurements[0].observedAt = "2026-08-11T01:31:00Z"; },
  ];
  for (const mutate of mutations) { const input = await setup(); await input.replaceSession(mutate); await assert.rejects(evaluateCaliperMeasurementProvenance(input.request, input.context), /six|order|caliper|mm|atomic/); }
});

test("caliper certificate must match the device, precede and cover all observations, remain current, and not be stale", async () => {
  const different = await setup(); await different.replaceSession((session) => { session.caliperId = "different-caliper"; });
  await assert.rejects(evaluateCaliperMeasurementProvenance(different.request, different.context), /caliperId|caliper/);
  const future = await setup(); await future.replaceSession((session) => { session.observedAt = "2026-08-11T04:01:00Z"; session.measurements.forEach((item) => { item.observedAt = session.observedAt; }); });
  await assert.rejects(evaluateCaliperMeasurementProvenance(future.request, future.context), /calibration|future|observations|observation instant/);
  const stale = await setup(); stale.context.caliperTrust.maximumCalibrationAgeMs = 1;
  await assert.rejects(evaluateCaliperMeasurementProvenance(stale.request, stale.context), /stale/);
  const calibratedAfter = await setup(); await calibratedAfter.replaceCalibration((record) => { record.calibratedAt = "2026-08-11T01:31:00Z"; record.validFrom = "2026-08-11T01:31:00Z"; });
  await assert.rejects(evaluateCaliperMeasurementProvenance(calibratedAfter.request, calibratedAfter.context), /calibration|observations/);
  const expired = await setup(); await expired.replaceCalibration((record) => { record.validUntil = "2026-08-11T01:29:59Z"; });
  await assert.rejects(evaluateCaliperMeasurementProvenance(expired.request, expired.context), /calibration|observations/);
  const futureCertificate = await setup(); await futureCertificate.replaceCalibration((record) => { record.validFrom = "2026-08-11T01:31:00Z"; });
  await assert.rejects(evaluateCaliperMeasurementProvenance(futureCertificate.request, futureCertificate.context), /calibration|observations/);
  const after = await setup(); after.request.calibrationAttestation.issuedAt = "2026-08-11T01:31:00Z";
  await assert.rejects(evaluateCaliperMeasurementProvenance(after.request, after.context), /precede|signature/);
});

test("calibration and measurement authorities, key IDs and host-JWK fingerprints are independent", async () => {
  const authority = await setup(); authority.request.calibrationAttestation.authorityId = authority.request.measurementAttestation.authorityId;
  await assert.rejects(evaluateCaliperMeasurementProvenance(authority.request, authority.context), /independent/);
  const key = await setup(); key.request.calibrationAttestation.keyId = key.request.measurementAttestation.keyId;
  await assert.rejects(evaluateCaliperMeasurementProvenance(key.request, key.context), /independent/);
  const jwk = await setup(); jwk.context.caliperTrust.trustedKeys["key-calibration"].publicJwk = structuredClone(jwk.measurementJwk);
  await assert.rejects(evaluateCaliperMeasurementProvenance(jwk.request, jwk.context), /fingerprint|independent/);
});

test("trust, clock, lineage, and cached positive results are host-only and unknown request fields fail closed", async () => {
  for (const [name, value] of [["trust", {}], ["evaluatedAt", AT], ["expectedCalibrationRecordSha256", "0".repeat(64)], ["formalizationReadiness", { readiness: "evidence-package-verified-for-authorized-human-review-input" }], ["markingResult", {}], ["precomputedResult", { readiness: "caliper-provenance-verified-for-authorized-human-review-input" }]]) {
    const input = await setup(); input.request[name] = value;
    await assert.rejects(evaluateCaliperMeasurementProvenance(input.request, input.context), /not allowed/);
  }
  const head = await setup(); head.context.expectedMeasurementSessionSha256 = "9".repeat(64);
  await assert.rejects(evaluateCaliperMeasurementProvenance(head.request, head.context), /host-expected lineage/);
});

test("actual bytes, canonical JSON, sourceRole:null, digest uniqueness, and budgets fail closed", async () => {
  const changed = await setup(); changed.request.measurementSessionArtifact.bytes[0] ^= 1;
  await assert.rejects(evaluateCaliperMeasurementProvenance(changed.request, changed.context), /actual bytes|canonical/);
  const role = await setup(); role.request.calibrationRecordArtifact.sourceRole = "calibration";
  await assert.rejects(evaluateCaliperMeasurementProvenance(role.request, role.context), /sourceRole:null/);
  const duplicate = await setup(); duplicate.request.measurementSessionArtifact.sha256 = duplicate.request.calibrationRecordArtifact.sha256;
  await assert.rejects(evaluateCaliperMeasurementProvenance(duplicate.request, duplicate.context), /unique identities, digests/);
  const noncanonical = await setup(); const text = new TextDecoder().decode(noncanonical.request.calibrationRecordArtifact.bytes); noncanonical.request.calibrationRecordArtifact.bytes = bytes(`${text}\n`); noncanonical.request.calibrationRecordArtifact.byteLength += 1; noncanonical.request.calibrationRecordArtifact.sha256 = await digest(noncanonical.request.calibrationRecordArtifact.bytes); noncanonical.context.expectedCalibrationRecordSha256 = noncanonical.request.calibrationRecordArtifact.sha256;
  await assert.rejects(evaluateCaliperMeasurementProvenance(noncanonical.request, noncanonical.context), /canonical JSON/);
  const oversized = await setup(); oversized.request.measurementSessionArtifact.bytes = new Uint8Array(128 * 1024 + 1); oversized.request.measurementSessionArtifact.byteLength = oversized.request.measurementSessionArtifact.bytes.byteLength;
  await assert.rejects(evaluateCaliperMeasurementProvenance(oversized.request, oversized.context), /kind-specific limit/);
});

test("nested accessors/prototypes are rejected without invocation and post-call mutations cannot win TOCTOU", async () => {
  const hostileInput = await setup(); let invoked = false;
  hostileInput.request.formalizationRequest = Object.defineProperty({}, "candidate", { enumerable: true, get() { invoked = true; return {}; } });
  await assert.rejects(evaluateCaliperMeasurementProvenance(hostileInput.request, hostileInput.context), /enumerable data properties/); assert.equal(invoked, false);
  const prototype = await setup(); prototype.request.measurementAttestation = Object.assign(Object.create({ inherited: true }), prototype.request.measurementAttestation);
  await assert.rejects(evaluateCaliperMeasurementProvenance(prototype.request, prototype.context), /plain object/);
  const snapshot = await setup(); const pending = evaluateCaliperMeasurementProvenance(snapshot.request, snapshot.context);
  snapshot.request.measurementSessionArtifact.bytes.fill(0); snapshot.context.evaluatedAt = "2026-08-12T00:00:00Z"; snapshot.context.caliperTrust.trustedKeys = {};
  const result = await pending; assert.equal(result.evaluatedAt, AT); assert.equal(result.readiness, "caliper-provenance-verified-for-authorized-human-review-input");
});
