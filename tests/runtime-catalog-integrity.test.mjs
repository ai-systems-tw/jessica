import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadVerifiedRuntimeAsset } from "../dist/apps/try-on-web/src/runtimeCatalog.js";

const catalogUrl = "https://catalog.example/runtime/fixtures/self-test-catalog.json";
const manifestUrl = "https://catalog.example/runtime/assets/calibration-frame.json";
const modelUrl = "https://catalog.example/runtime/assets/calibration-frame.glb";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function builtChain() {
  const catalog = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/fixtures/self-test-catalog.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.json", import.meta.url), "utf8"));
  const glb = Buffer.from(await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.glb", import.meta.url)));
  return { catalog, manifest, glb };
}

function encoded(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function padded(bytes, byte) {
  const padding = (4 - bytes.length % 4) % 4;
  return Buffer.concat([bytes, Buffer.alloc(padding, byte)]);
}

function mutateGlb(chain, mutate) {
  const jsonLength = chain.glb.readUInt32LE(12);
  const json = JSON.parse(chain.glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const binaryHeader = 20 + jsonLength;
  const binaryLength = chain.glb.readUInt32LE(binaryHeader);
  const binary = chain.glb.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  mutate(json);
  const jsonBytes = padded(Buffer.from(JSON.stringify(json)), 0x20);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonBytes.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  chain.glb = Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binary]);
  chain.glb.writeUInt32LE(chain.glb.length, 8);
  chain.manifest.model.byteLength = chain.glb.length;
  chain.manifest.model.sha256 = hash(chain.glb);
}

function fetchChain({ catalog, manifest, glb }) {
  const manifestBytes = encoded(manifest);
  catalog.entries.forEach((entry) => { entry.asset.manifestSha256 = hash(manifestBytes); });
  const responses = new Map([
    [catalogUrl, encoded(catalog)],
    [manifestUrl, manifestBytes],
    [modelUrl, glb],
  ]);
  return async (input) => {
    const bytes = responses.get(String(input));
    return bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
  };
}

test("loads a catalog-selected fixture only after manifest, bytes, GLB structure, nodes, units, and bounds pass", async () => {
  const chain = await builtChain();
  const loaded = await loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(chain) });
  assert.equal(loaded.catalogEntry.variant.sku, "FIXTURE-CALIBRATION-PROXY");
  assert.equal(loaded.verifiedGlb.sha256, hash(chain.glb));
  assert.deepEqual(Buffer.from(loaded.verifiedGlb.bytes), chain.glb);
});

test("a second product is selected from data without changing runtime code", async () => {
  const chain = await builtChain();
  const second = structuredClone(chain.catalog.entries[0]);
  second.variant.id = "calibration-proxy-blue";
  second.variant.sku = "FIXTURE-SECOND-PRODUCT";
  second.variant.frameColor = "blue";
  chain.catalog.entries.push(second);
  const loaded = await loadVerifiedRuntimeAsset({ catalogUrl, sku: second.variant.sku, mode: "calibration", fetchFn: fetchChain(chain) });
  assert.equal(loaded.catalogEntry.variant.frameColor, "blue");
});

test("generic loader rejects public-live and a plain deployment object before any fetch", async () => {
  const chain = await builtChain();
  const requested = [];
  const baseFetch = fetchChain(chain);
  await assert.rejects(loadVerifiedRuntimeAsset({
    catalogUrl,
    mode: "public-live",
    deployment: { status: "active", asset: chain.catalog.entries[0].asset },
    fetchFn: async (input, init) => { requested.push(String(input)); return baseFetch(input, init); },
  }), /only through loadDeployedRuntimeAsset/);
  assert.deepEqual(requested, []);
});

test("qa-preview rejects draft assets before manifest or GLB fetch", async () => {
  const chain = await builtChain();
  const requested = [];
  const baseFetch = fetchChain(chain);
  await assert.rejects(loadVerifiedRuntimeAsset({
    catalogUrl,
    mode: "qa-preview",
    fetchFn: async (input, init) => { requested.push(String(input)); return baseFetch(input, init); },
  }), /status-not-admitted/);
  assert.deepEqual(requested, [catalogUrl]);
});

test("qa-preview accepts a published non-fixture asset with source provenance through the integrity chain", async () => {
  const chain = await builtChain();
  const sourceHash = "b".repeat(64);
  chain.manifest.fixture = false;
  chain.manifest.sourceAssetHashes = [sourceHash];
  chain.catalog.entries[0].asset.status = "published";
  chain.catalog.entries[0].asset.quality = "standard";
  chain.catalog.entries[0].asset.qualityEnvelope.recommendedForLive = true;
  chain.catalog.entries[0].asset.sourceAssetHashes = [sourceHash];
  const loaded = await loadVerifiedRuntimeAsset({ catalogUrl, mode: "qa-preview", fetchFn: fetchChain(chain) });
  assert.equal(loaded.manifest.fixture, false);
  assert.equal(loaded.asset.status, "published");
});

