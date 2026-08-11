import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FORMALIZATION_PHYSICAL_FIELDS,
  FORMALIZATION_SCOPES,
  canonicalJson,
  formalizationCandidateSha256,
} from "../dist/packages/contracts/src/index.js";
import { createNonProxyQaDecision, evaluateNonProxyFormalizationReadiness, reviewNonProxyGenerationOutput, validateNonProxyAssetProvenance } from "../dist/packages/asset-review/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";
import { appendGenerationJobEvent, createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { readGlb } from "../dist/packages/assets/src/index.js";

const AT = "2026-08-11T03:00:00Z";
const DECISION_AT = "2026-08-11T02:00:00Z";
const bytes = (value) => new TextEncoder().encode(value);
const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map((item) => item.toString(16).padStart(2, "0")).join("");

const proxyFixtureUrl = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);
let modelFixturePromise;
function assembleGlb(json, binaryBuffer) {
  const rawJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(rawJson.byteLength / 4) * 4;
  const binary = new Uint8Array(binaryBuffer);
  const binaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(rawJson, 20);
  output.set(binary, 28 + jsonLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  view.setUint32(20 + jsonLength, binaryLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  return output;
}
async function validModelFixture() {
  modelFixturePromise ??= readFile(proxyFixtureUrl, "utf8").then(JSON.parse).then(generateProxyBundle).then((generated) => {
    const proxyGlb = new Uint8Array(generated.glb);
    const parsed = readGlb(generated.glb);
    const json = structuredClone(parsed.json);
    json.asset.generator = "standard-generator@1.0.0";
    json.asset.extras = { unit: "metre", profile: "synthetic-standard-test-fixture" };
    json.extras = { unit: "metre", quality: "standard", fixture: false };
    json.nodes.find((node) => node.name === "SYNTHETIC_PROXY_NOT_PRODUCT_NOT_J1_M").name = "SYNTHETIC_STANDARD_TEST_FIXTURE";
    return { ...generated, proxyGlb, glb: assembleGlb(json, parsed.binary) };
  });
  return modelFixturePromise;
}

function descriptor(artifact) {
  const { bytes: _ignored, ...value } = artifact;
  return value;
}

function authority() {
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
  const identity = { tenantId: "tenant-1", frameModelId: "model-1", frameVariantId: "variant-1" };
  const sourceFrontBytes = bytes("physical product front source");
  const sourceSideBytes = bytes("physical product side source");
  const sourceHash = await digest(sourceFrontBytes);
  const sourceSideHash = await digest(sourceSideBytes);
  const sourceHashes = [sourceHash, sourceSideHash].sort();
  const dimensionValues = [48, 24, 135, 136, 40, 4];
  const measurementDocument = {
    schemaVersion: 1,
    type: "verified-physical-measurement-set",
    ...identity,
    verifiedByAuthorityId: "authority-physical-measurement",
    measuredAt: "2026-08-11T01:30:00Z",
    verification: "verified",
    measurements: FORMALIZATION_PHYSICAL_FIELDS.map((field, index) => ({ field, valueMm: dimensionValues[index], method: "caliper", sourceSha256: sourceHash })),
  };
  const measurementBytes = bytes(canonicalJson(measurementDocument));
  const measurementHash = await digest(measurementBytes);
  const generated = await validModelFixture();
  const modelBytes = new Uint8Array(generated.glb);
  const modelHash = await digest(modelBytes);
  const modelUrl = "./model.glb";
  const manifestDocument = {
    schemaVersion: 1,
    assetId: "candidate-standard-v1",
    assetVersion: 1,
    fixture: false,
    generator: { name: "standard-generator", version: "1.0.0" },
    model: { url: modelUrl, sha256: modelHash, byteLength: modelBytes.byteLength, format: "glb", unit: "metre", boundsMetres: generated.manifest.model.boundsMetres, requiredNodes: generated.manifest.model.requiredNodes },
    sourceAssetHashes: sourceHashes,
  };
  const manifestBytes = bytes(canonicalJson(manifestDocument));
  const baseArtifactValues = [
    ["source-front", "source", null, sourceFrontBytes],
    ["source-side", "source", null, sourceSideBytes],
    ["measurement", "measurement-sheet", null, measurementBytes],
    ["visual", "visual-capture", null, bytes("visual fidelity comparison")],
    ["actual-wear", "actual-wear-capture", null, bytes("consented actual wear comparison")],
    ["rights", "rights-record", null, bytes("internal review rights clearance")],
    ["model", "model", null, modelBytes],
    ["manifest", "manifest", null, manifestBytes],
  ];
  const baseArtifacts = await Promise.all(baseArtifactValues.map(async ([artifactId, kind, sourceRole, value]) => ({ artifactId, kind, sourceRole, bytes: value, sha256: await digest(value), byteLength: value.byteLength })));
  const baseById = new Map(baseArtifacts.map((artifact) => [artifact.artifactId, artifact]));
  const requirements = {
    physical: { evidenceSha256: measurementHash, sourceAssetSha256: sourceHash, measurementSetSha256: measurementHash },
    visualFidelity: { evidenceSha256: baseById.get("visual").sha256, sourceAssetSha256: sourceHash, measurementSetSha256: measurementHash },
    actualWear: { evidenceSha256: baseById.get("actual-wear").sha256, sourceAssetSha256: sourceHash, measurementSetSha256: measurementHash },
    rights: { evidenceSha256: baseById.get("rights").sha256, sourceAssetSha256: sourceHash, measurementSetSha256: measurementHash },
  };
  const generator = { id: "standard-generator", version: "1.0.0", configSha256: "d".repeat(64) };
  const jobRequest = { schemaVersion: 1, tenantId: identity.tenantId, frameModelId: identity.frameModelId, method: "standard-auto", generator, sourceAssetSha256s: sourceHashes, measurementSetSha256: measurementHash, generatorInputSha256: "c".repeat(64), maxAttempts: 2, createdAt: "2026-08-11T01:00:00Z" };
  const queued = await createQueuedGenerationJobEvent(jobRequest);
  let jobState = await replayGenerationJobLedger([queued], { evaluatedAt: AT });
  const claimed = await appendGenerationJobEvent(jobState, "claimed", "2026-08-11T01:00:01Z", { workerId: "worker-1", claimToken: "claim-1", leaseExpiresAt: "2026-08-11T01:05:00Z" });
  jobState = await replayGenerationJobLedger([queued, claimed], { evaluatedAt: AT });
  const output = { manifestSha256: baseById.get("manifest").sha256, modelSha256: modelHash, manifestByteLength: manifestBytes.byteLength, modelByteLength: modelBytes.byteLength };
  const recorded = await appendGenerationJobEvent(jobState, "output-recorded", "2026-08-11T01:00:02Z", { workerId: "worker-1", claimToken: "claim-1", output });
  const jobEvents = [queued, claimed, recorded];
  const candidateBinding = { id: "candidate-standard-v1", frameVariantId: identity.frameVariantId, version: 1, quality: "standard", generationMethod: "standard-auto", modelUrl, manifestUrl: "./manifest.json", attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], qualityEnvelope: { maxYawDeg: 20, maxPitchDeg: 20, scaleConfidence: "high" } };
  const qaDecision = await createNonProxyQaDecision({ jobEvents, candidate: candidateBinding, requirements, evaluatedAt: DECISION_AT, reviewerId: "reviewer-1", decision: "accept-evidence-candidate", issueCategories: [], notes: "Synthetic evidence-package fixture.", reviewedAt: "2026-08-11T01:00:03Z" });
  const review = await reviewNonProxyGenerationOutput({ jobEvents, decisions: [qaDecision], evaluatedAt: DECISION_AT });
  assert.equal(review.outcome, "draft-derived");
  const candidate = review.candidate;
  const ledgerBytes = bytes(canonicalJson(jobEvents));
  const decisionBytes = bytes(canonicalJson(qaDecision));
  const provenanceValues = [["generation-ledger", "generation-ledger", null, ledgerBytes], ["qa-decision", "qa-decision", null, decisionBytes]];
  const provenanceArtifacts = await Promise.all(provenanceValues.map(async ([artifactId, kind, sourceRole, value]) => ({ artifactId, kind, sourceRole, bytes: value, sha256: await digest(value), byteLength: value.byteLength })));
  const artifacts = [...baseArtifacts, ...provenanceArtifacts];
  const byId = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const candidateSha256 = await formalizationCandidateSha256(candidate);
  const common = {
    schemaVersion: 1,
    algorithm: "ES256",
    tenantId: candidate.tenantId,
    frameModelId: candidate.frameModelId,
    frameVariantId: candidate.frameVariantId,
    jobId: candidate.generation.jobId,
    canonicalInputSha256: candidate.generation.canonicalInputSha256,
    reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256,
    generatorInputSha256: candidate.generation.generatorInputSha256,
    measurementSetSha256: measurementHash,
    sourceAssetSha256s: candidate.sourceAssetHashes,
    output: {
      manifestSha256: candidate.manifestSha256,
      modelSha256: candidate.modelSha256,
      manifestByteLength: candidate.manifestByteLength,
      modelByteLength: candidate.modelByteLength,
    },
    candidateSha256,
    issuedAt: "2026-08-11T02:00:00Z",
    expiresAt: "2026-08-11T04:00:00Z",
  };
  const source = byId.get("source-front");
  const sources = [source, byId.get("source-side")];
  const provenance = [byId.get("generation-ledger"), byId.get("qa-decision")];
  const dimensions = FORMALIZATION_PHYSICAL_FIELDS.map((field, index) => ({ field, valueMm: dimensionValues[index], method: "caliper", sourceArtifactId: source.artifactId }));
  const scopeData = {
    "physical-measurement": {
      artifacts: [...sources, ...provenance, byId.get("measurement")].map(descriptor).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
      claim: { kind: "physical", measurementArtifactId: "measurement", measurements: dimensions },
      subjectId: null, consentId: null, retentionUntil: null, rightsScope: null,
    },
    "visual-fidelity": {
      artifacts: [...sources, ...provenance, byId.get("visual"), byId.get("model"), byId.get("manifest")].map(descriptor).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
      claim: { kind: "visual", visualArtifactId: "visual" },
      subjectId: null, consentId: null, retentionUntil: null, rightsScope: null,
    },
    "actual-wear-consent": {
      artifacts: [...sources, ...provenance, byId.get("actual-wear")].map(descriptor).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
      claim: { kind: "actual-wear", actualWearArtifactId: "actual-wear" },
      subjectId: "subject-1", consentId: "consent-1", retentionUntil: "2026-08-12T03:00:00Z", rightsScope: null,
    },
    "rights-clearance": {
      artifacts: [...sources, ...provenance, byId.get("rights")].map(descriptor).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
      claim: { kind: "rights", rightsArtifactId: "rights" },
      subjectId: null, consentId: null, retentionUntil: null, rightsScope: "internal-review-only",
    },
  };
  const keyPairs = new Map(await Promise.all(FORMALIZATION_SCOPES.map(async (scope) => [scope, await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])])));
  async function sign(unsigned) {
    const keyPair = keyPairs.get(unsigned.scope);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, bytes(canonicalJson(unsigned))));
    return { ...unsigned, signatureBase64: Buffer.from(signature).toString("base64") };
  }
  const attestations = await Promise.all(FORMALIZATION_SCOPES.map((scope) => sign({ ...common, authorityId: `authority-${scope}`, keyId: `key-${scope}`, scope, ...scopeData[scope] })));
  const trustedKeys = {};
  for (const scope of FORMALIZATION_SCOPES) {
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPairs.get(scope).publicKey);
    trustedKeys[`key-${scope}`] = { authorityId: `authority-${scope}`, tenantId: candidate.tenantId, scopes: [scope], publicJwk: { ...publicJwk, use: "sig", alg: "ES256" } };
  }
  const trust = {
    trustedKeys,
    maximumAttestationLifetimeMs: 24 * 60 * 60 * 1000,
  };
  async function resignAll(input) {
    input.candidateSha256 = await formalizationCandidateSha256(input.candidate);
    for (const attestation of input.attestations) {
      const { signatureBase64: _ignored, ...unsigned } = attestation;
      unsigned.candidateSha256 = input.candidateSha256;
      Object.assign(attestation, await sign(unsigned));
    }
  }
  async function resignScope(input, scope) {
    const attestation = input.attestations.find((candidate) => candidate.scope === scope);
    const { signatureBase64: _ignored, ...unsigned } = attestation;
    Object.assign(attestation, await sign(unsigned));
  }
  return { candidate, artifacts, attestations, evaluatedAt: AT, trust, resignAll, resignScope, manifestDocument, modelBytes };
}

