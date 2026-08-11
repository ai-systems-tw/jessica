import { canonicalJson, sha256Hex } from "./generationJob.js";
import { parseCatalogUnavailableEvent, type CatalogUnavailableEvent } from "./catalogIntegration.js";
import { parseCommerceEvent, type CommerceEvent } from "./commerceEvents.js";

export const DEMAND_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const SALES_RANK_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const INVENTORY_MAX_AGE_MS = 60 * 60 * 1_000;
export const COVERAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEMAND_QUEUE_MAX_EVIDENCE = 1_000;
export const DEMAND_QUEUE_MAX_SAMPLES = 1_000;
export const DEMAND_QUEUE_MAX_ITEMS = 500;
export const DEMAND_QUEUE_MAX_BYTES = 524_288;

export const FRAME_SHAPES = ["round", "oval", "square", "rectangle", "cat-eye", "aviator", "browline", "geometric", "rimless", "other"] as const;
export type FrameShape = (typeof FRAME_SHAPES)[number];

export type DemandTargetIdentity = Readonly<{
  kind: "catalog-sku";
  sku: string;
  frameModelId: string;
  frameVariantId: string;
  frameShape: FrameShape;
} | {
  kind: "unresolved-candidate";
  candidateId: string;
  frameShape: FrameShape;
}>;

export const DEMAND_REASON_CODES = [
  "E2_REQUESTED_SKU_NOT_FOUND", "E2_REQUESTED_SKU_NOT_ACTIVE", "E2_FALLBACK_SKU_NOT_FOUND",
  "E2_FALLBACK_TARGET_NOT_ACTIVE", "E3_CATALOG_UNAVAILABLE", "E3_ASSET_UNAVAILABLE",
] as const;
export type DemandReasonCode = (typeof DEMAND_REASON_CODES)[number];
const ELIGIBILITY_REASONS: readonly DemandEligibilityReason[] = ["ELIGIBLE_FRESH_CONTINUOUS_IN_STOCK", "INVENTORY_MISSING", "INVENTORY_STALE", "CONTINUITY_UNKNOWN", "DISCONTINUOUS", "STOCK_UNKNOWN", "OUT_OF_STOCK"];
const PRIORITY_REASONS: readonly DemandPriorityReason[] = ["DEMAND_COUNT", "SALES_RANK_FRESH", "SALES_RANK_MISSING", "SALES_RANK_STALE", "SHAPE_UNDERREPRESENTED", "SHAPE_COVERAGE_SUFFICIENT", "SHAPE_COVERAGE_MISSING", "SHAPE_COVERAGE_STALE"];

export type UnavailableDemandEvidence = Readonly<{
  schemaVersion: 1;
  type: "demand.unavailable-evidence";
  evidenceId: string;
  correlationId: string;
  tenantId: string;
  siteId: string;
  environment: "production";
  occurredAt: string;
  target: DemandTargetIdentity;
  reasonCode: DemandReasonCode;
}>;

export type SalesRankSample = Readonly<{
  schemaVersion: 1; type: "demand.sales-rank"; snapshotId: string; tenantId: string; siteId: string;
  environment: "production"; measuredAt: string; target: DemandTargetIdentity; rank: number;
}>;
export type InventoryEligibilitySample = Readonly<{
  schemaVersion: 1; type: "demand.inventory-eligibility"; snapshotId: string; tenantId: string; siteId: string;
  environment: "production"; measuredAt: string; target: DemandTargetIdentity;
  continuity: "continuous" | "discontinuous" | "unknown"; stock: "in-stock" | "out-of-stock" | "unknown";
}>;
export type FrameShapeCoverageSample = Readonly<{
  schemaVersion: 1; type: "demand.frame-shape-coverage"; snapshotId: string; tenantId: string; siteId: string;
  environment: "production"; measuredAt: string; frameShape: FrameShape; eligibleModelCount: number; targetModelCount: number;
}>;

export type DemandQueueBuildInput = Readonly<{
  schemaVersion: 1; type: "demand.queue-build"; tenantId: string; siteId: string; environment: "production";
  asOf: string; evidence: readonly UnavailableDemandEvidence[]; salesRanks: readonly SalesRankSample[];
  inventory: readonly InventoryEligibilitySample[]; coverage: readonly FrameShapeCoverageSample[];
}>;

export type DemandEligibilityReason =
  | "ELIGIBLE_FRESH_CONTINUOUS_IN_STOCK" | "INVENTORY_MISSING" | "INVENTORY_STALE"
  | "CONTINUITY_UNKNOWN" | "DISCONTINUOUS" | "STOCK_UNKNOWN" | "OUT_OF_STOCK";
