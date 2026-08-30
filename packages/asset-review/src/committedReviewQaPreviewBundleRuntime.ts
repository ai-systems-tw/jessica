/**
 * Trusted-server JSC-0221A2 runtime adapter. It consumes only the fresh
 * committed-review binding carried by the verifier command; it has no database
 * dependency and never serializes private locators into the response bundle.
 */
import {
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES,
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES,
  canonicalJson,
  parseAssetManifest,
  parseUnverifiedCommittedReviewQaPreviewTransportGrant,
  sha256Hex,
  type UnverifiedCommittedReviewQaPreviewBundleEnvelope,
} from "../../contracts/src/index.js";
import { composeUnverifiedCommittedReviewQaPreviewBundle, inspectCommittedReviewQaPreviewArtifacts } from "../../assets/src/index.js";
import { claimAuthenticCommittedReviewQaPreviewRuntimeCommand, CommittedReviewQaPreviewTransportError, type CommittedReviewQaPreviewRuntimeAdapter, type CommittedReviewQaPreviewRuntimeCommand } from "./committedReviewQaPreviewTransport.js";

export type CommittedReviewQaPreviewPrivateArtifactRead = Readonly<{
  privateLocator: string;
  contentType: "application/json" | "model/gltf-binary";
  expectedByteLength: number;
  maximumByteLength: number;
}>;

export interface CommittedReviewQaPreviewPrivateArtifactSource {
  /**
   * Reads one exact object. Implementations must not follow redirects outside
   * their configured prefix and should enforce the supplied maximum while
   * streaming; this adapter independently snapshots and rechecks the result.
   */
  readExact(request: CommittedReviewQaPreviewPrivateArtifactRead, signal?: AbortSignal): Promise<ArrayBuffer | Uint8Array>;
}

export type CommittedReviewQaPreviewAllowlistedPrivateSource = Readonly<{
  /** Canonical HTTPS directory prefix ending in `/`. */
  locatorPrefix: string;
  source: CommittedReviewQaPreviewPrivateArtifactSource;
}>;

