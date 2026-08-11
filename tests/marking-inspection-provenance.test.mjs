import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKING_CAPTURE_ROLES,
  MARKING_INSPECTION_REQUIRED_SURFACES,
  MARKING_INSPECTION_TOTAL_ARTIFACT_MAX_BYTES,
  canonicalJson,
  captureProvenanceAttestationPayload,
  markingCandidateSha256,
  markingInspectionAttestationPayload,
  reportedNoTempleMarkingAttestationPayload,
} from "../dist/packages/contracts/src/index.js";
import { evaluateMarkingInspectionAndSourceProvenance } from "../dist/packages/asset-review/src/index.js";

const EVALUATED_AT = "2026-08-11T06:00:00Z";
const ISSUED_AT = "2026-08-11T05:30:00Z";
const EXPIRES_AT = "2026-08-11T07:30:00Z";
const INSPECTED_AT = "2026-08-11T05:20:00Z";
const SPECIMEN_ID = "specimen-synthetic-test-only";
const bytes = (value) => new TextEncoder().encode(value);
const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map((item) => item.toString(16).padStart(2, "0")).join("");

function descriptor(artifact) {
  const { bytes: _ignored, ...value } = artifact;
  return value;
}

function deniedAuthority() {
  return {
    qaApproved: false,
    assetVersionCreated: false,
    assetVersionPromoted: false,
    recommendedForLive: false,
    activeDeployment: false,
    publication: false,
    gates: false,
  };
}

