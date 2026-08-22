import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

export async function setup() {
  const identity = { tenantId: "tenant-1", frameModelId: "model-1", frameVariantId: "variant-1" };
  const sourceFrontBytes = bytes("physical product front source");
  const sourceSideBytes = bytes("physical product side source");
  const sourceMarkingBytes = bytes("physical product marking surface source");
  const sourceHash = await digest(sourceFrontBytes);
  const sourceSideHash = await digest(sourceSideBytes);
  const sourceMarkingHash = await digest(sourceMarkingBytes);
  const sourceHashes = [sourceHash, sourceSideHash, sourceMarkingHash].sort();
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
  const modelUrl = "https://assets.example.test/synthetic/v1/model.glb";
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
    ["source-marking", "source", null, sourceMarkingBytes],
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
  const candidateBinding = { id: "candidate-standard-v1", frameVariantId: identity.frameVariantId, version: 1, quality: "standard", generationMethod: "standard-auto", modelUrl, manifestUrl: "https://assets.example.test/synthetic/v1/manifest.json", attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], qualityEnvelope: { maxYawDeg: 20, maxPitchDeg: 20, scaleConfidence: "high" } };
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
  const sources = [source, byId.get("source-side"), byId.get("source-marking")];
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
  return { candidate, artifacts, attestations, evaluatedAt: AT, trust, resignAll, resignScope, manifestDocument, modelBytes, keyPairs, sign, measurementDocument, dimensionValues, byId };
}