export type DemandPriorityReason =
  | "DEMAND_COUNT" | "SALES_RANK_FRESH" | "SALES_RANK_MISSING" | "SALES_RANK_STALE"
  | "SHAPE_UNDERREPRESENTED" | "SHAPE_COVERAGE_SUFFICIENT" | "SHAPE_COVERAGE_MISSING" | "SHAPE_COVERAGE_STALE";

export type DemandQueueItem = Readonly<{
  position: number; target: DemandTargetIdentity; priorityScore: number; demandCount: number;
  firstDemandAt: string; lastDemandAt: string; salesRank: number | null;
  salesRankStatus: "fresh" | "missing" | "stale"; coverageStatus: "underrepresented" | "sufficient" | "missing" | "stale";
  eligibilityReasons: readonly DemandEligibilityReason[]; priorityReasons: readonly DemandPriorityReason[];
}>;

export type DemandQueueCommand = Readonly<{
  schemaVersion: 1; type: "demand.queue-command"; tenantId: string; siteId: string; environment: "production";
  asOf: string; windowStart: string; policyVersion: "f1-local-v1"; itemCount: number; byteLength: number;
  commandSha256: string; idempotencyKey: string; operationalStatus: "local-preparation-only"; g5Ready: false;
  items: readonly DemandQueueItem[];
}>;

export type DemandQueueDecision = Readonly<{
  target: DemandTargetIdentity; demandCount: number; eligibility: "eligible" | "ineligible";
  queueStatus: "queued" | "capacity-excluded" | "ineligible"; eligibilityReasons: readonly DemandEligibilityReason[];
}>;
export type DemandQueueBuildResult = Readonly<{ command: DemandQueueCommand; decisions: readonly DemandQueueDecision[]; replayCount: number }>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIN_TIME = Date.parse("2020-01-01T00:00:00.000Z");
const MAX_TIME = Date.parse("2100-01-01T00:00:00.000Z");
const DIGEST_PLACEHOLDER = "0".repeat(64);

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} must contain enumerable data properties only`);
}
function array(value: unknown, max: number, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense standard array`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new TypeError(`${path} must contain data properties only`);
}
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${path} fields are invalid`);
}
function identifier(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${path} must be a millisecond UTC timestamp`);
  const epoch = Date.parse(value); if (!Number.isFinite(epoch) || epoch < MIN_TIME || epoch > MAX_TIME) throw new TypeError(`${path} is outside the supported range`);
}
function shape(value: unknown, path: string): asserts value is FrameShape { if (!FRAME_SHAPES.includes(value as FrameShape)) throw new TypeError(`${path} is unsupported`); }
function safeInteger(value: unknown, min: number, max: number, path: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new TypeError(`${path} must be a bounded integer`); }

export function parseDemandTargetIdentity(value: unknown): DemandTargetIdentity {
  object(value, "demand target");
  if (value.kind === "catalog-sku") {
    exact(value, ["kind", "sku", "frameModelId", "frameVariantId", "frameShape"], "demand target");
    identifier(value.sku, "demand target sku"); identifier(value.frameModelId, "demand target frameModelId"); identifier(value.frameVariantId, "demand target frameVariantId"); shape(value.frameShape, "demand target frameShape");
    return Object.freeze({ kind: "catalog-sku", sku: value.sku, frameModelId: value.frameModelId, frameVariantId: value.frameVariantId, frameShape: value.frameShape });
  }
  if (value.kind === "unresolved-candidate") {
    exact(value, ["kind", "candidateId", "frameShape"], "demand target"); identifier(value.candidateId, "demand target candidateId"); shape(value.frameShape, "demand target frameShape");
    return Object.freeze({ kind: "unresolved-candidate", candidateId: value.candidateId, frameShape: value.frameShape });
  }
  throw new TypeError("demand target kind is unsupported");
}

function parseScope(value: Record<string, unknown>, path: string): asserts value is Record<string, unknown> & { tenantId: string; siteId: string; environment: "production" } {
  identifier(value.tenantId, `${path} tenantId`); identifier(value.siteId, `${path} siteId`);
  if (value.environment !== "production") throw new TypeError(`${path} environment must be production`);
}
export function parseUnavailableDemandEvidence(value: unknown): UnavailableDemandEvidence {
  object(value, "demand evidence"); exact(value, ["schemaVersion", "type", "evidenceId", "correlationId", "tenantId", "siteId", "environment", "occurredAt", "target", "reasonCode"], "demand evidence");
  if (value.schemaVersion !== 1 || value.type !== "demand.unavailable-evidence") throw new TypeError("demand evidence version or type is unsupported");
  identifier(value.evidenceId, "demand evidence evidenceId"); identifier(value.correlationId, "demand evidence correlationId"); parseScope(value, "demand evidence"); timestamp(value.occurredAt, "demand evidence occurredAt");
  const target = parseDemandTargetIdentity(value.target); if (!DEMAND_REASON_CODES.includes(value.reasonCode as DemandReasonCode)) throw new TypeError("demand evidence reasonCode is unsupported");
  return Object.freeze({ schemaVersion: 1, type: "demand.unavailable-evidence", evidenceId: value.evidenceId, correlationId: value.correlationId, tenantId: value.tenantId, siteId: value.siteId, environment: "production", occurredAt: value.occurredAt, target, reasonCode: value.reasonCode as DemandReasonCode });
}

