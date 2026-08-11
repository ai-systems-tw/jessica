import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "./generationJob.js";
import type { Matrix4 } from "./frame.js";
import { QA_ISSUE_CATEGORIES, type QaIssueCategory } from "./qaReview.js";

export const NON_PROXY_QA_DECISIONS = ["accept-evidence-candidate", "reject"] as const;
export const NON_PROXY_QA_QUALITIES = ["standard", "premium"] as const;
export const NON_PROXY_QA_METHODS = ["standard-auto", "manual", "external"] as const;
export type NonProxyQaDecision = (typeof NON_PROXY_QA_DECISIONS)[number];
export type NonProxyQaQuality = (typeof NON_PROXY_QA_QUALITIES)[number];
export type NonProxyQaGenerationMethod = (typeof NON_PROXY_QA_METHODS)[number];

export type UnverifiedEvidenceReference = { evidenceSha256: string; sourceAssetSha256: string; measurementSetSha256: string };
/** References are intentionally not verification claims.  Byte/origin/rights authority is a later adapter boundary. */
export type NonProxyQaRequirements = {
  physical: UnverifiedEvidenceReference;
  visualFidelity: UnverifiedEvidenceReference;
  actualWear: UnverifiedEvidenceReference;
  rights: UnverifiedEvidenceReference;
};

export type NonProxyQaCandidateBinding = {
  id: string;
  frameVariantId: string;
  version: number;
  quality: NonProxyQaQuality;
  generationMethod: NonProxyQaGenerationMethod;
  modelUrl: string;
  manifestUrl: string;
  attachmentMatrix: Matrix4;
  qualityEnvelope: { maxYawDeg: number; maxPitchDeg: number; scaleConfidence: "low" | "medium" | "high" };
};

export type NonProxyQaBinding = {
  tenantId: string;
  frameModelId: string;
  jobId: string;
  canonicalInputSha256: string;
  reviewHeadEventSha256: string;
  generatorInputSha256: string;
  output: GenerationJobOutputEvidence;
  candidate: NonProxyQaCandidateBinding;
};

export type NonProxyQaDecisionEvidence = {
  schemaVersion: 1;
  sequence: 1;
  previousDecisionSha256: null;
  binding: NonProxyQaBinding;
  reviewerId: string;
  decision: NonProxyQaDecision;
  issueCategories: readonly QaIssueCategory[];
  notes: string | null;
  requirements: NonProxyQaRequirements;
  reviewedAt: string;
  evaluatedAt: string;
  decisionSha256: string;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function object(value: unknown, path: string): asserts value is Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must be a plain object`); for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void { const allowed = new Set(keys); const unknown = Object.keys(value).find((key) => !allowed.has(key)); const missing = keys.find((key) => !(key in value)); if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`); if (missing) throw new TypeError(`${path}.${missing} is required`); }
