import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateGlb } from "../dist/packages/assets/src/index.js";
import {
  authorProxyGeneratorInput,
  generateProxyBundle,
  PROXY_REQUIRED_NODES,
} from "../dist/packages/frame-generation/src/index.js";
import { createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { prepareProxyAutoWork } from "../dist/packages/processing-worker/src/index.js";
import { evaluateAssetAdmission } from "../dist/packages/runtime/src/index.js";

const fixtureUrl = new URL("../fixtures/frame-generation/proxy-input-authoring.synthetic.json", import.meta.url);
async function fixture() { return JSON.parse(await readFile(fixtureUrl, "utf8")); }
async function authored(value = undefined) {
  const data = value ?? await fixture();
  return authorProxyGeneratorInput(data.captureDraft, data.authoring);
}

function manualTraceProfile() {
  return {
    method: "manual-image-trace",
    sourceId: "synthetic-front-trace",
    regionPx: { x: 120, y: 60, width: 160, height: 80 },
    coordinateRules: { originPx: [200, 100], millimetresPerPixel: 1, xAxis: "right", yAxis: "up" },
    tracePx: {
      leftLens: {
        outer: [[139,110],[148,119],[182,119],[191,110],[191,90],[182,81],[148,81],[139,90]],
        inner: [[143,108],[143,92],[150,85],[180,85],[187,92],[187,108],[180,115],[150,115]],
      },
      rightLens: {
        outer: [[209,110],[218,119],[252,119],[261,110],[261,90],[252,81],[218,81],[209,90]],
        inner: [[213,108],[213,92],[220,85],[250,85],[257,92],[257,108],[250,115],[220,115]],
      },
      bridgeAnchors: { left: [191,100], right: [209,100] },
      hingeAnchors: { left: [132,100], right: [268,100] },
    },
  };
}

test("dimension-template bridge derives strict input and deterministic shared-valid GLB", async () => {
  const first = await authored(); const second = await authored();
  assert.deepEqual(first, second);
  assert.equal(first.input.candidate.tenantId, "synthetic-fixture-tenant");
  assert.equal(first.input.candidate.frameModelId, "synthetic-octagon-model");
  assert.deepEqual(first.input.sourceAssetHashes, ["a".repeat(64), "b".repeat(64)]);
  assert.equal(first.provenance.profile.contourFidelity, false);
  assert.deepEqual(first.input.authoringEvidence.profile.body, { templateId: "synthetic-octagon-v1", templateVersion: 1 });
  assert.match(first.provenance.profile.limitations[0], /no image contour-fidelity claim/);
  assert.deepEqual(first.provenance.authority, { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false });
  const firstBundle = await generateProxyBundle(first.input); const secondBundle = await generateProxyBundle(second.input);
  assert.equal(first.canonicalInputSha256, firstBundle.canonicalInputSha256);
  assert.deepEqual(firstBundle.glb, secondBundle.glb);
  assert.deepEqual(firstBundle.manifest.proxyGeneration.authoringEvidence, first.input.authoringEvidence);
  assert.equal(firstBundle.manifest.proxyGeneration.authoringEvidence.thickness.kind, "non-physical-proxy-assumption");
  assert.ok(firstBundle.manifest.proxyGeneration.limitations.includes(first.input.authoringEvidence.thickness.limitations[0]));
  validateGlb(firstBundle.glb, { requiredNodes: PROXY_REQUIRED_NODES, unit: "metre", expectedBoundsMetres: firstBundle.manifest.model.boundsMetres });
});

test("evidenced thickness preserves source/raw label/region identity while assumptions remain explicitly non-physical", async () => {
  const data = await fixture();
  const assumed = await authored(data);
  assert.equal(assumed.provenance.thickness, "non-physical-proxy-assumption");
  assert.equal(assumed.input.measurementSet.dimensionsMm.frameThickness, 4);
  data.authoring.thickness = { kind: "evidenced", sourceId: "synthetic-annotated-overview", valueMm: 4, method: "annotated-image", verification: "unverified", rawLabel: "SYNTHETIC THICKNESS 4 mm", regionPx: { x: 110, y: 10, width: 120, height: 18 } };
  const evidenced = await authored(data);
  assert.equal(evidenced.provenance.thickness, "evidenced");
  assert.deepEqual(evidenced.input.authoringEvidence.thickness, { kind: "evidenced", valueMm: 4, method: "annotated-image", verification: "unverified", rawLabel: "SYNTHETIC THICKNESS 4 mm", regionPx: { x: 110, y: 10, width: 120, height: 18 }, sourceSha256: "a".repeat(64), sourcePixelGeometry: data.captureDraft.sources[0].pixelGeometry });
  assert.notEqual(evidenced.provenance.measurementEvidenceSha256, assumed.provenance.measurementEvidenceSha256);
  for (const mutate of [
    (copy) => { copy.authoring.thickness.rawLabel = "SYNTHETIC THICKNESS 4.0 mm"; },
    (copy) => { copy.authoring.thickness.regionPx.x += 1; },
    (copy) => { copy.authoring.thickness.sourceId = "synthetic-front-trace"; },
  ]) {
    const copy = structuredClone(data); mutate(copy);
    assert.notEqual((await authored(copy)).canonicalInputSha256, evidenced.canonicalInputSha256);
  }
});

test("manual image trace is source/region/coordinate-bound before millimetre validation", async () => {
  const data = await fixture(); data.authoring.profile = manualTraceProfile();
  const result = await authored(data);
  assert.equal(result.provenance.profile.method, "manual-image-trace");
  assert.equal(result.provenance.profile.sourceSha256, "b".repeat(64));
  assert.deepEqual(result.input.authoringEvidence.profile.body, {
    sourceSha256: "b".repeat(64), sourcePixelGeometry: data.captureDraft.sources[1].pixelGeometry, regionPx: data.authoring.profile.regionPx,
    coordinateRules: data.authoring.profile.coordinateRules, tracePx: data.authoring.profile.tracePx,
  });
  assert.deepEqual(result.input.profile.leftLens.outer[0], [-61, -10]);
  assert.deepEqual(result.input.profile.bridgeAnchors.left, [-9, 0]);
  await assert.rejects(async () => {
    const copy = structuredClone(data); copy.authoring.profile.sourceId = "unknown"; await authored(copy);
  }, /bind a source id/);
  await assert.rejects(async () => {
    const copy = structuredClone(data); copy.authoring.profile.regionPx.width = 20; await authored(copy);
  }, /inside profile.regionPx/);
  await assert.rejects(async () => {
    const copy = structuredClone(data); copy.authoring.profile.tracePx.hingeAnchors.right = [280, 100]; await authored(copy);
  }, /inside profile.regionPx/);
  await assert.rejects(async () => {
    const copy = structuredClone(data); copy.authoring.profile.coordinateRules.originPx = [200.5, 100]; await authored(copy);
  }, /integer/);
  await assert.rejects(async () => {
    const copy = structuredClone(data); copy.authoring.profile = { method: "manual-image-trace", millimetreProfile: result.input.profile }; await authored(copy);
  }, /not allowed|required|unbound/);
});

test("capture/evidence/profile/candidate/generator mutation matrix changes canonical identity", async () => {
  const baselineData = await fixture(); const baseline = await authored(baselineData);
  const mutations = [
    (copy) => { copy.captureDraft.sources[0].sha256 = "c".repeat(64); copy.captureDraft.evidence.forEach((item) => { if (item.sourceSha256 === "a".repeat(64)) item.sourceSha256 = "c".repeat(64); }); },
    (copy) => { copy.captureDraft.measurementSet.measurements.templeLengthMm = 146; const evidence = copy.captureDraft.evidence.find((item) => item.field === "templeLengthMm"); evidence.valueMm = 146; evidence.rawLabel = "SYNTHETIC 146 mm"; },
    (copy) => { copy.captureDraft.evidence[0].rawLabel = "SYNTHETIC LENS WIDTH 52 mm"; },
    (copy) => { copy.authoring.thickness.reason += " Synthetic mutation."; },
    (copy) => { copy.authoring.profile.templateVersion = 2; },
    (copy) => { copy.authoring.profile = manualTraceProfile(); },
    (copy) => { copy.authoring.candidate.assetVersion = 2; },
    (copy) => { copy.authoring.candidate.frameVariantId = "synthetic-octagon-variant-b"; },
    (copy) => { copy.authoring.generator.configSha256 = "e".repeat(64); },
    (copy) => { copy.captureDraft.sources[0].widthPx = 401; copy.captureDraft.sources[0].pixelGeometry.encodedWidthPx = 401; copy.captureDraft.sources[0].pixelGeometry.displayWidthPx = 401; },
    (copy) => { copy.captureDraft.sources[1].heightPx = 241; copy.captureDraft.sources[1].pixelGeometry.encodedHeightPx = 241; copy.captureDraft.sources[1].pixelGeometry.displayHeightPx = 241; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(baselineData); mutate(copy);
    assert.notEqual((await authored(copy)).canonicalInputSha256, baseline.canonicalInputSha256);
  }
  const reordered = structuredClone(baselineData); reordered.captureDraft.sources.reverse();
  assert.equal((await authored(reordered)).canonicalInputSha256, baseline.canonicalInputSha256);
});

test("manual trace source and otherwise geometry-neutral profile evidence mutations remain digest-bound", async () => {
  const data = await fixture(); data.authoring.profile = manualTraceProfile();
  const baseline = await authored(data);
  const regionMutation = structuredClone(data); regionMutation.authoring.profile.regionPx.x -= 1;
  assert.notEqual((await authored(regionMutation)).canonicalInputSha256, baseline.canonicalInputSha256);
  const sourceMutation = structuredClone(data); sourceMutation.authoring.profile.sourceId = "synthetic-annotated-overview";
  assert.notEqual((await authored(sourceMutation)).canonicalInputSha256, baseline.canonicalInputSha256);
  const pointMutation = structuredClone(baseline.input); pointMutation.authoringEvidence.profile.body.tracePx.leftLens.outer[0][0] += 1;
  await assert.rejects(generateProxyBundle(pointMutation), /profile must exactly match|evidenceSha256/);
});

test("numeric transcription tokens match values without performing OCR", async () => {
  for (const rawLabel of ["SYNTHETIC WIDTH", "SYNTHETIC 51 mm"]) {
    const copy = await fixture(); copy.captureDraft.evidence[0].rawLabel = rawLabel;
    await assert.rejects(authorProxyGeneratorInput(copy.captureDraft, copy.authoring), /ASCII numeric token equal to valueMm/);
  }
  const decimal = await fixture();
  decimal.captureDraft.measurementSet.measurements.lensWidthMm = 52.5;
  decimal.captureDraft.evidence[0].valueMm = 52.5;
  decimal.captureDraft.evidence[0].rawLabel = "52.50 mm";
  assert.equal((await authored(decimal)).input.measurementSet.dimensionsMm.lensWidth, 52.5);

  const composite = await fixture();
  for (const evidence of composite.captureDraft.evidence) evidence.rawLabel = "52□18-145 140/38";
  composite.authoring.thickness = { kind: "evidenced", sourceId: "synthetic-annotated-overview", valueMm: 4, method: "marking", verification: "unverified", rawLabel: "52□18-145 T4.0" };
  assert.equal((await authored(composite)).input.authoringEvidence.thickness.valueMm, 4);

  const badThickness = structuredClone(composite); badThickness.authoring.thickness.rawLabel = "52□18-145";
  await assert.rejects(authorProxyGeneratorInput(badThickness.captureDraft, badThickness.authoring), /ASCII numeric token equal to valueMm/);
});

test("bridge fails closed on authority injection, incomplete/duplicate evidence, substitutions, regions, and hidden thickness", async () => {
  const cases = [
    (copy) => { copy.authoring.status = "published"; },
    (copy) => { copy.authoring.recommendedForLive = true; },
    (copy) => { copy.authoring.sourceAssetHashes = ["f".repeat(64)]; },
    (copy) => { copy.authoring.measurementSetSha256 = "f".repeat(64); },
    (copy) => { delete copy.authoring.thickness; },
    (copy) => { copy.captureDraft.evidence.pop(); },
    (copy) => { copy.captureDraft.evidence[4] = structuredClone(copy.captureDraft.evidence[0]); },
    (copy) => { copy.captureDraft.evidence[0].field = "unknownMm"; },
    (copy) => { copy.captureDraft.evidence[0].regionPx.x = 1.5; },
    (copy) => { copy.captureDraft.sources[0].tenantId = "other-tenant"; },
    (copy) => { copy.captureDraft.measurementSet.frameModelId = "other-model"; },
    (copy) => { copy.captureDraft.sources[0].unexpected = true; },
    (copy) => { delete copy.captureDraft.sources[0].pixelGeometry; },
    (copy) => { copy.captureDraft.sources[0].pixelGeometry.injected = true; },
    (copy) => { copy.authoring.candidate.assetId = "J1-M"; },
  ];
  for (const mutate of cases) {
    const copy = await fixture(); mutate(copy);
    await assert.rejects(authorProxyGeneratorInput(copy.captureDraft, copy.authoring));
  }
  for (const escalation of [
    { method: "caliper", verification: "unverified" },
    { method: "annotated-image", verification: "verified" },
  ]) {
    const copy = await fixture(); copy.authoring.thickness = { kind: "evidenced", sourceId: "synthetic-annotated-overview", valueMm: 4, rawLabel: "4 mm", ...escalation };
    await assert.rejects(authorProxyGeneratorInput(copy.captureDraft, copy.authoring), /unverified image|cannot assert verification/);
  }
});

test("manual trace and all pixel regions reject non-orientation-1 sources while raw-label-only evidence remains explicit", async () => {
  const data = await fixture();
  const geometry = data.captureDraft.sources[0].pixelGeometry;
  Object.assign(geometry, { exifOrientation: 6, displayWidthPx: 240, displayHeightPx: 400, regionAuthoring: "requires-orientation-normalized-derived-source" });
  await assert.rejects(authored(data), /orientation-1 source/);

  const rawLabelOnly = await fixture();
  for (const item of rawLabelOnly.captureDraft.evidence) delete item.regionPx;
  const traceSource = rawLabelOnly.captureDraft.sources[1];
  Object.assign(traceSource.pixelGeometry, { exifOrientation: 8, displayWidthPx: 240, displayHeightPx: 400, regionAuthoring: "requires-orientation-normalized-derived-source" });
  assert.equal((await authored(rawLabelOnly)).input.authoringEvidence.profile.method, "dimension-template");
  rawLabelOnly.authoring.profile = manualTraceProfile();
  await assert.rejects(authored(rawLabelOnly), /orientation-1 source/);
});

test("authored input forms the existing GenerationJob/worker boundary and remains calibration-only", async () => {
  const result = await authored(); const input = result.input;
  const request = {
    schemaVersion: 1, tenantId: input.candidate.tenantId, frameModelId: input.candidate.frameModelId,
    method: "proxy-auto", generator: input.generator, sourceAssetSha256s: input.sourceAssetHashes,
    measurementSetSha256: input.measurementSet.sha256, generatorInputSha256: result.canonicalInputSha256,
    maxAttempts: 1, createdAt: "2026-08-11T00:00:00.000Z",
  };
  const queued = await createQueuedGenerationJobEvent(request);
  const state = await replayGenerationJobLedger([queued], { evaluatedAt: "2026-08-11T00:00:01.000Z" });
  const prepared = await prepareProxyAutoWork(state, input);
  assert.equal(prepared.bundle.canonicalInputSha256, result.canonicalInputSha256);
  const asset = { status: "draft", quality: "proxy", qualityEnvelope: { recommendedForLive: false } };
  assert.equal(evaluateAssetAdmission({ mode: "calibration", asset, fixture: true }).admitted, true);
  assert.equal(evaluateAssetAdmission({ mode: "qa-preview", asset, fixture: true }).admitted, false);
  assert.equal(evaluateAssetAdmission({ mode: "public-live", asset, fixture: true }).admitted, false);
});

test("durable authoring evidence cannot be relabelled or detached from measurement/source identity", async () => {
  const result = await authored();
  for (const mutate of [
    (input) => { input.authoringEvidence.measurementEvidenceSha256 = "f".repeat(64); },
    (input) => { input.authoringEvidence.profile.contourFidelity = true; },
    (input) => { input.authoringEvidence.profile.body.templateId = "tampered-template"; },
  ]) {
    const input = structuredClone(result.input); mutate(input);
    await assert.rejects(generateProxyBundle(input));
  }
  const data = await fixture();
  data.authoring.thickness = { kind: "evidenced", sourceId: "synthetic-annotated-overview", valueMm: 4, method: "annotated-image", verification: "unverified", rawLabel: "4 mm" };
  const evidenced = await authored(data);
  const escalated = structuredClone(evidenced.input); escalated.authoringEvidence.thickness.verification = "verified";
  await assert.rejects(generateProxyBundle(escalated), /cannot assert verification/);

  const tracedData = await fixture(); tracedData.authoring.profile = manualTraceProfile();
  const traced = await authored(tracedData);
  const stripped = structuredClone(traced.input); delete stripped.authoringEvidence.profile.body.sourcePixelGeometry;
  await assert.rejects(generateProxyBundle(stripped), /sourcePixelGeometry.*required/);
  const injected = structuredClone(traced.input); injected.authoringEvidence.profile.body.sourcePixelGeometry.injected = true;
  await assert.rejects(generateProxyBundle(injected), /injected is not allowed/);
  const relabelled = structuredClone(traced.input); relabelled.authoringEvidence.profile.body.sourcePixelGeometry.encodedWidthPx += 1; relabelled.authoringEvidence.profile.body.sourcePixelGeometry.displayWidthPx += 1;
  await assert.rejects(generateProxyBundle(relabelled), /evidenceSha256/);
});
