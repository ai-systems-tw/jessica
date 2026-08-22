import assert from "node:assert/strict";
import test from "node:test";

import {
  NON_PROXY_HUMAN_QA_SCOPE,
  canonicalJson,
  nonProxyHumanQaDecisionPayload,
  nonProxyHumanQaPublicJwkFingerprintSha256,
} from "../dist/packages/contracts/src/index.js";
import { evaluateCaliperMeasurementProvenance, evaluateNonProxyHumanQaDecision } from "../dist/packages/asset-review/src/index.js";
import { setup as setupCaliper } from "./caliper-measurement-provenance.fixture.mjs";
import { setup } from "./non-proxy-human-qa-decision.fixture.mjs";

const REVIEWED_AT = "2026-08-11T02:30:00Z";
const ISSUED_AT = "2026-08-11T02:40:00Z";
const EXPIRES_AT = "2026-08-11T03:30:00Z";
const bytes = (value) => new TextEncoder().encode(value);

async function sign(unsigned, privateKey) {
  const signatureBase64 = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes(canonicalJson(unsigned)))).toString("base64");
  return { ...structuredClone(unsigned), signatureBase64 };
}

test("authenticated approve derives only an immutable approved non-Proxy review projection", async () => {
  const input = await setup(); const result = await evaluateNonProxyHumanQaDecision(input.request, input.context); const projection = result.approvedReviewProjection;
  assert.equal(result.decision, "approve"); assert.equal(result.authority.qaApproved, true); assert.ok(projection); assert.equal(projection.projectionType, "approved-non-proxy-review-projection");
  assert.equal(result.reviewReadyAt, "2026-08-11T02:00:00.000Z");
  for (const key of ["id", "tenantId", "frameModelId", "frameVariantId", "version", "quality", "generationMethod", "modelUrl", "modelSha256", "modelByteLength", "manifestUrl", "manifestSha256", "manifestByteLength", "sourceAssetHashes", "generation", "attachmentMatrix", "requirements"]) assert.deepEqual(projection[key], input.candidate[key]);
  assert.equal(projection.qualityEnvelope.recommendedForLive, false); assert.equal(projection.rightsScope, "internal-review-only"); assert.equal(projection.promotable, false);
  for (const denied of ["assetVersionCreated", "assetVersionPromoted", "recommendedForLive", "activeDeployment", "publication", "gates"]) { assert.equal(result.authority[denied], false); assert.equal(projection.authority[denied], false); }
  for (const forbidden of ["assetVersion", "status", "publication", "deployment", "rawEvidence", "specimenId"]) assert.equal(forbidden in projection, false);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.authority), true); assert.equal(Object.isFrozen(projection), true); assert.equal(Object.isFrozen(projection.generation), true); assert.equal(Object.isFrozen(projection.sourceAssetHashes), true);
});

test("authenticated reject is terminal but derives neither QA approval nor an approved projection", async () => {
  const input = await setup("reject"); const result = await evaluateNonProxyHumanQaDecision(input.request, input.context);
  assert.equal(result.decision, "reject"); assert.equal(result.approvedReviewProjection, null); assert.deepEqual(result.authority, { qaApproved: false, assetVersionCreated: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false, publication: false, gates: false });
});

test("caller cached readiness, clocks, trust, projections, AssetVersions, and unknown fields are rejected", async () => {
  for (const [key, value] of [["caliperResult", {}], ["formalizationReadiness", {}], ["markingResult", {}], ["qaApproved", true], ["approvedReviewProjection", {}], ["assetVersion", {}], ["evaluatedAt", "2026-08-11T03:00:00Z"], ["trust", {}]]) {
    const input = await setup(); input.request[key] = value; await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), /not allowed/);
  }
});

