import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCatalogLookupRequest, parseCatalogUnavailableEvent } from "../dist/packages/contracts/src/index.js";
import { DeployedCatalogIntegration } from "../dist/apps/try-on-web/src/runtimeCatalogIntegration.js";
import { loadVerifiedRuntimeAsset } from "../dist/apps/try-on-web/src/runtimeCatalog.js";
import { VerifiedRuntimeCommerceProductRegistry, commerceProductAttributionFromVerifiedRuntimeAsset, createProductionCommerceEventSession } from "../dist/apps/try-on-web/src/commerceAttribution.js";

const PUBLIC_JWK = {
  key_ops: ["verify"], ext: true, kty: "EC", crv: "P-256",
  x: "JAx_OzIU4qRbfxV6vG_v9rV9Z9K4BFveQsie7FMnu_c",
  y: "JnLmByslri7CE1kmv0myDsCGzIFU4CZgHZ5fRYbOyBU",
};
const PRIVATE_JWK = { ...PUBLIC_JWK, key_ops: ["sign"], d: "ylAZtCYtfIhTr3cn58sD_Hliur7OR1qsxBfbH-N3OT4" };
const deploymentUrl = "https://control.example/deployments/active.json";
const catalogUrl = "https://catalog.example/runtime/fixtures/self-test-catalog.json";
const manifestUrl = "https://catalog.example/runtime/assets/calibration-frame.json";
const modelUrl = "https://catalog.example/runtime/assets/calibration-frame.glb";
const nowEpochMs = Date.parse("2026-01-01T00:02:00Z");
const encoded = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

class MemoryReceiptStore {
  value = null;
  commits = 0;
  read() { return this.value; }
  commit(_scope, expected, receipt) {
    assert.deepEqual(this.value, expected);
    this.value = receipt;
    this.commits += 1;
  }
}

async function signedEnvelope(document) {
  const payload = encoded(document);
  const key = await crypto.subtle.importKey("jwk", PRIVATE_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload));
  return encoded({
    schemaVersion: 1, kind: "jessica.signed-deployment", keyId: "test-only", algorithm: "ES256",
    payloadSha256: hash(payload), payloadBase64: payload.toString("base64"), signatureBase64: signature.toString("base64"),
  });
}

