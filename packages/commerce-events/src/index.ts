import {
  COMMERCE_BATCH_MAX_BYTES,
  COMMERCE_BATCH_MAX_EVENTS,
  COMMERCE_BATCH_TIMEOUT_MS,
  COMMERCE_EVENT_MAX_SESSION_MS,
  canonicalJson,
  parseCatalogUnavailableEvent,
  parseCommerceEvent,
  parseCommerceProductAttribution,
  safeParseWidgetEvent,
  sha256Hex,
  type CatalogUnavailableEvent,
  type CommerceEnvironment,
  type CommerceErrorClass,
  type CommerceErrorCode,
  type CommerceEvent,
  type CommerceProductAttribution,
  type WidgetErrorCode,
  type WidgetEvent,
} from "../../contracts/src/index.js";

export type CommerceLifecyclePhase = "created" | "open" | "permission-granted" | "active" | "closed";
export type CommerceLifecycleState = Readonly<{
  phase: CommerceLifecyclePhase;
  tenantId: string | null;
  siteId: string | null;
  environment: CommerceEnvironment | null;
  sessionId: string | null;
  firstOccurredAtEpochMs: number | null;
  lastOccurredAtEpochMs: number | null;
  lastSequence: number;
  permissionResolved: boolean;
  fatalError: boolean;
  currentProduct: CommerceProductAttribution | null;
  eventIds: readonly string[];
  requestIds: readonly string[];
}>;

export type CommerceLifecycleRejectCode =
  | "MALFORMED"
  | "IDENTITY_MISMATCH"
  | "REPLAY"
  | "SEQUENCE"
  | "TIME_REORDERED"
  | "SESSION_DURATION"
  | "IMPOSSIBLE_TRANSITION"
  | "PRODUCT_RELABEL"
  | "TERMINAL";

export type CommerceLifecycleResult =
  | { ok: true; state: CommerceLifecycleState; event: CommerceEvent }
  | { ok: false; state: CommerceLifecycleState; code: CommerceLifecycleRejectCode };

export function initialCommerceLifecycleState(): CommerceLifecycleState {
  return Object.freeze({
    phase: "created", tenantId: null, siteId: null, environment: null, sessionId: null,
    firstOccurredAtEpochMs: null, lastOccurredAtEpochMs: null, lastSequence: 0,
    permissionResolved: false, fatalError: false, currentProduct: null,
    eventIds: Object.freeze([]), requestIds: Object.freeze([]),
  });
}

function sameProduct(left: CommerceProductAttribution | null, right: CommerceProductAttribution | null): boolean {
  if (left === null || right === null) return left === right;
  return left.sku === right.sku && left.frameModelId === right.frameModelId && left.frameVariantId === right.frameVariantId
    && left.assetId === right.assetId && left.assetVersion === right.assetVersion && left.deploymentId === right.deploymentId
    && left.catalogSha256 === right.catalogSha256 && left.manifestSha256 === right.manifestSha256 && left.modelSha256 === right.modelSha256;
}

