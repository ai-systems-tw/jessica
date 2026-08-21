import assert from "node:assert/strict";
import test from "node:test";
import { verifyNonProxyQaControlPlane } from "../scripts/verify-non-proxy-qa-db.mjs";

test("fresh v1 to v2 control plane adds private fail-closed non-Proxy QA persistence", async () => {
  const result = await verifyNonProxyQaControlPlane(); assert.equal(result.privateTables, 22); assert.equal(result.rlsPolicies, 19); assert.equal(result.assertions, 58); assert.equal(result.residual, "SQL enforces relational equality, append-only, policy age/freshness equality, and transition invariants but does not establish ES256 trust, JWK fingerprints, canonical payload/row/source-set/asset digests, or host review-policy trust");
});
