import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const RUNNER = fileURLToPath(new URL("../scripts/run-postgres-acceptance.mjs", import.meta.url));
const URLS = {
  JESSICA_POSTGRES_ACCEPTANCE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/jessica_acceptance",
  JESSICA_POSTGRES_EXPIRY_ACCEPTANCE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/jessica_acceptance",
  JESSICA_POSTGRES_REPLAY_ACCEPTANCE_URL: "postgresql://postgres:postgres@127.0.0.1:5434/jessica_acceptance",
};
const VALID_CONTAINER_ID = "a".repeat(64);

for (const envName of Object.keys(URLS)) {
  for (const suffix of ["?host=remote.example", "?port=5433", "?sslmode=disable", "?", "#connection-override", "#"]) {
    test(`the PostgreSQL acceptance runner rejects ${envName} override ${suffix}`, () => {
      const result = spawnSync(process.execPath, [RUNNER], {
        encoding: "utf8",
        env: { ...process.env, ...URLS, JESSICA_POSTGRES_REPLAY_CONTAINER_ID: VALID_CONTAINER_ID, [envName]: `${URLS[envName]}${suffix}` },
      });
      assert.equal(result.status, 2);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${envName} must identify the dedicated local jessica_acceptance database\n`);
    });
  }
}

for (const containerId of ["", "abc", "A".repeat(64), "a".repeat(63), `${"a".repeat(64)};exit`]) {
  test(`the PostgreSQL acceptance runner rejects unsafe replay container ID ${JSON.stringify(containerId)}`, () => {
    const result = spawnSync(process.execPath, [RUNNER], {
      encoding: "utf8",
      env: { ...process.env, ...URLS, JESSICA_POSTGRES_REPLAY_CONTAINER_ID: containerId },
    });
    assert.equal(result.status, 2);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "JESSICA_POSTGRES_REPLAY_CONTAINER_ID must be one exact Docker container ID\n");
  });
}
