import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES,
  composeUnverifiedCommittedReviewQaPreviewBundle,
  parseUnverifiedCommittedReviewQaPreviewBundle,
  parseUnverifiedCommittedReviewQaPreviewBundleContainer,
} from "../dist/packages/assets/src/index.js";
import {
  COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES,
  canonicalJson,
  parseUnverifiedCommittedReviewQaPreviewBundleEnvelope,
  sha256Hex,
  unverifiedCommittedReviewQaPreviewBundleEnvelopePayload,
} from "../dist/packages/contracts/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";

const H = (character) => character.repeat(64);
const SIGNATURE = Buffer.alloc(64).toString("base64");

const proxyInputUrl = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);

function transport() {
  return {
    schemaVersion: 1, type: "jessica.committed-review-qa-preview-unverified-grant", algorithm: "ES256", scope: "qa-preview:runtime:one-shot",
    issuerAuthorityId: "transport-authority-a", keyId: "transport-key-a", grantId: H("1"), requestId: H("2"), audience: "https://qa-preview.example",
    tenantId: "tenant-a", actorId: "actor-a", reviewerId: "reviewer-a", sessionId: "session-a",
    selection: { tenantId: "tenant-a", assetVersionId: "asset-a", assetVersion: 1 },
    commitment: { assetRowSha256: H("3"), bindingRowSha256: H("4"), reviewRowSha256: H("5"), authorityRowSha256: H("6") },
    committedReviewValidUntil: "2030-08-22T00:10:00.000Z", issuedAt: "2030-08-22T00:00:00.000Z", notBefore: "2030-08-22T00:00:00.000Z", expiresAt: "2030-08-22T00:00:30.000Z",
    evidence: { kind: "committed-review-binding", verification: "required", runtimeUsable: false, publicLiveUsable: false },
  };
}

function projection() {
  return {
    id: "asset-a", tenantId: "tenant-a", frameModelId: "frame-model-a", frameVariantId: "frame-variant-a", version: 1,
    quality: "standard", generationMethod: "standard-auto", status: "approved", fixture: false,
    sourceAssetHashes: [H("a")], attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    qualityEnvelope: { maxYawDeg: 30, maxPitchDeg: 20, recommendedForLive: false, scaleConfidence: "high" },
  };
}

async function validParts() {
  const generated = await generateProxyBundle(JSON.parse(await readFile(proxyInputUrl, "utf8")));
  const manifest = structuredClone(generated.manifest);
  manifest.assetId = "asset-a"; manifest.assetVersion = 1; manifest.fixture = false; manifest.model.url = "./model.glb"; manifest.sourceAssetHashes = [H("a")];
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const transportPayload = transport();
  const envelope = {
    schemaVersion: 1, type: "jessica.committed-review-qa-preview-unverified-bundle-envelope", algorithm: "ES256", scope: "qa-preview:runtime:one-shot",
    bundleSignerAuthorityId: "bundle-authority-a", bundleSignerKeyId: "bundle-key-a", composedAt: "2030-08-22T00:00:01.000Z", transportGrantSha256: await sha256Hex(new TextEncoder().encode(canonicalJson({ ...transportPayload, signatureBase64: SIGNATURE }))), transport: transportPayload, runtimeAssetProjection: projection(),
    manifest: { contentType: "application/json", sha256: await sha256Hex(manifestBytes), byteLength: manifestBytes.byteLength },
    model: { contentType: "model/gltf-binary", sha256: await sha256Hex(generated.glb), byteLength: generated.glb.byteLength },
    evidence: { verification: "required", artifactContainerOnly: true, browserRuntimeUsable: false, publicLiveUsable: false }, signatureBase64: SIGNATURE,
  };
  return { envelope, manifest, manifestBytes, modelBytes: generated.glb };
}

function sections(bundle) {
  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  const envelopeLength = view.getUint32(8, false); const manifestLength = view.getUint32(12, false); const modelLength = view.getUint32(16, false);
  return { envelopeLength, manifestLength, modelLength, envelopeOffset: COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES, manifestOffset: COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES + envelopeLength, modelOffset: COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_HEADER_BYTES + envelopeLength + manifestLength };
}

