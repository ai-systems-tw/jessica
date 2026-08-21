import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "./generationJob.js";
import { NON_PROXY_HUMAN_QA_SCOPE, nonProxyHumanQaPublicJwkFingerprintSha256, type NonProxyApprovedQualityEnvelope, type NonProxyHumanQaDecisionAttestation } from "./nonProxyHumanQaDecision.js";
import { QA_ISSUE_CATEGORIES, QA_REVIEW_DECISIONS, type QaIssueCategory, type QaReviewDecision } from "./qaReview.js";

export const NON_PROXY_QA_PERSISTENCE_SCOPE = "non-proxy-qa-control-plane-persistence" as const;

export type NonProxyQaSourceMapping = Readonly<{ sourceAssetSha256: string; sourceAssetId: string }>;

export type NonProxyQaControlPlaneSnapshot = Readonly<{
  schemaVersion: 1;
  observedAt: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  generationJob: Readonly<{
    id: string;
    canonicalInputSha256: string;
    reviewHeadEventSha256: string;
    generatorInputSha256: string;
    output: GenerationJobOutputEvidence;
  }>;
  sourceMappings: readonly NonProxyQaSourceMapping[];
  measurementSet: Readonly<{ id: string; sha256: string }>;
  candidateAssetVersion: Readonly<{ id: string; version: number }>;
  existingRows: Readonly<{
    reviewerAuthority: Readonly<{ id: string; rowSha256: string }> | null;
    reviewRecord: Readonly<{ id: string; rowSha256: string }> | null;
    assetVersion: Readonly<{ id: string; rowSha256: string }> | null;
    binding: Readonly<{ id: string; rowSha256: string }> | null;
    sourceRows: readonly Readonly<{ id: string; rowSha256: string }>[];
  }>;
  reviewerAuthority: Readonly<{
    authorityId: string;
    keyId: string;
    reviewerId: string;
    scope: typeof NON_PROXY_HUMAN_QA_SCOPE;
    publicKeyFingerprintSha256: string;
    publicJwk: JsonWebKey;
    status: "active";
    createdAt: string;
    revokedAt: null;
  }>;
  reviewPolicy: Readonly<{
    maximumReviewAgeMs: number;
    sha256: string;
  }>;
}>;

export type NonProxyQaAuthorityDenials = Readonly<{
  databaseMutation: false;
  assetVersionCreated: false;
  assetVersionPromoted: false;
  qaPreviewAdmitted: false;
  runtimeAdmitted: false;
  publicLiveAdmitted: false;
  recommendedForLive: false;
  catalogAuthority: false;
  activeDeployment: false;
  deploymentAuthority: false;
  publication: false;
  publicationAuthority: false;
  g1: false;
  g2: false;
  g3: false;
  g4: false;
  g5: false;
  g6: false;
  g7: false;
}>;

export type NonProxyQaReviewerAuthorityRow = Readonly<{
  id: string;
  rowSha256: string;
  tenantId: string;
  authorityId: string;
  keyId: string;
  reviewerId: string;
  scope: "non-proxy-human-qa-decision";
  algorithm: "ES256";
  publicKeyFingerprintSha256: string;
  publicJwk: JsonWebKey;
  status: "active";
  createdAt: string;
  revokedAt: null;
}>;

export type NonProxyHumanQaRecordRow = Readonly<{
  id: string;
  rowSha256: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  candidateAssetVersionId: string;
  candidateVersion: number;
  generationJobId: string;
  canonicalInputSha256: string;
  reviewHeadEventSha256: string;
  generatorInputSha256: string;
  output: GenerationJobOutputEvidence;
  sourceAssetSha256s: readonly string[];
  sourceSetSha256: string;
  measurementSetId: string;
  measurementSetSha256: string;
  specimenId: string;
  composition: NonProxyHumanQaDecisionAttestation["composition"];
  decisionPayloadSha256: string;
  signatureBase64: string;
  reviewerAuthorityRowId: string;
  reviewerAuthorityId: string;
  reviewerKeyId: string;
  reviewerId: string;
  reviewerPublicKeyFingerprintSha256: string;
  decision: QaReviewDecision;
  issueCategories: readonly QaIssueCategory[];
  notes: string | null;
  approvedQualityEnvelope: NonProxyApprovedQualityEnvelope | null;
  reviewedAt: string;
  issuedAt: string;
  expiresAt: string;
  inputValidUntil: string;
  maximumReviewAgeMs: number;
  reviewFreshUntil: string;
  reviewPolicySha256: string;
  effectiveValidUntil: string;
  approvedAssetVersionRowSha256: string | null;
  approvedAssetProjection: NonProxyAssetVersionRow | null;
  rightsScope: "internal-review-only";
  terminal: true;
}>;

