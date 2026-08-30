import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_CONTENT_TYPE,
  CommittedReviewQaPreviewHostError,
  CommittedReviewQaPreviewTransportError,
  createCommittedReviewQaPreviewBundleRuntimeAdapter,
  createCommittedReviewQaPreviewHostHandler,
  createCommittedReviewQaPreviewTransportIssuer,
  createCommittedReviewQaPreviewTransportVerifier,
  createFetchCommittedReviewQaPreviewPrivateArtifactSource,
  createInMemoryCommittedReviewQaPreviewReplayStore,
} from "../dist/packages/asset-review/src/index.js";
import { parseUnverifiedCommittedReviewQaPreviewBundle, parseUnverifiedCommittedReviewQaPreviewBundleContainer } from "../dist/packages/assets/src/index.js";
import { canonicalJson, sha256Hex, unverifiedCommittedReviewQaPreviewBundleEnvelopePayload } from "../dist/packages/contracts/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";

const H = (character) => character.repeat(64);
const NOW = "2030-08-22T00:00:00.000Z";
const COMPOSED = "2030-08-22T00:00:01.000Z";
const EXPIRES = "2030-08-22T00:00:30.000Z";
const AUDIENCE = "https://qa-preview.example";
const REQUEST = Object.freeze({ schemaVersion: 1, type: "jessica.committed-review-qa-preview-transport-request", requestId: H("a"), selection: { tenantId: "tenant-a", assetVersionId: "asset-a", assetVersion: 1 } });
const ACTOR = Object.freeze({ tenantId: "tenant-a", actorId: "actor-a", reviewerId: "reviewer-a", sessionId: "session-a", sessionExpiresAt: "2030-08-22T00:05:00.000Z", scopes: ["qa-preview:read"] });
const DIGESTS = Object.freeze({ assetRowSha256: H("1"), bindingRowSha256: H("2"), reviewRowSha256: H("3"), authorityRowSha256: H("4") });
const SOURCE_HASH = H("5");
const PREFIX = "https://private.example/tenant-a/";
const MANIFEST_URL = `${PREFIX}manifest.json`;
const MODEL_URL = `${PREFIX}model.glb`;
const runtimeError = (error) => error instanceof CommittedReviewQaPreviewTransportError && error.code === "RUNTIME_UNAVAILABLE";

async function keyFixture(authorityId, keyId) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    publicKey: pair.publicKey,
    publicJwk: { key_ops: ["verify"], ext: true, kty: "EC", x: exported.x, y: exported.y, crv: "P-256", use: "sig", alg: "ES256" },
    signer: Object.freeze({ algorithm: "ES256", authorityId, keyId, publicJwk: { key_ops: ["verify"], ext: true, kty: "EC", x: exported.x, y: exported.y, crv: "P-256", use: "sig", alg: "ES256" }, sign: async (payload) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, payload)) }),
  };
}

async function artifactFixture() {
  const input = JSON.parse(await readFile(new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url), "utf8"));
  const generated = await generateProxyBundle(input); const manifest = structuredClone(generated.manifest);
  manifest.assetId = "asset-a"; manifest.assetVersion = 1; manifest.fixture = false; manifest.model.url = "./model.glb"; manifest.sourceAssetHashes = [SOURCE_HASH];
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest)); const modelBytes = generated.glb.slice();
  const binding = Object.freeze({ tenantId: "tenant-a", assetVersionId: "asset-a", assetVersion: 1, frameModelId: "frame-model-a", frameVariantId: "frame-variant-a", generationJobId: "generation-a",
    quality: "premium", generationMethod: "manual", fixture: false, sourceSetSha256: H("6"), sourceAssetSha256s: Object.freeze([SOURCE_HASH]), attachmentMatrix: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    qualityEnvelope: Object.freeze({ maxYawDeg: 25, maxPitchDeg: 20, recommendedForLive: false, scaleConfidence: "high" }),
    manifest: Object.freeze({ privateLocator: MANIFEST_URL, sha256: await sha256Hex(manifestBytes), byteLength: manifestBytes.byteLength }),
    model: Object.freeze({ privateLocator: MODEL_URL, sha256: await sha256Hex(modelBytes), byteLength: modelBytes.byteLength }) });
  return { manifestBytes, modelBytes, binding };
}

