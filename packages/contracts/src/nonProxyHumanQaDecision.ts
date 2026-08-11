import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "./generationJob.js";
import { QA_ISSUE_CATEGORIES, QA_REVIEW_DECISIONS, type QaIssueCategory, type QaReviewDecision } from "./qaReview.js";
import type { FormalizationCandidate } from "./nonProxyFormalizationReadiness.js";

export const NON_PROXY_HUMAN_QA_SCOPE = "non-proxy-human-qa-decision" as const;

export type NonProxyApprovedQualityEnvelope = {
  maxYawDeg: number;
  maxPitchDeg: number;
  recommendedForLive: false;
  scaleConfidence: "low" | "medium" | "high";
};

export type NonProxyQaCompositionBinding = {
  candidateSha256: string;
  formalizationStableSha256: string;
  markingProvenanceStableSha256: string;
  caliperProvenanceStableSha256: string;
  measurementSetSha256: string;
  calibrationRecordSha256: string;
  calibrationPayloadSha256: string;
  calibrationAttestationPayloadSha256: string;
  measurementSessionSha256: string;
  measurementSessionPayloadSha256: string;
  measurementAttestationPayloadSha256: string;
  captureProvenancePayloadSha256: string;
  inputValidUntil: string;
};

export type NonProxyHumanQaDecisionAttestation = {
  schemaVersion: 1;
  type: "non-proxy-human-qa-decision-attestation";
  algorithm: "ES256";
  scope: typeof NON_PROXY_HUMAN_QA_SCOPE;
  authorityId: string;
  keyId: string;
  publicKeyFingerprintSha256: string;
  reviewerId: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  candidateId: string;
  candidateVersion: number;
  jobId: string;
  canonicalInputSha256: string;
  reviewHeadEventSha256: string;
  generatorInputSha256: string;
  output: GenerationJobOutputEvidence;
  sourceAssetSha256s: readonly string[];
  measurementSetSha256: string;
  specimenId: string;
  composition: NonProxyQaCompositionBinding;
  rightsScope: "internal-review-only";
  decision: QaReviewDecision;
  issueCategories: readonly QaIssueCategory[];
  notes: string | null;
  approvedQualityEnvelope: NonProxyApprovedQualityEnvelope | null;
  reviewedAt: string;
  issuedAt: string;
  expiresAt: string;
  signatureBase64: string;
};

