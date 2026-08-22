/* Server-only reference adapter. Production connection and credential provisioning are external. */
import {
  canonicalJson,
  nonProxyHumanQaSignedPayloadFromRecord,
  sha256Hex,
  type NonProxyAssetVersionBindingRow,
  type NonProxyAssetVersionRow,
  type NonProxyAssetVersionSourceRow,
  type NonProxyApprovedQualityEnvelope,
  type NonProxyHumanQaRecordRow,
  type NonProxyQaControlPlaneSnapshot,
  type NonProxyQaPersistencePlan,
  type NonProxyQaReviewerAuthorityRow,
} from "../../contracts/src/index.js";
import { replayGenerationJobLedger } from "../../generation-jobs/src/index.js";
import {
  NonProxyQaDatabasePortError,
  NonProxyQaWriterError,
  type NonProxyQaWriterDatabase,
  type NonProxyQaWriterSelection,
  type NonProxyQaWriterTransaction,
} from "./nonProxyQaPersistenceWriter.js";

type Results = { rows: unknown[]; affectedRows?: number };
type Queryable = { query(sql: string, parameters?: unknown[]): Promise<Results> };
export type NonProxyQaPinnedSession = Queryable & {
  /**
   * Pins BEGIN/callback/COMMIT to this physical connection. A callback
   * rejection must be rolled back before rejection is returned. An unknown
   * BEGIN, COMMIT, or ROLLBACK boundary makes the lease discard-only.
   */
  transaction<T>(callback: (transaction: Queryable) => Promise<T>): Promise<T>;
};
export type NonProxyQaClosablePinnedSession = NonProxyQaPinnedSession & { /** Permanently destroys the physical connection and releases every session lock. */ close(): Promise<void> };
export type NonProxyQaPinnedSessionLease = Readonly<{
  session: NonProxyQaPinnedSession;
  /**
   * Permanently remove and physically close/destroy this connection. The
   * promise must not resolve until the close attempt finishes, and a failed
   * close must still leave the lease ineligible for pooling or reuse.
   */
  discard(): Promise<void>;
}>;
/**
 * Implementations exclusively pin each callback to one physical connection.
 * They must not make it reusable until withPinnedSession resolves successfully.
 * If provider check-in fails after the callback returned, the captured lease
 * remains quarantined and discardable. A discarded lease is never checked in,
 * even when discard/close rejects.
 */
export type NonProxyQaPinnedSessionProvider = Readonly<{ withPinnedSession<T>(callback: (lease: NonProxyQaPinnedSessionLease) => Promise<T>): Promise<T> }>;
export type NonProxyQaPgliteFaultPoint = "before-session-lock" | "after-session-lock" | "before-transaction" | "after-begin" | "after-snapshot" | "after-review" | "after-asset" | "after-source" | "after-binding" | "after-approve" | "before-readback" | "after-readback" | "before-final-recheck" | "before-commit" | "after-commit" | "before-session-unlock" | "before-recovery" | "after-recovery";
export type NonProxyQaPgliteFaultHook = (point: NonProxyQaPgliteFaultPoint) => void | Promise<void>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/; const HASH = /^[a-f0-9]{64}$/;
function fail(): never { throw new NonProxyQaDatabasePortError("database"); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length) fail(); const row = value as Record<string, unknown>; for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(row, key); if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail(); } for (const key of Object.keys(row)) if (!keys.includes(key)) fail(); return row; }
function text(value: unknown): string { if (typeof value !== "string") fail(); return value; }
function id(value: unknown): string { const result = text(value); if (!ID.test(result)) fail(); return result; }
function hash(value: unknown): string { const result = text(value); if (!HASH.test(result)) fail(); return result; }
function integer(value: unknown): number { const result = typeof value === "bigint" ? Number(value) : value; if (typeof result !== "number" || !Number.isSafeInteger(result)) fail(); return result; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") fail(); return value; }
function timestamp(value: unknown): string { const result = text(value); const parsed = Date.parse(result); if (!Number.isFinite(parsed)) fail(); return new Date(parsed).toISOString(); }

type DriverBudget = { nodes: number; textBytes: number; rows: number; arrayItems: number; active: WeakSet<object> };
const driverBudgets = new WeakMap<object, DriverBudget>();
function newDriverBudget(): DriverBudget { return { nodes: 0, textBytes: 0, rows: 0, arrayItems: 0, active: new WeakSet<object>() }; }
function budgetFor(queryable: Queryable): DriverBudget { let budget = driverBudgets.get(queryable as object); if (!budget) { budget = newDriverBudget(); driverBudgets.set(queryable as object, budget); } return budget; }
function driverClone(value: unknown, state: DriverBudget, depth = 0): unknown {
  if (depth > 96 || ++state.nodes > 50_000) fail();
  if (value instanceof Date) { if (Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) fail(); try { return Date.prototype.toISOString.call(value); } catch { fail(); } }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1_024 || Reflect.ownKeys(value).length !== value.length + 1 || state.active.has(value)) fail();
    state.arrayItems += value.length; if (state.arrayItems > 8_192) fail(); state.active.add(value);
    const result = Array.from({ length: value.length }, (_, index) => { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail(); return driverClone(descriptor.value, state, depth + 1); });
    state.active.delete(value); return Object.freeze(result);
  }
  if (typeof value === "object" && value !== null) {
    const keys = Reflect.ownKeys(value); if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.some((key) => typeof key === "symbol") || keys.length > 512 || state.active.has(value)) fail();
    state.active.add(value); const result = {} as Record<string, unknown>;
    for (const key of keys as string[]) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail(); const keyBytes = new TextEncoder().encode(key).byteLength; state.textBytes += keyBytes; if (keyBytes > 1_024 || state.textBytes > 8 * 1024 * 1024) fail(); Object.defineProperty(result, key, { value: driverClone(descriptor.value, state, depth + 1), enumerable: true, writable: false, configurable: false }); }
    state.active.delete(value); return Object.freeze(result);
  }
  if (typeof value === "string") { const bytes = new TextEncoder().encode(value).byteLength; state.textBytes += bytes; if (bytes > 1_000_000 || state.textBytes > 8 * 1024 * 1024) fail(); return value; }
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "bigint") return value;
  fail();
}
function json<T>(value: unknown): T { if (typeof value !== "object" || value === null || !Object.isFrozen(value)) fail(); return value as T; }
function strings(value: unknown): string[] { if (!Array.isArray(value) || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) fail(); return Object.freeze(Array.from({ length: value.length }, (_, index) => { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail(); return text(descriptor.value); })) as string[]; }
async function rows(queryable: Queryable, sql: string, parameters: unknown[], keys: readonly string[]): Promise<Record<string, unknown>[]> {
  const budget = budgetFor(queryable);
  const snapshottedRows = await queryable.query(sql, parameters).then((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) fail();
    const resultKeys = Reflect.ownKeys(raw); if (resultKeys.some((key) => typeof key === "symbol") || resultKeys.length > 32) fail();
    for (const key of resultKeys as string[]) { const item = Object.getOwnPropertyDescriptor(raw, key); if (!item || item.get || item.set) fail(); }
    const descriptor = Object.getOwnPropertyDescriptor(raw, "rows"); if (!descriptor || !Array.isArray(descriptor.value) || descriptor.value.length > 1_024) fail();
    return driverClone(descriptor.value, budget);
  });
  if (!Array.isArray(snapshottedRows)) fail(); budget.rows += snapshottedRows.length; if (budget.rows > 4_096) fail();
  return Object.freeze(snapshottedRows.map((item) => exact(item, keys))) as Record<string, unknown>[];
}
async function one(queryable: Queryable, sql: string, parameters: unknown[], keys: readonly string[]): Promise<Record<string, unknown>> { const found = await rows(queryable, sql, parameters, keys); if (found.length !== 1) fail(); return found[0]!; }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function jsonText(value: unknown): string { return canonicalJson(value); }
function bytes64(value: string): Uint8Array<ArrayBuffer> { let decoded: string; try { decoded = atob(value); } catch { fail(); } if (decoded.length !== 64 || btoa(decoded) !== value) fail(); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>; }