async function setup() {
  const identity = { tenantId: "tenant-1", frameModelId: "model-synthetic", frameVariantId: "variant-test-only" };
  const keyPairs = {
    report: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
    capture: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
    inspection: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  };
  const sourceBytes = Array.from({ length: 7 }, (_, index) => bytes(`synthetic marking-provenance test fixture ${index + 1}; not product evidence`));
  const sourceArtifacts = await Promise.all(sourceBytes.map(async (value, index) => ({
    artifactId: `source-${String(index + 1).padStart(2, "0")}`,
    kind: "source",
    sourceRole: null,
    bytes: value,
    sha256: await digest(value),
    byteLength: value.byteLength,
  })));
  sourceArtifacts.sort((left, right) => left.sha256.localeCompare(right.sha256));
  sourceArtifacts.forEach((artifact, index) => { artifact.artifactId = `source-${String(index + 1).padStart(2, "0")}`; });

  const hash = (character) => character.repeat(64);
  const candidate = {
    schemaVersion: 1,
    id: "candidate-synthetic-test-only-v1",
    ...identity,
    version: 1,
    quality: "standard",
    generationMethod: "standard-auto",
    modelUrl: "./model.glb",
    modelSha256: hash("a"),
    modelByteLength: 1024,
    manifestUrl: "./manifest.json",
    manifestSha256: hash("b"),
    manifestByteLength: 512,
    sourceAssetHashes: sourceArtifacts.map((artifact) => artifact.sha256).sort(),
    generation: {
      jobId: `gj_${hash("c")}`,
      canonicalInputSha256: hash("d"),
      reviewHeadEventSha256: hash("e"),
      generatorInputSha256: hash("f"),
      generator: { id: "standard-generator", version: "1.0.0", configSha256: hash("1") },
      qaDecisionSha256: hash("2"),
    },
    attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    qualityEnvelope: { maxYawDeg: 20, maxPitchDeg: 20, recommendedForLive: false, scaleConfidence: "high" },
    requirements: Object.fromEntries(["physical", "visualFidelity", "actualWear", "rights"].map((name, index) => [name, { evidenceSha256: hash(String(index + 3)), sourceAssetSha256: sourceArtifacts[0].sha256, measurementSetSha256: hash("7") }])),
    fixtureStatus: "unverified",
    admission: "unverified-evidence-candidate",
    promotable: false,
    status: "draft",
    authority: deniedAuthority(),
  };

  const reportUnsigned = {
    schemaVersion: 1,
    type: "reported-no-temple-marking-attestation",
    algorithm: "ES256",
    scope: "reported-marking-observation",
    authorityId: "authority-reported-observation",
    keyId: "key-reported-observation",
    ...identity,
    specimenId: SPECIMEN_ID,
    reportedByActorId: "reporter-synthetic-test-only",
    reportedAt: "2026-08-11T05:00:00Z",
    issuedAt: "2026-08-11T05:05:00Z",
    expiresAt: EXPIRES_AT,
  };
  async function signReport(value = reportUnsigned, privateKey = keyPairs.report.privateKey) {
    const signatureBase64 = Buffer.from(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      bytes(canonicalJson(reportedNoTempleMarkingAttestationPayload(value))),
    )).toString("base64");
    return { ...value, signatureBase64 };
  }
  const signReportWithCaptureKey = (value) => signReport(value, keyPairs.capture.privateKey);
  const report = await signReport();
  const reportBytes = bytes(canonicalJson(report));
  const reportArtifact = { artifactId: "reported-absence", kind: "reported-no-temple-marking-attestation", sourceRole: null, bytes: reportBytes, sha256: await digest(reportBytes), byteLength: reportBytes.byteLength };
  const artifacts = [...sourceArtifacts, reportArtifact];

  const markingRole = MARKING_CAPTURE_ROLES.find((role) => role === "marking") ?? MARKING_CAPTURE_ROLES.find((role) => role.includes("marking"));
  assert.ok(markingRole, "the contract must expose an explicit marking capture role");
  assert.ok(MARKING_INSPECTION_REQUIRED_SURFACES.length <= sourceArtifacts.length);
  const captureClaims = sourceArtifacts.map((artifact, index) => ({
    artifactId: artifact.artifactId,
    captureRole: index < MARKING_INSPECTION_REQUIRED_SURFACES.length
      ? markingRole
      : MARKING_CAPTURE_ROLES[(index - MARKING_INSPECTION_REQUIRED_SURFACES.length) % MARKING_CAPTURE_ROLES.length],
    specimenId: SPECIMEN_ID,
    capturedAt: `2026-08-11T05:${String(index + 1).padStart(2, "0")}:00Z`,
  }));
  const surfaceInspections = MARKING_INSPECTION_REQUIRED_SURFACES.map((surface, index) => ({
    surface,
    sourceArtifactId: sourceArtifacts[index].artifactId,
    result: "no-dimension-marking-observed",
  }));
  const candidateSha256 = await markingCandidateSha256(candidate);
  const common = {
    schemaVersion: 1,
    algorithm: "ES256",
    ...identity,
    specimenId: SPECIMEN_ID,
    jobId: candidate.generation.jobId,
    candidateSha256,
    sourceAssetSha256s: candidate.sourceAssetHashes,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  };
  const captureUnsigned = {
    ...common,
    issuedAt: "2026-08-11T05:15:00Z",
    type: "verified-capture-provenance-attestation",
    authorityId: "authority-capture-provenance",
    keyId: "key-capture-provenance",
    scope: "capture-provenance",
    artifacts: sourceArtifacts.map(descriptor).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    captures: captureClaims.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  };
  const captureProvenancePayloadSha256 = await digest(bytes(canonicalJson(captureProvenanceAttestationPayload(captureUnsigned))));
  const inspectionUnsigned = {
    ...common,
    type: "verified-marking-inspection-attestation",
    authorityId: "authority-marking-inspection",
    keyId: "key-marking-inspection",
    scope: "marking-inspection",
    captureProvenancePayloadSha256,
    reportArtifactId: reportArtifact.artifactId,
    policy: { policyId: "eyewear-dimension-marking-closed-surfaces", policyVersion: 1, hasTemples: true, markingClass: "dimension-markings-only", requiredSurfaces: [...MARKING_INSPECTION_REQUIRED_SURFACES] },
    surfaceInspections,
    inspectedByActorId: "inspector-synthetic-test-only",
    inspectedAt: INSPECTED_AT,
    supersedesAttestationSha256: reportArtifact.sha256,
  };
  async function signCapture(value = captureUnsigned) {
    const signatureBase64 = Buffer.from(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPairs.capture.privateKey,
      bytes(canonicalJson(captureProvenanceAttestationPayload(value))),
    )).toString("base64");
    return { ...value, signatureBase64 };
  }
  async function signInspection(value = inspectionUnsigned) {
    const signatureBase64 = Buffer.from(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPairs.inspection.privateKey,
      bytes(canonicalJson(markingInspectionAttestationPayload(value))),
    )).toString("base64");
    return { ...value, signatureBase64 };
  }
  const reportPublicJwk = await crypto.subtle.exportKey("jwk", keyPairs.report.publicKey);
  const capturePublicJwk = await crypto.subtle.exportKey("jwk", keyPairs.capture.publicKey);
  const inspectionPublicJwk = await crypto.subtle.exportKey("jwk", keyPairs.inspection.publicKey);
  const trust = {
    trustedKeys: {
      "key-reported-observation": {
        authorityId: reportUnsigned.authorityId,
        tenantId: identity.tenantId,
        scopes: [reportUnsigned.scope],
        publicJwk: { ...reportPublicJwk, use: "sig", alg: "ES256" },
      },
      "key-capture-provenance": {
        authorityId: captureUnsigned.authorityId,
        tenantId: identity.tenantId,
        scopes: [captureUnsigned.scope],
        publicJwk: { ...capturePublicJwk, use: "sig", alg: "ES256" },
      },
      "key-marking-inspection": {
        authorityId: inspectionUnsigned.authorityId,
        tenantId: identity.tenantId,
        scopes: [inspectionUnsigned.scope],
        publicJwk: { ...inspectionPublicJwk, use: "sig", alg: "ES256" },
      },
    },
    maximumAttestationLifetimeMs: 24 * 60 * 60 * 1000,
    maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  };
  return {
    candidate,
    artifacts,
    captureProvenanceAttestation: await signCapture(),
    markingInspectionAttestation: await signInspection(),
    trust,
    signCapture,
    signInspection,
    signReport,
    signReportWithCaptureKey,
    reportArtifact,
  };
}

