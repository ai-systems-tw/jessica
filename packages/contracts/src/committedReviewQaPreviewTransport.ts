export const COMMITTED_REVIEW_QA_PREVIEW_TRANSPORT_SCOPE = "qa-preview:runtime:one-shot" as const;

export type CommittedReviewQaPreviewTransportSelection = Readonly<{
  tenantId: string;
  assetVersionId: string;
  assetVersion: number;
}>;

export type CommittedReviewQaPreviewTransportRequest = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-transport-request";
  requestId: string;
  selection: CommittedReviewQaPreviewTransportSelection;
}>;

export type CommittedReviewQaPreviewTransportUnverifiedEvidence = Readonly<{
  kind: "committed-review-binding";
  verification: "required";
  runtimeUsable: false;
  publicLiveUsable: false;
}>;

/** Syntax-checked signed bytes are evidence only until the server verifier succeeds. */
export type UnverifiedCommittedReviewQaPreviewTransportGrant = Readonly<{
  schemaVersion: 1;
  type: "jessica.committed-review-qa-preview-unverified-grant";
  algorithm: "ES256";
  scope: typeof COMMITTED_REVIEW_QA_PREVIEW_TRANSPORT_SCOPE;
  issuerAuthorityId: string;
  keyId: string;
  grantId: string;
  requestId: string;
  audience: string;
  tenantId: string;
  actorId: string;
  reviewerId: string;
  sessionId: string;
  selection: CommittedReviewQaPreviewTransportSelection;
  commitment: Readonly<{
    assetRowSha256: string;
    bindingRowSha256: string;
    reviewRowSha256: string;
    authorityRowSha256: string;
  }>;
  committedReviewValidUntil: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  evidence: CommittedReviewQaPreviewTransportUnverifiedEvidence;
  signatureBase64: string;
}>;

export type UnverifiedCommittedReviewQaPreviewTransportGrantPayload = Omit<UnverifiedCommittedReviewQaPreviewTransportGrant, "signatureBase64">;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const REQUEST_KEYS = ["schemaVersion", "type", "requestId", "selection"] as const;
const SELECTION_KEYS = ["tenantId", "assetVersionId", "assetVersion"] as const;
const COMMITMENT_KEYS = ["assetRowSha256", "bindingRowSha256", "reviewRowSha256", "authorityRowSha256"] as const;
const EVIDENCE_KEYS = ["kind", "verification", "runtimeUsable", "publicLiveUsable"] as const;
const GRANT_KEYS = ["schemaVersion", "type", "algorithm", "scope", "issuerAuthorityId", "keyId", "grantId", "requestId", "audience", "tenantId", "actorId", "reviewerId", "sessionId", "selection", "commitment", "committedReviewValidUntil", "issuedAt", "notBefore", "expiresAt", "evidence", "signatureBase64"] as const;