test("every candidate, lineage, output, tenant, source, MeasurementSet, specimen, composed digest and horizon substitution fails after a valid signature", async () => {
  const mutations = [
    (value) => { value.tenantId = "other-tenant"; }, (value) => { value.frameModelId = "other-model"; }, (value) => { value.frameVariantId = "other-variant"; },
    (value) => { value.candidateId = "other-candidate"; }, (value) => { value.candidateVersion += 1; }, (value) => { value.jobId = "other-job"; },
    (value) => { value.canonicalInputSha256 = "9".repeat(64); }, (value) => { value.reviewHeadEventSha256 = "9".repeat(64); }, (value) => { value.generatorInputSha256 = "9".repeat(64); },
    (value) => { value.output.modelSha256 = "9".repeat(64); }, (value) => { value.output.manifestByteLength += 1; },
    (value) => { value.sourceAssetSha256s = value.sourceAssetSha256s.slice(1); }, (value) => { value.measurementSetSha256 = "9".repeat(64); }, (value) => { value.specimenId = "other-specimen"; },
  ];
  for (const key of ["candidateSha256", "formalizationStableSha256", "markingProvenanceStableSha256", "caliperProvenanceStableSha256", "measurementSetSha256", "calibrationRecordSha256", "calibrationPayloadSha256", "calibrationAttestationPayloadSha256", "measurementSessionSha256", "measurementSessionPayloadSha256", "measurementAttestationPayloadSha256", "captureProvenancePayloadSha256"]) mutations.push((value) => { value.composition[key] = "9".repeat(64); });
  mutations.push((value) => { value.composition.inputValidUntil = "2026-08-11T03:59:59Z"; });
  for (const mutate of mutations) { const input = await setup(); await input.resign(mutate); await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), /substitute|composed result|host-trusted/); }
});

test("approve envelope may narrow yaw, pitch, and confidence only; proxy and publication relabels fail closed", async () => {
  const narrow = await setup(); await narrow.resign((value) => { value.approvedQualityEnvelope.maxYawDeg = 0; value.approvedQualityEnvelope.maxPitchDeg = 0; value.approvedQualityEnvelope.scaleConfidence = "high"; });
  const accepted = await evaluateNonProxyHumanQaDecision(narrow.request, narrow.context); assert.equal(accepted.approvedReviewProjection.qualityEnvelope.maxYawDeg, 0);
  for (const mutate of [(value) => { value.approvedQualityEnvelope.maxYawDeg += 1; }, (value) => { value.approvedQualityEnvelope.maxPitchDeg += 1; }, (value) => { value.approvedQualityEnvelope.scaleConfidence = "medium"; }, (value) => { value.approvedQualityEnvelope.scaleConfidence = "low"; }, (value) => { value.approvedQualityEnvelope.recommendedForLive = true; }]) { const input = await setup(); await input.resign(mutate); await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), /narrower|live readiness/); }
  const proxy = await setup(); proxy.request.caliperProvenanceRequest.formalizationRequest.candidate.quality = "proxy"; await assert.rejects(evaluateNonProxyHumanQaDecision(proxy.request, proxy.context), /standard or premium/);
  const rights = await setup(); await rights.resign((value) => { value.rightsScope = "publication"; }); await assert.rejects(evaluateNonProxyHumanQaDecision(rights.request, rights.context), /rights scope/);
});

test("reviewer authority, key and exact JWK fingerprint are tenant-scoped and independent from every upstream trust root", async () => {
  const tenant = await setup(); tenant.context.reviewerTrust.trustedKeys[tenant.unsigned.keyId].tenantId = "other-tenant"; await assert.rejects(evaluateNonProxyHumanQaDecision(tenant.request, tenant.context), /host-trusted/);
  const attribution = await setup(); await attribution.resign((value) => { value.reviewerId = "different-human-reviewer"; }); await assert.rejects(evaluateNonProxyHumanQaDecision(attribution.request, attribution.context), /reviewer attribution/);
  const authority = await setup(); const upstreamAuthority = Object.values(authority.context.caliperProvenanceContext.formalizationTrust.trustedKeys)[0].authorityId; await authority.resign((value) => { value.authorityId = upstreamAuthority; }); authority.context.reviewerTrust.trustedKeys[authority.unsigned.keyId].authorityId = upstreamAuthority; await assert.rejects(evaluateNonProxyHumanQaDecision(authority.request, authority.context), /independent/);
  const keyAlias = await setup(); const upstreamKeyId = Object.keys(keyAlias.context.caliperProvenanceContext.markingProvenanceTrust.trustedKeys)[0]; const record = keyAlias.context.reviewerTrust.trustedKeys[keyAlias.unsigned.keyId]; delete keyAlias.context.reviewerTrust.trustedKeys[keyAlias.unsigned.keyId]; keyAlias.context.reviewerTrust.trustedKeys[upstreamKeyId] = record; await keyAlias.resign((value) => { value.keyId = upstreamKeyId; }); await assert.rejects(evaluateNonProxyHumanQaDecision(keyAlias.request, keyAlias.context), /independent/);
});

