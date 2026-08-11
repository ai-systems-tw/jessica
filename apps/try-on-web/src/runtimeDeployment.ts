import { parseDeploymentDocument, type DeploymentPointer } from "../../../packages/contracts/src/index.js";
import {
  deploymentReceipt,
  evaluateActiveDeployment,
  parseDeploymentReceipt,
  type DeploymentReceipt,
  type DeploymentSelection,
} from "../../../packages/runtime/src/index.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SignedDeploymentEnvelope = {
  schemaVersion: 1;
  kind: "jessica.signed-deployment";
  keyId: string;
  algorithm: "ES256";
  payloadSha256: string;
  payloadBase64: string;
  signatureBase64: string;
};

export type DeploymentReceiptStore = {
  read(scope: string): unknown | Promise<unknown>;
  commit(scope: string, expected: DeploymentReceipt | null, receipt: DeploymentReceipt): void | Promise<void>;
};

export type TrustedDeploymentAuthority = {
  authorityId: string;
  publicJwk: JsonWebKey;
};

export type DeploymentTrustConfiguration = {
  trustedKeys: Readonly<Record<string, TrustedDeploymentAuthority>>;
  allowedDeploymentOrigins: readonly string[];
  allowedCatalogOrigins: readonly string[];
  minimumRevision: number;
  minimumGeneration: number;
  maximumDocumentLifetimeMs: number;
  maximumDocumentAgeMs: number;
};

const MAX_ENVELOPE_BYTES = 256 * 1024;
const MAX_PAYLOAD_BYTES = 128 * 1024;

export function parseSignedDeploymentEnvelope(value: unknown): SignedDeploymentEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("signed deployment envelope must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("signed deployment envelope must be a plain object");
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("signed deployment envelope must not contain symbol fields");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError("signed deployment envelope fields must be enumerable data properties");
  }
  const candidate = value as Record<string, unknown>;
  const keys = ["schemaVersion", "kind", "keyId", "algorithm", "payloadSha256", "payloadBase64", "signatureBase64"];
  if (Object.keys(candidate).length !== keys.length || keys.some((key) => !(key in candidate))) throw new TypeError("signed deployment envelope fields are invalid");
  if (candidate.schemaVersion !== 1 || candidate.kind !== "jessica.signed-deployment") throw new TypeError("signed deployment envelope version or kind is unsupported");
  if (typeof candidate.keyId !== "string" || candidate.keyId === "") throw new TypeError("signed deployment keyId is required");
  if (candidate.algorithm !== "ES256") throw new TypeError("signed deployment algorithm must be ES256");
  if (typeof candidate.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.payloadSha256)) throw new TypeError("signed deployment payloadSha256 is invalid");
  for (const key of ["payloadBase64", "signatureBase64"]) if (typeof candidate[key] !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate[key] as string)) throw new TypeError(`signed deployment ${key} is invalid`);
  return value as SignedDeploymentEnvelope;
}

function base64Bytes(value: string, path: string): Uint8Array<ArrayBuffer> {
  if (value.length % 4 !== 0) throw new TypeError(`${path} must be canonical base64`);
  let binary: string;
  try { binary = atob(value); } catch { throw new TypeError(`${path} must be valid base64`); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (btoa(String.fromCharCode(...bytes)) !== value) throw new TypeError(`${path} must be canonical base64`);
  return bytes;
}

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function allowedOrigin(url: URL, origins: ReadonlySet<string>, label: string): void {
  if (url.username !== "" || url.password !== "") throw new Error(`${label} URL must not contain credentials`);
  if (!origins.has(url.origin)) throw new Error(`${label} origin is not trusted: ${url.origin}`);
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function fetchEnvelope(url: URL, fetchFn: FetchLike, origins: ReadonlySet<string>, signal?: AbortSignal): Promise<ArrayBuffer> {
  allowedOrigin(url, origins, "deployment envelope");
  const response = await fetchFn(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "follow", ...(signal ? { signal } : {}) });
  if (!response.ok) {
    await cancelBody(response);
    throw new Error(`deployment envelope returned HTTP ${response.status}`);
  }
  if (response.url) {
    try { allowedOrigin(new URL(response.url), origins, "deployment envelope redirect"); }
    catch (error) { await cancelBody(response); throw error; }
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_ENVELOPE_BYTES)) {
    await cancelBody(response);
    throw new Error("deployment envelope exceeds byte limit");
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ENVELOPE_BYTES) throw new Error("deployment envelope exceeds byte limit");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_ENVELOPE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("deployment envelope exceeds byte limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined.buffer;
}

function receiptScope(selection: DeploymentSelection): string {
  return JSON.stringify([selection.tenantId, selection.siteId, selection.environment]);
}

function assertPublicP256Jwk(jwk: JsonWebKey): void {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d !== undefined) {
    throw new TypeError("trusted deployment JWK must be a public P-256 key");
  }
}

export type VerifiedDeploymentEnvelope = {
  pointer: DeploymentPointer;
  documentSha256: string;
  freshnessDeadlineEpochMs: number;
  scope: string;
  priorReceipt: DeploymentReceipt | null;
};

