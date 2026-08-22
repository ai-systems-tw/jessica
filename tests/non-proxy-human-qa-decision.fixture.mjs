
import {
  NON_PROXY_HUMAN_QA_SCOPE,
  canonicalJson,
  nonProxyHumanQaDecisionPayload,
  nonProxyHumanQaPublicJwkFingerprintSha256,
} from "../dist/packages/contracts/src/index.js";
import { evaluateCaliperMeasurementProvenance, evaluateNonProxyHumanQaDecision } from "../dist/packages/asset-review/src/index.js";
import { setup as setupCaliper } from "./caliper-measurement-provenance.fixture.mjs";

const REVIEWED_AT = "2026-08-11T02:30:00Z";
const ISSUED_AT = "2026-08-11T02:40:00Z";
const EXPIRES_AT = "2026-08-11T03:30:00Z";
const bytes = (value) => new TextEncoder().encode(value);

async function sign(unsigned, privateKey) {
  const signatureBase64 = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes(canonicalJson(unsigned)))).toString("base64");
  return { ...structuredClone(unsigned), signatureBase64 };
}
export async function setup(decision = "approve") {
  const upstream = await setupCaliper();
  const candidate = upstream.request.formalizationRequest.candidate;
  const caliper = await evaluateCaliperMeasurementProvenance(upstream.request, upstream.context);
  const { evaluatedAt: _hostEvaluationClock, ...stableCaliperResult } = caliper;
  const caliperProvenanceStableSha256 = await crypto.subtle.digest("SHA-256", bytes(canonicalJson(stableCaliperResult))).then((value) => Buffer.from(value).toString("hex"));
  const reviewerKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const reviewerJwk = { ...await crypto.subtle.exportKey("jwk", reviewerKey.publicKey), use: "sig", alg: "ES256" };
  const fingerprint = await nonProxyHumanQaPublicJwkFingerprintSha256(reviewerJwk);
  const unsigned = {
    schemaVersion: 1, type: "non-proxy-human-qa-decision-attestation", algorithm: "ES256", scope: NON_PROXY_HUMAN_QA_SCOPE,
    authorityId: "authority-terminal-human-review", keyId: "key-terminal-human-review", publicKeyFingerprintSha256: fingerprint,
    reviewerId: "reviewer-terminal-human", tenantId: candidate.tenantId, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId,
    candidateId: candidate.id, candidateVersion: candidate.version, jobId: candidate.generation.jobId,
    canonicalInputSha256: candidate.generation.canonicalInputSha256, reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256,
    generatorInputSha256: candidate.generation.generatorInputSha256,
    output: { manifestSha256: candidate.manifestSha256, modelSha256: candidate.modelSha256, manifestByteLength: candidate.manifestByteLength, modelByteLength: candidate.modelByteLength },
    sourceAssetSha256s: candidate.sourceAssetHashes, measurementSetSha256: candidate.requirements.physical.measurementSetSha256,
    specimenId: upstream.request.markingProvenanceRequest.markingInspectionAttestation.specimenId,
    composition: {
      candidateSha256: caliper.candidateSha256, formalizationStableSha256: caliper.formalizationStableSha256,
      markingProvenanceStableSha256: caliper.markingProvenanceStableSha256, caliperProvenanceStableSha256,
      measurementSetSha256: caliper.measurementSetSha256, calibrationRecordSha256: caliper.calibrationRecordSha256,
      calibrationPayloadSha256: caliper.calibrationPayloadSha256, calibrationAttestationPayloadSha256: caliper.calibrationAttestationPayloadSha256,
      measurementSessionSha256: caliper.measurementSessionSha256, measurementSessionPayloadSha256: caliper.measurementSessionPayloadSha256,
      measurementAttestationPayloadSha256: caliper.measurementAttestationPayloadSha256, captureProvenancePayloadSha256: caliper.captureProvenancePayloadSha256,
      inputValidUntil: caliper.validUntil,
    },
    rightsScope: "internal-review-only", decision,
    issueCategories: decision === "approve" ? [] : ["visual-fidelity"], notes: decision === "approve" ? null : "Terminal human rejection.",
    approvedQualityEnvelope: decision === "approve" ? { ...candidate.qualityEnvelope } : null,
    reviewedAt: REVIEWED_AT, issuedAt: ISSUED_AT, expiresAt: EXPIRES_AT,
  };
  const request = { caliperProvenanceRequest: upstream.request, decisionAttestation: await sign(unsigned, reviewerKey.privateKey) };
  const context = {
    caliperProvenanceContext: upstream.context,
    reviewerTrust: { trustedKeys: { [unsigned.keyId]: { authorityId: unsigned.authorityId, reviewerId: unsigned.reviewerId, tenantId: candidate.tenantId, scopes: [NON_PROXY_HUMAN_QA_SCOPE], publicKeyFingerprintSha256: fingerprint, publicJwk: reviewerJwk } }, maximumAttestationLifetimeMs: 2 * 60 * 60 * 1000, maximumReviewAgeMs: 2 * 60 * 60 * 1000 },
  };
  async function resign(mutator = () => {}) {
    const next = nonProxyHumanQaDecisionPayload(request.decisionAttestation); mutator(next); request.decisionAttestation = await sign(next, reviewerKey.privateKey);
  }
  return { request, context, upstream, candidate, reviewerKey, reviewerJwk, unsigned, resign };
}
