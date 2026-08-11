import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadDeployedRuntimeAsset } from "../dist/apps/try-on-web/src/runtimeCatalog.js";
import { LocalStorageDeploymentReceiptStore } from "../dist/apps/try-on-web/src/runtimeDeployment.js";

// Fixed deterministic identity for tests only. This private key is non-production and must never be trusted by a host.
const TEST_ONLY_PUBLIC_JWK = {
  key_ops: ["verify"], ext: true, kty: "EC", crv: "P-256",
  x: "JAx_OzIU4qRbfxV6vG_v9rV9Z9K4BFveQsie7FMnu_c",
  y: "JnLmByslri7CE1kmv0myDsCGzIFU4CZgHZ5fRYbOyBU",
};
const TEST_ONLY_PRIVATE_JWK = {
  ...TEST_ONLY_PUBLIC_JWK,
  key_ops: ["sign"],
  d: "ylAZtCYtfIhTr3cn58sD_Hliur7OR1qsxBfbH-N3OT4",
};

const deploymentUrl = "https://control.example/deployments/active.json";
const catalogUrl = "https://catalog.example/runtime/fixtures/self-test-catalog.json";
const manifestUrl = "https://catalog.example/runtime/assets/calibration-frame.json";
const modelUrl = "https://catalog.example/runtime/assets/calibration-frame.glb";
const nowEpochMs = Date.parse("2026-01-01T00:02:00Z");
const encoded = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

class MemoryReceiptStore {
  constructor(value = null) { this.value = value; this.commits = 0; }
  read() { return this.value; }
  commit(_scope, expected, receipt) {
    assert.deepEqual(this.value, expected);
    this.value = receipt;
    this.commits += 1;
  }
}

async function signedEnvelope(document, mutateEnvelope) {
  const payload = encoded(document);
  const privateKey = await crypto.subtle.importKey("jwk", TEST_ONLY_PRIVATE_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payload));
  const envelope = {
    schemaVersion: 1,
    kind: "jessica.signed-deployment",
    keyId: "test-only-p256-2026",
    algorithm: "ES256",
    payloadSha256: hash(payload),
    payloadBase64: payload.toString("base64"),
    signatureBase64: signature.toString("base64"),
  };
  mutateEnvelope?.(envelope);
  return encoded(envelope);
}