export type NonProxyAssetVersionRow = Readonly<{
  id: string;
  rowSha256: string;
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  version: number;
  generationJobId: string;
  quality: "standard" | "premium";
  generationMethod: "standard-auto" | "manual" | "external";
  modelUrl: string;
  manifestUrl: string;
  manifestSha256: string;
  manifestByteLength: number;
  modelSha256: string;
  modelByteLength: number;
  sourceSetSha256: string;
  attachmentMatrix: readonly number[];
  qualityEnvelope: NonProxyApprovedQualityEnvelope;
  status: "approved";
  fixtureStatus: "unverified";
  reviewStatus: "approved";
  admission: "internal-review-only";
  promotable: false;
  rightsScope: "internal-review-only";
  recommendedForLive: false;
  publicationEligible: false;
}>;

export type NonProxyAssetVersionBindingRow = Readonly<{
  id: string;
  rowSha256: string;
  tenantId: string;
  reviewRecordId: string;
  assetVersionId: string;
  frameModelId: string;
  frameVariantId: string;
  generationJobId: string;
  sourceSetSha256: string;
  qualityEnvelope: NonProxyApprovedQualityEnvelope;
  decisionPayloadSha256: string;
  effectiveValidUntil: string;
  assetVersionRowSha256: string;
  rightsScope: "internal-review-only";
  recommendedForLive: false;
  publicationEligible: false;
}>;

export type NonProxyAssetVersionSourceRow = Readonly<{
  id: string;
  rowSha256: string;
  tenantId: string;
  assetVersionId: string;
  frameModelId: string;
  frameVariantId: string;
  sourceAssetId: string;
  sourceSha256: string;
}>;

export type NonProxyQaPersistencePlan = Readonly<{
  schemaVersion: 1;
  planType: "non-proxy-qa-persistence-row-projections";
  planSha256: string;
  idempotencyKey: string;
  decision: QaReviewDecision;
  reviewerAuthority: NonProxyQaReviewerAuthorityRow;
  reviewRecord: NonProxyHumanQaRecordRow;
  assetVersion: NonProxyAssetVersionRow | null;
  binding: NonProxyAssetVersionBindingRow | null;
  sourceRows: readonly NonProxyAssetVersionSourceRow[];
  authority: NonProxyQaAuthorityDenials;
}>;