const requestOf = (input) => ({
  candidate: input.candidate,
  artifacts: input.artifacts,
  captureProvenanceAttestation: input.captureProvenanceAttestation,
  markingInspectionAttestation: input.markingInspectionAttestation,
});
const contextOf = (input) => ({ evaluatedAt: EVALUATED_AT, expectedSupersededAttestationSha256: input.reportArtifact.sha256, trust: input.trust });
const evaluate = (input) => evaluateMarkingInspectionAndSourceProvenance(requestOf(input), contextOf(input));

test("closed, same-specimen, actual-byte marking inspection derives only the narrow absence result", async () => {
  assert.equal(Object.isFrozen(MARKING_CAPTURE_ROLES), true);
  assert.equal(Object.isFrozen(MARKING_INSPECTION_REQUIRED_SURFACES), true);
  const input = await setup();
  const result = await evaluate(input);
  assert.equal(result.inspectionOutcome, "no-dimension-marking-observed-under-policy");
  assert.equal(result.markingTranscriptionRoute, "not-applicable-under-policy");
  assert.equal(result.requirements.verifiedCaliperEvidenceRequired, true);
  assert.equal(result.requirements.allSixPhysicalDimensionsRequired, true);
  assert.equal(result.requirements.j1mMarkingSourceRequired, true);
  assert.equal(result.requirements.g1MarkingSourceRequired, true);
  assert.deepEqual(result.authority, deniedAuthority());
  assert.equal(result.evaluatedAt, EVALUATED_AT);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.values(result.authority).every((value) => value === false), true);
});

