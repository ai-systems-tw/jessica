export const GENERATION_JOB_METHODS = ["proxy-auto", "standard-auto", "manual", "external"] as const;
export const GENERATION_JOB_STATUSES = ["queued", "running", "review", "failed", "completed", "cancelled"] as const;
export const GENERATION_JOB_EVENT_TYPES = ["queued", "claimed", "lease-recovered", "output-recorded", "failed", "retry-queued", "cancelled", "completed"] as const;

export type GenerationJobMethod = (typeof GENERATION_JOB_METHODS)[number];
export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];
export type GenerationJobEventType = (typeof GENERATION_JOB_EVENT_TYPES)[number];
export type RetryClassification = "retryable" | "terminal";

export type GenerationJobRequest = {
  schemaVersion: 1;
  tenantId: string;
  frameModelId: string;
  method: GenerationJobMethod;
  generator: { id: string; version: string; configSha256: string };
  sourceAssetSha256s: readonly string[];
  measurementSetSha256: string;
  generatorInputSha256: string;
  maxAttempts: number;
  createdAt: string;
};

export type GenerationJobIdentity = {
  jobId: string;
  idempotencyKey: string;
  canonicalInputSha256: string;
  tenantId: string;
  frameModelId: string;
};

export type GenerationJobEventPayload =
  | { request: GenerationJobRequest }
  | { workerId: string; claimToken: string; leaseExpiresAt: string }
  | { workerId: string; claimToken: string; expiredLeaseAt: string }
  | { workerId: string; claimToken: string; output: GenerationJobOutputEvidence }
  | { workerId: string; claimToken: string; errorCode: string; retryClassification: RetryClassification }
  | { failureEventSha256: string }
  | { workerId: string | null; claimToken: string | null; reasonCode: string }
  | { output: GenerationJobOutputEvidence };

export type GenerationJobOutputEvidence = {
  manifestSha256: string;
  modelSha256: string;
  manifestByteLength: number;
  modelByteLength: number;
};

export type GenerationJobEvent = GenerationJobIdentity & {
  schemaVersion: 1;
  eventType: GenerationJobEventType;
  sequence: number;
  occurredAt: string;
  previousEventSha256: string | null;
  payload: GenerationJobEventPayload;
  eventSha256: string;
};

export type GenerationJobReplayContext = { evaluatedAt: string };
export const MAX_GENERATION_JOB_CLAIM_LEASE_MS = 15 * 60 * 1_000;

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

function parseOutput(value: unknown, path: string): void {
  object(value, path);
  exact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], path);
  hash(value.manifestSha256, `${path}.manifestSha256`);
  hash(value.modelSha256, `${path}.modelSha256`);
  positiveInteger(value.manifestByteLength, `${path}.manifestByteLength`);
  positiveInteger(value.modelByteLength, `${path}.modelByteLength`);
}