async function scenario(options = {}) {
  const catalog = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/fixtures/self-test-catalog.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.json", import.meta.url), "utf8"));
  const glb = Buffer.from(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.glb", import.meta.url)));
  const sourceHash = "b".repeat(64);
  manifest.fixture = false;
  manifest.sourceAssetHashes = [sourceHash];
  const manifestBytes = encoded(manifest);
  const entry = catalog.entries[0];
  entry.asset.status = "published";
  entry.asset.quality = "standard";
  entry.asset.qualityEnvelope.recommendedForLive = true;
  entry.asset.sourceAssetHashes = [sourceHash];
  entry.asset.manifestSha256 = hash(manifestBytes);
  options.mutateCatalog?.(catalog);
  const catalogBytes = encoded(catalog);
  const pointer = {
    deploymentId: "deployment-test-only-r1",
    status: "active",
    tenantId: "jessica-internal",
    siteId: "self-ec",
    environment: "production",
    selector: {
      sku: entry.variant.sku,
      frameModelId: entry.model.id,
      frameVariantId: entry.variant.id,
    },
    revision: 1,
    generation: 1,
    activatedAt: "2025-12-31T23:59:00Z",
    actor: { authorityId: "test-only-control", subjectId: "fixture-operator", changeId: "fixture-change-1" },
    catalogUrl,
    allowedOrigin: "https://catalog.example",
    asset: {
      assetId: entry.asset.id,
      assetVersion: entry.asset.version,
      catalogSha256: hash(catalogBytes),
      manifestSha256: hash(manifestBytes),
      modelSha256: manifest.model.sha256,
    },
    priorPointer: null,
  };
  const document = {
    schemaVersion: 1,
    kind: "jessica.active-deployments",
    authorityId: "test-only-control",
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T00:04:00Z",
    pointers: [pointer],
  };
  options.mutateDocument?.(document);
  const envelopeBytes = await signedEnvelope(document, options.mutateEnvelope);
  const requested = [];
  const responses = new Map([
    [deploymentUrl, envelopeBytes],
    [catalogUrl, options.catalogBytes ?? catalogBytes],
    [manifestUrl, manifestBytes],
    [modelUrl, glb],
  ]);
  const fetchFn = async (input, init) => {
    requested.push({ url: String(input), init });
    const bytes = responses.get(String(input));
    const response = bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
    if (options.redirectUrl && String(input) === deploymentUrl) Object.defineProperty(response, "url", { value: options.redirectUrl });
    if (options.catalogRedirectUrl && String(input) === catalogUrl) Object.defineProperty(response, "url", { value: options.catalogRedirectUrl });
    return response;
  };
  const trust = {
    trustedKeys: { "test-only-p256-2026": { authorityId: "test-only-control", publicJwk: TEST_ONLY_PUBLIC_JWK } },
    allowedDeploymentOrigins: ["https://control.example"],
    allowedCatalogOrigins: ["https://catalog.example"],
    minimumRevision: 1,
    minimumGeneration: 1,
    maximumDocumentLifetimeMs: 5 * 60_000,
    maximumDocumentAgeMs: 5 * 60_000,
    ...options.trust,
  };
  return { document, pointer, catalog, manifest, glb, envelopeBytes, fetchFn, requested, trust };
}

function load(chain, store = new MemoryReceiptStore(), extra = {}) {
  return loadDeployedRuntimeAsset({
    deploymentUrl,
    selection: { tenantId: "jessica-internal", siteId: "self-ec", environment: "production" },
    trust: chain.trust,
    receiptStore: store,
    fetchFn: chain.fetchFn,
    nowEpochMs,
    ...extra,
  });
}

test("verified active deployment selects one immutable asset and fetches every byte source once", async () => {
  const chain = await scenario();
  const store = new MemoryReceiptStore();
  const asset = await load(chain, store);
  assert.equal(asset.deployment.deploymentId, "deployment-test-only-r1");
  assert.equal(asset.catalogEntry.variant.sku, chain.pointer.selector.sku);
  assert.deepEqual(Buffer.from(asset.verifiedGlb.bytes), chain.glb);
  assert.equal(store.commits, 1);
  for (const url of [deploymentUrl, catalogUrl, manifestUrl, modelUrl]) assert.equal(chain.requested.filter((request) => request.url === url).length, 1);
  assert.ok(chain.requested.every((request) => request.init.cache === "no-store"));
});

test("public-live requires a monotonic store before network access", async () => {
  const chain = await scenario();
  await assert.rejects(loadDeployedRuntimeAsset({
    deploymentUrl,
    selection: { tenantId: "jessica-internal", siteId: "self-ec", environment: "production" },
    trust: chain.trust,
    fetchFn: chain.fetchFn,
    nowEpochMs,
  }), /requires a monotonic deployment receipt store/);
  assert.equal(chain.requested.length, 0);
});

test("query-like key pins cannot establish trust and SKU overrides are ignored", async () => {
  const untrusted = await scenario({ mutateEnvelope: (envelope) => { envelope.keyId = "query-attacker-key"; } });
  await assert.rejects(load(untrusted, new MemoryReceiptStore(), { publicKey: TEST_ONLY_PUBLIC_JWK, sku: "ATTACKER-SKU" }), /keyId is not trusted/);
  const chain = await scenario();
  const asset = await load(chain, new MemoryReceiptStore(), { sku: "ATTACKER-SKU" });
  assert.equal(asset.catalogEntry.variant.sku, chain.pointer.selector.sku);
});

test("payload digest, algorithm, key, and signature tampering fail before catalog fetch", async () => {
  const cases = [
    ["payload", (envelope) => { envelope.payloadBase64 = `${envelope.payloadBase64.slice(0, -4)}AAAA`; }, /payload SHA-256 mismatch/],
    ["algorithm", (envelope) => { envelope.algorithm = "none"; }, /algorithm must be ES256/],
    ["key", (envelope) => { envelope.keyId = "revoked-key"; }, /keyId is not trusted/],
    ["signature", (envelope) => { envelope.signatureBase64 = Buffer.alloc(64, 7).toString("base64"); }, /signature verification failed/],
  ];
  for (const [name, mutateEnvelope, expected] of cases) {
    const chain = await scenario({ mutateEnvelope });
    await assert.rejects(load(chain), expected, name);
    assert.deepEqual(chain.requested.map((request) => request.url), [deploymentUrl]);
  }
});

test("deployment and signed envelope contracts reject unknown fields", async () => {
  const unknownDeployment = await scenario({ mutateDocument: (document) => { document.untrusted = true; } });
  await assert.rejects(load(unknownDeployment), /deployment contains unknown field/);
  const unknownEnvelope = await scenario({ mutateEnvelope: (envelope) => { envelope.untrusted = true; } });
  await assert.rejects(load(unknownEnvelope), /envelope fields are invalid/);
});

test("catalog actual-byte substitution and deployment identity/hash substitution fail closed", async () => {
  const catalogSwap = await scenario({ catalogBytes: Buffer.from("{}\n") });
  await assert.rejects(load(catalogSwap), /catalog SHA-256 does not match verified deployment/);

  const cases = [
    [(document) => { document.pointers[0].tenantId = "other-tenant"; }, /exactly one active pointer; found 0/],
    [(document) => { document.pointers[0].selector.frameVariantId = "other-variant"; }, /catalog frame selection does not match/],
    [(document) => { document.pointers[0].asset.assetId = "other-asset"; }, /catalog asset identity does not match/],
    [(document) => { document.pointers[0].asset.modelSha256 = "c".repeat(64); }, /GLB SHA-256 does not match verified deployment/],
  ];
  for (const [mutateDocument, expected] of cases) await assert.rejects(load(await scenario({ mutateDocument })), expected);
});

test("verified deployment does not replace published and recommended live admission", async () => {
  const chain = await scenario({ mutateCatalog: (catalog) => { catalog.entries[0].asset.qualityEnvelope.recommendedForLive = false; } });
  await assert.rejects(load(chain), /not-recommended-for-live/);
});

test("host catalog allowlist intersects the signed origin", async () => {
  const chain = await scenario({ trust: { allowedCatalogOrigins: ["https://other-catalog.example"] } });
  await assert.rejects(load(chain), /catalog origin is not allowed by host policy/);
  assert.deepEqual(chain.requested.map((request) => request.url), [deploymentUrl]);
});

test("multiple active pointers in one tenant/site/environment stream are rejected", async () => {
  const chain = await scenario({ mutateDocument: (document) => {
    const duplicate = structuredClone(document.pointers[0]);
    duplicate.deploymentId = "deployment-test-only-duplicate";
    duplicate.selector.sku = "OTHER-SIGNED-SKU";
    document.pointers.push(duplicate);
  } });
  await assert.rejects(load(chain), /multiple active pointers for one stream/);
});

test("active actor authority must match the verified document authority", async () => {
  const chain = await scenario({ mutateDocument: (document) => { document.pointers[0].actor.authorityId = "self-asserted-actor"; } });
  await assert.rejects(load(chain), /actor authority does not match/);
});

test("expired, future, below-floor, overlong-lived, and too-old authentic documents are rejected", async () => {
  const cases = [
    [(document) => { document.expiresAt = "2026-01-01T00:01:00Z"; }, {}, /stale or expired/],
    [(document) => { document.issuedAt = "2026-01-01T00:03:00Z"; document.expiresAt = "2026-01-01T00:04:00Z"; }, {}, /issued in the future/],
    [() => {}, { minimumRevision: 2 }, /revision is below the trusted floor/],
    [(document) => { document.expiresAt = "2026-01-01T01:00:00Z"; }, {}, /lifetime exceeds host policy/],
    [(document) => { document.issuedAt = "2025-12-31T23:00:00Z"; document.pointers[0].activatedAt = "2025-12-31T22:59:00Z"; }, { maximumDocumentLifetimeMs: 2 * 60 * 60_000 }, /older than host policy/],
  ];
  for (const [mutateDocument, trust, expected] of cases) await assert.rejects(load(await scenario({ mutateDocument, trust })), expected);
});

test("advanced revisions require strict revision+generation increase and exact previous document chain", async () => {
  const prior = {
    deploymentId: "deployment-test-only-r1", revision: 1, generation: 1,
    activatedAt: "2025-12-31T23:58:00Z", assetId: "calibration-proxy-v1", assetVersion: 1,
    catalogSha256: "1".repeat(64), manifestSha256: "2".repeat(64), modelSha256: "3".repeat(64), documentSha256: "4".repeat(64),
  };
  const mutateDocument = (document) => {
    const pointer = document.pointers[0];
    pointer.deploymentId = "deployment-test-only-r2";
    pointer.revision = 2;
    pointer.generation = 2;
    pointer.priorPointer = {
      deploymentId: prior.deploymentId, deploymentSha256: "f".repeat(64), revision: prior.revision, generation: prior.generation,
      activatedAt: prior.activatedAt, assetId: prior.assetId, assetVersion: prior.assetVersion,
      catalogSha256: prior.catalogSha256, manifestSha256: prior.manifestSha256, modelSha256: prior.modelSha256,
    };
  };
  await assert.rejects(load(await scenario({ mutateDocument }), new MemoryReceiptStore(prior)), /prior pointer does not match/);

  const generationReusePrior = { ...prior, revision: 2, generation: 2 };
  const generationReuse = await scenario({ mutateDocument: (document) => {
    const pointer = document.pointers[0];
    pointer.deploymentId = "deployment-test-only-r3";
    pointer.revision = 3;
    pointer.generation = 2;
    pointer.priorPointer = {
      deploymentId: generationReusePrior.deploymentId, deploymentSha256: generationReusePrior.documentSha256,
      revision: 1, generation: 1, activatedAt: "2025-12-31T23:58:00Z",
      assetId: generationReusePrior.assetId, assetVersion: generationReusePrior.assetVersion,
      catalogSha256: generationReusePrior.catalogSha256, manifestSha256: generationReusePrior.manifestSha256, modelSha256: generationReusePrior.modelSha256,
    };
  } });
  await assert.rejects(load(generationReuse, new MemoryReceiptStore(generationReusePrior)), /rollback, replay, or revision reuse/);
});

test("revision 2 exact-chain transition and idempotent reload pass, but same counters with different bytes fail", async () => {
  const revisionOne = await scenario();
  const store = new MemoryReceiptStore();
  await load(revisionOne, store);
  const priorReceipt = structuredClone(store.value);
  const advance = (document) => {
    const pointer = document.pointers[0];
    pointer.deploymentId = "deployment-test-only-r2";
    pointer.revision = 2;
    pointer.generation = 2;
    pointer.activatedAt = "2026-01-01T00:00:30Z";
    pointer.priorPointer = {
      deploymentId: priorReceipt.deploymentId,
      deploymentSha256: priorReceipt.documentSha256,
      revision: priorReceipt.revision,
      generation: priorReceipt.generation,
      activatedAt: priorReceipt.activatedAt,
      assetId: priorReceipt.assetId,
      assetVersion: priorReceipt.assetVersion,
      catalogSha256: priorReceipt.catalogSha256,
      manifestSha256: priorReceipt.manifestSha256,
      modelSha256: priorReceipt.modelSha256,
    };
    document.issuedAt = "2026-01-01T00:01:00Z";
  };
  const revisionTwo = await scenario({ mutateDocument: advance });
  const first = await load(revisionTwo, store);
  assert.equal(first.deployment.revision, 2);
  const revisionTwoReceipt = structuredClone(store.value);
  const idempotent = await load(revisionTwo, store);
  assert.equal(idempotent.deployment.generation, 2);
  assert.deepEqual(store.value, revisionTwoReceipt);

  const differentBytes = await scenario({ mutateDocument: (document) => {
    advance(document);
    document.expiresAt = "2026-01-01T00:03:30Z";
  } });
  await assert.rejects(load(differentBytes, store), /rollback, replay, or revision reuse/);
});

test("deployment redirect cannot escape the immutable host origin allowlist", async () => {
  const chain = await scenario({ redirectUrl: "https://evil.example/deployment.json" });
  await assert.rejects(load(chain), /redirect origin is not trusted/);
  assert.equal(chain.requested.length, 1);
});

test("catalog redirect cannot escape the host and signed origin intersection", async () => {
  const chain = await scenario({ catalogRedirectUrl: "https://evil.example/catalog.json" });
  await assert.rejects(load(chain), /runtime asset origin is not allowed/);
  assert.ok(!chain.requested.some((request) => request.url === manifestUrl));
});

test("oversized unsigned envelopes are rejected before payload processing", async () => {
  const chain = await scenario();
  chain.fetchFn = async () => new Response(Buffer.alloc(256 * 1024 + 1, 0x20), { headers: { "content-length": String(256 * 1024 + 1) } });
  await assert.rejects(load(chain), /envelope exceeds byte limit/);
});

test("local receipt adapter serializes a re-read and rejects stale CAS expectations", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const locks = { request: async (_name, callback) => callback() };
  const store = new LocalStorageDeploymentReceiptStore(storage, locks);
  const receipt = {
    deploymentId: "deployment-test-only-r1", revision: 1, generation: 1,
    activatedAt: "2025-12-31T23:59:00Z", assetId: "asset", assetVersion: 1,
    catalogSha256: "1".repeat(64), manifestSha256: "2".repeat(64), modelSha256: "3".repeat(64), documentSha256: "4".repeat(64),
  };
  const scope = JSON.stringify(["tenant/with/slash", "site", "production"]);
  await store.commit(scope, null, receipt);
  await assert.rejects(store.commit(scope, null, { ...receipt, revision: 2, generation: 2 }), /changed during verification/);
  await assert.rejects(store.commit(scope, receipt, { ...receipt, revision: 2, generation: 1 }), /regress freshness/);
});

test("receipt CAS failure prevents public-live loader from returning an otherwise verified asset", async () => {
  const chain = await scenario();
  const store = {
    read: () => null,
    commit: () => { throw new Error("fixture CAS conflict"); },
  };
  await assert.rejects(load(chain, store), /fixture CAS conflict/);
  assert.ok(chain.requested.some((request) => request.url === modelUrl));
});