async function scenario({ secondVariant = false, blockDeployment = false, tenantId = "jessica-internal", siteId = "self-ec" } = {}) {
  const catalog = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/fixtures/self-test-catalog.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.json", import.meta.url), "utf8"));
  const glb = Buffer.from(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.glb", import.meta.url)));
  catalog.tenantId = tenantId;
  for (const entry of catalog.entries) { entry.tenantId = tenantId; entry.model.tenantId = tenantId; entry.variant.tenantId = tenantId; entry.asset.tenantId = tenantId; }
  const sourceHash = "b".repeat(64);
  manifest.fixture = false;
  manifest.sourceAssetHashes = [sourceHash];
  const manifestBytes = encoded(manifest);
  const first = catalog.entries[0];
  first.asset.status = "published";
  first.asset.quality = "standard";
  first.asset.qualityEnvelope.recommendedForLive = true;
  first.asset.sourceAssetHashes = [sourceHash];
  first.asset.manifestSha256 = hash(manifestBytes);
  let selected = first;
  if (secondVariant) {
    selected = structuredClone(first);
    selected.variant.id = "calibration-proxy-blue";
    selected.variant.sku = "FIXTURE-BLUE";
    selected.variant.frameColor = "blue";
    catalog.entries.push(selected);
  }
  const catalogBytes = encoded(catalog);
  const pointer = {
    deploymentId: "deployment-e2-r1", status: "active", tenantId, siteId, environment: "production",
    selector: { sku: selected.variant.sku, frameModelId: selected.model.id, frameVariantId: selected.variant.id },
    revision: 1, generation: 1, activatedAt: "2025-12-31T23:59:00Z",
    actor: { authorityId: "test-control", subjectId: "operator", changeId: "change-1" },
    catalogUrl, allowedOrigin: "https://catalog.example",
    asset: { assetId: selected.asset.id, assetVersion: selected.asset.version, catalogSha256: hash(catalogBytes), manifestSha256: hash(manifestBytes), modelSha256: manifest.model.sha256 },
    priorPointer: null,
  };
  const document = {
    schemaVersion: 1, kind: "jessica.active-deployments", authorityId: "test-control",
    issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:04:00Z", pointers: [pointer],
  };
  const envelope = await signedEnvelope(document);
  const requested = [];
  const responses = new Map([[deploymentUrl, envelope], [catalogUrl, catalogBytes], [manifestUrl, manifestBytes], [modelUrl, glb]]);
  const fetchFn = async (input, init = {}) => {
    requested.push({ url: String(input), init });
    if (blockDeployment && String(input) === deploymentUrl) {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }
    const bytes = responses.get(String(input));
    return bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
  };
  const trust = {
    trustedKeys: { "test-only": { authorityId: "test-control", publicJwk: PUBLIC_JWK } },
    allowedDeploymentOrigins: ["https://control.example"], allowedCatalogOrigins: ["https://catalog.example"],
    minimumRevision: 1, minimumGeneration: 1, maximumDocumentLifetimeMs: 300_000, maximumDocumentAgeMs: 300_000,
  };
  return { pointer, selected, fetchFn, requested, trust };
}

function request(overrides = {}) {
  return {
    schemaVersion: 1, requestId: "request-1", tenantId: "jessica-internal", siteId: "self-ec", environment: "production",
    sku: "FIXTURE-CALIBRATION-PROXY", frameModelId: "calibration-proxy", frameVariantId: "calibration-proxy-orange",
    fallback: { kind: "none" }, ...overrides,
  };
}

function integration(chain, options = {}) {
  const store = options.store ?? new MemoryReceiptStore();
  return {
    store,
    client: new DeployedCatalogIntegration({
      deploymentUrl, selection: { tenantId: chain.pointer.tenantId, siteId: chain.pointer.siteId, environment: "production" },
      trust: chain.trust, receiptStore: store, fetchFn: chain.fetchFn, nowEpochMs: options.nowEpochMs ?? (() => nowEpochMs),
      ...(options.sink ? { unavailableSink: options.sink } : {}),
    }),
  };
}

test("catalog integration contracts reject unknown fields and unsafe identifiers", () => {
  assert.throws(() => parseCatalogLookupRequest({ ...request(), camera: "secret" }), /unknown field/);
  assert.throws(() => parseCatalogLookupRequest({ ...request(), sku: "https:\/\/example.test/private/path" }), /bounded identifier/);
  assert.throws(() => parseCatalogUnavailableEvent({ schemaVersion: 1, type: "catalog.asset-unavailable", rawError: "secret" }), /unknown field|missing a required field/);
  let accessed = false;
  const accessor = request();
  Object.defineProperty(accessor, "sku", { enumerable: true, get() { accessed = true; throw new Error("must not run"); } });
  assert.throws(() => parseCatalogLookupRequest(accessor), /data properties/);
  assert.equal(accessed, false);
  const mutable = request();
  const parsed = parseCatalogLookupRequest(mutable);
  mutable.sku = "MUTATED-AFTER-PARSE";
  assert.equal(parsed.sku, "FIXTURE-CALIBRATION-PROXY");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.fallback), true);
});

test("exact deployed SKU lookup binds request and immutable deployment identity", async () => {
  const chain = await scenario();
  const { client, store } = integration(chain);
  const result = await client.load(request());
  assert.equal(result.ok, true);
  assert.equal(result.asset.catalogEntry.variant.sku, chain.pointer.selector.sku);
  assert.equal(result.fallbackApplied, false);
  assert.equal(store.commits, 1);
  assert.ok(chain.requested.every(({ init }) => init.credentials === "omit" && init.cache === "no-store" && init.redirect === "follow"));
});