test("reviewer JWK aliases fail against every formalization, marking, calibration, and measurement trust family", async () => {
  const cases = [
    ...["physical-measurement", "visual-fidelity", "actual-wear-consent", "rights-clearance"].map((scope) => ({ trust: "formalizationTrust", keyId: `key-${scope}`, pair: (input) => input.upstream.formal.keyPairs.get(scope) })),
    { trust: "markingProvenanceTrust", keyId: "key-reported-caliper-fixture", pair: (input) => input.upstream.reportKey },
    { trust: "markingProvenanceTrust", keyId: "key-capture-caliper-fixture", pair: (input) => input.upstream.captureKey },
    { trust: "markingProvenanceTrust", keyId: "key-inspection-caliper-fixture", pair: (input) => input.upstream.inspectionKey },
    { trust: "caliperTrust", keyId: "key-calibration", pair: (input) => input.upstream.calibrationKey },
    { trust: "caliperTrust", keyId: "key-physical-measurement", pair: (input) => input.upstream.measurementKey },
  ];
  for (const item of cases) {
    const input = await setup(); const upstreamJwk = input.context.caliperProvenanceContext[item.trust].trustedKeys[item.keyId].publicJwk; const fingerprint = await nonProxyHumanQaPublicJwkFingerprintSha256(upstreamJwk); const reviewerRecord = input.context.reviewerTrust.trustedKeys[input.unsigned.keyId]; reviewerRecord.publicJwk = structuredClone(upstreamJwk); reviewerRecord.publicKeyFingerprintSha256 = fingerprint;
    const next = nonProxyHumanQaDecisionPayload(input.request.decisionAttestation); next.publicKeyFingerprintSha256 = fingerprint; input.request.decisionAttestation = await sign(next, item.pair(input).privateKey);
    await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), /JWK aliases|independent/);
  }
});

test("stale, future, expired, overlong, noncanonical and post-horizon decisions fail closed", async () => {
  const cases = [
    [(value) => { value.reviewedAt = "2026-08-11T03:00:01Z"; value.issuedAt = "2026-08-11T03:00:01Z"; }, /future|outside/],
    [(value) => { value.expiresAt = "2026-08-11T03:00:00Z"; }, /expired|outside/],
    [(value) => { value.expiresAt = "2026-08-11T04:00:01Z"; }, /outside/],
    [(value) => { value.reviewedAt = "2026-08-11T01:00:00Z"; value.issuedAt = "2026-08-11T01:00:01Z"; }, /review-ready/],
    [(value) => { value.reviewedAt = "2026-08-11T02:30:00+00:00"; }, /RFC 3339 UTC/],
  ];
  for (const [mutate, pattern] of cases) { const input = await setup(); await input.resign(mutate); if (String(pattern).includes("stale")) input.context.reviewerTrust.maximumReviewAgeMs = 1; await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), pattern); }
  const overlong = await setup(); overlong.context.reviewerTrust.maximumAttestationLifetimeMs = 1; await assert.rejects(evaluateNonProxyHumanQaDecision(overlong.request, overlong.context), /stale|outside/);
});

