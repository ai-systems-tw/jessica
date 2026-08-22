/**
 * Server-only JSC-0219 boundary. The browser application graph must not import
 * this module: authentication and the database port are trusted-server TCB.
 * A generically copied, unreferenced static artifact grants no authority.
 */

export type CommittedReviewQaPreviewErrorCode = "UNAUTHENTICATED" | "DENIED" | "CANCELLED" | "DATABASE_UNAVAILABLE";

/** Public errors intentionally carry no database or authorization diagnostics. */
export class CommittedReviewQaPreviewError {
  readonly code: CommittedReviewQaPreviewErrorCode;
  constructor(code: CommittedReviewQaPreviewErrorCode) { this.code = code; Object.freeze(this); }
}

export type CommittedReviewQaPreviewSelection = Readonly<{
  tenantId: string;
  assetVersionId: string;
  assetVersion: number;
}>;

export type CommittedReviewQaPreviewDatabaseSnapshot = Readonly<{
  schemaVersion: 1;
  asset: Readonly<{
    tenantId: string; id: string; version: number; frameModelId: string; frameVariantId: string;
    generationJobId: string; status: "approved"; fixtureStatus: "unverified";
    admission: "internal-review-only"; rightsScope: "internal-review-only";
    recommendedForLive: false; publicationEligible: false; rowSha256: string;
    quality: "standard" | "premium"; generationMethod: "standard-auto" | "manual" | "external";
    reviewStatus: "approved"; nonProxyInternalReview: true; promotable: false; sourceSetSha256: string;
    attachmentMatrixSha256: string; qualityEnvelopeSha256: string;
    manifestUrl: string; manifestSha256: string; manifestByteLength: number;
    modelUrl: string; modelSha256: string; modelByteLength: number;
  }>;
  binding: Readonly<{
    assetVersionId: string; reviewRecordId: string; tenantId: string; frameModelId: string;
    frameVariantId: string; generationJobId: string; sourceSetSha256: string;
    effectiveValidUntil: string; rightsScope: "internal-review-only";
    recommendedForLive: false; publicationEligible: false;
    rowSha256: string; assetVersionRowSha256: string; decisionPayloadSha256: string; qualityEnvelopeSha256: string;
  }>;
  review: Readonly<{
    id: string; tenantId: string; decision: "approve"; terminal: true; reviewerAuthorityRowId: string;
    reviewerAuthorityId: string; reviewerId: string; reviewerKeyId: string; reviewerPublicKeyFingerprintSha256: string; generationJobId: string; frameModelId: string;
    frameVariantId: string; reviewHeadEventSha256: string; sourceSetSha256: string;
    candidateAssetVersionId: string; candidateVersion: number; outputManifestSha256: string; outputManifestByteLength: number; outputModelSha256: string; outputModelByteLength: number;
    sourceAssetSha256s: readonly string[]; measurementSetId: string; measurementSetSha256: string;
    specimenId: string; effectiveValidUntil: string; rightsScope: "internal-review-only";
    rowSha256: string;
    decisionPayloadSha256: string; approvedAssetVersionRowSha256: string; approvedQualityEnvelopeSha256: string;
  }>;
  reviewerAuthority: Readonly<{
    id: string; tenantId: string; authorityId: string; reviewerId: string; status: "active";
    scope: "non-proxy-human-qa-decision"; revokedAt: null;
    rowSha256: string;
    keyId: string; publicKeyFingerprintSha256: string;
  }>;
  generationJob: Readonly<{
    id: string; tenantId: string; frameModelId: string; currentHeadEventSha256: string;
    currentHeadEventType: "output-recorded";
    currentOutputAssetVersionId: string; currentOutputAssetVersion: number;
    currentOutputManifestSha256: string; currentOutputModelSha256: string;
    currentOutputManifestByteLength: number; currentOutputModelByteLength: number;
    sourceSetSha256: string; sourceAssetSha256s: readonly string[]; measurementSetSha256: string;
  }>;
  measurementSet: Readonly<{
    id: string; tenantId: string; frameModelId: string; specimenId: string; sha256: string; status: "verified";
  }>;
  variant: Readonly<{ id: string; tenantId: string; frameModelId: string }>;
  assetSourceSha256s: readonly string[];
}>;

