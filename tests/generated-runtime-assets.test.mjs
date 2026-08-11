import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build emits a structurally valid deterministic calibration GLB", async () => {
  const bytes = await readFile(new URL("../dist/apps/try-on-web/runtime/assets/calibration-frame.glb", import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trim());
  assert.equal(json.asset.version, "2.0");
  assert.equal(json.nodes[0].name, "FRAME_ROOT");
  assert.ok(json.nodes.some((node) => node.name === "CALIBRATION_PROXY_NOT_J1_M"));
  assert.equal(json.accessors[0].count, 396);
  const binaryHeaderOffset = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeaderOffset);
  assert.equal(bytes.readUInt32LE(binaryHeaderOffset + 4), 0x004e4942);
  assert.equal(binaryHeaderOffset + 8 + binaryLength, bytes.length);
});

test("build self-hosts exact browser modules referenced by the import map", async () => {
  const html = await readFile(new URL("../dist/apps/try-on-web/index.html", import.meta.url), "utf8");
  for (const [importMapPath, path] of [
    ["runtime/mediapipe/1.0.1/vision_bundle.mjs", "runtime/mediapipe/1.0.1/vision_bundle.mjs"],
    ["runtime/three/0.185.1/three.module.js", "runtime/three/0.185.1/three.module.js"],
    ["runtime/three/0.185.1/three.module.js", "runtime/three/0.185.1/three.core.js"],
    ["runtime/three/0.185.1/examples/jsm/", "runtime/three/0.185.1/examples/jsm/loaders/GLTFLoader.js"],
  ]) {
    assert.match(html, new RegExp(importMapPath.replaceAll(".", "\\.")));
    const file = await readFile(new URL(`../dist/apps/try-on-web/${path}`, import.meta.url));
    assert.ok(file.length > 0);
  }
  const sharedPackage = await readFile(
    new URL("../dist/apps/try-on-web/packages/contracts/src/index.js", import.meta.url),
    "utf8",
  );
  assert.match(sharedPackage, /export \* from "\.\/units\.js"/);
});
