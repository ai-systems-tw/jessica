import { canonicalJson, sha256Hex } from "./generationJob.js";

export const REPROCESSING_POLICY_VERSION = "f4-local-v1" as const;
export const REPROCESSING_MAX_ATTEMPTS = 1;
export const REPROCESSING_MAX_EVENTS = 5;
export const REPROCESSING_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const REPROCESSING_MAX_COMMAND_BYTES = 262_144;
export const REPROCESSING_MAX_CANARY_DURATION_MINUTES = 1_440;
export const REPROCESSING_MAX_CANARY_TRAFFIC_BPS = 2_500;
export const REPROCESSING_TRIGGERS = Object.freeze(["qa-correction", "scheduled-refresh", "operator-request"] as const);
export const REPROCESSING_REASONS = Object.freeze(["QA_DEFECT", "MODEL_REFRESH", "SOURCE_UPDATE", "OPERATOR_INVESTIGATION"] as const);
export const REPROCESSING_EVENT_TYPES = Object.freeze(["requested", "candidate-referenced", "comparison-recorded", "canary-planned", "rollback-planned"] as const);
export const REPROCESSING_METRICS = Object.freeze(["attachment-error-bps", "dimension-error-bps", "geometry-error-bps"] as const);
export const REPROCESSING_COMPARISONS = Object.freeze(["better", "equivalent", "worse", "manual-required"] as const);
export const REPROCESSING_DECISIONS = Object.freeze(["awaiting-candidate", "awaiting-comparison", "canary-planning-required", "manual-required", "canary-candidate", "rollback-reference-manual-required"] as const);
export type ReprocessingTrigger = (typeof REPROCESSING_TRIGGERS)[number];
export type ReprocessingReason = (typeof REPROCESSING_REASONS)[number];
export type ReprocessingMetricCode = (typeof REPROCESSING_METRICS)[number];
export type ReprocessingComparison = (typeof REPROCESSING_COMPARISONS)[number];
export type ReprocessingDecision = (typeof REPROCESSING_DECISIONS)[number];

export type ReprocessingVersionReference = Readonly<{
  assetId: string; assetVersion: number; manifestSha256: string; modelSha256: string;
  generationJobId: string; generationCanonicalInputSha256: string; generationInputSha256: string;
  generationHeadEventSha256: string; reviewHeadEvidenceSha256: string; qaCandidateSha256: string;
  referenceStatus: "digest-candidate-unverified";
}>;
export type ReprocessingBinding = Readonly<{
  tenantId: string; siteId: string; environment: "production"; sku: string;
  frameModelId: string; frameVariantId: string; previous: ReprocessingVersionReference;
  sourceCandidateSha256: string; captureCandidateSha256: string;
  provenanceStatus: "candidate-references-unverified";
}>;
export type ReprocessingRequest = Readonly<{
  schemaVersion: 1; type: "reprocessing.request"; requestId: string; idempotencyKey: string;
  createdAt: string; trigger: ReprocessingTrigger; reason: ReprocessingReason; binding: ReprocessingBinding;
  newGenerationRequestId: string; newGenerationCanonicalInputSha256: string; newGenerationInputSha256: string;
  maxAttempts: number; rawMaterialStatus: "digest-references-only-unverified"; rawMaterialAuthority: false;
  policyVersion: typeof REPROCESSING_POLICY_VERSION; requestSha256: string;
}>;
export type ReprocessingMetricEvidence = Readonly<{
  metric: ReprocessingMetricCode; previousValue: number; candidateValue: number;
  evidenceCandidateSha256: string; evidenceStatus: "metric-candidate-unverified";
}>;
export type ReprocessingEventPayload =
  | Readonly<{ request: ReprocessingRequest }>
  | Readonly<{ attempt: number; candidate: ReprocessingVersionReference }>
  | Readonly<{ metrics: readonly ReprocessingMetricEvidence[] }>
  | Readonly<{ trafficBasisPoints: number; durationMinutes: number; skuScope: readonly [string]; humanAuthorityRequired: true; controlPlaneAuthorityRequired: true }>
  | Readonly<{ target: ReprocessingVersionReference; humanAuthorityRequired: true; controlPlaneAuthorityRequired: true; automaticRollback: false }>;