export type NonProxyHumanQaTrustConfiguration = {
  trustedKeys: Readonly<Record<string, {
    authorityId: string;
    reviewerId: string;
    tenantId: string;
    scopes: readonly [typeof NON_PROXY_HUMAN_QA_SCOPE];
    publicKeyFingerprintSha256: string;
    publicJwk: JsonWebKey;
  }>>;
  maximumAttestationLifetimeMs: number;
  maximumReviewAgeMs: number;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const KEYS = ["schemaVersion", "type", "algorithm", "scope", "authorityId", "keyId", "publicKeyFingerprintSha256", "reviewerId", "tenantId", "frameModelId", "frameVariantId", "candidateId", "candidateVersion", "jobId", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "output", "sourceAssetSha256s", "measurementSetSha256", "specimenId", "composition", "rightsScope", "decision", "issueCategories", "notes", "approvedQualityEnvelope", "reviewedAt", "issuedAt", "expiresAt", "signatureBase64"] as const;
const COMPOSITION_KEYS = ["candidateSha256", "formalizationStableSha256", "markingProvenanceStableSha256", "caliperProvenanceStableSha256", "measurementSetSha256", "calibrationRecordSha256", "calibrationPayloadSha256", "calibrationAttestationPayloadSha256", "measurementSessionSha256", "measurementSessionPayloadSha256", "measurementAttestationPayloadSha256", "captureProvenancePayloadSha256", "inputValidUntil"] as const;

function object(value: unknown, path: string): asserts value is Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must be a plain object`); for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { const allowed = new Set(keys); const unknown = Object.keys(value).find((key) => !allowed.has(key)); const missing = keys.find((key) => !(key in value)); if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`); if (missing) throw new TypeError(`${path}.${missing} is required`); }
function array(value: unknown, path: string, maximum: number): asserts value is unknown[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense plain array`); const descriptors = Object.getOwnPropertyDescriptors(value); for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`); } }
function id(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function hash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function positive(value: unknown, path: string): asserts value is number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`); }
function timestamp(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`); const parsed = Date.parse(value); const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value); const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : ""; if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`); }
function signature(value: unknown): asserts value is string { if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError("human QA signature must be canonical raw ES256 base64"); let decoded: string; try { decoded = atob(value); } catch { throw new TypeError("human QA signature must be canonical raw ES256 base64"); } if (decoded.length !== 64 || btoa(decoded) !== value) throw new TypeError("human QA signature must encode one raw 64-byte ES256 signature"); }
function output(value: unknown): void { object(value, "human QA output"); exact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], "human QA output"); hash(value.manifestSha256, "human QA output.manifestSha256"); hash(value.modelSha256, "human QA output.modelSha256"); positive(value.manifestByteLength, "human QA output.manifestByteLength"); positive(value.modelByteLength, "human QA output.modelByteLength"); }

export function parseNonProxyApprovedQualityEnvelope(value: unknown): NonProxyApprovedQualityEnvelope {
  object(value, "approved quality envelope"); exact(value, ["maxYawDeg", "maxPitchDeg", "recommendedForLive", "scaleConfidence"], "approved quality envelope");
  for (const key of ["maxYawDeg", "maxPitchDeg"] as const) if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 90) throw new TypeError(`approved quality envelope.${key} is outside its allowed range`);
  if (value.recommendedForLive !== false || !["low", "medium", "high"].includes(value.scaleConfidence as string)) throw new TypeError("approved quality envelope cannot assert live readiness");
  return structuredClone(value) as NonProxyApprovedQualityEnvelope;
}

export function qualityEnvelopeIsEqualOrNarrower(approved: NonProxyApprovedQualityEnvelope, candidate: FormalizationCandidate["qualityEnvelope"]): boolean {
  const ranks = { low: 0, medium: 1, high: 2 } as const;
  return approved.recommendedForLive === false && approved.maxYawDeg <= candidate.maxYawDeg && approved.maxPitchDeg <= candidate.maxPitchDeg && ranks[approved.scaleConfidence] >= ranks[candidate.scaleConfidence];
}

export function parseNonProxyHumanQaDecisionAttestation(value: unknown): NonProxyHumanQaDecisionAttestation {
  object(value, "human QA attestation"); exact(value, KEYS, "human QA attestation");
  if (value.schemaVersion !== 1 || value.type !== "non-proxy-human-qa-decision-attestation" || value.algorithm !== "ES256" || value.scope !== NON_PROXY_HUMAN_QA_SCOPE) throw new TypeError("human QA attestation must use the strict ES256 v1 discriminator");
  for (const key of ["authorityId", "keyId", "reviewerId", "tenantId", "frameModelId", "frameVariantId", "candidateId", "jobId", "specimenId"] as const) id(value[key], `human QA attestation.${key}`);
  positive(value.candidateVersion, "human QA attestation.candidateVersion");
  for (const key of ["publicKeyFingerprintSha256", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "measurementSetSha256"] as const) hash(value[key], `human QA attestation.${key}`);
  output(value.output); array(value.sourceAssetSha256s, "human QA attestation.sourceAssetSha256s", 32); value.sourceAssetSha256s.forEach((item, index) => hash(item, `human QA attestation.sourceAssetSha256s.${index}`)); if (value.sourceAssetSha256s.length === 0 || new Set(value.sourceAssetSha256s).size !== value.sourceAssetSha256s.length || canonicalJson(value.sourceAssetSha256s) !== canonicalJson([...value.sourceAssetSha256s].sort())) throw new TypeError("human QA source set must be non-empty, unique, and sorted");
  object(value.composition, "human QA composition"); exact(value.composition, COMPOSITION_KEYS, "human QA composition"); for (const key of COMPOSITION_KEYS.slice(0, -1)) hash(value.composition[key], `human QA composition.${key}`); timestamp(value.composition.inputValidUntil, "human QA composition.inputValidUntil");
  if (value.rightsScope !== "internal-review-only") throw new TypeError("human QA rights scope cannot escalate beyond internal review");
  if (!QA_REVIEW_DECISIONS.includes(value.decision as QaReviewDecision)) throw new TypeError("human QA decision must be approve or reject");
  array(value.issueCategories, "human QA issueCategories", QA_ISSUE_CATEGORIES.length); value.issueCategories.forEach((item) => { if (!QA_ISSUE_CATEGORIES.includes(item as QaIssueCategory)) throw new TypeError("human QA issue category is unsupported"); }); if (new Set(value.issueCategories).size !== value.issueCategories.length || canonicalJson(value.issueCategories) !== canonicalJson([...value.issueCategories].sort())) throw new TypeError("human QA issue categories must be unique and sorted");
  if ((value.decision === "approve") !== (value.issueCategories.length === 0)) throw new TypeError("approve requires no issues and reject requires at least one issue");
  if (value.notes !== null && (typeof value.notes !== "string" || value.notes.length < 1 || value.notes.length > 2000 || value.notes !== value.notes.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.notes))) throw new TypeError("human QA notes must be null or bounded trimmed text");
  const approvedQualityEnvelope = value.approvedQualityEnvelope === null ? null : parseNonProxyApprovedQualityEnvelope(value.approvedQualityEnvelope);
  if ((value.decision === "approve") !== (approvedQualityEnvelope !== null)) throw new TypeError("only approve must carry one approved quality envelope");
  timestamp(value.reviewedAt, "human QA reviewedAt"); timestamp(value.issuedAt, "human QA issuedAt"); timestamp(value.expiresAt, "human QA expiresAt"); if (Date.parse(value.reviewedAt) > Date.parse(value.issuedAt) || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) throw new TypeError("human QA review, issuance, and expiry order is invalid"); signature(value.signatureBase64);
  return { ...structuredClone(value), approvedQualityEnvelope } as NonProxyHumanQaDecisionAttestation;
}

export function nonProxyHumanQaDecisionPayload(value: NonProxyHumanQaDecisionAttestation): Omit<NonProxyHumanQaDecisionAttestation, "signatureBase64"> { const { signatureBase64: _ignored, ...payload } = value; return payload; }
export async function nonProxyHumanQaPublicJwkFingerprintSha256(value: JsonWebKey): Promise<string> { return sha256Hex(canonicalJson({ crv: value.crv, kty: value.kty, x: value.x, y: value.y })); }
