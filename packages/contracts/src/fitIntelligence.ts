import { canonicalJson, sha256Hex } from "./generationJob.js";

export const FIT_POLICY_VERSION = "g7-a-local-v1" as const;
export const FIT_MAX_CANDIDATES = 100;
export const FIT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const FIT_MAX_COMMAND_BYTES = 262_144;
export const FIT_CANDIDATE_POLICY = Object.freeze({
  topN: 5,
  maximumThresholdMultiple: 2,
  thresholdsMm: Object.freeze({ frameWidthMm: 3, lensWidthMm: 2, bridgeWidthMm: 2, lensHeightMm: 2, templeLengthMm: 5 }),
  weights: Object.freeze({ frameWidthMm: 40, lensWidthMm: 20, bridgeWidthMm: 15, lensHeightMm: 10, templeLengthMm: 15 }),
  status: "non-production-candidate-policy-external-validation-pending",
} as const);
export const FIT_DIMENSIONS = Object.freeze(["frameWidthMm", "lensWidthMm", "bridgeWidthMm", "lensHeightMm", "templeLengthMm"] as const);
export const FIT_RELATION_CODES = Object.freeze(["smaller-than-reference", "comparable-to-reference", "larger-than-reference"] as const);
export const FIT_EXPLANATION_CODES = Object.freeze([
  "reference-product-measurements-only", "frame-width-comparable", "frame-width-different",
  "lens-width-comparable", "lens-width-different", "bridge-width-comparable", "bridge-width-different",
  "lens-height-comparable", "lens-height-different", "temple-length-comparable", "temple-length-different",
] as const);
export const FIT_UNAVAILABLE_CODES = Object.freeze(["reference-measurements-unverified", "candidate-measurements-unverified", "candidate-outside-local-policy"] as const);
export const FIT_REFERENCE_GUIDANCE_TEXT = "Compared with the reference product's listed frame measurements. This is product-size guidance only; personal suitability is not assessed." as const;

export type FitDimension = (typeof FIT_DIMENSIONS)[number];
export type FitRelationCode = (typeof FIT_RELATION_CODES)[number];
export type FitExplanationCode = (typeof FIT_EXPLANATION_CODES)[number];
export type FitUnavailableCode = (typeof FIT_UNAVAILABLE_CODES)[number];
export type FitMeasurements = Readonly<Record<FitDimension, number>>;

