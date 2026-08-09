import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateSingleFrameAssetIntake } from "../dist/packages/contracts/src/index.js";

test("unfilled J1-M template fails closed with actionable issues", async () => {
  const template = JSON.parse(await readFile(new URL("../fixtures/j1-m/intake.template.json", import.meta.url), "utf8"));
  const issues = validateSingleFrameAssetIntake(template);
  assert.ok(issues.some((issue) => issue.path === "model.measurements.lensWidthMm"));
  assert.ok(issues.some((issue) => issue.path.endsWith("sha256")));
  assert.ok(issues.some((issue) => issue.path === "asset.sourceAssetHashes"));
});

test("complete J1-M intake binds measurements, sources, and approved GLB", () => {
  const kinds = ["front", "left45", "right45", "leftSide", "rightSide", "marking"];
  const sources = kinds.map((kind, index) => ({
    id: `source-${kind}`,
    kind,
    relativePath: `${kind}.jpg`,
    sha256: String(index + 1).repeat(64),
  }));
  const intake = {
    schemaVersion: 1,
    model: {
      id: "j1-m", tenantId: "self", modelCode: "J1-M", name: "J1-M",
      measurements: { lensWidthMm: 52, bridgeWidthMm: 18, templeLengthMm: 145, frameWidthMm: 140, lensHeightMm: 40 },
    },
    sources,
    asset: {
      id: "j1-m-v1", tenantId: "self", frameModelId: "j1-m", version: 1,
      quality: "standard", generationMethod: "manual", modelUrl: "/j1-m/v1/frame.glb", manifestUrl: "/j1-m/v1/manifest.json",
      sourceAssetHashes: sources.map((source) => source.sha256),
      attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      qualityEnvelope: { maxYawDeg: 25, maxPitchDeg: 15, recommendedForLive: true, scaleConfidence: "medium" },
      status: "approved",
    },
  };
  assert.deepEqual(validateSingleFrameAssetIntake(intake), []);
});
