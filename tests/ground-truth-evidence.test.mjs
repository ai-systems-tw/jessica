import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DEVICE_CLASSES,
  deriveEvidenceMetrics,
  evaluateGroundTruthEvidence,
  normalizeAngleDeg,
  parseGroundTruthEvidence,
} from "../dist/packages/quality/src/index.js";

const H = {
  asset: "a".repeat(64), source: "b".repeat(64), manifest: "c".repeat(64), model: "d".repeat(64),
  capture: "e".repeat(64), render: "f".repeat(64), trace: "1".repeat(64), config: "2".repeat(64),
};
const COMMIT = "3".repeat(40);
const VERIFIED_AT = "2026-08-11T00:00:00Z";
const sha = (value) => createHash("sha256").update(value).digest("hex");

function verification(sha256) {
  return { method: "actual-bytes-sha256", verifierVersion: "evidence-hasher/1", verifiedAt: VERIFIED_AT, byteLength: 1024, sha256 };
}

function trace() {
  return [
    { timestampMs: 0, targetPositionMm: { x: 0, y: 0 }, overlayPositionMm: { x: 0, y: 0 }, targetRotationDeg: 0, overlayRotationDeg: 0, facePresent: true, trackingVisible: true },
    { timestampMs: 100, targetPositionMm: { x: 0.6, y: 0 }, overlayPositionMm: { x: 0, y: 0 }, targetRotationDeg: 0, overlayRotationDeg: 0, facePresent: true, trackingVisible: true },
    { timestampMs: 200, targetPositionMm: { x: 0.6, y: 0 }, overlayPositionMm: { x: 0.6, y: 0 }, targetRotationDeg: 0, overlayRotationDeg: 0, facePresent: true, trackingVisible: true },
    { timestampMs: 300, targetPositionMm: { x: 0.6, y: 0 }, overlayPositionMm: { x: 0.6, y: 0 }, targetRotationDeg: 0, overlayRotationDeg: 0, facePresent: false, trackingVisible: true },
    { timestampMs: 500, targetPositionMm: { x: 0.6, y: 0 }, overlayPositionMm: null, targetRotationDeg: 0, overlayRotationDeg: null, facePresent: false, trackingVisible: false },
    { timestampMs: 600, targetPositionMm: { x: 0.6, y: 0 }, overlayPositionMm: null, targetRotationDeg: 0, overlayRotationDeg: null, facePresent: true, trackingVisible: false },
    { timestampMs: 700, targetPositionMm: { x: 0.6, y: 0 }, overlayPositionMm: { x: 0.6, y: 0 }, targetRotationDeg: 0, overlayRotationDeg: 0, facePresent: true, trackingVisible: true },
  ];
}

function placement() {
  return {
    bridgeCenter: { x: 500, y: 300 }, frameLeft: { x: 150, y: 300 }, frameRight: { x: 850, y: 300 },
    leftLensCenter: { x: 350, y: 300 }, rightLensCenter: { x: 650, y: 300 },
  };
}