export const NON_PROXY_QA_AUTHORITY_KEYS = ["id","row_sha256","tenant_id","authority_id","key_id","reviewer_id","scope","algorithm","public_key_fingerprint_sha256","public_jwk","status","created_at","created_at_canonical","revoked_at"] as const;
const AUTHORITY_KEYS = NON_PROXY_QA_AUTHORITY_KEYS;
export function reconstructNonProxyQaAuthorityRow(row: Record<string, unknown>): NonProxyQaReviewerAuthorityRow { const createdAt = text(row.created_at_canonical); if (timestamp(createdAt) !== timestamp(row.created_at)) fail(); return { id: id(row.id), rowSha256: hash(row.row_sha256), tenantId: id(row.tenant_id), authorityId: id(row.authority_id), keyId: id(row.key_id), reviewerId: id(row.reviewer_id), scope: text(row.scope) as "non-proxy-human-qa-decision", algorithm: text(row.algorithm) as "ES256", publicKeyFingerprintSha256: hash(row.public_key_fingerprint_sha256), publicJwk: json<JsonWebKey>(row.public_jwk), status: text(row.status) as "active", createdAt, revokedAt: row.revoked_at === null ? null : fail() }; }
const authorityProjection = reconstructNonProxyQaAuthorityRow;

export const NON_PROXY_QA_REVIEW_KEYS = ["id","row_sha256","tenant_id","frame_model_id","frame_variant_id","candidate_asset_version_id","candidate_version","generation_job_id","canonical_input_sha256","review_head_event_sha256","generator_input_sha256","manifest_sha256","manifest_byte_length","model_sha256","model_byte_length","source_asset_sha256s","source_set_sha256","measurement_set_id","measurement_set_sha256","specimen_id","composition","signed_schema_version","signed_type","signed_algorithm","signed_scope","signed_payload","decision_payload_sha256","signature_base64","reviewer_authority_row_id","reviewer_authority_id","reviewer_key_id","reviewer_id","reviewer_public_key_fingerprint_sha256","decision","issue_categories","notes","approved_quality_envelope","approved_quality","approved_generation_method","approved_model_url","approved_manifest_url","approved_attachment_matrix","approved_fixture_status","approved_review_status","approved_admission","approved_promotable","reviewed_at","reviewed_at_canonical","issued_at","issued_at_canonical","expires_at","expires_at_canonical","input_valid_until","input_valid_until_canonical","maximum_review_age_ms","review_fresh_until","review_fresh_until_canonical","review_policy_sha256","effective_valid_until","effective_valid_until_canonical","approved_asset_version_row_sha256","rights_scope","writer_committed_at","writer_committed_at_canonical","terminal"] as const;
const REVIEW_KEYS = NON_PROXY_QA_REVIEW_KEYS;
export const NON_PROXY_QA_REVIEW_SELECT = REVIEW_KEYS.map((key) => key === "source_asset_sha256s" || key === "issue_categories" ? `to_jsonb(${key}) as ${key}` : key).join(",");
const REVIEW_SELECT = NON_PROXY_QA_REVIEW_SELECT;
export function reconstructNonProxyQaReviewRow(row: Record<string, unknown>): NonProxyHumanQaRecordRow {
  const canonicalTime = (column: string): string => { const value = text(row[`${column}_canonical`]); if (timestamp(value) !== timestamp(row[column])) fail(); return value; };
  canonicalTime("writer_committed_at");
  if (integer(row.signed_schema_version) !== 1 || text(row.signed_type) !== "non-proxy-human-qa-decision-attestation" || text(row.signed_algorithm) !== "ES256" || text(row.signed_scope) !== "non-proxy-human-qa-decision") fail();
  const rightsScope = text(row.rights_scope) as "internal-review-only";
  const approved = row.decision === "approve"; const asset: NonProxyAssetVersionRow | null = approved ? { id: id(row.candidate_asset_version_id), rowSha256: hash(row.approved_asset_version_row_sha256), tenantId: id(row.tenant_id), frameModelId: id(row.frame_model_id), frameVariantId: id(row.frame_variant_id), version: integer(row.candidate_version), generationJobId: id(row.generation_job_id), quality: text(row.approved_quality) as "standard"|"premium", generationMethod: text(row.approved_generation_method) as "standard-auto"|"manual"|"external", modelUrl: text(row.approved_model_url), manifestUrl: text(row.approved_manifest_url), manifestSha256: hash(row.manifest_sha256), manifestByteLength: integer(row.manifest_byte_length), modelSha256: hash(row.model_sha256), modelByteLength: integer(row.model_byte_length), sourceSetSha256: hash(row.source_set_sha256), attachmentMatrix: json<number[]>(row.approved_attachment_matrix), qualityEnvelope: json<NonProxyApprovedQualityEnvelope>(row.approved_quality_envelope), status: "approved" as const, fixtureStatus: text(row.approved_fixture_status) as "unverified", reviewStatus: text(row.approved_review_status) as "approved", admission: text(row.approved_admission) as "internal-review-only", promotable: bool(row.approved_promotable) as false, rightsScope, recommendedForLive: false as const, publicationEligible: false as const } : null;
  const review: NonProxyHumanQaRecordRow = { id: id(row.id), rowSha256: hash(row.row_sha256), tenantId: id(row.tenant_id), frameModelId: id(row.frame_model_id), frameVariantId: id(row.frame_variant_id), candidateAssetVersionId: id(row.candidate_asset_version_id), candidateVersion: integer(row.candidate_version), generationJobId: id(row.generation_job_id), canonicalInputSha256: hash(row.canonical_input_sha256), reviewHeadEventSha256: hash(row.review_head_event_sha256), generatorInputSha256: hash(row.generator_input_sha256), output: { manifestSha256: hash(row.manifest_sha256), modelSha256: hash(row.model_sha256), manifestByteLength: integer(row.manifest_byte_length), modelByteLength: integer(row.model_byte_length) }, sourceAssetSha256s: strings(row.source_asset_sha256s), sourceSetSha256: hash(row.source_set_sha256), measurementSetId: id(row.measurement_set_id), measurementSetSha256: hash(row.measurement_set_sha256), specimenId: id(row.specimen_id), composition: json<NonProxyHumanQaRecordRow["composition"]>(row.composition), decisionPayloadSha256: hash(row.decision_payload_sha256), signatureBase64: text(row.signature_base64), reviewerAuthorityRowId: id(row.reviewer_authority_row_id), reviewerAuthorityId: id(row.reviewer_authority_id), reviewerKeyId: id(row.reviewer_key_id), reviewerId: id(row.reviewer_id), reviewerPublicKeyFingerprintSha256: hash(row.reviewer_public_key_fingerprint_sha256), decision: text(row.decision) as "approve"|"reject", issueCategories: strings(row.issue_categories) as NonProxyHumanQaRecordRow["issueCategories"], notes: row.notes === null ? null : text(row.notes), approvedQualityEnvelope: approved ? json(row.approved_quality_envelope) : null, reviewedAt: canonicalTime("reviewed_at"), issuedAt: canonicalTime("issued_at"), expiresAt: canonicalTime("expires_at"), inputValidUntil: canonicalTime("input_valid_until"), maximumReviewAgeMs: integer(row.maximum_review_age_ms), reviewFreshUntil: canonicalTime("review_fresh_until"), reviewPolicySha256: hash(row.review_policy_sha256), effectiveValidUntil: canonicalTime("effective_valid_until"), approvedAssetVersionRowSha256: approved ? hash(row.approved_asset_version_row_sha256) : null, approvedAssetProjection: asset, rightsScope, terminal: bool(row.terminal) as true };
  if (!same(json(row.signed_payload), nonProxyHumanQaSignedPayloadFromRecord(review))) fail();
  return review;
}
const reviewProjection = reconstructNonProxyQaReviewRow;

