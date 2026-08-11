import {
  NON_PROXY_HUMAN_QA_SCOPE,
  canonicalJson,
  nonProxyHumanQaDecisionPayload,
  nonProxyHumanQaPublicJwkFingerprintSha256,
  parseFormalizationCandidate,
  parseNonProxyHumanQaDecisionAttestation,
  qualityEnvelopeIsEqualOrNarrower,
  sha256Hex,
  type FormalizationCandidate,
  type NonProxyHumanQaTrustConfiguration,
  type NonProxyApprovedQualityEnvelope,
} from "../../contracts/src/index.js";
import { evaluateCaliperMeasurementProvenance } from "./caliperMeasurementProvenance.js";

export type ApprovedNonProxyReviewProjection = Readonly<{
  schemaVersion: 1;
  projectionType: "approved-non-proxy-review-projection";
  id: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  version: number;
  quality: FormalizationCandidate["quality"];
  generationMethod: FormalizationCandidate["generationMethod"];
  modelUrl: string;
  modelSha256: string;
  modelByteLength: number;
  manifestUrl: string;
  manifestSha256: string;
  manifestByteLength: number;
  sourceAssetHashes: readonly string[];
  generation: FormalizationCandidate["generation"];
  attachmentMatrix: FormalizationCandidate["attachmentMatrix"];
  qualityEnvelope: NonProxyApprovedQualityEnvelope;
  requirements: FormalizationCandidate["requirements"];
  fixtureStatus: "unverified";
  reviewStatus: "approved";
  rightsScope: "internal-review-only";
  promotable: false;
  humanQaDecisionPayloadSha256: string;
  validUntil: string;
  authority: Readonly<{
    qaApproved: true;
    assetVersionCreated: false;
    assetVersionPromoted: false;
    recommendedForLive: false;
    activeDeployment: false;
    publication: false;
    gates: false;
  }>;
}>;

export type NonProxyHumanQaDecisionResult = Readonly<{
  decision: "approve" | "reject";
  decisionPayloadSha256: string;
  candidateSha256: string;
  caliperProvenanceStableSha256: string;
  reviewReadyAt: string;
  evaluatedAt: string;
  validUntil: string;
  approvedReviewProjection: ApprovedNonProxyReviewProjection | null;
  authority: Readonly<{
    qaApproved: boolean;
    assetVersionCreated: false;
    assetVersionPromoted: false;
    recommendedForLive: false;
    activeDeployment: false;
    publication: false;
    gates: false;
  }>;
}>;

const REQUEST_KEYS = ["caliperProvenanceRequest", "decisionAttestation"] as const;
const CONTEXT_KEYS = ["caliperProvenanceContext", "reviewerTrust"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;

function object(value: unknown, path: string): asserts value is Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must be a plain object`); for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { const allowed = new Set(keys); const unknown = Object.keys(value).find((key) => !allowed.has(key)); const missing = keys.find((key) => !(key in value)); if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`); if (missing) throw new TypeError(`${path}.${missing} is required`); }
function array(value: unknown, path: string, maximum: number): asserts value is unknown[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense plain array`); const descriptors = Object.getOwnPropertyDescriptors(value); for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`); } }
function id(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function hash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function base64Bytes(value: string): Uint8Array<ArrayBuffer> { const decoded = atob(value); const bytes = new Uint8Array(new ArrayBuffer(decoded.length)); for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index); return bytes; }

function snapshot(value: unknown, path: string, state = { nodes: 0, bytes: 0, active: new WeakSet<object>() }): unknown {
  state.nodes += 1; if (state.nodes > 25_000) throw new TypeError("human QA request exceeds the structural budget");
  if (value instanceof Uint8Array) { let byteLength: number; try { if (!TYPED_ARRAY_BYTE_LENGTH) throw new TypeError(); byteLength = TYPED_ARRAY_BYTE_LENGTH.call(value) as number; } catch { throw new TypeError(`${path} must be a genuine Uint8Array`); } state.bytes += byteLength; if (!Number.isSafeInteger(state.bytes) || state.bytes > 512 * 1024 * 1024) throw new TypeError("human QA request exceeds the pre-snapshot byte budget"); return new Uint8Array(value); }
  if (typeof value === "object" && value !== null) { if (state.active.has(value)) throw new TypeError(`${path} must not contain cyclic object references`); state.active.add(value); }
  if (Array.isArray(value)) { array(value, path, 512); const copy = value.map((item, index) => snapshot(item, `${path}.${index}`, state)); state.active.delete(value); return copy; }
  if (typeof value === "object" && value !== null) { object(value, path); const copy: Record<string, unknown> = {}; for (const key of Object.keys(value)) copy[key] = snapshot(value[key], `${path}.${key}`, state); state.active.delete(value); return copy; }
  if (typeof value === "string" && value.length > 1_000_000) throw new TypeError(`${path} exceeds the string budget`);
  return value;
}