const requestOf = (input) => ({ candidate: input.candidate, artifacts: input.artifacts, attestations: input.attestations });
const contextOf = (input) => ({ evaluatedAt: input.evaluatedAt, trust: input.trust });
const evaluate = (input) => evaluateNonProxyFormalizationReadiness(requestOf(input), contextOf(input));

test("fully verified synthetic package reaches only authorized-human-review eligibility", async () => {
  const input = await setup();
  const result = await evaluate(input);
  assert.deepEqual(result, {
    readiness: "evidence-package-verified-for-authorized-human-review-input",
    candidateSha256: await formalizationCandidateSha256(input.candidate),
    attestedScopes: [...FORMALIZATION_SCOPES],
    artifactDigestIntegrityVerified: true,
    structuredModelAndMeasurementValidated: true,
    signaturesVerified: true,
    evaluatedAt: AT,
    validUntil: "2026-08-11T04:00:00.000Z",
    attestationPayloadSha256s: result.attestationPayloadSha256s,
    authority: authority(),
  });
  assert.equal("candidate" in result, false);
  assert.equal(Object.values(result.authority).every((value) => value === false), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.attestedScopes), true);
  assert.equal(Object.isFrozen(result.attestationPayloadSha256s), true);
  assert.equal(Object.isFrozen(result.authority), true);
});