export const NON_PROXY_QA_ASSET_KEYS = ["id","persistence_row_sha256","tenant_id","frame_model_id","frame_variant_id","version","generation_job_id","quality","generation_method","model_url","manifest_url","manifest_sha256","manifest_byte_length","model_sha256","model_byte_length","source_set_sha256","attachment_matrix","quality_envelope","status","fixture_status","review_status","admission","promotable","rights_scope","recommended_for_live","publication_eligible","non_proxy_internal_review"] as const;
const ASSET_KEYS = NON_PROXY_QA_ASSET_KEYS;
export function reconstructNonProxyQaAssetRow(row: Record<string, unknown>): NonProxyAssetVersionRow { if (!bool(row.non_proxy_internal_review)) fail(); return { id: id(row.id), rowSha256: hash(row.persistence_row_sha256), tenantId: id(row.tenant_id), frameModelId: id(row.frame_model_id), frameVariantId: id(row.frame_variant_id), version: integer(row.version), generationJobId: id(row.generation_job_id), quality: text(row.quality) as "standard"|"premium", generationMethod: text(row.generation_method) as "standard-auto"|"manual"|"external", modelUrl: text(row.model_url), manifestUrl: text(row.manifest_url), manifestSha256: hash(row.manifest_sha256), manifestByteLength: integer(row.manifest_byte_length), modelSha256: hash(row.model_sha256), modelByteLength: integer(row.model_byte_length), sourceSetSha256: hash(row.source_set_sha256), attachmentMatrix: json<number[]>(row.attachment_matrix), qualityEnvelope: json<NonProxyApprovedQualityEnvelope>(row.quality_envelope), status: text(row.status) as "approved", fixtureStatus: text(row.fixture_status) as "unverified", reviewStatus: text(row.review_status) as "approved", admission: text(row.admission) as "internal-review-only", promotable: bool(row.promotable) as false, rightsScope: text(row.rights_scope) as "internal-review-only", recommendedForLive: bool(row.recommended_for_live) as false, publicationEligible: bool(row.publication_eligible) as false }; }
const assetProjection = reconstructNonProxyQaAssetRow;
export const NON_PROXY_QA_BINDING_KEYS = ["id","row_sha256","tenant_id","review_record_id","asset_version_id","frame_model_id","frame_variant_id","generation_job_id","source_set_sha256","quality_envelope","decision_payload_sha256","effective_valid_until","asset_version_row_sha256","rights_scope","recommended_for_live","publication_eligible"] as const;
const BINDING_KEYS = NON_PROXY_QA_BINDING_KEYS;
export function reconstructNonProxyQaBindingRow(row: Record<string, unknown>): NonProxyAssetVersionBindingRow { return { id: id(row.id), rowSha256: hash(row.row_sha256), tenantId: id(row.tenant_id), reviewRecordId: id(row.review_record_id), assetVersionId: id(row.asset_version_id), frameModelId: id(row.frame_model_id), frameVariantId: id(row.frame_variant_id), generationJobId: id(row.generation_job_id), sourceSetSha256: hash(row.source_set_sha256), qualityEnvelope: json<NonProxyApprovedQualityEnvelope>(row.quality_envelope), decisionPayloadSha256: hash(row.decision_payload_sha256), effectiveValidUntil: timestamp(row.effective_valid_until), assetVersionRowSha256: hash(row.asset_version_row_sha256), rightsScope: text(row.rights_scope) as "internal-review-only", recommendedForLive: bool(row.recommended_for_live) as false, publicationEligible: bool(row.publication_eligible) as false }; }
const bindingProjection = reconstructNonProxyQaBindingRow;
export const NON_PROXY_QA_SOURCE_KEYS = ["persistence_source_row_id","persistence_source_row_sha256","tenant_id","asset_version_id","frame_model_id","frame_variant_id","source_asset_id","source_sha256"] as const;
const SOURCE_KEYS = NON_PROXY_QA_SOURCE_KEYS;
export function reconstructNonProxyQaSourceRow(row: Record<string, unknown>): NonProxyAssetVersionSourceRow { return { id: id(row.persistence_source_row_id), rowSha256: hash(row.persistence_source_row_sha256), tenantId: id(row.tenant_id), assetVersionId: id(row.asset_version_id), frameModelId: id(row.frame_model_id), frameVariantId: id(row.frame_variant_id), sourceAssetId: id(row.source_asset_id), sourceSha256: hash(row.source_sha256) }; }
const sourceProjection = reconstructNonProxyQaSourceRow;

