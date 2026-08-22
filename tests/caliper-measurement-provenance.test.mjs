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
import { setup as setupFormalization } from "./non-proxy-formalization-readiness.fixture.mjs";
import { setup } from "./caliper-measurement-provenance.fixture.mjs";

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

test("direct caliper snapshot uses intrinsic typed-array length without invoking byteLength shadows", async () => {
  const getter = await setup(); let invoked = false; const getterBytes = getter.request.measurementSessionArtifact.bytes; Object.defineProperty(getterBytes, "byteLength", { configurable: true, get() { invoked = true; return 0; } });
  const getterResult = await evaluateCaliperMeasurementProvenance(getter.request, getter.context); assert.equal(getterResult.readiness, "caliper-provenance-verified-for-authorized-human-review-input"); assert.equal(invoked, false);
  const data = await setup(); Object.defineProperty(data.request.measurementSessionArtifact.bytes, "byteLength", { configurable: true, value: 0 }); const dataResult = await evaluateCaliperMeasurementProvenance(data.request, data.context); assert.equal(dataResult.readiness, "caliper-provenance-verified-for-authorized-human-review-input");
  const proxy = await setup(); proxy.request.measurementSessionArtifact.bytes = new Proxy(proxy.request.measurementSessionArtifact.bytes, {}); await assert.rejects(evaluateCaliperMeasurementProvenance(proxy.request, proxy.context), /genuine Uint8Array/);
});
