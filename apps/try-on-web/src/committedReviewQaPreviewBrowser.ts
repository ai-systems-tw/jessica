import {
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES,
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES,
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES,
  canonicalJson,
  parseCommittedReviewQaPreviewTransportRequest,
  unverifiedCommittedReviewQaPreviewBundleEnvelopePayload,
  type CommittedReviewQaPreviewTransportSelection,
} from "../../../packages/contracts/src/index.js";
import { parseUnverifiedCommittedReviewQaPreviewBundle, parseUnverifiedCommittedReviewQaPreviewBundleContainer } from "../../../packages/assets/src/index.js";
import type { RuntimeAsset } from "../../../packages/runtime/src/index.js";

export const COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE = "application/vnd.jessica.qa-preview-runtime-bundle.v1" as const;

const MAX_BUNDLE_BYTES = 20
  + COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES
  + COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES
  + COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES;
const DEFAULT_OPERATION_AGE_MS = 15_000;
const MAX_OPERATION_AGE_MS = 30_000;
const MAX_GRANT_AGE_MS = 120_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE64URL_P256 = /^[A-Za-z0-9_-]{43}$/;
const arrayBufferSlice = ArrayBuffer.prototype.slice;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CommittedReviewQaPreviewBundleTrustedKey = Readonly<{
  authorityId: string;
  keyId: string;
  tenantId: string;
  notBefore: string;
  notAfter: string;
  publicJwk: JsonWebKey;
}>;

export type CommittedReviewQaPreviewRuntimeHandle = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-runtime-handle";
}>;

export type CommittedReviewQaPreviewInitializableRuntime = Readonly<{
  initialize(canvas: HTMLCanvasElement, asset: RuntimeAsset): Promise<void>;
  dispose(): void | Promise<void>;
}>;

export type CommittedReviewQaPreviewBrowserErrorCode =
  | "DENIED"
  | "CANCELLED"
  | "EXPIRED"
  | "TRANSPORT_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE";

export class CommittedReviewQaPreviewBrowserError extends Error {
  readonly code: CommittedReviewQaPreviewBrowserErrorCode;

  constructor(code: CommittedReviewQaPreviewBrowserErrorCode) {
    super("QA-preview browser operation was denied");
    this.name = "CommittedReviewQaPreviewBrowserError";
    this.code = code;
  }
}

type HandleRecord = Readonly<{
  asset: RuntimeAsset["asset"];
  modelBytes: ArrayBuffer;
  modelSha256: string;
  deadlineEpochMs: number;
  expiryTimer: ReturnType<typeof setTimeout>;
}>;

const handles = new WeakMap<object, HandleRecord>();