export type FitProductCandidate = Readonly<{
  schemaVersion: 1; type: "fit-intelligence.product-candidate"; tenantId: string; siteId: string; environment: "production";
  sku: string; frameModelId: string; frameVariantId: string; measurementSetSha256: string; sourceSetSha256: string;
  measurementVerification: "verified-physical-mm" | "unverified"; measurements: FitMeasurements;
  catalogBindingStatus: "exact-scope-candidate-unverified"; candidateSha256: string;
}>;
export type FitIntelligenceInput = Readonly<{
  schemaVersion: 1; type: "fit-intelligence.local-input"; requestId: string; idempotencyKey: string;
  policyVersion: typeof FIT_POLICY_VERSION; createdAt: string; tenantId: string; siteId: string; environment: "production";
  reference: FitProductCandidate; candidates: readonly FitProductCandidate[]; inputSha256: string;
}>;
export type FitRecommendation = Readonly<{
  rank: number; sku: string; frameModelId: string; frameVariantId: string; candidateSha256: string;
  measurementSetSha256: string; sourceSetSha256: string; weightedDistanceMilli: number;
  relations: Readonly<Record<FitDimension, FitRelationCode>>; explanationCodes: readonly FitExplanationCode[];
  guidanceText: typeof FIT_REFERENCE_GUIDANCE_TEXT; physicalSuitabilityAssessed: false;
}>;
export type FitExcludedCandidate = Readonly<{ candidateSha256: string; sku: string; code: FitUnavailableCode }>;
export type FitAuthorityDenials = Readonly<{
  recommendationPublication: false; personalization: false; physicalSuitabilityGuarantee: false; medicalOrBiometricInference: false;
  physicalMeasurementAuthority: false; sourceAuthority: false; catalogAuthority: false; catalogMutation: false; analyticsWrite: false; remoteWrite: false; g1Evidence: false; g2Evidence: false; g5Evidence: false;
  g6Evidence: false; g7Evidence: false;
}>;
export const FIT_AUTHORITY_DENIALS: FitAuthorityDenials = Object.freeze({
  recommendationPublication: false, personalization: false, physicalSuitabilityGuarantee: false, medicalOrBiometricInference: false,
  physicalMeasurementAuthority: false, sourceAuthority: false, catalogAuthority: false, catalogMutation: false, analyticsWrite: false, remoteWrite: false, g1Evidence: false, g2Evidence: false, g5Evidence: false,
  g6Evidence: false, g7Evidence: false,
});
export type FitIntelligenceEvaluation = Readonly<{
  schemaVersion: 1; type: "fit-intelligence.local-evaluation"; input: FitIntelligenceInput; evaluatedAt: string;
  status: "reference-guidance-available" | "manual-or-unavailable"; unavailableCode: "reference-measurements-unverified" | null;
  evidenceStatus: "measurement-source-catalog-digest-references-unverified";
  guidanceText: typeof FIT_REFERENCE_GUIDANCE_TEXT;
  faceRelativeWidthGuidance: Readonly<{ status: "deferred-calibrated-physical-device-evidence-required"; available: false }>;
  recommendations: readonly FitRecommendation[]; excludedCandidates: readonly FitExcludedCandidate[];
  outcomeMeasurement: Readonly<{ status: "pending-external"; causalSemanticsDefined: false; measured: false; purchaseInferredFromInteraction: false }>;
  operationalStatus: "local-preparation-only"; g7Ready: false; authority: FitAuthorityDenials;
}>;
export type FitIntelligenceCommand = Readonly<Omit<FitIntelligenceEvaluation, "type"> & {
  type: "fit-intelligence.local-command"; byteLength: number; commandSha256: string; commandIdempotencyKey: string;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/; const ZERO = "0".repeat(64);
const MIN_TIME = Date.parse("2020-01-01T00:00:00.000Z"); const MAX_TIME = Date.parse("2100-01-01T00:00:00.000Z");
const BOUNDS: Readonly<Record<FitDimension, readonly [number, number]>> = Object.freeze({
  frameWidthMm: Object.freeze([60, 220] as const), lensWidthMm: Object.freeze([20, 100] as const), bridgeWidthMm: Object.freeze([5, 40] as const),
  lensHeightMm: Object.freeze([15, 80] as const), templeLengthMm: Object.freeze([80, 200] as const),
});

function plain(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} must contain enumerable data properties only`);
}
function dense(value: unknown, max: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Object.keys(value).length !== value.length) throw new TypeError(`${label} must be a bounded dense standard array`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new TypeError(`${label} must contain data properties only`);
}
function tree(value: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (value === null || typeof value !== "object") return;
  if (depth > 12 || seen.has(value)) throw new TypeError("fit intelligence input must be an acyclic bounded data tree");
  seen.add(value); if (Array.isArray(value)) dense(value, FIT_MAX_CANDIDATES, "fit intelligence array"); else plain(value, "fit intelligence object");
  for (const child of Object.values(value as Record<string, unknown>)) tree(child, seen, depth + 1); seen.delete(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`); }
