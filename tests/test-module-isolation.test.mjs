import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("test modules never import another top-level test-registration module", async () => {
  const directory = new URL("./", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".test.mjs"));
  const forbidden = /\b(?:from|import)\s*(?:\(\s*)?["'][^"']+\.test\.mjs["']/g;
  for (const name of files) {
    const source = await readFile(new URL(name, directory), "utf8");
    assert.deepEqual([...source.matchAll(forbidden)].map((match) => match[0]), [], `${name} must import a non-registering helper or fixture instead`);
  }
});