export interface CommittedReviewQaPreviewTransaction {
  transactionTimestamp(): Promise<string>;
  readAuthoritativeSnapshot(selection: CommittedReviewQaPreviewSelection): Promise<unknown>;
  /**
   * Last awaited database operation. The adapter rereads the complete
   * authoritative state under the held locks and only then obtains
   * clock_timestamp(); neither value may come from a locator/cache.
   */
  finalRecheck(selection: CommittedReviewQaPreviewSelection): Promise<unknown>;
}

export interface CommittedReviewQaPreviewDatabase {
  /**
   * The adapter must hold the canonical authority -> candidate asset ->
   * GenerationJob transaction-advisory locks on one pinned read-only
   * transaction while the callback runs. No locator read is authoritative.
   * Matrix/envelope digests are the persisted JSC-0218 canonical row fields;
   * they are never derived from caller JSON or a new ad-hoc encoding here.
   */
  readonly<T>(selection: CommittedReviewQaPreviewSelection, work: (transaction: CommittedReviewQaPreviewTransaction) => Promise<T>): Promise<T>;
}

export type CommittedReviewQaPreviewCapability = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-capability";
  expiresAt: string;
  authority: Readonly<{ qaPreviewEligibility: true; qaPreviewRuntime: false; runtime: false; publicLive: false; recommendedForLive: false; catalogPublic: false; deployment: false; publication: false; commerce: false; G1: false; G2: false; G3: false; G4: false; G5: false; G6: false; G7: false }>;
}>;

export type CommittedReviewQaPreviewEligibility = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-eligibility";
  expiresAt: string;
  asset: Readonly<{ tenantId: string; assetVersionId: string; assetVersion: number; frameModelId: string; frameVariantId: string }>;
  digests: Readonly<{ assetRowSha256: string; bindingRowSha256: string; reviewRowSha256: string; authorityRowSha256: string }>;
  /** Serialized eligibility is diagnostic only and is never runtime authority. */
  authority: Readonly<{ qaPreviewEligibility: true; qaPreviewRuntime: false; runtime: false; publicLive: false; recommendedForLive: false; catalogPublic: false; deployment: false; publication: false; commerce: false; G1: false; G2: false; G3: false; G4: false; G5: false; G6: false; G7: false }>;
}>;

export type CommittedReviewQaPreviewService = Readonly<{
  issue(actorRequestIdentity: unknown, selection: unknown, signal?: AbortSignal): Promise<CommittedReviewQaPreviewCapability>;
  use(actorRequestIdentity: unknown, capability: unknown, signal?: AbortSignal): Promise<CommittedReviewQaPreviewEligibility>;
}>;

type Actor = Readonly<{ tenantId: string; actorId: string; reviewerId: string; sessionId: string; sessionExpiresAt: string; scopes: readonly ["qa-preview:read"] }>;
type Dependencies = Readonly<{
  authenticate(actorRequestIdentity: unknown): Promise<unknown>;
  database: CommittedReviewQaPreviewDatabase;
  maximumCapabilityAgeMs?: number;
}>;
type Binding = Readonly<{
  tenantId: string; assetVersionId: string; assetVersion: number; frameModelId: string; frameVariantId: string;
  manifestUrl: string; manifestSha256: string; manifestByteLength: number;
  modelUrl: string; modelSha256: string; modelByteLength: number;
  assetRowSha256: string; bindingRowSha256: string; reviewRowSha256: string; authorityRowSha256: string;
  sourceAssetSha256s: readonly string[];
}>;
type CapabilityRecord = Readonly<{ actor: Actor; selection: CommittedReviewQaPreviewSelection; binding: Binding; expiresAt: string }>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function fail(): never { throw new CommittedReviewQaPreviewError("DENIED"); }
function cancelled(signal?: AbortSignal): void {
  if (signal === undefined) return;
  if (!abortSignalAborted || typeof signal !== "object" || signal === null) throw new CommittedReviewQaPreviewError("CANCELLED");
  let value: unknown; try { value = Reflect.apply(abortSignalAborted, signal, []); } catch { throw new CommittedReviewQaPreviewError("CANCELLED"); }
  if (value !== false) throw new CommittedReviewQaPreviewError("CANCELLED");
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
  for (const [key, descriptor] of Object.entries(descriptors)) if (!keys.includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set) fail();
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== "string") fail(); return value; }
function id(value: unknown): string { const result = string(value); if (!ID.test(result)) fail(); return result; }
function hash(value: unknown): string { const result = string(value); if (!HASH.test(result)) fail(); return result; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(); return value; }
function timestamp(value: unknown): string { const result = string(value); const epoch = Date.parse(result); if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== result) fail(); return result; }
function canonicalHttpsUrl(value: unknown): string { const result = string(value); let parsed: URL; try { parsed = new URL(result); } catch { fail(); } if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.href !== result || parsed.hash !== "") fail(); return result; }
function literal<T extends string | number | boolean | null>(value: unknown, expected: T): T { if (value !== expected) fail(); return expected; }
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T { const result = string(value); if (!allowed.includes(result as T)) fail(); return result as T; }
function hashArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > 64 || Reflect.ownKeys(value).length !== value.length + 1) fail();
  const result = value.map((item, index) => { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail(); return hash(descriptor.value); });
  if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1]! >= item)) fail();
  return Object.freeze(result);
}
function equalArray(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }

function selection(value: unknown): CommittedReviewQaPreviewSelection {
  const row = exact(value, ["tenantId", "assetVersionId", "assetVersion"]);
  return frozen({ tenantId: id(row.tenantId), assetVersionId: id(row.assetVersionId), assetVersion: integer(row.assetVersion) });
}
function actor(value: unknown): Actor {
  const row = exact(value, ["tenantId", "actorId", "reviewerId", "sessionId", "sessionExpiresAt", "scopes"]);
  if (!Array.isArray(row.scopes) || Object.getPrototypeOf(row.scopes) !== Array.prototype || Reflect.ownKeys(row.scopes).length !== 2 || row.scopes.length !== 1 || row.scopes[0] !== "qa-preview:read") fail();
  const descriptor = Object.getOwnPropertyDescriptor(row.scopes, "0"); if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail();
  return frozen({ tenantId: id(row.tenantId), actorId: id(row.actorId), reviewerId: id(row.reviewerId), sessionId: id(row.sessionId), sessionExpiresAt: timestamp(row.sessionExpiresAt), scopes: ["qa-preview:read"] as const });
}
function snapshot(value: unknown): CommittedReviewQaPreviewDatabaseSnapshot {
  const root = exact(value, ["schemaVersion", "asset", "binding", "review", "reviewerAuthority", "generationJob", "measurementSet", "variant", "assetSourceSha256s"]); literal(root.schemaVersion, 1);
  const a = exact(root.asset, ["tenantId", "id", "version", "frameModelId", "frameVariantId", "generationJobId", "status", "fixtureStatus", "admission", "rightsScope", "recommendedForLive", "publicationEligible", "rowSha256", "quality", "generationMethod", "reviewStatus", "nonProxyInternalReview", "promotable", "sourceSetSha256", "attachmentMatrixSha256", "qualityEnvelopeSha256", "manifestUrl", "manifestSha256", "manifestByteLength", "modelUrl", "modelSha256", "modelByteLength"]);
  const b = exact(root.binding, ["assetVersionId", "reviewRecordId", "tenantId", "frameModelId", "frameVariantId", "generationJobId", "sourceSetSha256", "effectiveValidUntil", "rightsScope", "recommendedForLive", "publicationEligible", "rowSha256", "assetVersionRowSha256", "decisionPayloadSha256", "qualityEnvelopeSha256"]);
  const r = exact(root.review, ["id", "tenantId", "decision", "terminal", "reviewerAuthorityRowId", "reviewerAuthorityId", "reviewerId", "reviewerKeyId", "reviewerPublicKeyFingerprintSha256", "generationJobId", "frameModelId", "frameVariantId", "reviewHeadEventSha256", "sourceSetSha256", "candidateAssetVersionId", "candidateVersion", "outputManifestSha256", "outputManifestByteLength", "outputModelSha256", "outputModelByteLength", "sourceAssetSha256s", "measurementSetId", "measurementSetSha256", "specimenId", "effectiveValidUntil", "rightsScope", "rowSha256", "decisionPayloadSha256", "approvedAssetVersionRowSha256", "approvedQualityEnvelopeSha256"]);
  const ra = exact(root.reviewerAuthority, ["id", "tenantId", "authorityId", "reviewerId", "status", "scope", "revokedAt", "rowSha256", "keyId", "publicKeyFingerprintSha256"]);
  const g = exact(root.generationJob, ["id", "tenantId", "frameModelId", "currentHeadEventSha256", "currentHeadEventType", "currentOutputAssetVersionId", "currentOutputAssetVersion", "currentOutputManifestSha256", "currentOutputModelSha256", "currentOutputManifestByteLength", "currentOutputModelByteLength", "sourceSetSha256", "sourceAssetSha256s", "measurementSetSha256"]);
  const m = exact(root.measurementSet, ["id", "tenantId", "frameModelId", "specimenId", "sha256", "status"]);
  const v = exact(root.variant, ["id", "tenantId", "frameModelId"]);
  return frozen({ schemaVersion: 1,
    asset: { tenantId: id(a.tenantId), id: id(a.id), version: integer(a.version), frameModelId: id(a.frameModelId), frameVariantId: id(a.frameVariantId), generationJobId: id(a.generationJobId), status: literal(a.status, "approved"), fixtureStatus: literal(a.fixtureStatus, "unverified"), admission: literal(a.admission, "internal-review-only"), rightsScope: literal(a.rightsScope, "internal-review-only"), recommendedForLive: literal(a.recommendedForLive, false), publicationEligible: literal(a.publicationEligible, false), rowSha256: hash(a.rowSha256), quality: oneOf(a.quality, ["standard", "premium"]), generationMethod: oneOf(a.generationMethod, ["standard-auto", "manual", "external"]), reviewStatus: literal(a.reviewStatus, "approved"), nonProxyInternalReview: literal(a.nonProxyInternalReview, true), promotable: literal(a.promotable, false), sourceSetSha256: hash(a.sourceSetSha256), attachmentMatrixSha256: hash(a.attachmentMatrixSha256), qualityEnvelopeSha256: hash(a.qualityEnvelopeSha256), manifestUrl: canonicalHttpsUrl(a.manifestUrl), manifestSha256: hash(a.manifestSha256), manifestByteLength: integer(a.manifestByteLength), modelUrl: canonicalHttpsUrl(a.modelUrl), modelSha256: hash(a.modelSha256), modelByteLength: integer(a.modelByteLength) },
    binding: { assetVersionId: id(b.assetVersionId), reviewRecordId: id(b.reviewRecordId), tenantId: id(b.tenantId), frameModelId: id(b.frameModelId), frameVariantId: id(b.frameVariantId), generationJobId: id(b.generationJobId), sourceSetSha256: hash(b.sourceSetSha256), effectiveValidUntil: timestamp(b.effectiveValidUntil), rightsScope: literal(b.rightsScope, "internal-review-only"), recommendedForLive: literal(b.recommendedForLive, false), publicationEligible: literal(b.publicationEligible, false), rowSha256: hash(b.rowSha256), assetVersionRowSha256: hash(b.assetVersionRowSha256), decisionPayloadSha256: hash(b.decisionPayloadSha256), qualityEnvelopeSha256: hash(b.qualityEnvelopeSha256) },
    review: { id: id(r.id), tenantId: id(r.tenantId), decision: literal(r.decision, "approve"), terminal: literal(r.terminal, true), reviewerAuthorityRowId: id(r.reviewerAuthorityRowId), reviewerAuthorityId: id(r.reviewerAuthorityId), reviewerId: id(r.reviewerId), reviewerKeyId: id(r.reviewerKeyId), reviewerPublicKeyFingerprintSha256: hash(r.reviewerPublicKeyFingerprintSha256), generationJobId: id(r.generationJobId), frameModelId: id(r.frameModelId), frameVariantId: id(r.frameVariantId), reviewHeadEventSha256: hash(r.reviewHeadEventSha256), sourceSetSha256: hash(r.sourceSetSha256), candidateAssetVersionId: id(r.candidateAssetVersionId), candidateVersion: integer(r.candidateVersion), outputManifestSha256: hash(r.outputManifestSha256), outputManifestByteLength: integer(r.outputManifestByteLength), outputModelSha256: hash(r.outputModelSha256), outputModelByteLength: integer(r.outputModelByteLength), sourceAssetSha256s: hashArray(r.sourceAssetSha256s), measurementSetId: id(r.measurementSetId), measurementSetSha256: hash(r.measurementSetSha256), specimenId: id(r.specimenId), effectiveValidUntil: timestamp(r.effectiveValidUntil), rightsScope: literal(r.rightsScope, "internal-review-only"), rowSha256: hash(r.rowSha256), decisionPayloadSha256: hash(r.decisionPayloadSha256), approvedAssetVersionRowSha256: hash(r.approvedAssetVersionRowSha256), approvedQualityEnvelopeSha256: hash(r.approvedQualityEnvelopeSha256) },
    reviewerAuthority: { id: id(ra.id), tenantId: id(ra.tenantId), authorityId: id(ra.authorityId), reviewerId: id(ra.reviewerId), status: literal(ra.status, "active"), scope: literal(ra.scope, "non-proxy-human-qa-decision"), revokedAt: literal(ra.revokedAt, null), rowSha256: hash(ra.rowSha256), keyId: id(ra.keyId), publicKeyFingerprintSha256: hash(ra.publicKeyFingerprintSha256) },
    generationJob: { id: id(g.id), tenantId: id(g.tenantId), frameModelId: id(g.frameModelId), currentHeadEventSha256: hash(g.currentHeadEventSha256), currentHeadEventType: literal(g.currentHeadEventType, "output-recorded"), currentOutputAssetVersionId: id(g.currentOutputAssetVersionId), currentOutputAssetVersion: integer(g.currentOutputAssetVersion), currentOutputManifestSha256: hash(g.currentOutputManifestSha256), currentOutputModelSha256: hash(g.currentOutputModelSha256), currentOutputManifestByteLength: integer(g.currentOutputManifestByteLength), currentOutputModelByteLength: integer(g.currentOutputModelByteLength), sourceSetSha256: hash(g.sourceSetSha256), sourceAssetSha256s: hashArray(g.sourceAssetSha256s), measurementSetSha256: hash(g.measurementSetSha256) },
    measurementSet: { id: id(m.id), tenantId: id(m.tenantId), frameModelId: id(m.frameModelId), specimenId: id(m.specimenId), sha256: hash(m.sha256), status: literal(m.status, "verified") },
    variant: { id: id(v.id), tenantId: id(v.tenantId), frameModelId: id(v.frameModelId) }, assetSourceSha256s: hashArray(root.assetSourceSha256s),
  });
}