function id(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !ID.test(value) || /^(?:https?|file|localraw):/i.test(value)) throw new TypeError(`${label} must be a bounded non-resource identifier`); }
function digest(value: unknown, label: string, sentinel = false): asserts value is string { if (typeof value !== "string" || !SHA.test(value) || (!sentinel && value === ZERO)) throw new TypeError(`${label} must be a nonzero lowercase SHA-256 digest`); }
function timestamp(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a millisecond UTC timestamp`); const epoch = Date.parse(value); if (!Number.isFinite(epoch) || epoch < MIN_TIME || epoch > MAX_TIME || new Date(epoch).toISOString() !== value) throw new TypeError(`${label} must be a real canonical UTC instant`); }
function millimetres(value: unknown, dimension: FitDimension): asserts value is number { const [min, max] = BOUNDS[dimension]; if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || Math.round(value * 1_000) !== value * 1_000) throw new TypeError(`${dimension} must be explicit bounded millimetres with at most three decimals`); }
function measurements(value: unknown): FitMeasurements { plain(value, "measurements"); exact(value, FIT_DIMENSIONS, "measurements"); for (const dimension of FIT_DIMENSIONS) millimetres(value[dimension], dimension); return Object.freeze(Object.fromEntries(FIT_DIMENSIONS.map((dimension) => [dimension, value[dimension]])) as unknown as FitMeasurements); }
function productKey(value: Pick<FitProductCandidate, "sku" | "frameModelId" | "frameVariantId">): string { return `${value.sku}\u0000${value.frameModelId}\u0000${value.frameVariantId}`; }

function parseCandidateInternal(value: unknown, sentinel: boolean): FitProductCandidate {
  tree(value); plain(value, "fit product candidate"); exact(value, ["schemaVersion", "type", "tenantId", "siteId", "environment", "sku", "frameModelId", "frameVariantId", "measurementSetSha256", "sourceSetSha256", "measurementVerification", "measurements", "catalogBindingStatus", "candidateSha256"], "fit product candidate");
  if (value.schemaVersion !== 1 || value.type !== "fit-intelligence.product-candidate" || value.environment !== "production") throw new TypeError("fit product candidate version, type, or environment is unsupported");
  for (const key of ["tenantId", "siteId", "sku", "frameModelId", "frameVariantId"] as const) id(value[key], `candidate ${key}`);
  digest(value.measurementSetSha256, "measurement set digest"); digest(value.sourceSetSha256, "source set digest"); digest(value.candidateSha256, "candidate digest", sentinel);
  if (value.measurementVerification !== "verified-physical-mm" && value.measurementVerification !== "unverified") throw new TypeError("measurement verification is unsupported");
  if (value.catalogBindingStatus !== "exact-scope-candidate-unverified") throw new TypeError("catalog binding cannot claim production authority");
  return Object.freeze({ schemaVersion: 1, type: "fit-intelligence.product-candidate", tenantId: value.tenantId as string, siteId: value.siteId as string, environment: "production", sku: value.sku as string, frameModelId: value.frameModelId as string, frameVariantId: value.frameVariantId as string, measurementSetSha256: value.measurementSetSha256 as string, sourceSetSha256: value.sourceSetSha256 as string, measurementVerification: value.measurementVerification, measurements: measurements(value.measurements), catalogBindingStatus: "exact-scope-candidate-unverified", candidateSha256: value.candidateSha256 as string });
}
export function parseFitProductCandidate(value: unknown): FitProductCandidate { return parseCandidateInternal(value, false); }
function candidateBody(value: FitProductCandidate): unknown { const { candidateSha256: _, ...body } = value; return body; }
export async function bindFitProductCandidate(value: Omit<FitProductCandidate, "candidateSha256">): Promise<FitProductCandidate> { tree(value); const snapshot = structuredClone(value); const parsed = parseCandidateInternal({ ...snapshot, candidateSha256: ZERO }, true); return Object.freeze({ ...parsed, candidateSha256: await sha256Hex(canonicalJson(candidateBody(parsed))) }); }
export async function verifyFitProductCandidate(value: unknown): Promise<FitProductCandidate> { const parsed = parseFitProductCandidate(value); if (await sha256Hex(canonicalJson(candidateBody(parsed))) !== parsed.candidateSha256) throw new TypeError("fit product candidate digest is inconsistent"); return parsed; }

function parseInputInternal(value: unknown, sentinel: boolean): FitIntelligenceInput {
  tree(value); plain(value, "fit intelligence input"); exact(value, ["schemaVersion", "type", "requestId", "idempotencyKey", "policyVersion", "createdAt", "tenantId", "siteId", "environment", "reference", "candidates", "inputSha256"], "fit intelligence input");
  if (value.schemaVersion !== 1 || value.type !== "fit-intelligence.local-input" || value.policyVersion !== FIT_POLICY_VERSION || value.environment !== "production") throw new TypeError("fit intelligence input version, policy, type, or environment is unsupported");
  id(value.requestId, "fit requestId"); id(value.idempotencyKey, "fit idempotencyKey"); id(value.tenantId, "fit tenantId"); id(value.siteId, "fit siteId"); timestamp(value.createdAt, "fit createdAt"); digest(value.inputSha256, "fit input digest", sentinel);
  const reference = parseFitProductCandidate(value.reference); dense(value.candidates, FIT_MAX_CANDIDATES, "fit candidates"); const candidates = value.candidates.map(parseFitProductCandidate);
  if (reference.tenantId !== value.tenantId || reference.siteId !== value.siteId || reference.environment !== value.environment) throw new TypeError("fit reference crosses input scope");
  const modelMeasurementBinding = (item: FitProductCandidate) => canonicalJson({ measurementSetSha256: item.measurementSetSha256, measurementVerification: item.measurementVerification, measurements: item.measurements });
  const seen = new Set<string>(); const digests = new Set<string>(); const skus = new Map<string, string>([[reference.sku, `${reference.frameModelId}\u0000${reference.frameVariantId}`]]); const variants = new Map<string, string>([[reference.frameVariantId, `${reference.frameModelId}\u0000${reference.sku}`]]); const models = new Map<string, string>([[reference.frameModelId, modelMeasurementBinding(reference)]]);
  for (const candidate of candidates) {
    if (candidate.tenantId !== value.tenantId || candidate.siteId !== value.siteId || candidate.environment !== value.environment) throw new TypeError("fit candidate crosses input scope");
    if (candidate.candidateSha256 === reference.candidateSha256 || productKey(candidate) === productKey(reference)) throw new TypeError("fit candidates must exclude the exact reference product");
    const key = productKey(candidate); if (seen.has(key) || digests.has(candidate.candidateSha256)) throw new TypeError("fit candidates must be deduplicated without digest relabeling"); seen.add(key); digests.add(candidate.candidateSha256);
    const skuBinding = `${candidate.frameModelId}\u0000${candidate.frameVariantId}`; const priorSku = skus.get(candidate.sku); if (priorSku !== undefined && priorSku !== skuBinding) throw new TypeError("fit SKU identity is relabelled"); skus.set(candidate.sku, skuBinding);
    const variantBinding = `${candidate.frameModelId}\u0000${candidate.sku}`; const priorVariant = variants.get(candidate.frameVariantId); if (priorVariant !== undefined && priorVariant !== variantBinding) throw new TypeError("fit variant identity is relabelled"); variants.set(candidate.frameVariantId, variantBinding);
    const modelBinding = modelMeasurementBinding(candidate); const priorModel = models.get(candidate.frameModelId); if (priorModel !== undefined && priorModel !== modelBinding) throw new TypeError("fit model measurement identity is relabelled"); models.set(candidate.frameModelId, modelBinding);
  }
  return Object.freeze({ schemaVersion: 1, type: "fit-intelligence.local-input", requestId: value.requestId, idempotencyKey: value.idempotencyKey, policyVersion: FIT_POLICY_VERSION, createdAt: value.createdAt, tenantId: value.tenantId, siteId: value.siteId, environment: "production", reference, candidates: Object.freeze(candidates), inputSha256: value.inputSha256 as string });
}
function inputBody(value: FitIntelligenceInput): unknown { const { requestId: _, idempotencyKey: _key, inputSha256: _digest, ...body } = value; return body; }
export function parseFitIntelligenceInput(value: unknown): FitIntelligenceInput { return parseInputInternal(value, false); }
export async function bindFitIntelligenceInput(value: Omit<FitIntelligenceInput, "requestId" | "idempotencyKey" | "inputSha256">): Promise<FitIntelligenceInput> {
  tree(value); const snapshot = structuredClone(value); plain(snapshot, "fit input draft"); dense(snapshot.candidates, FIT_MAX_CANDIDATES, "fit candidates"); snapshot.candidates.sort((a, b) => { const left = parseFitProductCandidate(a); const right = parseFitProductCandidate(b); return productKey(left).localeCompare(productKey(right)); });
  const parsed = parseInputInternal({ ...snapshot, requestId: "pending", idempotencyKey: "pending", inputSha256: ZERO }, true); const inputSha256 = await sha256Hex(canonicalJson(inputBody(parsed))); return Object.freeze({ ...parsed, requestId: `fir_${inputSha256}`, idempotencyKey: `firv1_${inputSha256}`, inputSha256 });
}
export async function verifyFitIntelligenceInput(value: unknown): Promise<FitIntelligenceInput> { const parsed = parseFitIntelligenceInput(value); const sorted = [...parsed.candidates].sort((a, b) => productKey(a).localeCompare(productKey(b))); if (canonicalJson(sorted) !== canonicalJson(parsed.candidates)) throw new TypeError("fit candidates are not in canonical order"); await Promise.all([verifyFitProductCandidate(parsed.reference), ...parsed.candidates.map(verifyFitProductCandidate)]); const hash = await sha256Hex(canonicalJson(inputBody(parsed))); if (hash !== parsed.inputSha256 || parsed.requestId !== `fir_${hash}` || parsed.idempotencyKey !== `firv1_${hash}`) throw new TypeError("fit intelligence input digest or identity is inconsistent"); return parsed; }

export function assertFitTimestamp(value: unknown, label: string): asserts value is string { timestamp(value, label); }
export function assertFitTree(value: unknown): void { tree(value); }
