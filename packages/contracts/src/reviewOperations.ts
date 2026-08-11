import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "./generationJob.js";

export const REVIEW_POLICY_VERSION = "f3-local-v1" as const;
export const REVIEW_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const REVIEW_MAX_CORRECTION_ATTEMPTS = 3;
export const REVIEW_MAX_FINDINGS = 16;
export const REVIEW_QUEUE_MAX_ITEMS = 200;
export const REVIEW_QUEUE_MAX_BYTES = 524_288;
export const REVIEW_FINDING_CATEGORIES = Object.freeze([
  "ATTACHMENT_CORRECTION", "DIMENSIONS_CORRECTION", "GEOMETRY_CORRECTION",
  "MATERIAL_HUMAN_JUDGMENT", "UNSUPPORTED_CONSTRUCTION", "EVIDENCE_INCOMPLETE",
  "IDENTITY_INTEGRITY_FAILURE", "OUTPUT_INTEGRITY_FAILURE",
] as const);
export const REVIEW_OUTCOMES = Object.freeze(["auto-review-candidate", "correction-required", "manual-required", "rejected"] as const);
export const REVIEW_REASON_CODES = Object.freeze([...REVIEW_FINDING_CATEGORIES, "AUTO_CHECKS_CLEAR", "CORRECTION_ATTEMPTS_EXHAUSTED"] as const);
export type ReviewFindingCategory = (typeof REVIEW_FINDING_CATEGORIES)[number];
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