function padded(bytes, paddingByte) { const output = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4); output.set(bytes); output.fill(paddingByte, bytes.byteLength); return output; }
function mutateGlb(glb, mutate) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength); const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)).trim()); const binHeader = 20 + jsonLength; const binLength = view.getUint32(binHeader, true); const binary = glb.slice(binHeader + 8, binHeader + 8 + binLength); mutate(json);
  const jsonBytes = padded(new TextEncoder().encode(JSON.stringify(json)), 0x20); const bytes = new Uint8Array(12 + 8 + jsonBytes.length + 8 + binary.length); const output = new DataView(bytes.buffer);
  output.setUint32(0, 0x46546c67, true); output.setUint32(4, 2, true); output.setUint32(8, bytes.length, true); output.setUint32(12, jsonBytes.length, true); output.setUint32(16, 0x4e4f534a, true); bytes.set(jsonBytes, 20);
  const outputBinHeader = 20 + jsonBytes.length; output.setUint32(outputBinHeader, binary.length, true); output.setUint32(outputBinHeader + 4, 0x004e4942, true); bytes.set(binary, outputBinHeader + 8); return bytes;
}

test("JQAPB001 uses exact bounded big-endian sections and remains explicitly unverified", async () => {
  const parts = await validParts(); const bundle = await composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes); const parsed = await parseUnverifiedCommittedReviewQaPreviewBundle(bundle); const layout = sections(bundle);
  assert.equal(new TextDecoder().decode(bundle.slice(0, 8)), "JQAPB001");
  assert.equal(bundle.byteLength, 20 + layout.envelopeLength + layout.manifestLength + layout.modelLength);
  assert.equal(layout.manifestLength, parts.manifestBytes.byteLength); assert.equal(layout.modelLength, parts.modelBytes.byteLength);
  assert.deepEqual(parsed.envelope, parseUnverifiedCommittedReviewQaPreviewBundleEnvelope(parts.envelope));
  assert.deepEqual(parsed.envelope.evidence, { verification: "required", artifactContainerOnly: true, browserRuntimeUsable: false, publicLiveUsable: false });
  assert.equal("authority" in parsed.envelope, false); assert.equal("signatureBase64" in unverifiedCommittedReviewQaPreviewBundleEnvelopePayload(parsed.envelope), false);
  assert.equal(parsed.envelope.bundleSignerKeyId, "bundle-key-a"); assert.equal(parsed.envelope.transport.keyId, "transport-key-a");
  assert.equal(JSON.stringify(parsed.envelope).includes("https://private"), false);
});

test("bounded container parsing leaves artifact traversal until after trust verification", async () => {
  const parts = await validParts();
  const bundle = await composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes);
  bundle[bundle.length - 1] ^= 1;
  const container = parseUnverifiedCommittedReviewQaPreviewBundleContainer(bundle);
  assert.equal(container.envelope.transport.requestId, H("2"));
  const retainedLastByte = container.modelBytes[container.modelBytes.length - 1];
  bundle[bundle.length - 1] ^= 1;
  assert.equal(container.modelBytes[container.modelBytes.length - 1], retainedLastByte, "container sections are owned snapshots");
  await parseUnverifiedCommittedReviewQaPreviewBundle(bundle);
  const tampered = await composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(parseUnverifiedCommittedReviewQaPreviewBundle(tampered), /SHA-256|GLB/);
});

test("magic, unsigned length overflow, truncation, and trailing bytes fail closed", async () => {
  const parts = await validParts(); const bundle = await composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes);
  const badMagic = bundle.slice(); badMagic[0] ^= 0xff;
  const overflow = bundle.slice(); new DataView(overflow.buffer).setUint32(8, 0xffffffff, false);
  const overLimit = bundle.slice(); new DataView(overLimit.buffer).setUint32(8, COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_MAX_ENVELOPE_BYTES + 1, false);
  const zero = bundle.slice(); new DataView(zero.buffer).setUint32(12, 0, false);
  for (const candidate of [bundle.slice(0, 19), badMagic, overflow, overLimit, zero, bundle.slice(0, -1), Uint8Array.from([...bundle, 0])]) await assert.rejects(parseUnverifiedCommittedReviewQaPreviewBundle(candidate), TypeError);
});

