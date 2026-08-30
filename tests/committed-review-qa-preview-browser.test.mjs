import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE,
  CommittedReviewQaPreviewBrowserError,
  consumeCommittedReviewQaPreviewRuntimeHandle,
  loadCommittedReviewQaPreviewRuntimeHandle,
} from "../dist/apps/try-on-web/src/committedReviewQaPreviewBrowser.js";
import { commerceProductAttributionFromVerifiedRuntimeAsset } from "../dist/apps/try-on-web/src/commerceAttribution.js";
import { verifiedPublicLiveAssetProof } from "../dist/apps/try-on-web/src/runtimeCatalog.js";
import { composeUnverifiedCommittedReviewQaPreviewBundle } from "../dist/packages/assets/src/index.js";
import { canonicalJson, sha256Hex, unverifiedCommittedReviewQaPreviewBundleEnvelopePayload } from "../dist/packages/contracts/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";

const NOW = Date.parse("2030-08-22T00:00:10.000Z");
const AUDIENCE = "https://qa-preview.example";
const ENDPOINT = `${AUDIENCE}/internal/qa-preview/runtime`;
const SELECTION = Object.freeze({ tenantId: "tenant-a", assetVersionId: "asset-a", assetVersion: 1 });
const H = (character) => character.repeat(64);
const proxyInputUrl = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);
const errorCode = (code) => (error) => error instanceof CommittedReviewQaPreviewBrowserError && error.code === code;

async function settleWithin(promise, milliseconds = 150) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: "timeout" }), milliseconds); });
  try {
    return await Promise.race([
      promise.then((value) => ({ status: "fulfilled", value }), (error) => ({ status: "rejected", error })),
      timeout,
    ]);
  } finally { clearTimeout(timer); }
}

async function setup() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = { ...exported, use: "sig", alg: "ES256" };
  const generated = await generateProxyBundle(JSON.parse(await readFile(proxyInputUrl, "utf8")));
  const manifest = structuredClone(generated.manifest);
  manifest.assetId = "asset-a"; manifest.assetVersion = 1; manifest.fixture = false; manifest.model.url = "./model.glb"; manifest.sourceAssetHashes = [H("a")];
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const projection = {
    id: "asset-a", tenantId: "tenant-a", frameModelId: "frame-model-a", frameVariantId: "frame-variant-a", version: 1,
    quality: "standard", generationMethod: "standard-auto", status: "approved", fixture: false,
    sourceAssetHashes: [H("a")], attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    qualityEnvelope: { maxYawDeg: 30, maxPitchDeg: 20, recommendedForLive: false, scaleConfidence: "high" },
  };
  const trust = [{ authorityId: "bundle-authority-a", keyId: "bundle-key-a", tenantId: "tenant-a", notBefore: "2029-01-01T00:00:00.000Z", notAfter: "2031-01-01T00:00:00.000Z", publicJwk }];

  async function bundleFor(request, mutate = (value) => value, signer = pair.privateKey) {
    const transport = {
      schemaVersion: 1, type: "jessica.committed-review-qa-preview-unverified-grant", algorithm: "ES256", scope: "qa-preview:runtime:one-shot",
      issuerAuthorityId: "transport-authority-a", keyId: "transport-key-a", grantId: H("1"), requestId: request.requestId, audience: AUDIENCE,
      tenantId: "tenant-a", actorId: "actor-a", reviewerId: "reviewer-a", sessionId: "session-a", selection: structuredClone(request.selection),
      commitment: { assetRowSha256: H("3"), bindingRowSha256: H("4"), reviewRowSha256: H("5"), authorityRowSha256: H("6") },
      committedReviewValidUntil: "2030-08-22T00:01:00.000Z", issuedAt: "2030-08-22T00:00:00.000Z", notBefore: "2030-08-22T00:00:00.000Z", expiresAt: "2030-08-22T00:00:30.000Z",
      evidence: { kind: "committed-review-binding", verification: "required", runtimeUsable: false, publicLiveUsable: false },
    };
    let envelope = {
      schemaVersion: 1, type: "jessica.committed-review-qa-preview-unverified-bundle-envelope", algorithm: "ES256", scope: "qa-preview:runtime:one-shot",
      bundleSignerAuthorityId: "bundle-authority-a", bundleSignerKeyId: "bundle-key-a", composedAt: "2030-08-22T00:00:09.000Z", transportGrantSha256: H("f"), transport,
      runtimeAssetProjection: structuredClone(projection),
      manifest: { contentType: "application/json", sha256: await sha256Hex(manifestBytes), byteLength: manifestBytes.byteLength },
      model: { contentType: "model/gltf-binary", sha256: await sha256Hex(generated.glb), byteLength: generated.glb.byteLength },
      evidence: { verification: "required", artifactContainerOnly: true, browserRuntimeUsable: false, publicLiveUsable: false },
      signatureBase64: Buffer.alloc(64).toString("base64"),
    };
    envelope = mutate(structuredClone(envelope));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, new TextEncoder().encode(canonicalJson(unverifiedCommittedReviewQaPreviewBundleEnvelopePayload(envelope)))));
    envelope.signatureBase64 = Buffer.from(signature).toString("base64");
    return composeUnverifiedCommittedReviewQaPreviewBundle(envelope, manifestBytes, generated.glb);
  }

  function response(bytes, headers = {}) {
    const candidate = new Response(bytes, { status: 200, headers: {
      "content-type": COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-disposition": "inline",
      "cross-origin-resource-policy": "same-origin",
      ...headers,
    } });
    Object.defineProperty(candidate, "url", { value: ENDPOINT });
    return candidate;
  }

  async function load(overrides = {}) {
    const requests = [];
    const fetchFn = overrides.fetchFn ?? (async (url, init) => {
      const request = JSON.parse(init.body); requests.push({ url: String(url), init, request });
      return response(await bundleFor(request, overrides.mutateEnvelope, overrides.signer));
    });
    const handle = await loadCommittedReviewQaPreviewRuntimeHandle({ endpoint: ENDPOINT, audience: AUDIENCE, selection: SELECTION, trustedKeys: trust, csrfToken: "csrf-token-is-not-a-cookie", fetchFn, nowEpochMs: () => NOW, ...overrides.options });
    return { handle, requests };
  }
  return { pair, trust, bundleFor, response, load };
}