function denied(): never { throw new CommittedReviewQaPreviewBrowserError("DENIED"); }
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  const ownKeys = Reflect.ownKeys(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`);
  for (const [key, descriptor] of Object.entries(descriptors)) if (!keys.includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} fields are invalid`);
  return value as Record<string, unknown>;
}
function id(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const epoch = Date.parse(value); if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) throw new TypeError(`${label} is invalid`);
  return value;
}
function operationAge(value: unknown): number {
  const age = value ?? DEFAULT_OPERATION_AGE_MS;
  if (typeof age !== "number" || !Number.isSafeInteger(age) || age < 1 || age > MAX_OPERATION_AGE_MS) throw new TypeError("QA-preview operation age is invalid");
  return age;
}
function audience(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("QA-preview audience is invalid");
  let parsed: URL; try { parsed = new URL(value); } catch { throw new TypeError("QA-preview audience is invalid"); }
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") throw new TypeError("QA-preview audience must be one canonical HTTPS origin");
  return value;
}
function endpoint(value: string | URL, expectedAudience: string): URL {
  let parsed: URL; try { parsed = new URL(value); } catch { throw new TypeError("QA-preview endpoint is invalid"); }
  if (parsed.protocol !== "https:" || parsed.origin !== expectedAudience || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") throw new TypeError("QA-preview endpoint must be canonical same-origin HTTPS without credentials, query, or fragment");
  return parsed;
}
function canonicalCoordinate(value: unknown): value is string {
  if (typeof value !== "string" || !BASE64URL_P256.test(value)) return false;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=");
    return binary.length === 32 && btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === value;
  } catch { return false; }
}
function publicJwk(value: unknown): JsonWebKey {
  const row = exact(value, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"], "QA-preview bundle public JWK");
  if (!Array.isArray(row.key_ops) || Object.getPrototypeOf(row.key_ops) !== Array.prototype || row.key_ops.length !== 1 || Reflect.ownKeys(row.key_ops).length !== 2) throw new TypeError("QA-preview bundle public JWK key_ops is invalid");
  const operation = Object.getOwnPropertyDescriptor(row.key_ops, "0");
  if (!operation?.enumerable || operation.get || operation.set || operation.value !== "verify" || row.ext !== true || row.kty !== "EC" || row.crv !== "P-256" || row.use !== "sig" || row.alg !== "ES256" || !canonicalCoordinate(row.x) || !canonicalCoordinate(row.y)) throw new TypeError("QA-preview bundle public JWK is invalid");
  return structuredClone(value) as JsonWebKey;
}

type ParsedTrustedKey = Readonly<CommittedReviewQaPreviewBundleTrustedKey & { publicJwk: JsonWebKey }>;

function trustedKeys(value: readonly CommittedReviewQaPreviewBundleTrustedKey[]): readonly ParsedTrustedKey[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > 16 || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError("QA-preview bundle trusted keys are invalid");
  const parsed = value.map((candidate) => {
    const row = exact(candidate, ["authorityId", "keyId", "tenantId", "notBefore", "notAfter", "publicJwk"], "QA-preview bundle trusted key");
    const notBefore = timestamp(row.notBefore, "QA-preview bundle key notBefore"); const notAfter = timestamp(row.notAfter, "QA-preview bundle key notAfter");
    if (Date.parse(notBefore) >= Date.parse(notAfter)) throw new TypeError("QA-preview bundle key validity is invalid");
    return Object.freeze({ authorityId: id(row.authorityId, "QA-preview bundle authorityId"), keyId: id(row.keyId, "QA-preview bundle keyId"), tenantId: id(row.tenantId, "QA-preview bundle tenantId"), notBefore, notAfter, publicJwk: publicJwk(row.publicJwk) });
  });
  const identities = new Set<string>(); const coordinates = new Set<string>();
  for (const key of parsed) {
    const identity = `${key.authorityId}\0${key.keyId}\0${key.tenantId}`; const coordinate = `${key.publicJwk.x}\0${key.publicJwk.y}`;
    if (identities.has(identity) || coordinates.has(coordinate)) throw new TypeError("QA-preview bundle trusted key is duplicated or aliased");
    identities.add(identity); coordinates.add(coordinate);
  }
  return Object.freeze(parsed);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string; try { binary = atob(value); } catch { return denied(); }
  if (binary.length !== 64) denied();
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}
function randomRequestId(): string {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function sameSelection(left: CommittedReviewQaPreviewTransportSelection, right: CommittedReviewQaPreviewTransportSelection): boolean {
  return left.tenantId === right.tenantId && left.assetVersionId === right.assetVersionId && left.assetVersion === right.assetVersion;
}
function cancelResponse(response: Response): void {
  try { if (response.body) void response.body.cancel().catch(() => undefined); } catch { /* fail closed */ }
}

async function boundedResponseBytes(response: Response, termination: Promise<never>, check: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get("content-length");
  if (declared === null || !/^[1-9]\d*$/.test(declared) || Number(declared) > MAX_BUNDLE_BYTES) { cancelResponse(response); return denied(); }
  if (!response.body) return denied();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      check();
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await Promise.race([reader.read(), termination]); }
      catch (error) { try { void reader.cancel().catch(() => undefined); } catch { /* best effort */ } throw error; }
      check();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BUNDLE_BYTES) { try { void reader.cancel().catch(() => undefined); } catch { /* best effort */ } return denied(); }
      chunks.push(part.value);
    }
  } finally { try { reader.releaseLock(); } catch { /* a terminated pending read may retain the lock */ } }
  if (length < 1 || Number(declared) !== length) denied();
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function responseHeaders(response: Response): void {
  if (response.headers.get("content-type") !== COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE
    || response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
    || response.headers.get("referrer-policy")?.toLowerCase() !== "no-referrer"
    || response.headers.get("content-disposition")?.toLowerCase() !== "inline"
    || response.headers.get("cross-origin-resource-policy")?.toLowerCase() !== "same-origin") denied();
  const contentEncoding = response.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") denied();
  const cacheControl = response.headers.get("cache-control")?.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (!cacheControl || cacheControl.length !== 2 || new Set(cacheControl).size !== 2 || !cacheControl.includes("private") || !cacheControl.includes("no-store")) denied();
}