export type ReprocessingEvent = Readonly<{
  schemaVersion: 1; type: "reprocessing.event"; eventId: string; eventType: (typeof REPROCESSING_EVENT_TYPES)[number];
  sequence: number; occurredAt: string; previousEventSha256: string | null; requestSha256: string;
  payload: ReprocessingEventPayload; eventSha256: string;
}>;
export type ReprocessingAuthorityDenials = Readonly<{
  rawMaterialAccess: false; generationExecuted: false; qaApproved: false; assetVersionPromoted: false;
  recommendedForLive: false; activeDeploymentMutation: false; publication: false; automaticRollback: false;
  humanAuthority: false; controlPlaneAuthority: false; g1Evidence: false; g2Evidence: false; g5Evidence: false;
}>;
export const REPROCESSING_AUTHORITY_DENIALS: ReprocessingAuthorityDenials = Object.freeze({
  rawMaterialAccess: false, generationExecuted: false, qaApproved: false, assetVersionPromoted: false,
  recommendedForLive: false, activeDeploymentMutation: false, publication: false, automaticRollback: false,
  humanAuthority: false, controlPlaneAuthority: false, g1Evidence: false, g2Evidence: false, g5Evidence: false,
});
export type ReprocessingPlan = Readonly<{
  schemaVersion: 1; type: "reprocessing.local-plan"; request: ReprocessingRequest;
  ledger: readonly ReprocessingEvent[]; candidate: ReprocessingVersionReference | null;
  comparison: ReprocessingComparison | null; metrics: readonly ReprocessingMetricEvidence[];
  canary: Readonly<{ trafficBasisPoints: number; durationMinutes: number; skuScope: readonly [string]; humanAuthorityRequired: true; controlPlaneAuthorityRequired: true }> | null;
  rollback: Readonly<{ target: ReprocessingVersionReference; humanAuthorityRequired: true; controlPlaneAuthorityRequired: true; automaticRollback: false }> | null;
  attempts: number; decision: ReprocessingDecision; headEventSha256: string; evaluatedAt: string; operationalStatus: "local-preparation-only";
  g5Ready: false; authority: ReprocessingAuthorityDenials;
}>;
export type ReprocessingCommand = Readonly<Omit<ReprocessingPlan, "type"> & {
  type: "reprocessing.local-command"; byteLength: number; commandSha256: string; commandIdempotencyKey: string;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const ZERO = "0".repeat(64);
const MIN_TIME = Date.parse("2020-01-01T00:00:00.000Z");
const MAX_TIME = Date.parse("2100-01-01T00:00:00.000Z");
function plain(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} must contain enumerable data properties only`);
}
function dense(value: unknown, maximum: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.keys(value).length !== value.length) throw new TypeError(`${label} must be a bounded dense standard array`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new TypeError(`${label} must contain data properties only`);
}
function tree(value: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (value === null || typeof value !== "object") return; if (depth > 12 || seen.has(value)) throw new TypeError("reprocessing input must be an acyclic bounded data tree"); seen.add(value);
  if (Array.isArray(value)) dense(value, REPROCESSING_MAX_EVENTS * 4, "reprocessing array"); else plain(value, "reprocessing object");
  for (const item of Object.values(value as Record<string, unknown>)) tree(item, seen, depth + 1); seen.delete(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`); }