export function evaluateCommerceEvent(state: CommerceLifecycleState, value: unknown): CommerceLifecycleResult {
  let event: CommerceEvent;
  try { event = parseCommerceEvent(value); } catch { return { ok: false, state, code: "MALFORMED" }; }
  if (state.tenantId !== null && (event.tenantId !== state.tenantId || event.siteId !== state.siteId || event.environment !== state.environment || event.sessionId !== state.sessionId)) return { ok: false, state, code: "IDENTITY_MISMATCH" };
  if (state.eventIds.includes(event.eventId) || state.requestIds.includes(event.requestId)) return { ok: false, state, code: "REPLAY" };
  if (event.sequence !== state.lastSequence + 1) return { ok: false, state, code: "SEQUENCE" };
  const occurredAtEpochMs = Date.parse(event.occurredAt);
  if (state.lastOccurredAtEpochMs !== null && occurredAtEpochMs < state.lastOccurredAtEpochMs) return { ok: false, state, code: "TIME_REORDERED" };
  const firstOccurredAtEpochMs = state.firstOccurredAtEpochMs ?? occurredAtEpochMs;
  if (occurredAtEpochMs - firstOccurredAtEpochMs > COMMERCE_EVENT_MAX_SESSION_MS) return { ok: false, state, code: "SESSION_DURATION" };
  if (state.phase === "closed") return { ok: false, state, code: "TERMINAL" };
  if (state.fatalError) return { ok: false, state, code: "TERMINAL" };

  let phase: CommerceLifecyclePhase = state.phase;
  let permissionResolved = state.permissionResolved;
  let fatalError: boolean = state.fatalError;
  let currentProduct = state.currentProduct;
  if (event.type === "commerce.open") {
    if (phase !== "created") return { ok: false, state, code: "IMPOSSIBLE_TRANSITION" };
    phase = "open"; currentProduct = event.product;
  } else if (event.type === "commerce.camera-permission-result") {
    if (phase !== "open" || permissionResolved) return { ok: false, state, code: "IMPOSSIBLE_TRANSITION" };
    permissionResolved = true;
    if (event.payload.state === "granted") phase = "permission-granted";
  } else if (event.type === "commerce.try-on-started") {
    if (phase !== "permission-granted") return { ok: false, state, code: "IMPOSSIBLE_TRANSITION" };
    if (!sameProduct(event.product, currentProduct)) return { ok: false, state, code: "PRODUCT_RELABEL" };
    phase = "active";
  } else if (event.type === "commerce.product-changed") {
    if (phase === "created") return { ok: false, state, code: "IMPOSSIBLE_TRANSITION" };
    currentProduct = event.product;
  } else if (event.type === "commerce.capture-created" || event.type === "commerce.cart-requested") {
    if (phase !== "active") return { ok: false, state, code: "IMPOSSIBLE_TRANSITION" };
    if (!sameProduct(event.product, currentProduct)) return { ok: false, state, code: "PRODUCT_RELABEL" };
  } else if (event.type === "commerce.close") {
    if (phase === "created") return { ok: false, state, code: "IMPOSSIBLE_TRANSITION" };
    phase = "closed";
  } else {
    if (event.product !== null && !sameProduct(event.product, currentProduct)) return { ok: false, state, code: "PRODUCT_RELABEL" };
    if (!event.payload.recoverable) { fatalError = true; phase = "closed"; }
  }

  const nextState: CommerceLifecycleState = Object.freeze({
    phase,
    tenantId: state.tenantId ?? event.tenantId,
    siteId: state.siteId ?? event.siteId,
    environment: state.environment ?? event.environment,
    sessionId: state.sessionId ?? event.sessionId,
    firstOccurredAtEpochMs,
    lastOccurredAtEpochMs: occurredAtEpochMs,
    lastSequence: event.sequence,
    permissionResolved,
    fatalError,
    currentProduct,
    eventIds: Object.freeze([...state.eventIds, event.eventId]),
    requestIds: Object.freeze([...state.requestIds, event.requestId]),
  });
  return { ok: true, state: nextState, event };
}

