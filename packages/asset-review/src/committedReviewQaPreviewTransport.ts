/**
 * Server-only JSC-0221 boundary. The issuer owns a private signing dependency;
 * the verifier owns only public trust plus an online one-shot ledger and a
 * trusted runtime adapter. Neither factory belongs in a browser entry graph.
 */
import {
  canonicalJson,
  parseCommittedReviewQaPreviewTransportRequest,
  parseUnverifiedCommittedReviewQaPreviewTransportGrant,
  type CommittedReviewQaPreviewTransportSelection,
  type UnverifiedCommittedReviewQaPreviewTransportGrant,
  type UnverifiedCommittedReviewQaPreviewTransportGrantPayload,
  unverifiedCommittedReviewQaPreviewTransportGrantPayload,
} from "../../contracts/src/index.js";
import type { CommittedReviewQaPreviewEligibility, CommittedReviewQaPreviewService } from "./committedReviewQaPreview.js";

export type CommittedReviewQaPreviewTransportErrorCode = "UNAUTHENTICATED" | "DENIED" | "CANCELLED" | "SIGNER_UNAVAILABLE" | "REPLAYED" | "RUNTIME_UNAVAILABLE";

/** Stable outward errors contain no key, signature, authentication, or adapter diagnostics. */
export class CommittedReviewQaPreviewTransportError {
  readonly code: CommittedReviewQaPreviewTransportErrorCode;
  constructor(code: CommittedReviewQaPreviewTransportErrorCode) { this.code = code; Object.freeze(this); }
}

export type CommittedReviewQaPreviewTransportActor = Readonly<{
  tenantId: string;
  actorId: string;
  reviewerId: string;
  sessionId: string;
  sessionExpiresAt: string;
  scopes: readonly ["qa-preview:read"];
}>;