export type ReviewBinding = Readonly<{
  tenantId: string; siteId: string; environment: "production"; sku: string;
  frameModelId: string; frameVariantId: string; jobId: string;
  canonicalInputSha256: string; generatorInputSha256: string; reviewHeadEventSha256: string;
  output: GenerationJobOutputEvidence; assetId: string; assetVersion: number;
  sourceEvidenceCandidateSha256: string; captureEvidenceCandidateSha256: string;
  demandQueueCommandCandidateSha256: string | null; batchCaptureLogCandidateSha256: string | null;
  provenanceStatus: "candidate-references-unverified";
  reviewPolicyVersion: typeof REVIEW_POLICY_VERSION;
}>;
export type ReviewWorkItem = Readonly<{
  schemaVersion: 1; type: "review.work-item"; workItemId: string; createdAt: string;
  maxCorrectionAttempts: number; binding: ReviewBinding; workItemSha256: string;
}>;
export type ReviewEvidenceEvent = Readonly<{
  schemaVersion: 1; type: "review.evidence"; eventId: string; sequence: number; occurredAt: string;
  previousEvidenceSha256: string | null; workItemSha256: string; binding: ReviewBinding;
  correctionAttempt: number; evaluatorId: string; evaluatorVersion: string;
  evaluationAuthority: "local-candidate-unverified";
  findings: readonly ReviewFindingCategory[]; evidenceSha256: string;
}>;
export type ReviewAuthorityDenials = Readonly<{
  qaApproved: false; assetVersionPromoted: false; recommendedForLive: false;
  activeDeployment: false; publication: false; g1Evidence: false; g2Evidence: false; g5Evidence: false;
}>;
export type ReviewQueueItem = Readonly<{
  position: number; workItem: ReviewWorkItem; evidenceChain: readonly ReviewEvidenceEvent[];
  outcome: ReviewOutcome; severity: 0 | 1 | 2 | 3; reasons: readonly ReviewReasonCode[]; freshness: "fresh";
}>;
export type ReviewEvidenceChainState = Readonly<{
  workItem: ReviewWorkItem; evidenceChain: readonly ReviewEvidenceEvent[]; outcome: ReviewOutcome;
  severity: 0 | 1 | 2 | 3; reasons: readonly ReviewReasonCode[]; correctionAttempt: number;
  headEvidenceSha256: string; evaluatedAt: string; terminal: boolean; replayCount: number;
}>;
export type ReviewQueueCommand = Readonly<{
  schemaVersion: 1; type: "review.queue-command"; tenantId: string; siteId: string;
  environment: "production"; asOf: string; policyVersion: typeof REVIEW_POLICY_VERSION;
  itemCount: number; byteLength: number; commandSha256: string; idempotencyKey: string;
  operationalStatus: "local-preparation-only"; g5Ready: false; authority: ReviewAuthorityDenials;
  items: readonly ReviewQueueItem[];
}>;
export type ReviewQueueBuildInput = Readonly<{
  schemaVersion: 1; type: "review.queue-build"; tenantId: string; siteId: string;
  environment: "production"; asOf: string; workItems: readonly ReviewWorkItem[];
  evidence: readonly ReviewEvidenceEvent[];
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const MIN_TIME = Date.parse("2020-01-01T00:00:00.000Z");
const MAX_TIME = Date.parse("2100-01-01T00:00:00.000Z");
const ZERO = "0".repeat(64);
export const REVIEW_AUTHORITY_DENIALS: ReviewAuthorityDenials = Object.freeze({
  qaApproved: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false,
  publication: false, g1Evidence: false, g2Evidence: false, g5Evidence: false,
});

function plain(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} must contain enumerable data properties only`);
}
function dense(value: unknown, maximum: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.keys(value).length !== value.length) throw new TypeError(`${label} must be a bounded dense standard array`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new TypeError(`${label} must contain data properties only`);
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`); }
function id(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} must be a bounded identifier`); }
function hash(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`); }
function externalHash(value: unknown, label: string): asserts value is string { hash(value, label); if (value === ZERO) throw new TypeError(`${label} must not be the all-zero sentinel`); }
function integer(value: unknown, minimum: number, maximum: number, label: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(`${label} must be a bounded integer`); }
function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a millisecond UTC timestamp`);
  const epoch = Date.parse(value); if (!Number.isFinite(epoch) || epoch < MIN_TIME || epoch > MAX_TIME) throw new TypeError(`${label} is outside the supported range`);
}
function nullableExternalHash(value: unknown, label: string): asserts value is string | null { if (value !== null) externalHash(value, label); }
function output(value: unknown): GenerationJobOutputEvidence {
  plain(value, "review output"); exact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], "review output");
  externalHash(value.manifestSha256, "review output manifestSha256"); externalHash(value.modelSha256, "review output modelSha256");
  integer(value.manifestByteLength, 1, 1_073_741_824, "review output manifestByteLength"); integer(value.modelByteLength, 1, 1_073_741_824, "review output modelByteLength");
  return Object.freeze({ manifestSha256: value.manifestSha256, modelSha256: value.modelSha256, manifestByteLength: value.manifestByteLength, modelByteLength: value.modelByteLength });
}
export function parseReviewBinding(value: unknown): ReviewBinding {
  plain(value, "review binding"); exact(value, ["tenantId", "siteId", "environment", "sku", "frameModelId", "frameVariantId", "jobId", "canonicalInputSha256", "generatorInputSha256", "reviewHeadEventSha256", "output", "assetId", "assetVersion", "sourceEvidenceCandidateSha256", "captureEvidenceCandidateSha256", "demandQueueCommandCandidateSha256", "batchCaptureLogCandidateSha256", "provenanceStatus", "reviewPolicyVersion"], "review binding");
  for (const key of ["tenantId", "siteId", "sku", "frameModelId", "frameVariantId", "jobId", "assetId"] as const) id(value[key], `review binding ${key}`);
  if (value.environment !== "production") throw new TypeError("review binding environment must be production");
  for (const key of ["canonicalInputSha256", "generatorInputSha256", "reviewHeadEventSha256", "sourceEvidenceCandidateSha256", "captureEvidenceCandidateSha256"] as const) externalHash(value[key], `review binding ${key}`);
  nullableExternalHash(value.demandQueueCommandCandidateSha256, "review binding demandQueueCommandCandidateSha256"); nullableExternalHash(value.batchCaptureLogCandidateSha256, "review binding batchCaptureLogCandidateSha256");
  integer(value.assetVersion, 1, 1_000_000, "review binding assetVersion"); if (value.provenanceStatus !== "candidate-references-unverified") throw new TypeError("review binding provenance status cannot claim verification"); if (value.reviewPolicyVersion !== REVIEW_POLICY_VERSION) throw new TypeError("review binding policy is unsupported");
  return Object.freeze({ tenantId: value.tenantId as string, siteId: value.siteId as string, environment: "production", sku: value.sku as string, frameModelId: value.frameModelId as string, frameVariantId: value.frameVariantId as string, jobId: value.jobId as string, canonicalInputSha256: value.canonicalInputSha256 as string, generatorInputSha256: value.generatorInputSha256 as string, reviewHeadEventSha256: value.reviewHeadEventSha256 as string, output: output(value.output), assetId: value.assetId as string, assetVersion: value.assetVersion, sourceEvidenceCandidateSha256: value.sourceEvidenceCandidateSha256 as string, captureEvidenceCandidateSha256: value.captureEvidenceCandidateSha256 as string, demandQueueCommandCandidateSha256: value.demandQueueCommandCandidateSha256 as string | null, batchCaptureLogCandidateSha256: value.batchCaptureLogCandidateSha256 as string | null, provenanceStatus: "candidate-references-unverified", reviewPolicyVersion: REVIEW_POLICY_VERSION });
}
function parseReviewWorkItemInternal(value: unknown, allowDigestSentinel: boolean): ReviewWorkItem {
  plain(value, "review work item"); exact(value, ["schemaVersion", "type", "workItemId", "createdAt", "maxCorrectionAttempts", "binding", "workItemSha256"], "review work item");
  if (value.schemaVersion !== 1 || value.type !== "review.work-item") throw new TypeError("review work item version or type is unsupported"); id(value.workItemId, "review work item id"); timestamp(value.createdAt, "review work item createdAt"); integer(value.maxCorrectionAttempts, 1, REVIEW_MAX_CORRECTION_ATTEMPTS, "review work item maxCorrectionAttempts"); hash(value.workItemSha256, "review work item digest"); if (!allowDigestSentinel && value.workItemSha256 === ZERO) throw new TypeError("review work item digest must not be the all-zero sentinel");
  return Object.freeze({ schemaVersion: 1, type: "review.work-item", workItemId: value.workItemId, createdAt: value.createdAt, maxCorrectionAttempts: value.maxCorrectionAttempts, binding: parseReviewBinding(value.binding), workItemSha256: value.workItemSha256 });
}
export function parseReviewWorkItem(value: unknown): ReviewWorkItem { return parseReviewWorkItemInternal(value, false); }
export async function bindReviewWorkItem(value: Omit<ReviewWorkItem, "workItemSha256">): Promise<ReviewWorkItem> {
  const parsed = parseReviewWorkItemInternal({ ...structuredClone(value), workItemSha256: ZERO }, true); const { workItemSha256: _ignored, ...body } = parsed;
  return Object.freeze({ ...body, workItemSha256: await sha256Hex(canonicalJson(body)) });
}
export async function verifyReviewWorkItem(value: unknown): Promise<ReviewWorkItem> { const parsed = parseReviewWorkItem(value); const { workItemSha256, ...body } = parsed; if (await sha256Hex(canonicalJson(body)) !== workItemSha256) throw new TypeError("review work item digest does not match canonical bytes"); return parsed; }

function parseReviewEvidenceEventInternal(value: unknown, allowDigestSentinel: boolean): ReviewEvidenceEvent {
  plain(value, "review evidence"); exact(value, ["schemaVersion", "type", "eventId", "sequence", "occurredAt", "previousEvidenceSha256", "workItemSha256", "binding", "correctionAttempt", "evaluatorId", "evaluatorVersion", "evaluationAuthority", "findings", "evidenceSha256"], "review evidence");
  if (value.schemaVersion !== 1 || value.type !== "review.evidence") throw new TypeError("review evidence version or type is unsupported"); id(value.eventId, "review evidence eventId"); integer(value.sequence, 1, REVIEW_MAX_CORRECTION_ATTEMPTS + 1, "review evidence sequence"); timestamp(value.occurredAt, "review evidence occurredAt"); if (value.previousEvidenceSha256 !== null) externalHash(value.previousEvidenceSha256, "review evidence previous digest"); externalHash(value.workItemSha256, "review evidence work item digest"); integer(value.correctionAttempt, 0, REVIEW_MAX_CORRECTION_ATTEMPTS, "review evidence correctionAttempt"); id(value.evaluatorId, "review evidence evaluatorId"); id(value.evaluatorVersion, "review evidence evaluatorVersion"); if (value.evaluationAuthority !== "local-candidate-unverified") throw new TypeError("review evidence cannot claim evaluator authority"); hash(value.evidenceSha256, "review evidence digest"); if (!allowDigestSentinel && value.evidenceSha256 === ZERO) throw new TypeError("review evidence digest must not be the all-zero sentinel"); dense(value.findings, REVIEW_MAX_FINDINGS, "review evidence findings");
  const findings = value.findings.map((item) => { if (!REVIEW_FINDING_CATEGORIES.includes(item as ReviewFindingCategory)) throw new TypeError("review evidence finding is unsupported"); return item as ReviewFindingCategory; });
  if (new Set(findings).size !== findings.length || [...findings].sort().some((item, index) => item !== findings[index])) throw new TypeError("review evidence findings must be unique and sorted");
  return Object.freeze({ schemaVersion: 1, type: "review.evidence", eventId: value.eventId, sequence: value.sequence, occurredAt: value.occurredAt, previousEvidenceSha256: value.previousEvidenceSha256, workItemSha256: value.workItemSha256, binding: parseReviewBinding(value.binding), correctionAttempt: value.correctionAttempt, evaluatorId: value.evaluatorId, evaluatorVersion: value.evaluatorVersion, evaluationAuthority: "local-candidate-unverified", findings: Object.freeze(findings), evidenceSha256: value.evidenceSha256 });
}
export function parseReviewEvidenceEvent(value: unknown): ReviewEvidenceEvent { return parseReviewEvidenceEventInternal(value, false); }
export async function bindReviewEvidenceEvent(value: Omit<ReviewEvidenceEvent, "evidenceSha256">): Promise<ReviewEvidenceEvent> { const parsed = parseReviewEvidenceEventInternal({ ...structuredClone(value), evidenceSha256: ZERO }, true); const { evidenceSha256: _ignored, ...body } = parsed; return Object.freeze({ ...body, evidenceSha256: await sha256Hex(canonicalJson(body)) }); }
export async function verifyReviewEvidenceEvent(value: unknown): Promise<ReviewEvidenceEvent> { const parsed = parseReviewEvidenceEvent(value); const { evidenceSha256, ...body } = parsed; if (await sha256Hex(canonicalJson(body)) !== evidenceSha256) throw new TypeError("review evidence digest does not match canonical bytes"); return parsed; }

const CORRECTION_FINDINGS = new Set<ReviewFindingCategory>(["ATTACHMENT_CORRECTION", "DIMENSIONS_CORRECTION", "GEOMETRY_CORRECTION"]);
const MANUAL_FINDINGS = new Set<ReviewFindingCategory>(["MATERIAL_HUMAN_JUDGMENT", "UNSUPPORTED_CONSTRUCTION", "EVIDENCE_INCOMPLETE"]);
const REJECT_FINDINGS = new Set<ReviewFindingCategory>(["IDENTITY_INTEGRITY_FAILURE", "OUTPUT_INTEGRITY_FAILURE"]);
function classifyReview(findings: readonly ReviewFindingCategory[], attempt: number, maximum: number): { outcome: ReviewOutcome; severity: 0 | 1 | 2 | 3; reasons: ReviewReasonCode[]; terminal: boolean } {
  if (findings.some((item) => REJECT_FINDINGS.has(item))) return { outcome: "rejected", severity: 3, reasons: [...findings], terminal: true };
  if (findings.some((item) => MANUAL_FINDINGS.has(item))) return { outcome: "manual-required", severity: 2, reasons: [...findings], terminal: true };
  if (findings.some((item) => CORRECTION_FINDINGS.has(item))) {
    if (attempt >= maximum) return { outcome: "manual-required", severity: 2, reasons: [...findings, "CORRECTION_ATTEMPTS_EXHAUSTED"].sort() as ReviewReasonCode[], terminal: true };
    return { outcome: "correction-required", severity: 1, reasons: [...findings], terminal: false };
  }
  return { outcome: "auto-review-candidate", severity: 0, reasons: ["AUTO_CHECKS_CLEAR"], terminal: true };
}
export async function reduceReviewEvidenceChain(workItemValue: unknown, eventValues: unknown, asOf: string): Promise<ReviewEvidenceChainState> {
  const workSnapshot = parseReviewWorkItem(workItemValue); dense(eventValues, REVIEW_MAX_CORRECTION_ATTEMPTS + 1, "review evidence chain"); const eventSnapshots = eventValues.map(parseReviewEvidenceEvent); timestamp(asOf, "review evidence horizon");
  const [item, ...parsed] = await Promise.all([verifyReviewWorkItem(workSnapshot), ...eventSnapshots.map(verifyReviewEvidenceEvent)]); const horizon = Date.parse(asOf); const byId = new Map<string, string>(); const unique: ReviewEvidenceEvent[] = []; let replayCount = 0;
  for (const event of parsed) { const fingerprint = canonicalJson(event); const prior = byId.get(event.eventId); if (prior !== undefined) { if (prior !== fingerprint) throw new TypeError("review evidence identity is relabelled"); if (unique.at(-1)?.eventId !== event.eventId) throw new TypeError("review evidence retry must be adjacent to its original event"); replayCount += 1; continue; } byId.set(event.eventId, fingerprint); unique.push(event); }
  if (unique.length === 0) throw new TypeError("review work item requires evidence"); let priorDigest: string | null = null; let priorTime = Date.parse(item.createdAt); let priorOutcome: ReturnType<typeof classifyReview> | null = null;
  for (let index = 0; index < unique.length; index += 1) { const event = unique[index]!; if (event.sequence !== index + 1 || event.correctionAttempt !== index) throw new TypeError("review evidence sequence or correction attempt is stale or reordered"); if (event.previousEvidenceSha256 !== priorDigest) throw new TypeError("review evidence chain head is substituted"); if (event.workItemSha256 !== item.workItemSha256 || canonicalJson(event.binding) !== canonicalJson(item.binding)) throw new TypeError("review evidence binding is relabelled"); const eventTime = Date.parse(event.occurredAt); if (eventTime < priorTime) throw new TypeError("review evidence time is reordered"); if (eventTime > horizon) throw new TypeError("review evidence is from the future"); if (eventTime - Date.parse(item.createdAt) > REVIEW_EVIDENCE_MAX_AGE_MS || horizon - eventTime > REVIEW_EVIDENCE_MAX_AGE_MS) throw new TypeError("review evidence is stale"); if (priorOutcome?.terminal) throw new TypeError("review evidence follows a terminal outcome"); if (index > 0 && priorOutcome?.outcome !== "correction-required") throw new TypeError("review evidence attempts status escalation"); priorOutcome = classifyReview(event.findings, event.correctionAttempt, item.maxCorrectionAttempts); priorTime = eventTime; priorDigest = event.evidenceSha256; }
  const result = priorOutcome!; const head = unique.at(-1)!; return Object.freeze({ workItem: item, evidenceChain: Object.freeze([...parsed]), outcome: result.outcome, severity: result.severity, reasons: Object.freeze(result.reasons), correctionAttempt: head.correctionAttempt, headEvidenceSha256: head.evidenceSha256, evaluatedAt: head.occurredAt, terminal: result.terminal, replayCount });
}

export function parseReviewQueueBuildInput(value: unknown): ReviewQueueBuildInput {
  plain(value, "review queue build"); exact(value, ["schemaVersion", "type", "tenantId", "siteId", "environment", "asOf", "workItems", "evidence"], "review queue build");
  if (value.schemaVersion !== 1 || value.type !== "review.queue-build") throw new TypeError("review queue build version or type is unsupported"); id(value.tenantId, "review queue tenantId"); id(value.siteId, "review queue siteId"); if (value.environment !== "production") throw new TypeError("review queue environment must be production"); timestamp(value.asOf, "review queue asOf"); dense(value.workItems, REVIEW_QUEUE_MAX_ITEMS, "review queue workItems"); dense(value.evidence, REVIEW_QUEUE_MAX_ITEMS * (REVIEW_MAX_CORRECTION_ATTEMPTS + 1), "review queue evidence");
  return Object.freeze({ schemaVersion: 1, type: "review.queue-build", tenantId: value.tenantId, siteId: value.siteId, environment: "production", asOf: value.asOf, workItems: Object.freeze(value.workItems.map(parseReviewWorkItem)), evidence: Object.freeze(value.evidence.map(parseReviewEvidenceEvent)) });
}

function authority(value: unknown): ReviewAuthorityDenials { plain(value, "review authority"); exact(value, Object.keys(REVIEW_AUTHORITY_DENIALS), "review authority"); for (const key of Object.keys(REVIEW_AUTHORITY_DENIALS) as (keyof ReviewAuthorityDenials)[]) if (value[key] !== false) throw new TypeError("review command cannot grant authority"); return REVIEW_AUTHORITY_DENIALS; }
export async function parseReviewQueueItem(value: unknown): Promise<ReviewQueueItem> {
  plain(value, "review queue item"); exact(value, ["position", "workItem", "evidenceChain", "outcome", "severity", "reasons", "freshness"], "review queue item"); integer(value.position, 1, REVIEW_QUEUE_MAX_ITEMS, "review queue item position"); const position = value.position; if (!REVIEW_OUTCOMES.includes(value.outcome as ReviewOutcome)) throw new TypeError("review queue item outcome is unsupported"); const outcome = value.outcome as ReviewOutcome; integer(value.severity, 0, 3, "review queue item severity"); const severity = value.severity as 0 | 1 | 2 | 3; if (value.freshness !== "fresh") throw new TypeError("review queue item must be fresh"); dense(value.reasons, REVIEW_MAX_FINDINGS + 1, "review queue item reasons"); const reasons = value.reasons.map((reason) => { if (!REVIEW_REASON_CODES.includes(reason as ReviewReasonCode)) throw new TypeError("review queue item reason is unsupported"); return reason as ReviewReasonCode; }); if (reasons.length < 1 || new Set(reasons).size !== reasons.length || [...reasons].sort().some((reason, index) => reason !== reasons[index])) throw new TypeError("review queue item reasons must be non-empty, unique, and sorted");
  const workItemSnapshot = parseReviewWorkItem(value.workItem); dense(value.evidenceChain, REVIEW_MAX_CORRECTION_ATTEMPTS + 1, "review queue item evidenceChain"); const chainSnapshot = Object.freeze(value.evidenceChain.map(parseReviewEvidenceEvent)); const headTime = chainSnapshot.at(-1)?.occurredAt; if (!headTime) throw new TypeError("review queue item evidenceChain must not be empty");
  const state = await reduceReviewEvidenceChain(workItemSnapshot, chainSnapshot, headTime); if (outcome !== state.outcome || severity !== state.severity || canonicalJson(reasons) !== canonicalJson(state.reasons)) throw new TypeError("review queue item outcome, severity, or reasons are inconsistent");
  return Object.freeze({ position, workItem: state.workItem, evidenceChain: state.evidenceChain, outcome, severity, reasons: Object.freeze(reasons), freshness: "fresh" });
}
export async function parseReviewQueueCommand(value: unknown): Promise<ReviewQueueCommand> {
  plain(value, "review queue command"); exact(value, ["schemaVersion", "type", "tenantId", "siteId", "environment", "asOf", "policyVersion", "itemCount", "byteLength", "commandSha256", "idempotencyKey", "operationalStatus", "g5Ready", "authority", "items"], "review queue command");
  if (value.schemaVersion !== 1 || value.type !== "review.queue-command" || value.policyVersion !== REVIEW_POLICY_VERSION) throw new TypeError("review queue command version, type, or policy is unsupported"); id(value.tenantId, "review command tenantId"); const tenantId = value.tenantId; id(value.siteId, "review command siteId"); const siteId = value.siteId; if (value.environment !== "production") throw new TypeError("review command environment must be production"); timestamp(value.asOf, "review command asOf"); const asOf = value.asOf; integer(value.itemCount, 0, REVIEW_QUEUE_MAX_ITEMS, "review command itemCount"); const itemCount = value.itemCount; integer(value.byteLength, 1, REVIEW_QUEUE_MAX_BYTES, "review command byteLength"); const byteLength = value.byteLength; hash(value.commandSha256, "review command digest"); const commandSha256 = value.commandSha256; if (value.idempotencyKey !== `rqv1_${commandSha256}`) throw new TypeError("review command idempotency is inconsistent"); const idempotencyKey = value.idempotencyKey; if (value.operationalStatus !== "local-preparation-only" || value.g5Ready !== false) throw new TypeError("review command readiness authority is invalid"); const parsedAuthority = authority(value.authority); dense(value.items, REVIEW_QUEUE_MAX_ITEMS, "review command items"); const itemSnapshots = [...value.items];
  const items = await Promise.all(itemSnapshots.map(parseReviewQueueItem)); if (items.length !== itemCount || items.some((item, index) => item.position !== index + 1)) throw new TypeError("review command positions or count are inconsistent");
  const asOfMs = Date.parse(asOf); for (const item of items) { const evaluated = Date.parse(item.evidenceChain.at(-1)!.occurredAt); if (evaluated > asOfMs) throw new TypeError("review command item is from the future"); if (asOfMs - evaluated > REVIEW_EVIDENCE_MAX_AGE_MS) throw new TypeError("review command item freshness is stale"); }
  const seenWork = new Map<string, string>(); const seenJobs = new Map<string, string>(); const seenSkus = new Map<string, string>(); const seenVariants = new Map<string, string>(); const seenAssets = new Map<string, string>(); for (const item of items) { const binding = item.workItem.binding; if (binding.tenantId !== tenantId || binding.siteId !== siteId) throw new TypeError("review command item crosses scope"); const key = canonicalJson(binding); for (const [map, identity] of [[seenWork, item.workItem.workItemId], [seenJobs, binding.jobId], [seenAssets, `${binding.assetId}:${binding.assetVersion}`]] as const) { if (map.has(identity)) throw new TypeError("review command identity is duplicated"); map.set(identity, key); } for (const [map, identity, fingerprint] of [[seenSkus, binding.sku, canonicalJson({ frameModelId: binding.frameModelId, frameVariantId: binding.frameVariantId })], [seenVariants, binding.frameVariantId, canonicalJson({ sku: binding.sku, frameModelId: binding.frameModelId })]] as const) { const prior = map.get(identity); if (prior !== undefined && prior !== fingerprint) throw new TypeError("review command identity is relabelled"); map.set(identity, fingerprint); } }
  for (let index = 1; index < items.length; index += 1) { const prior = items[index - 1]!; const current = items[index]!; const priorTime = prior.evidenceChain.at(-1)!.occurredAt; const currentTime = current.evidenceChain.at(-1)!.occurredAt; if (prior.severity < current.severity || (prior.severity === current.severity && (priorTime > currentTime || (priorTime === currentTime && prior.workItem.workItemId.localeCompare(current.workItem.workItemId) > 0)))) throw new TypeError("review command order is inconsistent"); }
  const snapshot = Object.freeze({ schemaVersion: 1 as const, type: "review.queue-command" as const, tenantId, siteId, environment: "production" as const, asOf, policyVersion: REVIEW_POLICY_VERSION, itemCount, byteLength, commandSha256, idempotencyKey, operationalStatus: "local-preparation-only" as const, g5Ready: false as const, authority: parsedAuthority, items: Object.freeze(items) });
  if (new TextEncoder().encode(canonicalJson(snapshot)).byteLength !== snapshot.byteLength) throw new TypeError("review command byte length is inconsistent"); const projected = { ...snapshot, commandSha256: ZERO, idempotencyKey: `rqv1_${ZERO}` }; if (await sha256Hex(canonicalJson(projected)) !== snapshot.commandSha256) throw new TypeError("review command digest does not match canonical projection"); return snapshot;
}