test("generic public-live cannot use catalog recommendation as deployment authority", async () => {
  const chain = await builtChain();
  const sourceHash = "c".repeat(64);
  chain.manifest.fixture = false;
  chain.manifest.sourceAssetHashes = [sourceHash];
  chain.catalog.entries[0].asset.status = "published";
  chain.catalog.entries[0].asset.quality = "standard";
  chain.catalog.entries[0].asset.sourceAssetHashes = [sourceHash];
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "public-live", fetchFn: fetchChain(chain) }), /only through loadDeployedRuntimeAsset/);
});

test("absolute manifest and model URLs cannot escape the configured origin set", async () => {
  const manifestEscape = await builtChain();
  manifestEscape.catalog.entries[0].asset.manifestUrl = "https://evil.example/manifest.json";
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(manifestEscape) }), /origin is not allowed/);

  const modelEscape = await builtChain();
  modelEscape.manifest.model.url = "https://evil.example/frame.glb";
  modelEscape.catalog.entries[0].asset.modelUrl = "https://evil.example/frame.glb";
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(modelEscape) }), /origin is not allowed/);
});

test("fails closed when manifest bytes, source hashes, or declared units are altered", async () => {
  const chain = await builtChain();
  const fetchFn = fetchChain(chain);
  const original = await fetchFn(manifestUrl);
  const altered = Buffer.concat([Buffer.from(await original.arrayBuffer()), Buffer.from(" ")]);
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: async (input) => String(input) === manifestUrl ? new Response(altered) : fetchFn(input) }), /manifest SHA-256 mismatch/);

  const sourceMismatch = await builtChain();
  sourceMismatch.manifest.sourceAssetHashes = ["a".repeat(64)];
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(sourceMismatch) }), /source hashes/);

  const unitMismatch = await builtChain();
  unitMismatch.manifest.model.unit = "millimetre";
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(unitMismatch) }), /unit must be metre/);
});

test("fails closed on GLB hash, header, required node, and actual POSITION-byte corruption", async () => {
  const hashMismatch = await builtChain();
  hashMismatch.glb[hashMismatch.glb.length - 1] ^= 1;
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(hashMismatch) }), /GLB SHA-256 mismatch/);

  const badHeader = await builtChain();
  badHeader.glb[0] = 0;
  badHeader.manifest.model.sha256 = hash(badHeader.glb);
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(badHeader) }), /magic header/);

  const missingNode = await builtChain();
  const jsonLength = missingNode.glb.readUInt32LE(12);
  const json = missingNode.glb.subarray(20, 20 + jsonLength).toString("utf8");
  missingNode.glb.write(json.replace("FRAME_ROOT", "FRAME_ROOX"), 20, jsonLength, "utf8");
  missingNode.manifest.model.sha256 = hash(missingNode.glb);
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(missingNode) }), /required node/);

  const badPosition = await builtChain();
  const binaryOffset = 20 + badPosition.glb.readUInt32LE(12) + 8;
  badPosition.glb.writeFloatLE(2, binaryOffset);
  badPosition.manifest.model.sha256 = hash(badPosition.glb);
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(badPosition) }), /accessor bounds do not match POSITION bytes/);
});

test("fails closed on non-finite declared bounds, bufferView escape, and unreachable required nodes", async () => {
  const invalidBounds = await builtChain();
  mutateGlb(invalidBounds, (json) => { json.accessors[0].min[0] = "NaN"; });
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(invalidBounds) }), /bounds must contain finite numbers/);

  const viewEscape = await builtChain();
  mutateGlb(viewEscape, (json) => { json.bufferViews[0].byteLength = 4; });
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(viewEscape) }), /exceed bufferView/);

  const unreachable = await builtChain();
  mutateGlb(unreachable, (json) => { json.nodes[0].children = []; });
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "calibration", fetchFn: fetchChain(unreachable) }), /not reachable from the active scene/);
});

test("unknown catalog JSON is rejected rather than reaching typed validators", async () => {
  const fetchFn = async () => new Response(JSON.stringify({ schemaVersion: 1, tenantId: "x", defaultSku: "x", entries: [null] }));
  await assert.rejects(loadVerifiedRuntimeAsset({ catalogUrl, mode: "qa-preview", fetchFn }), /catalog.entries.0 must be an object/);
});