function committedReview(binding) {
  const issued = new WeakSet();
  const eligibility = Object.freeze({ schemaVersion: 1, type: "jessica.committed-review-qa-preview-eligibility", expiresAt: "2030-08-22T00:03:00.000Z", committedReviewValidUntil: "2030-08-22T00:10:00.000Z",
    asset: Object.freeze({ tenantId: "tenant-a", assetVersionId: "asset-a", assetVersion: 1, frameModelId: "frame-model-a", frameVariantId: "frame-variant-a" }), digests: DIGESTS,
    authority: Object.freeze({ qaPreviewEligibility: true, qaPreviewRuntime: false, runtime: false, publicLive: false, recommendedForLive: false, catalogPublic: false, deployment: false, publication: false, commerce: false, G1: false, G2: false, G3: false, G4: false, G5: false, G6: false, G7: false }) });
  async function consume(capability) { if (!issued.delete(capability)) throw new Error("private core detail"); return Object.freeze({ eligibility, runtimeAsset: binding }); }
  return Object.freeze({ async issue() { const capability = Object.freeze({ opaque: true }); issued.add(capability); return capability; }, async use(_identity, capability) { return (await consume(capability)).eligibility; }, async useForRuntime(_identity, capability) { return consume(capability); } });
}

async function transportHarness(runtime, binding, existingTransportKey) {
  const transportKey = existingTransportKey ?? await keyFixture("transport-authority-a", "transport-key-a"); const core = committedReview(binding);
  const authenticate = async () => structuredClone(ACTOR);
  const issuer = createCommittedReviewQaPreviewTransportIssuer({ authenticate, committedReview: core, signer: transportKey.signer, audience: AUDIENCE, createGrantId: () => H("7"), now: async () => NOW });
  const verifier = createCommittedReviewQaPreviewTransportVerifier({ authenticate, committedReview: core, trustedKeys: [{ authorityId: transportKey.signer.authorityId, keyId: transportKey.signer.keyId, tenantId: "tenant-a", publicJwk: transportKey.publicJwk }], audience: AUDIENCE, replayStore: createInMemoryCommittedReviewQaPreviewReplayStore(), runtime, now: async () => NOW });
  return { issuer, verifier, transportKey };
}

function privateSource(fixture, calls, mutate = (value) => value) {
  return Object.freeze({ async readExact(request) { calls.push(structuredClone(request)); const source = request.privateLocator === MANIFEST_URL ? fixture.manifestBytes : request.privateLocator === MODEL_URL ? fixture.modelBytes : new Uint8Array(); return mutate(source.slice(), request); } });
}

test("fresh server binding composes one signed URL-free bundle with exact ordered artifact reads", async () => {
  const fixture = await artifactFixture(); const calls = []; const bundleKey = await keyFixture("bundle-authority-a", "bundle-key-a"); const transportKey = await keyFixture("transport-authority-a", "transport-key-a");
  const adapter = createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer: bundleKey.signer, disallowedTransportPublicJwks: [transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, calls) }], now: async () => COMPOSED });
  const h = await transportHarness(adapter, fixture.binding, transportKey); const grant = await h.issuer.issue("opaque-session", REQUEST); const bundle = await h.verifier.consume("opaque-session", grant);
  const parsed = await parseUnverifiedCommittedReviewQaPreviewBundle(bundle); const envelope = parsed.envelope;
  assert.deepEqual(calls.map((call) => [call.contentType, call.expectedByteLength, call.maximumByteLength]), [["application/json", fixture.manifestBytes.byteLength, 256 * 1024], ["model/gltf-binary", fixture.modelBytes.byteLength, 32 * 1024 * 1024]]);
  assert.equal(envelope.composedAt, COMPOSED); assert.equal(envelope.transportGrantSha256, await sha256Hex(new TextEncoder().encode(canonicalJson(grant))));
  assert.deepEqual(envelope.transport, (() => { const clone = structuredClone(grant); delete clone.signatureBase64; return clone; })());
  assert.deepEqual(envelope.runtimeAssetProjection.sourceAssetHashes, [SOURCE_HASH]); assert.equal(envelope.evidence.browserRuntimeUsable, false); assert.equal(envelope.evidence.publicLiveUsable, false);
  assert.equal(JSON.stringify(envelope).includes("private.example"), false); assert.equal(JSON.stringify(envelope).includes("privateLocator"), false);
  const verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, bundleKey.publicKey, Buffer.from(envelope.signatureBase64, "base64"), new TextEncoder().encode(canonicalJson(unverifiedCommittedReviewQaPreviewBundleEnvelopePayload(envelope))));
  assert.equal(verified, true);
});

