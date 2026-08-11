import test from "node:test";
import assert from "node:assert/strict";
import { verifyControlPlane } from "../scripts/verify-control-plane-db.mjs";

test("local control-plane migration enforces relational and publication boundaries", async () => {
  const result = await verifyControlPlane();
  assert.equal(result.privateTables, 19);
  assert.equal(result.apiViews, 2);
  assert.equal(result.rlsPolicies, 19);
  assert.equal(result.publicationEvents, 3);
  assert.equal(result.rlsEnforced, true);
  assert.equal(result.assertions, 60);
});
