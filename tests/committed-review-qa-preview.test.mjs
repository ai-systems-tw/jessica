import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCommittedReviewQaPreviewService, CommittedReviewQaPreviewError } from "../dist/packages/asset-review/src/index.js";
import { loadVerifiedRuntimeAsset } from "../dist/apps/try-on-web/src/runtimeCatalog.js";

const H = Object.freeze({ asset: "1".repeat(64), binding: "2".repeat(64), review: "3".repeat(64), authority: "4".repeat(64), head: "5".repeat(64), sourceSet: "6".repeat(64), source: "7".repeat(64), measurement: "8".repeat(64), matrix: "a".repeat(64), envelope: "b".repeat(64), decision: "c".repeat(64), fingerprint: "d".repeat(64) });
const catalogUrl = "https://catalog.example/runtime/qa/catalog.json";
const manifestUrl = "https://catalog.example/runtime/assets/calibration-frame.json";
const modelUrl = "https://catalog.example/runtime/assets/calibration-frame.glb";
const observedAt = "2030-08-22T00:00:00.000Z";
const effectiveValidUntil = "2030-08-22T00:10:00.000Z";
const sessionExpiresAt = "2030-08-22T00:08:00.000Z";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encoded = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

async function qaChain() {
  const catalog = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/fixtures/self-test-catalog.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.json", import.meta.url), "utf8"));
  const glb = Buffer.from(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.glb", import.meta.url)));
  manifest.fixture = false; manifest.sourceAssetHashes = [H.source];
  const manifestBytes = encoded(manifest); const asset = catalog.entries[0].asset;
  catalog.tenantId = "tenant-a"; catalog.entries[0].tenantId = "tenant-a"; catalog.entries[0].model.tenantId = "tenant-a"; catalog.entries[0].variant.tenantId = "tenant-a"; asset.tenantId = "tenant-a";
  asset.status = "approved"; asset.quality = "standard"; asset.sourceAssetHashes = [H.source]; asset.qualityEnvelope.recommendedForLive = false; asset.manifestSha256 = hash(manifestBytes);
  const catalogBytes = encoded(catalog);
  return { glb, catalogBytes, manifestBytes, asset, entry: catalog.entries[0] };
}

function authoritativeSnapshot(chain) {
  return {
    schemaVersion: 1,
    asset: { tenantId: "tenant-a", id: chain.asset.id, version: chain.asset.version, frameModelId: chain.entry.model.id, frameVariantId: chain.entry.variant.id, generationJobId: "job-a", status: "approved", fixtureStatus: "unverified", admission: "internal-review-only", rightsScope: "internal-review-only", recommendedForLive: false, publicationEligible: false, rowSha256: H.asset, quality: "standard", generationMethod: "standard-auto", reviewStatus: "approved", nonProxyInternalReview: true, promotable: false, sourceSetSha256: H.sourceSet, attachmentMatrixSha256: H.matrix, qualityEnvelopeSha256: H.envelope, manifestUrl, manifestSha256: hash(chain.manifestBytes), manifestByteLength: chain.manifestBytes.length, modelUrl, modelSha256: hash(chain.glb), modelByteLength: chain.glb.length },
    binding: { assetVersionId: chain.asset.id, reviewRecordId: "review-a", tenantId: "tenant-a", frameModelId: chain.entry.model.id, frameVariantId: chain.entry.variant.id, generationJobId: "job-a", sourceSetSha256: H.sourceSet, effectiveValidUntil, rightsScope: "internal-review-only", recommendedForLive: false, publicationEligible: false, rowSha256: H.binding, assetVersionRowSha256: H.asset, decisionPayloadSha256: H.decision, qualityEnvelopeSha256: H.envelope },
    review: { id: "review-a", tenantId: "tenant-a", decision: "approve", terminal: true, reviewerAuthorityRowId: "authority-row-a", reviewerAuthorityId: "authority-a", reviewerId: "reviewer-a", reviewerKeyId: "reviewer-key-a", reviewerPublicKeyFingerprintSha256: H.fingerprint, generationJobId: "job-a", frameModelId: chain.entry.model.id, frameVariantId: chain.entry.variant.id, reviewHeadEventSha256: H.head, sourceSetSha256: H.sourceSet, candidateAssetVersionId: chain.asset.id, candidateVersion: chain.asset.version, outputManifestSha256: hash(chain.manifestBytes), outputManifestByteLength: chain.manifestBytes.length, outputModelSha256: hash(chain.glb), outputModelByteLength: chain.glb.length, sourceAssetSha256s: [H.source], measurementSetId: "measurement-a", measurementSetSha256: H.measurement, specimenId: "specimen-a", effectiveValidUntil, rightsScope: "internal-review-only", rowSha256: H.review, decisionPayloadSha256: H.decision, approvedAssetVersionRowSha256: H.asset, approvedQualityEnvelopeSha256: H.envelope },
    reviewerAuthority: { id: "authority-row-a", tenantId: "tenant-a", authorityId: "authority-a", reviewerId: "reviewer-a", status: "active", scope: "non-proxy-human-qa-decision", revokedAt: null, rowSha256: H.authority, keyId: "reviewer-key-a", publicKeyFingerprintSha256: H.fingerprint },
    generationJob: { id: "job-a", tenantId: "tenant-a", frameModelId: chain.entry.model.id, currentHeadEventSha256: H.head, currentHeadEventType: "output-recorded", currentOutputAssetVersionId: chain.asset.id, currentOutputAssetVersion: chain.asset.version, currentOutputManifestSha256: hash(chain.manifestBytes), currentOutputModelSha256: hash(chain.glb), currentOutputManifestByteLength: chain.manifestBytes.length, currentOutputModelByteLength: chain.glb.length, sourceSetSha256: H.sourceSet, sourceAssetSha256s: [H.source], measurementSetSha256: H.measurement },
    measurementSet: { id: "measurement-a", tenantId: "tenant-a", frameModelId: chain.entry.model.id, specimenId: "specimen-a", sha256: H.measurement, status: "verified" },
    variant: { id: chain.entry.variant.id, tenantId: "tenant-a", frameModelId: chain.entry.model.id }, assetSourceSha256s: [H.source],
  };
}

function harness(chain) {
  const state = { now: observedAt, finalNow: observedAt, snapshot: authoritativeSnapshot(chain), reads: 0, tailAbort: null, auth: { tenantId: "tenant-a", actorId: "actor-a", reviewerId: "reviewer-a", sessionId: "session-a", sessionExpiresAt, scopes: ["qa-preview:read"] } };
  const database = { readonly: async (selection, work) => { assert.deepEqual(selection, { tenantId: "tenant-a", assetVersionId: chain.asset.id, assetVersion: chain.asset.version }); state.reads += 1; const result = await work({ transactionTimestamp: async () => state.now, readAuthoritativeSnapshot: async () => structuredClone(state.snapshot), finalRecheck: async () => ({ snapshot: structuredClone(state.snapshot), clockTimestamp: state.finalNow }) }); state.tailAbort?.abort(); return result; } };
  const service = createCommittedReviewQaPreviewService({ authenticate: async (identity) => identity === "session-token" ? structuredClone(state.auth) : null, database, maximumCapabilityAgeMs: 300_000 });
  return { state, service, selection: { tenantId: "tenant-a", assetVersionId: chain.asset.id, assetVersion: chain.asset.version } };
}

test("issue/use independently recheck DB and return diagnostic-only eligibility", async () => {
  const chain = await qaChain(); const h = harness(chain); const cap = await h.service.issue("session-token", h.selection);
  assert.equal(cap.expiresAt, "2030-08-22T00:05:00.000Z"); assert.equal(Object.isFrozen(cap), true); assert.equal(h.state.reads, 1);
  const eligibility = await h.service.use("session-token", cap); assert.equal(h.state.reads, 2);
  assert.equal(eligibility.digests.assetRowSha256, H.asset); assert.deepEqual(eligibility.authority, { qaPreviewEligibility: true, qaPreviewRuntime: false, runtime: false, publicLive: false, recommendedForLive: false, catalogPublic: false, deployment: false, publication: false, commerce: false, G1: false, G2: false, G3: false, G4: false, G5: false, G6: false, G7: false });
  assert.equal(Object.isFrozen(eligibility), true); assert.equal(Object.isFrozen(eligibility.digests), true);
});

test("generic qa-preview, receipts, clones, and replay fail before network authority", async () => {
  const chain = await qaChain(); const h = harness(chain); const requested = [];
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "qa-preview", fetchFn: async (input) => { requested.push(String(input)); return new Response("forbidden"); } }), /authenticated transport/);
  await assert.rejects(h.service.use("session-token", { disposition: "inserted", authority: { qaPreview: false } }), (error) => error instanceof CommittedReviewQaPreviewError && error.code === "DENIED");
  const cap = await h.service.issue("session-token", h.selection); await assert.rejects(h.service.use("session-token", structuredClone(cap)), (error) => error.code === "DENIED");
  await h.service.use("session-token", cap); await assert.rejects(h.service.use("session-token", cap), (error) => error.code === "DENIED"); assert.deepEqual(requested, []);
});