export function parseGenerationJobRequest(value: unknown): GenerationJobRequest {
  object(value, "request");
  exact(value, ["schemaVersion", "tenantId", "frameModelId", "method", "generator", "sourceAssetSha256s", "measurementSetSha256", "generatorInputSha256", "maxAttempts", "createdAt"], "request");
  if (value.schemaVersion !== 1) throw new TypeError("request.schemaVersion must equal 1");
  identifier(value.tenantId, "request.tenantId"); identifier(value.frameModelId, "request.frameModelId");
  if (!GENERATION_JOB_METHODS.includes(value.method as GenerationJobMethod)) throw new TypeError("request.method is unsupported");
  object(value.generator, "request.generator"); exact(value.generator, ["id", "version", "configSha256"], "request.generator");
  identifier(value.generator.id, "request.generator.id"); identifier(value.generator.version, "request.generator.version"); hash(value.generator.configSha256, "request.generator.configSha256");
  if (!Array.isArray(value.sourceAssetSha256s) || value.sourceAssetSha256s.length === 0) throw new TypeError("request.sourceAssetSha256s must be a non-empty array");
  value.sourceAssetSha256s.forEach((item, index) => hash(item, `request.sourceAssetSha256s.${index}`));
  if (new Set(value.sourceAssetSha256s).size !== value.sourceAssetSha256s.length) throw new TypeError("request.sourceAssetSha256s must not contain duplicates");
  hash(value.measurementSetSha256, "request.measurementSetSha256"); hash(value.generatorInputSha256, "request.generatorInputSha256");
  positiveInteger(value.maxAttempts, "request.maxAttempts"); timestamp(value.createdAt, "request.createdAt");
  const request = structuredClone(value) as unknown as GenerationJobRequest;
  (request as unknown as { sourceAssetSha256s: string[] }).sourceAssetSha256s.sort();
  return request;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("canonical JSON does not support undefined");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export async function deriveGenerationJobIdentity(value: unknown): Promise<{ request: GenerationJobRequest; identity: GenerationJobIdentity }> {
  const request = parseGenerationJobRequest(value);
  const processingIdentity = {
    schemaVersion: request.schemaVersion,
    tenantId: request.tenantId,
    frameModelId: request.frameModelId,
    method: request.method,
    generator: request.generator,
    sourceAssetSha256s: request.sourceAssetSha256s,
    measurementSetSha256: request.measurementSetSha256,
    generatorInputSha256: request.generatorInputSha256,
  };
  const canonicalInputSha256 = await sha256Hex(canonicalJson(processingIdentity));
  return { request, identity: { jobId: `gj_${canonicalInputSha256}`, idempotencyKey: `gjv1_${canonicalInputSha256}`, canonicalInputSha256, tenantId: request.tenantId, frameModelId: request.frameModelId } };
}

function parsePayload(eventType: GenerationJobEventType, value: unknown): void {
  const path = "event.payload"; object(value, path);
  if (eventType === "queued") { exact(value, ["request"], path); parseGenerationJobRequest(value.request); return; }
  if (eventType === "claimed") {
    exact(value, ["workerId", "claimToken", "leaseExpiresAt"], path); identifier(value.workerId, `${path}.workerId`); identifier(value.claimToken, `${path}.claimToken`); timestamp(value.leaseExpiresAt, `${path}.leaseExpiresAt`); return;
  }
  if (eventType === "lease-recovered") {
    exact(value, ["workerId", "claimToken", "expiredLeaseAt"], path); identifier(value.workerId, `${path}.workerId`); identifier(value.claimToken, `${path}.claimToken`); timestamp(value.expiredLeaseAt, `${path}.expiredLeaseAt`); return;
  }
  if (eventType === "output-recorded") {
    exact(value, ["workerId", "claimToken", "output"], path); identifier(value.workerId, `${path}.workerId`); identifier(value.claimToken, `${path}.claimToken`); parseOutput(value.output, `${path}.output`); return;
  }
  if (eventType === "failed") {
    exact(value, ["workerId", "claimToken", "errorCode", "retryClassification"], path); identifier(value.workerId, `${path}.workerId`); identifier(value.claimToken, `${path}.claimToken`); identifier(value.errorCode, `${path}.errorCode`);
    if (value.retryClassification !== "retryable" && value.retryClassification !== "terminal") throw new TypeError(`${path}.retryClassification is unsupported`); return;
  }
  if (eventType === "retry-queued") { exact(value, ["failureEventSha256"], path); hash(value.failureEventSha256, `${path}.failureEventSha256`); return; }
  if (eventType === "cancelled") {
    exact(value, ["workerId", "claimToken", "reasonCode"], path);
    if (value.workerId !== null) identifier(value.workerId, `${path}.workerId`); if (value.claimToken !== null) identifier(value.claimToken, `${path}.claimToken`); identifier(value.reasonCode, `${path}.reasonCode`); return;
  }
  exact(value, ["output"], path); parseOutput(value.output, `${path}.output`);
}

export function parseGenerationJobEvent(value: unknown): GenerationJobEvent {
  object(value, "event");
  exact(value, ["schemaVersion", "eventType", "sequence", "occurredAt", "previousEventSha256", "jobId", "idempotencyKey", "canonicalInputSha256", "tenantId", "frameModelId", "payload", "eventSha256"], "event");
  if (value.schemaVersion !== 1) throw new TypeError("event.schemaVersion must equal 1");
  if (!GENERATION_JOB_EVENT_TYPES.includes(value.eventType as GenerationJobEventType)) throw new TypeError("event.eventType is unsupported");
  positiveInteger(value.sequence, "event.sequence"); timestamp(value.occurredAt, "event.occurredAt");
  if (value.previousEventSha256 !== null) hash(value.previousEventSha256, "event.previousEventSha256");
  identifier(value.jobId, "event.jobId"); identifier(value.idempotencyKey, "event.idempotencyKey"); hash(value.canonicalInputSha256, "event.canonicalInputSha256");
  identifier(value.tenantId, "event.tenantId"); identifier(value.frameModelId, "event.frameModelId");
  parsePayload(value.eventType as GenerationJobEventType, value.payload); hash(value.eventSha256, "event.eventSha256");
  return structuredClone(value) as unknown as GenerationJobEvent;
}

export function parseGenerationJobReplayContext(value: unknown): GenerationJobReplayContext {
  object(value, "replay"); exact(value, ["evaluatedAt"], "replay"); timestamp(value.evaluatedAt, "replay.evaluatedAt");
  return { evaluatedAt: value.evaluatedAt };
}

export async function bindGenerationJobEvent(value: Omit<GenerationJobEvent, "eventSha256">): Promise<GenerationJobEvent> {
  const candidate = { ...structuredClone(value), eventSha256: "0".repeat(64) };
  const parsed = parseGenerationJobEvent(candidate);
  const { eventSha256: _ignored, ...body } = parsed;
  return { ...body, eventSha256: await sha256Hex(canonicalJson(body)) } as GenerationJobEvent;
}

export async function verifyGenerationJobEvent(value: unknown): Promise<GenerationJobEvent> {
  const event = parseGenerationJobEvent(value);
  const { eventSha256, ...body } = event;
  if (await sha256Hex(canonicalJson(body)) !== eventSha256) throw new TypeError("event.eventSha256 does not match canonical event bytes");
  return event;
}