test("reported absence alone is not policy-inspected absence", async () => {
  const input = await setup();
  input.captureProvenanceAttestation = null;
  input.markingInspectionAttestation = null;
  await assert.rejects(evaluate(input), /attestation|required/);

  const reportOnly = await setup();
  reportOnly.artifacts = [reportOnly.reportArtifact];
  await assert.rejects(evaluate(reportOnly), /at least three surface captures|source set|source artifacts|candidate/);
});

test("actual bytes, exact candidate source inventory, and sourceRole:null fail closed", async () => {
  const changed = await setup(); changed.artifacts[0].bytes[0] ^= 1;
  await assert.rejects(evaluate(changed), /actual bytes|SHA-256/);

  const missing = await setup(); missing.artifacts.splice(0, 1);
  await assert.rejects(evaluate(missing), /source set|artifact descriptors|capture claims/);

  const relabelled = await setup(); relabelled.artifacts[1].sha256 = relabelled.artifacts[0].sha256;
  await assert.rejects(evaluate(relabelled), /relabelled|unique|actual bytes/);

  const extra = await setup(); extra.artifacts[0].sourceRole = "front";
  await assert.rejects(evaluate(extra), /sourceRole|null|unverified source roles/);
});

test("all required surfaces need distinct marking captures under the closed policy", async () => {
  const missing = await setup(); missing.markingInspectionAttestation.surfaceInspections.pop();
  await assert.rejects(evaluate(missing), /surface|policy|signature/);

  const duplicate = await setup(); duplicate.markingInspectionAttestation.surfaceInspections[1].sourceArtifactId = duplicate.markingInspectionAttestation.surfaceInspections[0].sourceArtifactId;
  await assert.rejects(evaluate(duplicate), /distinct|surface|signature/);

  const noTemples = await setup(); noTemples.markingInspectionAttestation.policy.hasTemples = false;
  await assert.rejects(evaluate(noTemples), /temples|policy|signature/);
});

test("capture roles are signed provenance and cannot be relabelled by the request", async () => {
  const role = await setup(); role.captureProvenanceAttestation.captures[0].captureRole = MARKING_CAPTURE_ROLES.find((value) => value !== role.captureProvenanceAttestation.captures[0].captureRole) ?? "front";
  await assert.rejects(evaluate(role), /signature verification|capture role|exact verified capture-provenance payload/);

  const unsignedRole = await setup(); unsignedRole.artifacts[0].captureRole = "front";
  await assert.rejects(evaluate(unsignedRole), /captureRole|not allowed|sourceRole/);
});

test("one specimen must bind report, captures, surfaces, candidate, job, and source set", async () => {
  const specimen = await setup(); specimen.captureProvenanceAttestation.captures[0].specimenId = "different-physical-item";
  specimen.captureProvenanceAttestation = await specimen.signCapture(specimen.captureProvenanceAttestation);
  await assert.rejects(evaluate(specimen), /same specimen|specimen/);

  const source = await setup(); source.captureProvenanceAttestation.sourceAssetSha256s = source.captureProvenanceAttestation.sourceAssetSha256s.slice(1);
  source.captureProvenanceAttestation = await source.signCapture(source.captureProvenanceAttestation);
  await assert.rejects(evaluate(source), /source set|candidate/);

  const job = await setup(); job.captureProvenanceAttestation.jobId = `gj_${"9".repeat(64)}`;
  job.captureProvenanceAttestation = await job.signCapture(job.captureProvenanceAttestation);
  await assert.rejects(evaluate(job), /jobId|candidate/);
});