function fixture(subjectId = "subject-1", frameModelId = "frame-1", view = "front", suffix = "0") {
  const expectedAngle = view === "left" ? -30 : view === "right" ? 30 : 0;
  const cell = `${subjectId}|${frameModelId}|${view}|${suffix}`;
  const hashes = { assetSha256: sha(`asset:${frameModelId}`), sourceSha256: sha(`source:${frameModelId}`), manifestSha256: sha(`manifest:${frameModelId}`), modelSha256: sha(`model:${frameModelId}`), captureSha256: sha(`capture:${cell}`), renderSha256: sha(`render:${cell}`) };
  const traceSha256 = sha(`trace:${cell}`);
  return {
    fixtureId: `fixture-${subjectId}-${frameModelId}-${view}-${suffix}`,
    tenantId: "tenant-1", subjectId, frameModelId, variantId: `${frameModelId}-black`, assetVersionId: `${frameModelId}-v1`, assetVersion: 1,
    hashes,
    integrity: { asset: verification(hashes.assetSha256), source: verification(hashes.sourceSha256), manifest: verification(hashes.manifestSha256), model: verification(hashes.modelSha256), capture: verification(hashes.captureSha256), render: verification(hashes.renderSha256), trace: verification(traceSha256) },
    runtime: { commitSha: COMMIT, configSha256: H.config },
    consent: { reference: `consent-${subjectId}`, scope: "actual-wear-ground-truth", recordedAt: "2026-08-01T00:00:00Z", retentionUntil: "2027-08-01T00:00:00Z" },
    image: { widthPx: 1000, heightPx: 600, captureDistanceMm: 600, lighting: "controlled-500lux", expectedView: view, expectedViewAngleDeg: expectedAngle, actualViewAngleDeg: expectedAngle },
    environment: { deviceClass: "iphone-safari-representative", browser: "Safari 20", os: "iOS 20" },
    actualFrameWidthMm: 140,
    annotation: { actualCaptureSha256: hashes.captureSha256, overlayCaptureSha256: hashes.captureSha256, overlayRenderSha256: hashes.renderSha256, actual: placement(), overlay: placement() },
    temporalTrace: { traceSha256, sourceCaptureSha256: hashes.captureSha256, runtimeCommitSha: COMMIT, samples: trace() },
    visualReview: { reviewerId: "reviewer-1", result: "approve", issueCategories: [], recordedAt: "2026-08-11T01:00:00Z", assetSha256: hashes.assetSha256, runtimeCommitSha: COMMIT },
  };
}

function deviceRun(deviceClass, index = 0) {
  const capture = `${(4 + index).toString(16)}`.repeat(64); const render = `${(9 + index).toString(16)}`.repeat(64).slice(0, 64); const traceHash = `${(14 - index).toString(16)}`.repeat(64).slice(0, 64);
  const [browser, os] = deviceClass.startsWith("iphone-") ? ["Safari 20", "iOS 20"] : deviceClass === "android-chrome-mid-range" ? ["Chrome 140", "Android 17"] : deviceClass === "windows-chrome" ? ["Chrome 140", "Windows 12"] : ["Firefox 150", "Windows 12"];
  return {
    runId: `run-${deviceClass}-${index}`, deviceClass, browser, os, runtimeCommitSha: COMMIT, configSha256: H.config,
    captureSha256: capture, renderSha256: render, traceSha256: traceHash,
    integrity: { capture: verification(capture), render: verification(render), trace: verification(traceHash) },
    checkpoints: [
      { durationMs: 180_000, frameCount: 4_320, detectionFps: 15, renderFps: 24, memoryPeakMb: 240, thermal: "nominal" },
      { durationMs: 600_000, frameCount: 14_400, detectionFps: 15, renderFps: 24, memoryPeakMb: 256, thermal: "warm" },
    ],
    durationMs: 600_000, frameCount: 14_400, detectionFps: 15, renderFps: 24, memoryPeakMb: 256, thermal: "warm",
    backgroundForeground: true, permissionRetry: true, networkLossAfterLoad: true, assetFailure: true, lowLight: true, rapidHeadMotion: true,
  };
}

function document(profile = "technical-single-frame-slice") {
  return { schemaVersion: 1, profile, evaluatedAt: "2026-08-11T02:00:00Z", runtime: { commitSha: COMMIT, configSha256: H.config }, fixtures: [fixture()], deviceRuns: [] };
}

function canonical() {
  const fixtures = [];
  for (const subject of ["subject-1", "subject-2", "subject-3"])
    for (const frame of ["frame-1", "frame-2", "frame-3", "frame-4", "frame-5"])
      for (const view of ["front", "left", "right"]) fixtures.push(fixture(subject, frame, view));
  return { schemaVersion: 1, profile: "canonical-validation", evaluatedAt: "2026-08-11T02:00:00Z", runtime: { commitSha: COMMIT, configSha256: H.config }, fixtures, deviceRuns: DEVICE_CLASSES.map(deviceRun) };
}

test("technical readiness is not named or reported as canonical G1 promotion", () => {
  const input = document(); const parsed = parseGroundTruthEvidence(input); const result = evaluateGroundTruthEvidence(input);
  assert.deepEqual(parsed.issues, []);
  assert.equal("schemaVersion" in parsed.evidence.fixtures[0], false);
  assert.equal(result.gate, "TECHNICAL_SINGLE_FRAME_SLICE_READINESS");
  assert.equal(result.metricPass, true); assert.equal(result.gateReady, true); assert.equal(result.canonicalPromotionReady, false);
});