export async function verifyDeploymentEnvelope(options: {
  deploymentUrl: string | URL;
  selection: DeploymentSelection;
  trust: DeploymentTrustConfiguration;
  receiptStore?: DeploymentReceiptStore;
  fetchFn: FetchLike;
  nowEpochMs: number;
  signal?: AbortSignal;
}): Promise<VerifiedDeploymentEnvelope> {
  if (!Number.isSafeInteger(options.trust.minimumRevision) || options.trust.minimumRevision < 1) throw new TypeError("minimum deployment revision must be a positive integer");
  if (!Number.isSafeInteger(options.trust.minimumGeneration) || options.trust.minimumGeneration < 1) throw new TypeError("minimum deployment generation must be a positive integer");
  const deploymentUrl = new URL(options.deploymentUrl, typeof location === "undefined" ? "http://localhost/" : location.href);
  if (options.trust.allowedDeploymentOrigins.length === 0 || options.trust.allowedDeploymentOrigins.some((origin) => {
    try { const parsed = new URL(origin); return parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username !== "" || parsed.password !== ""; } catch { return true; }
  })) throw new Error("host deployment origins must be non-empty canonical HTTPS origins");
  const origins = new Set(options.trust.allowedDeploymentOrigins);
  if (deploymentUrl.protocol !== "https:") throw new Error("production deployment origins must use HTTPS");
  if (deploymentUrl.username !== "" || deploymentUrl.password !== "") throw new Error("deployment envelope URL must not contain credentials");
  if (options.trust.allowedCatalogOrigins.some((origin) => {
    try { const parsed = new URL(origin); return parsed.protocol !== "https:" || parsed.origin !== origin; } catch { return true; }
  })) throw new Error("host catalog origins must be canonical HTTPS origins");
  const envelopeBytes = await fetchEnvelope(deploymentUrl, options.fetchFn, origins, options.signal);
  let envelopeValue: unknown;
  try { envelopeValue = JSON.parse(new TextDecoder().decode(envelopeBytes)); } catch { throw new Error("signed deployment envelope JSON is invalid"); }
  const envelope = parseSignedDeploymentEnvelope(envelopeValue);
  const trusted = Object.prototype.hasOwnProperty.call(options.trust.trustedKeys, envelope.keyId)
    ? options.trust.trustedKeys[envelope.keyId]
    : undefined;
  if (!trusted) throw new Error("deployment keyId is not trusted by host configuration");
  assertPublicP256Jwk(trusted.publicJwk);
  if (envelope.payloadBase64.length > Math.ceil(MAX_PAYLOAD_BYTES / 3) * 4) throw new Error("deployment payload exceeds byte limit");
  const payloadBytes = base64Bytes(envelope.payloadBase64, "deployment payload");
  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error("deployment payload exceeds byte limit");
  const documentSha256 = await sha256(payloadBytes);
  if (envelope.payloadSha256 !== documentSha256) throw new Error("deployment payload SHA-256 mismatch");
  const signature = base64Bytes(envelope.signatureBase64, "deployment signature");
  if (signature.byteLength !== 64) throw new TypeError("ES256 deployment signature must be 64-byte IEEE P1363");
  const key = await crypto.subtle.importKey("jwk", trusted.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, payloadBytes)) throw new Error("deployment signature verification failed");
  let documentValue: unknown;
  try { documentValue = JSON.parse(new TextDecoder().decode(payloadBytes)); } catch { throw new Error("verified deployment payload JSON is invalid"); }
  const document = parseDeploymentDocument(documentValue);
  if (document.authorityId !== trusted.authorityId) throw new Error("verified deployment authority does not match host key binding");
  const scope = receiptScope(options.selection);
  const stored = options.receiptStore ? await options.receiptStore.read(scope) : undefined;
  const priorReceipt = stored === undefined || stored === null ? undefined : parseDeploymentReceipt(stored);
  const pointer = evaluateActiveDeployment({
    document,
    documentSha256,
    selection: options.selection,
    trust: {
      authorityId: trusted.authorityId,
      minimumRevision: options.trust.minimumRevision,
      minimumGeneration: options.trust.minimumGeneration,
      allowedCatalogOrigins: options.trust.allowedCatalogOrigins,
      maximumDocumentLifetimeMs: options.trust.maximumDocumentLifetimeMs,
      maximumDocumentAgeMs: options.trust.maximumDocumentAgeMs,
      nowEpochMs: options.nowEpochMs,
      ...(priorReceipt ? { priorReceipt } : {}),
    },
  });
  const freshnessDeadlineEpochMs = Math.min(
    Date.parse(document.expiresAt),
    Date.parse(document.issuedAt) + options.trust.maximumDocumentAgeMs,
  );
  return { pointer, documentSha256, freshnessDeadlineEpochMs, scope, priorReceipt: priorReceipt ?? null };
}

type LockManagerLike = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };

export class LocalStorageDeploymentReceiptStore implements DeploymentReceiptStore {
  readonly #storage: Storage;
  readonly #locks: LockManagerLike;

  constructor(storage: Storage, locks: LockManagerLike) {
    this.#storage = storage;
    this.#locks = locks;
  }

  read(scope: string): unknown {
    const value = this.#storage.getItem(`jessica:deployment-receipt:${scope}`);
    if (value === null) return null;
    try { return JSON.parse(value); } catch { throw new Error("stored deployment receipt JSON is invalid"); }
  }

  async commit(scope: string, expected: DeploymentReceipt | null, receipt: DeploymentReceipt): Promise<void> {
    await this.#locks.request(`jessica:deployment-receipt:${scope}`, async () => {
      const currentValue = this.read(scope);
      const current = currentValue === null ? null : parseDeploymentReceipt(currentValue);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("deployment receipt changed during verification");
      if (current) {
        const idempotent = receipt.revision === current.revision && receipt.generation === current.generation && receipt.documentSha256 === current.documentSha256;
        const advanced = receipt.revision > current.revision && receipt.generation > current.generation;
        if (!idempotent && !advanced) throw new Error("deployment receipt commit would regress freshness");
      }
      this.#storage.setItem(`jessica:deployment-receipt:${scope}`, JSON.stringify(receipt));
    });
  }
}

export function acceptedDeploymentReceipt(verified: VerifiedDeploymentEnvelope): DeploymentReceipt {
  return deploymentReceipt(verified.pointer, verified.documentSha256);
}