export type CommerceEventBatch = Readonly<{
  schemaVersion: 1;
  type: "commerce.event-batch";
  idempotencyKey: string;
  tenantId: string;
  siteId: string;
  environment: CommerceEnvironment;
  sessionId: string;
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  byteLength: number;
  priorBatchSha256: string | null;
  batchSha256: string;
  events: readonly CommerceEvent[];
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BATCH_DIGEST_PLACEHOLDER = "0".repeat(64);

function canonicalBatchBody(input: {
  tenantId: string; siteId: string; environment: CommerceEnvironment; sessionId: string;
  firstSequence: number; lastSequence: number; eventCount: number; byteLength: number;
  priorBatchSha256: string | null; events: readonly CommerceEvent[];
}, digest: string): Record<string, unknown> {
  return {
    schemaVersion: 1, type: "commerce.event-batch", idempotencyKey: `ceb1_${digest}`,
    tenantId: input.tenantId, siteId: input.siteId, environment: input.environment, sessionId: input.sessionId,
    firstSequence: input.firstSequence, lastSequence: input.lastSequence, eventCount: input.eventCount,
    byteLength: input.byteLength, priorBatchSha256: input.priorBatchSha256, batchSha256: digest, events: input.events,
  };
}

async function deriveBatch(values: readonly unknown[], priorBatchSha256: string | null): Promise<CommerceEventBatch> {
  if (values.length < 1 || values.length > COMMERCE_BATCH_MAX_EVENTS) throw new TypeError("commerce batch event count exceeds its exact budget");
  if (priorBatchSha256 !== null && !SHA256_PATTERN.test(priorBatchSha256)) throw new TypeError("commerce batch prior digest is invalid");
  const events = values.map(parseCommerceEvent);
  const first = events[0]!;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.tenantId !== first.tenantId || event.siteId !== first.siteId || event.environment !== first.environment || event.sessionId !== first.sessionId) throw new TypeError("commerce batch crosses an identity boundary");
    if (event.sequence !== first.sequence + index) throw new TypeError("commerce batch sequence is not contiguous");
    if (index > 0 && Date.parse(event.occurredAt) < Date.parse(events[index - 1]!.occurredAt)) throw new TypeError("commerce batch time is reordered");
  }
  if (new Set(events.map((event) => event.eventId)).size !== events.length || new Set(events.map((event) => event.requestId)).size !== events.length) throw new TypeError("commerce batch contains replayed identity");
  const last = events.at(-1)!;
  const base = {
    tenantId: first.tenantId, siteId: first.siteId, environment: first.environment, sessionId: first.sessionId,
    firstSequence: first.sequence, lastSequence: last.sequence, eventCount: events.length,
    priorBatchSha256, events: Object.freeze(events),
  };
  let byteLength = 0;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const derived = new TextEncoder().encode(canonicalJson(canonicalBatchBody({ ...base, byteLength }, BATCH_DIGEST_PLACEHOLDER))).byteLength;
    if (derived === byteLength) break;
    byteLength = derived;
  }
  const digestProjection = canonicalBatchBody({ ...base, byteLength }, BATCH_DIGEST_PLACEHOLDER);
  const batchSha256 = await sha256Hex(canonicalJson(digestProjection));
  const final = canonicalBatchBody({ ...base, byteLength }, batchSha256);
  const actualByteLength = new TextEncoder().encode(canonicalJson(final)).byteLength;
  if (actualByteLength !== byteLength) throw new TypeError("commerce batch byte length derivation did not converge");
  if (actualByteLength > COMMERCE_BATCH_MAX_BYTES) throw new TypeError("commerce batch exceeds its exact byte budget");
  return Object.freeze({ ...final, events: base.events }) as CommerceEventBatch;
}

export async function buildCommerceEventBatch(values: readonly unknown[], priorBatchSha256: string | null = null): Promise<CommerceEventBatch> {
  return deriveBatch(values, priorBatchSha256);
}

export async function parseCommerceEventBatch(value: unknown): Promise<CommerceEventBatch> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("commerce batch must be a plain object");
  const item = value as Record<string, unknown>;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError("commerce batch must contain data properties only");
  const keys = ["schemaVersion", "type", "idempotencyKey", "tenantId", "siteId", "environment", "sessionId", "firstSequence", "lastSequence", "eventCount", "byteLength", "priorBatchSha256", "batchSha256", "events"];
  if (Object.keys(item).length !== keys.length || keys.some((key) => !Object.hasOwn(item, key))) throw new TypeError("commerce batch fields are invalid");
  if (!Array.isArray(item.events) || Object.getPrototypeOf(item.events) !== Array.prototype || Object.keys(item.events).length !== item.events.length) throw new TypeError("commerce batch events must be a dense standard array");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item.events))) if (descriptor.get || descriptor.set) throw new TypeError("commerce batch events must contain data properties only");
  if (item.priorBatchSha256 !== null && (typeof item.priorBatchSha256 !== "string" || !SHA256_PATTERN.test(item.priorBatchSha256))) throw new TypeError("commerce batch prior digest is invalid");
  const built = await deriveBatch(item.events, item.priorBatchSha256 as string | null);
  if (item.schemaVersion !== built.schemaVersion || item.type !== built.type || item.idempotencyKey !== built.idempotencyKey
    || item.tenantId !== built.tenantId || item.siteId !== built.siteId || item.environment !== built.environment || item.sessionId !== built.sessionId
    || item.firstSequence !== built.firstSequence || item.lastSequence !== built.lastSequence || item.eventCount !== built.eventCount || item.byteLength !== built.byteLength
    || item.priorBatchSha256 !== built.priorBatchSha256 || item.batchSha256 !== built.batchSha256) throw new TypeError("commerce batch derived identity is invalid");
  return built;
}

