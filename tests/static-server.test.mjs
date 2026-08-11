import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isPathInsideRoot } from "../scripts/static-path.mjs";

test("static server emits browser-safe MIME types for runtime assets", async () => {
  const source = await readFile(new URL("../scripts/serve-static.mjs", import.meta.url), "utf8");
  assert.match(source, /\["\.mjs", "text\/javascript; charset=utf-8"\]/);
  assert.match(source, /\["\.wasm", "application\/wasm"\]/);
  assert.match(source, /\["\.glb", "model\/gltf-binary"\]/);
  assert.match(source, /"x-content-type-options": "nosniff"/);
  assert.match(source, /"referrer-policy": "no-referrer"/);
  assert.match(source, /"permissions-policy": "camera=\(self\), microphone=\(\), geolocation=\(\)"/);
  assert.match(source, /"cross-origin-resource-policy": "same-origin"/);
  assert.match(source, /"content-length": fileInfo\.size/);
});

test("static path containment rejects traversal and same-prefix sibling roots", () => {
  assert.equal(isPathInsideRoot("/srv/jessica", "/srv/jessica/runtime/model.glb"), true);
  assert.equal(isPathInsideRoot("/srv/jessica", "/srv/jessica"), true);
  assert.equal(isPathInsideRoot("/srv/jessica", "/srv/jessica-private/secret.json"), false);
  assert.equal(isPathInsideRoot("/srv/jessica", "/srv/secret.json"), false);
});