test("reviewReadyAt is derived internally and review cannot predate JSC-0212, JSC-0213, or JSC-0214 prerequisite evidence", async () => {
  for (const reviewedAt of ["2026-08-11T01:59:59Z", "2026-08-11T01:24:59Z", "2026-08-11T01:34:59Z"]) {
    const input = await setup(); await input.resign((value) => { value.reviewedAt = reviewedAt; value.issuedAt = "2026-08-11T02:00:01Z"; }); await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), /internally recomputed prerequisite evidence review-ready/);
  }
  const caller = await setup(); caller.request.reviewReadyAt = "2026-08-11T00:00:00Z"; await assert.rejects(evaluateNonProxyHumanQaDecision(caller.request, caller.context), /not allowed/);
});

test("closed approve/reject issue semantics, canonical signature bytes, and signed payload bytes fail closed", async () => {
  const approveIssues = await setup(); await approveIssues.resign((value) => { value.issueCategories = ["geometry"]; }); await assert.rejects(evaluateNonProxyHumanQaDecision(approveIssues.request, approveIssues.context), /approve requires no issues/);
  const rejectNoIssues = await setup("reject"); await rejectNoIssues.resign((value) => { value.issueCategories = []; }); await assert.rejects(evaluateNonProxyHumanQaDecision(rejectNoIssues.request, rejectNoIssues.context), /reject requires at least one issue/);
  const duplicate = await setup("reject"); await duplicate.resign((value) => { value.issueCategories = ["rights", "rights"]; }); await assert.rejects(evaluateNonProxyHumanQaDecision(duplicate.request, duplicate.context), /unique and sorted/);
  const tampered = await setup(); tampered.request.decisionAttestation.notes = "Tampered after signing."; await assert.rejects(evaluateNonProxyHumanQaDecision(tampered.request, tampered.context), /signature verification/);
  const signature = await setup(); signature.request.decisionAttestation.signatureBase64 += "="; await assert.rejects(evaluateNonProxyHumanQaDecision(signature.request, signature.context), /canonical raw ES256/);
});

test("hostile objects are rejected without getter invocation and post-call mutation cannot win TOCTOU", async () => {
  const hostile = await setup(); let invoked = false; hostile.request.decisionAttestation = Object.defineProperty({}, "schemaVersion", { enumerable: true, get() { invoked = true; return 1; } }); await assert.rejects(evaluateNonProxyHumanQaDecision(hostile.request, hostile.context), /enumerable data properties/); assert.equal(invoked, false);
  const prototype = await setup(); prototype.context.reviewerTrust = Object.assign(Object.create({ inherited: true }), prototype.context.reviewerTrust); await assert.rejects(evaluateNonProxyHumanQaDecision(prototype.request, prototype.context), /plain object/);
  const cyclic = await setup(); cyclic.request.decisionAttestation.notes = cyclic.request.decisionAttestation; await assert.rejects(evaluateNonProxyHumanQaDecision(cyclic.request, cyclic.context), /cyclic/);
  const mutation = await setup(); const pending = evaluateNonProxyHumanQaDecision(mutation.request, mutation.context); mutation.request.decisionAttestation.decision = "reject"; mutation.request.caliperProvenanceRequest.measurementSessionArtifact.bytes.fill(0); mutation.context.reviewerTrust.trustedKeys = {}; const result = await pending; assert.equal(result.decision, "approve"); assert.equal(result.authority.qaApproved, true);
});

test("snapshot accepts benign repeated aliases while still rejecting true recursion cycles", async () => {
  const shared = await setup(); const composed = shared.request.caliperProvenanceRequest; assert.equal(composed.formalizationRequest.candidate, composed.markingProvenanceRequest.candidate); const result = await evaluateNonProxyHumanQaDecision(shared.request, shared.context); assert.equal(result.decision, "approve");
  const cyclic = await setup(); cyclic.request.decisionAttestation.notes = cyclic.request.decisionAttestation; await assert.rejects(evaluateNonProxyHumanQaDecision(cyclic.request, cyclic.context), /cyclic/);
});