function runtimeAsset(record: HandleRecord): RuntimeAsset {
  const owned = Reflect.apply(arrayBufferSlice, record.modelBytes, [0]) as ArrayBuffer;
  const verifiedGlb = Object.freeze({
    get bytes(): ArrayBuffer { return Reflect.apply(arrayBufferSlice, owned, [0]) as ArrayBuffer; },
    baseUrl: "qa-preview-bundle:/",
    sha256: record.modelSha256,
  });
  return Object.freeze({ asset: record.asset, verifiedGlb });
}

/**
 * Performs the sole authenticated browser request and returns an identity-only,
 * one-shot handle. Neither bundle bytes nor a RuntimeAsset are exposed here.
 */
export async function loadCommittedReviewQaPreviewRuntimeHandle(options: {
  endpoint: string | URL;
  audience: string;
  selection: unknown;
  trustedKeys: readonly CommittedReviewQaPreviewBundleTrustedKey[];
  csrfToken: string;
  fetchFn?: FetchLike;
  nowEpochMs?: () => number;
  maximumOperationAgeMs?: number;
  signal?: AbortSignal;
}): Promise<CommittedReviewQaPreviewRuntimeHandle> {
  const expectedAudience = audience(options.audience); const url = endpoint(options.endpoint, expectedAudience);
  const request = parseCommittedReviewQaPreviewTransportRequest({ schemaVersion: 1, type: "jessica.committed-review-qa-preview-transport-request", requestId: randomRequestId(), selection: options.selection });
  const keySet = trustedKeys(options.trustedKeys);
  if (typeof options.csrfToken !== "string" || options.csrfToken.length < 16 || options.csrfToken.length > 4096 || /[\r\n\0]/.test(options.csrfToken)) throw new TypeError("QA-preview CSRF token is invalid");
  const nowEpochMs = options.nowEpochMs ?? Date.now; const startedAt = nowEpochMs(); const maximumAge = operationAge(options.maximumOperationAgeMs);
  if (!Number.isSafeInteger(startedAt)) throw new TypeError("QA-preview clock is invalid");
  const deadlineEpochMs = startedAt + maximumAge;
  const controller = new AbortController(); let boundaryError: CommittedReviewQaPreviewBrowserError | null = null; let rejectBoundary!: (error: CommittedReviewQaPreviewBrowserError) => void; let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const termination = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  void termination.catch(() => undefined);
  const trip = (code: "CANCELLED" | "EXPIRED"): void => {
    if (settled || boundaryError) return;
    boundaryError = new CommittedReviewQaPreviewBrowserError(code);
    try { controller.abort(); } catch { /* best effort */ }
    rejectBoundary(boundaryError);
  };
  const onAbort = (): void => trip("CANCELLED");
  const check = (): void => {
    if (boundaryError) throw boundaryError;
    if (options.signal?.aborted) { trip("CANCELLED"); throw boundaryError!; }
    if (nowEpochMs() >= deadlineEpochMs) { trip("EXPIRED"); throw boundaryError!; }
  };
  const finishBoundary = (): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  };
  if (options.signal?.aborted) trip("CANCELLED"); else options.signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => trip("EXPIRED"), Math.max(0, deadlineEpochMs - startedAt));
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") timer.unref();
  const requestJson = canonicalJson(request);
  let response: Response | undefined;
  try {
    check();
    const fetchPromise = (options.fetchFn ?? fetch)(url, {
      method: "POST",
      headers: { accept: COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE, "content-type": "application/json", "x-jessica-csrf-token": options.csrfToken },
      body: requestJson,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    void fetchPromise.then((candidate) => { if (boundaryError || settled) cancelResponse(candidate); }, () => undefined);
    response = await Promise.race([fetchPromise, termination]);
    check();
  } catch {
    finishBoundary();
    if (boundaryError) throw boundaryError;
    throw new CommittedReviewQaPreviewBrowserError("TRANSPORT_UNAVAILABLE");
  }
  try {
    check();
    if (response.status !== 200 || response.redirected || response.url !== url.href) { cancelResponse(response); denied(); }
    try { responseHeaders(response); } catch { cancelResponse(response); denied(); }
    const bytes = await boundedResponseBytes(response, termination, check);
    check();
    const envelope = parseUnverifiedCommittedReviewQaPreviewBundleContainer(bytes).envelope;
    const composedAt = Date.parse(envelope.composedAt); const expiresAt = Date.parse(envelope.transport.expiresAt);
    const key = keySet.find((candidate) => candidate.authorityId === envelope.bundleSignerAuthorityId && candidate.keyId === envelope.bundleSignerKeyId && candidate.tenantId === request.selection.tenantId);
    if (!key || envelope.transport.tenantId !== request.selection.tenantId || envelope.transport.requestId !== request.requestId || !sameSelection(envelope.transport.selection, request.selection)
      || envelope.bundleSignerAuthorityId === envelope.transport.issuerAuthorityId
      || envelope.transport.audience !== expectedAudience || expiresAt - Date.parse(envelope.transport.issuedAt) > MAX_GRANT_AGE_MS
      || !Number.isFinite(composedAt) || composedAt < Date.parse(envelope.transport.issuedAt) || composedAt >= expiresAt || composedAt > nowEpochMs() || nowEpochMs() >= expiresAt
      || Date.parse(key.notBefore) > composedAt || expiresAt > Date.parse(key.notAfter) || nowEpochMs() >= Date.parse(key.notAfter)) denied();
    const verificationKey = await Promise.race([crypto.subtle.importKey("jwk", key.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]), termination]);
    check();
    const verified = await Promise.race([crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verificationKey,
      fromBase64(envelope.signatureBase64),
      new TextEncoder().encode(canonicalJson(unverifiedCommittedReviewQaPreviewBundleEnvelopePayload(envelope))),
    ), termination]);
    check();
    if (!verified) denied();
    const parsed = await Promise.race([parseUnverifiedCommittedReviewQaPreviewBundle(bytes), termination]);
    check();
    const projection = envelope.runtimeAssetProjection;
    const asset = Object.freeze({
      id: projection.id, tenantId: projection.tenantId, frameModelId: projection.frameModelId, version: projection.version,
      quality: projection.quality, generationMethod: projection.generationMethod, modelUrl: "qa-preview-bundle:/model.glb", manifestUrl: "qa-preview-bundle:/manifest.json", manifestSha256: envelope.manifest.sha256,
      sourceAssetHashes: Object.freeze([...projection.sourceAssetHashes]), attachmentMatrix: Object.freeze([...projection.attachmentMatrix]) as RuntimeAsset["asset"]["attachmentMatrix"],
      qualityEnvelope: Object.freeze({ ...projection.qualityEnvelope }), status: projection.status,
    });
    const modelBytes = Reflect.apply(arrayBufferSlice, parsed.modelBytes.buffer, [parsed.modelBytes.byteOffset, parsed.modelBytes.byteOffset + parsed.modelBytes.byteLength]) as ArrayBuffer;
    const handle = Object.freeze({ schemaVersion: 1 as const, type: "jessica.committed-review-qa-preview-runtime-handle" as const });
    const effectiveDeadlineEpochMs = Math.min(deadlineEpochMs, expiresAt, Date.parse(envelope.transport.committedReviewValidUntil), Date.parse(key.notAfter));
    const registrationNow = nowEpochMs();
    if (!Number.isSafeInteger(registrationNow) || registrationNow >= effectiveDeadlineEpochMs) denied();
    let record!: HandleRecord;
    const expiryTimer = setTimeout(() => { if (handles.get(handle) === record) handles.delete(handle); }, effectiveDeadlineEpochMs - registrationNow);
    if (typeof expiryTimer === "object" && expiryTimer !== null && "unref" in expiryTimer && typeof expiryTimer.unref === "function") expiryTimer.unref();
    record = Object.freeze({
      asset,
      modelBytes,
      modelSha256: envelope.model.sha256,
      deadlineEpochMs: effectiveDeadlineEpochMs,
      expiryTimer,
    });
    handles.set(handle, record);
    return handle;
  } catch (error) {
    cancelResponse(response);
    if (error instanceof CommittedReviewQaPreviewBrowserError) throw error;
    throw new CommittedReviewQaPreviewBrowserError("DENIED");
  } finally {
    finishBoundary();
  }
}

