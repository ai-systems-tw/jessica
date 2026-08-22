import assert from "node:assert/strict";
import test from "node:test";

import {
  CommittedReviewQaPreviewTransportError,
  createCommittedReviewQaPreviewTransportIssuer,
  createCommittedReviewQaPreviewTransportVerifier,
  createInMemoryCommittedReviewQaPreviewReplayStore,
} from "../dist/packages/asset-review/src/index.js";
import { canonicalJson, parseCommittedReviewQaPreviewTransportRequest, parseUnverifiedCommittedReviewQaPreviewTransportGrant, unverifiedCommittedReviewQaPreviewTransportGrantPayload } from "../dist/packages/contracts/src/index.js";

const AUDIENCE = "https://qa-preview.example";
const TENANT = "tenant-a";
const NOW = "2030-08-22T00:00:00.000Z";
const SESSION_EXPIRY = "2030-08-22T00:05:00.000Z";
const H = Object.freeze({ asset: "1".repeat(64), binding: "2".repeat(64), review: "3".repeat(64), authority: "4".repeat(64) });
const REQUEST = Object.freeze({ schemaVersion: 1, type: "jessica.committed-review-qa-preview-transport-request", requestId: "a".repeat(64), selection: { tenantId: TENANT, assetVersionId: "asset-a", assetVersion: 1 } });
const ACTOR = Object.freeze({ tenantId: TENANT, actorId: "actor-a", reviewerId: "reviewer-a", sessionId: "session-a", sessionExpiresAt: SESSION_EXPIRY, scopes: ["qa-preview:read"] });

const transportError = (code) => (error) => error instanceof CommittedReviewQaPreviewTransportError && error.code === code;
const bytes = (value) => new TextEncoder().encode(canonicalJson(value));

async function keyFixture(authorityId = "transport-authority-a", keyId = "transport-key-a") {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = { key_ops: ["verify"], ext: true, kty: "EC", x: exported.x, y: exported.y, crv: "P-256", use: "sig", alg: "ES256" };
  return {
    publicJwk,
    signer: Object.freeze({ algorithm: "ES256", authorityId, keyId, sign: async (payload) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, payload)) }),
  };
}

function committedReviewHarness(state) {
  const issued = new WeakSet();
  return Object.freeze({
    async issue(identity, selection) {
      state.coreIssueCalls += 1; assert.equal(identity, "opaque-session"); assert.deepEqual(selection, REQUEST.selection);
      if (state.coreIssueFailure) throw state.coreIssueFailure;
      const capability = Object.freeze({ opaque: true }); issued.add(capability); return capability;
    },
    async use(identity, capability) {
      state.coreUseCalls += 1; assert.equal(identity, "opaque-session"); if (!issued.delete(capability)) throw new Error("invalid capability");
      if (state.coreUseFailure) throw state.coreUseFailure;
      return Object.freeze({ schemaVersion: 1, type: "jessica.committed-review-qa-preview-eligibility", expiresAt: state.eligibilityExpiry, committedReviewValidUntil: state.committedReviewValidUntil,
        asset: Object.freeze({ tenantId: state.eligibilityTenantId, assetVersionId: state.eligibilityAssetVersionId, assetVersion: state.eligibilityAssetVersion, frameModelId: "model-a", frameVariantId: "variant-a" }),
        digests: Object.freeze({ ...state.eligibilityDigests }),
        authority: Object.freeze({ qaPreviewEligibility: true, qaPreviewRuntime: false, runtime: false, publicLive: false, recommendedForLive: false, catalogPublic: false, deployment: false, publication: false, commerce: false, G1: false, G2: false, G3: false, G4: false, G5: false, G6: false, G7: false }),
      });
    },
  });
}