test("one durable signed decision re-verifies at later honest host clocks with stable identity and expiry", async () => {
  const input = await setup(); const atThree = await evaluateNonProxyHumanQaDecision(input.request, input.context);
  const laterContext = structuredClone(input.context); laterContext.caliperProvenanceContext.evaluatedAt = "2026-08-11T03:01:00Z";
  const atThreeOhOne = await evaluateNonProxyHumanQaDecision(input.request, laterContext);
  assert.equal(atThree.decisionPayloadSha256, atThreeOhOne.decisionPayloadSha256); assert.equal(atThree.caliperProvenanceStableSha256, atThreeOhOne.caliperProvenanceStableSha256);
  assert.equal(atThree.evaluatedAt, "2026-08-11T03:00:00Z"); assert.equal(atThreeOhOne.evaluatedAt, "2026-08-11T03:01:00Z"); assert.equal(atThree.validUntil, "2026-08-11T03:30:00.000Z"); assert.equal(atThreeOhOne.validUntil, atThree.validUntil);
});

test("snapshot budgets genuine typed-array backing length without invoking hostile byteLength shadows", async () => {
  const getter = await setup(); let invoked = false; const getterBytes = getter.request.caliperProvenanceRequest.measurementSessionArtifact.bytes; Object.defineProperty(getterBytes, "byteLength", { configurable: true, get() { invoked = true; return 0; } });
  const getterResult = await evaluateNonProxyHumanQaDecision(getter.request, getter.context); assert.equal(getterResult.decision, "approve"); assert.equal(invoked, false);
  const data = await setup(); const dataBytes = data.request.caliperProvenanceRequest.measurementSessionArtifact.bytes; Object.defineProperty(dataBytes, "byteLength", { configurable: true, value: 0 });
  const dataResult = await evaluateNonProxyHumanQaDecision(data.request, data.context); assert.equal(dataResult.decision, "approve");
  const proxy = await setup(); proxy.request.caliperProvenanceRequest.measurementSessionArtifact.bytes = new Proxy(proxy.request.caliperProvenanceRequest.measurementSessionArtifact.bytes, {}); await assert.rejects(evaluateNonProxyHumanQaDecision(proxy.request, proxy.context), /genuine Uint8Array/);
});

test("effective validity includes the exclusive host maximum review-age boundary", async () => {
  const input = await setup(); input.context.reviewerTrust.maximumReviewAgeMs = 31 * 60 * 1000;
  const beforeContext = structuredClone(input.context); beforeContext.caliperProvenanceContext.evaluatedAt = "2026-08-11T03:00:59.999Z"; const before = await evaluateNonProxyHumanQaDecision(input.request, beforeContext); assert.equal(before.validUntil, "2026-08-11T03:01:00.000Z");
  const exactContext = structuredClone(input.context); exactContext.caliperProvenanceContext.evaluatedAt = "2026-08-11T03:01:00Z"; await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, exactContext), /stale/);
  const afterContext = structuredClone(input.context); afterContext.caliperProvenanceContext.evaluatedAt = "2026-08-11T03:01:01Z"; await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, afterContext), /stale/);
});

test("old human decision rejects validly re-signed caliper attestations with unchanged record and session bytes", async () => {
  for (const [field, pairName, issuedAt] of [["calibrationAttestation", "calibrationKey", "2026-08-11T01:06:00Z"], ["measurementAttestation", "measurementKey", "2026-08-11T01:36:00Z"]]) {
    const input = await setup(); const beforeRecord = structuredClone(input.request.caliperProvenanceRequest.calibrationRecordArtifact); const beforeSession = structuredClone(input.request.caliperProvenanceRequest.measurementSessionArtifact); const { signatureBase64: _ignored, ...unsigned } = input.request.caliperProvenanceRequest[field]; unsigned.issuedAt = issuedAt; input.request.caliperProvenanceRequest[field] = await sign(unsigned, input.upstream[pairName].privateKey);
    assert.deepEqual(input.request.caliperProvenanceRequest.calibrationRecordArtifact, beforeRecord); assert.deepEqual(input.request.caliperProvenanceRequest.measurementSessionArtifact, beforeSession);
    await assert.rejects(evaluateNonProxyHumanQaDecision(input.request, input.context), /composed result, payload digest/);
  }
});
