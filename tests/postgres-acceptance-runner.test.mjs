import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const RUNNER = fileURLToPath(new URL("../scripts/run-postgres-acceptance.mjs", import.meta.url));
const URLS = {
  JESSICA_POSTGRES_ACCEPTANCE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/jessica_acceptance",
  JESSICA_POSTGRES_EXPIRY_ACCEPTANCE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/jessica_acceptance",
};

for (const envName of Object.keys(URLS)) {
  for (const suffix of ["?host=remote.example", "?port=5433", "?sslmode=disable", "?", "#connection-override", "#"]) {
    test(`the PostgreSQL acceptance runner rejects ${envName} override ${suffix}`, () => {
      const result = spawnSync(process.execPath, [RUNNER], {
        encoding: "utf8",
        env: { ...process.env, ...URLS, [envName]: `${URLS[envName]}${suffix}` },
      });
      assert.equal(result.status, 2);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${envName} must identify the dedicated local jessica_acceptance database\n`);
    });
  }
}