async function harness(options = {}) {
  const key = options.key ?? await keyFixture();
  const state = { now: options.now ?? NOW, actor: structuredClone(options.actor ?? ACTOR), eligibilityExpiry: options.eligibilityExpiry ?? "2030-08-22T00:03:00.000Z", committedReviewValidUntil: options.committedReviewValidUntil ?? "2030-08-22T00:10:00.000Z", eligibilityTenantId: TENANT, eligibilityAssetVersionId: "asset-a", eligibilityAssetVersion: 1, eligibilityDigests: { assetRowSha256: H.asset, bindingRowSha256: H.binding, reviewRowSha256: H.review, authorityRowSha256: H.authority }, coreIssueFailure: null, coreUseFailure: null, nextGrant: 1, coreIssueCalls: 0, coreUseCalls: 0, runtimeCalls: [], authCalls: 0 };
  const authenticate = async (identity) => { state.authCalls += 1; return identity === "opaque-session" ? structuredClone(state.actor) : null; };
  const issuer = createCommittedReviewQaPreviewTransportIssuer({ authenticate, committedReview: options.committedReview ?? committedReviewHarness(state), signer: key.signer, audience: AUDIENCE, createGrantId: () => (state.nextGrant++).toString(16).padStart(64, "0"), now: async () => state.now, maximumGrantAgeMs: options.maximumGrantAgeMs ?? 30_000 });
  const replayStore = options.replayStore ?? createInMemoryCommittedReviewQaPreviewReplayStore();
  const runtime = options.runtime ?? { execute: async (command) => { state.runtimeCalls.push(command); return Object.freeze({ accepted: true, grantId: command.grantId }); } };
  const verifier = createCommittedReviewQaPreviewTransportVerifier({ authenticate, committedReview: options.verifierCommittedReview ?? options.committedReview ?? committedReviewHarness(state), trustedKeys: [{ authorityId: key.signer.authorityId, keyId: key.signer.keyId, tenantId: TENANT, publicJwk: key.publicJwk }], audience: AUDIENCE, replayStore, runtime, now: async () => state.now, maximumGrantAgeMs: options.verifierMaximumGrantAgeMs ?? options.maximumGrantAgeMs ?? 30_000 });
  return { state, issuer, verifier, key, replayStore };
}

async function resign(grant, signer, changes) {
  const unsigned = { ...structuredClone(grant), ...changes };
  delete unsigned.signatureBase64;
  const signature = await signer.sign(bytes(unsigned));
  return { ...unsigned, signatureBase64: Buffer.from(signature).toString("base64") };
}

test("strict v1 request and signed grant contracts reject receipts, unknown fields, accessors, and non-canonical time/audience", async () => {
  assert.deepEqual(parseCommittedReviewQaPreviewTransportRequest(REQUEST), REQUEST);
  assert.deepEqual(Object.keys(parseCommittedReviewQaPreviewTransportRequest(REQUEST)), ["schemaVersion", "type", "requestId", "selection"]);
  for (const candidate of [
    { ...REQUEST, receipt: { disposition: "inserted" } }, Object.assign(Object.create({}), REQUEST),
    { ...REQUEST, actorRequestIdentity: "opaque-session" }, { ...REQUEST, sessionId: "session-a" }, { ...REQUEST, csrfToken: "csrf-secret" },
    { ...REQUEST, requestId: "request-a" }, { ...REQUEST, requestId: "A".repeat(64) },
    { ...REQUEST, selection: { ...REQUEST.selection, receiptSha256: "0".repeat(64) } },
    Object.defineProperty({ ...REQUEST }, "requestId", { enumerable: true, get: () => "request-a" }),
  ]) assert.throws(() => parseCommittedReviewQaPreviewTransportRequest(candidate), TypeError);
  const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST);
  assert.deepEqual(parseUnverifiedCommittedReviewQaPreviewTransportGrant(grant), grant);
  for (const candidate of [
    { ...grant, receipt: {} }, { ...grant, audience: `${AUDIENCE}/path` }, { ...grant, issuedAt: "2030-08-22T00:00:00Z" },
    { ...grant, authority: { qaPreviewRuntime: true } },
    { ...grant, selection: { ...grant.selection, tenantId: "tenant-b" } }, { ...grant, signatureBase64: grant.signatureBase64.slice(0, -1) + "A" },
  ]) assert.throws(() => parseUnverifiedCommittedReviewQaPreviewTransportGrant(candidate), TypeError);
});

