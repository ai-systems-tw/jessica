import assert from "node:assert/strict";
import test from "node:test";
import { prepareAdmittedRuntime } from "../dist/apps/try-on-web/src/runtimeStartup.js";

test("asset admission failure happens before runtime construction, backend, or renderer initialization", async () => {
  let constructed = 0;
  let initialized = 0;
  await assert.rejects(prepareAdmittedRuntime({
    loadAsset: async () => { throw new Error("public-live admission denied"); },
    createRuntime: () => {
      constructed += 1;
      return { async initialize() { initialized += 1; } };
    },
    canvas: {},
  }), /admission denied/);
  assert.equal(constructed, 0);
  assert.equal(initialized, 0);
});
