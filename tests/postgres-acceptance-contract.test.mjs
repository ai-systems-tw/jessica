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
  assert.match(workflow, /postgres-17-acceptance:[\s\S]*timeout-minutes: 10/);
  assert.match(workflow, /image: postgres:17\.11-bookworm@sha256:84560e3b9c6874893fc4e2854f5dc3e7c1a37bc9d1dfd7a8c641310ae22ba5ad/);
  assert.match(workflow, /POSTGRES_DB: jessica_acceptance/);
  assert.match(workflow, /JESSICA_POSTGRES_ACCEPTANCE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/jessica_acceptance/);
  assert.match(workflow, /pg_isready -U postgres -d jessica_acceptance/);
  assert.match(workflow, /npm run test:postgres:acceptance/);
  assert.equal(JSON.parse(packageJson).scripts["test:postgres:acceptance"], "npm run build && node scripts/run-postgres-acceptance.mjs");
  assert.match(runner, /JESSICA_POSTGRES_ACCEPTANCE_REQUIRED: "1"/);
  assert.match(runner, /target\.pathname !== "\/jessica_acceptance"/);
  assert.match(runner, /const hasQuery = target\.href\.includes\("\?"\)/);
  assert.match(runner, /const hasFragment = target\.href\.includes\("#"\)/);
  assert.match(acceptance, /const CONNECTION_TIMEOUT_MS = 5_000/);
  assert.equal((acceptance.match(/connectionTimeoutMillis: CONNECTION_TIMEOUT_MS/g) ?? []).length, 3);
  for (const emptyDatabaseGuard of ["user_schemas_absent", "public_classes_absent", "public_procs_absent", "public_types_absent"]) assert.match(acceptance, new RegExp(emptyDatabaseGuard));
  assert.match(acceptance, /\$5::timestamptz,\$6::text/, "event timestamp values and canonical spellings must use distinct typed parameters");
  assert.match(acceptance, /\$11::timestamptz,\$12::text/, "authority timestamp values and canonical spellings must use distinct typed parameters");
  for (const evidence of ["pg_backend_pid()", "pg_stat_activity", "wait_event === \"advisory\"", "pg_terminate_backend", "readerPool.totalCount", "revoked", "head-advance", "retired", "rollbackPid", "freshPid", "statement_timeout", "57014", "REVIEW_EXPIRY_WINDOW_MS", "effectiveValidUntil", "inspectNonProxyQaPersistencePlanIntegrity"]) assert.match(acceptance, new RegExp(evidence.replace(/[()]/g, "\\$&")));
});