function array(value: unknown, path: string, maximum: number): asserts value is unknown[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense plain array`); const descriptors = Object.getOwnPropertyDescriptors(value); for (let index = 0; index < value.length; index += 1) { const descriptor = descriptors[String(index)]; if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`); } }
function identifier(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function hash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function timestamp(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`); const parsed = Date.parse(value); const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value); const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : ""; if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real RFC 3339 UTC instant`); }
function positive(value: unknown, path: string): asserts value is number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`); }
function locator(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || value.length < 3 || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new TypeError(`${path} must be a bounded safe candidate locator`); if (value.startsWith("./")) { if (value.includes("../") || value.includes("?") || value.includes("#")) throw new TypeError(`${path} must be a contained relative candidate locator`); return; } let parsed: URL; try { parsed = new URL(value); } catch { throw new TypeError(`${path} must be relative or HTTPS`); } if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") throw new TypeError(`${path} must be an exact credential-free HTTPS candidate locator`); }
function output(value: unknown, path: string): void { object(value, path); exact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], path); hash(value.manifestSha256, `${path}.manifestSha256`); hash(value.modelSha256, `${path}.modelSha256`); positive(value.manifestByteLength, `${path}.manifestByteLength`); positive(value.modelByteLength, `${path}.modelByteLength`); }
function requirement(value: unknown, path: string): void { object(value, path); exact(value, ["evidenceSha256", "sourceAssetSha256", "measurementSetSha256"], path); hash(value.evidenceSha256, `${path}.evidenceSha256`); hash(value.sourceAssetSha256, `${path}.sourceAssetSha256`); hash(value.measurementSetSha256, `${path}.measurementSetSha256`); }
function candidate(value: unknown, path: string): void { object(value, path); exact(value, ["id", "frameVariantId", "version", "quality", "generationMethod", "modelUrl", "manifestUrl", "attachmentMatrix", "qualityEnvelope"], path); identifier(value.id, `${path}.id`); identifier(value.frameVariantId, `${path}.frameVariantId`); positive(value.version, `${path}.version`); if (!NON_PROXY_QA_QUALITIES.includes(value.quality as NonProxyQaQuality)) throw new TypeError(`${path}.quality must be standard or premium`); if (!NON_PROXY_QA_METHODS.includes(value.generationMethod as NonProxyQaGenerationMethod)) throw new TypeError(`${path}.generationMethod is unsupported`); locator(value.modelUrl, `${path}.modelUrl`); locator(value.manifestUrl, `${path}.manifestUrl`); array(value.attachmentMatrix, `${path}.attachmentMatrix`, 16); if (value.attachmentMatrix.length !== 16 || value.attachmentMatrix.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new TypeError(`${path}.attachmentMatrix must contain 16 finite numbers`); object(value.qualityEnvelope, `${path}.qualityEnvelope`); exact(value.qualityEnvelope, ["maxYawDeg", "maxPitchDeg", "scaleConfidence"], `${path}.qualityEnvelope`); for (const key of ["maxYawDeg", "maxPitchDeg"] as const) if (typeof value.qualityEnvelope[key] !== "number" || !Number.isFinite(value.qualityEnvelope[key]) || value.qualityEnvelope[key] < 0 || value.qualityEnvelope[key] > 90) throw new TypeError(`${path}.qualityEnvelope.${key} must be between 0 and 90`); if (!["low", "medium", "high"].includes(value.qualityEnvelope.scaleConfidence as string)) throw new TypeError(`${path}.qualityEnvelope.scaleConfidence is unsupported`); }

export function parseNonProxyQaDecisionEvidence(value: unknown): NonProxyQaDecisionEvidence {
  object(value, "decision"); exact(value, ["schemaVersion", "sequence", "previousDecisionSha256", "binding", "reviewerId", "decision", "issueCategories", "notes", "requirements", "reviewedAt", "evaluatedAt", "decisionSha256"], "decision");
  if (value.schemaVersion !== 1 || value.sequence !== 1 || value.previousDecisionSha256 !== null) throw new TypeError("decision must be schema v1 terminal sequence 1 evidence");
  object(value.binding, "decision.binding"); exact(value.binding, ["tenantId", "frameModelId", "jobId", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "output", "candidate"], "decision.binding");
  for (const key of ["tenantId", "frameModelId", "jobId"] as const) identifier(value.binding[key], `decision.binding.${key}`);
  for (const key of ["canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256"] as const) hash(value.binding[key], `decision.binding.${key}`);
  output(value.binding.output, "decision.binding.output"); candidate(value.binding.candidate, "decision.binding.candidate"); identifier(value.reviewerId, "decision.reviewerId");
  if (!NON_PROXY_QA_DECISIONS.includes(value.decision as NonProxyQaDecision)) throw new TypeError("decision.decision is unsupported");
  array(value.issueCategories, "decision.issueCategories", 10); if (value.issueCategories.some((item) => !QA_ISSUE_CATEGORIES.includes(item as QaIssueCategory))) throw new TypeError("decision.issueCategories must be supported issue categories");
  if (new Set(value.issueCategories).size !== value.issueCategories.length || canonicalJson(value.issueCategories) !== canonicalJson([...value.issueCategories].sort())) throw new TypeError("decision.issueCategories must be unique and sorted");
  if ((value.decision === "accept-evidence-candidate") !== (value.issueCategories.length === 0)) throw new TypeError("candidate acceptance requires no issues and reject requires at least one issue");
  if (value.notes !== null && (typeof value.notes !== "string" || value.notes.length < 1 || value.notes.length > 2000 || value.notes !== value.notes.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.notes))) throw new TypeError("decision.notes must be null or bounded trimmed text");
  object(value.requirements, "decision.requirements"); exact(value.requirements, ["physical", "visualFidelity", "actualWear", "rights"], "decision.requirements"); for (const key of ["physical", "visualFidelity", "actualWear", "rights"] as const) requirement(value.requirements[key], `decision.requirements.${key}`);
  timestamp(value.reviewedAt, "decision.reviewedAt"); timestamp(value.evaluatedAt, "decision.evaluatedAt"); if (Date.parse(value.reviewedAt) > Date.parse(value.evaluatedAt)) throw new TypeError("decision contains future review evidence"); hash(value.decisionSha256, "decision.decisionSha256");
  return structuredClone(value) as NonProxyQaDecisionEvidence;
}

export async function bindNonProxyQaDecisionEvidence(value: Omit<NonProxyQaDecisionEvidence, "decisionSha256">): Promise<NonProxyQaDecisionEvidence> { const candidate = { ...structuredClone(value), decisionSha256: "0".repeat(64) }; const parsed = parseNonProxyQaDecisionEvidence(candidate); const { decisionSha256: _ignored, ...body } = parsed; return { ...body, decisionSha256: await sha256Hex(canonicalJson(body)) }; }
export async function verifyNonProxyQaDecisionEvidence(value: unknown): Promise<NonProxyQaDecisionEvidence> { const decision = parseNonProxyQaDecisionEvidence(value); const { decisionSha256, ...body } = decision; if (await sha256Hex(canonicalJson(body)) !== decisionSha256) throw new TypeError("decision.decisionSha256 does not match canonical decision evidence"); return decision; }