export function parseSalesRankSample(value: unknown): SalesRankSample {
  object(value, "sales rank sample"); exact(value, ["schemaVersion", "type", "snapshotId", "tenantId", "siteId", "environment", "measuredAt", "target", "rank"], "sales rank sample");
  if (value.schemaVersion !== 1 || value.type !== "demand.sales-rank") throw new TypeError("sales rank sample version or type is unsupported");
  identifier(value.snapshotId, "sales rank sample snapshotId"); parseScope(value, "sales rank sample"); timestamp(value.measuredAt, "sales rank sample measuredAt"); const target = parseDemandTargetIdentity(value.target); safeInteger(value.rank, 1, 1_000_000, "sales rank sample rank");
  return Object.freeze({ schemaVersion: 1, type: "demand.sales-rank", snapshotId: value.snapshotId, tenantId: value.tenantId, siteId: value.siteId, environment: "production", measuredAt: value.measuredAt, target, rank: value.rank });
}
export function parseInventoryEligibilitySample(value: unknown): InventoryEligibilitySample {
  object(value, "inventory sample"); exact(value, ["schemaVersion", "type", "snapshotId", "tenantId", "siteId", "environment", "measuredAt", "target", "continuity", "stock"], "inventory sample");
  if (value.schemaVersion !== 1 || value.type !== "demand.inventory-eligibility") throw new TypeError("inventory sample version or type is unsupported");
  identifier(value.snapshotId, "inventory sample snapshotId"); parseScope(value, "inventory sample"); timestamp(value.measuredAt, "inventory sample measuredAt"); const target = parseDemandTargetIdentity(value.target);
  if (!["continuous", "discontinuous", "unknown"].includes(value.continuity as string) || !["in-stock", "out-of-stock", "unknown"].includes(value.stock as string)) throw new TypeError("inventory sample state is unsupported");
  return Object.freeze({ schemaVersion: 1, type: "demand.inventory-eligibility", snapshotId: value.snapshotId, tenantId: value.tenantId, siteId: value.siteId, environment: "production", measuredAt: value.measuredAt, target, continuity: value.continuity as InventoryEligibilitySample["continuity"], stock: value.stock as InventoryEligibilitySample["stock"] });
}
export function parseFrameShapeCoverageSample(value: unknown): FrameShapeCoverageSample {
  object(value, "coverage sample"); exact(value, ["schemaVersion", "type", "snapshotId", "tenantId", "siteId", "environment", "measuredAt", "frameShape", "eligibleModelCount", "targetModelCount"], "coverage sample");
  if (value.schemaVersion !== 1 || value.type !== "demand.frame-shape-coverage") throw new TypeError("coverage sample version or type is unsupported");
  identifier(value.snapshotId, "coverage sample snapshotId"); parseScope(value, "coverage sample"); timestamp(value.measuredAt, "coverage sample measuredAt"); shape(value.frameShape, "coverage sample frameShape"); safeInteger(value.eligibleModelCount, 0, 10_000, "coverage sample eligibleModelCount"); safeInteger(value.targetModelCount, 1, 10_000, "coverage sample targetModelCount");
  return Object.freeze({ schemaVersion: 1, type: "demand.frame-shape-coverage", snapshotId: value.snapshotId, tenantId: value.tenantId, siteId: value.siteId, environment: "production", measuredAt: value.measuredAt, frameShape: value.frameShape, eligibleModelCount: value.eligibleModelCount, targetModelCount: value.targetModelCount });
}