export interface CommittedReviewQaPreviewBundleSigner {
  readonly algorithm: "ES256";
  readonly authorityId: string;
  readonly keyId: string;
  /** Canonical public verification key corresponding to the private signer. */
  readonly publicJwk: JsonWebKey;
  /** Returns a raw 64-byte IEEE-P1363 signature. */
  sign(payload: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
}

export type CommittedReviewQaPreviewBundleRuntimeDependencies = Readonly<{
  signer: CommittedReviewQaPreviewBundleSigner;
  /** Every transport verification key accepted by the paired verifier. */
  disallowedTransportPublicJwks: readonly JsonWebKey[];
  privateSources: readonly CommittedReviewQaPreviewAllowlistedPrivateSource[];
  now(): Promise<string>;
}>;

export type FetchCommittedReviewQaPreviewPrivateArtifactSourceDependencies = Readonly<{
  fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const arrayBufferSlice = ArrayBuffer.prototype.slice;
const uint8Slice = Uint8Array.prototype.slice;

function unavailable(): never { throw new CommittedReviewQaPreviewTransportError("RUNTIME_UNAVAILABLE"); }
function cancelled(signal?: AbortSignal): void {
  if (signal === undefined) return;
  if (!abortSignalAborted || typeof signal !== "object" || signal === null) throw new CommittedReviewQaPreviewTransportError("CANCELLED");
  let value: unknown; try { value = Reflect.apply(abortSignalAborted, signal, []); } catch { throw new CommittedReviewQaPreviewTransportError("CANCELLED"); }
  if (value !== false) throw new CommittedReviewQaPreviewTransportError("CANCELLED");
}
function id(value: unknown): string { if (typeof value !== "string" || !ID.test(value)) unavailable(); return value; }
function timestamp(value: unknown): string { if (typeof value !== "string") unavailable(); const epoch = Date.parse(value); if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) unavailable(); return value; }
function bytes(value: ArrayBuffer | Uint8Array, expected: number, maximum: number): Uint8Array<ArrayBuffer> {
  try {
    let length: number;
    if (value instanceof Uint8Array) {
      if (!typedArrayByteLength || !typedArrayBuffer || !typedArrayByteOffset) unavailable();
      length = Reflect.apply(typedArrayByteLength, value, []) as number;
      if (length !== expected || length < 1 || length > maximum) unavailable();
      const buffer = Reflect.apply(typedArrayBuffer, value, []); const offset = Reflect.apply(typedArrayByteOffset, value, []) as number;
      if (!(buffer instanceof ArrayBuffer)) unavailable();
      return Reflect.apply(uint8Slice, new Uint8Array(buffer, offset, length), []) as Uint8Array<ArrayBuffer>;
    }
    if (value instanceof ArrayBuffer) {
      if (!arrayBufferByteLength) unavailable(); length = Reflect.apply(arrayBufferByteLength, value, []) as number;
      if (length !== expected || length < 1 || length > maximum) unavailable();
      return new Uint8Array(Reflect.apply(arrayBufferSlice, value, [0, length]) as ArrayBuffer);
    }
  } catch (error) { if (error instanceof CommittedReviewQaPreviewTransportError) throw error; }
  return unavailable();
}
function canonicalPrefix(value: unknown): Readonly<{ href: string; origin: string; pathname: string }> {
  if (typeof value !== "string" || value.includes("\\") || /%(?:2e|2f|5c)/i.test(value)) throw new TypeError("invalid QA-preview private source prefix");
  let parsed: URL; try { parsed = new URL(value); } catch { throw new TypeError("invalid QA-preview private source prefix"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.href !== value || !parsed.pathname.endsWith("/")) throw new TypeError("invalid QA-preview private source prefix");
  return Object.freeze({ href: value, origin: parsed.origin, pathname: parsed.pathname });
}
function canonicalLocator(value: unknown): Readonly<{ href: string; origin: string; pathname: string }> {
  if (typeof value !== "string" || value.includes("\\") || /%(?:2e|2f|5c)/i.test(value)) unavailable();
  let parsed: URL; try { parsed = new URL(value); } catch { unavailable(); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.href !== value || parsed.pathname.endsWith("/")) unavailable();
  return Object.freeze({ href: value, origin: parsed.origin, pathname: parsed.pathname });
}
function toBase64(value: Uint8Array<ArrayBuffer>): string {
  if (!(value instanceof Uint8Array) || value.byteLength !== 64) unavailable();
  let binary = ""; for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function encode(value: unknown): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(canonicalJson(value)) as Uint8Array<ArrayBuffer>; }
function equal(left: readonly unknown[], right: readonly unknown[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function canonicalCoordinate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try { const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "="); return binary.length === 32 && btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === value; } catch { return false; }
}
function verificationJwk(value: unknown): JsonWebKey {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("invalid QA-preview bundle verification key");
  const keys = ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"] as const; const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)) || Object.entries(descriptors).some(([key, descriptor]) => !keys.includes(key as typeof keys[number]) || !descriptor.enumerable || descriptor.get || descriptor.set)) throw new TypeError("invalid QA-preview bundle verification key");
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.key_ops) || Object.getPrototypeOf(row.key_ops) !== Array.prototype || row.key_ops.length !== 1 || Reflect.ownKeys(row.key_ops).length !== 2) throw new TypeError("invalid QA-preview bundle verification key");
  const operation = Object.getOwnPropertyDescriptor(row.key_ops, "0");
  if (!operation?.enumerable || operation.get || operation.set || operation.value !== "verify" || row.ext !== true || row.kty !== "EC" || row.crv !== "P-256" || row.use !== "sig" || row.alg !== "ES256" || !canonicalCoordinate(row.x) || !canonicalCoordinate(row.y)) throw new TypeError("invalid QA-preview bundle verification key");
  return structuredClone(value) as JsonWebKey;
}
function coordinates(value: JsonWebKey): string { return `${value.x!}.${value.y!}`; }
async function cancelResponseBody(response: Response): Promise<void> {
  try { if (response.body !== null) await response.body.cancel(); } catch { /* best-effort private response shutdown */ }
}