test("production commerce attribution accepts only exact loader-registered public-live assets", async () => {
  const chain = await scenario();
  const { client } = integration(chain);
  const loaded = await client.load(request());
  assert.equal(loaded.ok, true);
  const registry = new VerifiedRuntimeCommerceProductRegistry({ tenantId: chain.pointer.tenantId, siteId: chain.pointer.siteId, environment: "production" });
  assert.equal(registry.register(structuredClone(loaded.asset)), false, "well-formed structural clone has no loader authority");
  assert.equal(commerceProductAttributionFromVerifiedRuntimeAsset({ ...loaded.asset }), null, "well-formed forged wrapper has no object-identity proof");
  assert.equal(registry.register(loaded.asset), true);
  assert.equal(registry.resolve(registry.scope, chain.pointer.selector.sku).deploymentId, chain.pointer.deploymentId);

  const alteredChain = await scenario();
  const alteredLoad = await integration(alteredChain).client.load(request());
  assert.equal(alteredLoad.ok, true);
  alteredLoad.asset.catalogEntry.variant.sku = "FORGED-SKU";
  assert.equal(commerceProductAttributionFromVerifiedRuntimeAsset(alteredLoad.asset), null, "post-verification identity mismatch invalidates the loader proof");
  assert.equal(new VerifiedRuntimeCommerceProductRegistry({ tenantId: alteredChain.pointer.tenantId, siteId: alteredChain.pointer.siteId, environment: "production" }).register(alteredLoad.asset), false);

  const qaOnly = await loadVerifiedRuntimeAsset({ catalogUrl, mode: "qa-preview", fetchFn: chain.fetchFn });
  assert.equal(registry.register(qaOnly), false, "QA/non-deployed asset cannot enter the production registry");

  const emitted = [];
  let eventNumber = 0;
  const session = createProductionCommerceEventSession({
    tenantId: chain.pointer.tenantId, siteId: chain.pointer.siteId, environment: "production", sessionId: "commerce-session",
    productRegistry: registry, nextEventId: () => `commerce-${++eventNumber}`, nowEpochMs: () => nowEpochMs,
    emit: (event) => emitted.push(event),
  });
  const outcome = session.observeWidget({
    protocol: "jessica-widget", version: 1, direction: "widget-to-parent", tenantId: chain.pointer.tenantId,
    sessionId: "commerce-session", requestId: "opened-event", replyTo: "open-command", type: "jessica.opened",
    payload: { skuId: chain.pointer.selector.sku },
  });
  assert.equal(outcome.accepted, true);
  assert.deepEqual(emitted[0].product, registry.resolve(registry.scope, chain.pointer.selector.sku));
});

test("production commerce registries and sessions are exact tenant/site/production scoped", async () => {
  assert.throws(() => new VerifiedRuntimeCommerceProductRegistry({ tenantId: "bad tenant", siteId: "site-a", environment: "production" }), /tenantId/);
  assert.throws(() => new VerifiedRuntimeCommerceProductRegistry({ tenantId: "tenant-a", siteId: "site-a", environment: "staging" }), /production/);

  const chainA = await scenario({ tenantId: "tenant-a", siteId: "site-a" });
  const loadedA = await integration(chainA).client.load(request({ tenantId: "tenant-a", siteId: "site-a" }));
  assert.equal(loadedA.ok, true);
  const chainB = await scenario({ tenantId: "tenant-b", siteId: "site-b" });
  const loadedB = await integration(chainB).client.load(request({ tenantId: "tenant-b", siteId: "site-b" }));
  assert.equal(loadedB.ok, true);
  const siteChain = await scenario({ tenantId: "tenant-a", siteId: "site-other" });
  const siteLoaded = await integration(siteChain).client.load(request({ tenantId: "tenant-a", siteId: "site-other" }));
  assert.equal(siteLoaded.ok, true);

  const registryA = new VerifiedRuntimeCommerceProductRegistry({ tenantId: "tenant-a", siteId: "site-a", environment: "production" });
  const registryB = new VerifiedRuntimeCommerceProductRegistry({ tenantId: "tenant-b", siteId: "site-b", environment: "production" });
  assert.throws(() => { registryA.scope = registryB.scope; }, /getter|read only|setting/i);
  assert.equal(registryA.register(loadedA.asset), true);
  assert.equal(registryB.register(loadedB.asset), true);
  assert.equal(registryA.register(loadedB.asset), false, "tenant-B proof cannot enter tenant-A registry");
  assert.equal(registryB.register(loadedA.asset), false, "tenant-A proof cannot enter tenant-B registry");
  assert.equal(registryA.register(siteLoaded.asset), false, "same-tenant cross-site proof cannot enter registry");
  assert.equal(registryA.resolve(registryA.scope, chainA.pointer.selector.sku).catalogSha256, chainA.pointer.asset.catalogSha256);
  assert.equal(registryB.resolve(registryB.scope, chainB.pointer.selector.sku).catalogSha256, chainB.pointer.asset.catalogSha256);
  assert.equal(registryA.resolve(registryB.scope, chainA.pointer.selector.sku), null, "resolve rejects cross-scope callers");
  assert.notEqual(registryA.resolve(registryA.scope, chainA.pointer.selector.sku).catalogSha256, registryB.resolve(registryB.scope, chainB.pointer.selector.sku).catalogSha256, "same SKU remains isolated in independently scoped registries");

  const base = { environment: "production", sessionId: "scope-session", productRegistry: registryA, nextEventId: () => "scope-event", nowEpochMs: () => nowEpochMs, emit() {} };
  assert.throws(() => createProductionCommerceEventSession({ ...base, tenantId: "tenant-b", siteId: "site-a" }), /scope/);
  assert.throws(() => createProductionCommerceEventSession({ ...base, tenantId: "tenant-a", siteId: "site-other" }), /scope/);
  assert.throws(() => createProductionCommerceEventSession({ ...base, tenantId: "tenant-a", siteId: "site-a", environment: "staging" }), /production/);
  assert.throws(() => createProductionCommerceEventSession({ ...base, tenantId: "tenant-a", siteId: "site-a", productRegistry: { scope: registryA.scope, resolve: () => null } }), /verified scoped registry/);
});