export function parseDemandQueueBuildInput(value: unknown): DemandQueueBuildInput {
  object(value, "demand queue build"); exact(value, ["schemaVersion", "type", "tenantId", "siteId", "environment", "asOf", "evidence", "salesRanks", "inventory", "coverage"], "demand queue build");
  if (value.schemaVersion !== 1 || value.type !== "demand.queue-build") throw new TypeError("demand queue build version or type is unsupported");
  parseScope(value, "demand queue build"); timestamp(value.asOf, "demand queue build asOf");
  array(value.evidence, DEMAND_QUEUE_MAX_EVIDENCE, "demand queue build evidence"); array(value.salesRanks, DEMAND_QUEUE_MAX_SAMPLES, "demand queue build salesRanks"); array(value.inventory, DEMAND_QUEUE_MAX_SAMPLES, "demand queue build inventory"); array(value.coverage, DEMAND_QUEUE_MAX_SAMPLES, "demand queue build coverage");
  return Object.freeze({ schemaVersion: 1, type: "demand.queue-build", tenantId: value.tenantId, siteId: value.siteId, environment: "production", asOf: value.asOf,
    evidence: Object.freeze(value.evidence.map(parseUnavailableDemandEvidence)), salesRanks: Object.freeze(value.salesRanks.map(parseSalesRankSample)),
    inventory: Object.freeze(value.inventory.map(parseInventoryEligibilitySample)), coverage: Object.freeze(value.coverage.map(parseFrameShapeCoverageSample)) });
}

const E2_DEMAND_REASONS: Partial<Record<CatalogUnavailableEvent["reasonCode"], DemandReasonCode>> = {
  REQUESTED_SKU_NOT_FOUND: "E2_REQUESTED_SKU_NOT_FOUND", REQUESTED_SKU_NOT_ACTIVE: "E2_REQUESTED_SKU_NOT_ACTIVE",
  FALLBACK_SKU_NOT_FOUND: "E2_FALLBACK_SKU_NOT_FOUND", FALLBACK_TARGET_NOT_ACTIVE: "E2_FALLBACK_TARGET_NOT_ACTIVE",
};
export function adaptCatalogUnavailableDemand(value: unknown, frameShape: unknown): UnavailableDemandEvidence | null {
  const event = parseCatalogUnavailableEvent(value); shape(frameShape, "catalog unavailable frameShape"); const reasonCode = E2_DEMAND_REASONS[event.reasonCode];
  if (reasonCode === undefined) return null;
  return parseUnavailableDemandEvidence({ schemaVersion: 1, type: "demand.unavailable-evidence", evidenceId: `e2:${event.requestId}`, correlationId: event.requestId, tenantId: event.tenantId, siteId: event.siteId, environment: event.environment, occurredAt: new Date(Date.parse(event.occurredAt)).toISOString(),
    target: { kind: "catalog-sku", sku: event.requestedSku, frameModelId: event.requestedFrameModelId, frameVariantId: event.requestedFrameVariantId, frameShape }, reasonCode });
}
export function adaptCommerceUnavailableDemand(value: unknown, explicitTarget: unknown): UnavailableDemandEvidence | null {
  const event: CommerceEvent = parseCommerceEvent(value);
  if (event.type !== "commerce.error" || !event.payload.recoverable || (event.payload.code !== "CATALOG_UNAVAILABLE" && event.payload.code !== "ASSET_UNAVAILABLE")) return null;
  if (event.environment !== "production") throw new TypeError("commerce unavailable event must be production scoped");
  const supplied = parseDemandTargetIdentity(explicitTarget);
  if (event.product !== null) {
    if (supplied.kind !== "catalog-sku" || supplied.sku !== event.product.sku || supplied.frameModelId !== event.product.frameModelId || supplied.frameVariantId !== event.product.frameVariantId) throw new TypeError("commerce unavailable target relabels product attribution");
  } else if (supplied.kind !== "unresolved-candidate") throw new TypeError("commerce unavailable without product requires unresolved candidate identity");
  return parseUnavailableDemandEvidence({ schemaVersion: 1, type: "demand.unavailable-evidence", evidenceId: `e3:${event.eventId}`, correlationId: event.requestId, tenantId: event.tenantId, siteId: event.siteId, environment: "production", occurredAt: event.occurredAt, target: supplied,
    reasonCode: event.payload.code === "CATALOG_UNAVAILABLE" ? "E3_CATALOG_UNAVAILABLE" : "E3_ASSET_UNAVAILABLE" });
}