test("noncanonical envelope and every artifact hash or length mismatch fail closed", async () => {
  const parts = await validParts(); const bundle = await composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes); const layout = sections(bundle);
  const changedModel = bundle.slice(); changedModel[changedModel.length - 1] ^= 1; await assert.rejects(parseUnverifiedCommittedReviewQaPreviewBundle(changedModel), /SHA-256|GLB/);
  const changedManifest = bundle.slice(); changedManifest[layout.manifestOffset] ^= 1; await assert.rejects(parseUnverifiedCommittedReviewQaPreviewBundle(changedManifest));
  await assert.rejects(composeUnverifiedCommittedReviewQaPreviewBundle({ ...parts.envelope, model: { ...parts.envelope.model, sha256: H("f") } }, parts.manifestBytes, parts.modelBytes), /evidence does not match/);
  const prettyEnvelope = new TextEncoder().encode(JSON.stringify(parts.envelope, null, 1)); const noncanonical = new Uint8Array(20 + prettyEnvelope.length + parts.manifestBytes.length + parts.modelBytes.length); noncanonical.set(new TextEncoder().encode("JQAPB001")); const header = new DataView(noncanonical.buffer); header.setUint32(8, prettyEnvelope.length, false); header.setUint32(12, parts.manifestBytes.length, false); header.setUint32(16, parts.modelBytes.length, false); noncanonical.set(prettyEnvelope, 20); noncanonical.set(parts.manifestBytes, 20 + prettyEnvelope.length); noncanonical.set(parts.modelBytes, 20 + prettyEnvelope.length + parts.manifestBytes.length);
  await assert.rejects(parseUnverifiedCommittedReviewQaPreviewBundle(noncanonical), /not canonical/);
});

test("hostile typed-array shadow accessors are never invoked", async () => {
  const parts = await validParts(); const bundle = await composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes); let getterCalls = 0;
  for (const key of ["byteLength", "byteOffset", "buffer"]) Object.defineProperty(bundle, key, { configurable: true, get: () => { getterCalls += 1; throw new Error("hostile getter"); } });
  const parsed = await parseUnverifiedCommittedReviewQaPreviewBundle(bundle); assert.equal(parsed.manifest.assetId, "asset-a"); assert.equal(getterCalls, 0);
});

test("private, absolute, traversal, query, fragment, backslash, and noncanonical model locators never enter a bundle", async () => {
  for (const locator of ["https://private.example/model.glb", "../model.glb", "./model.glb?token=secret", "./model.glb#fragment", ".\\model.glb", "./calibration-frame.glb", "/private/model.glb"]) {
    const parts = await validParts(); parts.manifest.model.url = locator; parts.manifestBytes = new TextEncoder().encode(canonicalJson(parts.manifest)); parts.envelope.manifest = { ...parts.envelope.manifest, sha256: await sha256Hex(parts.manifestBytes), byteLength: parts.manifestBytes.length };
    await assert.rejects(composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes), /locator/);
  }
});

test("external GLB URIs and all extension surfaces fail even when hashes are internally consistent", async () => {
  for (const mutate of [
    (json) => { json.buffers[0].uri = "private.bin"; },
    (json) => { json.images = [{ uri: "https://private.example/secret.png" }]; },
    (json) => { json.images = [{ uri: "data:image/png;base64,AAAA" }]; },
    (json) => { json.extensionsUsed = ["KHR_draco_mesh_compression"]; },
    (json) => { json.nodes[0].extensions = { EXT_private: {} }; },
  ]) {
    const parts = await validParts(); parts.modelBytes = mutateGlb(parts.modelBytes, mutate); parts.manifest.model.sha256 = await sha256Hex(parts.modelBytes); parts.manifest.model.byteLength = parts.modelBytes.byteLength; parts.manifestBytes = new TextEncoder().encode(canonicalJson(parts.manifest)); parts.envelope.manifest = { ...parts.envelope.manifest, sha256: await sha256Hex(parts.manifestBytes), byteLength: parts.manifestBytes.byteLength }; parts.envelope.model = { ...parts.envelope.model, sha256: parts.manifest.model.sha256, byteLength: parts.modelBytes.byteLength };
    await assert.rejects(composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes), /forbids external URI and extension surfaces/);
  }
});