test("one same-origin authenticated POST yields only an opaque private one-shot handle", async () => {
  const h = await setup(); const { handle, requests } = await h.load();
  assert.equal(requests.length, 1); const request = requests[0];
  assert.equal(request.url, ENDPOINT); assert.equal(request.init.method, "POST");
  assert.equal(request.init.credentials, "same-origin"); assert.equal(request.init.redirect, "error"); assert.equal(request.init.cache, "no-store"); assert.equal(request.init.referrerPolicy, "no-referrer");
  assert.equal(request.init.headers.accept, COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE); assert.equal(request.init.headers["content-type"], "application/json");
  assert.deepEqual(Object.keys(request.request).sort(), ["requestId", "schemaVersion", "selection", "type"]); assert.match(request.request.requestId, /^[a-f0-9]{64}$/); assert.deepEqual(request.request.selection, SELECTION);
  assert.deepEqual(handle, { schemaVersion: 1, type: "jessica.committed-review-qa-preview-runtime-handle" }); assert.equal(Object.isFrozen(handle), true);
  assert.equal(JSON.stringify(handle).includes("model"), false); assert.equal(verifiedPublicLiveAssetProof(handle), null); assert.equal(commerceProductAttributionFromVerifiedRuntimeAsset(handle), null);

  let initializedAsset; let disposed = 0;
  const lifecycle = new AbortController();
  const runtime = await consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, signal: lifecycle.signal, nowEpochMs: () => NOW, createRuntime: () => ({ async initialize(_canvas, asset) { initializedAsset = asset; }, async dispose() { disposed += 1; } }) });
  assert.ok(runtime); assert.equal(initializedAsset.asset.status, "approved"); assert.equal(initializedAsset.asset.qualityEnvelope.recommendedForLive, false);
  assert.equal(initializedAsset.asset.modelUrl, "qa-preview-bundle:/model.glb"); assert.equal(initializedAsset.verifiedGlb.sha256.length, 64);
  assert.equal(verifiedPublicLiveAssetProof(initializedAsset), null); assert.equal(commerceProductAttributionFromVerifiedRuntimeAsset(initializedAsset), null);
  const first = new Uint8Array(initializedAsset.verifiedGlb.bytes); const original = first[0]; first[0] ^= 0xff; assert.equal(new Uint8Array(initializedAsset.verifiedGlb.bytes)[0], original);
  lifecycle.abort(); await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(disposed, 1);
  await assert.rejects(consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, createRuntime: () => runtime }), errorCode("DENIED"));
  await assert.rejects(consumeCommittedReviewQaPreviewRuntimeHandle({ handle: structuredClone(handle), canvas: {}, createRuntime: () => runtime }), errorCode("DENIED"));
});