test("authority revoke, head advance, binding/specimen/source drift, expiry, session swap, and cross-tenant auth deny", async () => {
  const mutations = [
    (s) => { s.reviewerAuthority.status = "revoked"; s.reviewerAuthority.revokedAt = observedAt; }, (s) => { s.generationJob.currentHeadEventSha256 = "9".repeat(64); },
    (s) => { s.binding.assetVersionId = "other-asset"; }, (s) => { s.measurementSet.specimenId = "other-specimen"; }, (s) => { s.assetSourceSha256s = ["9".repeat(64)]; },
  ];
  for (const mutate of mutations) { const h = harness(await qaChain()); const cap = await h.service.issue("session-token", h.selection); mutate(h.state.snapshot); await assert.rejects(h.service.use("session-token", cap), (error) => error.code === "DENIED"); }
  { const h = harness(await qaChain()); const cap = await h.service.issue("session-token", h.selection); h.state.now = cap.expiresAt; h.state.finalNow = cap.expiresAt; await assert.rejects(h.service.use("session-token", cap), (error) => error.code === "DENIED"); }
  { const h = harness(await qaChain()); const cap = await h.service.issue("session-token", h.selection); h.state.auth.sessionId = "session-b"; await assert.rejects(h.service.use("session-token", cap), (error) => error.code === "DENIED"); }
  { const h = harness(await qaChain()); const cap = await h.service.issue("session-token", h.selection); h.state.auth.sessionExpiresAt = "2030-08-22T00:04:00.000Z"; h.state.now = "2030-08-22T00:03:59.999Z"; h.state.finalNow = h.state.now; const result = await h.service.use("session-token", cap); assert.equal(result.expiresAt, h.state.auth.sessionExpiresAt); assert.equal(result.authority.runtime, false); }
  { const h = harness(await qaChain()); const cap = await h.service.issue("session-token", h.selection); h.state.auth.sessionExpiresAt = "2030-08-22T00:04:00.000Z"; h.state.now = h.state.auth.sessionExpiresAt; h.state.finalNow = h.state.now; await assert.rejects(h.service.use("session-token", cap), (error) => error.code === "DENIED"); }
  { const h = harness(await qaChain()); h.state.auth.tenantId = "tenant-b"; await assert.rejects(h.service.issue("session-token", h.selection), (error) => error.code === "DENIED"); }
});