function parseReviewerTrust(value: unknown): NonProxyHumanQaTrustConfiguration {
  object(value, "reviewer trust"); exact(value, ["trustedKeys", "maximumAttestationLifetimeMs", "maximumReviewAgeMs"], "reviewer trust");
  for (const key of ["maximumAttestationLifetimeMs", "maximumReviewAgeMs"] as const) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1 || (value[key] as number) > 366 * 24 * 60 * 60 * 1000) throw new TypeError(`reviewer trust.${key} is invalid`);
  object(value.trustedKeys, "reviewer trust.trustedKeys"); const entries = Object.entries(value.trustedKeys); if (entries.length !== 1) throw new TypeError("reviewer trust must contain exactly one independently selected terminal decision key");
  const [keyId, raw] = entries[0]!; id(keyId, "reviewer trust keyId"); object(raw, `reviewer trust.trustedKeys.${keyId}`); exact(raw, ["authorityId", "reviewerId", "tenantId", "scopes", "publicKeyFingerprintSha256", "publicJwk"], `reviewer trust.trustedKeys.${keyId}`);
  id(raw.authorityId, "reviewer trust authorityId"); id(raw.reviewerId, "reviewer trust reviewerId"); id(raw.tenantId, "reviewer trust tenantId"); hash(raw.publicKeyFingerprintSha256, "reviewer trust fingerprint"); array(raw.scopes, "reviewer trust scopes", 1); if (raw.scopes.length !== 1 || raw.scopes[0] !== NON_PROXY_HUMAN_QA_SCOPE) throw new TypeError("reviewer key must have only the non-Proxy human QA decision scope");
  object(raw.publicJwk, "reviewer trust publicJwk"); exact(raw.publicJwk, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"], "reviewer trust publicJwk"); array(raw.publicJwk.key_ops, "reviewer trust publicJwk.key_ops", 1); if (raw.publicJwk.key_ops.length !== 1 || raw.publicJwk.key_ops[0] !== "verify" || raw.publicJwk.ext !== true || raw.publicJwk.kty !== "EC" || raw.publicJwk.crv !== "P-256" || raw.publicJwk.use !== "sig" || raw.publicJwk.alg !== "ES256" || typeof raw.publicJwk.x !== "string" || typeof raw.publicJwk.y !== "string" || raw.publicJwk.x.length !== 43 || raw.publicJwk.y.length !== 43) throw new TypeError("reviewer trusted JWK must be an ES256 public P-256 verify-only key");
  return { trustedKeys: { [keyId]: { authorityId: raw.authorityId, reviewerId: raw.reviewerId, tenantId: raw.tenantId, scopes: [NON_PROXY_HUMAN_QA_SCOPE], publicKeyFingerprintSha256: raw.publicKeyFingerprintSha256, publicJwk: structuredClone(raw.publicJwk) } }, maximumAttestationLifetimeMs: value.maximumAttestationLifetimeMs as number, maximumReviewAgeMs: value.maximumReviewAgeMs as number };
}

function trustRoots(context: Record<string, unknown>): Array<{ keyId: string; authorityId: string; publicJwk: JsonWebKey }> {
  const roots: Array<{ keyId: string; authorityId: string; publicJwk: JsonWebKey }> = [];
  for (const trustName of ["formalizationTrust", "markingProvenanceTrust", "caliperTrust"] as const) {
    const trust = context[trustName]; object(trust, `caliper context.${trustName}`); object(trust.trustedKeys, `caliper context.${trustName}.trustedKeys`);
    for (const [keyId, raw] of Object.entries(trust.trustedKeys)) { object(raw, `caliper context.${trustName}.trustedKeys.${keyId}`); id(raw.authorityId, "upstream authorityId"); object(raw.publicJwk, "upstream publicJwk"); roots.push({ keyId, authorityId: raw.authorityId, publicJwk: raw.publicJwk as JsonWebKey }); }
  }
  return roots;
}

function deepFreeze<T>(value: T): T { if (typeof value === "object" && value !== null && !Object.isFrozen(value)) { for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); Object.freeze(value); } return value; }