test("handle burn is synchronous, so clone, replay, and concurrent consume have no authority", async () => {
  const h = await setup(); const { handle } = await h.load(); let release; let disposed = 0;
  const initialized = new Promise((resolve) => { release = resolve; }); const controller = new AbortController();
  const first = consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, signal: controller.signal, nowEpochMs: () => NOW, createRuntime: () => ({ initialize: () => initialized, async dispose() { disposed += 1; } }) });
  await assert.rejects(consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, createRuntime: () => ({ async initialize() {}, async dispose() {} }) }), errorCode("DENIED"));
  await assert.rejects(consumeCommittedReviewQaPreviewRuntimeHandle({ handle: structuredClone(handle), canvas: {}, createRuntime: () => ({ async initialize() {}, async dispose() {} }) }), errorCode("DENIED"));
  release(); await first; controller.abort(); await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(disposed, 1);
});

test("bundle signature, request binding, audience, key identity/window, and signed time all fail closed", async () => {
  const h = await setup();
  const otherPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  await assert.rejects(h.load({ signer: otherPair.privateKey }), errorCode("DENIED"));
  await assert.rejects(h.load({ mutateEnvelope: (value) => { value.transport.requestId = H("e"); return value; } }), errorCode("DENIED"));
  await assert.rejects(h.load({ mutateEnvelope: (value) => { value.transport.audience = "https://other.example"; return value; } }), errorCode("DENIED"));
  await assert.rejects(h.load({ mutateEnvelope: (value) => { value.bundleSignerKeyId = "unknown-key"; return value; } }), errorCode("DENIED"));
  await assert.rejects(h.load({
    mutateEnvelope: (value) => { value.bundleSignerAuthorityId = "transport-authority-a"; return value; },
    options: { trustedKeys: [{ ...h.trust[0], authorityId: "transport-authority-a" }] },
  }), errorCode("DENIED"));
  await assert.rejects(h.load({ options: { trustedKeys: [{ ...h.trust[0], notBefore: "2030-08-22T00:00:09.001Z" }] } }), errorCode("DENIED"));
  await assert.rejects(h.load({ options: { nowEpochMs: () => Date.parse("2030-08-22T00:00:30.000Z") } }), errorCode("DENIED"));
});

