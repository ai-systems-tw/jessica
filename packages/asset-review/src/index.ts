import {
  IDENTITY_MATRIX_4,
  bindQaReviewDecisionEvidence,
  canonicalJson,
  verifyQaReviewDecisionEvidence,
  type GenerationJobOutputEvidence,
  type QaIssueCategory,
  type QaReviewDecision,
  type QaReviewDecisionEvidence,
  type QaUnprovenRequirements,
} from "../../contracts/src/index.js";
import { generateProxyBundle, type ProxyGeneratorInput } from "../../frame-generation/src/index.js";
import { replayGenerationJobLedger, type GenerationJobState } from "../../generation-jobs/src/index.js";

export const PROXY_UNPROVEN_REQUIREMENTS: QaUnprovenRequirements = Object.freeze({
  physicalRequirementsMet: false, physicalEvidenceSha256: null,
  visualFidelityRequirementsMet: false, visualFidelityEvidenceSha256: null,
  actualWearRequirementsMet: false, actualWearEvidenceSha256: null,
  rightsRequirementsMet: false, rightsEvidenceSha256: null,
});

export type ProxyAssetVersionDraft = {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  version: number;
  quality: "proxy";
  generationMethod: "proxy-auto";
  modelUrl: string;
  modelSha256: string;
  modelByteLength: number;
  manifestUrl: string;
  manifestSha256: string;
  manifestByteLength: number;
  sourceAssetHashes: readonly string[];
  generation: {
    jobId: string;
    canonicalInputSha256: string;
    reviewHeadEventSha256: string;
    generatorInputSha256: string;
    generator: { id: string; version: string; configSha256: string };
    qaDecisionSha256: string;
  };
  attachmentMatrix: typeof IDENTITY_MATRIX_4;
  qualityEnvelope: { maxYawDeg: 0; maxPitchDeg: 0; recommendedForLive: false; scaleConfidence: "high" };
  requirements: QaUnprovenRequirements;
  fixture: true;
  admission: "calibration-only";
  promotable: false;
  status: "draft";
};

export type ProxyQaReviewResult = {
  decision: QaReviewDecisionEvidence;
  outcome: "draft-derived" | "rejected";
  assetVersion: ProxyAssetVersionDraft | null;
};

function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

function assertReviewedProxyBinding(state: GenerationJobState, input: ProxyGeneratorInput, bundle: Awaited<ReturnType<typeof generateProxyBundle>>): void {
  if (state.status !== "review" || !state.output) throw new TypeError("QA review requires a GenerationJob in review state");
  if (state.request.method !== "proxy-auto") throw new TypeError("proxy QA review accepts only method=proxy-auto");
  if (state.tenantId !== input.candidate.tenantId || state.frameModelId !== input.candidate.frameModelId) throw new TypeError("proxy QA input cannot substitute tenant/model identity");
  if (state.request.generatorInputSha256 !== bundle.canonicalInputSha256 || state.request.measurementSetSha256 !== input.measurementSet.sha256 || !same(state.request.generator, input.generator) || !same(state.request.sourceAssetSha256s, input.sourceAssetHashes)) throw new TypeError("proxy QA input cannot substitute processing identity");
  const expected: GenerationJobOutputEvidence = {
    manifestSha256: bundle.manifestSha256, modelSha256: bundle.manifest.model.sha256,
    manifestByteLength: new TextEncoder().encode(bundle.manifestJson).byteLength, modelByteLength: bundle.glb.byteLength,
  };
  if (!same(state.output, expected)) throw new TypeError("reviewed output does not match the deterministic manifest/model evidence");
  const authority = bundle.manifest.proxyGeneration;
  if (bundle.manifest.fixture !== true || authority.status !== "draft" || authority.quality !== "proxy" || authority.recommendedForLive !== false || authority.admission !== "calibration-only") throw new TypeError("reviewed proxy authority is not non-promotable");
}

function expectedBinding(state: GenerationJobState) {
  if (!state.output) throw new TypeError("review state is missing output evidence");
  return {
    tenantId: state.tenantId, frameModelId: state.frameModelId, jobId: state.jobId,
    canonicalInputSha256: state.canonicalInputSha256, reviewHeadEventSha256: state.headEventSha256,
    generatorInputSha256: state.request.generatorInputSha256, output: state.output,
  };
}