test("syntax-parsed and cloned grant stays unverified until the verifier alone emits a runtime command", async () => {
  const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST);
  assert.equal(grant.expiresAt, "2030-08-22T00:00:30.000Z"); assert.equal("authority" in grant, false);
  assert.deepEqual(grant.evidence, { kind: "committed-review-binding", verification: "required", runtimeUsable: false, publicLiveUsable: false });
  assert.equal(Object.isFrozen(grant), true); assert.equal(Object.isFrozen(grant.commitment), true); assert.equal(h.state.coreIssueCalls, 1); assert.equal(h.state.coreUseCalls, 1);
  const parsed = parseUnverifiedCommittedReviewQaPreviewTransportGrant(grant); const cloned = structuredClone(parsed);
  assert.equal("authority" in parsed, false); assert.equal("authority" in cloned, false); assert.equal(h.state.runtimeCalls.length, 0);
  assert.equal(JSON.stringify(parsed).includes("qaPreviewRuntime"), false);
  const result = await h.verifier.consume("opaque-session", cloned);
  assert.deepEqual(result, { accepted: true, grantId: "1".padStart(64, "0") }); assert.equal(h.state.runtimeCalls.length, 1);
  const command = h.state.runtimeCalls[0]; assert.equal(Object.isFrozen(command), true); assert.deepEqual(command.selection, REQUEST.selection); assert.deepEqual(command.commitment, { assetRowSha256: H.asset, bindingRowSha256: H.binding, reviewRowSha256: H.review, authorityRowSha256: H.authority });
  assert.notEqual(command, parsed); assert.notEqual(command, cloned); assert.equal(command.type, "jessica.committed-review-qa-preview-runtime-command"); assert.equal("evidence" in command, false); assert.equal("signatureBase64" in command, false);
  assert.deepEqual(command.authority, { qaPreviewRuntime: true, runtime: false, publicLive: false, publication: false, deployment: false, commerce: false });
});

test("signature covers every audience, identity, locator, commitment, time, scope, and evidence field", async () => {
  const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST);
  const mutations = [
    { audience: "https://other.example" }, { tenantId: "tenant-b", selection: { ...grant.selection, tenantId: "tenant-b" } }, { actorId: "actor-b" }, { reviewerId: "reviewer-b" }, { sessionId: "session-b" },
    { requestId: "b".repeat(64) }, { grantId: "b".repeat(64) }, { selection: { ...grant.selection, assetVersion: 2 } }, { commitment: { ...grant.commitment, assetRowSha256: "9".repeat(64) } },
    { expiresAt: "2030-08-22T00:00:29.000Z" }, { scope: "qa-preview:read" }, { evidence: { ...grant.evidence, runtimeUsable: true } },
  ];
  for (const mutation of mutations) await assert.rejects(h.verifier.consume("opaque-session", { ...structuredClone(grant), ...mutation }), transportError("DENIED"));
  assert.equal(h.state.runtimeCalls.length, 0);
});

test("client-generated keys, unknown keys, cross-audience verifiers, and overlong signed grants are denied", async () => {
  const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); const attacker = await keyFixture("transport-authority-a", "transport-key-a");
  const forged = await resign(grant, attacker.signer, { grantId: "f".repeat(64) });
  await assert.rejects(h.verifier.consume("opaque-session", forged), transportError("DENIED"));
  await assert.rejects(h.verifier.consume("opaque-session", { ...grant, keyId: "unknown-key" }), transportError("DENIED"));
  const otherAudience = createCommittedReviewQaPreviewTransportVerifier({ authenticate: async () => structuredClone(ACTOR), committedReview: committedReviewHarness(h.state), trustedKeys: [{ authorityId: h.key.signer.authorityId, keyId: h.key.signer.keyId, tenantId: TENANT, publicJwk: h.key.publicJwk }], audience: "https://other.example", replayStore: createInMemoryCommittedReviewQaPreviewReplayStore(), runtime: { execute: async () => true }, now: async () => NOW });
  await assert.rejects(otherAudience.consume("opaque-session", grant), transportError("DENIED"));
  const signedOverlong = await resign(grant, h.key.signer, { expiresAt: "2030-08-22T00:01:00.000Z" });
  await assert.rejects(h.verifier.consume("opaque-session", signedOverlong), transportError("DENIED"));
});

