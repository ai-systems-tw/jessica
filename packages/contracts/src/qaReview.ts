import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "./generationJob.js";

export const QA_REVIEW_DECISIONS = ["approve", "reject"] as const;
export const QA_ISSUE_CATEGORIES = [
  "geometry", "dimensions", "attachment", "materials", "visual-fidelity",
  "actual-wear", "physical-evidence", "rights", "provenance", "unsupported",
] as const;

export type QaReviewDecision = (typeof QA_REVIEW_DECISIONS)[number];
export type QaIssueCategory = (typeof QA_ISSUE_CATEGORIES)[number];

export type QaReviewBinding = {
  tenantId: string;
  frameModelId: string;
  jobId: string;
  canonicalInputSha256: string;
  reviewHeadEventSha256: string;
  generatorInputSha256: string;
  output: GenerationJobOutputEvidence;
};

export type QaUnprovenRequirements = {
  physicalRequirementsMet: false;
  physicalEvidenceSha256: null;
  visualFidelityRequirementsMet: false;
  visualFidelityEvidenceSha256: null;
  actualWearRequirementsMet: false;
  actualWearEvidenceSha256: null;
  rightsRequirementsMet: false;
  rightsEvidenceSha256: null;
};

export type QaReviewDecisionEvidence = {
  schemaVersion: 1;
  sequence: 1;
  previousDecisionSha256: null;
  binding: QaReviewBinding;
  reviewerId: string;
  decision: QaReviewDecision;
  issueCategories: readonly QaIssueCategory[];
  notes: string | null;
  requirements: QaUnprovenRequirements;
  reviewedAt: string;
  evaluatedAt: string;
  decisionSha256: string;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  const missing = keys.find((key) => !(key in value));
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function identifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`);
}

function hash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
}

function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value);
  const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real RFC 3339 UTC instant`);
}

function positiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${path} must be a positive safe integer`);
}

function output(value: unknown, path: string): void {
  object(value, path);
  exact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], path);
  hash(value.manifestSha256, `${path}.manifestSha256`); hash(value.modelSha256, `${path}.modelSha256`);
  positiveInteger(value.manifestByteLength, `${path}.manifestByteLength`); positiveInteger(value.modelByteLength, `${path}.modelByteLength`);
}

function parseRequirements(value: unknown): void {
  const path = "decision.requirements"; object(value, path);
  exact(value, ["physicalRequirementsMet", "physicalEvidenceSha256", "visualFidelityRequirementsMet", "visualFidelityEvidenceSha256", "actualWearRequirementsMet", "actualWearEvidenceSha256", "rightsRequirementsMet", "rightsEvidenceSha256"], path);
  for (const key of ["physicalRequirementsMet", "visualFidelityRequirementsMet", "actualWearRequirementsMet", "rightsRequirementsMet"] as const) {
    if (value[key] !== false) throw new TypeError(`${path}.${key} must remain false for proxy review`);
  }
  for (const key of ["physicalEvidenceSha256", "visualFidelityEvidenceSha256", "actualWearEvidenceSha256", "rightsEvidenceSha256"] as const) {
    if (value[key] !== null) throw new TypeError(`${path}.${key} must remain null for proxy review`);
  }
}

export function parseQaReviewDecisionEvidence(value: unknown): QaReviewDecisionEvidence {
  object(value, "decision");
  exact(value, ["schemaVersion", "sequence", "previousDecisionSha256", "binding", "reviewerId", "decision", "issueCategories", "notes", "requirements", "reviewedAt", "evaluatedAt", "decisionSha256"], "decision");
  if (value.schemaVersion !== 1 || value.sequence !== 1 || value.previousDecisionSha256 !== null) throw new TypeError("decision must be schema v1 terminal sequence 1 evidence");
  object(value.binding, "decision.binding");
  exact(value.binding, ["tenantId", "frameModelId", "jobId", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "output"], "decision.binding");
  identifier(value.binding.tenantId, "decision.binding.tenantId"); identifier(value.binding.frameModelId, "decision.binding.frameModelId"); identifier(value.binding.jobId, "decision.binding.jobId");
  hash(value.binding.canonicalInputSha256, "decision.binding.canonicalInputSha256"); hash(value.binding.reviewHeadEventSha256, "decision.binding.reviewHeadEventSha256"); hash(value.binding.generatorInputSha256, "decision.binding.generatorInputSha256"); output(value.binding.output, "decision.binding.output");
  identifier(value.reviewerId, "decision.reviewerId");
  if (!QA_REVIEW_DECISIONS.includes(value.decision as QaReviewDecision)) throw new TypeError("decision.decision is unsupported");
  if (!Array.isArray(value.issueCategories) || value.issueCategories.length > 10) throw new TypeError("decision.issueCategories must be an array of at most 10 items");
  value.issueCategories.forEach((item, index) => { if (!QA_ISSUE_CATEGORIES.includes(item as QaIssueCategory)) throw new TypeError(`decision.issueCategories.${index} is unsupported`); });
  if (new Set(value.issueCategories).size !== value.issueCategories.length) throw new TypeError("decision.issueCategories must not contain duplicates");
  if (canonicalJson(value.issueCategories) !== canonicalJson([...value.issueCategories].sort())) throw new TypeError("decision.issueCategories must be sorted");
  if (value.decision === "approve" && value.issueCategories.length !== 0) throw new TypeError("approve evidence must not carry issue categories");
  if (value.decision === "reject" && value.issueCategories.length === 0) throw new TypeError("reject evidence must carry at least one issue category");
  if (value.notes !== null && (typeof value.notes !== "string" || value.notes.length < 1 || value.notes.length > 2000 || value.notes !== value.notes.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.notes))) throw new TypeError("decision.notes must be null or bounded trimmed text");
  parseRequirements(value.requirements); timestamp(value.reviewedAt, "decision.reviewedAt"); timestamp(value.evaluatedAt, "decision.evaluatedAt"); hash(value.decisionSha256, "decision.decisionSha256");
  if (Date.parse(value.reviewedAt) > Date.parse(value.evaluatedAt)) throw new TypeError("decision contains future review evidence");
  return structuredClone(value) as unknown as QaReviewDecisionEvidence;
}

export async function bindQaReviewDecisionEvidence(value: Omit<QaReviewDecisionEvidence, "decisionSha256">): Promise<QaReviewDecisionEvidence> {
  const candidate = { ...structuredClone(value), decisionSha256: "0".repeat(64) };
  const parsed = parseQaReviewDecisionEvidence(candidate);
  const { decisionSha256: _ignored, ...body } = parsed;
  return { ...body, decisionSha256: await sha256Hex(canonicalJson(body)) };
}

export async function verifyQaReviewDecisionEvidence(value: unknown): Promise<QaReviewDecisionEvidence> {
  const decision = parseQaReviewDecisionEvidence(value);
  const { decisionSha256, ...body } = decision;
  if (await sha256Hex(canonicalJson(body)) !== decisionSha256) throw new TypeError("decision.decisionSha256 does not match canonical decision evidence");
  return decision;
}