test("the complete JSC-0211 candidate boundary is strict and cannot be bypassed or promoted", async () => {
  for (const mutate of [
    (input) => { input.candidate.authority = { ...input.candidate.authority, qaApproved: true }; },
    (input) => { input.candidate.promotable = true; },
    (input) => { input.candidate.admission = "public-live"; },
    (input) => { input.candidate.quality = "proxy"; },
    (input) => { input.candidate.generationMethod = "external"; },
    (input) => { input.candidate.status = "review"; },
    (input) => { input.candidate.qualityEnvelope.recommendedForLive = true; },
    (input) => { input.candidate.requirements.rights.measurementSetSha256 = "f".repeat(64); },
    (input) => { input.candidate.requirements.rights.evidenceSha256 = input.candidate.requirements.physical.evidenceSha256; },
    (input) => { input.candidate.extra = true; },
  ]) {
    const input = await setup(); mutate(input);
    await assert.rejects(evaluate(input));
  }
});

test("actual bytes, exact source inventory, output identity, and evidence digests fail closed", async () => {
  const changed = await setup(); changed.artifacts[0].bytes[0] ^= 1;
  await assert.rejects(evaluate(changed), /actual bytes/);

  const length = await setup(); length.artifacts[0].byteLength += 1;
  await assert.rejects(evaluate(length), /byteLength/);

  const duplicate = await setup(); duplicate.artifacts[1].sha256 = duplicate.artifacts[0].sha256;
  await assert.rejects(evaluate(duplicate), /relabelled/);

  const source = await setup(); source.candidate.sourceAssetHashes = ["f".repeat(64)];
  await assert.rejects(evaluate(source), /source set|candidateSha256/);

  const output = await setup(); output.candidate.modelSha256 = "f".repeat(64);
  await assert.rejects(evaluate(output), /output|candidateSha256/);

  const evidence = await setup(); evidence.candidate.requirements.visualFidelity.evidenceSha256 = "f".repeat(64);
  await assert.rejects(evaluate(evidence), /candidateSha256|evidence digest|exactly replay/);

  const role = await setup(); role.artifacts[0].sourceRole = "marking";
  await assert.rejects(evaluate(role), /do not assert unverified source roles/);
});