test("trust construction rejects keyId duplication and the same P-256 key under an alias", async () => {
  const key = await keyFixture(); const base = { authorityId: key.signer.authorityId, keyId: key.signer.keyId, tenantId: TENANT, publicJwk: key.publicJwk };
  const dependencies = { authenticate: async () => ACTOR, committedReview: { issue: async () => ({}), use: async () => ({}) }, audience: AUDIENCE, replayStore: createInMemoryCommittedReviewQaPreviewReplayStore(), runtime: { execute: async () => true }, now: async () => NOW };
  assert.throws(() => createCommittedReviewQaPreviewTransportVerifier({ ...dependencies, trustedKeys: [base, { ...base }] }), /duplicate.*keyId/);
  assert.throws(() => createCommittedReviewQaPreviewTransportVerifier({ ...dependencies, trustedKeys: [base, { ...base, keyId: "transport-key-alias" }] }), /public key alias/);
  let getterCalls = 0; const hostileOperations = ["verify"]; Object.defineProperty(hostileOperations, "0", { enumerable: true, get: () => { getterCalls += 1; return "verify"; } });
  assert.throws(() => createCommittedReviewQaPreviewTransportVerifier({ ...dependencies, trustedKeys: [{ ...base, publicJwk: { ...base.publicJwk, key_ops: hostileOperations } }] }), CommittedReviewQaPreviewTransportError);
  assert.equal(getterCalls, 0);
});

test("tenant, actor, reviewer, and exact session authentication remain bound at consume time", async () => {
  for (const [field, value] of [["tenantId", "tenant-b"], ["actorId", "actor-b"], ["reviewerId", "reviewer-b"], ["sessionId", "session-b"]]) {
    const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); h.state.actor[field] = value;
    await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("DENIED")); assert.equal(h.state.runtimeCalls.length, 0);
  }
  const h = await harness(); await assert.rejects(h.issuer.issue("wrong", REQUEST), transportError("UNAUTHENTICATED")); await assert.rejects(h.verifier.consume("wrong", {}), transportError("DENIED"));
});

test("exact not-before, expiry, and authenticated-session boundaries fail closed", async () => {
  { const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); h.state.now = "2029-08-22T23:59:59.999Z"; await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("DENIED")); }
  { const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); h.state.now = grant.expiresAt; await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("DENIED")); }
  { const h = await harness({ actor: { ...ACTOR, sessionExpiresAt: "2030-08-22T00:00:10.000Z" } }); const grant = await h.issuer.issue("opaque-session", REQUEST); assert.equal(grant.expiresAt, h.state.actor.sessionExpiresAt); h.state.now = grant.expiresAt; await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("DENIED")); }
  { const h = await harness({ eligibilityExpiry: NOW }); await assert.rejects(h.issuer.issue("opaque-session", REQUEST), transportError("DENIED")); }
});

test("atomic replay claim gives concurrent attempts one winner", async () => {
  const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST);
  const results = await Promise.allSettled([h.verifier.consume("opaque-session", structuredClone(grant)), h.verifier.consume("opaque-session", structuredClone(grant))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "REPLAYED").length, 1);
  assert.equal(h.state.runtimeCalls.length, 1);
});

test("post-issuance revoke, head/source/measurement denial, binding drift, review-horizon drift, and database outage burn before runtime", async () => {
  for (const condition of ["reviewer-revoked", "head-advanced", "source-drift", "measurement-drift", "database-unavailable"]) {
    const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); h.state.coreUseFailure = new Error(condition);
    await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("DENIED"));
    h.state.coreUseFailure = null; await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("REPLAYED")); assert.equal(h.state.runtimeCalls.length, 0);
  }
  const mutations = [
    (state) => { state.eligibilityDigests = { ...state.eligibilityDigests, reviewRowSha256: "9".repeat(64) }; },
    (state) => { state.eligibilityAssetVersion = 2; },
    (state) => { state.committedReviewValidUntil = "2030-08-22T00:09:59.999Z"; },
    (state) => { state.eligibilityExpiry = "2029-08-21T23:59:59.999Z"; },
  ];
  for (const mutate of mutations) {
    const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); mutate(h.state);
    await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("DENIED")); assert.equal(h.state.runtimeCalls.length, 0);
  }
});