function validate(snapshot: CommittedReviewQaPreviewDatabaseSnapshot, wanted: CommittedReviewQaPreviewSelection, authenticated: Actor, observedAt: string): Binding {
  const { asset: a, binding: b, review: r, reviewerAuthority: ra, generationJob: g, measurementSet: m, variant: v } = snapshot;
  if (authenticated.tenantId !== wanted.tenantId || authenticated.reviewerId !== ra.reviewerId
    || a.tenantId !== wanted.tenantId || a.id !== wanted.assetVersionId || a.version !== wanted.assetVersion
    || b.assetVersionId !== a.id || b.reviewRecordId !== r.id || b.tenantId !== a.tenantId || b.frameModelId !== a.frameModelId || b.frameVariantId !== a.frameVariantId || b.generationJobId !== a.generationJobId
    || r.tenantId !== a.tenantId || r.frameModelId !== a.frameModelId || r.frameVariantId !== a.frameVariantId || r.generationJobId !== a.generationJobId
    || ra.id !== r.reviewerAuthorityRowId || ra.authorityId !== r.reviewerAuthorityId || ra.reviewerId !== r.reviewerId || ra.keyId !== r.reviewerKeyId || ra.publicKeyFingerprintSha256 !== r.reviewerPublicKeyFingerprintSha256 || ra.tenantId !== a.tenantId
    || r.candidateAssetVersionId !== a.id || r.candidateVersion !== a.version || r.outputManifestSha256 !== a.manifestSha256 || r.outputManifestByteLength !== a.manifestByteLength || r.outputModelSha256 !== a.modelSha256 || r.outputModelByteLength !== a.modelByteLength
    || g.id !== a.generationJobId || g.tenantId !== a.tenantId || g.frameModelId !== a.frameModelId || g.currentOutputAssetVersionId !== a.id || g.currentOutputAssetVersion !== a.version
    || g.currentOutputManifestSha256 !== a.manifestSha256 || g.currentOutputModelSha256 !== a.modelSha256 || g.currentOutputManifestByteLength !== a.manifestByteLength || g.currentOutputModelByteLength !== a.modelByteLength || g.currentHeadEventSha256 !== r.reviewHeadEventSha256
    || v.id !== a.frameVariantId || v.tenantId !== a.tenantId || v.frameModelId !== a.frameModelId
    || m.id !== r.measurementSetId || m.sha256 !== r.measurementSetSha256 || m.sha256 !== g.measurementSetSha256 || m.tenantId !== a.tenantId || m.frameModelId !== a.frameModelId || m.specimenId !== r.specimenId
    || b.sourceSetSha256 !== a.sourceSetSha256 || b.sourceSetSha256 !== r.sourceSetSha256 || b.sourceSetSha256 !== g.sourceSetSha256 || b.assetVersionRowSha256 !== a.rowSha256 || r.approvedAssetVersionRowSha256 !== a.rowSha256 || b.decisionPayloadSha256 !== r.decisionPayloadSha256 || b.qualityEnvelopeSha256 !== a.qualityEnvelopeSha256 || r.approvedQualityEnvelopeSha256 !== a.qualityEnvelopeSha256
    || !equalArray(snapshot.assetSourceSha256s, r.sourceAssetSha256s) || !equalArray(snapshot.assetSourceSha256s, g.sourceAssetSha256s)
    || b.effectiveValidUntil !== r.effectiveValidUntil || Date.parse(observedAt) >= Date.parse(r.effectiveValidUntil)) fail();
  return frozen({ tenantId: a.tenantId, assetVersionId: a.id, assetVersion: a.version, frameModelId: a.frameModelId, frameVariantId: a.frameVariantId, manifestUrl: a.manifestUrl, manifestSha256: a.manifestSha256, manifestByteLength: a.manifestByteLength, modelUrl: a.modelUrl, modelSha256: a.modelSha256, modelByteLength: a.modelByteLength, assetRowSha256: a.rowSha256, bindingRowSha256: b.rowSha256, reviewRowSha256: r.rowSha256, authorityRowSha256: ra.rowSha256, sourceAssetSha256s: [...snapshot.assetSourceSha256s] });
}