const PLAN_KEYS = ["schemaVersion", "planType", "planSha256", "idempotencyKey", "decision", "reviewerAuthority", "reviewRecord", "assetVersion", "binding", "sourceRows", "authority"] as const;
const AUTHORITY_KEYS = ["id", "rowSha256", "tenantId", "authorityId", "keyId", "reviewerId", "scope", "algorithm", "publicKeyFingerprintSha256", "publicJwk", "status", "createdAt", "revokedAt"] as const;
const REVIEW_KEYS = ["id", "rowSha256", "tenantId", "frameModelId", "frameVariantId", "candidateAssetVersionId", "candidateVersion", "generationJobId", "canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "output", "sourceAssetSha256s", "sourceSetSha256", "measurementSetId", "measurementSetSha256", "specimenId", "composition", "decisionPayloadSha256", "signatureBase64", "reviewerAuthorityRowId", "reviewerAuthorityId", "reviewerKeyId", "reviewerId", "reviewerPublicKeyFingerprintSha256", "decision", "issueCategories", "notes", "approvedQualityEnvelope", "reviewedAt", "issuedAt", "expiresAt", "inputValidUntil", "maximumReviewAgeMs", "reviewFreshUntil", "reviewPolicySha256", "effectiveValidUntil", "approvedAssetVersionRowSha256", "approvedAssetProjection", "rightsScope", "terminal"] as const;
const ASSET_KEYS = ["id", "rowSha256", "tenantId", "frameModelId", "frameVariantId", "version", "generationJobId", "quality", "generationMethod", "modelUrl", "manifestUrl", "manifestSha256", "manifestByteLength", "modelSha256", "modelByteLength", "sourceSetSha256", "attachmentMatrix", "qualityEnvelope", "status", "fixtureStatus", "reviewStatus", "admission", "promotable", "rightsScope", "recommendedForLive", "publicationEligible"] as const;
const BINDING_KEYS = ["id", "rowSha256", "tenantId", "reviewRecordId", "assetVersionId", "frameModelId", "frameVariantId", "generationJobId", "sourceSetSha256", "qualityEnvelope", "decisionPayloadSha256", "effectiveValidUntil", "assetVersionRowSha256", "rightsScope", "recommendedForLive", "publicationEligible"] as const;
const SOURCE_KEYS = ["id", "rowSha256", "tenantId", "assetVersionId", "frameModelId", "frameVariantId", "sourceAssetId", "sourceSha256"] as const;
const DENIAL_KEYS = ["databaseMutation", "assetVersionCreated", "assetVersionPromoted", "qaPreviewAdmitted", "runtimeAdmitted", "publicLiveAdmitted", "recommendedForLive", "catalogAuthority", "activeDeployment", "deploymentAuthority", "publication", "publicationAuthority", "g1", "g2", "g3", "g4", "g5", "g6", "g7"] as const;
const PERSISTENCE_HASH = /^[a-f0-9]{64}$/;
const PERSISTENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function persistenceObject(value: unknown, path: string): asserts value is Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must be a plain object`); const names = Object.getOwnPropertyNames(value); if (names.length > 512) throw new TypeError(`${path} exceeds the object-width budget`); const keys = Object.keys(value); if (names.length !== keys.length) throw new TypeError(`${path} fields must be enumerable data properties`); for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`); } }
function persistenceExact(value: Record<string, unknown>, keys: readonly string[], path: string): void { const allowed = new Set(keys); if (Object.keys(value).length !== keys.length) throw new TypeError(`${path} must contain exact fields`); for (const key of keys) if (!allowed.has(key) || !Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required`); for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`); }
function persistenceHash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !PERSISTENCE_HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function persistenceId(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !PERSISTENCE_ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function persistencePositive(value: unknown, path: string): asserts value is number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`); }
function persistenceReviewAge(value: unknown, path: string): asserts value is number { persistencePositive(value, path); if (value > 366 * 24 * 60 * 60 * 1000) throw new TypeError(`${path} exceeds the review-policy budget`); }
function persistenceTimestamp(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new TypeError(`${path} must be canonical UTC`); const parsed = Date.parse(value); const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value); const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : ""; if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`); }
function persistencePlainArray(value: unknown, path: string, maximum: number): asserts value is unknown[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} must be a bounded dense plain array`); }
function persistenceSame(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function persistenceBase64(value: unknown): Uint8Array<ArrayBuffer> { if (typeof value !== "string" || value.length !== 88 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError("review signature must be canonical raw ES256 base64"); let decoded: string; try { decoded = atob(value); } catch { throw new TypeError("review signature must be canonical raw ES256 base64"); } if (decoded.length !== 64 || btoa(decoded) !== value) throw new TypeError("review signature must encode 64 bytes"); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>; }
function persistenceEnvelope(value: unknown, path: string): asserts value is NonProxyApprovedQualityEnvelope { persistenceObject(value, path); persistenceExact(value, ["maxYawDeg", "maxPitchDeg", "recommendedForLive", "scaleConfidence"], path); if (typeof value.maxYawDeg !== "number" || !Number.isFinite(value.maxYawDeg) || value.maxYawDeg < 0 || value.maxYawDeg > 90 || typeof value.maxPitchDeg !== "number" || !Number.isFinite(value.maxPitchDeg) || value.maxPitchDeg < 0 || value.maxPitchDeg > 90 || value.recommendedForLive !== false || !["low", "medium", "high"].includes(value.scaleConfidence as string)) throw new TypeError(`${path} must remain a bounded non-live envelope`); }
function persistenceOutput(value: unknown): void { persistenceObject(value, "review output"); persistenceExact(value, ["manifestSha256", "modelSha256", "manifestByteLength", "modelByteLength"], "review output"); persistenceHash(value.manifestSha256, "review output.manifestSha256"); persistenceHash(value.modelSha256, "review output.modelSha256"); persistencePositive(value.manifestByteLength, "review output.manifestByteLength"); persistencePositive(value.modelByteLength, "review output.modelByteLength"); }
type PersistenceCloneState = { nodes: number; textBytes: number; active: WeakSet<object> };
function persistenceClone(value: unknown, path: string, state: PersistenceCloneState = { nodes: 0, textBytes: 0, active: new WeakSet<object>() }, depth = 0): unknown {
  if (depth > 96) throw new TypeError("persistence plan exceeds the nesting-depth budget");
  state.nodes += 1; if (state.nodes > 30_000) throw new TypeError("persistence plan exceeds the structural budget");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 512 || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must be a bounded dense plain array`);
    const names = Object.getOwnPropertyNames(value); if (names.length !== value.length + 1 || names.length > 513) throw new TypeError(`${path} must be a bounded dense plain array`);
    if (state.active.has(value)) throw new TypeError(`${path} must not be cyclic`); state.active.add(value);
    const copy = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}.${index} must be an enumerable data property`); Object.defineProperty(copy, String(index), { value: persistenceClone(descriptor.value, `${path}.${index}`, state, depth + 1), writable: true, configurable: true, enumerable: true }); }
    state.active.delete(value); return copy;
  }
  if (typeof value === "object" && value !== null) {
    persistenceObject(value, path); if (state.active.has(value)) throw new TypeError(`${path} must not be cyclic`); state.active.add(value);
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) { state.textBytes += new TextEncoder().encode(key).byteLength; if (!Number.isSafeInteger(state.textBytes) || state.textBytes > 16 * 1024 * 1024) throw new TypeError("persistence plan exceeds the aggregate text budget"); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}.${key} must be an enumerable data property`); Object.defineProperty(copy, key, { value: persistenceClone(descriptor.value, `${path}.${key}`, state, depth + 1), writable: true, configurable: true, enumerable: true }); }
    state.active.delete(value); return copy;
  }
  if (typeof value === "string") { const length = new TextEncoder().encode(value).byteLength; if (length > 1_000_000) throw new TypeError(`${path} exceeds the string budget`); state.textBytes += length; if (!Number.isSafeInteger(state.textBytes) || state.textBytes > 16 * 1024 * 1024) throw new TypeError("persistence plan exceeds the aggregate text budget"); }
  return value;
}
function persistenceFreeze<T>(value: T): T { if (typeof value === "object" && value !== null && !Object.isFrozen(value)) { for (const item of Object.values(value as Record<string, unknown>)) persistenceFreeze(item); Object.freeze(value); } return value; }
function persistenceRestorePublicPrototypes<T>(value: T): T { if (typeof value === "object" && value !== null) { for (const item of Object.values(value as Record<string, unknown>)) persistenceRestorePublicPrototypes(item); if (!Array.isArray(value) && Object.getPrototypeOf(value) === null) Object.setPrototypeOf(value, Object.prototype); } return value; }
function bodyWithout(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> { return Object.fromEntries(keys.filter((key) => key !== "id" && key !== "rowSha256").map((key) => [key, row[key]])); }
async function verifyHashedRow(rowValue: unknown, keys: readonly string[], domain: string, prefix: string, includeId = false): Promise<Record<string, unknown>> { persistenceObject(rowValue, domain); persistenceExact(rowValue, keys, domain); persistenceId(rowValue.id, `${domain}.id`); persistenceHash(rowValue.rowSha256, `${domain}.rowSha256`); const body = bodyWithout(rowValue, keys); const digest = await sha256Hex(canonicalJson(includeId ? { domain, id: rowValue.id, body } : { domain, body })); if (digest !== rowValue.rowSha256) throw new TypeError(`${domain} row digest mismatch`); if (!includeId && rowValue.id !== `${prefix}_${digest}`) throw new TypeError(`${domain} row identity mismatch`); return rowValue; }

/** Integrity and semantic inspection only. Embedded-key verification does not establish host trust or mutation authority. */
export async function inspectNonProxyQaPersistencePlanIntegrity(value: unknown): Promise<NonProxyQaPersistencePlan> {
  const copy = persistenceClone(value, "persistence plan"); persistenceObject(copy, "persistence plan"); persistenceExact(copy, PLAN_KEYS, "persistence plan");
  if (copy.schemaVersion !== 1 || copy.planType !== "non-proxy-qa-persistence-row-projections" || !QA_REVIEW_DECISIONS.includes(copy.decision as QaReviewDecision)) throw new TypeError("persistence plan discriminator or decision is invalid"); persistenceHash(copy.planSha256, "persistence plan.planSha256"); if (copy.idempotencyKey !== `nqpp_${copy.planSha256}`) throw new TypeError("persistence plan idempotencyKey mismatch");
  const reviewer = await verifyHashedRow(copy.reviewerAuthority, AUTHORITY_KEYS, "jessica/non-proxy-qa/reviewer-authority-row/v1", "nqra");
  persistenceObject(copy.reviewRecord, "review record"); persistenceExact(copy.reviewRecord, REVIEW_KEYS, "review record"); persistenceId(copy.reviewRecord.id, "review record.id"); persistenceHash(copy.reviewRecord.rowSha256, "review record.rowSha256"); persistenceHash(copy.reviewRecord.decisionPayloadSha256, "review record.decisionPayloadSha256"); const reviewBody = bodyWithout(copy.reviewRecord, REVIEW_KEYS); const reviewDigest = await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/human-review-row/v1", body: reviewBody })); if (reviewDigest !== copy.reviewRecord.rowSha256) throw new TypeError("review record row digest mismatch"); const semantic = await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/terminal-review-identity/v1", tenantId: copy.reviewRecord.tenantId, candidateAssetVersionId: copy.reviewRecord.candidateAssetVersionId, candidateVersion: copy.reviewRecord.candidateVersion, generationJobId: copy.reviewRecord.generationJobId, decisionPayloadSha256: copy.reviewRecord.decisionPayloadSha256 })); if (copy.reviewRecord.id !== `nqhr_${semantic}`) throw new TypeError("review record terminal identity mismatch");
  let asset: Record<string, unknown> | null = null; let binding: Record<string, unknown> | null = null; if (copy.assetVersion !== null) asset = await verifyHashedRow(copy.assetVersion, ASSET_KEYS, "jessica/non-proxy-qa/asset-version-row/v1", "", true); if (copy.binding !== null) binding = await verifyHashedRow(copy.binding, BINDING_KEYS, "jessica/non-proxy-qa/asset-binding-row/v1", "nqab");
  if (!Array.isArray(copy.sourceRows)) throw new TypeError("sourceRows must be an array"); const sources: Record<string, unknown>[] = []; for (const item of copy.sourceRows) sources.push(await verifyHashedRow(item, SOURCE_KEYS, "jessica/non-proxy-qa/asset-source-row/v1", "nqas"));
  if ((copy.decision === "approve") !== (asset !== null && binding !== null && sources.length > 0) || (copy.decision === "reject" && (asset !== null || binding !== null || sources.length !== 0))) throw new TypeError("persistence plan approve/reject row shape is invalid");
  persistenceObject(copy.authority, "persistence authority denials"); persistenceExact(copy.authority, DENIAL_KEYS, "persistence authority denials"); for (const key of DENIAL_KEYS) if (copy.authority[key] !== false) throw new TypeError(`persistence authority.${key} must remain false`);
  for (const key of ["tenantId", "authorityId", "keyId", "reviewerId"] as const) persistenceId(reviewer[key], `reviewer authority.${key}`); persistenceHash(reviewer.publicKeyFingerprintSha256, "reviewer authority fingerprint"); persistenceTimestamp(reviewer.createdAt, "reviewer authority.createdAt");
  if (reviewer.scope !== NON_PROXY_HUMAN_QA_SCOPE || reviewer.algorithm !== "ES256" || reviewer.status !== "active" || reviewer.revokedAt !== null) throw new TypeError("reviewer authority must remain active ES256 human-QA authority");
  persistenceObject(reviewer.publicJwk, "reviewer authority publicJwk"); persistenceExact(reviewer.publicJwk, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"], "reviewer authority publicJwk"); persistencePlainArray(reviewer.publicJwk.key_ops, "reviewer authority publicJwk.key_ops", 1); if (reviewer.publicJwk.key_ops.length !== 1 || reviewer.publicJwk.key_ops[0] !== "verify" || reviewer.publicJwk.ext !== true || reviewer.publicJwk.kty !== "EC" || reviewer.publicJwk.crv !== "P-256" || reviewer.publicJwk.use !== "sig" || reviewer.publicJwk.alg !== "ES256" || typeof reviewer.publicJwk.x !== "string" || typeof reviewer.publicJwk.y !== "string" || reviewer.publicJwk.x.length !== 43 || reviewer.publicJwk.y.length !== 43) throw new TypeError("reviewer authority JWK must be exact ES256 public verify-only P-256");
  if (await nonProxyHumanQaPublicJwkFingerprintSha256(reviewer.publicJwk as JsonWebKey) !== reviewer.publicKeyFingerprintSha256) throw new TypeError("reviewer authority JWK fingerprint mismatch");

  for (const key of ["tenantId", "frameModelId", "frameVariantId", "candidateAssetVersionId", "generationJobId", "measurementSetId", "specimenId", "reviewerAuthorityRowId", "reviewerAuthorityId", "reviewerKeyId", "reviewerId"] as const) persistenceId(copy.reviewRecord[key], `review record.${key}`); persistencePositive(copy.reviewRecord.candidateVersion, "review record.candidateVersion");
  for (const key of ["canonicalInputSha256", "reviewHeadEventSha256", "generatorInputSha256", "sourceSetSha256", "measurementSetSha256", "decisionPayloadSha256", "reviewerPublicKeyFingerprintSha256", "reviewPolicySha256"] as const) persistenceHash(copy.reviewRecord[key], `review record.${key}`); persistenceOutput(copy.reviewRecord.output);
  persistencePlainArray(copy.reviewRecord.sourceAssetSha256s, "review source hashes", 32); copy.reviewRecord.sourceAssetSha256s.forEach((item, index) => persistenceHash(item, `review source hashes.${index}`)); if (copy.reviewRecord.sourceAssetSha256s.length === 0 || new Set(copy.reviewRecord.sourceAssetSha256s).size !== copy.reviewRecord.sourceAssetSha256s.length || !persistenceSame(copy.reviewRecord.sourceAssetSha256s, [...copy.reviewRecord.sourceAssetSha256s].sort())) throw new TypeError("review source hashes must be non-empty, unique, and sorted");
  persistenceObject(copy.reviewRecord.composition, "review composition"); persistenceExact(copy.reviewRecord.composition, ["candidateSha256", "formalizationStableSha256", "markingProvenanceStableSha256", "caliperProvenanceStableSha256", "measurementSetSha256", "calibrationRecordSha256", "calibrationPayloadSha256", "calibrationAttestationPayloadSha256", "measurementSessionSha256", "measurementSessionPayloadSha256", "measurementAttestationPayloadSha256", "captureProvenancePayloadSha256", "inputValidUntil"], "review composition"); for (const [key, item] of Object.entries(copy.reviewRecord.composition)) key === "inputValidUntil" ? persistenceTimestamp(item, `review composition.${key}`) : persistenceHash(item, `review composition.${key}`);
  persistencePlainArray(copy.reviewRecord.issueCategories, "review issues", QA_ISSUE_CATEGORIES.length); copy.reviewRecord.issueCategories.forEach((item) => { if (!QA_ISSUE_CATEGORIES.includes(item as QaIssueCategory)) throw new TypeError("review issue is unsupported"); }); if (new Set(copy.reviewRecord.issueCategories).size !== copy.reviewRecord.issueCategories.length || !persistenceSame(copy.reviewRecord.issueCategories, [...copy.reviewRecord.issueCategories].sort())) throw new TypeError("review issues must be unique and sorted");
  for (const key of ["reviewedAt", "issuedAt", "expiresAt", "inputValidUntil", "reviewFreshUntil", "effectiveValidUntil"] as const) persistenceTimestamp(copy.reviewRecord[key], `review record.${key}`);
  persistenceReviewAge(copy.reviewRecord.maximumReviewAgeMs, "review record.maximumReviewAgeMs");
  const exactPolicySha256 = await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/review-policy/v1", maximumReviewAgeMs: copy.reviewRecord.maximumReviewAgeMs }));
  const exactReviewFreshUntil = new Date(Date.parse(copy.reviewRecord.reviewedAt as string) + (copy.reviewRecord.maximumReviewAgeMs as number)).toISOString();
  const exactEffective = new Date(Math.min(Date.parse(copy.reviewRecord.expiresAt as string), Date.parse(copy.reviewRecord.inputValidUntil as string), Date.parse(copy.reviewRecord.reviewFreshUntil as string))).toISOString();
  if (Date.parse(copy.reviewRecord.reviewedAt as string) > Date.parse(copy.reviewRecord.issuedAt as string) || Date.parse(copy.reviewRecord.issuedAt as string) >= Date.parse(copy.reviewRecord.expiresAt as string) || copy.reviewRecord.reviewPolicySha256 !== exactPolicySha256 || copy.reviewRecord.reviewFreshUntil !== exactReviewFreshUntil || copy.reviewRecord.effectiveValidUntil !== exactEffective) throw new TypeError("review policy or validity times are inconsistent");
  const exactSourceSet = await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/source-set/v1", sourceAssetSha256s: copy.reviewRecord.sourceAssetSha256s }));
  if (copy.reviewRecord.rightsScope !== "internal-review-only" || copy.reviewRecord.terminal !== true || copy.reviewRecord.decision !== copy.decision || copy.reviewRecord.reviewerAuthorityRowId !== reviewer.id || copy.reviewRecord.reviewerAuthorityId !== reviewer.authorityId || copy.reviewRecord.reviewerKeyId !== reviewer.keyId || copy.reviewRecord.reviewerId !== reviewer.reviewerId || copy.reviewRecord.reviewerPublicKeyFingerprintSha256 !== reviewer.publicKeyFingerprintSha256 || copy.reviewRecord.measurementSetSha256 !== copy.reviewRecord.composition.measurementSetSha256 || copy.reviewRecord.inputValidUntil !== copy.reviewRecord.composition.inputValidUntil || copy.reviewRecord.sourceSetSha256 !== exactSourceSet || Date.parse(reviewer.createdAt as string) > Date.parse(copy.reviewRecord.reviewedAt as string)) throw new TypeError("review authority, rights, terminal, composition, source-set, validity, or decision binding mismatch");
  if (copy.reviewRecord.notes !== null && (typeof copy.reviewRecord.notes !== "string" || copy.reviewRecord.notes.length < 1 || copy.reviewRecord.notes.length > 2000 || copy.reviewRecord.notes !== copy.reviewRecord.notes.trim())) throw new TypeError("review notes must be bounded trimmed text or null");
  if (copy.decision === "approve") { persistenceHash(copy.reviewRecord.approvedAssetVersionRowSha256, "review record.approvedAssetVersionRowSha256"); if (copy.reviewRecord.issueCategories.length !== 0 || copy.reviewRecord.approvedQualityEnvelope === null || copy.reviewRecord.approvedAssetProjection === null) throw new TypeError("approve record requires no issues and one exact asset projection"); persistenceEnvelope(copy.reviewRecord.approvedQualityEnvelope, "approved review envelope"); } else if (copy.reviewRecord.issueCategories.length === 0 || copy.reviewRecord.approvedQualityEnvelope !== null || copy.reviewRecord.approvedAssetVersionRowSha256 !== null || copy.reviewRecord.approvedAssetProjection !== null) throw new TypeError("reject record requires issues, no envelope, and no approved asset projection");
  const signedPayload = { schemaVersion: 1, type: "non-proxy-human-qa-decision-attestation", algorithm: "ES256", scope: NON_PROXY_HUMAN_QA_SCOPE, authorityId: copy.reviewRecord.reviewerAuthorityId, keyId: copy.reviewRecord.reviewerKeyId, publicKeyFingerprintSha256: copy.reviewRecord.reviewerPublicKeyFingerprintSha256, reviewerId: copy.reviewRecord.reviewerId, tenantId: copy.reviewRecord.tenantId, frameModelId: copy.reviewRecord.frameModelId, frameVariantId: copy.reviewRecord.frameVariantId, candidateId: copy.reviewRecord.candidateAssetVersionId, candidateVersion: copy.reviewRecord.candidateVersion, jobId: copy.reviewRecord.generationJobId, canonicalInputSha256: copy.reviewRecord.canonicalInputSha256, reviewHeadEventSha256: copy.reviewRecord.reviewHeadEventSha256, generatorInputSha256: copy.reviewRecord.generatorInputSha256, output: copy.reviewRecord.output, sourceAssetSha256s: copy.reviewRecord.sourceAssetSha256s, measurementSetSha256: copy.reviewRecord.measurementSetSha256, specimenId: copy.reviewRecord.specimenId, composition: copy.reviewRecord.composition, rightsScope: copy.reviewRecord.rightsScope, decision: copy.reviewRecord.decision, issueCategories: copy.reviewRecord.issueCategories, notes: copy.reviewRecord.notes, approvedQualityEnvelope: copy.reviewRecord.approvedQualityEnvelope, reviewedAt: copy.reviewRecord.reviewedAt, issuedAt: copy.reviewRecord.issuedAt, expiresAt: copy.reviewRecord.expiresAt };
  const payloadBytes = new TextEncoder().encode(canonicalJson(signedPayload)); if (await sha256Hex(payloadBytes) !== copy.reviewRecord.decisionPayloadSha256) throw new TypeError("signed decision payload digest mismatch"); const verificationKey = await crypto.subtle.importKey("jwk", reviewer.publicJwk as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verificationKey, persistenceBase64(copy.reviewRecord.signatureBase64), payloadBytes)) throw new TypeError("signed decision ES256 verification failed");

  if (asset) {
    for (const key of ["id", "tenantId", "frameModelId", "frameVariantId", "generationJobId"] as const) persistenceId(asset[key], `asset.${key}`); persistencePositive(asset.version, "asset.version"); for (const key of ["manifestSha256", "modelSha256", "sourceSetSha256"] as const) persistenceHash(asset[key], `asset.${key}`); persistencePositive(asset.manifestByteLength, "asset.manifestByteLength"); persistencePositive(asset.modelByteLength, "asset.modelByteLength"); if (typeof asset.modelUrl !== "string" || typeof asset.manifestUrl !== "string") throw new TypeError("asset URLs must be strings");
    persistencePlainArray(asset.attachmentMatrix, "asset attachmentMatrix", 16); if (asset.attachmentMatrix.length !== 16 || asset.attachmentMatrix.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new TypeError("asset attachmentMatrix must have 16 finite numbers"); persistenceEnvelope(asset.qualityEnvelope, "asset qualityEnvelope");
    if (!["standard", "premium"].includes(asset.quality as string) || !["standard-auto", "manual", "external"].includes(asset.generationMethod as string) || asset.status !== "approved" || asset.fixtureStatus !== "unverified" || asset.reviewStatus !== "approved" || asset.admission !== "internal-review-only" || asset.promotable !== false || asset.rightsScope !== "internal-review-only" || asset.recommendedForLive !== false || asset.publicationEligible !== false) throw new TypeError("asset row must remain approved internal-review-only and non-promotable/non-live");
  }
  if (binding && asset) {
    for (const key of ["id", "tenantId", "reviewRecordId", "assetVersionId", "frameModelId", "frameVariantId", "generationJobId"] as const) persistenceId(binding[key], `binding.${key}`); persistenceHash(binding.sourceSetSha256, "binding.sourceSetSha256"); persistenceHash(binding.decisionPayloadSha256, "binding.decisionPayloadSha256"); persistenceTimestamp(binding.effectiveValidUntil, "binding.effectiveValidUntil"); persistenceEnvelope(binding.qualityEnvelope, "binding.qualityEnvelope");
    persistenceHash(binding.assetVersionRowSha256, "binding.assetVersionRowSha256"); if (binding.rightsScope !== "internal-review-only" || binding.recommendedForLive !== false || binding.publicationEligible !== false) throw new TypeError("binding must remain internal-review-only and non-live");
    for (const key of ["tenantId", "frameModelId", "frameVariantId", "generationJobId"] as const) if (binding[key] !== asset[key] || asset[key] !== copy.reviewRecord[key]) throw new TypeError(`persistence cross-row ${key} mismatch`); if (binding.reviewRecordId !== copy.reviewRecord.id || binding.assetVersionId !== asset.id || asset.id !== copy.reviewRecord.candidateAssetVersionId || asset.version !== copy.reviewRecord.candidateVersion || binding.sourceSetSha256 !== asset.sourceSetSha256 || asset.sourceSetSha256 !== copy.reviewRecord.sourceSetSha256 || binding.decisionPayloadSha256 !== copy.reviewRecord.decisionPayloadSha256 || binding.effectiveValidUntil !== copy.reviewRecord.effectiveValidUntil || binding.assetVersionRowSha256 !== asset.rowSha256 || copy.reviewRecord.approvedAssetVersionRowSha256 !== asset.rowSha256 || !persistenceSame(copy.reviewRecord.approvedAssetProjection, asset) || !persistenceSame(binding.qualityEnvelope, asset.qualityEnvelope) || !persistenceSame(asset.qualityEnvelope, copy.reviewRecord.approvedQualityEnvelope)) throw new TypeError("persistence binding/asset/review identity, projection, digest, expiry, source-set, or envelope mismatch");
    const output = copy.reviewRecord.output as Record<string, unknown>; if (asset.manifestSha256 !== output.manifestSha256 || asset.manifestByteLength !== output.manifestByteLength || asset.modelSha256 !== output.modelSha256 || asset.modelByteLength !== output.modelByteLength) throw new TypeError("asset output does not match signed review output");
  }
  if (sources.length > 0 && asset) { const sourceHashes: string[] = []; const sourceIds = new Set<string>(); for (const source of sources) { for (const key of ["id", "tenantId", "assetVersionId", "frameModelId", "frameVariantId", "sourceAssetId"] as const) persistenceId(source[key], `source row.${key}`); persistenceHash(source.sourceSha256, "source row.sourceSha256"); if (source.tenantId !== asset.tenantId || source.assetVersionId !== asset.id || source.frameModelId !== asset.frameModelId || source.frameVariantId !== asset.frameVariantId || sourceIds.has(source.sourceAssetId as string)) throw new TypeError("source row identity is relabelled or duplicated"); sourceIds.add(source.sourceAssetId as string); sourceHashes.push(source.sourceSha256 as string); } if (!persistenceSame(sourceHashes, copy.reviewRecord.sourceAssetSha256s)) throw new TypeError("source rows must exactly and canonically cover signed review hashes"); }
  const { planSha256: _digest, idempotencyKey: _key, ...body } = copy; const digest = await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/persistence-plan/v1", body })); if (digest !== copy.planSha256) throw new TypeError("persistence plan digest mismatch"); return persistenceFreeze(persistenceRestorePublicPrototypes(copy) as unknown as NonProxyQaPersistencePlan);
}
