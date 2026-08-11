import {
  FIT_AUTHORITY_DENIALS, FIT_CANDIDATE_POLICY, FIT_DIMENSIONS, FIT_EXPLANATION_CODES, FIT_MAX_AGE_MS,
  FIT_REFERENCE_GUIDANCE_TEXT, assertFitTimestamp, assertFitTree, canonicalJson, verifyFitIntelligenceInput,
  type FitDimension, type FitExcludedCandidate, type FitExplanationCode, type FitIntelligenceEvaluation,
  type FitProductCandidate, type FitRecommendation, type FitRelationCode,
} from "../../contracts/src/index.js";

function sameScope(left: FitProductCandidate, right: FitProductCandidate): boolean {
  return left.tenantId === right.tenantId && left.siteId === right.siteId && left.environment === right.environment;
}
function productTuple(value: FitProductCandidate): string { return `${value.sku}\u0000${value.frameModelId}\u0000${value.frameVariantId}`; }
function relation(delta: number, threshold: number): FitRelationCode { return delta < -threshold ? "smaller-than-reference" : delta > threshold ? "larger-than-reference" : "comparable-to-reference"; }
function explanationCodes(relations: Readonly<Record<FitDimension, FitRelationCode>>): readonly FitExplanationCode[] {
  const codes: FitExplanationCode[] = ["reference-product-measurements-only", relations.frameWidthMm === "comparable-to-reference" ? "frame-width-comparable" : "frame-width-different"];
  if (relations.lensWidthMm === "comparable-to-reference") codes.push("lens-width-comparable");
  else codes.push("lens-width-different");
  if (relations.bridgeWidthMm === "comparable-to-reference") codes.push("bridge-width-comparable");
  else codes.push("bridge-width-different");
  if (relations.lensHeightMm === "comparable-to-reference") codes.push("lens-height-comparable");
  else codes.push("lens-height-different");
  if (relations.templeLengthMm === "comparable-to-reference") codes.push("temple-length-comparable");
  else codes.push("temple-length-different");
  return Object.freeze(FIT_EXPLANATION_CODES.filter((code) => codes.includes(code)));
}
function compare(reference: FitProductCandidate, candidate: FitProductCandidate): FitRecommendation | null {
  const relations = {} as Record<FitDimension, FitRelationCode>; let score = 0;
  for (const dimension of FIT_DIMENSIONS) {
    const delta = candidate.measurements[dimension] - reference.measurements[dimension]; const threshold = FIT_CANDIDATE_POLICY.thresholdsMm[dimension];
    if (Math.abs(delta) > threshold * FIT_CANDIDATE_POLICY.maximumThresholdMultiple) return null;
    relations[dimension] = relation(delta, threshold);
    score += Math.round((Math.round(Math.abs(delta) * 1_000) * FIT_CANDIDATE_POLICY.weights[dimension]) / threshold);
  }
  const frozenRelations = Object.freeze(relations);
  return Object.freeze({ rank: 0, sku: candidate.sku, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId, candidateSha256: candidate.candidateSha256, measurementSetSha256: candidate.measurementSetSha256, sourceSetSha256: candidate.sourceSetSha256, weightedDistanceMilli: score, relations: frozenRelations, explanationCodes: explanationCodes(frozenRelations), guidanceText: FIT_REFERENCE_GUIDANCE_TEXT, physicalSuitabilityAssessed: false });
}