test("runtime command identity is unforgeable and one-shot, and a transport authority cannot be reused as bundle authority", async () => {
  const fixture = await artifactFixture(); let captured; const capture = { execute: async (command) => { captured = command; return true; } };
  const h = await transportHarness(capture, fixture.binding); const grant = await h.issuer.issue("opaque-session", REQUEST); await h.verifier.consume("opaque-session", grant);
  const bundleKey = await keyFixture("bundle-authority-a", "bundle-key-a"); const calls = [];
  const adapter = createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer: bundleKey.signer, disallowedTransportPublicJwks: [h.transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, calls) }], now: async () => COMPOSED });
  await assert.rejects(adapter.execute(structuredClone(captured)), runtimeError); assert.equal(calls.length, 0);
  await adapter.execute(captured); assert.equal(calls.length, 2); await assert.rejects(adapter.execute(captured), runtimeError); assert.equal(calls.length, 2);

  let otherCommand; const other = await transportHarness({ execute: async (command) => { otherCommand = command; return true; } }, fixture.binding); await other.verifier.consume("opaque-session", await other.issuer.issue("opaque-session", REQUEST));
  const reusedAuthority = await keyFixture("transport-authority-a", "different-key"); const wrongAdapter = createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer: reusedAuthority.signer, disallowedTransportPublicJwks: [other.transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, []) }], now: async () => COMPOSED });
  await assert.rejects(wrongAdapter.execute(otherCommand), runtimeError);
  assert.throws(() => createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer: { ...h.transportKey.signer, authorityId: "bundle-alias", keyId: "bundle-alias-key" }, disallowedTransportPublicJwks: [h.transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, []) }], now: async () => COMPOSED }), /cryptographically distinct/);
});

test("hash/length/locator/source/signer/time failures disclose no private diagnostics and never return a bundle", async () => {
  const fixture = await artifactFixture();
  for (const scenario of [
    { mutate: (bytes, request) => request.contentType === "model/gltf-binary" ? Uint8Array.from(bytes, (value, index) => index === 0 ? value ^ 1 : value) : bytes },
    { binding: { ...fixture.binding, manifest: { ...fixture.binding.manifest, privateLocator: "https://other.example/secret.json" } } },
    { signerLength: 63 },
    { mismatchedSigner: true },
    { completedAt: EXPIRES },
  ]) {
    const bundleKey = await keyFixture("bundle-authority-a", "bundle-key-a"); const transportKey = await keyFixture("transport-authority-a", "transport-key-a"); let nowCalls = 0;
    const otherBundleKey = scenario.mismatchedSigner ? await keyFixture("other-bundle-authority", "other-bundle-key") : null;
    const signer = scenario.signerLength ? { ...bundleKey.signer, sign: async () => new Uint8Array(scenario.signerLength) } : scenario.mismatchedSigner ? { ...bundleKey.signer, sign: otherBundleKey.signer.sign } : bundleKey.signer;
    const adapter = createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer, disallowedTransportPublicJwks: [transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, [], scenario.mutate) }], now: async () => ++nowCalls === 1 ? COMPOSED : (scenario.completedAt ?? COMPOSED) });
    const h = await transportHarness(adapter, Object.freeze(scenario.binding ?? fixture.binding), transportKey); const grant = await h.issuer.issue("opaque-session", REQUEST);
    await assert.rejects(h.verifier.consume("opaque-session", grant), (error) => { assert.equal(JSON.stringify(error).includes("private"), false); return runtimeError(error); });
  }
});