test("scope claims require all six measurements, appropriate methods, and exact evidence artifacts", async () => {
  const missing = await setup(); missing.attestations[0].claim.measurements.pop();
  await assert.rejects(evaluate(missing), /six measurements/);

  const reordered = await setup(); reordered.attestations[0].claim.measurements.reverse();
  await assert.rejects(evaluate(reordered), /canonical six-field order/);

  const marking = await setup(); marking.attestations[0].claim.measurements[0].method = "marking";
  await assert.rejects(evaluate(marking), /separate marking-inspection/);

  const frameWidth = await setup(); frameWidth.attestations[0].claim.measurements[3].method = "marking";
  await assert.rejects(evaluate(frameWidth), /requires verified caliper/);

  const otherSource = await setup(); otherSource.attestations[0].claim.measurements[0].sourceArtifactId = "source-side";
  await assert.rejects(evaluate(otherSource), /physical requirement source/);

  const rights = await setup(); rights.attestations[3].rightsScope = "publication";
  await assert.rejects(evaluate(rights), /internal-review-only/);

  const wear = await setup(); wear.attestations[2].retentionUntil = "2026-08-11T03:00:00Z";
  await assert.rejects(evaluate(wear), /expired/);
});

test("ES256 authority, allowed scope, signature, time, and signed descriptors are enforced", async () => {
  const signature = await setup(); signature.attestations[0].signatureBase64 = Buffer.alloc(64, 7).toString("base64");
  await assert.rejects(evaluate(signature), /signature verification/);

  const authority = await setup(); authority.trust.trustedKeys["key-physical-measurement"].authorityId = "other-authority";
  await assert.rejects(evaluate(authority), /not trusted/);

  const scope = await setup(); scope.trust.trustedKeys["key-physical-measurement"].scopes = ["rights-clearance"];
  await assert.rejects(evaluate(scope), /not trusted/);

  const stale = await setup(); stale.evaluatedAt = "2026-08-11T04:00:00Z";
  await assert.rejects(evaluate(stale), /time window/);

  const descriptors = await setup(); descriptors.attestations[1].artifacts[0].byteLength += 1;
  await assert.rejects(evaluate(descriptors), /descriptors/);

  const privateKey = await setup(); privateKey.trust.trustedKeys["key-physical-measurement"].publicJwk.d = "secret";
  await assert.rejects(evaluate(privateKey), /not allowed|public P-256/);

  const wrongUse = await setup(); wrongUse.trust.trustedKeys["key-physical-measurement"].publicJwk.use = "enc";
  await assert.rejects(evaluate(wrongUse), /ES256 public P-256/);

  const sameKey = await setup(); sameKey.trust.trustedKeys["key-visual-fidelity"].publicJwk = structuredClone(sameKey.trust.trustedKeys["key-physical-measurement"].publicJwk);
  await assert.rejects(evaluate(sameKey), /independent public keys/);
});

