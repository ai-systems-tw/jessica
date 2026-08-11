import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_MATRIX_4,
  metres,
  metresToMm,
  millimetres,
  mmToMetres,
  positiveMillimetres,
  validateAssetVersion,
  validateFrameModel,
  validateRuntimeCatalogEntry,
} from "../dist/packages/contracts/src/index.js";

test("millimetres and metres round-trip", () => {
  const source = millimetres(137.5);
  assert.equal(mmToMetres(source), 0.1375);
  assert.equal(metresToMm(metres(0.1375)), 137.5);
});

test("positive dimensions reject zero and invalid numbers", () => {
  assert.throws(() => positiveMillimetres(0, "frameWidth"), /greater than zero/);
  assert.throws(() => positiveMillimetres(Number.NaN), /finite/);
});

test("frame model validation catches blank ownership and invalid measurements", () => {
  const issues = validateFrameModel({
    id: "frame-1",
    tenantId: "",
    modelCode: "J1-M",
    name: "J1-M",
    measurements: {
      lensWidthMm: millimetres(0),
      bridgeWidthMm: millimetres(18),
      templeLengthMm: millimetres(140),
      frameWidthMm: millimetres(142),
      lensHeightMm: millimetres(42),
    },
  });
  assert.ok(issues.some((issue) => issue.path === "tenantId"));
  assert.ok(issues.some((issue) => issue.path === "measurements.lensWidthMm"));
});

test("asset version validates matrix and envelope", () => {
  const issues = validateAssetVersion({
    id: "asset-1",
    tenantId: "self",
    frameModelId: "j1-m",
    version: 1,
    quality: "standard",
    generationMethod: "manual",
    modelUrl: "https://example.test/frame.glb",
    manifestUrl: "https://example.test/manifest.json",
    sourceAssetHashes: ["sha256:test"],
    attachmentMatrix: IDENTITY_MATRIX_4,
    qualityEnvelope: {
      maxYawDeg: 25,
      maxPitchDeg: 15,
      recommendedForLive: true,
      scaleConfidence: "medium",
    },
    status: "approved",
  });
  assert.deepEqual(issues, []);
});

test("asset version rejects malformed tier, status, live flag, and minimum scale rank", () => {
  const issues = validateAssetVersion({
    id: "asset-1", tenantId: "self", frameModelId: "j1-m", version: 1,
    quality: "gold", generationMethod: "manual", modelUrl: "frame.glb", manifestUrl: "manifest.json",
    sourceAssetHashes: [], attachmentMatrix: IDENTITY_MATRIX_4,
    qualityEnvelope: { maxYawDeg: 25, maxPitchDeg: 15, recommendedForLive: "yes", scaleConfidence: "excellent" },
    status: "online",
  });
  assert.deepEqual(issues.map((issue) => issue.path), [
    "qualityEnvelope.recommendedForLive",
    "qualityEnvelope.scaleConfidence",
    "quality",
    "status",
  ]);
});

test("catalog ownership must be consistent", () => {
  const model = {
    id: "j1-m",
    tenantId: "self",
    modelCode: "J1-M",
    name: "J1-M",
    measurements: {
      lensWidthMm: millimetres(52),
      bridgeWidthMm: millimetres(18),
      templeLengthMm: millimetres(140),
      frameWidthMm: millimetres(142),
      lensHeightMm: millimetres(42),
    },
  };
  const entry = {
    schemaVersion: 1,
    tenantId: "self",
    model,
    variant: {
      id: "variant-1",
      tenantId: "other",
      frameModelId: "j1-m",
      sku: "J1-M-BLACK-CLEAR",
      frameColor: "black/clear",
      frameMaterial: "combination",
      lensType: "clear",
    },
    asset: {
      id: "asset-1",
      tenantId: "self",
      frameModelId: "j1-m",
      version: 1,
      quality: "standard",
      generationMethod: "manual",
      modelUrl: "https://example.test/frame.glb",
      manifestUrl: "https://example.test/manifest.json",
      sourceAssetHashes: ["sha256:test"],
      attachmentMatrix: IDENTITY_MATRIX_4,
      qualityEnvelope: {
        maxYawDeg: 25,
        maxPitchDeg: 15,
        recommendedForLive: true,
        scaleConfidence: "medium",
      },
      status: "approved",
    },
  };
  const issues = validateRuntimeCatalogEntry(entry);
  assert.ok(issues.some((issue) => issue.path === "tenantId"));
});
