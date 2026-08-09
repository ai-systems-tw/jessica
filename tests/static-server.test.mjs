import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("static server emits browser-safe MIME types for runtime assets", async () => {
  const source = await readFile(new URL("../scripts/serve-static.mjs", import.meta.url), "utf8");
  assert.match(source, /\["\.mjs", "text\/javascript; charset=utf-8"\]/);
  assert.match(source, /\["\.wasm", "application\/wasm"\]/);
  assert.match(source, /\["\.glb", "model\/gltf-binary"\]/);
});