function canonicalArtifactJson(artifactsValue: unknown, kind: string, path: string): unknown {
  array(artifactsValue, `${path}.artifacts`, 64); const matches = artifactsValue.filter((item) => typeof item === "object" && item !== null && (item as Record<string, unknown>).kind === kind);
  if (matches.length !== 1) throw new TypeError(`${path} must contain exactly one ${kind} actual-byte artifact`);
  const artifact = matches[0]; object(artifact, `${path}.${kind}`); if (!(artifact.bytes instanceof Uint8Array)) throw new TypeError(`${path}.${kind} must contain actual bytes`);
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes); } catch { throw new TypeError(`${path}.${kind} must be canonical UTF-8 JSON`); }
  let parsed: unknown; try { parsed = JSON.parse(text) as unknown; } catch { throw new TypeError(`${path}.${kind} must be canonical JSON`); }
  if (canonicalJson(parsed) !== text) throw new TypeError(`${path}.${kind} bytes must be canonical JSON`); return parsed;
}

function prerequisiteTime(value: unknown, path: string): number { if (typeof value !== "string") throw new TypeError(`${path} must be a prerequisite timestamp`); const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new TypeError(`${path} must be a valid prerequisite timestamp`); return parsed; }

function deriveReviewReadyAt(caliperRequest: Record<string, unknown>): string {
  object(caliperRequest.formalizationRequest, "formalizationRequest"); const formal = caliperRequest.formalizationRequest; array(formal.attestations, "formalizationRequest.attestations", 4);
  const instants: number[] = formal.attestations.map((item, index) => { object(item, `formalizationRequest.attestations.${index}`); return prerequisiteTime(item.issuedAt, `formalizationRequest.attestations.${index}.issuedAt`); });
  const ledger = canonicalArtifactJson(formal.artifacts, "generation-ledger", "formalizationRequest"); array(ledger, "generation ledger", 32); for (const [index, event] of ledger.entries()) { object(event, `generation ledger.${index}`); instants.push(prerequisiteTime(event.occurredAt, `generation ledger.${index}.occurredAt`)); if (index === 0) { object(event.payload, "generation ledger genesis payload"); object(event.payload.request, "generation ledger request"); instants.push(prerequisiteTime(event.payload.request.createdAt, "generation ledger request.createdAt")); } }
  const priorDecision = canonicalArtifactJson(formal.artifacts, "qa-decision", "formalizationRequest"); object(priorDecision, "prior non-Proxy QA decision"); instants.push(prerequisiteTime(priorDecision.reviewedAt, "prior non-Proxy QA decision.reviewedAt"), prerequisiteTime(priorDecision.evaluatedAt, "prior non-Proxy QA decision.evaluatedAt"));

  object(caliperRequest.markingProvenanceRequest, "markingProvenanceRequest"); const marking = caliperRequest.markingProvenanceRequest;
  const report = canonicalArtifactJson(marking.artifacts, "reported-no-temple-marking-attestation", "markingProvenanceRequest"); object(report, "reported marking observation"); instants.push(prerequisiteTime(report.reportedAt, "reported marking observation.reportedAt"), prerequisiteTime(report.issuedAt, "reported marking observation.issuedAt"));
  object(marking.captureProvenanceAttestation, "capture provenance attestation"); instants.push(prerequisiteTime(marking.captureProvenanceAttestation.issuedAt, "capture provenance attestation.issuedAt")); array(marking.captureProvenanceAttestation.captures, "capture provenance captures", 32); for (const [index, capture] of marking.captureProvenanceAttestation.captures.entries()) { object(capture, `capture provenance captures.${index}`); instants.push(prerequisiteTime(capture.capturedAt, `capture provenance captures.${index}.capturedAt`)); }
  object(marking.markingInspectionAttestation, "marking inspection attestation"); instants.push(prerequisiteTime(marking.markingInspectionAttestation.inspectedAt, "marking inspection attestation.inspectedAt"), prerequisiteTime(marking.markingInspectionAttestation.issuedAt, "marking inspection attestation.issuedAt"));

  const calibration = canonicalArtifactJson([caliperRequest.calibrationRecordArtifact], "caliper-calibration-record", "caliperProvenanceRequest"); object(calibration, "calibration record"); instants.push(prerequisiteTime(calibration.calibratedAt, "calibration record.calibratedAt"), prerequisiteTime(calibration.validFrom, "calibration record.validFrom"));
  const session = canonicalArtifactJson([caliperRequest.measurementSessionArtifact], "caliper-measurement-session", "caliperProvenanceRequest"); object(session, "measurement session"); instants.push(prerequisiteTime(session.observedAt, "measurement session.observedAt"));
  object(caliperRequest.calibrationAttestation, "calibration attestation"); object(caliperRequest.measurementAttestation, "measurement attestation"); instants.push(prerequisiteTime(caliperRequest.calibrationAttestation.issuedAt, "calibration attestation.issuedAt"), prerequisiteTime(caliperRequest.measurementAttestation.issuedAt, "measurement attestation.issuedAt"));
  return new Date(Math.max(...instants)).toISOString();
}

