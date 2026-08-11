import {
  bindGenerationJobEvent,
  canonicalJson,
  deriveGenerationJobIdentity,
  MAX_GENERATION_JOB_CLAIM_LEASE_MS,
  parseGenerationJobRequest,
  parseGenerationJobReplayContext,
  verifyGenerationJobEvent,
  type GenerationJobEvent,
  type GenerationJobEventPayload,
  type GenerationJobEventType,
  type GenerationJobIdentity,
  type GenerationJobOutputEvidence,
  type GenerationJobRequest,
  type GenerationJobStatus,
  type RetryClassification,
} from "../../contracts/src/index.js";

export const ALLOWED_GENERATION_JOB_TRANSITIONS: Readonly<Record<GenerationJobStatus, readonly GenerationJobEventType[]>> = {
  queued: ["claimed", "cancelled"],
  running: ["lease-recovered", "output-recorded", "failed", "cancelled"],
  review: ["completed", "cancelled"],
  failed: ["retry-queued"],
  completed: [],
  cancelled: [],
};

export type GenerationJobClaim = { workerId: string; claimToken: string; claimedAt: string; leaseExpiresAt: string };
export type GenerationJobFailure = { eventSha256: string; errorCode: string; retryClassification: RetryClassification };

export type GenerationJobState = GenerationJobIdentity & {
  schemaVersion: 1;
  request: GenerationJobRequest;
  status: GenerationJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  claim: GenerationJobClaim | null;
  output: GenerationJobOutputEvidence | null;
  failure: GenerationJobFailure | null;
  sequence: number;
  headEventSha256: string;
};

function at(value: string): number { return Date.parse(value); }
function sameOutput(left: GenerationJobOutputEvidence, right: GenerationJobOutputEvidence): boolean { return canonicalJson(left) === canonicalJson(right); }
function invalid(state: GenerationJobState, event: GenerationJobEvent, reason?: string): never {
  throw new TypeError(reason ?? `${event.eventType} is invalid from ${state.status}`);
}

function assertIdentity(state: GenerationJobState, event: GenerationJobEvent): void {
  for (const key of ["jobId", "idempotencyKey", "canonicalInputSha256", "tenantId", "frameModelId"] as const) {
    if (event[key] !== state[key]) invalid(state, event, `event.${key} cannot substitute job identity`);
  }
  if (event.sequence !== state.sequence + 1) invalid(state, event, "event.sequence must be contiguous");
  if (event.previousEventSha256 !== state.headEventSha256) invalid(state, event, "event.previousEventSha256 must match the replay head");
  if (at(event.occurredAt) <= at(state.updatedAt)) invalid(state, event, "event.occurredAt must increase strictly");
}

function runningPayload(state: GenerationJobState, event: GenerationJobEvent): { workerId: string; claimToken: string } {
  if (!state.claim) invalid(state, event, "running state is missing claim evidence");
  const payload = event.payload as { workerId: string | null; claimToken: string | null };
  if (payload.workerId !== state.claim.workerId || payload.claimToken !== state.claim.claimToken) invalid(state, event, "event claim evidence is stale or belongs to another worker");
  if (at(event.occurredAt) >= at(state.claim.leaseExpiresAt)) invalid(state, event, "event claim lease is expired");
  return payload as { workerId: string; claimToken: string };
}