export async function serializeCommerceEventBatch(value: unknown): Promise<Uint8Array> {
  const batch = await parseCommerceEventBatch(value);
  const bytes = new TextEncoder().encode(canonicalJson(batch));
  if (bytes.byteLength !== batch.byteLength || bytes.byteLength > COMMERCE_BATCH_MAX_BYTES) throw new TypeError("commerce batch canonical serialization is invalid");
  return bytes;
}

export type CommerceBatchLedgerState = Readonly<{ lifecycle: CommerceLifecycleState; priorBatchSha256: string | null }>;
export type CommerceBatchRejectCode = "MALFORMED_BATCH" | "BATCH_CHAIN" | "BATCH_SEQUENCE" | CommerceLifecycleRejectCode;
export type CommerceBatchEvaluation =
  | { ok: true; batch: CommerceEventBatch; state: CommerceBatchLedgerState }
  | { ok: false; state: CommerceBatchLedgerState; code: CommerceBatchRejectCode };

export function initialCommerceBatchLedgerState(): CommerceBatchLedgerState {
  return Object.freeze({ lifecycle: initialCommerceLifecycleState(), priorBatchSha256: null });
}

export async function evaluateCommerceEventBatch(state: CommerceBatchLedgerState, value: unknown): Promise<CommerceBatchEvaluation> {
  let batch: CommerceEventBatch;
  try { batch = await parseCommerceEventBatch(value); } catch { return { ok: false, state, code: "MALFORMED_BATCH" }; }
  if (batch.priorBatchSha256 !== state.priorBatchSha256) return { ok: false, state, code: "BATCH_CHAIN" };
  if ((state.lifecycle.lastSequence === 0 && (batch.priorBatchSha256 !== null || batch.firstSequence !== 1))
    || (state.lifecycle.lastSequence > 0 && batch.firstSequence !== state.lifecycle.lastSequence + 1)) return { ok: false, state, code: "BATCH_SEQUENCE" };
  let lifecycle = state.lifecycle;
  for (const event of batch.events) {
    const result = evaluateCommerceEvent(lifecycle, event);
    if (!result.ok) return { ok: false, state, code: result.code };
    lifecycle = result.state;
  }
  return { ok: true, batch, state: Object.freeze({ lifecycle, priorBatchSha256: batch.batchSha256 }) };
}

export type CommerceSinkResponse =
  | { status: "accepted" }
  | { status: "retryable"; reason: "unavailable" | "throttled"; retryAfterMs: number | null }
  | { status: "terminal"; reason: "invalid-batch" | "unauthorized" | "conflict" };
export type CommerceDispatchResult = CommerceSinkResponse
  | { status: "retryable"; reason: "timeout" | "sink-failure"; retryAfterMs: null }
  | { status: "terminal"; reason: "aborted" | "sink-response-rejected" | "dispatch-in-progress" | "ledger-consumed" };