export async function evaluateFitIntelligence(inputValue: unknown, evaluatedAtValue: unknown): Promise<FitIntelligenceEvaluation> {
  assertFitTree(inputValue); assertFitTimestamp(evaluatedAtValue, "fit evaluatedAt"); const inputSnapshot = structuredClone(inputValue); const evaluatedAt = evaluatedAtValue; const input = await verifyFitIntelligenceInput(inputSnapshot);
  const horizon = Date.parse(evaluatedAt); const created = Date.parse(input.createdAt); if (created > horizon) throw new TypeError("fit input is future-dated"); if (horizon - created > FIT_MAX_AGE_MS) throw new TypeError("fit input is outside the local freshness bound");
  const referenceTuple = productTuple(input.reference); const excluded: FitExcludedCandidate[] = []; const recommendations: FitRecommendation[] = [];
  const scopeSkus = new Map<string, string>([[input.reference.sku, `${input.reference.frameModelId}\u0000${input.reference.frameVariantId}`]]); const scopeVariants = new Map<string, string>([[input.reference.frameVariantId, `${input.reference.frameModelId}\u0000${input.reference.sku}`]]);
  for (const candidate of input.candidates) {
    if (!sameScope(input.reference, candidate)) throw new TypeError("fit candidate crosses tenant, site, or environment scope");
    const skuBinding = `${candidate.frameModelId}\u0000${candidate.frameVariantId}`; const priorSku = scopeSkus.get(candidate.sku); if (priorSku !== undefined && priorSku !== skuBinding) throw new TypeError("fit candidate relabels SKU identity across the reference"); scopeSkus.set(candidate.sku, skuBinding);
    const variantBinding = `${candidate.frameModelId}\u0000${candidate.sku}`; const priorVariant = scopeVariants.get(candidate.frameVariantId); if (priorVariant !== undefined && priorVariant !== variantBinding) throw new TypeError("fit candidate relabels variant identity across the reference"); scopeVariants.set(candidate.frameVariantId, variantBinding);
    if (candidate.candidateSha256 === input.reference.candidateSha256 || productTuple(candidate) === referenceTuple) continue;
    if (candidate.measurementVerification !== "verified-physical-mm") { excluded.push(Object.freeze({ candidateSha256: candidate.candidateSha256, sku: candidate.sku, code: "candidate-measurements-unverified" })); continue; }
    const compared = compare(input.reference, candidate); if (compared === null) { excluded.push(Object.freeze({ candidateSha256: candidate.candidateSha256, sku: candidate.sku, code: "candidate-outside-local-policy" })); continue; } recommendations.push(compared);
  }
  recommendations.sort((left, right) => left.weightedDistanceMilli - right.weightedDistanceMilli || `${left.sku}\u0000${left.frameModelId}\u0000${left.frameVariantId}`.localeCompare(`${right.sku}\u0000${right.frameModelId}\u0000${right.frameVariantId}`) || left.candidateSha256.localeCompare(right.candidateSha256)); excluded.sort((left, right) => left.candidateSha256.localeCompare(right.candidateSha256));
  const available = input.reference.measurementVerification === "verified-physical-mm";
  const ranked = available ? recommendations.slice(0, FIT_CANDIDATE_POLICY.topN).map((item, index) => Object.freeze({ ...item, rank: index + 1 })) : [];
  return Object.freeze({
    schemaVersion: 1, type: "fit-intelligence.local-evaluation", input, evaluatedAt,
    status: available ? "reference-guidance-available" : "manual-or-unavailable",
    unavailableCode: available ? null : "reference-measurements-unverified", evidenceStatus: "measurement-source-catalog-digest-references-unverified", guidanceText: FIT_REFERENCE_GUIDANCE_TEXT,
    faceRelativeWidthGuidance: Object.freeze({ status: "deferred-calibrated-physical-device-evidence-required", available: false }),
    recommendations: Object.freeze(ranked), excludedCandidates: Object.freeze(available ? excluded : input.candidates.filter((item) => item.candidateSha256 !== input.reference.candidateSha256 && productTuple(item) !== referenceTuple).map((item) => Object.freeze({ candidateSha256: item.candidateSha256, sku: item.sku, code: "reference-measurements-unverified" as const })).sort((a, b) => a.candidateSha256.localeCompare(b.candidateSha256))),
    outcomeMeasurement: Object.freeze({ status: "pending-external", causalSemanticsDefined: false, measured: false, purchaseInferredFromInteraction: false }),
    operationalStatus: "local-preparation-only", g7Ready: false, authority: FIT_AUTHORITY_DENIALS,
  });
}

export async function verifyFitIntelligenceEvaluation(value: unknown): Promise<FitIntelligenceEvaluation> {
  assertFitTree(value); const snapshot = structuredClone(value) as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1 || snapshot.type !== "fit-intelligence.local-evaluation") throw new TypeError("fit evaluation version or type is unsupported");
  const replayed = await evaluateFitIntelligence(snapshot.input, snapshot.evaluatedAt); if (canonicalJson(snapshot) !== canonicalJson(replayed)) throw new TypeError("fit evaluation is inconsistent with deterministic replay"); return replayed;
}