test("hostile accessors fail before snapshot and post-call mutation cannot relabel a result", async () => {
  let invoked = false;
  const hostile = Object.defineProperty({}, "candidate", { enumerable: true, get() { invoked = true; return {}; } });
  await assert.rejects(evaluateNonProxyFormalizationReadiness(hostile, {}), /enumerable data properties/);
  assert.equal(invoked, false);

  const input = await setup();
  const expected = await formalizationCandidateSha256(input.candidate);
  const pending = evaluate(input);
  input.candidate.tenantId = "mutated-tenant";
  input.artifacts[0].bytes[0] ^= 1;
  input.attestations[0].authorityId = "mutated-authority";
  const result = await pending;
  assert.equal(result.candidateSha256, expected);
});

test("parallel evaluations are deterministic and grant no downstream authority", async () => {
  const input = await setup();
  const [first, second] = await Promise.all([
    evaluate(input),
    evaluate(input),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.authority, authority());
});

test("trust root and clock are host-only inputs and self-selected trust is rejected", async () => {
  const input = await setup();
  await assert.rejects(evaluateNonProxyFormalizationReadiness({ ...requestOf(input), trust: input.trust }, contextOf(input)), /request.trust is not allowed/);
  await assert.rejects(evaluateNonProxyFormalizationReadiness({ ...requestOf(input), evaluatedAt: input.evaluatedAt }, contextOf(input)), /request.evaluatedAt is not allowed/);
  await assert.rejects(evaluateNonProxyFormalizationReadiness(requestOf(input)), /verification context/);
  await assert.rejects(evaluateNonProxyFormalizationReadiness(requestOf(input), { ...contextOf(input), evaluatedAt: "2026-02-31T00:00:00Z" }), /real canonical UTC/);

  const attacker = await setup();
  const host = await setup();
  await assert.rejects(evaluateNonProxyFormalizationReadiness(requestOf(attacker), contextOf(host)), /not trusted|signature verification/);
});

test("verified measurement bytes, signed claim values, and host tenant must agree", async () => {
  const valueDrift = await setup();
  valueDrift.attestations[0].claim.measurements[0].valueMm = 99;
  await valueDrift.resignScope(valueDrift, "physical-measurement");
  await assert.rejects(evaluate(valueDrift), /exactly match the verified measurement document/);

  const tenant = await setup();
  tenant.trust.trustedKeys["key-physical-measurement"].tenantId = "tenant-2";
  await assert.rejects(evaluate(tenant), /not trusted for this tenant/);
});

test("host context is snapshotted before async verification", async () => {
  const input = await setup();
  const request = requestOf(input);
  const context = contextOf(input);
  const pending = evaluateNonProxyFormalizationReadiness(request, context);
  context.evaluatedAt = "2026-08-11T05:00:00Z";
  context.trust.maximumAttestationLifetimeMs = 1;
  context.trust.trustedKeys["key-physical-measurement"].tenantId = "tenant-mutated";
  const result = await pending;
  assert.equal(result.evaluatedAt, AT);
});

test("non-Proxy provenance rejects calibration markers and proxy manifest extensions", async () => {
  const input = await setup();
  assert.doesNotThrow(() => validateNonProxyAssetProvenance(input.manifestDocument, readGlb(input.modelBytes).json, input.candidate));
  assert.throws(() => validateNonProxyAssetProvenance({ ...input.manifestDocument, proxyGeneration: {} }, readGlb(input.modelBytes).json, input.candidate), /proxyGeneration/);
  const proxy = await validModelFixture();
  const proxyJson = structuredClone(readGlb(proxy.proxyGlb).json);
  proxyJson.asset.generator = `${input.candidate.generation.generator.id}@${input.candidate.generation.generator.version}`;
  assert.throws(() => validateNonProxyAssetProvenance(input.manifestDocument, proxyJson, input.candidate), /Proxy|fixture|marker/);
});
