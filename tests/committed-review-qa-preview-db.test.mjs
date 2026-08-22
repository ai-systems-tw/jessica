import assert from "node:assert/strict";
import test from "node:test";
import { verifyCommittedReviewQaPreviewDatabaseAuthorization } from "../scripts/verify-committed-review-qa-preview-db.mjs";

test("v1 through v4 add an exact SELECT-only committed-review QA-preview reader", async () => {
  const result = await verifyCommittedReviewQaPreviewDatabaseAuthorization();
  assert.equal(result.privateTables, 22);
  assert.equal(result.rlsPolicies, 43);
  assert.equal(result.selectedRelations, 10);
  assert.equal(result.assertions, 46);
});