test("actor, inspection time, report bytes, and supersedes digest are signature-bound", async () => {
  for (const mutate of [
    (value) => { value.inspectedByActorId = "other-inspector"; },
    (value) => { value.inspectedAt = "2026-08-11T05:21:00Z"; },
    (value) => { value.supersedesAttestationSha256 = "9".repeat(64); },
    (value) => { value.captureProvenancePayloadSha256 = "9".repeat(64); },
  ]) {
    const input = await setup(); mutate(input.markingInspectionAttestation);
    await assert.rejects(evaluate(input), /signature verification|report|exact verified capture-provenance payload/);
  }

  const noncanonicalReport = await setup();
  const report = noncanonicalReport.artifacts.find((artifact) => artifact.kind === "reported-no-temple-marking-attestation");
  report.bytes = bytes(JSON.stringify(JSON.parse(new TextDecoder().decode(report.bytes)), null, 2));
  report.byteLength = report.bytes.byteLength;
  report.sha256 = await digest(report.bytes);
  await assert.rejects(evaluate(noncanonicalReport), /canonical JSON/);

  const hostHead = await setup();
  await assert.rejects(evaluateMarkingInspectionAndSourceProvenance(requestOf(hostHead), { ...contextOf(hostHead), expectedSupersededAttestationSha256: "9".repeat(64) }), /host-expected exact reported attestation head/);

  const forgedReporter = await setup();
  const forgedReport = JSON.parse(new TextDecoder().decode(forgedReporter.reportArtifact.bytes));
  forgedReport.reportedByActorId = "forged-reporter";
  forgedReporter.reportArtifact.bytes = bytes(canonicalJson(forgedReport));
  forgedReporter.reportArtifact.byteLength = forgedReporter.reportArtifact.bytes.byteLength;
  forgedReporter.reportArtifact.sha256 = await digest(forgedReporter.reportArtifact.bytes);
  forgedReporter.markingInspectionAttestation.supersedesAttestationSha256 = forgedReporter.reportArtifact.sha256;
  forgedReporter.markingInspectionAttestation = await forgedReporter.signInspection(forgedReporter.markingInspectionAttestation);
  await assert.rejects(evaluate(forgedReporter), /signature verification/);

  const sharedAuthority = await setup();
  const sharedReport = JSON.parse(new TextDecoder().decode(sharedAuthority.reportArtifact.bytes));
  sharedReport.keyId = sharedAuthority.captureProvenanceAttestation.keyId;
  sharedReport.authorityId = sharedAuthority.captureProvenanceAttestation.authorityId;
  const signedSharedReport = await sharedAuthority.signReportWithCaptureKey(sharedReport);
  sharedAuthority.reportArtifact.bytes = bytes(canonicalJson(signedSharedReport));
  sharedAuthority.reportArtifact.byteLength = sharedAuthority.reportArtifact.bytes.byteLength;
  sharedAuthority.reportArtifact.sha256 = await digest(sharedAuthority.reportArtifact.bytes);
  sharedAuthority.markingInspectionAttestation.supersedesAttestationSha256 = sharedAuthority.reportArtifact.sha256;
  sharedAuthority.markingInspectionAttestation = await sharedAuthority.signInspection(sharedAuthority.markingInspectionAttestation);
  await assert.rejects(evaluate(sharedAuthority), /not trusted|independent keys and authorities|signature verification/);

  const invalidReportTime = await setup();
  const timeReport = JSON.parse(new TextDecoder().decode(invalidReportTime.reportArtifact.bytes));
  timeReport.issuedAt = "2026-08-11T04:59:59Z";
  const signedTimeReport = await invalidReportTime.signReport(timeReport);
  invalidReportTime.reportArtifact.bytes = bytes(canonicalJson(signedTimeReport));
  invalidReportTime.reportArtifact.byteLength = invalidReportTime.reportArtifact.bytes.byteLength;
  invalidReportTime.reportArtifact.sha256 = await digest(invalidReportTime.reportArtifact.bytes);
  invalidReportTime.markingInspectionAttestation.supersedesAttestationSha256 = invalidReportTime.reportArtifact.sha256;
  invalidReportTime.markingInspectionAttestation = await invalidReportTime.signInspection(invalidReportTime.markingInspectionAttestation);
  await assert.rejects(evaluate(invalidReportTime), /reported attestation time order/);
});