export interface CommittedReviewQaPreviewTransportSigner {
  readonly algorithm: "ES256";
  readonly authorityId: string;
  readonly keyId: string;
  /** Must return a raw 64-byte IEEE-P1363 ECDSA signature. */
  sign(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

export type CommittedReviewQaPreviewTransportTrustedKey = Readonly<{
  authorityId: string;
  keyId: string;
  tenantId: string;
  publicJwk: JsonWebKey;
}>;

export interface CommittedReviewQaPreviewTransportReplayStore {
  /**
   * Atomically changes an unseen grant to consumed. False means already
   * consumed. A rejection is an ambiguous outcome: the caller denies the
   * current attempt, but only a production durable provider can recover or
   * prove the tombstone before any retry.
   */
  claim(grantId: string, expiresAt: string, observedAt: string): Promise<boolean>;
}

export type CommittedReviewQaPreviewRuntimeCommand = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-runtime-command";
  grantId: string;
  requestId: string;
  tenantId: string;
  actorId: string;
  reviewerId: string;
  sessionId: string;
  selection: CommittedReviewQaPreviewTransportSelection;
  commitment: Readonly<{ assetRowSha256: string; bindingRowSha256: string; reviewRowSha256: string; authorityRowSha256: string }>;
  committedReviewValidUntil: string;
  issuedAt: string;
  expiresAt: string;
  authority: Readonly<{ qaPreviewRuntime: true; runtime: false; publicLive: false; publication: false; deployment: false; commerce: false }>;
}>;

export interface CommittedReviewQaPreviewRuntimeAdapter<Result = unknown> {
  execute(command: CommittedReviewQaPreviewRuntimeCommand, signal?: AbortSignal): Promise<Result>;
}

export type CommittedReviewQaPreviewTransportIssuer = Readonly<{
  issue(actorRequestIdentity: unknown, request: unknown, signal?: AbortSignal): Promise<UnverifiedCommittedReviewQaPreviewTransportGrant>;
}>;

export type CommittedReviewQaPreviewTransportVerifier<Result = unknown> = Readonly<{
  consume(actorRequestIdentity: unknown, grant: unknown, signal?: AbortSignal): Promise<Result>;
}>;

type IssuerDependencies = Readonly<{
  authenticate(actorRequestIdentity: string): Promise<unknown>;
  committedReview: CommittedReviewQaPreviewService;
  signer: CommittedReviewQaPreviewTransportSigner;
  audience: string;
  createGrantId(): string;
  now(): Promise<string>;
  maximumGrantAgeMs?: number;
}>;

type VerifierDependencies<Result> = Readonly<{
  authenticate(actorRequestIdentity: string): Promise<unknown>;
  committedReview: CommittedReviewQaPreviewService;
  trustedKeys: readonly CommittedReviewQaPreviewTransportTrustedKey[];
  audience: string;
  replayStore: CommittedReviewQaPreviewTransportReplayStore;
  runtime: CommittedReviewQaPreviewRuntimeAdapter<Result>;
  now(): Promise<string>;
  maximumGrantAgeMs?: number;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE = /^[a-f0-9]{64}$/;
const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function denied(): never { throw new CommittedReviewQaPreviewTransportError("DENIED"); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) denied();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) denied();
  for (const [key, descriptor] of Object.entries(descriptors)) if (!keys.includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set) denied();
  return value as Record<string, unknown>;
}
function id(value: unknown): string { if (typeof value !== "string" || !ID.test(value)) denied(); return value; }
function nonce(value: unknown): string { if (typeof value !== "string" || !NONCE.test(value)) denied(); return value; }
function timestamp(value: unknown): string { if (typeof value !== "string") denied(); const epoch = Date.parse(value); if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) denied(); return value; }
function identity(value: unknown): string { if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) denied(); return value; }
function cancelled(signal?: AbortSignal): void {
  if (signal === undefined) return;
  if (!abortSignalAborted || typeof signal !== "object" || signal === null) throw new CommittedReviewQaPreviewTransportError("CANCELLED");
  let value: unknown; try { value = Reflect.apply(abortSignalAborted, signal, []); } catch { throw new CommittedReviewQaPreviewTransportError("CANCELLED"); }
  if (value !== false) throw new CommittedReviewQaPreviewTransportError("CANCELLED");
}
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalAudience(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("invalid QA-preview transport audience");
  let parsed: URL; try { parsed = new URL(value); } catch { throw new TypeError("invalid QA-preview transport audience"); }
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") throw new TypeError("invalid QA-preview transport audience");
  return value;
}
function maximumAge(value: unknown): number {
  const age = value ?? 30_000;
  if (typeof age !== "number" || !Number.isSafeInteger(age) || age < 1 || age > 120_000) throw new TypeError("invalid QA-preview transport grant age");
  return age;
}
function actor(value: unknown): CommittedReviewQaPreviewTransportActor {
  const row = exact(value, ["tenantId", "actorId", "reviewerId", "sessionId", "sessionExpiresAt", "scopes"]);
  if (!Array.isArray(row.scopes) || Object.getPrototypeOf(row.scopes) !== Array.prototype || row.scopes.length !== 1 || Reflect.ownKeys(row.scopes).length !== 2 || row.scopes[0] !== "qa-preview:read") denied();
  const descriptor = Object.getOwnPropertyDescriptor(row.scopes, "0"); if (!descriptor?.enumerable || descriptor.get || descriptor.set) denied();
  return deepFreeze({ tenantId: id(row.tenantId), actorId: id(row.actorId), reviewerId: id(row.reviewerId), sessionId: id(row.sessionId), sessionExpiresAt: timestamp(row.sessionExpiresAt), scopes: ["qa-preview:read"] as const });
}
async function authenticate(dependency: (identity: string) => Promise<unknown>, rawIdentity: unknown): Promise<CommittedReviewQaPreviewTransportActor> {
  let requestIdentity: string; try { requestIdentity = identity(rawIdentity); } catch { throw new CommittedReviewQaPreviewTransportError("UNAUTHENTICATED"); }
  try { return actor(await dependency(requestIdentity)); } catch { throw new CommittedReviewQaPreviewTransportError("UNAUTHENTICATED"); }
}
function sameActor(left: CommittedReviewQaPreviewTransportActor, right: CommittedReviewQaPreviewTransportActor): boolean {
  return left.tenantId === right.tenantId && left.actorId === right.actorId && left.reviewerId === right.reviewerId && left.sessionId === right.sessionId;
}
function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 64) denied();
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>; }
function payloadBytes(payload: UnverifiedCommittedReviewQaPreviewTransportGrantPayload): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(canonicalJson(payload)) as Uint8Array<ArrayBuffer>; }
function sameSelection(left: CommittedReviewQaPreviewTransportSelection, right: CommittedReviewQaPreviewEligibility["asset"]): boolean {
  return left.tenantId === right.tenantId && left.assetVersionId === right.assetVersionId && left.assetVersion === right.assetVersion;
}
function runtimeCommand(grant: UnverifiedCommittedReviewQaPreviewTransportGrant): CommittedReviewQaPreviewRuntimeCommand {
  return deepFreeze({ schemaVersion: 1 as const, type: "jessica.committed-review-qa-preview-runtime-command" as const, grantId: grant.grantId, requestId: grant.requestId,
    tenantId: grant.tenantId, actorId: grant.actorId, reviewerId: grant.reviewerId, sessionId: grant.sessionId, selection: { ...grant.selection }, commitment: { ...grant.commitment },
    committedReviewValidUntil: grant.committedReviewValidUntil, issuedAt: grant.issuedAt, expiresAt: grant.expiresAt, authority: { qaPreviewRuntime: true as const, runtime: false as const, publicLive: false as const, publication: false as const, deployment: false as const, commerce: false as const } });
}
function sameCommitment(left: UnverifiedCommittedReviewQaPreviewTransportGrant["commitment"], right: CommittedReviewQaPreviewEligibility["digests"]): boolean {
  return left.assetRowSha256 === right.assetRowSha256 && left.bindingRowSha256 === right.bindingRowSha256 && left.reviewRowSha256 === right.reviewRowSha256 && left.authorityRowSha256 === right.authorityRowSha256;
}
function validatePublicJwk(value: unknown): JsonWebKey {
  const row = exact(value, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"]);
  if (!Array.isArray(row.key_ops) || Object.getPrototypeOf(row.key_ops) !== Array.prototype || row.key_ops.length !== 1 || Reflect.ownKeys(row.key_ops).length !== 2) denied();
  const operation = Object.getOwnPropertyDescriptor(row.key_ops, "0");
  if (!operation?.enumerable || operation.get || operation.set || operation.value !== "verify") denied();
  if (row.ext !== true || row.kty !== "EC" || row.crv !== "P-256" || row.use !== "sig" || row.alg !== "ES256" || typeof row.x !== "string" || typeof row.y !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.x) || !/^[A-Za-z0-9_-]{43}$/.test(row.y)) denied();
  const canonicalCoordinate = (coordinate: string): boolean => {
    try {
      const base64 = coordinate.replaceAll("-", "+").replaceAll("_", "/") + "=";
      const binary = atob(base64); if (binary.length !== 32) return false;
      return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === coordinate;
    } catch { return false; }
  };
  if (!canonicalCoordinate(row.x) || !canonicalCoordinate(row.y)) denied();
  return structuredClone(value) as JsonWebKey;
}