async function authoritative(database: CommittedReviewQaPreviewDatabase, wanted: CommittedReviewQaPreviewSelection, authenticated: Actor, signal?: AbortSignal): Promise<Readonly<{ binding: Binding; observedAt: string; validUntil: string }>> {
  try {
    return await database.readonly(wanted, async (transaction) => {
      cancelled(signal); const observedAt = timestamp(await transaction.transactionTimestamp()); cancelled(signal);
      const authoritativeSnapshot = snapshot(await transaction.readAuthoritativeSnapshot(wanted)); cancelled(signal);
      validate(authoritativeSnapshot, wanted, authenticated, observedAt); cancelled(signal);
      const finalRaw = exact(await transaction.finalRecheck(wanted), ["snapshot", "clockTimestamp"]);
      const finalObservedAt = timestamp(finalRaw.clockTimestamp); const finalSnapshot = snapshot(finalRaw.snapshot);
      const binding = validate(finalSnapshot, wanted, authenticated, finalObservedAt); cancelled(signal);
      return frozen({ binding, observedAt: finalObservedAt, validUntil: finalSnapshot.review.effectiveValidUntil });
    });
  } catch (error) {
    if (error instanceof CommittedReviewQaPreviewError) throw error;
    throw new CommittedReviewQaPreviewError("DATABASE_UNAVAILABLE");
  }
}