test("aggregate actual-byte budget fails before cloning or hashing an oversized package", async () => {
  const input = await setup();
  const sharedMaximumSource = new Uint8Array(32 * 1024 * 1024);
  const count = Math.floor(MARKING_INSPECTION_TOTAL_ARTIFACT_MAX_BYTES / sharedMaximumSource.byteLength) + 1;
  input.artifacts = Array.from({ length: count }, (_, index) => ({
    artifactId: `oversized-${index}`,
    kind: "source",
    sourceRole: null,
    bytes: sharedMaximumSource,
    sha256: String(index).padStart(64, "0"),
    byteLength: sharedMaximumSource.byteLength,
  }));
  await assert.rejects(evaluate(input), /total byte budget before snapshot/);
});

test("an observed marking keeps the transcription route required", async () => {
  const input = await setup();
  input.markingInspectionAttestation.surfaceInspections[0].result = "dimension-marking-observed";
  input.markingInspectionAttestation = await input.signInspection(input.markingInspectionAttestation);
  const result = await evaluate(input);
  assert.equal(result.inspectionOutcome, "dimension-marking-observed-under-policy");
  assert.equal(result.markingTranscriptionRoute, "required");
  assert.equal(result.requirements.verifiedCaliperEvidenceRequired, true);
  assert.equal(result.requirements.j1mMarkingSourceRequired, true);
  assert.equal(result.requirements.g1MarkingSourceRequired, true);
});

test("absence cannot waive six verified caliper dimensions or the J1-M/G1 marking source", async () => {
  const input = await setup();
  const result = await evaluate(input);
  assert.equal(result.markingTranscriptionRoute, "not-applicable-under-policy");
  assert.equal(result.requirements.verifiedCaliperEvidenceRequired, true);
  assert.equal(result.requirements.allSixPhysicalDimensionsRequired, true);
  assert.equal(result.requirements.j1mMarkingSourceRequired, true);
  assert.equal(result.requirements.g1MarkingSourceRequired, true);
  assert.equal(result.authority.qaApproved, false);
  assert.equal(result.authority.gates, false);
});

test("trust root and clock are host-only, snapshotted inputs and hostile accessors fail closed", async () => {
  const input = await setup();
  await assert.rejects(evaluateMarkingInspectionAndSourceProvenance({ ...requestOf(input), trust: input.trust }, contextOf(input)), /request.trust|not allowed/);
  await assert.rejects(evaluateMarkingInspectionAndSourceProvenance({ ...requestOf(input), evaluatedAt: EVALUATED_AT }, contextOf(input)), /request.evaluatedAt|not allowed/);

  let invoked = false;
  const hostile = Object.defineProperty({}, "candidate", { enumerable: true, get() { invoked = true; return {}; } });
  await assert.rejects(evaluateMarkingInspectionAndSourceProvenance(hostile, {}), /enumerable data properties/);
  assert.equal(invoked, false);

  const snapshot = await setup();
  const context = contextOf(snapshot);
  const pending = evaluateMarkingInspectionAndSourceProvenance(requestOf(snapshot), context);
  context.evaluatedAt = "2026-08-11T09:00:00Z";
  context.trust.maximumAttestationLifetimeMs = 1;
  context.trust.trustedKeys["key-marking-inspection"].tenantId = "other-tenant";
  const result = await pending;
  assert.equal(result.evaluatedAt, EVALUATED_AT);
});

test("candidate transplant and future or stale evidence fail closed", async () => {
  const candidate = await setup(); candidate.candidate.tenantId = "tenant-transplanted";
  await assert.rejects(evaluate(candidate), /candidate|source set|tenant/);

  const future = await setup();
  await assert.rejects(evaluateMarkingInspectionAndSourceProvenance(requestOf(future), { ...contextOf(future), evaluatedAt: "2026-08-11T05:10:00Z" }), /time window/);

  const stale = await setup(); stale.trust.maximumEvidenceAgeMs = 1;
  await assert.rejects(evaluate(stale), /stale/);
});