function fail(message: string): never { throw new TypeError(message); }
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) if (!keys.includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set) fail(`${label} fields are invalid`);
  return value as Record<string, unknown>;
}
function id(value: unknown, label: string): string { if (typeof value !== "string" || !ID.test(value)) fail(`${label} is invalid`); return value; }
function nonce(value: unknown, label: string): string { if (typeof value !== "string" || !HASH.test(value)) fail(`${label} must be 64 lowercase hexadecimal characters`); return value; }
function hash(value: unknown, label: string): string { if (typeof value !== "string" || !HASH.test(value)) fail(`${label} is invalid`); return value; }
function integer(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(`${label} is invalid`); return value; }
function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} is invalid`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) fail(`${label} is invalid`);
  return value;
}
function audience(value: unknown): string {
  if (typeof value !== "string") fail("transport audience is invalid");
  let parsed: URL; try { parsed = new URL(value); } catch { fail("transport audience is invalid"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || parsed.search !== "" || parsed.pathname !== "/" || parsed.origin !== value) fail("transport audience must be one canonical HTTPS origin");
  return value;
}
function signature(value: unknown): string {
  if (typeof value !== "string" || value.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(value)) fail("transport signature must be canonical raw ES256 base64");
  let decoded: string; try { decoded = atob(value); } catch { fail("transport signature must be canonical raw ES256 base64"); }
  if (decoded.length !== 64 || btoa(decoded) !== value) fail("transport signature must encode one raw 64-byte ES256 signature");
  return value;
}
function literal<T extends string | number | boolean>(value: unknown, expected: T, label: string): T { if (value !== expected) fail(`${label} is invalid`); return expected; }

function parseSelection(value: unknown): CommittedReviewQaPreviewTransportSelection {
  const row = exact(value, SELECTION_KEYS, "transport selection");
  return Object.freeze({ tenantId: id(row.tenantId, "selection tenantId"), assetVersionId: id(row.assetVersionId, "selection assetVersionId"), assetVersion: integer(row.assetVersion, "selection assetVersion") });
}

function parseUnverifiedEvidence(value: unknown): CommittedReviewQaPreviewTransportUnverifiedEvidence {
  const row = exact(value, EVIDENCE_KEYS, "unverified transport evidence");
  return Object.freeze({ kind: literal(row.kind, "committed-review-binding", "evidence kind"), verification: literal(row.verification, "required", "evidence verification"), runtimeUsable: literal(row.runtimeUsable, false, "evidence runtimeUsable"), publicLiveUsable: literal(row.publicLiveUsable, false, "evidence publicLiveUsable") });
}

export function parseCommittedReviewQaPreviewTransportRequest(value: unknown): CommittedReviewQaPreviewTransportRequest {
  const row = exact(value, REQUEST_KEYS, "QA-preview transport request");
  return Object.freeze({ schemaVersion: literal(row.schemaVersion, 1, "request schemaVersion"), type: literal(row.type, "jessica.committed-review-qa-preview-transport-request", "request type"), requestId: nonce(row.requestId, "requestId"), selection: parseSelection(row.selection) });
}

export function parseUnverifiedCommittedReviewQaPreviewTransportGrant(value: unknown): UnverifiedCommittedReviewQaPreviewTransportGrant {
  const row = exact(value, GRANT_KEYS, "unverified QA-preview transport grant");
  const commitment = exact(row.commitment, COMMITMENT_KEYS, "transport commitment");
  const issuedAt = timestamp(row.issuedAt, "grant issuedAt");
  const notBefore = timestamp(row.notBefore, "grant notBefore");
  const expiresAt = timestamp(row.expiresAt, "grant expiresAt");
  const committedReviewValidUntil = timestamp(row.committedReviewValidUntil, "grant committedReviewValidUntil");
  if (notBefore !== issuedAt || Date.parse(expiresAt) <= Date.parse(issuedAt)) fail("transport grant time order is invalid");
  if (Date.parse(expiresAt) > Date.parse(committedReviewValidUntil)) fail("transport grant exceeds the committed-review horizon");
  const selection = parseSelection(row.selection);
  const tenantId = id(row.tenantId, "grant tenantId");
  if (selection.tenantId !== tenantId) fail("transport selection tenant is relabelled");
  return Object.freeze({
    schemaVersion: literal(row.schemaVersion, 1, "grant schemaVersion"), type: literal(row.type, "jessica.committed-review-qa-preview-unverified-grant", "grant type"),
    algorithm: literal(row.algorithm, "ES256", "grant algorithm"), scope: literal(row.scope, COMMITTED_REVIEW_QA_PREVIEW_TRANSPORT_SCOPE, "grant scope"),
    issuerAuthorityId: id(row.issuerAuthorityId, "issuerAuthorityId"), keyId: id(row.keyId, "keyId"), grantId: nonce(row.grantId, "grantId"), requestId: nonce(row.requestId, "requestId"),
    audience: audience(row.audience), tenantId, actorId: id(row.actorId, "actorId"), reviewerId: id(row.reviewerId, "reviewerId"), sessionId: id(row.sessionId, "sessionId"), selection,
    commitment: Object.freeze({ assetRowSha256: hash(commitment.assetRowSha256, "asset row digest"), bindingRowSha256: hash(commitment.bindingRowSha256, "binding row digest"), reviewRowSha256: hash(commitment.reviewRowSha256, "review row digest"), authorityRowSha256: hash(commitment.authorityRowSha256, "authority row digest") }),
    committedReviewValidUntil, issuedAt, notBefore, expiresAt, evidence: parseUnverifiedEvidence(row.evidence), signatureBase64: signature(row.signatureBase64),
  });
}

export function unverifiedCommittedReviewQaPreviewTransportGrantPayload(value: unknown): UnverifiedCommittedReviewQaPreviewTransportGrantPayload {
  const grant = parseUnverifiedCommittedReviewQaPreviewTransportGrant(value);
  const { signatureBase64: _signatureBase64, ...payload } = grant;
  return Object.freeze(payload);
}