function identity(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail();
  return value;
}

export function createCommittedReviewQaPreviewService(dependencies: Dependencies): CommittedReviewQaPreviewService {
  const maximumAge = dependencies.maximumCapabilityAgeMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(maximumAge) || maximumAge < 1 || maximumAge > 15 * 60_000) throw new TypeError("invalid QA-preview capability age");
  // Registry is service-instance local: one trust/database context can never
  // consume a capability issued by another service instance.
  const capabilities = new WeakMap<object, CapabilityRecord>();
  async function authenticate(rawIdentity: unknown): Promise<Actor> {
    const requestIdentity = identity(rawIdentity);
    let result: unknown; try { result = await dependencies.authenticate(requestIdentity); } catch { throw new CommittedReviewQaPreviewError("UNAUTHENTICATED"); }
    try { return actor(result); } catch { throw new CommittedReviewQaPreviewError("UNAUTHENTICATED"); }
  }
  return frozen({
    issue(rawIdentity: unknown, rawSelection: unknown, signal?: AbortSignal): Promise<CommittedReviewQaPreviewCapability> {
      let requestIdentity: string; let wanted: CommittedReviewQaPreviewSelection;
      try { requestIdentity = identity(rawIdentity); wanted = selection(rawSelection); } catch { return Promise.reject(new CommittedReviewQaPreviewError("DENIED")); }
      return (async () => {
        cancelled(signal); const authenticated = await authenticate(requestIdentity); cancelled(signal);
        const checked = await authoritative(dependencies.database, wanted, authenticated, signal); cancelled(signal);
        const expiresEpoch = Math.min(Date.parse(checked.validUntil), Date.parse(authenticated.sessionExpiresAt), Date.parse(checked.observedAt) + maximumAge);
        if (expiresEpoch <= Date.parse(checked.observedAt)) fail();
        const expiresAt = new Date(expiresEpoch).toISOString();
        const capability = frozen({ schemaVersion: 1 as const, type: "jessica.committed-review-qa-preview-capability" as const, expiresAt, authority: { qaPreviewEligibility: true as const, qaPreviewRuntime: false as const, runtime: false as const, publicLive: false as const, recommendedForLive: false as const, catalogPublic: false as const, deployment: false as const, publication: false as const, commerce: false as const, G1: false as const, G2: false as const, G3: false as const, G4: false as const, G5: false as const, G6: false as const, G7: false as const } });
        capabilities.set(capability, frozen({ actor: authenticated, selection: wanted, binding: checked.binding, expiresAt }));
        return capability;
      })();
    },
    use(rawIdentity: unknown, capability: unknown, signal?: AbortSignal): Promise<CommittedReviewQaPreviewEligibility> {
      let requestIdentity: string; try { requestIdentity = identity(rawIdentity); } catch { return Promise.reject(new CommittedReviewQaPreviewError("UNAUTHENTICATED")); }
      return (async () => {
        cancelled(signal);
        if (typeof capability !== "object" || capability === null) fail();
        const record = capabilities.get(capability); if (!record) fail();
        // A capability use is single-shot. Burn it synchronously before the
        // first await so concurrent/rejected attempts cannot race or retry it.
        capabilities.delete(capability);
        const authenticated = await authenticate(requestIdentity); cancelled(signal);
        if (authenticated.tenantId !== record.actor.tenantId || authenticated.actorId !== record.actor.actorId || authenticated.reviewerId !== record.actor.reviewerId || authenticated.sessionId !== record.actor.sessionId) fail();
        const checked = await authoritative(dependencies.database, record.selection, authenticated, signal); cancelled(signal);
        if (JSON.stringify(checked.binding) !== JSON.stringify(record.binding) || Date.parse(checked.observedAt) >= Date.parse(record.expiresAt) || Date.parse(checked.observedAt) >= Date.parse(authenticated.sessionExpiresAt)) fail();
        const expiresAt = new Date(Math.min(Date.parse(record.expiresAt), Date.parse(checked.validUntil), Date.parse(authenticated.sessionExpiresAt))).toISOString();
        return frozen({ schemaVersion: 1 as const, type: "jessica.committed-review-qa-preview-eligibility" as const, expiresAt,
          asset: { tenantId: checked.binding.tenantId, assetVersionId: checked.binding.assetVersionId, assetVersion: checked.binding.assetVersion, frameModelId: checked.binding.frameModelId, frameVariantId: checked.binding.frameVariantId },
          digests: { assetRowSha256: checked.binding.assetRowSha256, bindingRowSha256: checked.binding.bindingRowSha256, reviewRowSha256: checked.binding.reviewRowSha256, authorityRowSha256: checked.binding.authorityRowSha256 },
          authority: { qaPreviewEligibility: true as const, qaPreviewRuntime: false as const, runtime: false as const, publicLive: false as const, recommendedForLive: false as const, catalogPublic: false as const, deployment: false as const, publication: false as const, commerce: false as const, G1: false as const, G2: false as const, G3: false as const, G4: false as const, G5: false as const, G6: false as const, G7: false as const },
        });
      })();
    },
  });
}