export type CommerceEventSink = { send(batch: CommerceEventBatch, context: { signal: AbortSignal; canonicalBytes: Uint8Array }): Promise<unknown> };
export type CommerceDispatchClock = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};
const DEFAULT_DISPATCH_CLOCK: CommerceDispatchClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function parseSinkResponse(value: unknown): CommerceSinkResponse | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return null;
    const item = value as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || descriptor.get || descriptor.set)) return null;
    const status = descriptors.status?.value;
    const keys = Object.keys(descriptors);
    if (status === "accepted" && keys.length === 1) return { status: "accepted" };
    const reason = descriptors.reason?.value;
    const retryAfterMs = descriptors.retryAfterMs?.value;
    if (status === "retryable" && keys.length === 3 && (reason === "unavailable" || reason === "throttled") && (retryAfterMs === null || (Number.isSafeInteger(retryAfterMs) && (retryAfterMs as number) >= 0 && (retryAfterMs as number) <= 60_000))) return { status: "retryable", reason, retryAfterMs: retryAfterMs as number | null };
    if (status === "terminal" && keys.length === 2 && (reason === "invalid-batch" || reason === "unauthorized" || reason === "conflict")) return { status: "terminal", reason };
    return null;
  } catch { return null; }
}

type InternalDispatchLedger = {
  readonly state: CommerceBatchLedgerState;
  status: "idle" | "in-flight" | "consumed";
};

const DISPATCH_LEDGER_STATES = new WeakMap<object, InternalDispatchLedger>();

declare const COMMERCE_DISPATCH_LEDGER_BRAND: unique symbol;
export type CommerceDispatchLedger = Readonly<{ [COMMERCE_DISPATCH_LEDGER_BRAND]: true }>;

function createInternalDispatchLedger(state: CommerceBatchLedgerState): CommerceDispatchLedger {
  const ledger = Object.freeze(Object.create(null)) as CommerceDispatchLedger;
  DISPATCH_LEDGER_STATES.set(ledger, { state, status: "idle" });
  return ledger;
}

export function createCommerceDispatchLedger(): CommerceDispatchLedger { return createInternalDispatchLedger(initialCommerceBatchLedgerState()); }
export function inspectCommerceDispatchLedger(value: unknown): CommerceBatchLedgerState | null {
  return typeof value === "object" && value !== null ? DISPATCH_LEDGER_STATES.get(value)?.state ?? null : null;
}

export type CommerceBatchDispatchOutcome = Readonly<{ result: CommerceDispatchResult; ledger: CommerceDispatchLedger | null }>;