test("vacuous stationary traces fail temporal motion/loss/reacquisition coverage", () => {
  const input = document();
  input.fixtures[0].temporalTrace.samples = trace().slice(0, 2).map((sample, index) => ({ ...sample, timestampMs: index * 100, targetPositionMm: { x: 0, y: 0 }, overlayPositionMm: { x: 0, y: 0 }, facePresent: true, trackingVisible: true }));
  const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.metricPass, false);
  assert.deepEqual(result.fixtureReports[0].temporal.coverage, { observedMotion: false, observedLossAndHide: false, observedReacquisition: false });
});

test("position jitter is residual variation, not constant placement bias", () => {
  const input = document();
  for (const sample of input.fixtures[0].temporalTrace.samples) if (sample.overlayPositionMm) sample.overlayPositionMm.x += 1;
  const metrics = deriveEvidenceMetrics(parseGroundTruthEvidence(input).evidence.fixtures[0]);
  assert.ok(metrics.temporal.positionJitterRmsMm < 0.3);
});

test("contracts reject unknown fields, string booleans, negative values, blank duplicates and non-monotonic time", () => {
  const input = document(); input.unknown = true; input.fixtures.push(structuredClone(input.fixtures[0]));
  input.fixtures[0].fixtureId = " "; input.fixtures[1].fixtureId = " "; input.fixtures[0].temporalTrace.samples[1].timestampMs = 0;
  input.fixtures[0].temporalTrace.samples[0].facePresent = "false"; input.fixtures[0].temporalTrace.samples[0].timestampMs = -1;
  const codes = parseGroundTruthEvidence(input).issues.map((issue) => issue.code);
  for (const code of ["unknown_field", "invalid_boolean", "invalid_number", "duplicate_fixture_id", "non_monotonic_trace"]) assert.ok(codes.includes(code), code);
});

test("points, provenance, actual-byte integrity, signed views, visual enum and consent retention fail closed", () => {
  const input = document(); const f = input.fixtures[0];
  f.annotation.actual.bridgeCenter.x = 1000; f.annotation.overlayRenderSha256 = H.asset;
  f.integrity.capture.sha256 = H.asset; f.integrity.render.method = "self-asserted";
  f.image.expectedView = "left"; f.image.expectedViewAngleDeg = -30; f.image.actualViewAngleDeg = 30;
  f.visualReview.result = "limited"; f.consent.retentionUntil = f.consent.recordedAt;
  const codes = parseGroundTruthEvidence(input).issues.map((issue) => issue.code);
  for (const code of ["point_outside_image", "provenance_mismatch", "integrity_hash_mismatch", "invalid_enum", "view_angle_mismatch", "invalid_retention"]) assert.ok(codes.includes(code), code);
});

test("roll normalizes across ±180", () => {
  assert.equal(normalizeAngleDeg(-358), 2);
  assert.equal(normalizeAngleDeg(358), -2);
});

test("rotation jitter uses a circular mean at the ±180 boundary", () => {
  const input = document();
  let positive = true;
  for (const sample of input.fixtures[0].temporalTrace.samples) {
    if (sample.overlayRotationDeg !== null) { sample.overlayRotationDeg = positive ? 179 : -179; positive = !positive; }
  }
  const metrics = deriveEvidenceMetrics(parseGroundTruthEvidence(input).evidence.fixtures[0]);
  assert.ok(metrics.temporal.rotationJitterRmsDeg <= 1.1);
});

test("consent expiry is evaluated deterministically at document evaluatedAt", () => {
  const input = document(); input.evaluatedAt = "2028-01-01T00:00:00Z";
  const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.metricPass, true); assert.equal(result.gateReady, false);
  assert.ok(result.issues.some((issue) => issue.code === "expired_consent"));
});