function id(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !ID.test(value) || /^(?:localraw|https?|file):/i.test(value)) throw new TypeError(`${label} must be a bounded non-resource identifier`); }
function hash(value: unknown, label: string, allowZero = false): asserts value is string { if (typeof value !== "string" || !HASH.test(value) || (!allowZero && value === ZERO)) throw new TypeError(`${label} must be a nonzero lowercase SHA-256 digest`); }
function integer(value: unknown, min: number, max: number, label: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new TypeError(`${label} must be a bounded integer`); }
function timestamp(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a millisecond UTC timestamp`); const time = Date.parse(value); if (!Number.isFinite(time) || time < MIN_TIME || time > MAX_TIME || new Date(time).toISOString() !== value) throw new TypeError(`${label} is not a real canonical UTC instant`); }

export function parseReprocessingVersionReference(value: unknown): ReprocessingVersionReference {
  plain(value, "reprocessing version reference"); exact(value, ["assetId", "assetVersion", "manifestSha256", "modelSha256", "generationJobId", "generationCanonicalInputSha256", "generationInputSha256", "generationHeadEventSha256", "reviewHeadEvidenceSha256", "qaCandidateSha256", "referenceStatus"], "reprocessing version reference");
  id(value.assetId, "version assetId"); integer(value.assetVersion, 1, 1_000_000, "version assetVersion"); id(value.generationJobId, "version generationJobId");
  for (const key of ["manifestSha256", "modelSha256", "generationCanonicalInputSha256", "generationInputSha256", "generationHeadEventSha256", "reviewHeadEvidenceSha256", "qaCandidateSha256"] as const) hash(value[key], `version ${key}`);
  if (value.referenceStatus !== "digest-candidate-unverified") throw new TypeError("version reference cannot claim verification");
  return Object.freeze({ assetId: value.assetId, assetVersion: value.assetVersion, manifestSha256: value.manifestSha256 as string, modelSha256: value.modelSha256 as string, generationJobId: value.generationJobId, generationCanonicalInputSha256: value.generationCanonicalInputSha256 as string, generationInputSha256: value.generationInputSha256 as string, generationHeadEventSha256: value.generationHeadEventSha256 as string, reviewHeadEvidenceSha256: value.reviewHeadEvidenceSha256 as string, qaCandidateSha256: value.qaCandidateSha256 as string, referenceStatus: "digest-candidate-unverified" });
}
function binding(value: unknown): ReprocessingBinding {
  plain(value, "reprocessing binding"); exact(value, ["tenantId", "siteId", "environment", "sku", "frameModelId", "frameVariantId", "previous", "sourceCandidateSha256", "captureCandidateSha256", "provenanceStatus"], "reprocessing binding");
  for (const key of ["tenantId", "siteId", "sku", "frameModelId", "frameVariantId"] as const) id(value[key], `binding ${key}`); if (value.environment !== "production") throw new TypeError("binding environment must be production");
  hash(value.sourceCandidateSha256, "binding source candidate"); hash(value.captureCandidateSha256, "binding capture candidate"); if (value.provenanceStatus !== "candidate-references-unverified") throw new TypeError("binding cannot claim provenance verification");
  return Object.freeze({ tenantId: value.tenantId as string, siteId: value.siteId as string, environment: "production", sku: value.sku as string, frameModelId: value.frameModelId as string, frameVariantId: value.frameVariantId as string, previous: parseReprocessingVersionReference(value.previous), sourceCandidateSha256: value.sourceCandidateSha256 as string, captureCandidateSha256: value.captureCandidateSha256 as string, provenanceStatus: "candidate-references-unverified" });
}
function parseRequestInternal(value: unknown, sentinel: boolean): ReprocessingRequest {
  tree(value); plain(value, "reprocessing request"); exact(value, ["schemaVersion", "type", "requestId", "idempotencyKey", "createdAt", "trigger", "reason", "binding", "newGenerationRequestId", "newGenerationCanonicalInputSha256", "newGenerationInputSha256", "maxAttempts", "rawMaterialStatus", "rawMaterialAuthority", "policyVersion", "requestSha256"], "reprocessing request");
  if (value.schemaVersion !== 1 || value.type !== "reprocessing.request" || value.policyVersion !== REPROCESSING_POLICY_VERSION) throw new TypeError("reprocessing request version, type, or policy is unsupported"); id(value.requestId, "requestId"); id(value.idempotencyKey, "request idempotencyKey"); timestamp(value.createdAt, "request createdAt");
  if (!REPROCESSING_TRIGGERS.includes(value.trigger as ReprocessingTrigger) || !REPROCESSING_REASONS.includes(value.reason as ReprocessingReason)) throw new TypeError("reprocessing trigger or reason is unsupported"); id(value.newGenerationRequestId, "new generation requestId"); hash(value.newGenerationCanonicalInputSha256, "new generation canonical input"); hash(value.newGenerationInputSha256, "new generation input"); integer(value.maxAttempts, 1, REPROCESSING_MAX_ATTEMPTS, "request maxAttempts");
  if (value.rawMaterialStatus !== "digest-references-only-unverified" || value.rawMaterialAuthority !== false) throw new TypeError("raw material authority must remain false"); hash(value.requestSha256, "request digest", sentinel);
  return Object.freeze({ schemaVersion: 1, type: "reprocessing.request", requestId: value.requestId, idempotencyKey: value.idempotencyKey, createdAt: value.createdAt, trigger: value.trigger as ReprocessingTrigger, reason: value.reason as ReprocessingReason, binding: binding(value.binding), newGenerationRequestId: value.newGenerationRequestId, newGenerationCanonicalInputSha256: value.newGenerationCanonicalInputSha256 as string, newGenerationInputSha256: value.newGenerationInputSha256 as string, maxAttempts: value.maxAttempts, rawMaterialStatus: "digest-references-only-unverified", rawMaterialAuthority: false, policyVersion: REPROCESSING_POLICY_VERSION, requestSha256: value.requestSha256 as string });
}
export function parseReprocessingRequest(value: unknown): ReprocessingRequest { return parseRequestInternal(value, false); }
function requestIdentityBody(request: ReprocessingRequest): unknown { const { requestSha256: _, requestId: _requestId, idempotencyKey: _idempotencyKey, ...body } = request; return body; }
export async function bindReprocessingRequest(value: Omit<ReprocessingRequest, "requestSha256" | "requestId" | "idempotencyKey">): Promise<ReprocessingRequest> { tree(value); const parsed = parseRequestInternal({ ...structuredClone(value), requestId: "pending", idempotencyKey: "pending", requestSha256: ZERO }, true); const requestSha256 = await sha256Hex(canonicalJson(requestIdentityBody(parsed))); return Object.freeze({ ...parsed, requestId: `rp_${requestSha256}`, idempotencyKey: `rpv1_${requestSha256}`, requestSha256 }); }
export async function verifyReprocessingRequest(value: unknown): Promise<ReprocessingRequest> { const parsed = parseReprocessingRequest(value); const requestSha256 = await sha256Hex(canonicalJson(requestIdentityBody(parsed))); if (requestSha256 !== parsed.requestSha256 || parsed.requestId !== `rp_${requestSha256}` || parsed.idempotencyKey !== `rpv1_${requestSha256}`) throw new TypeError("request digest or identity does not match canonical bytes"); return parsed; }

function metric(value: unknown): ReprocessingMetricEvidence {
  plain(value, "comparison metric"); exact(value, ["metric", "previousValue", "candidateValue", "evidenceCandidateSha256", "evidenceStatus"], "comparison metric"); if (!REPROCESSING_METRICS.includes(value.metric as ReprocessingMetricCode)) throw new TypeError("comparison metric is unsupported"); integer(value.previousValue, 0, 1_000_000, "metric previousValue"); integer(value.candidateValue, 0, 1_000_000, "metric candidateValue"); hash(value.evidenceCandidateSha256, "metric evidence candidate"); if (value.evidenceStatus !== "metric-candidate-unverified") throw new TypeError("metric evidence cannot claim verification"); return Object.freeze({ metric: value.metric as ReprocessingMetricCode, previousValue: value.previousValue, candidateValue: value.candidateValue, evidenceCandidateSha256: value.evidenceCandidateSha256 as string, evidenceStatus: "metric-candidate-unverified" });
}
function payload(eventType: ReprocessingEvent["eventType"], value: unknown): ReprocessingEventPayload {
  plain(value, "reprocessing event payload");
  if (eventType === "requested") { exact(value, ["request"], "requested payload"); return Object.freeze({ request: parseReprocessingRequest(value.request) }); }
  if (eventType === "candidate-referenced") { exact(value, ["attempt", "candidate"], "candidate payload"); integer(value.attempt, 1, REPROCESSING_MAX_ATTEMPTS, "candidate attempt"); return Object.freeze({ attempt: value.attempt, candidate: parseReprocessingVersionReference(value.candidate) }); }
  if (eventType === "comparison-recorded") { exact(value, ["metrics"], "comparison payload"); dense(value.metrics, REPROCESSING_METRICS.length, "comparison metrics"); const metrics = value.metrics.map(metric); if (new Set(metrics.map((item) => item.metric)).size !== metrics.length || [...metrics].sort((a,b) => a.metric.localeCompare(b.metric)).some((item,index) => item.metric !== metrics[index]!.metric)) throw new TypeError("comparison metrics must be unique and sorted"); return Object.freeze({ metrics: Object.freeze(metrics) }); }
  if (eventType === "canary-planned") { exact(value, ["trafficBasisPoints", "durationMinutes", "skuScope", "humanAuthorityRequired", "controlPlaneAuthorityRequired"], "canary payload"); integer(value.trafficBasisPoints, 1, REPROCESSING_MAX_CANARY_TRAFFIC_BPS, "canary traffic"); integer(value.durationMinutes, 1, REPROCESSING_MAX_CANARY_DURATION_MINUTES, "canary duration"); dense(value.skuScope, 1, "canary SKU scope"); id(value.skuScope[0], "canary SKU"); if (value.humanAuthorityRequired !== true || value.controlPlaneAuthorityRequired !== true) throw new TypeError("canary requires later human and control-plane authority"); return Object.freeze({ trafficBasisPoints: value.trafficBasisPoints, durationMinutes: value.durationMinutes, skuScope: Object.freeze([value.skuScope[0]]) as readonly [string], humanAuthorityRequired: true as const, controlPlaneAuthorityRequired: true as const }); }
  exact(value, ["target", "humanAuthorityRequired", "controlPlaneAuthorityRequired", "automaticRollback"], "rollback payload"); if (value.humanAuthorityRequired !== true || value.controlPlaneAuthorityRequired !== true || value.automaticRollback !== false) throw new TypeError("rollback must remain manually authorized local planning"); return Object.freeze({ target: parseReprocessingVersionReference(value.target), humanAuthorityRequired: true as const, controlPlaneAuthorityRequired: true as const, automaticRollback: false as const });
}
function parseEventInternal(value: unknown, sentinel: boolean): ReprocessingEvent {
  tree(value); plain(value, "reprocessing event"); exact(value, ["schemaVersion", "type", "eventId", "eventType", "sequence", "occurredAt", "previousEventSha256", "requestSha256", "payload", "eventSha256"], "reprocessing event"); if (value.schemaVersion !== 1 || value.type !== "reprocessing.event" || !REPROCESSING_EVENT_TYPES.includes(value.eventType as ReprocessingEvent["eventType"])) throw new TypeError("reprocessing event version or type is unsupported"); id(value.eventId, "eventId"); integer(value.sequence, 1, REPROCESSING_MAX_EVENTS, "event sequence"); timestamp(value.occurredAt, "event occurredAt"); if (value.previousEventSha256 !== null) hash(value.previousEventSha256, "previous event digest"); hash(value.requestSha256, "event request digest"); hash(value.eventSha256, "event digest", sentinel); return Object.freeze({ schemaVersion: 1, type: "reprocessing.event", eventId: value.eventId, eventType: value.eventType as ReprocessingEvent["eventType"], sequence: value.sequence, occurredAt: value.occurredAt, previousEventSha256: value.previousEventSha256 as string | null, requestSha256: value.requestSha256 as string, payload: payload(value.eventType as ReprocessingEvent["eventType"], value.payload), eventSha256: value.eventSha256 as string });
}
export function parseReprocessingEvent(value: unknown): ReprocessingEvent { return parseEventInternal(value, false); }
export async function bindReprocessingEvent(value: Omit<ReprocessingEvent, "eventSha256">): Promise<ReprocessingEvent> { tree(value); const parsed = parseEventInternal({ ...structuredClone(value), eventSha256: ZERO }, true); const { eventSha256: _, ...body } = parsed; return Object.freeze({ ...body, eventSha256: await sha256Hex(canonicalJson(body)) }); }
export async function verifyReprocessingEvent(value: unknown): Promise<ReprocessingEvent> { const parsed = parseReprocessingEvent(value); const { eventSha256, ...body } = parsed; if (await sha256Hex(canonicalJson(body)) !== eventSha256) throw new TypeError("event digest does not match canonical bytes"); return parsed; }

function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function classify(metrics: readonly ReprocessingMetricEvidence[]): ReprocessingComparison { if (metrics.length !== REPROCESSING_METRICS.length || metrics.some((item, index) => item.metric !== REPROCESSING_METRICS[index])) return "manual-required"; if (metrics.some((item) => item.candidateValue > item.previousValue)) return "worse"; return metrics.some((item) => item.candidateValue < item.previousValue) ? "better" : "equivalent"; }
function assertCandidate(request: ReprocessingRequest, candidate: ReprocessingVersionReference): void { const previous = request.binding.previous; if (candidate.assetId !== previous.assetId) throw new TypeError("candidate cannot cross asset identity"); if (candidate.assetVersion <= previous.assetVersion) throw new TypeError("candidate version must advance strictly"); if (candidate.generationJobId !== request.newGenerationRequestId || candidate.generationCanonicalInputSha256 !== request.newGenerationCanonicalInputSha256 || candidate.generationInputSha256 !== request.newGenerationInputSha256) throw new TypeError("candidate substitutes new generation request identity or inputs"); if (same(candidate, previous)) throw new TypeError("candidate duplicates the previous version"); }
export async function replayReprocessingLedgerContract(values: readonly unknown[], evaluatedAt: string): Promise<ReprocessingPlan> {
  dense(values, REPROCESSING_MAX_EVENTS, "reprocessing ledger"); if (values.length < 1) throw new TypeError("reprocessing ledger must not be empty"); timestamp(evaluatedAt, "reprocessing replay horizon");
  const parsed = values.map(parseReprocessingEvent); const events = await Promise.all(parsed.map(verifyReprocessingEvent)); const horizon = Date.parse(evaluatedAt); const first = events[0]!; if (first.eventType !== "requested" || first.sequence !== 1 || first.previousEventSha256 !== null) throw new TypeError("reprocessing ledger must begin with requested genesis"); const request = await verifyReprocessingRequest((first.payload as { request: ReprocessingRequest }).request); if (first.requestSha256 !== request.requestSha256 || first.occurredAt !== request.createdAt) throw new TypeError("genesis does not bind the canonical request"); if (Date.parse(first.occurredAt) > horizon) throw new TypeError("reprocessing ledger contains future evidence");
  let prior = first; let candidate: ReprocessingVersionReference | null = null; let comparison: ReprocessingComparison | null = null; let metrics: readonly ReprocessingMetricEvidence[] = Object.freeze([]); let canary: ReprocessingPlan["canary"] = null; let rollback: ReprocessingPlan["rollback"] = null; let attempts = 0; const ids = new Map([[first.eventId, first.eventSha256]]); const digests = new Set([first.eventSha256]);
  for (let index=1; index<events.length; index+=1) { const event=events[index]!; const known=ids.get(event.eventId); if (known) throw new TypeError(known===event.eventSha256 ? "reprocessing event is duplicated" : "reprocessing event identity is relabelled"); if (digests.has(event.eventSha256)) throw new TypeError("reprocessing event digest is duplicated"); ids.set(event.eventId,event.eventSha256); digests.add(event.eventSha256); if (event.sequence!==index+1 || event.previousEventSha256!==prior.eventSha256) throw new TypeError("reprocessing event is stale, reordered, or substitutes the chain head"); if (event.requestSha256!==request.requestSha256) throw new TypeError("reprocessing event substitutes request identity"); if (Date.parse(event.occurredAt)<=Date.parse(prior.occurredAt)) throw new TypeError("reprocessing event time must increase strictly"); if (Date.parse(event.occurredAt)>horizon) throw new TypeError("reprocessing ledger contains future evidence"); if (Date.parse(event.occurredAt)-Date.parse(request.createdAt)>REPROCESSING_MAX_AGE_MS || horizon-Date.parse(event.occurredAt)>REPROCESSING_MAX_AGE_MS) throw new TypeError("reprocessing event is stale"); if (canary||rollback) throw new TypeError("reprocessing event follows a terminal local plan");
    if (event.eventType==="requested") throw new TypeError("requested genesis cannot be replayed later"); if (event.eventType==="candidate-referenced") { if (candidate||comparison) throw new TypeError("candidate is duplicated or reordered"); const data=event.payload as {attempt:number;candidate:ReprocessingVersionReference}; if (data.attempt!==1 || data.attempt>request.maxAttempts) throw new TypeError("candidate attempt is stale or exceeds the request bound"); assertCandidate(request,data.candidate); candidate=data.candidate; attempts=1; }
    else if (event.eventType==="comparison-recorded") { if (!candidate||comparison) throw new TypeError("comparison is duplicated or precedes its candidate"); metrics=(event.payload as {metrics:readonly ReprocessingMetricEvidence[]}).metrics; comparison=classify(metrics); }
    else if (event.eventType==="canary-planned") { if (!candidate||(comparison!=="better"&&comparison!=="equivalent")) throw new TypeError("canary requires complete non-worse closed metric evidence"); const data=event.payload as NonNullable<ReprocessingPlan["canary"]>; if (data.skuScope[0]!==request.binding.sku) throw new TypeError("canary scope cannot cross or wildcard the bound SKU"); canary=Object.freeze({...data,skuScope:Object.freeze([...data.skuScope]) as readonly [string]}); }
    else { if (!candidate||(comparison!=="worse"&&comparison!=="manual-required")) throw new TypeError("rollback reference requires worse or manual-required comparison evidence"); const data=event.payload as NonNullable<ReprocessingPlan["rollback"]>; if (!same(data.target,request.binding.previous)) throw new TypeError("rollback target must be the exactly referenced prior version"); if (data.target.assetVersion>=candidate.assetVersion) throw new TypeError("rollback cannot roll forward"); rollback=Object.freeze({...data,target:request.binding.previous}); } prior=event;
  }
  if (horizon-Date.parse(prior.occurredAt)>REPROCESSING_MAX_AGE_MS) throw new TypeError("reprocessing ledger head is stale"); const decision: ReprocessingDecision = rollback ? "rollback-reference-manual-required" : canary ? "canary-candidate" : comparison==="manual-required"||comparison==="worse" ? "manual-required" : comparison==="better"||comparison==="equivalent" ? "canary-planning-required" : candidate ? "awaiting-comparison" : "awaiting-candidate";
  return Object.freeze({schemaVersion:1,type:"reprocessing.local-plan",request,ledger:Object.freeze(events),candidate,comparison,metrics:Object.freeze([...metrics]),canary,rollback,attempts,decision,headEventSha256:prior.eventSha256,evaluatedAt,operationalStatus:"local-preparation-only",g5Ready:false,authority:REPROCESSING_AUTHORITY_DENIALS});
}
function authority(value: unknown): ReprocessingAuthorityDenials { plain(value, "reprocessing authority"); exact(value, Object.keys(REPROCESSING_AUTHORITY_DENIALS), "reprocessing authority"); for (const key of Object.keys(REPROCESSING_AUTHORITY_DENIALS)) if (value[key] !== false) throw new TypeError("reprocessing authority cannot be granted"); return REPROCESSING_AUTHORITY_DENIALS; }
export async function parseReprocessingCommand(value: unknown): Promise<ReprocessingCommand> {
  tree(value); const snapshot = structuredClone(value); plain(snapshot, "reprocessing command"); exact(snapshot, ["schemaVersion", "type", "request", "ledger", "candidate", "comparison", "metrics", "canary", "rollback", "attempts", "decision", "headEventSha256", "evaluatedAt", "operationalStatus", "g5Ready", "authority", "byteLength", "commandSha256", "commandIdempotencyKey"], "reprocessing command"); if (snapshot.schemaVersion !== 1 || snapshot.type !== "reprocessing.local-command") throw new TypeError("reprocessing command version or type is unsupported"); timestamp(snapshot.evaluatedAt, "command evaluatedAt"); integer(snapshot.byteLength, 1, REPROCESSING_MAX_COMMAND_BYTES, "command byteLength"); hash(snapshot.commandSha256, "command digest"); if (snapshot.commandIdempotencyKey !== `rpcv1_${snapshot.commandSha256}`) throw new TypeError("command idempotency is inconsistent"); authority(snapshot.authority); dense(snapshot.ledger, REPROCESSING_MAX_EVENTS, "command ledger"); if (snapshot.ledger.length===0) throw new TypeError("command ledger is empty"); const replayed = await replayReprocessingLedgerContract(snapshot.ledger, snapshot.evaluatedAt); const { byteLength, commandSha256, commandIdempotencyKey, ...commandBody } = snapshot; const comparable = { ...commandBody, type: "reprocessing.local-plan" }; if (canonicalJson(replayed) !== canonicalJson(comparable)) throw new TypeError("command plan is inconsistent with ledger replay"); const projected = { ...snapshot, commandSha256: ZERO, commandIdempotencyKey: `rpcv1_${ZERO}` }; if (new TextEncoder().encode(canonicalJson(projected)).byteLength !== byteLength || await sha256Hex(canonicalJson(projected)) !== commandSha256) throw new TypeError("command digest or byte length is inconsistent"); return Object.freeze({ ...replayed, type: "reprocessing.local-command" as const, byteLength, commandSha256, commandIdempotencyKey });
}