test("explicit fallback is deterministic, same-model, and only selects the signed active variant", async () => {
  const chain = await scenario({ secondVariant: true });
  const { client } = integration(chain);
  const result = await client.load(request({
    sku: "FIXTURE-SOLD-OUT", frameVariantId: "calibration-proxy-sold-out",
    fallback: { kind: "explicit-same-model", sku: "FIXTURE-BLUE", frameModelId: "calibration-proxy", frameVariantId: "calibration-proxy-blue" },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.asset.catalogEntry.variant.id, "calibration-proxy-blue");
  assert.equal(result.fallbackApplied, true);
});

test("fallback never silently crosses model or substitutes a non-active SKU", async () => {
  const events = [];
  const chain = await scenario({ secondVariant: true });
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  const crossModel = await client.load(request({
    sku: "MISSING", frameVariantId: "missing-red",
    fallback: { kind: "explicit-same-model", sku: "FIXTURE-BLUE", frameModelId: "other-model", frameVariantId: "calibration-proxy-blue" },
  }));
  assert.deepEqual(crossModel, { ok: false, reasonCode: "FALLBACK_MODEL_MISMATCH" });
  assert.deepEqual(chain.requested.map(({ url }) => url), [deploymentUrl, catalogUrl]);
  assert.equal(events[0].reasonCode, "FALLBACK_MODEL_MISMATCH");
  const serialized = JSON.stringify(events[0]);
  for (const forbidden of ["camera", "image", "landmark", "pose", "scale", "secret", "url", "path", "stack", "error"]) assert.equal(serialized.toLowerCase().includes(forbidden), false);
});

test("unavailable sink failures are non-fatal and raw failures collapse to closed reason codes", async () => {
  const chain = await scenario();
  chain.trust.trustedKeys = {};
  const { client } = integration(chain, { sink: { write() { throw new Error("sink path and secret"); } } });
  assert.deepEqual(await client.load(request()), { ok: false, reasonCode: "DEPLOYMENT_REJECTED" });
});

test("first-asset prefetch is reused by concurrent consumption without a second fetch", async () => {
  const chain = await scenario();
  const { client, store } = integration(chain);
  const prefetched = client.prefetchFirst(request());
  const [prefetchResult, loadResult] = await Promise.all([prefetched.result, client.load(request())]);
  assert.equal(prefetchResult.ok, true);
  assert.equal(loadResult.ok, true);
  assert.equal(prefetchResult.asset.verifiedGlb.bytes, loadResult.asset.verifiedGlb.bytes);
  for (const url of [deploymentUrl, catalogUrl, manifestUrl, modelUrl]) assert.equal(chain.requested.filter((item) => item.url === url).length, 1);
  assert.equal(store.commits, 1);
});

test("semantic prefetch identity excludes requestId while preserving the consuming request correlation", async () => {
  const chain = await scenario();
  const { client } = integration(chain);
  const prefetched = client.prefetchFirst(request({ requestId: "prefetch-request" }));
  const consumed = client.load(request({ requestId: "consumer-request" }));
  const [prefetchResult, consumedResult] = await Promise.all([prefetched.result, consumed]);
  assert.equal(prefetchResult.ok, true);
  assert.equal(consumedResult.ok, true);
  assert.equal(prefetchResult.asset.verifiedGlb.bytes, consumedResult.asset.verifiedGlb.bytes);
  for (const url of [deploymentUrl, catalogUrl, manifestUrl, modelUrl]) assert.equal(chain.requested.filter((item) => item.url === url).length, 1);
});

test("shared semantic prefetch failures are logged against each distinct requestId", async () => {
  const events = [];
  const chain = await scenario();
  chain.trust.trustedKeys = {};
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  const prefetched = client.prefetchFirst(request({ requestId: "failed-prefetch" }));
  const consumed = client.load(request({ requestId: "failed-consumer" }));
  assert.deepEqual(await prefetched.result, { ok: false, reasonCode: "DEPLOYMENT_REJECTED" });
  assert.deepEqual(await consumed, { ok: false, reasonCode: "DEPLOYMENT_REJECTED" });
  assert.deepEqual(events.map(({ requestId, reasonCode }) => ({ requestId, reasonCode })), [
    { requestId: "failed-prefetch", reasonCode: "DEPLOYMENT_REJECTED" },
    { requestId: "failed-consumer", reasonCode: "DEPLOYMENT_REJECTED" },
  ]);
  assert.equal(chain.requested.filter((item) => item.url === deploymentUrl).length, 1);
});

test("prefetch is bounded to one key and cancellation aborts its network operation", async () => {
  const events = [];
  const chain = await scenario({ blockDeployment: true });
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  const first = client.prefetchFirst(request());
  const second = client.prefetchFirst(request({ requestId: "request-2", sku: "OTHER-SKU", frameVariantId: "other-variant" }));
  assert.deepEqual(await second.result, { ok: false, reasonCode: "PREFETCH_LIMIT_REACHED" });
  first.cancel();
  assert.deepEqual(await first.result, { ok: false, reasonCode: "PREFETCH_CANCELLED" });
  assert.equal(chain.requested.length, 1);
  assert.deepEqual(events.map((event) => event.reasonCode).sort(), ["PREFETCH_CANCELLED", "PREFETCH_LIMIT_REACHED"]);
});

test("every same-key prefetch handle owns cancellation of the shared speculative operation", async () => {
  const events = [];
  const chain = await scenario({ blockDeployment: true });
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  const owner = client.prefetchFirst(request({ requestId: "primary-prefetch" }));
  const secondaryOwner = client.prefetchFirst(request({ requestId: "secondary-prefetch" }));
  secondaryOwner.cancel();
  assert.deepEqual(await owner.result, { ok: false, reasonCode: "PREFETCH_CANCELLED" });
  assert.deepEqual(await secondaryOwner.result, { ok: false, reasonCode: "PREFETCH_CANCELLED" });
  assert.equal(chain.requested.length, 1);
  assert.deepEqual(events.map(({ requestId, reasonCode }) => ({ requestId, reasonCode })), [
    { requestId: "primary-prefetch", reasonCode: "PREFETCH_CANCELLED" },
    { requestId: "secondary-prefetch", reasonCode: "PREFETCH_CANCELLED" },
  ]);
});

test("one aborted consumer does not cancel a shared in-flight prefetch needed by another consumer", async () => {
  const events = [];
  const chain = await scenario();
  const baseFetch = chain.fetchFn;
  let releaseDeployment;
  chain.fetchFn = async (input, init) => {
    if (String(input) !== deploymentUrl) return baseFetch(input, init);
    return new Promise((resolve, reject) => {
      releaseDeployment = () => void baseFetch(input, init).then(resolve, reject);
    });
  };
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  const prefetched = client.prefetchFirst(request({ requestId: "prefetch-owner" }));
  const controller = new AbortController();
  const aborted = client.load(request({ requestId: "aborted-consumer" }), controller.signal);
  const successful = client.load(request({ requestId: "successful-consumer" }));
  controller.abort();
  assert.deepEqual(await aborted, { ok: false, reasonCode: "REQUEST_CANCELLED" });
  releaseDeployment();
  const [prefetchResult, successfulResult] = await Promise.all([prefetched.result, successful]);
  assert.equal(prefetchResult.ok, true);
  assert.equal(successfulResult.ok, true);
  assert.equal(prefetchResult.asset.verifiedGlb.bytes, successfulResult.asset.verifiedGlb.bytes);
  assert.equal(chain.requested.filter((item) => item.url === deploymentUrl).length, 1);
  assert.deepEqual(events.map(({ requestId, reasonCode }) => ({ requestId, reasonCode })), [
    { requestId: "aborted-consumer", reasonCode: "REQUEST_CANCELLED" },
  ]);
});

test("direct load cancellation reports REQUEST_CANCELLED without raw details", async () => {
  const events = [];
  const chain = await scenario({ blockDeployment: true });
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  const controller = new AbortController();
  const loading = client.load(request({ requestId: "direct-cancel" }), controller.signal);
  controller.abort();
  assert.deepEqual(await loading, { ok: false, reasonCode: "REQUEST_CANCELLED" });
  assert.deepEqual(events.map(({ requestId, reasonCode }) => ({ requestId, reasonCode })), [
    { requestId: "direct-cancel", reasonCode: "REQUEST_CANCELLED" },
  ]);
});

test("cached deployment freshness passes just before deadline and refetches at exact expiry", async () => {
  let clock = nowEpochMs;
  const freshChain = await scenario();
  const fresh = integration(freshChain, { nowEpochMs: () => clock });
  const prefetched = fresh.client.prefetchFirst(request({ requestId: "fresh-prefetch" }));
  const prefetchedResult = await prefetched.result;
  assert.equal(prefetchedResult.ok, true);
  assert.equal(prefetchedResult.asset.deploymentFreshnessDeadlineEpochMs, Date.parse("2026-01-01T00:04:00Z"));
  clock = Date.parse("2026-01-01T00:03:59.999Z");
  const justBefore = await fresh.client.load(request({ requestId: "fresh-consumer" }));
  assert.equal(justBefore.ok, true);
  assert.equal(freshChain.requested.filter((item) => item.url === deploymentUrl).length, 1);

  clock = nowEpochMs;
  const expiredChain = await scenario();
  const expired = integration(expiredChain, { nowEpochMs: () => clock });
  assert.equal((await expired.client.prefetchFirst(request()).result).ok, true);
  clock = Date.parse("2026-01-01T00:04:00Z");
  assert.deepEqual(await expired.client.load(request({ requestId: "exact-expiry" })), { ok: false, reasonCode: "DEPLOYMENT_REJECTED" });
  assert.equal(expiredChain.requested.filter((item) => item.url === deploymentUrl).length, 2);
  assert.equal(expiredChain.requested.filter((item) => item.url === catalogUrl).length, 1);
});

test("cached deployment refetches and fails after the host maximum-age deadline", async () => {
  let clock = nowEpochMs;
  const chain = await scenario();
  chain.trust.maximumDocumentAgeMs = 150_000;
  const { client } = integration(chain, { nowEpochMs: () => clock });
  assert.equal((await client.prefetchFirst(request()).result).ok, true);
  clock = Date.parse("2026-01-01T00:02:30.001Z");
  assert.deepEqual(await client.load(request({ requestId: "after-max-age" })), { ok: false, reasonCode: "DEPLOYMENT_REJECTED" });
  assert.equal(chain.requested.filter((item) => item.url === deploymentUrl).length, 2);
  assert.equal(chain.requested.filter((item) => item.url === catalogUrl).length, 1);
});

test("invalid application input fails before fetch and is never copied into unavailable logs", async () => {
  const events = [];
  const chain = await scenario();
  const { client } = integration(chain, { sink: { write: (event) => events.push(event) } });
  assert.deepEqual(await client.load({ ...request(), rawImage: "data:image/jpeg;base64,secret" }), { ok: false, reasonCode: "INVALID_REQUEST" });
  assert.deepEqual(chain.requested, []);
  assert.deepEqual(events, []);
});