export async function dispatchCommerceEventBatch(value: unknown, ledger: unknown, sink: CommerceEventSink, signal?: AbortSignal, clock: CommerceDispatchClock = DEFAULT_DISPATCH_CLOCK): Promise<CommerceBatchDispatchOutcome> {
  const internal = typeof ledger === "object" && ledger !== null ? DISPATCH_LEDGER_STATES.get(ledger) : undefined;
  if (!internal) return { result: { status: "terminal", reason: "invalid-batch" }, ledger: null };
  if (internal.status === "in-flight") return { result: { status: "terminal", reason: "dispatch-in-progress" }, ledger: ledger as CommerceDispatchLedger };
  if (internal.status === "consumed") return { result: { status: "terminal", reason: "ledger-consumed" }, ledger: ledger as CommerceDispatchLedger };
  internal.status = "in-flight";
  const release = <T extends CommerceBatchDispatchOutcome>(outcome: T): T => {
    internal.status = outcome.result.status === "accepted" ? "consumed" : "idle";
    return outcome;
  };
  let evaluated: CommerceBatchEvaluation;
  try { evaluated = await evaluateCommerceEventBatch(internal.state, value); }
  catch { return release({ result: { status: "terminal", reason: "invalid-batch" }, ledger: ledger as CommerceDispatchLedger }); }
  if (!evaluated.ok) return release({ result: { status: "terminal", reason: "invalid-batch" }, ledger: ledger as CommerceDispatchLedger });
  const batch = evaluated.batch;
  let canonicalBytes: Uint8Array;
  try { canonicalBytes = await serializeCommerceEventBatch(batch); }
  catch { return release({ result: { status: "terminal", reason: "invalid-batch" }, ledger: ledger as CommerceDispatchLedger }); }
  try { if (signal?.aborted) return release({ result: { status: "terminal", reason: "aborted" }, ledger: ledger as CommerceDispatchLedger }); }
  catch { return release({ result: { status: "terminal", reason: "aborted" }, ledger: ledger as CommerceDispatchLedger }); }
  const controller = new AbortController();
  let resolveAbort!: (result: CommerceDispatchResult) => void;
  let resolveTimeout!: (result: CommerceDispatchResult) => void;
  const aborted = new Promise<CommerceDispatchResult>((resolve) => { resolveAbort = resolve; });
  const timedOut = new Promise<CommerceDispatchResult>((resolve) => { resolveTimeout = resolve; });
  const onAbort = () => {
    let reason: unknown;
    try { reason = signal?.reason; } catch { reason = undefined; }
    controller.abort(reason); resolveAbort({ status: "terminal", reason: "aborted" });
  };
  try { signal?.addEventListener("abort", onAbort, { once: true }); }
  catch {
    try { signal?.removeEventListener("abort", onAbort); } catch { /* setup cleanup isolation */ }
    return release({ result: { status: "terminal", reason: "aborted" }, ledger: ledger as CommerceDispatchLedger });
  }
  let timeout: unknown;
  try {
    timeout = clock.setTimeout(() => {
      controller.abort();
      resolveTimeout({ status: "retryable", reason: "timeout", retryAfterMs: null });
    }, COMMERCE_BATCH_TIMEOUT_MS);
  } catch {
    try { signal?.removeEventListener("abort", onAbort); } catch { /* setup cleanup isolation */ }
    return release({ result: { status: "retryable", reason: "sink-failure", retryAfterMs: null }, ledger: ledger as CommerceDispatchLedger });
  }
  try {
    const sent = Promise.resolve()
      .then(() => sink.send(batch, { signal: controller.signal, canonicalBytes }))
      .then((response): CommerceDispatchResult => parseSinkResponse(response) ?? { status: "terminal", reason: "sink-response-rejected" })
      .catch((): CommerceDispatchResult => ({ status: "retryable", reason: "sink-failure", retryAfterMs: null }));
    const result = await Promise.race([sent, aborted, timedOut]);
    return release({ result, ledger: result.status === "accepted" ? createInternalDispatchLedger(evaluated.state) : ledger as CommerceDispatchLedger });
  } finally {
    try { clock.clearTimeout(timeout); } catch { /* cleanup must never replace classified result */ }
    try { signal?.removeEventListener("abort", onAbort); } catch { /* cleanup isolation */ }
  }
}

export type CommerceObservationResult = { accepted: true; event: CommerceEvent } | { accepted: false; code: "IGNORED" | "REJECTED" };
export type CommerceEventSessionOptions = {
  tenantId: string;
  siteId: string;
  environment: CommerceEnvironment;
  sessionId: string;
  nextEventId(): string;
  nowEpochMs(): number;
  /** Explicitly local/test-only. Production construction belongs in try-on-web's verified registry adapter. */
  localProductForSku(sku: string): unknown;
  emit(event: CommerceEvent): void | Promise<void>;
};

const WIDGET_ERROR_CLASS: Record<WidgetErrorCode, CommerceErrorClass> = {
  PROTOCOL_REJECTED: "protocol", AUTH_REQUIRED: "authentication", CAMERA_DENIED: "permission", CAMERA_UNAVAILABLE: "permission",
  ASSET_UNAVAILABLE: "catalog", RUNTIME_UNAVAILABLE: "runtime", INTERNAL_FAILURE: "internal",
};

export class CommerceEventSession {
  #state: CommerceLifecycleState = initialCommerceLifecycleState();
  readonly #binding: Readonly<Pick<CommerceEventSessionOptions, "tenantId" | "siteId" | "environment" | "sessionId">>;
  constructor(private readonly options: CommerceEventSessionOptions) {
    this.#binding = Object.freeze({ tenantId: options.tenantId, siteId: options.siteId, environment: options.environment, sessionId: options.sessionId });
  }
  get state(): CommerceLifecycleState { return this.#state; }

  #product(sku: string): CommerceProductAttribution | null {
    try {
      const product = parseCommerceProductAttribution(this.options.localProductForSku(sku));
      return product.sku === sku ? product : null;
    } catch { return null; }
  }

