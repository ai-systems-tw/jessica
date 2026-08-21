import assert from "node:assert/strict";
import test from "node:test";
import { verifyNonProxyQaControlPlane } from "../scripts/verify-non-proxy-qa-db.mjs";

test("v1 to v2 to v3 adds fail-closed trusted non-Proxy QA writer storage and exact role grants", async () => {
  const result = await verifyNonProxyQaControlPlane(); assert.equal(result.privateTables, 22); assert.equal(result.rlsPolicies, 33); assert.equal(result.assertions, 170); assert.equal(result.residual, "The NOBYPASSRLS credentialless writer is a trusted-server TCB role: SQL constrains its relational path but the application must still establish ES256/JWK/host-policy trust and canonical digests; compromise of a future production login or parent membership loses that authority");
});