test("extension scan is depth-bounded instead of recursively exhausting the stack", async () => {
  const parts = await validParts(); parts.modelBytes = mutateGlb(parts.modelBytes, (json) => { let cursor = json; for (let index = 0; index < 130; index += 1) { cursor.extras = {}; cursor = cursor.extras; } });
  parts.manifest.model.sha256 = await sha256Hex(parts.modelBytes); parts.manifest.model.byteLength = parts.modelBytes.byteLength; parts.manifestBytes = new TextEncoder().encode(canonicalJson(parts.manifest)); parts.envelope.manifest = { ...parts.envelope.manifest, sha256: await sha256Hex(parts.manifestBytes), byteLength: parts.manifestBytes.byteLength }; parts.envelope.model = { ...parts.envelope.model, sha256: parts.manifest.model.sha256, byteLength: parts.modelBytes.byteLength };
  await assert.rejects(composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes), /structural complexity/);
});

test("extension scan rejects over-wide arrays and objects without width-sized traversal queues", async () => {
  for (const mutate of [
    (json) => { json.extras = Array.from({ length: 100_001 }, () => null); },
    (json) => { json.extras = Object.fromEntries(Array.from({ length: 100_001 }, (_, index) => [`field${index}`, null])); },
  ]) {
    const parts = await validParts(); parts.modelBytes = mutateGlb(parts.modelBytes, mutate); parts.manifest.model.sha256 = await sha256Hex(parts.modelBytes); parts.manifest.model.byteLength = parts.modelBytes.byteLength; parts.manifestBytes = new TextEncoder().encode(canonicalJson(parts.manifest)); parts.envelope.manifest = { ...parts.envelope.manifest, sha256: await sha256Hex(parts.manifestBytes), byteLength: parts.manifestBytes.byteLength }; parts.envelope.model = { ...parts.envelope.model, sha256: parts.manifest.model.sha256, byteLength: parts.modelBytes.byteLength };
    await assert.rejects(composeUnverifiedCommittedReviewQaPreviewBundle(parts.envelope, parts.manifestBytes, parts.modelBytes), /structural complexity/);
  }
});

test("URL-free runtime projection is exact, selection-bound, non-fixture, and manifest-bound", async () => {
  const parts = await validParts();
  assert.throws(() => parseUnverifiedCommittedReviewQaPreviewBundleEnvelope({ ...parts.envelope, issuerAuthorityId: "alias" }), TypeError);
  assert.throws(() => parseUnverifiedCommittedReviewQaPreviewBundleEnvelope({ ...parts.envelope, runtimeAssetProjection: { ...parts.envelope.runtimeAssetProjection, id: "asset-b" } }), /transport selection/);
  assert.throws(() => parseUnverifiedCommittedReviewQaPreviewBundleEnvelope({ ...parts.envelope, runtimeAssetProjection: { ...parts.envelope.runtimeAssetProjection, fixture: true } }), TypeError);
  assert.throws(() => parseUnverifiedCommittedReviewQaPreviewBundleEnvelope({ ...parts.envelope, runtimeAssetProjection: { ...parts.envelope.runtimeAssetProjection, sourceAssetHashes: [H("b"), H("a")] } }), /unique and sorted/);
  assert.throws(() => parseUnverifiedCommittedReviewQaPreviewBundleEnvelope({ ...parts.envelope, composedAt: parts.envelope.transport.expiresAt }), /outside/);
  assert.throws(() => parseUnverifiedCommittedReviewQaPreviewBundleEnvelope({ ...parts.envelope, transportGrantSha256: H("A") }), TypeError);
  await assert.rejects(composeUnverifiedCommittedReviewQaPreviewBundle({ ...parts.envelope, runtimeAssetProjection: { ...parts.envelope.runtimeAssetProjection, sourceAssetHashes: [H("b")] } }, parts.manifestBytes, parts.modelBytes), /does not match manifest/);
  const serialized = JSON.stringify(parts.envelope.runtimeAssetProjection); for (const forbidden of ["Url", "url", "path", "token", "credential"]) assert.equal(serialized.includes(forbidden), false);
});
