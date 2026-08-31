import assert from "node:assert/strict";
import test from "node:test";

import { verifyCommittedReviewQaPreviewReplayDatabaseAuthorization } from "../scripts/verify-committed-review-qa-preview-replay-db.mjs";

test("v1 through v5 add one permanent append-only committed-review QA-preview replay tombstone boundary", async () => {
  const result = await verifyCommittedReviewQaPreviewReplayDatabaseAuthorization();
  assert.equal(result.privateTables, 23);
  assert.equal(result.rlsPolicies, 45);
  assert.equal(result.replayRelations, 1);
  assert.equal(result.assertions, 59);
});