test("abort observed after bundle signing returns cancellation, burns the grant, and emits no bundle", async () => {
  const fixture = await artifactFixture(); const controller = new AbortController(); const bundleKey = await keyFixture("bundle-authority-a", "bundle-key-a"); const transportKey = await keyFixture("transport-authority-a", "transport-key-a"); let signCalls = 0;
  const signer = { ...bundleKey.signer, sign: async (payload) => { signCalls += 1; const signature = await bundleKey.signer.sign(payload); controller.abort(); return signature; } };
  const adapter = createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer, disallowedTransportPublicJwks: [transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, []) }], now: async () => COMPOSED });
  const h = await transportHarness(adapter, fixture.binding, transportKey); const grant = await h.issuer.issue("opaque-session", REQUEST);
  await assert.rejects(h.verifier.consume("opaque-session", grant, controller.signal), (error) => error instanceof CommittedReviewQaPreviewTransportError && error.code === "CANCELLED"); assert.equal(signCalls, 1);
  await assert.rejects(h.verifier.consume("opaque-session", grant), (error) => error.code === "REPLAYED");
});

test("strict fetch source sends no credentials, rejects redirects/metadata drift, and bounds streaming bytes", async () => {
  const payload = new TextEncoder().encode("exact private bytes"); const observed = [];
  const response = (options = {}) => { const body = options.body ?? payload; const value = new Response(body, { status: options.status ?? 200, headers: { "content-type": options.contentType ?? "application/json", "content-length": options.contentLength ?? String(body.byteLength), ...(options.contentEncoding ? { "content-encoding": options.contentEncoding } : {}) } }); Object.defineProperty(value, "url", { value: options.url ?? MANIFEST_URL }); Object.defineProperty(value, "redirected", { value: options.redirected ?? false }); return value; };
  const source = createFetchCommittedReviewQaPreviewPrivateArtifactSource({ fetchFn: async (input, init) => { observed.push({ input, init }); return response(); } });
  const result = await source.readExact({ privateLocator: MANIFEST_URL, contentType: "application/json", expectedByteLength: payload.byteLength, maximumByteLength: 1024 }); assert.deepEqual(result, payload);
  assert.equal(observed[0].input, MANIFEST_URL); assert.equal(observed[0].init.credentials, "omit"); assert.equal(observed[0].init.redirect, "error"); assert.equal(observed[0].init.cache, "no-store"); assert.equal(observed[0].init.referrerPolicy, "no-referrer");
  for (const bad of [
    response({ url: MODEL_URL }), response({ redirected: true }), response({ contentType: "text/plain" }), response({ contentEncoding: "gzip" }), response({ contentLength: String(payload.byteLength + 1) }), response({ body: payload.slice(0, -1), contentLength: String(payload.byteLength) }),
  ]) {
    const badSource = createFetchCommittedReviewQaPreviewPrivateArtifactSource({ fetchFn: async () => bad });
    await assert.rejects(badSource.readExact({ privateLocator: MANIFEST_URL, contentType: "application/json", expectedByteLength: payload.byteLength, maximumByteLength: 1024 }), runtimeError);
  }
  let cancelled = false; const cancellableBody = new ReadableStream({ start(controller) { controller.enqueue(payload); }, cancel() { cancelled = true; } });
  const metadataDrift = response({ body: cancellableBody, contentType: "text/plain", contentLength: String(payload.byteLength) });
  const cancellingSource = createFetchCommittedReviewQaPreviewPrivateArtifactSource({ fetchFn: async () => metadataDrift });
  await assert.rejects(cancellingSource.readExact({ privateLocator: MANIFEST_URL, contentType: "application/json", expectedByteLength: payload.byteLength, maximumByteLength: 1024 }), runtimeError); assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort(); let fetchCalls = 0; const abortedSource = createFetchCommittedReviewQaPreviewPrivateArtifactSource({ fetchFn: async () => { fetchCalls += 1; return response(); } });
  await assert.rejects(abortedSource.readExact({ privateLocator: MANIFEST_URL, contentType: "application/json", expectedByteLength: payload.byteLength, maximumByteLength: 1024 }, controller.signal), (error) => error.code === "CANCELLED"); assert.equal(fetchCalls, 0);
  let fetchResolveCancelled = false; const fetchResolveController = new AbortController(); const fetchResolveBody = new ReadableStream({ start(stream) { stream.enqueue(payload); }, cancel() { fetchResolveCancelled = true; } });
  const fetchResolveResponse = response({ body: fetchResolveBody, contentLength: String(payload.byteLength) });
  const fetchResolveSource = createFetchCommittedReviewQaPreviewPrivateArtifactSource({ fetchFn: async () => { fetchResolveController.abort(); return fetchResolveResponse; } });
  await assert.rejects(fetchResolveSource.readExact({ privateLocator: MANIFEST_URL, contentType: "application/json", expectedByteLength: payload.byteLength, maximumByteLength: 1024 }, fetchResolveController.signal), (error) => error.code === "CANCELLED"); assert.equal(fetchResolveCancelled, true);
});