async function disposeRuntime(runtime: CommittedReviewQaPreviewInitializableRuntime): Promise<void> { try { await runtime.dispose(); } catch { /* cleanup is best effort after authority closes */ } }

/** Consumes and deletes authority synchronously before runtime construction or await. */
export async function consumeCommittedReviewQaPreviewRuntimeHandle<T extends CommittedReviewQaPreviewInitializableRuntime>(options: {
  handle: unknown;
  canvas: HTMLCanvasElement;
  createRuntime(): T;
  nowEpochMs?: () => number;
  initializationTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  if (typeof options.handle !== "object" || options.handle === null) return denied();
  const record = handles.get(options.handle); handles.delete(options.handle);
  if (!record) denied();
  clearTimeout(record.expiryTimer);
  const nowEpochMs = options.nowEpochMs ?? Date.now; const now = nowEpochMs(); const initializationAge = operationAge(options.initializationTimeoutMs);
  if (!Number.isSafeInteger(now)) throw new TypeError("QA-preview clock is invalid");
  if (options.signal?.aborted) throw new CommittedReviewQaPreviewBrowserError("CANCELLED");
  const deadlineEpochMs = Math.min(record.deadlineEpochMs, now + initializationAge);
  if (now >= deadlineEpochMs) throw new CommittedReviewQaPreviewBrowserError("EXPIRED");
  let runtime: T; try { runtime = options.createRuntime(); } catch { throw new CommittedReviewQaPreviewBrowserError("RUNTIME_UNAVAILABLE"); }
  if (typeof runtime !== "object" || runtime === null || typeof runtime.initialize !== "function" || typeof runtime.dispose !== "function") throw new CommittedReviewQaPreviewBrowserError("RUNTIME_UNAVAILABLE");
  let terminate!: (error: CommittedReviewQaPreviewBrowserError) => void;
  const termination = new Promise<never>((_resolve, reject) => { terminate = reject; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposal: Promise<void> | null = null;
  const startDisposal = (): Promise<void> => { disposal ??= disposeRuntime(runtime); return disposal; };
  let closed = false; const close = (code: "CANCELLED" | "EXPIRED"): void => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    void startDisposal();
    terminate(new CommittedReviewQaPreviewBrowserError(code));
  };
  const onAbort = (): void => close("CANCELLED");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => close("EXPIRED"), Math.max(0, deadlineEpochMs - now));
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") timer.unref();
  try {
    await Promise.race([Promise.resolve(runtime.initialize(options.canvas, runtimeAsset(record))), termination]);
    if (closed || options.signal?.aborted) throw new CommittedReviewQaPreviewBrowserError(options.signal?.aborted ? "CANCELLED" : "EXPIRED");
    if (nowEpochMs() >= deadlineEpochMs) { close("EXPIRED"); throw new CommittedReviewQaPreviewBrowserError("EXPIRED"); }
    // The lifecycle timer and abort listener intentionally remain: expiry or
    // cancellation disposes an already-initialized QA runtime as well.
    return runtime;
  } catch (error) {
    if (timer !== undefined) clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); closed = true; void startDisposal();
    if (error instanceof CommittedReviewQaPreviewBrowserError) throw error;
    throw new CommittedReviewQaPreviewBrowserError("RUNTIME_UNAVAILABLE");
  }
}
