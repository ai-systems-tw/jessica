import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("capture readiness CLI reports a valid single-image draft separately from G1 readiness", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "jessica-capture-readiness-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sha256 = "a".repeat(64);
  const measurements = {
    lensWidthMm: 52,
    bridgeWidthMm: 18,
    templeLengthMm: 145,
    frameWidthMm: 140,
    lensHeightMm: 41,
  };
  const draft = {
    schemaVersion: 1,
    tenantId: "jessica-internal",
    frameModelId: "candidate-001",
    sources: [{
      id: "candidate-overview",
      tenantId: "jessica-internal",
      frameModelId: "candidate-001",
      kind: "annotatedOverview",
      objectKey: `private/jessica-internal/sources/candidate-overview/${sha256}.jpg`,
      sha256,
      mimeType: "image/jpeg",
      widthPx: 1200,
      heightPx: 800,
      captureMetadata: {},
    }],
    measurementSet: {
      id: "candidate-001-measurements-v1",
      tenantId: "jessica-internal",
      frameModelId: "candidate-001",
      version: 1,
      measurements,
      method: "derived",
    },
    evidence: Object.entries(measurements).map(([field, valueMm]) => ({
      field,
      valueMm,
      method: "annotated-image",
      verification: "unverified",
      sourceSha256: sha256,
      rawLabel: `${valueMm} mm`,
    })),
  };
  const inputPath = join(root, "capture.json");
  await writeFile(inputPath, JSON.stringify(draft));
  const result = spawnSync(
    process.execPath,
    [new URL("../apps/quality-harness/capture-readiness-cli.mjs", import.meta.url).pathname, inputPath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.draftValid, true);
  assert.equal(output.g1Ready, false);
  assert.ok(output.g1Issues.some((issue) => issue.message.includes("G1 front")));
  assert.ok(output.g1Issues.some((issue) => issue.message.includes("verified evidence")));
});
