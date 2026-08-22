import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the PostgreSQL 17 acceptance job cannot silently degrade to a skipped or single-session check", async () => {
  const [workflow, packageJson, runner, acceptance] = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-postgres-acceptance.mjs", import.meta.url), "utf8"),
    readFile(new URL("./committed-review-postgres-acceptance.test.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /postgres-17-acceptance:[\s\S]*image: postgres:17\.11-bookworm/);
  assert.match(workflow, /POSTGRES_DB: jessica_acceptance/);
  assert.match(workflow, /JESSICA_POSTGRES_ACCEPTANCE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/jessica_acceptance/);
  assert.match(workflow, /pg_isready -U postgres -d jessica_acceptance/);
  assert.match(workflow, /npm run test:postgres:acceptance/);
  assert.equal(JSON.parse(packageJson).scripts["test:postgres:acceptance"], "npm run build && node scripts/run-postgres-acceptance.mjs");
  assert.match(runner, /JESSICA_POSTGRES_ACCEPTANCE_REQUIRED: "1"/);
  assert.match(runner, /target\.pathname !== "\/jessica_acceptance"/);
  assert.match(acceptance, /\$5::timestamptz,\$5::text/, "event timestamps must not rely on cross-column parameter inference");
  assert.match(acceptance, /\$11::timestamptz,\$11::text/, "authority timestamps must not rely on cross-column parameter inference");
  for (const evidence of ["pg_backend_pid()", "pg_stat_activity", "wait_event === \"advisory\"", "pg_terminate_backend", "removedPids", "revoked", "head-advance", "retired", "rollbackPid", "freshPid", "inspectNonProxyQaPersistencePlanIntegrity"]) assert.match(acceptance, new RegExp(evidence.replace(/[()]/g, "\\$&")));
});
