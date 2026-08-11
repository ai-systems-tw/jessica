import { canonicalJson, parseBatchCaptureEvent, replayBatchCapture, type BatchCaptureBinding, type BatchCaptureEvent } from "../../contracts/src/index.js";

export type PrivateRawCaptureCapability = Readonly<{ kind: "private-raw-capture-capability" }>;
type Grant = Readonly<BatchCaptureBinding & { capabilityId: string; itemId: string; localRawRef: string; expiresAt: string }>;
const grants = new WeakMap<object, Grant>();

function safeGrant(value: unknown): Grant {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("raw capture grant must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(value); if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || descriptor.get || descriptor.set)) throw new TypeError("raw capture grant fields are invalid");
  const keys = ["tenantId", "siteId", "environment", "operatorSessionId", "batchId", "capabilityId", "itemId", "localRawRef", "expiresAt"];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError("raw capture grant fields are invalid");
  const candidate = value as Record<string, unknown>;
  const probe = parseBatchCaptureEvent({ schemaVersion: 1, type: "batch.raw-capture-recorded", eventId: "grant-probe", sequence: 1, occurredAt: "2026-01-01T00:00:00.000Z", tenantId: candidate.tenantId, siteId: candidate.siteId, environment: candidate.environment, operatorSessionId: candidate.operatorSessionId, batchId: candidate.batchId, itemId: candidate.itemId, captureId: "grant-probe", localRawRef: candidate.localRawRef, capabilityId: candidate.capabilityId });
  if (probe.type !== "batch.raw-capture-recorded") throw new TypeError("raw capture grant is invalid");
  const expiry = typeof candidate.expiresAt === "string" ? Date.parse(candidate.expiresAt) : Number.NaN;
  if (typeof candidate.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate.expiresAt) || !Number.isFinite(expiry) || expiry < Date.parse("2020-01-01T00:00:00.000Z") || expiry > Date.parse("2100-01-01T00:00:00.000Z")) throw new TypeError("raw capture grant expiry is invalid");
  return Object.freeze({ tenantId: probe.tenantId, siteId: probe.siteId, environment: "production", operatorSessionId: probe.operatorSessionId, batchId: probe.batchId, capabilityId: probe.capabilityId, itemId: probe.itemId, localRawRef: probe.localRawRef, expiresAt: candidate.expiresAt });
}
export function issuePrivateRawCaptureCapability(value: unknown): PrivateRawCaptureCapability {
  const grant = safeGrant(value); const capability = Object.freeze({ kind: "private-raw-capture-capability" as const }); grants.set(capability, grant); return capability;
}

function sameBinding(event: BatchCaptureEvent, grant: Grant): boolean { return event.tenantId === grant.tenantId && event.siteId === grant.siteId && event.environment === grant.environment && event.operatorSessionId === grant.operatorSessionId && event.batchId === grant.batchId; }
export function appendAuthorizedRawCapture(logValue: unknown, eventValue: unknown, capability: PrivateRawCaptureCapability, nowValue: unknown): readonly BatchCaptureEvent[] {
  if (!(nowValue instanceof Date) || Object.getPrototypeOf(nowValue) !== Date.prototype || !Number.isFinite(nowValue.getTime())) throw new TypeError("raw capture clock is invalid");
  if (!Array.isArray(logValue) || Object.getPrototypeOf(logValue) !== Array.prototype) throw new TypeError("batch log is invalid"); const prior = logValue.map(parseBatchCaptureEvent); const state = replayBatchCapture(prior);
  const event = parseBatchCaptureEvent(eventValue); if (event.type !== "batch.raw-capture-recorded") throw new TypeError("raw capture event exceeds capability authority");
  const replay = prior.find((candidate) => candidate.eventId === event.eventId); if (replay) { if (canonicalJson(replay) !== canonicalJson(event)) throw new TypeError("raw capture event identity is relabelled"); return Object.freeze(prior); }
  const grant = grants.get(capability as object); if (!grant) throw new TypeError("raw capture capability is not authorized");
  if (!sameBinding(event, grant) || event.itemId !== grant.itemId || event.localRawRef !== grant.localRawRef || event.capabilityId !== grant.capabilityId) throw new TypeError("raw capture event exceeds capability authority");
  if (!state.activeItem || state.activeItem.product.itemId !== grant.itemId || event.sequence !== state.revision + 1 || nowValue.getTime() > Date.parse(grant.expiresAt) || Date.parse(event.occurredAt) > nowValue.getTime()) throw new TypeError("raw capture capability is stale");
  const next = Object.freeze([...prior, event]); replayBatchCapture(next); grants.delete(capability as object); return next;
}

export function appendBatchCaptureEvent(logValue: unknown, eventValue: unknown): readonly BatchCaptureEvent[] {
  if (!Array.isArray(logValue) || Object.getPrototypeOf(logValue) !== Array.prototype) throw new TypeError("batch log is invalid"); const prior = logValue.map(parseBatchCaptureEvent); if (prior.length > 0) replayBatchCapture(prior);
  const event = parseBatchCaptureEvent(eventValue); if (event.type === "batch.raw-capture-recorded") throw new TypeError("raw capture event requires explicit capability");
  const replay = prior.find((candidate) => candidate.eventId === event.eventId); if (replay) { if (canonicalJson(replay) !== canonicalJson(event)) throw new TypeError("batch event identity is relabelled"); return Object.freeze(prior); }
  const next = Object.freeze([...prior, event]); replayBatchCapture(next); return next;
}