function targetKey(target: DemandTargetIdentity): string { return canonicalJson(target); }
function sameScope(value: { tenantId: string; siteId: string; environment: string }, input: DemandQueueBuildInput): boolean { return value.tenantId === input.tenantId && value.siteId === input.siteId && value.environment === input.environment; }
function bindTargetIdentity(target: DemandTargetIdentity, bindings: { skus: Map<string, string>; variants: Map<string, string>; candidates: Map<string, string> }): void {
  const key = targetKey(target); const entries: Array<[Map<string, string>, string]> = target.kind === "catalog-sku" ? [[bindings.skus, target.sku], [bindings.variants, target.frameVariantId]] : [[bindings.candidates, target.candidateId]];
  for (const [map, identity] of entries) { const prior = map.get(identity); if (prior !== undefined && prior !== key) throw new TypeError("demand target identity is relabelled"); map.set(identity, key); }
}
function newestByTarget<T extends { snapshotId: string; measuredAt: string; target: DemandTargetIdentity; tenantId: string; siteId: string; environment: "production" }>(samples: readonly T[], input: DemandQueueBuildInput, label: string): Map<string, T> {
  const ids = new Map<string, string>(); const latest = new Map<string, T>();
  for (const sample of samples) {
    if (!sameScope(sample, input)) throw new TypeError(`${label} crosses the queue scope`);
    if (Date.parse(sample.measuredAt) > Date.parse(input.asOf)) throw new TypeError(`${label} is from the future`);
    const fingerprint = canonicalJson(sample); const priorId = ids.get(sample.snapshotId);
    if (priorId !== undefined && priorId !== fingerprint) throw new TypeError(`${label} snapshot identity is relabelled`); ids.set(sample.snapshotId, fingerprint);
    const key = targetKey(sample.target); const prior = latest.get(key);
    if (!prior || Date.parse(sample.measuredAt) > Date.parse(prior.measuredAt)) latest.set(key, sample);
    else if (Date.parse(sample.measuredAt) === Date.parse(prior.measuredAt) && canonicalJson(sample) !== canonicalJson(prior)) throw new TypeError(`${label} has conflicting samples at one timestamp`);
  }
  return latest;
}

function commandBody(input: DemandQueueBuildInput, windowStart: string, items: readonly DemandQueueItem[], byteLength: number, digest: string): Record<string, unknown> {
  return { schemaVersion: 1, type: "demand.queue-command", tenantId: input.tenantId, siteId: input.siteId, environment: "production", asOf: input.asOf,
    windowStart, policyVersion: "f1-local-v1", itemCount: items.length, byteLength, commandSha256: digest, idempotencyKey: `dqv1_${digest}`,
    operationalStatus: "local-preparation-only", g5Ready: false, items };
}