/** Strict bounded HTTPS implementation for a private artifact source port. */
export function createFetchCommittedReviewQaPreviewPrivateArtifactSource(dependencies: FetchCommittedReviewQaPreviewPrivateArtifactSourceDependencies = {}): CommittedReviewQaPreviewPrivateArtifactSource {
  const fetchFn = dependencies.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") throw new TypeError("QA-preview private fetch is unavailable");
  return Object.freeze({
    async readExact(request: CommittedReviewQaPreviewPrivateArtifactRead, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
      cancelled(signal);
      const locator = canonicalLocator(request.privateLocator);
      if (!Number.isSafeInteger(request.expectedByteLength) || request.expectedByteLength < 1 || !Number.isSafeInteger(request.maximumByteLength) || request.maximumByteLength < request.expectedByteLength) unavailable();
      const init: RequestInit = { method: "GET", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", headers: Object.freeze({ accept: request.contentType }) };
      if (signal !== undefined) init.signal = signal;
      let response: Response;
      try { response = await Reflect.apply(fetchFn, undefined, [locator.href, init]); } catch { cancelled(signal); unavailable(); }
      try { cancelled(signal); } catch (error) { await cancelResponseBody(response); throw error; }
      let lengthHeader: string | null; let contentType: string | null; let contentEncoding: string | null;
      try {
        if (!(response instanceof Response)) unavailable();
        if (!response.ok || response.status !== 200 || response.redirected || response.url !== locator.href) { await cancelResponseBody(response); unavailable(); }
        lengthHeader = response.headers.get("content-length"); contentType = response.headers.get("content-type"); contentEncoding = response.headers.get("content-encoding");
      } catch (error) { if (error instanceof CommittedReviewQaPreviewTransportError) throw error; return unavailable(); }
      if (lengthHeader === null || !/^[1-9][0-9]*$/.test(lengthHeader)) { await cancelResponseBody(response); unavailable(); }
      const declaredLength = Number(lengthHeader);
      if (!Number.isSafeInteger(declaredLength) || declaredLength !== request.expectedByteLength || declaredLength > request.maximumByteLength || contentType !== request.contentType || (contentEncoding !== null && contentEncoding !== "identity")) { await cancelResponseBody(response); unavailable(); }
      let reader: ReadableStreamDefaultReader<Uint8Array>;
      try { if (response.body === null) unavailable(); reader = response.body.getReader(); } catch (error) { if (error instanceof CommittedReviewQaPreviewTransportError) throw error; unavailable(); }
      const output = new Uint8Array(request.expectedByteLength); let offset = 0;
      try {
        while (true) {
          cancelled(signal); const item = await reader.read(); cancelled(signal);
          if (item.done) break;
          const chunk = item.value;
          if (!(chunk instanceof Uint8Array) || !typedArrayByteLength || !typedArrayBuffer || !typedArrayByteOffset) unavailable();
          const length = Reflect.apply(typedArrayByteLength, chunk, []) as number;
          if (length < 1 || offset + length > request.expectedByteLength) unavailable();
          const buffer = Reflect.apply(typedArrayBuffer, chunk, []); const byteOffset = Reflect.apply(typedArrayByteOffset, chunk, []) as number;
          if (!(buffer instanceof ArrayBuffer)) unavailable();
          output.set(new Uint8Array(buffer, byteOffset, length), offset); offset += length;
        }
        if (offset !== request.expectedByteLength) { try { await reader.cancel(); } catch { /* best-effort */ } unavailable(); }
      } catch (error) {
        try { await reader.cancel(); } catch { /* best-effort stream shutdown */ }
        if (error instanceof CommittedReviewQaPreviewTransportError) throw error;
        cancelled(signal); unavailable();
      } finally {
        try { reader.releaseLock(); } catch { /* best-effort stream release */ }
      }
      return output;
    },
  });
}

export function createCommittedReviewQaPreviewBundleRuntimeAdapter(dependencies: CommittedReviewQaPreviewBundleRuntimeDependencies): CommittedReviewQaPreviewRuntimeAdapter<Uint8Array<ArrayBuffer>> {
  if (dependencies.signer.algorithm !== "ES256") throw new TypeError("QA-preview bundle signer must be ES256");
  const authorityId = id(dependencies.signer.authorityId); const keyId = id(dependencies.signer.keyId);
  const bundlePublicJwk = verificationJwk(dependencies.signer.publicJwk);
  if (!Array.isArray(dependencies.disallowedTransportPublicJwks) || Object.getPrototypeOf(dependencies.disallowedTransportPublicJwks) !== Array.prototype || dependencies.disallowedTransportPublicJwks.length < 1 || dependencies.disallowedTransportPublicJwks.length > 16 || Reflect.ownKeys(dependencies.disallowedTransportPublicJwks).length !== dependencies.disallowedTransportPublicJwks.length + 1) throw new TypeError("invalid QA-preview transport key exclusion set");
  const exclusionDescriptors = Object.getOwnPropertyDescriptors(dependencies.disallowedTransportPublicJwks);
  const disallowedValues = Array.from({ length: dependencies.disallowedTransportPublicJwks.length }, (_unused, index) => {
    const descriptor = exclusionDescriptors[String(index)]; if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError("invalid QA-preview transport key exclusion set"); return descriptor.value;
  });
  const disallowedCoordinates = new Set(disallowedValues.map((candidate) => coordinates(verificationJwk(candidate))));
  if (disallowedCoordinates.size !== dependencies.disallowedTransportPublicJwks.length || disallowedCoordinates.has(coordinates(bundlePublicJwk))) throw new TypeError("bundle signing key must be cryptographically distinct from every transport key");
  if (!Array.isArray(dependencies.privateSources) || Object.getPrototypeOf(dependencies.privateSources) !== Array.prototype || dependencies.privateSources.length < 1 || dependencies.privateSources.length > 16) throw new TypeError("invalid QA-preview private source set");
  const sources = dependencies.privateSources.map((entry) => {
    if (typeof entry !== "object" || entry === null || Object.getPrototypeOf(entry) !== Object.prototype || Reflect.ownKeys(entry).length !== 2 || !Object.hasOwn(entry, "locatorPrefix") || !Object.hasOwn(entry, "source")) throw new TypeError("invalid QA-preview private source");
    const descriptors = Object.getOwnPropertyDescriptors(entry); if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || descriptor.get || descriptor.set)) throw new TypeError("invalid QA-preview private source");
    if (typeof entry.source !== "object" || entry.source === null || typeof entry.source.readExact !== "function") throw new TypeError("invalid QA-preview private source");
    return Object.freeze({ prefix: canonicalPrefix(entry.locatorPrefix), source: entry.source });
  });
  for (let index = 0; index < sources.length; index += 1) for (let other = index + 1; other < sources.length; other += 1) {
    const left = sources[index]!.prefix; const right = sources[other]!.prefix;
    if (left.href.startsWith(right.href) || right.href.startsWith(left.href)) throw new TypeError("overlapping QA-preview private source prefixes");
  }
  async function read(privateLocator: string, contentType: "application/json" | "model/gltf-binary", expectedByteLength: number, maximumByteLength: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const locator = canonicalLocator(privateLocator);
    const matches = sources.filter(({ prefix }) => prefix.origin === locator.origin && locator.pathname.startsWith(prefix.pathname));
    if (matches.length !== 1 || !Number.isSafeInteger(expectedByteLength) || expectedByteLength < 1 || expectedByteLength > maximumByteLength) unavailable();
    const request = Object.freeze({ privateLocator: locator.href, contentType, expectedByteLength, maximumByteLength });
    cancelled(signal); let result: ArrayBuffer | Uint8Array;
    try { result = await matches[0]!.source.readExact(request, signal); } catch { cancelled(signal); unavailable(); }
    cancelled(signal); return bytes(result, expectedByteLength, maximumByteLength);
  }
  return Object.freeze({
    async execute(command: CommittedReviewQaPreviewRuntimeCommand, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
      cancelled(signal);
      if (!claimAuthenticCommittedReviewQaPreviewRuntimeCommand(command)) unavailable();
      let grant: ReturnType<typeof parseUnverifiedCommittedReviewQaPreviewTransportGrant>;
      try { grant = parseUnverifiedCommittedReviewQaPreviewTransportGrant(command.verifiedGrant); } catch { unavailable(); }
      if (authorityId === grant.issuerAuthorityId || !disallowedCoordinates.has(`${command.transportVerificationKey.x}.${command.transportVerificationKey.y}`)) unavailable();
      const runtimeAsset = command.runtimeAsset;
      if (command.authority.qaPreviewRuntime !== true || command.authority.runtime !== false || command.authority.publicLive !== false
        || command.grantId !== grant.grantId || command.requestId !== grant.requestId || command.tenantId !== grant.tenantId || command.actorId !== grant.actorId || command.reviewerId !== grant.reviewerId || command.sessionId !== grant.sessionId
        || canonicalJson(command.selection) !== canonicalJson(grant.selection) || canonicalJson(command.commitment) !== canonicalJson(grant.commitment) || command.committedReviewValidUntil !== grant.committedReviewValidUntil || command.issuedAt !== grant.issuedAt || command.expiresAt !== grant.expiresAt
        || runtimeAsset.tenantId !== grant.selection.tenantId || runtimeAsset.assetVersionId !== grant.selection.assetVersionId || runtimeAsset.assetVersion !== grant.selection.assetVersion || runtimeAsset.fixture !== false) unavailable();
      const manifestBytes = await read(runtimeAsset.manifest.privateLocator, "application/json", runtimeAsset.manifest.byteLength, COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MANIFEST_BYTES, signal);
      cancelled(signal);
      let manifest: ReturnType<typeof parseAssetManifest>;
      try { manifest = parseAssetManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes))); } catch { unavailable(); }
      const manifestSha256 = await sha256Hex(manifestBytes); cancelled(signal);
      if (manifestSha256 !== runtimeAsset.manifest.sha256 || manifest.assetId !== runtimeAsset.assetVersionId || manifest.assetVersion !== runtimeAsset.assetVersion || manifest.fixture !== false || manifest.model.url !== "./model.glb"
        || manifest.model.sha256 !== runtimeAsset.model.sha256 || manifest.model.byteLength !== runtimeAsset.model.byteLength || !equal(manifest.sourceAssetHashes, runtimeAsset.sourceAssetSha256s)) unavailable();
      const modelBytes = await read(runtimeAsset.model.privateLocator, "model/gltf-binary", runtimeAsset.model.byteLength, COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_MODEL_BYTES, signal);
      const inspected = await inspectCommittedReviewQaPreviewArtifacts(manifestBytes, modelBytes, grant.selection); cancelled(signal);
      if (inspected.manifestSha256 !== runtimeAsset.manifest.sha256 || inspected.modelSha256 !== runtimeAsset.model.sha256) unavailable();
      let composedAt: string; try { composedAt = timestamp(await dependencies.now()); } catch { unavailable(); }
      const composedEpoch = Date.parse(composedAt); if (composedEpoch < Date.parse(grant.issuedAt) || composedEpoch >= Date.parse(grant.expiresAt) || composedEpoch >= Date.parse(command.eligibilityExpiresAt) || composedEpoch >= Date.parse(grant.committedReviewValidUntil)) unavailable();
      const transportGrantSha256 = await sha256Hex(encode(grant)); cancelled(signal);
      const { signatureBase64: _transportSignature, ...transport } = grant;
      const payload = Object.freeze({
        schemaVersion: 1 as const, type: "jessica.committed-review-qa-preview-unverified-bundle-envelope" as const, algorithm: "ES256" as const, scope: grant.scope,
        bundleSignerAuthorityId: authorityId, bundleSignerKeyId: keyId, composedAt, transportGrantSha256, transport: Object.freeze(transport),
        runtimeAssetProjection: Object.freeze({ id: runtimeAsset.assetVersionId, tenantId: runtimeAsset.tenantId, frameModelId: runtimeAsset.frameModelId, frameVariantId: runtimeAsset.frameVariantId, version: runtimeAsset.assetVersion,
          quality: runtimeAsset.quality, generationMethod: runtimeAsset.generationMethod, status: "approved" as const, fixture: false as const, sourceAssetHashes: Object.freeze([...runtimeAsset.sourceAssetSha256s]), attachmentMatrix: Object.freeze([...runtimeAsset.attachmentMatrix]), qualityEnvelope: Object.freeze({ ...runtimeAsset.qualityEnvelope }) }),
        manifest: Object.freeze({ contentType: "application/json" as const, sha256: inspected.manifestSha256, byteLength: inspected.manifestBytes.byteLength }),
        model: Object.freeze({ contentType: "model/gltf-binary" as const, sha256: inspected.modelSha256, byteLength: inspected.modelBytes.byteLength }),
        evidence: Object.freeze({ verification: "required" as const, artifactContainerOnly: true as const, browserRuntimeUsable: false as const, publicLiveUsable: false as const }),
      });
      const payloadBytes = encode(payload);
      let signature: Uint8Array<ArrayBuffer>; try { signature = bytes(await dependencies.signer.sign(payloadBytes, signal), 64, 64); } catch { cancelled(signal); unavailable(); }
      cancelled(signal);
      try {
        const verificationKey = await crypto.subtle.importKey("jwk", bundlePublicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verificationKey, signature, payloadBytes)) unavailable();
      } catch (error) { if (error instanceof CommittedReviewQaPreviewTransportError) throw error; unavailable(); }
      cancelled(signal);
      let envelope: UnverifiedCommittedReviewQaPreviewBundleEnvelope;
      try { envelope = Object.freeze({ ...payload, signatureBase64: toBase64(signature) }); } catch { unavailable(); }
      let bundle: Uint8Array<ArrayBuffer>; try { bundle = await composeUnverifiedCommittedReviewQaPreviewBundle(envelope, inspected.manifestBytes, inspected.modelBytes); } catch { unavailable(); }
      cancelled(signal);
      let completedAt: string; try { completedAt = timestamp(await dependencies.now()); } catch { unavailable(); }
      const completedEpoch = Date.parse(completedAt);
      if (completedEpoch < composedEpoch || completedEpoch >= Date.parse(grant.expiresAt) || completedEpoch >= Date.parse(command.eligibilityExpiresAt) || completedEpoch >= Date.parse(grant.committedReviewValidUntil)) unavailable();
      return bundle;
    },
  });
}
