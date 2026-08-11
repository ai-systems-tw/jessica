import {
  bindNonProxyQaDecisionEvidence,
  canonicalJson,
  verifyNonProxyQaDecisionEvidence,
  type NonProxyQaCandidateBinding,
  type NonProxyQaDecision,
  type NonProxyQaDecisionEvidence,
  type NonProxyQaRequirements,
} from "../../contracts/src/index.js";
import { replayGenerationJobLedger, type GenerationJobState } from "../../generation-jobs/src/index.js";

/** A bounded evidence candidate, never an approved/reviewable runtime asset. */
export type NonProxyEvidenceCandidateDraft = {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  version: number;
  quality: "standard" | "premium";
  generationMethod: "standard-auto" | "manual" | "external";
  modelUrl: string;
  modelSha256: string;
  modelByteLength: number;
  manifestUrl: string;
  manifestSha256: string;
  manifestByteLength: number;
  sourceAssetHashes: readonly string[];
  generation: { jobId: string; canonicalInputSha256: string; reviewHeadEventSha256: string; generatorInputSha256: string; generator: { id: string; version: string; configSha256: string }; qaDecisionSha256: string };
  attachmentMatrix: readonly number[];
  qualityEnvelope: { maxYawDeg: number; maxPitchDeg: number; recommendedForLive: false; scaleConfidence: "low" | "medium" | "high" };
  requirements: NonProxyQaRequirements;
  fixtureStatus: "unverified";
  admission: "unverified-evidence-candidate";
  promotable: false;
  status: "draft";
  authority: Readonly<{ qaApproved: false; assetVersionCreated: false; assetVersionPromoted: false; recommendedForLive: false; activeDeployment: false; publication: false; gates: false }>;
};

export type NonProxyQaReviewResult = { decision: NonProxyQaDecisionEvidence; outcome: "draft-derived" | "rejected"; candidate: NonProxyEvidenceCandidateDraft | null };
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

export const NON_PROXY_CANDIDATE_AUTHORITY = Object.freeze({ qaApproved: false, assetVersionCreated: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false, publication: false, gates: false } as const);

function expectedBinding(state: GenerationJobState, candidate: NonProxyQaCandidateBinding) {
  if (!state.output) throw new TypeError("review state is missing output evidence");
  return { tenantId: state.tenantId, frameModelId: state.frameModelId, jobId: state.jobId, canonicalInputSha256: state.canonicalInputSha256, reviewHeadEventSha256: state.headEventSha256, generatorInputSha256: state.request.generatorInputSha256, output: state.output, candidate };
}

function assertNonProxyReviewState(state: GenerationJobState, candidate: NonProxyQaCandidateBinding): void {
  if (state.status !== "review" || !state.output) throw new TypeError("non-proxy QA requires a GenerationJob in review state");
  if (state.request.method === "proxy-auto") throw new TypeError("proxy jobs are permanently excluded from non-proxy QA");
  if (state.request.method !== candidate.generationMethod) throw new TypeError("candidate generation method must match the reviewed GenerationJob");
  if (candidate.quality === "standard" && state.request.method === "external") throw new TypeError("external generation cannot derive a standard candidate");
}

function assertReferencesBindJob(state: GenerationJobState, requirements: NonProxyQaRequirements): void {
  const sourceSet = new Set(state.request.sourceAssetSha256s);
  for (const [name, reference] of Object.entries(requirements)) {
    if (!sourceSet.has(reference.sourceAssetSha256)) throw new TypeError(`${name} evidence cannot substitute a source digest outside the reviewed GenerationJob`);
    if (reference.measurementSetSha256 !== state.request.measurementSetSha256) throw new TypeError(`${name} evidence cannot substitute the reviewed measurement set`);
  }
}

export async function createNonProxyQaDecision(options: { jobEvents: readonly unknown[]; candidate: NonProxyQaCandidateBinding; requirements: NonProxyQaRequirements; evaluatedAt: string; reviewerId: string; decision: NonProxyQaDecision; issueCategories: readonly import("../../contracts/src/index.js").QaIssueCategory[]; notes: string | null; reviewedAt: string }): Promise<NonProxyQaDecisionEvidence> {
  const snapshot = structuredClone(options);
  const state = await replayGenerationJobLedger(snapshot.jobEvents, { evaluatedAt: snapshot.evaluatedAt });
  assertNonProxyReviewState(state, snapshot.candidate);
  assertReferencesBindJob(state, snapshot.requirements);
  return bindNonProxyQaDecisionEvidence({ schemaVersion: 1, sequence: 1, previousDecisionSha256: null, binding: expectedBinding(state, snapshot.candidate), reviewerId: snapshot.reviewerId, decision: snapshot.decision, issueCategories: [...snapshot.issueCategories], notes: snapshot.notes, requirements: snapshot.requirements, reviewedAt: snapshot.reviewedAt, evaluatedAt: snapshot.evaluatedAt });
}

export async function reviewNonProxyGenerationOutput(options: { jobEvents: readonly unknown[]; decisions: readonly unknown[]; evaluatedAt: string }): Promise<NonProxyQaReviewResult> {
  const snapshot = structuredClone(options);
  if (snapshot.decisions.length !== 1) throw new TypeError("non-proxy QA requires exactly one immutable terminal decision");
  const state = await replayGenerationJobLedger(snapshot.jobEvents, { evaluatedAt: snapshot.evaluatedAt });
  const decision = await verifyNonProxyQaDecisionEvidence(snapshot.decisions[0]);
  assertNonProxyReviewState(state, decision.binding.candidate);
  assertReferencesBindJob(state, decision.requirements);
  if (decision.evaluatedAt !== snapshot.evaluatedAt) throw new TypeError("decision evaluatedAt must equal the explicit review horizon");
  if (Date.parse(decision.reviewedAt) < Date.parse(state.updatedAt)) throw new TypeError("decision cannot precede reviewed output evidence");
  if (!same(decision.binding, expectedBinding(state, decision.binding.candidate))) throw new TypeError("decision cannot substitute job, output, or candidate identity");
  if (decision.decision === "reject") return { decision, outcome: "rejected", candidate: null };
  const candidate = decision.binding.candidate; const output = state.output!;
  return { decision, outcome: "draft-derived", candidate: {
    schemaVersion: 1, id: candidate.id, tenantId: state.tenantId, frameModelId: state.frameModelId, frameVariantId: candidate.frameVariantId, version: candidate.version, quality: candidate.quality, generationMethod: candidate.generationMethod,
    modelUrl: candidate.modelUrl, modelSha256: output.modelSha256, modelByteLength: output.modelByteLength, manifestUrl: candidate.manifestUrl, manifestSha256: output.manifestSha256, manifestByteLength: output.manifestByteLength,
    sourceAssetHashes: [...state.request.sourceAssetSha256s], generation: { jobId: state.jobId, canonicalInputSha256: state.canonicalInputSha256, reviewHeadEventSha256: state.headEventSha256, generatorInputSha256: state.request.generatorInputSha256, generator: { ...state.request.generator }, qaDecisionSha256: decision.decisionSha256 },
    attachmentMatrix: [...candidate.attachmentMatrix], qualityEnvelope: { ...candidate.qualityEnvelope, recommendedForLive: false }, requirements: structuredClone(decision.requirements), fixtureStatus: "unverified", admission: "unverified-evidence-candidate", promotable: false, status: "draft", authority: NON_PROXY_CANDIDATE_AUTHORITY,
  } };
}