  #record(requestId: string, type: CommerceEvent["type"], product: CommerceProductAttribution | null, payload: CommerceEvent["payload"]): CommerceObservationResult {
    try {
      const candidate = parseCommerceEvent({
        schemaVersion: 1, type, occurredAt: new Date(this.options.nowEpochMs()).toISOString(), sequence: this.#state.lastSequence + 1,
        eventId: this.options.nextEventId(), requestId, ...this.#binding, product, payload,
      });
      const evaluated = evaluateCommerceEvent(this.#state, candidate);
      if (!evaluated.ok) return { accepted: false, code: "REJECTED" };
      this.#state = evaluated.state;
      try { void Promise.resolve(this.options.emit(evaluated.event)).catch(() => undefined); } catch { /* observer isolation */ }
      return { accepted: true, event: evaluated.event };
    } catch { return { accepted: false, code: "REJECTED" }; }
  }

  observeWidget(value: unknown): CommerceObservationResult {
    const parsed = safeParseWidgetEvent(value);
    if (!parsed.ok) return { accepted: false, code: "REJECTED" };
    const event = parsed.value;
    if (event.tenantId !== this.options.tenantId || event.sessionId !== this.options.sessionId) return { accepted: false, code: "REJECTED" };
    if (event.type === "jessica.ready") return { accepted: false, code: "IGNORED" };
    if (event.type === "jessica.opened" || event.type === "jessica.assetChanged" || event.type === "jessica.tryOnStarted") {
      const product = event.type === "jessica.tryOnStarted" ? this.#state.currentProduct : this.#product(event.payload.skuId);
      if (product === null || product.sku !== event.payload.skuId) return { accepted: false, code: "REJECTED" };
      const type = event.type === "jessica.opened" ? "commerce.open" : event.type === "jessica.assetChanged" ? "commerce.product-changed" : "commerce.try-on-started";
      return this.#record(event.requestId, type, product, {});
    }
    if (event.type === "jessica.cameraPermission") return this.#record(event.requestId, "commerce.camera-permission-result", null, { state: event.payload.state });
    if (event.type === "jessica.captureCreated") {
      if (this.#state.currentProduct === null) return { accepted: false, code: "REJECTED" };
      return this.#record(event.requestId, "commerce.capture-created", this.#state.currentProduct, {});
    }
    if (event.type === "jessica.cartRequested") {
      if (this.#state.currentProduct === null || event.payload.skuId !== this.#state.currentProduct.sku) return { accepted: false, code: "REJECTED" };
      return this.#record(event.requestId, "commerce.cart-requested", this.#state.currentProduct, { quantity: event.payload.quantity });
    }
    if (event.type === "jessica.closed") return this.#record(event.requestId, "commerce.close", null, { reason: event.payload.reason });
    const product = this.#state.currentProduct;
    return this.#record(event.requestId, "commerce.error", product, { code: event.payload.code, class: WIDGET_ERROR_CLASS[event.payload.code], recoverable: event.payload.recoverable });
  }

  observeCatalogUnavailable(value: unknown): CommerceObservationResult {
    let event: CatalogUnavailableEvent;
    try { event = parseCatalogUnavailableEvent(value); } catch { return { accepted: false, code: "REJECTED" }; }
    if (event.tenantId !== this.options.tenantId || event.siteId !== this.options.siteId || event.environment !== this.options.environment) return { accepted: false, code: "REJECTED" };
    return this.#record(event.requestId, "commerce.error", null, { code: "CATALOG_UNAVAILABLE", class: "catalog", recoverable: true });
  }
}

/** Explicit ParentWidgetHost `onEvent` adapter. It never throws into host behavior. */
export function createParentWidgetCommerceObserver(session: CommerceEventSession): (event: WidgetEvent) => void {
  return (event) => { try { session.observeWidget(event); } catch { /* observer isolation */ } };
}

/** Explicit DeployedCatalogIntegration `unavailableSink` adapter. */
export function createCatalogUnavailableCommerceSink(session: CommerceEventSession): { write(event: CatalogUnavailableEvent): void } {
  return { write(event) { try { session.observeCatalogUnavailable(event); } catch { /* observer isolation */ } } };
}
