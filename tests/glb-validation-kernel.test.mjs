import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateGlb } from "../dist/packages/assets/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";

const fixtureUrl = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);
async function fixture() { return JSON.parse(await readFile(fixtureUrl, "utf8")); }

function padded(bytes, paddingByte) {
  const result = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  result.set(bytes); result.fill(paddingByte, bytes.byteLength); return result;
}

function parse(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)).trim());
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  return { json, binary: bytes.slice(binaryHeader + 8, binaryHeader + 8 + binaryLength) };
}

function assemble(json, binaryValue) {
  const jsonBytes = padded(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binary = padded(binaryValue, 0);
  const bytes = new Uint8Array(12 + 8 + jsonBytes.length + 8 + binary.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonBytes.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(jsonBytes, 20);
  const binaryHeader = 20 + jsonBytes.length;
  view.setUint32(binaryHeader, binary.length, true); view.setUint32(binaryHeader + 4, 0x004e4942, true); bytes.set(binary, binaryHeader + 8);
  return bytes;
}

function appendBinary(binary, added) {
  const offset = binary.byteLength;
  const result = new Uint8Array(offset + added.byteLength); result.set(binary); result.set(added, offset);
  return { result, offset };
}

test("actual bounds include only meshes referenced by active-scene reachable nodes", async () => {
  const bundle = await generateProxyBundle(await fixture());
  const { json, binary } = parse(bundle.glb);
  const hiddenFloats = new Uint8Array(36); const hiddenView = new DataView(hiddenFloats.buffer);
  [1,1,1, 2,1,1, 1,2,1].forEach((value, index) => hiddenView.setFloat32(index * 4, value, true));
  const { result, offset } = appendBinary(binary, hiddenFloats);
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: hiddenFloats.byteLength, target: 34962 });
  json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: 3, type: "VEC3", min: [1,1,1], max: [2,2,1] });
  json.meshes.push({ primitives: [{ attributes: { POSITION: json.accessors.length - 1 }, mode: 4 }] });
  json.nodes.push({ name: "HIDDEN_UNREACHABLE", mesh: json.meshes.length - 1 });
  json.buffers[0].byteLength = result.byteLength;
  const validated = validateGlb(assemble(json, result), { requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre", expectedBoundsMetres: bundle.manifest.model.boundsMetres });
  assert.deepEqual(validated.actualBoundsMetres, bundle.manifest.model.boundsMetres);
});

test("a transform on a reachable mesh node cannot bypass expected POSITION bounds", async () => {
  const bundle = await generateProxyBundle(await fixture()); const { json, binary } = parse(bundle.glb);
  json.nodes[1].translation = [1, 0, 0];
  assert.throws(() => validateGlb(assemble(json, binary), {
    requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre", expectedBoundsMetres: bundle.manifest.model.boundsMetres,
  }), /mesh nodes and mesh-affecting ancestors must not contain transforms/);
});

test("a transformed ancestor of reachable meshes fails while transform-only anchor leaves remain supported", async () => {
  const bundle = await generateProxyBundle(await fixture()); const parsed = parse(bundle.glb);
  assert.doesNotThrow(() => validateGlb(bundle.glb, { requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre" }), "generated anchor leaf translations remain admitted");
  parsed.json.nodes[0].matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  assert.throws(() => validateGlb(assemble(parsed.json, parsed.binary), {
    requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre", expectedBoundsMetres: bundle.manifest.model.boundsMetres,
  }), /mesh nodes and mesh-affecting ancestors must not contain transforms/);
});

test("non-triangle primitive modes fail closed", async () => {
  const bundle = await generateProxyBundle(await fixture()); const { json, binary } = parse(bundle.glb);
  json.meshes[0].primitives[0].mode = 1;
  assert.throws(() => validateGlb(assemble(json, binary), { requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre" }), /mode must be TRIANGLES/);
});

test("non-indexed TRIANGLES require a POSITION count divisible by three", async () => {
  const bundle = await generateProxyBundle(await fixture()); const { json, binary } = parse(bundle.glb);
  json.accessors[0].count -= 1;
  assert.throws(() => validateGlb(assemble(json, binary), { requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre" }), /POSITION count must be divisible by 3/);
});

test("indexed TRIANGLES require an index count divisible by three", async () => {
  const bundle = await generateProxyBundle(await fixture()); const { json, binary } = parse(bundle.glb);
  const indexBytes = new Uint8Array(8); const indexView = new DataView(indexBytes.buffer);
  [0, 1, 2, 0].forEach((value, index) => indexView.setUint16(index * 2, value, true));
  const { result, offset } = appendBinary(binary, indexBytes);
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indexBytes.byteLength, target: 34963 });
  json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5123, count: 4, type: "SCALAR" });
  json.meshes[0].primitives[0].indices = json.accessors.length - 1;
  json.buffers[0].byteLength = result.byteLength;
  assert.throws(() => validateGlb(assemble(json, result), { requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre" }), /index count must be divisible by 3/);
});

test("decoded unsigned index bytes cannot exceed the primitive POSITION count", async () => {
  const bundle = await generateProxyBundle(await fixture()); const { json, binary } = parse(bundle.glb);
  const positionCount = json.accessors[0].count;
  const indexBytes = new Uint8Array(8); const indexView = new DataView(indexBytes.buffer);
  indexView.setUint16(0, 0, true); indexView.setUint16(2, 1, true); indexView.setUint16(4, positionCount, true);
  const { result, offset } = appendBinary(binary, indexBytes);
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indexBytes.byteLength, target: 34963 });
  json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5123, count: 3, type: "SCALAR" });
  json.meshes[0].primitives[0].indices = json.accessors.length - 1;
  json.buffers[0].byteLength = result.byteLength;
  assert.throws(() => validateGlb(assemble(json, result), { requiredNodes: bundle.manifest.model.requiredNodes, unit: "metre" }), /index exceeds POSITION accessor count/);
});