export function createInMemoryCommittedReviewQaPreviewReplayStore(): CommittedReviewQaPreviewTransportReplayStore {
  const consumed = new Map<string, number>();
  return Object.freeze({
    async claim(rawGrantId: string, rawExpiresAt: string, rawObservedAt: string): Promise<boolean> {
      const grantId = nonce(rawGrantId); const expiresAt = timestamp(rawExpiresAt); const observedAt = timestamp(rawObservedAt); const now = Date.parse(observedAt);
      for (const [priorId, expiry] of consumed) if (expiry <= now) consumed.delete(priorId);
      if (Date.parse(expiresAt) <= now || consumed.has(grantId)) return false;
      // No await precedes the mutation: concurrent calls in this process have
      // exactly one winner. Production replaces this with an online atomic store.
      consumed.set(grantId, Date.parse(expiresAt));
      return true;
    },
  });
}

export function createCommittedReviewQaPreviewTransportIssuer(dependencies: IssuerDependencies): CommittedReviewQaPreviewTransportIssuer {
  const audience = canonicalAudience(dependencies.audience); const age = maximumAge(dependencies.maximumGrantAgeMs);
  if (dependencies.signer.algorithm !== "ES256") throw new TypeError("QA-preview transport signer must be ES256");
  const authorityId = id(dependencies.signer.authorityId); const keyId = id(dependencies.signer.keyId);
  return Object.freeze({
    async issue(rawIdentity: unknown, rawRequest: unknown, signal?: AbortSignal): Promise<UnverifiedCommittedReviewQaPreviewTransportGrant> {
      let request: ReturnType<typeof parseCommittedReviewQaPreviewTransportRequest>; let requestIdentity: string;
      try { request = parseCommittedReviewQaPreviewTransportRequest(rawRequest); requestIdentity = identity(rawIdentity); } catch { throw new CommittedReviewQaPreviewTransportError("DENIED"); }
      cancelled(signal); const initialActor = await authenticate(dependencies.authenticate, requestIdentity); cancelled(signal);
      if (initialActor.tenantId !== request.selection.tenantId) denied();
      let eligibility: CommittedReviewQaPreviewEligibility;
      try { const capability = await dependencies.committedReview.issue(requestIdentity, request.selection, signal); eligibility = await dependencies.committedReview.use(requestIdentity, capability, signal); }
      catch (error) { if (error instanceof CommittedReviewQaPreviewTransportError) throw error; cancelled(signal); denied(); }
      cancelled(signal); const finalActor = await authenticate(dependencies.authenticate, requestIdentity); cancelled(signal);
      if (!sameActor(initialActor, finalActor) || finalActor.tenantId !== request.selection.tenantId || !sameSelection(request.selection, eligibility.asset)) denied();
      let issuedAt: string; let grantId: string;
      try { issuedAt = timestamp(await dependencies.now()); grantId = nonce(dependencies.createGrantId()); } catch { throw new CommittedReviewQaPreviewTransportError("SIGNER_UNAVAILABLE"); }
      const issuedEpoch = Date.parse(issuedAt); const expiresEpoch = Math.min(issuedEpoch + age, Date.parse(finalActor.sessionExpiresAt), Date.parse(eligibility.expiresAt));
      if (expiresEpoch <= issuedEpoch) denied();
      const payload = deepFreeze({ schemaVersion: 1 as const, type: "jessica.committed-review-qa-preview-unverified-grant" as const, algorithm: "ES256" as const, scope: "qa-preview:runtime:one-shot" as const,
        issuerAuthorityId: authorityId, keyId, grantId, requestId: request.requestId, audience, tenantId: finalActor.tenantId, actorId: finalActor.actorId, reviewerId: finalActor.reviewerId, sessionId: finalActor.sessionId,
        selection: { ...request.selection }, commitment: { ...eligibility.digests }, committedReviewValidUntil: eligibility.committedReviewValidUntil, issuedAt, notBefore: issuedAt, expiresAt: new Date(expiresEpoch).toISOString(),
        evidence: { kind: "committed-review-binding" as const, verification: "required" as const, runtimeUsable: false as const, publicLiveUsable: false as const } });
      let rawSignature: Uint8Array<ArrayBuffer>; try { rawSignature = await dependencies.signer.sign(payloadBytes(payload)); } catch { throw new CommittedReviewQaPreviewTransportError("SIGNER_UNAVAILABLE"); }
      cancelled(signal);
      try { return parseUnverifiedCommittedReviewQaPreviewTransportGrant({ ...payload, signatureBase64: toBase64(rawSignature) }); } catch { throw new CommittedReviewQaPreviewTransportError("SIGNER_UNAVAILABLE"); }
    },
  });
}