async function verifyReadback(queryable: Queryable, plan: NonProxyQaPersistencePlan): Promise<boolean> {
  const authority = authorityProjection(await one(queryable, `select ${AUTHORITY_KEYS.join(",")} from private.qa_reviewer_authorities where tenant_id=$1 and id=$2`, [plan.reviewRecord.tenantId, plan.reviewerAuthority.id], AUTHORITY_KEYS));
  const review = reviewProjection(await one(queryable, `select ${REVIEW_SELECT} from private.non_proxy_human_qa_records where tenant_id=$1 and id=$2`, [plan.reviewRecord.tenantId, plan.reviewRecord.id], REVIEW_KEYS));
  const assets = await rows(queryable, `select ${ASSET_KEYS.join(",")} from private.asset_versions where tenant_id=$1 and id=$2`, [plan.reviewRecord.tenantId, plan.reviewRecord.candidateAssetVersionId], ASSET_KEYS); const asset = assets.length === 0 ? null : assets.length === 1 ? assetProjection(assets[0]!) : fail();
  const bindings = await rows(queryable, `select ${BINDING_KEYS.join(",")} from private.non_proxy_asset_version_bindings where tenant_id=$1 and review_record_id=$2`, [plan.reviewRecord.tenantId, plan.reviewRecord.id], BINDING_KEYS); const binding = bindings.length === 0 ? null : bindings.length === 1 ? bindingProjection(bindings[0]!) : fail();
  const sources = (await rows(queryable, `select ${SOURCE_KEYS.join(",")} from private.asset_version_sources where tenant_id=$1 and asset_version_id=$2 order by source_sha256`, [plan.reviewRecord.tenantId, plan.reviewRecord.candidateAssetVersionId], SOURCE_KEYS)).map(sourceProjection);
  const payload = nonProxyHumanQaSignedPayloadFromRecord(review); const payloadBytes = new TextEncoder().encode(canonicalJson(payload)); if (await sha256Hex(payloadBytes) !== review.decisionPayloadSha256) return false; const key = await crypto.subtle.importKey("jwk", authority.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytes64(review.signatureBase64), payloadBytes)) return false;
  return same(authority, plan.reviewerAuthority) && same(review, plan.reviewRecord) && same(asset, plan.assetVersion) && same(binding, plan.binding) && same(sources, plan.sourceRows);
}

function databaseCode(error: unknown): unknown { if (typeof error !== "object" || error === null) return null; const descriptor = Object.getOwnPropertyDescriptor(error, "code"); return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : null; }
function mapError(error: unknown): never { if (error instanceof NonProxyQaDatabasePortError) throw error; const code = databaseCode(error); if (code === "40001" || code === "40P01" || code === "55P03") throw new NonProxyQaDatabasePortError("retryable"); throw new NonProxyQaDatabasePortError("database"); }

/** Reference provider for PGlite's single closeable physical connection. */
export function createSinglePglitePinnedSessionProvider(database: NonProxyQaClosablePinnedSession): NonProxyQaPinnedSessionProvider {
  if (typeof database.close !== "function") throw new TypeError("a physical close capability is required");
  let tail = Promise.resolve(); let discarded = false; let discardPromise: Promise<void> | null = null;
  return Object.freeze({
    async withPinnedSession<T>(callback: (lease: NonProxyQaPinnedSessionLease) => Promise<T>): Promise<T> {
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      const prior = tail;
      tail = prior.then(() => current);
      await prior;
      try {
        if (discarded) throw new NonProxyQaDatabasePortError("database");
        return await callback(Object.freeze({
          session: database,
          async discard() {
            discarded = true;
            discardPromise ??= Promise.resolve().then(() => database.close());
            await discardPromise;
          },
        }));
      } finally { release(); }
    },
  });
}

type LockIdentity = Readonly<{ tenantId: string; generationJobId: string; reviewerAuthorityId: string; reviewerKeyId: string; candidateAssetVersionId: string; candidateVersion: number }>;
function lockKeys(identity: LockIdentity): readonly string[] {
  const part = (value: string) => `${value.length}:${value}`;
  return Object.freeze([
    `job:${part(identity.tenantId)}${part(identity.generationJobId)}`,
    `authority:${part(identity.tenantId)}${part(identity.reviewerAuthorityId)}${part(identity.reviewerKeyId)}`,
    `candidate:${part(identity.tenantId)}${part(identity.candidateAssetVersionId)}:${identity.candidateVersion}`,
  ].sort());
}

function planLockIdentity(plan: NonProxyQaPersistencePlan): LockIdentity { return { tenantId: plan.reviewRecord.tenantId, generationJobId: plan.reviewRecord.generationJobId, reviewerAuthorityId: plan.reviewRecord.reviewerAuthorityId, reviewerKeyId: plan.reviewRecord.reviewerKeyId, candidateAssetVersionId: plan.reviewRecord.candidateAssetVersionId, candidateVersion: plan.reviewRecord.candidateVersion }; }