export async function buildDemandQueue(value: unknown): Promise<DemandQueueBuildResult> {
  const input = parseDemandQueueBuildInput(value); const asOfMs = Date.parse(input.asOf); const windowStartMs = asOfMs - DEMAND_WINDOW_MS;
  if (windowStartMs < MIN_TIME) throw new TypeError("demand window is outside the supported range");
  const bindings = { skus: new Map<string, string>(), variants: new Map<string, string>(), candidates: new Map<string, string>() };
  for (const item of [...input.evidence, ...input.salesRanks, ...input.inventory]) bindTargetIdentity(item.target, bindings);
  const evidenceIds = new Map<string, string>(); const correlations = new Map<string, { targetKey: string; target: DemandTargetIdentity; time: number }>(); let replayCount = 0;
  for (const evidence of input.evidence) {
    if (!sameScope(evidence, input)) throw new TypeError("demand evidence crosses the queue scope"); const time = Date.parse(evidence.occurredAt);
    if (time > asOfMs) throw new TypeError("demand evidence is from the future");
    const fingerprint = canonicalJson(evidence); const prior = evidenceIds.get(evidence.evidenceId);
    if (prior !== undefined) { if (prior !== fingerprint) throw new TypeError("demand evidence identity is relabelled"); replayCount += 1; continue; }
    evidenceIds.set(evidence.evidenceId, fingerprint); const key = targetKey(evidence.target); const correlated = correlations.get(evidence.correlationId);
    if (correlated) { if (correlated.targetKey !== key) throw new TypeError("demand correlation identity is relabelled"); correlated.time = Math.min(correlated.time, time); replayCount += 1; }
    else correlations.set(evidence.correlationId, { targetKey: key, target: evidence.target, time });
  }
  const grouped = new Map<string, { target: DemandTargetIdentity; times: number[] }>();
  for (const correlated of correlations.values()) { if (correlated.time < windowStartMs) continue; const group = grouped.get(correlated.targetKey) ?? { target: correlated.target, times: [] }; group.times.push(correlated.time); grouped.set(correlated.targetKey, group); }
  const sales = newestByTarget(input.salesRanks, input, "sales rank sample"); const inventory = newestByTarget(input.inventory, input, "inventory sample");
  const coverageIds = new Map<string, string>(); const coverage = new Map<FrameShape, FrameShapeCoverageSample>();
  for (const sample of input.coverage) {
    if (!sameScope(sample, input)) throw new TypeError("coverage sample crosses the queue scope"); if (Date.parse(sample.measuredAt) > asOfMs) throw new TypeError("coverage sample is from the future");
    const fingerprint = canonicalJson(sample); const priorId = coverageIds.get(sample.snapshotId); if (priorId !== undefined && priorId !== fingerprint) throw new TypeError("coverage snapshot identity is relabelled"); coverageIds.set(sample.snapshotId, fingerprint);
    const prior = coverage.get(sample.frameShape); if (!prior || Date.parse(sample.measuredAt) > Date.parse(prior.measuredAt)) coverage.set(sample.frameShape, sample);
    else if (Date.parse(sample.measuredAt) === Date.parse(prior.measuredAt) && fingerprint !== canonicalJson(prior)) throw new TypeError("coverage has conflicting samples at one timestamp");
  }
  const candidates: Array<{ item: Omit<DemandQueueItem, "position">; eligibilityReasons: DemandEligibilityReason[] }> = []; const decisions: DemandQueueDecision[] = [];
  for (const [key, group] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    group.times.sort((a, b) => a - b); const inv = inventory.get(key); const eligibilityReasons: DemandEligibilityReason[] = [];
    if (!inv) eligibilityReasons.push("INVENTORY_MISSING");
    else if (asOfMs - Date.parse(inv.measuredAt) > INVENTORY_MAX_AGE_MS) eligibilityReasons.push("INVENTORY_STALE");
    else { if (inv.continuity === "unknown") eligibilityReasons.push("CONTINUITY_UNKNOWN"); else if (inv.continuity === "discontinuous") eligibilityReasons.push("DISCONTINUOUS"); if (inv.stock === "unknown") eligibilityReasons.push("STOCK_UNKNOWN"); else if (inv.stock === "out-of-stock") eligibilityReasons.push("OUT_OF_STOCK"); }
    if (eligibilityReasons.length > 0) { decisions.push(Object.freeze({ target: group.target, demandCount: group.times.length, eligibility: "ineligible", queueStatus: "ineligible", eligibilityReasons: Object.freeze(eligibilityReasons) })); continue; }
    eligibilityReasons.push("ELIGIBLE_FRESH_CONTINUOUS_IN_STOCK"); const priorityReasons: DemandPriorityReason[] = ["DEMAND_COUNT"];
    const rank = sales.get(key); let rankValue: number | null = null; let rankStatus: DemandQueueItem["salesRankStatus"] = "missing"; let rankPoints = 0;
    if (!rank) priorityReasons.push("SALES_RANK_MISSING"); else if (asOfMs - Date.parse(rank.measuredAt) > SALES_RANK_MAX_AGE_MS) { rankStatus = "stale"; priorityReasons.push("SALES_RANK_STALE"); }
    else { rankValue = rank.rank; rankStatus = "fresh"; rankPoints = Math.max(0, 101 - Math.ceil(rank.rank / 100)); priorityReasons.push("SALES_RANK_FRESH"); }
    const shapeCoverage = coverage.get(group.target.frameShape); let coverageStatus: DemandQueueItem["coverageStatus"] = "missing"; let coveragePoints = 0;
    if (!shapeCoverage) priorityReasons.push("SHAPE_COVERAGE_MISSING"); else if (asOfMs - Date.parse(shapeCoverage.measuredAt) > COVERAGE_MAX_AGE_MS) { coverageStatus = "stale"; priorityReasons.push("SHAPE_COVERAGE_STALE"); }
    else if (shapeCoverage.eligibleModelCount < shapeCoverage.targetModelCount) { coverageStatus = "underrepresented"; coveragePoints = 25; priorityReasons.push("SHAPE_UNDERREPRESENTED"); }
    else { coverageStatus = "sufficient"; priorityReasons.push("SHAPE_COVERAGE_SUFFICIENT"); }
    const item = Object.freeze({ target: group.target, priorityScore: group.times.length * 1_000 + rankPoints + coveragePoints, demandCount: group.times.length,
      firstDemandAt: new Date(group.times[0]!).toISOString(), lastDemandAt: new Date(group.times.at(-1)!).toISOString(), salesRank: rankValue, salesRankStatus: rankStatus, coverageStatus,
      eligibilityReasons: Object.freeze(eligibilityReasons), priorityReasons: Object.freeze(priorityReasons) });
    candidates.push({ item, eligibilityReasons });
  }
  candidates.sort((a, b) => b.item.priorityScore - a.item.priorityScore || Date.parse(a.item.firstDemandAt) - Date.parse(b.item.firstDemandAt) || targetKey(a.item.target).localeCompare(targetKey(b.item.target)));
  const selected = candidates.slice(0, DEMAND_QUEUE_MAX_ITEMS); const selectedKeys = new Set(selected.map(({ item }) => targetKey(item.target)));
  const items: DemandQueueItem[] = selected.map(({ item }, index) => Object.freeze({ position: index + 1, ...item }));
  for (const { item, eligibilityReasons } of candidates) decisions.push(Object.freeze({ target: item.target, demandCount: item.demandCount, eligibility: "eligible", queueStatus: selectedKeys.has(targetKey(item.target)) ? "queued" : "capacity-excluded", eligibilityReasons: Object.freeze(eligibilityReasons) }));
  decisions.sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)));
  const windowStart = new Date(windowStartMs).toISOString(); let byteLength = 0;
  for (let iteration = 0; iteration < 8; iteration += 1) { const next = new TextEncoder().encode(canonicalJson(commandBody(input, windowStart, items, byteLength, DIGEST_PLACEHOLDER))).byteLength; if (next === byteLength) break; byteLength = next; }
  const commandSha256 = await sha256Hex(canonicalJson(commandBody(input, windowStart, items, byteLength, DIGEST_PLACEHOLDER))); const command = Object.freeze(commandBody(input, windowStart, Object.freeze(items), byteLength, commandSha256)) as DemandQueueCommand;
  const actual = new TextEncoder().encode(canonicalJson(command)).byteLength; if (actual !== byteLength || actual > DEMAND_QUEUE_MAX_BYTES) throw new TypeError("demand queue command exceeds its canonical byte budget");
  return Object.freeze({ command, decisions: Object.freeze(decisions), replayCount });
}