test("grant burns before runtime await, failure, or post-claim cancellation", async () => {
  let executions = 0; const h = await harness({ runtime: { execute: async () => { executions += 1; throw new Error("private runtime detail"); } } }); const grant = await h.issuer.issue("opaque-session", REQUEST);
  await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("RUNTIME_UNAVAILABLE"));
  await assert.rejects(h.verifier.consume("opaque-session", grant), transportError("REPLAYED")); assert.equal(executions, 1);
  const controller = new AbortController(); const replayStore = { claim: async () => { controller.abort(); return true; } }; const cancelledHarness = await harness({ replayStore }); const cancelledGrant = await cancelledHarness.issuer.issue("opaque-session", REQUEST);
  await assert.rejects(cancelledHarness.verifier.consume("opaque-session", cancelledGrant, controller.signal), transportError("CANCELLED")); assert.equal(cancelledHarness.state.runtimeCalls.length, 0);
});

test("replay-store failure closes the current attempt before runtime, while malformed signer output cannot issue", async () => {
  const brokenStore = await harness({ replayStore: { claim: async () => { throw new Error("online store unavailable"); } } }); const grant = await brokenStore.issuer.issue("opaque-session", REQUEST);
  await assert.rejects(brokenStore.verifier.consume("opaque-session", grant), transportError("DENIED")); assert.equal(brokenStore.state.runtimeCalls.length, 0);
  const key = await keyFixture(); const state = { eligibilityExpiry: "2030-08-22T00:03:00.000Z", committedReviewValidUntil: "2030-08-22T00:10:00.000Z", eligibilityTenantId: TENANT, eligibilityAssetVersionId: "asset-a", eligibilityAssetVersion: 1, eligibilityDigests: { assetRowSha256: H.asset, bindingRowSha256: H.binding, reviewRowSha256: H.review, authorityRowSha256: H.authority }, coreIssueFailure: null, coreUseFailure: null, coreIssueCalls: 0, coreUseCalls: 0 };
  const issuer = createCommittedReviewQaPreviewTransportIssuer({ authenticate: async () => ACTOR, committedReview: committedReviewHarness(state), signer: { ...key.signer, sign: async () => new Uint8Array(63) }, audience: AUDIENCE, createGrantId: () => "a".repeat(64), now: async () => NOW });
  await assert.rejects(issuer.issue("opaque-session", REQUEST), transportError("SIGNER_UNAVAILABLE"));
});

test("issuer denies authentication drift across the committed-review recheck", async () => {
  const key = await keyFixture(); let authCalls = 0; const state = { eligibilityExpiry: "2030-08-22T00:03:00.000Z", committedReviewValidUntil: "2030-08-22T00:10:00.000Z", eligibilityTenantId: TENANT, eligibilityAssetVersionId: "asset-a", eligibilityAssetVersion: 1, eligibilityDigests: { assetRowSha256: H.asset, bindingRowSha256: H.binding, reviewRowSha256: H.review, authorityRowSha256: H.authority }, coreIssueFailure: null, coreUseFailure: null, coreIssueCalls: 0, coreUseCalls: 0 };
  const issuer = createCommittedReviewQaPreviewTransportIssuer({ authenticate: async () => ({ ...ACTOR, sessionId: ++authCalls === 1 ? "session-a" : "session-b" }), committedReview: committedReviewHarness(state), signer: key.signer, audience: AUDIENCE, createGrantId: () => "a".repeat(64), now: async () => NOW });
  await assert.rejects(issuer.issue("opaque-session", REQUEST), transportError("DENIED"));
});

test("unverified payload projection excludes signature and cannot admit a JSC-0218A receipt", async () => {
  const h = await harness(); const grant = await h.issuer.issue("opaque-session", REQUEST); const payload = unverifiedCommittedReviewQaPreviewTransportGrantPayload(grant);
  assert.equal("signatureBase64" in payload, false); assert.equal("receipt" in payload, false); assert.equal("disposition" in payload, false);
  await assert.rejects(h.issuer.issue("opaque-session", { ...REQUEST, receipt: { disposition: "inserted", committedAt: NOW } }), transportError("DENIED"));
  await assert.rejects(h.verifier.consume("opaque-session", { ...grant, receipt: { disposition: "inserted" } }), transportError("DENIED"));
});