export function reduceGenerationJob(state: GenerationJobState, event: GenerationJobEvent): GenerationJobState {
  assertIdentity(state, event);
  if (!ALLOWED_GENERATION_JOB_TRANSITIONS[state.status].includes(event.eventType)) invalid(state, event);
  const next = { ...state, updatedAt: event.occurredAt, sequence: event.sequence, headEventSha256: event.eventSha256 };
  switch (event.eventType) {
    case "queued": return invalid(state, event, "queued genesis cannot appear after sequence 1");
    case "claimed": {
      if (state.attempts >= state.maxAttempts) return invalid(state, event, "maximum attempts are exhausted");
      const payload = event.payload as { workerId: string; claimToken: string; leaseExpiresAt: string };
      const leaseDuration = at(payload.leaseExpiresAt) - at(event.occurredAt);
      if (leaseDuration <= 0) return invalid(state, event, "claim lease must expire after the claim timestamp");
      if (leaseDuration > MAX_GENERATION_JOB_CLAIM_LEASE_MS) return invalid(state, event, "claim lease exceeds the maximum duration");
      return { ...next, status: "running", attempts: state.attempts + 1, claim: { workerId: payload.workerId, claimToken: payload.claimToken, claimedAt: event.occurredAt, leaseExpiresAt: payload.leaseExpiresAt }, failure: null };
    }
    case "lease-recovered": {
      if (!state.claim) return invalid(state, event, "running state is missing claim evidence");
      const payload = event.payload as { workerId: string; claimToken: string; expiredLeaseAt: string };
      if (payload.workerId !== state.claim.workerId || payload.claimToken !== state.claim.claimToken || payload.expiredLeaseAt !== state.claim.leaseExpiresAt) return invalid(state, event, "lease recovery must bind the exact expired claim");
      if (at(event.occurredAt) < at(state.claim.leaseExpiresAt)) return invalid(state, event, "lease cannot be recovered before expiry");
      return { ...next, status: "queued", claim: null };
    }
    case "output-recorded": {
      runningPayload(state, event);
      const payload = event.payload as { output: GenerationJobOutputEvidence };
      return { ...next, status: "review", claim: null, output: structuredClone(payload.output), failure: null };
    }
    case "failed": {
      runningPayload(state, event);
      const payload = event.payload as { errorCode: string; retryClassification: RetryClassification };
      return { ...next, status: "failed", claim: null, failure: { eventSha256: event.eventSha256, errorCode: payload.errorCode, retryClassification: payload.retryClassification } };
    }
    case "retry-queued": {
      const payload = event.payload as { failureEventSha256: string };
      if (!state.failure || state.failure.retryClassification !== "retryable") return invalid(state, event, "only an explicitly retryable failure can be queued again");
      if (payload.failureEventSha256 !== state.failure.eventSha256) return invalid(state, event, "retry must bind the current failure event");
      if (state.attempts >= state.maxAttempts) return invalid(state, event, "maximum attempts are exhausted");
      return { ...next, status: "queued" };
    }
    case "cancelled": {
      const payload = event.payload as { workerId: string | null; claimToken: string | null };
      if (state.status === "running") runningPayload(state, event);
      else if (payload.workerId !== null || payload.claimToken !== null) return invalid(state, event, "non-running cancellation must not carry claim authority");
      return { ...next, status: "cancelled", claim: null };
    }
    case "completed": {
      const payload = event.payload as { output: GenerationJobOutputEvidence };
      if (!state.output || !sameOutput(state.output, payload.output)) return invalid(state, event, "completion must bind the immutable reviewed output evidence");
      return { ...next, status: "completed" };
    }
  }
}

async function genesis(value: GenerationJobEvent): Promise<GenerationJobState> {
  if (value.eventType !== "queued" || value.sequence !== 1 || value.previousEventSha256 !== null) throw new TypeError("ledger must begin with queued sequence 1 and no previous digest");
  const request = parseGenerationJobRequest((value.payload as { request: unknown }).request);
  const derived = await deriveGenerationJobIdentity(request);
  for (const key of ["jobId", "idempotencyKey", "canonicalInputSha256", "tenantId", "frameModelId"] as const) if (value[key] !== derived.identity[key]) throw new TypeError(`genesis event.${key} does not match canonical request identity`);
  if (value.occurredAt !== request.createdAt) throw new TypeError("genesis event timestamp must equal request.createdAt");
  return { schemaVersion: 1, ...derived.identity, request, status: "queued", attempts: 0, maxAttempts: request.maxAttempts, createdAt: request.createdAt, updatedAt: value.occurredAt, claim: null, output: null, failure: null, sequence: 1, headEventSha256: value.eventSha256 };
}

export async function replayGenerationJobLedger(values: readonly unknown[], contextValue: unknown): Promise<GenerationJobState> {
  if (values.length === 0) throw new TypeError("ledger must contain at least one event");
  const context = parseGenerationJobReplayContext(contextValue);
  const evaluationTime = at(context.evaluatedAt);
  const digests = new Set<string>();
  const verified: GenerationJobEvent[] = [];
  for (const value of values) {
    const event = await verifyGenerationJobEvent(value);
    if (at(event.occurredAt) > evaluationTime) throw new TypeError("ledger contains future event evidence");
    if (event.eventType === "lease-recovered" && at((event.payload as { expiredLeaseAt: string }).expiredLeaseAt) > evaluationTime) throw new TypeError("ledger contains future lease evidence");
    if (digests.has(event.eventSha256)) throw new TypeError("ledger contains a duplicate event digest");
    digests.add(event.eventSha256); verified.push(event);
  }
  let state = await genesis(verified[0]!);
  for (const event of verified.slice(1)) state = reduceGenerationJob(state, event);
  return state;
}

export async function createQueuedGenerationJobEvent(value: unknown): Promise<GenerationJobEvent> {
  const derived = await deriveGenerationJobIdentity(value);
  return bindGenerationJobEvent({ schemaVersion: 1, eventType: "queued", sequence: 1, occurredAt: derived.request.createdAt, previousEventSha256: null, ...derived.identity, payload: { request: derived.request } });
}

export async function appendGenerationJobEvent(state: GenerationJobState, eventType: Exclude<GenerationJobEventType, "queued">, occurredAt: string, payload: GenerationJobEventPayload): Promise<GenerationJobEvent> {
  return bindGenerationJobEvent({ schemaVersion: 1, eventType, sequence: state.sequence + 1, occurredAt, previousEventSha256: state.headEventSha256, jobId: state.jobId, idempotencyKey: state.idempotencyKey, canonicalInputSha256: state.canonicalInputSha256, tenantId: state.tenantId, frameModelId: state.frameModelId, payload });
}