test("future-dated consent, review and actual-byte verification cannot promote", () => {
  const input = document(); const future = "2026-08-12T00:00:00Z";
  input.fixtures[0].consent.recordedAt = future; input.fixtures[0].visualReview.recordedAt = future; input.fixtures[0].integrity.capture.verifiedAt = future;
  const issues = evaluateGroundTruthEvidence(input).issues.filter((issue) => issue.code === "future_dated_evidence");
  assert.equal(issues.length, 3);
});

test("one perfect canonical fixture passes metrics but cannot promote without 45 cells and devices", () => {
  const input = document("canonical-validation"); const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.metricPass, true); assert.equal(result.gateReady, false); assert.equal(result.canonicalPromotionReady, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_devices"));
});

test("exact 45 cells and five unique sustained device classes can become gate ready", () => {
  const result = evaluateGroundTruthEvidence(canonical());
  assert.equal(result.coverage.requiredCells.length, 45); assert.equal(result.coverage.missingCells.length, 0);
  assert.equal(result.metricPass, true); assert.equal(result.gateReady, true); assert.equal(result.canonicalPromotionReady, true);
});

test("canonical evidence rejects relabeled cell artifacts and frame-model bytes", () => {
  const input = canonical();
  input.fixtures[1].hashes.captureSha256 = input.fixtures[0].hashes.captureSha256;
  input.fixtures[1].integrity.capture.sha256 = input.fixtures[0].hashes.captureSha256;
  input.fixtures[1].annotation.actualCaptureSha256 = input.fixtures[0].hashes.captureSha256;
  input.fixtures[1].annotation.overlayCaptureSha256 = input.fixtures[0].hashes.captureSha256;
  const frame1 = input.fixtures.find((fixture) => fixture.frameModelId === "frame-1");
  const frame2 = input.fixtures.find((fixture) => fixture.frameModelId === "frame-2");
  frame2.hashes.modelSha256 = frame1.hashes.modelSha256; frame2.integrity.model.sha256 = frame1.hashes.modelSha256;
  const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.gateReady, false);
  assert.ok(result.issues.some((issue) => issue.code === "reused_cell_artifact"));
  assert.ok(result.issues.some((issue) => issue.code === "shared_model_hash"));
});

test("tenant and subject-consent bindings cannot be relabeled", () => {
  const input = canonical();
  input.fixtures[1].tenantId = "tenant-2";
  input.fixtures.find((fixture) => fixture.subjectId === "subject-2").consent.reference = "consent-subject-1";
  const result = evaluateGroundTruthEvidence(input);
  for (const code of ["inconsistent_tenant", "shared_consent_reference", "inconsistent_subject_consent"]) assert.ok(result.issues.some((issue) => issue.code === code), code);
});

test("missing FPS, impossible frame claims and duplicate device classes keep metrics separate from readiness", () => {
  const input = canonical(); delete input.deviceRuns[0].detectionFps; input.deviceRuns[1].frameCount = 1; input.deviceRuns[2].deviceClass = input.deviceRuns[1].deviceClass;
  const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.metricPass, true); assert.equal(result.gateReady, false);
  for (const code of ["invalid_number", "performance_failed", "impossible_frame_count", "duplicate_device_classes", "missing_devices"]) assert.ok(result.issues.some((issue) => issue.code === code), code);
});

test("device runs cannot be relabeled across classes or browser/OS families", () => {
  const input = canonical();
  input.deviceRuns[1].captureSha256 = input.deviceRuns[0].captureSha256; input.deviceRuns[1].integrity.capture.sha256 = input.deviceRuns[0].captureSha256;
  input.deviceRuns[2].browser = "Safari 20"; input.deviceRuns[2].os = "iOS 20";
  const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.gateReady, false);
  assert.ok(result.issues.some((issue) => issue.code === "reused_device_artifact"));
  assert.ok(result.issues.some((issue) => issue.code === "device_family_mismatch"));
});

test("per-fixture threshold violation cannot hide behind 44 perfect cells", () => {
  const input = canonical(); input.fixtures[0].annotation.overlay.bridgeCenter.x += 100;
  const result = evaluateGroundTruthEvidence(input);
  assert.equal(result.metricPass, false); assert.equal(result.gateReady, false);
  assert.ok(result.fixtureReports.some((report) => !report.pass && report.violations.some((issue) => issue.code === "metric_center_error")));
});