export function createCommittedReviewQaPreviewTransportVerifier<Result>(dependencies: VerifierDependencies<Result>): CommittedReviewQaPreviewTransportVerifier<Result> {
  const audience = canonicalAudience(dependencies.audience); const age = maximumAge(dependencies.maximumGrantAgeMs);
  const trusted = new Map<string, Readonly<{ authorityId: string; keyId: string; tenantId: string; publicJwk: JsonWebKey }>>();
  const trustedCoordinates = new Set<string>();
  for (const candidate of dependencies.trustedKeys) {
    const row = exact(candidate, ["authorityId", "keyId", "tenantId", "publicJwk"]); const keyId = id(row.keyId);
    if (trusted.has(keyId)) throw new TypeError("duplicate QA-preview transport keyId");
    const publicJwk = validatePublicJwk(row.publicJwk); const coordinates = `${publicJwk.x}.${publicJwk.y}`;
    if (trustedCoordinates.has(coordinates)) throw new TypeError("duplicate QA-preview transport public key alias");
    trustedCoordinates.add(coordinates);
    trusted.set(keyId, deepFreeze({ authorityId: id(row.authorityId), keyId, tenantId: id(row.tenantId), publicJwk }));
  }
  if (trusted.size < 1 || trusted.size > 16) throw new TypeError("invalid QA-preview transport trust set");
  return Object.freeze({
    async consume(rawIdentity: unknown, rawGrant: unknown, signal?: AbortSignal): Promise<Result> {
      let grant: UnverifiedCommittedReviewQaPreviewTransportGrant; let requestIdentity: string;
      try { grant = parseUnverifiedCommittedReviewQaPreviewTransportGrant(rawGrant); requestIdentity = identity(rawIdentity); } catch { throw new CommittedReviewQaPreviewTransportError("DENIED"); }
      cancelled(signal); const authenticated = await authenticate(dependencies.authenticate, requestIdentity); cancelled(signal);
      const key = trusted.get(grant.keyId);
      if (!key || grant.audience !== audience || grant.issuerAuthorityId !== key.authorityId || grant.tenantId !== key.tenantId || authenticated.tenantId !== grant.tenantId || authenticated.actorId !== grant.actorId || authenticated.reviewerId !== grant.reviewerId || authenticated.sessionId !== grant.sessionId) denied();
      let verificationKey: CryptoKey; let verified: boolean;
      try {
        verificationKey = await crypto.subtle.importKey("jwk", key.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verificationKey, fromBase64(grant.signatureBase64), payloadBytes(unverifiedCommittedReviewQaPreviewTransportGrantPayload(grant)));
      } catch { denied(); }
      if (!verified) denied(); cancelled(signal);
      let observedAt: string; try { observedAt = timestamp(await dependencies.now()); } catch { denied(); }
      const now = Date.parse(observedAt); const issued = Date.parse(grant.issuedAt); const expires = Date.parse(grant.expiresAt);
      if (now < issued || now >= expires || now >= Date.parse(authenticated.sessionExpiresAt) || expires - issued > age) denied();
      let claimed: boolean; try { claimed = await dependencies.replayStore.claim(grant.grantId, grant.expiresAt, observedAt); } catch { denied(); }
      if (!claimed) throw new CommittedReviewQaPreviewTransportError("REPLAYED");
      // After a confirmed true claim, the grant is burned before the
      // authoritative recheck, cancellation observation, or runtime await.
      // A rejected claim is outcome-unknown and is only current-attempt closed.
      cancelled(signal);
      let eligibility: CommittedReviewQaPreviewEligibility;
      try {
        const capability = await dependencies.committedReview.issue(requestIdentity, grant.selection, signal);
        eligibility = await dependencies.committedReview.use(requestIdentity, capability, signal);
      } catch { cancelled(signal); denied(); }
      cancelled(signal);
      const finalActor = await authenticate(dependencies.authenticate, requestIdentity); cancelled(signal);
      let finalObservedAt: string; try { finalObservedAt = timestamp(await dependencies.now()); } catch { denied(); }
      const finalNow = Date.parse(finalObservedAt);
      if (!sameActor(authenticated, finalActor) || !sameSelection(grant.selection, eligibility.asset) || !sameCommitment(grant.commitment, eligibility.digests)
        || eligibility.committedReviewValidUntil !== grant.committedReviewValidUntil || Date.parse(eligibility.expiresAt) <= finalNow || expires > Date.parse(eligibility.expiresAt)
        || finalNow < issued || finalNow >= expires || finalNow >= Date.parse(finalActor.sessionExpiresAt)) denied();
      try { return await dependencies.runtime.execute(runtimeCommand(grant), signal); }
      catch (error) { if (error instanceof CommittedReviewQaPreviewTransportError && error.code === "CANCELLED") throw error; throw new CommittedReviewQaPreviewTransportError("RUNTIME_UNAVAILABLE"); }
    },
  });
}