test("one-POST host wrapper parses the exact request, calls issue/consume once, and emits fixed no-store headers", async () => {
  const fixture = await artifactFixture(); const bundleKey = await keyFixture("bundle-authority-a", "bundle-key-a"); const transportKey = await keyFixture("transport-authority-a", "transport-key-a"); const adapter = createCommittedReviewQaPreviewBundleRuntimeAdapter({ signer: bundleKey.signer, disallowedTransportPublicJwks: [transportKey.publicJwk], privateSources: [{ locatorPrefix: PREFIX, source: privateSource(fixture, []) }], now: async () => COMPOSED });
  const h = await transportHarness(adapter, fixture.binding, transportKey); let issueCalls = 0; let consumeCalls = 0;
  const handler = createCommittedReviewQaPreviewHostHandler({ issuer: { issue: async (...args) => { issueCalls += 1; return h.issuer.issue(...args); } }, verifier: { consume: async (...args) => { consumeCalls += 1; return h.verifier.consume(...args); } } });
  const response = await handler.handle("opaque-session", structuredClone(REQUEST)); assert.equal(response.status, 200); assert.equal(issueCalls, 1); assert.equal(consumeCalls, 1);
  assert.deepEqual(response.headers, { "Content-Type": COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_CONTENT_TYPE, "Content-Length": String(response.body.byteLength), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-origin" });
  assert.equal("Content-Encoding" in response.headers, false); parseUnverifiedCommittedReviewQaPreviewBundleContainer(response.body);
  await assert.rejects(handler.handle("opaque-session", { ...REQUEST, csrfToken: "secret" }), (error) => error instanceof CommittedReviewQaPreviewHostError && error.code === "UNAVAILABLE"); assert.equal(issueCalls, 1); assert.equal(consumeCalls, 1);
  const failed = createCommittedReviewQaPreviewHostHandler({ issuer: { issue: async () => { throw new Error(`private locator ${MANIFEST_URL}`); } }, verifier: { consume: async () => { throw new Error("must not run"); } } });
  await assert.rejects(failed.handle("opaque-session", REQUEST), (error) => error instanceof CommittedReviewQaPreviewHostError && error.code === "UNAVAILABLE" && !JSON.stringify(error).includes("private"));

  let releaseIssue; let postDeadlineConsumes = 0;
  const stuckIssue = createCommittedReviewQaPreviewHostHandler({ maximumOperationAgeMs: 1, issuer: { issue: async () => new Promise((resolve) => { releaseIssue = resolve; }) }, verifier: { consume: async () => { postDeadlineConsumes += 1; return response.body; } } });
  await assert.rejects(stuckIssue.handle("opaque-session", REQUEST), (error) => error instanceof CommittedReviewQaPreviewHostError && error.code === "UNAVAILABLE"); releaseIssue({}); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(postDeadlineConsumes, 0);
  let releaseConsume;
  const stuckConsume = createCommittedReviewQaPreviewHostHandler({ maximumOperationAgeMs: 1, issuer: { issue: async () => ({ opaque: true }) }, verifier: { consume: async () => new Promise((resolve) => { releaseConsume = resolve; }) } });
  await assert.rejects(stuckConsume.handle("opaque-session", REQUEST), (error) => error instanceof CommittedReviewQaPreviewHostError && error.code === "UNAVAILABLE"); releaseConsume(response.body); await new Promise((resolve) => setTimeout(resolve, 5));
  let blockedConsumes = 0;
  const eventLoopBlockingIssue = createCommittedReviewQaPreviewHostHandler({ maximumOperationAgeMs: 1, issuer: { issue: async () => { const end = performance.now() + 20; while (performance.now() < end) { /* deliberately starve the timer */ } return {}; } }, verifier: { consume: async () => { blockedConsumes += 1; return response.body; } } });
  await assert.rejects(eventLoopBlockingIssue.handle("opaque-session", REQUEST), (error) => error instanceof CommittedReviewQaPreviewHostError && error.code === "UNAVAILABLE"); assert.equal(blockedConsumes, 0);
});