test("capability burns before await, is one-service-only, and has one concurrent winner", async () => {
  const chain = await qaChain(); const h = harness(chain); const cap = await h.service.issue("session-token", h.selection);
  const results = await Promise.allSettled([h.service.use("session-token", cap), h.service.use("session-token", cap)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "DENIED").length, 1);
  const issuer = harness(chain); const other = harness(chain); const foreignCap = await issuer.service.issue("session-token", issuer.selection);
  await assert.rejects(other.service.use("session-token", foreignCap), (error) => error.code === "DENIED"); await issuer.service.use("session-token", foreignCap);
});

test("final DB clock at the exact review boundary denies issuance", async () => {
  const h = harness(await qaChain()); h.state.now = "2030-08-22T00:09:59.999Z"; h.state.finalNow = effectiveValidUntil;
  await assert.rejects(h.service.issue("session-token", h.selection), (error) => error.code === "DENIED");
});

test("provider tail cancellation rejects issue and use, and use remains burned", async () => {
  { const h = harness(await qaChain()); const controller = new AbortController(); h.state.tailAbort = controller; await assert.rejects(h.service.issue("session-token", h.selection, controller.signal), (error) => error.code === "CANCELLED"); }
  { const h = harness(await qaChain()); const cap = await h.service.issue("session-token", h.selection); const controller = new AbortController(); h.state.tailAbort = controller; await assert.rejects(h.service.use("session-token", cap, controller.signal), (error) => error.code === "CANCELLED"); h.state.tailAbort = null; await assert.rejects(h.service.use("session-token", cap), (error) => error.code === "DENIED"); }
});

test("hostile input/auth/database and undefined rejection never become success", async () => {
  const chain = await qaChain(); const h = harness(chain);
  for (const candidate of [null, { ...h.selection, receipt: {} }, Object.create({ tenantId: "tenant-a" })]) await assert.rejects(h.service.issue("session-token", candidate), (error) => error.code === "DENIED");
  await assert.rejects(h.service.issue("wrong", h.selection), (error) => error.code === "UNAUTHENTICATED");
  const broken = createCommittedReviewQaPreviewService({ authenticate: async () => h.state.auth, database: { readonly: async () => Promise.reject(undefined) } });
  await assert.rejects(broken.issue("session-token", h.selection), (error) => error instanceof CommittedReviewQaPreviewError && error.code === "DATABASE_UNAVAILABLE");
});