export function createPgliteNonProxyQaWriterDatabase(sessions: NonProxyQaPinnedSessionProvider, options: Readonly<{ fault?: NonProxyQaPgliteFaultHook; simulateLostCommitAcknowledgement?: () => boolean }> = {}): NonProxyQaWriterDatabase {
  const fault = async (point: NonProxyQaPgliteFaultPoint) => { await options.fault?.(point); };
  const transactionAdapter = (queryable: Queryable): NonProxyQaWriterTransaction => { let transactionObservedAt: string | null = null; return ({
    async transactionTimestamp() { const row = await one(queryable, "select transaction_timestamp()::text as observed_at", [], ["observed_at"]); transactionObservedAt = timestamp(row.observed_at); return transactionObservedAt; },
    async readControlPlaneSnapshot(selection, observedAt, reviewPolicy) {
      const jobKeys = ["frame_model_id","idempotency_key","canonical_input_sha256","method","generator_id","generator_version","generator_config_sha256","source_asset_sha256s","measurement_set_sha256","generator_input_sha256","max_attempts","created_at"] as const;
      const job = await one(queryable, "select frame_model_id,idempotency_key,canonical_input_sha256,method,generator_id,generator_version,generator_config_sha256,to_jsonb(source_asset_sha256s) as source_asset_sha256s,measurement_set_sha256,generator_input_sha256,max_attempts,created_at from private.generation_jobs where tenant_id=$1 and id=$2", [selection.tenantId, selection.generationJobId], jobKeys); const maxAttempts = integer(job.max_attempts); if (id(job.frame_model_id) !== selection.frameModelId || hash(job.canonical_input_sha256) !== selection.canonicalInputSha256 || maxAttempts < 1 || maxAttempts > 64) fail();
      const ledgerRows = await rows(queryable, "select sequence,event_type,occurred_at,occurred_at_canonical,previous_event_sha256,event_sha256,evidence from private.generation_job_events where tenant_id=$1 and generation_job_id=$2 order by sequence", [selection.tenantId, selection.generationJobId], ["sequence","event_type","occurred_at","occurred_at_canonical","previous_event_sha256","event_sha256","evidence"]); if (ledgerRows.length === 0 || ledgerRows.length > 4 * maxAttempts + 4) fail(); const ledger = ledgerRows.map((event) => { const occurredAt = text(event.occurred_at_canonical); if (timestamp(occurredAt) !== timestamp(event.occurred_at)) fail(); return { schemaVersion: 1, eventType: text(event.event_type), sequence: integer(event.sequence), occurredAt, previousEventSha256: event.previous_event_sha256 === null ? null : hash(event.previous_event_sha256), eventSha256: hash(event.event_sha256), jobId: selection.generationJobId, idempotencyKey: id(job.idempotency_key), canonicalInputSha256: hash(job.canonical_input_sha256), tenantId: selection.tenantId, frameModelId: selection.frameModelId, payload: json(event.evidence) }; }); const replayed = await replayGenerationJobLedger(ledger, { evaluatedAt: observedAt });
      const jobSources = strings(job.source_asset_sha256s).map(hash);
      if (replayed.status !== "review" || !replayed.output
        || replayed.headEventSha256 !== selection.reviewHeadEventSha256
        || replayed.canonicalInputSha256 !== selection.canonicalInputSha256
        || replayed.idempotencyKey !== id(job.idempotency_key)
        || replayed.request.tenantId !== selection.tenantId
        || replayed.request.frameModelId !== selection.frameModelId
        || replayed.request.method !== text(job.method)
        || replayed.request.generator.id !== id(job.generator_id)
        || replayed.request.generator.version !== id(job.generator_version)
        || replayed.request.generator.configSha256 !== hash(job.generator_config_sha256)
        || !same(replayed.request.sourceAssetSha256s, jobSources)
        || !same(replayed.request.sourceAssetSha256s, selection.sourceAssetSha256s)
        || replayed.request.measurementSetSha256 !== hash(job.measurement_set_sha256)
        || replayed.request.measurementSetSha256 !== selection.measurementSetSha256
        || replayed.request.generatorInputSha256 !== hash(job.generator_input_sha256)
        || replayed.request.maxAttempts !== maxAttempts
        || timestamp(replayed.request.createdAt) !== timestamp(job.created_at)) fail();
      const head = await one(queryable, "select event_type,event_sha256,output_manifest_sha256,output_manifest_byte_length,output_model_sha256,output_model_byte_length from private.generation_job_events where tenant_id=$1 and generation_job_id=$2 order by sequence desc limit 1", [selection.tenantId, selection.generationJobId], ["event_type","event_sha256","output_manifest_sha256","output_manifest_byte_length","output_model_sha256","output_model_byte_length"]); if (head.event_type !== "output-recorded") fail(); const trustedOutput = { manifestSha256: hash(head.output_manifest_sha256), manifestByteLength: integer(head.output_manifest_byte_length), modelSha256: hash(head.output_model_sha256), modelByteLength: integer(head.output_model_byte_length) }; if (!same(replayed.output, trustedOutput)) fail();
      const authorityRow = await one(queryable, `select ${AUTHORITY_KEYS.join(",")} from private.qa_reviewer_authorities where tenant_id=$1 and authority_id=$2 and key_id=$3`, [selection.tenantId, selection.reviewerAuthorityId, selection.reviewerKeyId], AUTHORITY_KEYS); const authority = authorityProjection(authorityRow); if (authority.status !== "active") fail();
      const measurements = await rows(queryable, "select id,evidence_sha256,status,specimen_id from private.measurement_sets where tenant_id=$1 and frame_model_id=$2 and evidence_sha256=$3 and specimen_id=$4", [selection.tenantId, selection.frameModelId, selection.measurementSetSha256, selection.specimenId], ["id","evidence_sha256","status","specimen_id"]); if (measurements.length !== 1 || measurements[0]!.status !== "verified") fail();
      const sourceRows = await rows(queryable, "select id,sha256,frame_variant_id from private.source_assets where tenant_id=$1 and frame_model_id=$2 and sha256 in (select value::private.sha256 from jsonb_array_elements_text($3::jsonb)) order by sha256", [selection.tenantId, selection.frameModelId, jsonText(selection.sourceAssetSha256s)], ["id","sha256","frame_variant_id"]); if (sourceRows.length !== selection.sourceAssetSha256s.length) fail(); const sourceMappings = sourceRows.map((row, index) => { const sourceHash = hash(row.sha256); if (sourceHash !== selection.sourceAssetSha256s[index] || (row.frame_variant_id !== null && id(row.frame_variant_id) !== selection.frameVariantId)) fail(); return { sourceAssetId: id(row.id), sourceAssetSha256: sourceHash }; }); if (new Set(sourceMappings.map((item) => item.sourceAssetId)).size !== sourceMappings.length) fail();
      const reviews = await rows(queryable, "select id,row_sha256,generation_job_id from private.non_proxy_human_qa_records where tenant_id=$1 and candidate_asset_version_id=$2 and candidate_version=$3", [selection.tenantId, selection.candidateAssetVersionId, selection.candidateVersion], ["id","row_sha256","generation_job_id"]); if (reviews.length > 1) fail(); if (reviews.length === 1 && id(reviews[0]!.generation_job_id) !== selection.generationJobId) throw new NonProxyQaWriterError("DENIED");
      const assets = await rows(queryable, "select id,persistence_row_sha256 from private.asset_versions where tenant_id=$1 and id=$2", [selection.tenantId, selection.candidateAssetVersionId], ["id","persistence_row_sha256"]); if (assets.length > 1 || (assets.length === 1 && assets[0]!.persistence_row_sha256 === null)) fail();
      const bindings = await rows(queryable, "select id,row_sha256 from private.non_proxy_asset_version_bindings where tenant_id=$1 and asset_version_id=$2", [selection.tenantId, selection.candidateAssetVersionId], ["id","row_sha256"]); if (bindings.length > 1) fail();
      const persistedSources = await rows(queryable, "select persistence_source_row_id as id,persistence_source_row_sha256 as row_sha256 from private.asset_version_sources where tenant_id=$1 and asset_version_id=$2 order by source_sha256", [selection.tenantId, selection.candidateAssetVersionId], ["id","row_sha256"]);
      await fault("after-snapshot");
      return { schemaVersion: 1, observedAt, tenantId: selection.tenantId, frameModelId: selection.frameModelId, frameVariantId: selection.frameVariantId, generationJob: { id: selection.generationJobId, canonicalInputSha256: hash(job.canonical_input_sha256), reviewHeadEventSha256: hash(head.event_sha256), generatorInputSha256: hash(job.generator_input_sha256), output: { manifestSha256: hash(head.output_manifest_sha256), manifestByteLength: integer(head.output_manifest_byte_length), modelSha256: hash(head.output_model_sha256), modelByteLength: integer(head.output_model_byte_length) } }, sourceMappings, measurementSet: { id: id(measurements[0]!.id), sha256: hash(measurements[0]!.evidence_sha256) }, candidateAssetVersion: { id: selection.candidateAssetVersionId, version: selection.candidateVersion }, existingRows: { reviewerAuthority: { id: authority.id, rowSha256: authority.rowSha256 }, reviewRecord: reviews.length ? { id: id(reviews[0]!.id), rowSha256: hash(reviews[0]!.row_sha256) } : null, assetVersion: assets.length ? { id: id(assets[0]!.id), rowSha256: hash(assets[0]!.persistence_row_sha256) } : null, binding: bindings.length ? { id: id(bindings[0]!.id), rowSha256: hash(bindings[0]!.row_sha256) } : null, sourceRows: persistedSources.map((row) => ({ id: id(row.id), rowSha256: hash(row.row_sha256) })) }, reviewerAuthority: { authorityId: authority.authorityId, keyId: authority.keyId, reviewerId: authority.reviewerId, scope: authority.scope, publicKeyFingerprintSha256: authority.publicKeyFingerprintSha256, publicJwk: authority.publicJwk, status: "active", createdAt: authority.createdAt, revokedAt: null }, reviewPolicy } as NonProxyQaControlPlaneSnapshot;
    },
    async verifyExact(plan) { await fault("before-readback"); const result = await verifyReadback(queryable, plan); await fault("after-readback"); return result; },
    async insertReviewRecord(row) {
      const signed = nonProxyHumanQaSignedPayloadFromRecord(row);
      await queryable.query(`insert into private.non_proxy_human_qa_records(
        tenant_id,id,row_sha256,frame_model_id,frame_variant_id,candidate_asset_version_id,candidate_version,generation_job_id,canonical_input_sha256,review_head_event_sha256,generator_input_sha256,
        manifest_sha256,manifest_byte_length,model_sha256,model_byte_length,source_asset_sha256s,source_set_sha256,measurement_set_id,measurement_set_sha256,specimen_id,composition,
        signed_schema_version,signed_type,signed_algorithm,signed_scope,decision_payload_sha256,signature_base64,signed_payload,reviewer_authority_row_id,reviewer_authority_id,reviewer_key_id,reviewer_id,reviewer_public_key_fingerprint_sha256,
        decision,issue_categories,notes,approved_quality_envelope,approved_quality,approved_generation_method,approved_model_url,approved_manifest_url,approved_attachment_matrix,approved_fixture_status,approved_review_status,approved_admission,approved_promotable,
        reviewed_at,issued_at,expires_at,input_valid_until,maximum_review_age_ms,review_fresh_until,review_policy_sha256,effective_valid_until,approved_asset_version_row_sha256,rights_scope,
        reviewed_at_canonical,issued_at_canonical,expires_at_canonical,input_valid_until_canonical,review_fresh_until_canonical,effective_valid_until_canonical,writer_committed_at,writer_committed_at_canonical,terminal
      ) values(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,(select array_agg(value::private.sha256 order by value) from jsonb_array_elements_text($16::jsonb)),$17,$18,$19,$20,$21::jsonb,
        1,'non-proxy-human-qa-decision-attestation','ES256','non-proxy-human-qa-decision',$22,$23,$24::jsonb,$25,$26,$27,$28,$29,
        $30,coalesce((select array_agg(value order by value) from jsonb_array_elements_text($31::jsonb)),array[]::text[]),$32,$33::jsonb,$34,$35,$36,$37,$38::jsonb,$39,$40,$41,$42,
        $43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,true
      )`, [row.tenantId,row.id,row.rowSha256,row.frameModelId,row.frameVariantId,row.candidateAssetVersionId,row.candidateVersion,row.generationJobId,row.canonicalInputSha256,row.reviewHeadEventSha256,row.generatorInputSha256,row.output.manifestSha256,row.output.manifestByteLength,row.output.modelSha256,row.output.modelByteLength,jsonText(row.sourceAssetSha256s),row.sourceSetSha256,row.measurementSetId,row.measurementSetSha256,row.specimenId,jsonText(row.composition),row.decisionPayloadSha256,row.signatureBase64,jsonText(signed),row.reviewerAuthorityRowId,row.reviewerAuthorityId,row.reviewerKeyId,row.reviewerId,row.reviewerPublicKeyFingerprintSha256,row.decision,jsonText(row.issueCategories),row.notes,row.approvedQualityEnvelope ? jsonText(row.approvedQualityEnvelope) : null,row.approvedAssetProjection?.quality ?? null,row.approvedAssetProjection?.generationMethod ?? null,row.approvedAssetProjection?.modelUrl ?? null,row.approvedAssetProjection?.manifestUrl ?? null,row.approvedAssetProjection ? jsonText(row.approvedAssetProjection.attachmentMatrix) : null,row.approvedAssetProjection?.fixtureStatus ?? null,row.approvedAssetProjection?.reviewStatus ?? null,row.approvedAssetProjection?.admission ?? null,row.approvedAssetProjection?.promotable ?? null,row.reviewedAt,row.issuedAt,row.expiresAt,row.inputValidUntil,row.maximumReviewAgeMs,row.reviewFreshUntil,row.reviewPolicySha256,row.effectiveValidUntil,row.approvedAssetVersionRowSha256,row.rightsScope,row.reviewedAt,row.issuedAt,row.expiresAt,row.inputValidUntil,row.reviewFreshUntil,row.effectiveValidUntil,transactionObservedAt ?? fail(),transactionObservedAt ?? fail()]);
      await fault("after-review");
    },
    async insertAssetVersionInReview(row) { await queryable.query("insert into private.asset_versions(tenant_id,id,frame_model_id,frame_variant_id,generation_job_id,version,quality,generation_method,model_url,manifest_url,manifest_sha256,manifest_byte_length,model_sha256,model_byte_length,source_set_sha256,attachment_matrix,quality_envelope,status,non_proxy_internal_review,rights_scope,recommended_for_live,publication_eligible,persistence_row_sha256,fixture_status,review_status,admission,promotable) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,'review',true,$18,false,false,$19,$20,$21,$22,false)", [row.tenantId,row.id,row.frameModelId,row.frameVariantId,row.generationJobId,row.version,row.quality,row.generationMethod,row.modelUrl,row.manifestUrl,row.manifestSha256,row.manifestByteLength,row.modelSha256,row.modelByteLength,row.sourceSetSha256,jsonText(row.attachmentMatrix),jsonText(row.qualityEnvelope),row.rightsScope,row.rowSha256,row.fixtureStatus,row.reviewStatus,row.admission]); await fault("after-asset"); },
    async insertAssetVersionSource(row) { await queryable.query("insert into private.asset_version_sources(tenant_id,asset_version_id,frame_model_id,frame_variant_id,source_asset_id,source_sha256,persistence_source_row_id,persistence_source_row_sha256) values($1,$2,$3,$4,$5,$6,$7,$8)", [row.tenantId,row.assetVersionId,row.frameModelId,row.frameVariantId,row.sourceAssetId,row.sourceSha256,row.id,row.rowSha256]); await fault("after-source"); },
    async insertBinding(row) { await queryable.query("insert into private.non_proxy_asset_version_bindings(tenant_id,id,row_sha256,review_record_id,decision_payload_sha256,effective_valid_until,asset_version_row_sha256,asset_version_id,frame_model_id,frame_variant_id,generation_job_id,source_set_sha256,quality_envelope,rights_scope,recommended_for_live,publication_eligible) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,false,false)", [row.tenantId,row.id,row.rowSha256,row.reviewRecordId,row.decisionPayloadSha256,row.effectiveValidUntil,row.assetVersionRowSha256,row.assetVersionId,row.frameModelId,row.frameVariantId,row.generationJobId,row.sourceSetSha256,jsonText(row.qualityEnvelope),row.rightsScope]); await fault("after-binding"); },
    async approveAssetVersion(row) { const changed = await rows(queryable, "update private.asset_versions set status='approved' where tenant_id=$1 and id=$2 and status='review' returning id", [row.tenantId,row.id], ["id"]); if (changed.length !== 1 || id(changed[0]!.id) !== row.id) fail(); await fault("after-approve"); },
    async finalRecheck(plan) { await fault("before-final-recheck"); const row = await one(queryable, "select r.writer_committed_at,r.writer_committed_at_canonical,r.effective_valid_until > clock_timestamp() as fresh, a.status='active' and a.revoked_at is null as active, h.event_type='output-recorded' and h.event_sha256=r.review_head_event_sha256 as current_head from private.non_proxy_human_qa_records r join private.qa_reviewer_authorities a on a.tenant_id=r.tenant_id and a.id=r.reviewer_authority_row_id join lateral (select event_type,event_sha256 from private.generation_job_events where tenant_id=r.tenant_id and generation_job_id=r.generation_job_id order by sequence desc limit 1) h on true where r.tenant_id=$1 and r.id=$2", [plan.reviewRecord.tenantId,plan.reviewRecord.id], ["writer_committed_at","writer_committed_at_canonical","fresh","active","current_head"]); const committedAt = text(row.writer_committed_at_canonical); if (timestamp(committedAt) !== timestamp(row.writer_committed_at) || !bool(row.fresh) || !bool(row.active) || !bool(row.current_head)) fail(); return committedAt; },
  }); };
  async function withSessionLocks<T>(identity: LockIdentity, callback: (session: NonProxyQaPinnedSession) => Promise<T>, observeLease?: (lease: NonProxyQaPinnedSessionLease) => void): Promise<T> {
    return sessions.withPinnedSession(async (lease) => {
      observeLease?.(lease);
      const session = lease.session;
      const acquired: string[] = [];
      let value: T | undefined;
      let primaryErrorPresent = false;
      let primaryError: unknown;
      let acquisitionOutcomeUnknown = false;
      driverBudgets.set(session as object, newDriverBudget());
      try {
        await session.query("set lock_timeout = '5s'");
        await session.query("set statement_timeout = '15s'");
        await fault("before-session-lock");
        for (const key of lockKeys(identity)) {
          try {
            await session.query("select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1,218))", [key]);
          } catch (error) {
            // The server may have acquired the lock even though its ACK was
            // lost. Only physical destruction can prove that unknown lock is
            // no longer held, so this lease is never eligible for reuse.
            acquisitionOutcomeUnknown = true;
            throw error;
          }
          acquired.push(key);
        }
        await fault("after-session-lock");
        value = await callback(session);
      } catch (error) { primaryErrorPresent = true; primaryError = error; }
      let cleanupErrorPresent = false;
      try { await fault("before-session-unlock"); } catch { cleanupErrorPresent = true; }
      for (const key of acquired.reverse()) {
        try {
          const unlocked = await one(session, "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,218)) as unlocked", [key], ["unlocked"]);
          if (!bool(unlocked.unlocked)) fail();
        } catch { cleanupErrorPresent = true; }
      }
      try { await session.query("reset lock_timeout"); await session.query("reset statement_timeout"); } catch { cleanupErrorPresent = true; }
      if (cleanupErrorPresent || acquisitionOutcomeUnknown) {
        try { await lease.discard(); } catch { cleanupErrorPresent = true; }
      }
      if (primaryErrorPresent) throw primaryError;
      if (cleanupErrorPresent) throw new NonProxyQaDatabasePortError("commit-outcome-unknown");
      return value as T;
    });
  }

  type TransactionBoundaryState = {
    invoked: boolean;
    callbackCompleted: boolean;
    resolved: boolean;
    preservableErrorPresent: boolean;
    preservableError: unknown;
  };
  async function withTrackedTransaction<T>(
    identity: LockIdentity,
    callback: (transaction: Queryable) => Promise<T>,
    afterTransaction?: () => Promise<void>,
    beforeTransaction?: () => Promise<void>,
  ): Promise<T> {
    const state: TransactionBoundaryState = { invoked: false, callbackCompleted: false, resolved: false, preservableErrorPresent: false, preservableError: undefined };
    let attemptLease: NonProxyQaPinnedSessionLease | null = null;
    const discard = async () => { try { await attemptLease?.discard(); } catch { /* the lease remains permanently quarantined */ } };
    try {
      return await withSessionLocks(identity, async (session) => {
        await beforeTransaction?.();
        state.invoked = true;
        let callbackEntered = false;
        let callbackErrorPresent = false;
        let callbackError: unknown;
        let result: T;
        try {
          result = await session.transaction(async (transaction) => {
            callbackEntered = true;
            try {
              const value = await callback(transaction);
              state.callbackCompleted = true;
              return value;
            } catch (error) {
              callbackErrorPresent = true;
              callbackError = error;
              throw error;
            }
          });
          state.resolved = true;
        } catch (error) {
          const confirmedCallbackRollback = callbackEntered && callbackErrorPresent && !state.callbackCompleted && error === callbackError;
          const confirmedCommitAbort = callbackEntered && state.callbackCompleted && ["40001", "40P01", "55P03"].includes(String(databaseCode(error)));
          if (confirmedCallbackRollback || confirmedCommitAbort) {
            state.preservableErrorPresent = true;
            state.preservableError = error;
            throw error;
          }
          // No callback means BEGIN may have reached the server. A completed
          // callback with a non-abort rejection makes COMMIT unknown, while a
          // distinct rejection after a callback error makes ROLLBACK unknown.
          // Every such physical connection is destroyed before propagation.
          await discard();
          throw new NonProxyQaDatabasePortError(state.callbackCompleted ? "commit-outcome-unknown" : "database");
        }
        await afterTransaction?.();
        return result;
      }, (lease) => { attemptLease = lease; });
    } catch (error) {
      // A provider/check-in or post-transaction hook rejection after the
      // transaction resolved is never allowed to repool the captured lease.
      // A provider replacing the callback's confirmed-rollback error is also
      // an unknown boundary. Only the exact callback error may preserve it.
      const exactPreservableError = state.preservableErrorPresent && error === state.preservableError;
      if (state.resolved || state.invoked && !exactPreservableError) await discard();
      if (state.resolved) throw new NonProxyQaDatabasePortError("commit-outcome-unknown");
      throw error;
    }
  }

  return {
    async serializable<T>(selection: NonProxyQaWriterSelection, work: (transaction: NonProxyQaWriterTransaction) => Promise<T>, precommitCheck: (transaction: NonProxyQaWriterTransaction) => Promise<void>): Promise<T> {
      let transactionCallbackCompleted = false;
      try {
        return await withTrackedTransaction(selection, async (transaction) => {
          await transaction.query("set transaction isolation level serializable");
          await transaction.query("set local role jessica_non_proxy_qa_writer");
          await transaction.query("set local search_path = pg_catalog");
          await transaction.query("set local lock_timeout = '5s'");
          await transaction.query("set local statement_timeout = '15s'");
          await transaction.query("set local idle_in_transaction_session_timeout = '15s'");
          driverBudgets.set(transaction as object, newDriverBudget());
          await fault("after-begin");
          const adapter = transactionAdapter(transaction);
          const value = await work(adapter);
          await fault("before-commit");
          await precommitCheck(adapter);
          transactionCallbackCompleted = true;
          return value;
        }, async () => {
          if (options.simulateLostCommitAcknowledgement?.()) throw new NonProxyQaDatabasePortError("commit-outcome-unknown");
          await fault("after-commit");
        }, async () => { await fault("before-transaction"); });
      } catch (error) {
        if (error instanceof NonProxyQaWriterError || error instanceof TypeError || error instanceof NonProxyQaDatabasePortError) throw error;
        if (transactionCallbackCompleted && !["40001", "40P01", "55P03"].includes(String(databaseCode(error)))) throw new NonProxyQaDatabasePortError("commit-outcome-unknown");
        mapError(error);
      }
    },
    async verifyCommittedExact(plan) {
      try {
        await fault("before-recovery");
        return await withTrackedTransaction(planLockIdentity(plan), async (transaction) => {
          await transaction.query("set transaction isolation level repeatable read read only");
          await transaction.query("set local role jessica_non_proxy_qa_writer");
          await transaction.query("set local search_path = pg_catalog");
          await transaction.query("set local lock_timeout = '5s'");
          await transaction.query("set local statement_timeout = '15s'");
          await transaction.query("set local idle_in_transaction_session_timeout = '15s'");
          driverBudgets.set(transaction as object, newDriverBudget());
          const exact = await verifyReadback(transaction, plan); if (!exact) return null;
          const row = await one(transaction, "select writer_committed_at,writer_committed_at_canonical from private.non_proxy_human_qa_records where tenant_id=$1 and id=$2", [plan.reviewRecord.tenantId, plan.reviewRecord.id], ["writer_committed_at","writer_committed_at_canonical"]);
          const committedAt = text(row.writer_committed_at_canonical); if (timestamp(committedAt) !== timestamp(row.writer_committed_at)) fail();
          await fault("after-recovery"); return committedAt;
        });
      } catch (error) { if (error instanceof NonProxyQaDatabasePortError) throw error; mapError(error); }
    },
  };
}