export async function evaluateNonProxyHumanQaDecision(value: unknown, contextValue: unknown): Promise<NonProxyHumanQaDecisionResult> {
  object(value, "request"); exact(value, REQUEST_KEYS, "request"); object(contextValue, "verification context"); exact(contextValue, CONTEXT_KEYS, "verification context");
  const request = snapshot(value, "request") as Record<string, unknown>; const context = snapshot(contextValue, "verification context") as Record<string, unknown>;
  object(request.caliperProvenanceRequest, "caliperProvenanceRequest"); object(context.caliperProvenanceContext, "caliperProvenanceContext");
  const caliperRequest = request.caliperProvenanceRequest; const caliperContext = context.caliperProvenanceContext;
  const reviewerTrust = parseReviewerTrust(context.reviewerTrust); const attestation = parseNonProxyHumanQaDecisionAttestation(request.decisionAttestation);
  object(caliperRequest.formalizationRequest, "formalizationRequest"); const candidate = parseFormalizationCandidate(caliperRequest.formalizationRequest.candidate);
  object(caliperRequest.markingProvenanceRequest, "markingProvenanceRequest"); object(caliperRequest.markingProvenanceRequest.markingInspectionAttestation, "marking inspection attestation"); const specimenId = caliperRequest.markingProvenanceRequest.markingInspectionAttestation.specimenId;
  id(specimenId, "marking inspection specimenId");

  const caliper = await evaluateCaliperMeasurementProvenance(caliperRequest, caliperContext);
  const { evaluatedAt: _hostEvaluationClock, ...stableCaliperResult } = caliper;
  const caliperProvenanceStableSha256 = await sha256Hex(canonicalJson(stableCaliperResult));
  const expectedComposition = {
    candidateSha256: caliper.candidateSha256, formalizationStableSha256: caliper.formalizationStableSha256,
    markingProvenanceStableSha256: caliper.markingProvenanceStableSha256, caliperProvenanceStableSha256,
    measurementSetSha256: caliper.measurementSetSha256, calibrationRecordSha256: caliper.calibrationRecordSha256,
    calibrationPayloadSha256: caliper.calibrationPayloadSha256, calibrationAttestationPayloadSha256: caliper.calibrationAttestationPayloadSha256,
    measurementSessionSha256: caliper.measurementSessionSha256, measurementSessionPayloadSha256: caliper.measurementSessionPayloadSha256,
    measurementAttestationPayloadSha256: caliper.measurementAttestationPayloadSha256, captureProvenancePayloadSha256: caliper.captureProvenancePayloadSha256,
    inputValidUntil: caliper.validUntil,
  };
  if (!same(attestation.composition, expectedComposition)) throw new TypeError("human QA decision cannot substitute any composed result, payload digest, or validity horizon");
  const expectedIdentity = {
    tenantId: candidate.tenantId, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId,
    candidateId: candidate.id, candidateVersion: candidate.version, jobId: candidate.generation.jobId,
    canonicalInputSha256: candidate.generation.canonicalInputSha256, reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256,
    generatorInputSha256: candidate.generation.generatorInputSha256,
  };
  for (const [key, expected] of Object.entries(expectedIdentity)) if ((attestation as unknown as Record<string, unknown>)[key] !== expected) throw new TypeError(`human QA decision cannot substitute ${key}`);
  if (!same(attestation.output, { manifestSha256: candidate.manifestSha256, modelSha256: candidate.modelSha256, manifestByteLength: candidate.manifestByteLength, modelByteLength: candidate.modelByteLength })) throw new TypeError("human QA decision cannot substitute the reviewed output");
  if (!same(attestation.sourceAssetSha256s, candidate.sourceAssetHashes) || attestation.measurementSetSha256 !== candidate.requirements.physical.measurementSetSha256 || attestation.specimenId !== specimenId) throw new TypeError("human QA decision cannot substitute source set, MeasurementSet, or specimen");
  if (attestation.approvedQualityEnvelope && !qualityEnvelopeIsEqualOrNarrower(attestation.approvedQualityEnvelope, candidate.qualityEnvelope)) throw new TypeError("approved quality envelope must be equal to or narrower than the evidence candidate envelope");

  const trusted = reviewerTrust.trustedKeys[attestation.keyId];
  if (!trusted || trusted.authorityId !== attestation.authorityId || trusted.reviewerId !== attestation.reviewerId || trusted.tenantId !== candidate.tenantId || trusted.scopes.length !== 1 || trusted.scopes[0] !== NON_PROXY_HUMAN_QA_SCOPE) throw new TypeError("human reviewer key and reviewer attribution are not host-trusted for this tenant, authority, and scope");
  const reviewerFingerprint = await nonProxyHumanQaPublicJwkFingerprintSha256(trusted.publicJwk);
  if (reviewerFingerprint !== trusted.publicKeyFingerprintSha256 || reviewerFingerprint !== attestation.publicKeyFingerprintSha256) throw new TypeError("human reviewer fingerprint does not match the exact host-trusted JWK");
  const roots = trustRoots(caliperContext);
  if (roots.some((root) => root.keyId === attestation.keyId || root.authorityId === attestation.authorityId)) throw new TypeError("human reviewer authority and key must be independent from every evidence authority");
  for (const root of roots) if (await nonProxyHumanQaPublicJwkFingerprintSha256(root.publicJwk) === reviewerFingerprint) throw new TypeError("human reviewer public key must be independent from every evidence, capture, inspection, calibration, and measurement key, including JWK aliases");

  const reviewReadyAt = deriveReviewReadyAt(caliperRequest); const evaluatedAtText = caliper.evaluatedAt; const evaluatedAt = Date.parse(evaluatedAtText); const reviewedAt = Date.parse(attestation.reviewedAt); const issuedAt = Date.parse(attestation.issuedAt); const expiresAt = Date.parse(attestation.expiresAt); const inputValidUntil = Date.parse(caliper.validUntil);
  if (reviewedAt < Date.parse(reviewReadyAt)) throw new TypeError("human QA review cannot predate the internally recomputed prerequisite evidence review-ready instant");
  const reviewFreshUntil = reviewedAt + reviewerTrust.maximumReviewAgeMs;
  if (reviewedAt > evaluatedAt || issuedAt < reviewedAt || issuedAt > evaluatedAt || expiresAt <= evaluatedAt || expiresAt > inputValidUntil || reviewedAt >= inputValidUntil || expiresAt - issuedAt > reviewerTrust.maximumAttestationLifetimeMs || evaluatedAt >= reviewFreshUntil) throw new TypeError("human QA decision is stale, future-dated, expired, or outside the composed validity horizon");
  const key = await crypto.subtle.importKey("jwk", trusted.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const payload = nonProxyHumanQaDecisionPayload(attestation); const payloadBytes = new TextEncoder().encode(canonicalJson(payload));
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64Bytes(attestation.signatureBase64), payloadBytes)) throw new TypeError("human QA decision ES256 signature verification failed");
  const decisionPayloadSha256 = await sha256Hex(payloadBytes); const validUntil = new Date(Math.min(expiresAt, inputValidUntil, reviewFreshUntil)).toISOString(); const approved = attestation.decision === "approve";
  const authority = { qaApproved: approved, assetVersionCreated: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false, publication: false, gates: false } as const;
  let approvedReviewProjection: ApprovedNonProxyReviewProjection | null = null;
  if (approved) {
    approvedReviewProjection = deepFreeze({
      schemaVersion: 1, projectionType: "approved-non-proxy-review-projection", id: candidate.id, tenantId: candidate.tenantId,
      frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId, version: candidate.version, quality: candidate.quality,
      generationMethod: candidate.generationMethod, modelUrl: candidate.modelUrl, modelSha256: candidate.modelSha256, modelByteLength: candidate.modelByteLength,
      manifestUrl: candidate.manifestUrl, manifestSha256: candidate.manifestSha256, manifestByteLength: candidate.manifestByteLength,
      sourceAssetHashes: [...candidate.sourceAssetHashes], generation: structuredClone(candidate.generation), attachmentMatrix: [...candidate.attachmentMatrix],
      qualityEnvelope: structuredClone(attestation.approvedQualityEnvelope!), requirements: structuredClone(candidate.requirements), fixtureStatus: "unverified",
      reviewStatus: "approved", rightsScope: "internal-review-only", promotable: false, humanQaDecisionPayloadSha256: decisionPayloadSha256, validUntil,
      authority: { qaApproved: true, assetVersionCreated: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false, publication: false, gates: false },
    } as ApprovedNonProxyReviewProjection);
  }
  return deepFreeze({ decision: attestation.decision, decisionPayloadSha256, candidateSha256: caliper.candidateSha256, caliperProvenanceStableSha256, reviewReadyAt, evaluatedAt: evaluatedAtText, validUntil, approvedReviewProjection, authority });
}