export async function parseDemandQueueCommand(value: unknown): Promise<DemandQueueCommand> {
  object(value, "demand queue command"); exact(value, ["schemaVersion", "type", "tenantId", "siteId", "environment", "asOf", "windowStart", "policyVersion", "itemCount", "byteLength", "commandSha256", "idempotencyKey", "operationalStatus", "g5Ready", "items"], "demand queue command");
  if (value.schemaVersion !== 1 || value.type !== "demand.queue-command" || value.policyVersion !== "f1-local-v1" || value.operationalStatus !== "local-preparation-only" || value.g5Ready !== false) throw new TypeError("demand queue command authority fields are invalid");
  parseScope(value, "demand queue command"); timestamp(value.asOf, "demand queue command asOf"); timestamp(value.windowStart, "demand queue command windowStart");
  if (Date.parse(value.asOf) - Date.parse(value.windowStart) !== DEMAND_WINDOW_MS) throw new TypeError("demand queue command window is invalid"); array(value.items, DEMAND_QUEUE_MAX_ITEMS, "demand queue command items"); safeInteger(value.itemCount, 0, DEMAND_QUEUE_MAX_ITEMS, "demand queue command itemCount"); safeInteger(value.byteLength, 1, DEMAND_QUEUE_MAX_BYTES, "demand queue command byteLength");
  if (value.itemCount !== value.items.length || typeof value.commandSha256 !== "string" || !SHA256.test(value.commandSha256) || value.idempotencyKey !== `dqv1_${value.commandSha256}`) throw new TypeError("demand queue command derived fields are invalid");
  const items = Object.freeze(value.items.map((raw, index) => {
    object(raw, `demand queue item ${index}`); exact(raw, ["position", "target", "priorityScore", "demandCount", "firstDemandAt", "lastDemandAt", "salesRank", "salesRankStatus", "coverageStatus", "eligibilityReasons", "priorityReasons"], `demand queue item ${index}`);
    safeInteger(raw.position, 1, DEMAND_QUEUE_MAX_ITEMS, `demand queue item ${index} position`); if (raw.position !== index + 1) throw new TypeError("demand queue item positions are not contiguous");
    const target = parseDemandTargetIdentity(raw.target); safeInteger(raw.priorityScore, 1_000, DEMAND_QUEUE_MAX_EVIDENCE * 1_000 + 125, `demand queue item ${index} priorityScore`); safeInteger(raw.demandCount, 1, DEMAND_QUEUE_MAX_EVIDENCE, `demand queue item ${index} demandCount`);
    timestamp(raw.firstDemandAt, `demand queue item ${index} firstDemandAt`); timestamp(raw.lastDemandAt, `demand queue item ${index} lastDemandAt`); if (Date.parse(raw.firstDemandAt) < Date.parse(value.windowStart as string) || Date.parse(raw.firstDemandAt) > Date.parse(raw.lastDemandAt) || Date.parse(raw.lastDemandAt) > Date.parse(value.asOf as string)) throw new TypeError("demand queue item time range is invalid");
    if (raw.salesRank !== null) safeInteger(raw.salesRank, 1, 1_000_000, `demand queue item ${index} salesRank`); if (!["fresh", "missing", "stale"].includes(raw.salesRankStatus as string) || (raw.salesRankStatus === "fresh") !== (raw.salesRank !== null)) throw new TypeError("demand queue item sales rank state is invalid");
    if (!["underrepresented", "sufficient", "missing", "stale"].includes(raw.coverageStatus as string)) throw new TypeError("demand queue item coverage state is invalid");
    array(raw.eligibilityReasons, ELIGIBILITY_REASONS.length, `demand queue item ${index} eligibilityReasons`); array(raw.priorityReasons, PRIORITY_REASONS.length, `demand queue item ${index} priorityReasons`);
    const expectedReasons: DemandPriorityReason[] = ["DEMAND_COUNT", raw.salesRankStatus === "fresh" ? "SALES_RANK_FRESH" : raw.salesRankStatus === "stale" ? "SALES_RANK_STALE" : "SALES_RANK_MISSING",
      raw.coverageStatus === "underrepresented" ? "SHAPE_UNDERREPRESENTED" : raw.coverageStatus === "sufficient" ? "SHAPE_COVERAGE_SUFFICIENT" : raw.coverageStatus === "stale" ? "SHAPE_COVERAGE_STALE" : "SHAPE_COVERAGE_MISSING"];
    const expectedScore = (raw.demandCount as number) * 1_000 + (raw.salesRankStatus === "fresh" ? Math.max(0, 101 - Math.ceil((raw.salesRank as number) / 100)) : 0) + (raw.coverageStatus === "underrepresented" ? 25 : 0);
    if (raw.eligibilityReasons.length !== 1 || raw.eligibilityReasons[0] !== "ELIGIBLE_FRESH_CONTINUOUS_IN_STOCK" || raw.priorityReasons.length !== expectedReasons.length || raw.priorityReasons.some((reason, reasonIndex) => reason !== expectedReasons[reasonIndex]) || raw.priorityScore !== expectedScore) throw new TypeError("demand queue item reasons or score are inconsistent");
    return Object.freeze({ position: raw.position, target, priorityScore: raw.priorityScore, demandCount: raw.demandCount, firstDemandAt: raw.firstDemandAt, lastDemandAt: raw.lastDemandAt,
      salesRank: raw.salesRank as number | null, salesRankStatus: raw.salesRankStatus as DemandQueueItem["salesRankStatus"], coverageStatus: raw.coverageStatus as DemandQueueItem["coverageStatus"],
      eligibilityReasons: Object.freeze([...(raw.eligibilityReasons as DemandEligibilityReason[])]), priorityReasons: Object.freeze([...(raw.priorityReasons as DemandPriorityReason[])]) });
  }));
  const commandBindings = { skus: new Map<string, string>(), variants: new Map<string, string>(), candidates: new Map<string, string>() }; const commandTargets = new Set<string>(); let totalDemand = 0;
  for (const item of items) { const key = targetKey(item.target); if (commandTargets.has(key)) throw new TypeError("demand queue command contains a duplicate target"); commandTargets.add(key); bindTargetIdentity(item.target, commandBindings); totalDemand += item.demandCount; }
  if (totalDemand > DEMAND_QUEUE_MAX_EVIDENCE) throw new TypeError("demand queue command demand count exceeds its evidence budget");
  for (let index = 1; index < items.length; index += 1) { const priorItem = items[index - 1]!; const item = items[index]!; if (priorItem.priorityScore < item.priorityScore || (priorItem.priorityScore === item.priorityScore && (Date.parse(priorItem.firstDemandAt) > Date.parse(item.firstDemandAt) || (priorItem.firstDemandAt === item.firstDemandAt && targetKey(priorItem.target).localeCompare(targetKey(item.target)) > 0)))) throw new TypeError("demand queue item order is invalid"); }
  const normalized = Object.freeze({ schemaVersion: 1, type: "demand.queue-command", tenantId: value.tenantId as string, siteId: value.siteId as string, environment: "production", asOf: value.asOf as string, windowStart: value.windowStart as string,
    policyVersion: "f1-local-v1", itemCount: value.itemCount as number, byteLength: value.byteLength as number, commandSha256: value.commandSha256, idempotencyKey: value.idempotencyKey as string,
    operationalStatus: "local-preparation-only", g5Ready: false, items }) satisfies DemandQueueCommand;
  const projected = { ...normalized, commandSha256: DIGEST_PLACEHOLDER, idempotencyKey: `dqv1_${DIGEST_PLACEHOLDER}` }; const digest = await sha256Hex(canonicalJson(projected));
  if (digest !== normalized.commandSha256 || new TextEncoder().encode(canonicalJson(normalized)).byteLength !== normalized.byteLength) throw new TypeError("demand queue command canonical identity is invalid");
  return normalized;
}
export async function serializeDemandQueueCommand(value: unknown): Promise<Uint8Array> { const command = await parseDemandQueueCommand(value); return new TextEncoder().encode(canonicalJson(command)); }