export async function createProxyQaDecision(options: {
  jobEvents: readonly unknown[];
  proxyInput: unknown;
  evaluatedAt: string;
  reviewerId: string;
  decision: QaReviewDecision;
  issueCategories: readonly QaIssueCategory[];
  notes: string | null;
  reviewedAt: string;
}): Promise<QaReviewDecisionEvidence> {
  const state = await replayGenerationJobLedger(options.jobEvents, { evaluatedAt: options.evaluatedAt });
  const bundle = await generateProxyBundle(options.proxyInput);
  const input = JSON.parse(bundle.canonicalInput) as ProxyGeneratorInput;
  assertReviewedProxyBinding(state, input, bundle);
  return bindQaReviewDecisionEvidence({
    schemaVersion: 1, sequence: 1, previousDecisionSha256: null, binding: expectedBinding(state),
    reviewerId: options.reviewerId, decision: options.decision, issueCategories: [...options.issueCategories], notes: options.notes,
    requirements: { ...PROXY_UNPROVEN_REQUIREMENTS }, reviewedAt: options.reviewedAt, evaluatedAt: options.evaluatedAt,
  });
}

export async function reviewProxyGenerationOutput(options: {
  jobEvents: readonly unknown[];
  proxyInput: unknown;
  decisions: readonly unknown[];
  evaluatedAt: string;
}): Promise<ProxyQaReviewResult> {
  if (options.decisions.length !== 1) throw new TypeError("proxy QA requires exactly one immutable terminal decision");
  const state = await replayGenerationJobLedger(options.jobEvents, { evaluatedAt: options.evaluatedAt });
  const bundle = await generateProxyBundle(options.proxyInput);
  const input = JSON.parse(bundle.canonicalInput) as ProxyGeneratorInput;
  assertReviewedProxyBinding(state, input, bundle);
  const decision = await verifyQaReviewDecisionEvidence(options.decisions[0]);
  if (decision.evaluatedAt !== options.evaluatedAt) throw new TypeError("decision evaluatedAt must equal the explicit review horizon");
  if (Date.parse(decision.reviewedAt) < Date.parse(state.updatedAt)) throw new TypeError("decision cannot precede reviewed output evidence");
  if (!same(decision.binding, expectedBinding(state))) throw new TypeError("decision cannot substitute job or output identity");
  if (!same(decision.requirements, PROXY_UNPROVEN_REQUIREMENTS)) throw new TypeError("proxy decision cannot fabricate physical, visual, actual-wear, or rights evidence");
  if (decision.decision === "reject") return { decision, outcome: "rejected", assetVersion: null };
  const output = state.output!;
  const assetVersion: ProxyAssetVersionDraft = {
    schemaVersion: 1, id: input.candidate.assetId, tenantId: state.tenantId, frameModelId: state.frameModelId,
    frameVariantId: input.candidate.frameVariantId, version: input.candidate.assetVersion,
    quality: "proxy", generationMethod: "proxy-auto", modelUrl: bundle.manifest.model.url,
    modelSha256: output.modelSha256, modelByteLength: output.modelByteLength,
    manifestUrl: `./${bundle.manifestFileName}`, manifestSha256: output.manifestSha256, manifestByteLength: output.manifestByteLength,
    sourceAssetHashes: [...state.request.sourceAssetSha256s],
    generation: { jobId: state.jobId, canonicalInputSha256: state.canonicalInputSha256, reviewHeadEventSha256: state.headEventSha256, generatorInputSha256: state.request.generatorInputSha256, generator: { ...state.request.generator }, qaDecisionSha256: decision.decisionSha256 },
    attachmentMatrix: [...IDENTITY_MATRIX_4], qualityEnvelope: { maxYawDeg: 0, maxPitchDeg: 0, recommendedForLive: false, scaleConfidence: "high" },
    requirements: { ...PROXY_UNPROVEN_REQUIREMENTS }, fixture: true, admission: "calibration-only", promotable: false, status: "draft",
  };
  return { decision, outcome: "draft-derived", assetVersion };
}
