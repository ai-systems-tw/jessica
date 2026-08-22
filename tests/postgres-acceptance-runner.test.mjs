import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const RUNNER = fileURLToPath(new URL("../scripts/run-postgres-acceptance.mjs", import.meta.url));
const REFUSAL = "JESSICA_POSTGRES_ACCEPTANCE_URL must identify the dedicated local jessica_acceptance database\n";

for (const suffix of ["?host=remote.example", "?port=5433", "?sslmode=disable", "?", "#connection-override", "#"]) {
  test(`the PostgreSQL acceptance runner rejects URL override ${suffix}`, () => {
    const result = spawnSync(process.execPath, [RUNNER], {
      encoding: "utf8",
      env: {
        ...process.env,
        JESSICA_POSTGRES_ACCEPTANCE_URL: `postgresql://postgres:postgres@127.0.0.1:5432/jessica_acceptance${suffix}`,
      },
    });
    assert.equal(result.status, 2);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, REFUSAL);
  });
}