test("exact MIME/security headers, content length, same-origin endpoint, and bounded streamed bytes are mandatory", async () => {
  const h = await setup();
  for (const headers of [
    { "content-type": `${COMMITTED_REVIEW_QA_PREVIEW_RUNTIME_BUNDLE_MEDIA_TYPE}; charset=utf-8` },
    { "content-length": null },
    { "cache-control": "no-store" },
    { "cross-origin-resource-policy": "cross-origin" },
    { "content-encoding": "gzip" },
  ]) {
    await assert.rejects(h.load({ fetchFn: async (_url, init) => { const bytes = await h.bundleFor(JSON.parse(init.body)); const response = h.response(bytes); for (const [key, value] of Object.entries(headers)) value === null ? response.headers.delete(key) : response.headers.set(key, value); return response; } }), errorCode("DENIED"));
  }
  await assert.rejects(loadCommittedReviewQaPreviewRuntimeHandle({ endpoint: "https://other.example/runtime", audience: AUDIENCE, selection: SELECTION, trustedKeys: h.trust, csrfToken: "csrf-token-is-not-a-cookie" }), /same-origin/);
  await assert.rejects(h.load({ fetchFn: async (_url, init) => {
    const bytes = await h.bundleFor(JSON.parse(init.body)); const valid = h.response(bytes);
    return new Response(bytes, { status: 200, headers: valid.headers });
  } }), errorCode("DENIED"));
  for (const status of [201, 206]) {
    await assert.rejects(h.load({ fetchFn: async (_url, init) => {
      const bytes = await h.bundleFor(JSON.parse(init.body)); const valid = h.response(bytes);
      const response = new Response(bytes, { status, headers: valid.headers });
      Object.defineProperty(response, "url", { value: ENDPOINT });
      return response;
    } }), errorCode("DENIED"));
  }
  await assert.rejects(h.load({ fetchFn: async (_url, init) => { const bytes = await h.bundleFor(JSON.parse(init.body)); return h.response(bytes, { "content-length": String(40 * 1024 * 1024) }); } }), errorCode("DENIED"));
});

test("cancellation and initialization deadline dispose the candidate and never restore the handle", async () => {
  const h = await setup();
  {
    const { handle } = await h.load(); const controller = new AbortController(); let disposed = 0;
    const pending = consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, signal: controller.signal, nowEpochMs: () => NOW, createRuntime: () => ({ initialize: () => new Promise(() => {}), async dispose() { disposed += 1; } }) });
    controller.abort(); await assert.rejects(pending, errorCode("CANCELLED")); assert.equal(disposed, 1);
    await assert.rejects(consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, createRuntime: () => ({ async initialize() {}, async dispose() {} }) }), errorCode("DENIED"));
  }
  {
    const { handle } = await h.load(); let disposed = 0;
    const result = await settleWithin(consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, initializationTimeoutMs: 1, nowEpochMs: () => NOW, createRuntime: () => ({ initialize: () => new Promise(() => {}), async dispose() { disposed += 1; return new Promise(() => {}); } }) }));
    assert.equal(result.status, "rejected"); assert.equal(errorCode("EXPIRED")(result.error), true);
    assert.equal(disposed, 1);
  }
});

test("owned deadline settles despite an uncooperative fetch and aborts its losing work", async () => {
  const h = await setup(); let fetchSignal;
  const result = await settleWithin(h.load({
    fetchFn: async (_url, init) => { fetchSignal = init.signal; return new Promise(() => {}); },
    options: { maximumOperationAgeMs: 5 },
  }));
  assert.equal(result.status, "rejected"); assert.equal(errorCode("EXPIRED")(result.error), true);
  assert.equal(fetchSignal.aborted, true);
});

test("owned deadline settles and starts cancellation despite an uncooperative response stream", async () => {
  const h = await setup(); let cancelled = 0;
  const result = await settleWithin(h.load({
    fetchFn: async () => {
      const headers = h.response(new Uint8Array([0])).headers;
      const body = new ReadableStream({
        pull: () => new Promise(() => {}),
        cancel() { cancelled += 1; },
      });
      const response = new Response(body, { status: 200, headers });
      Object.defineProperty(response, "url", { value: ENDPOINT });
      return response;
    },
    options: { maximumOperationAgeMs: 5 },
  }));
  assert.equal(result.status, "rejected"); assert.equal(errorCode("EXPIRED")(result.error), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, 1);
});

test("an unused held handle loses its private byte record at its effective deadline", async () => {
  const h = await setup(); const { handle } = await h.load({ options: { maximumOperationAgeMs: 100 } });
  await new Promise((resolve) => setTimeout(resolve, 130));
  let constructed = false;
  await assert.rejects(consumeCommittedReviewQaPreviewRuntimeHandle({ handle, canvas: {}, nowEpochMs: () => NOW, createRuntime: () => { constructed = true; return { async initialize() {}, async dispose() {} }; } }), errorCode("DENIED"));
  assert.equal(constructed, false);
});
