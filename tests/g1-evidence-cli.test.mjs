import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = new URL("../apps/quality-harness/g1-evidence-cli.mjs", import.meta.url).pathname;

test("G1 evidence CLI returns machine-readable malformed and unknown-input issues", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jessica-g1-evidence-"));
  for (const [name, content, code] of [["malformed.json", "{", "malformed_json"], ["unknown.json", JSON.stringify({ schemaVersion: 1, unexpected: true }), "unknown_field"]]) {
    const path = join(directory, name); await writeFile(path, content);
    const result = spawnSync(process.execPath, [cli, path], { encoding: "utf8" });
    assert.equal(result.status, 2); assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout); assert.equal(output.gateReady, false);
    assert.ok(output.issues.some((issue) => issue.code === code));
  }
});

test("committed canonical authoring template is rejected by promotion CLI", () => {
  const template = new URL("../fixtures/ground-truth/canonical.template.json", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, template], { encoding: "utf8" });
  assert.notEqual(result.status, 0); assert.equal(JSON.parse(result.stdout).canonicalPromotionReady, false);
});

test("missing evidence file reports a sanitized IO issue without leaking its absolute path", () => {
  const missing = join(tmpdir(), "jessica-secret-evidence", "missing.json");
  const result = spawnSync(process.execPath, [cli, missing], { encoding: "utf8" });
  assert.equal(result.status, 2); assert.equal(result.stdout.includes(missing), false);
  assert.equal(JSON.parse(result.stdout).issues[0].code, "io_error");
});
