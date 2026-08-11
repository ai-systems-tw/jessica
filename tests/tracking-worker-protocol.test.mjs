import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTrackingWorkerRequest,
  parseTrackingWorkerResponse,
  protocolEnvelope,
  closeTransferredFrameIfPresent,
  withOwnedTrackingFrame,
} from "../dist/packages/face-tracking/src/index.js";

const origin = "https://tryon.example";
const resources = {
  tasksVisionVersion: "1.0.1",
  visionModuleUrl: `${origin}/runtime/mediapipe/1.0.1/vision_bundle.mjs`,
  wasmBaseUrl: `${origin}/runtime/mediapipe/1.0.1/wasm`,
  modelAssetUrl: `${origin}/runtime/mediapipe/face_landmarker.task`,
  modelSha256: "a".repeat(64), modelByteLength: 100, allowedOrigin: origin, delegate: "GPU",
};
const envelope = protocolEnvelope("session", 1);
const diagnostics = { workerGeneration: 1, initializedAtMs: 0, resourceOrigins: [origin], framesReceived: 1, resultsSent: 1, noFaceSent: 0, errorsSent: 0, lastTimestampUs: 1_000_000 };
const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
const result = {
  timestampSeconds: 1, confidence: 0.9, landmarks,
  facialTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  imageSize: { width: 640, height: 480 },
  quality: { reasons: [], metrics: { completenessRatio: 1, finiteRatio: 1, inFrameRatio: 1, pixelSpan: 200, temporalResidual: 0, rotationJumpDeg: 0, translationJumpRatio: 0 } },
};

test("protocol accepts exact pinned init and rejects unknown/malformed versions and fields", () => {
  assert.equal(parseTrackingWorkerRequest({ ...envelope, kind: "init", resources }).kind, "init");
  assert.throws(() => parseTrackingWorkerRequest({ ...envelope, version: 2, kind: "init", resources }), /protocol\/version mismatch/);
  assert.throws(() => parseTrackingWorkerRequest({ ...envelope, kind: "mystery" }), /unknown.*kind/);
  assert.throws(() => parseTrackingWorkerRequest({ ...envelope, kind: "init", resources, surprise: true }), /unknown field/);
  assert.throws(() => parseTrackingWorkerRequest({ ...envelope, kind: "init", resources: { ...resources, modelSha256: "decorative" } }), /SHA-256/);
});

test("protocol validates the entire plain-data tracking result", () => {
  const response = { ...envelope, kind: "result", requestId: 1, timestampUs: 1_000_000, result, diagnostics };
  assert.equal(parseTrackingWorkerResponse(response).kind, "result");
  assert.throws(() => parseTrackingWorkerResponse({ ...response, result: { ...result, landmarks: landmarks.slice(1) } }), /exactly 478/);
  assert.throws(() => parseTrackingWorkerResponse({ ...response, result: { ...result, landmarks: landmarks.map((point, index) => index ? point : { ...point, x: NaN }) } }), /must be finite/);
  assert.throws(() => parseTrackingWorkerResponse({ ...response, result: { ...result, facialTransform: [...result.facialTransform.slice(0, 15), Infinity] } }), /16 finite/);
  assert.throws(() => parseTrackingWorkerResponse({ ...response, result: { ...result, quality: { ...result.quality, metrics: { ...result.quality.metrics, inFrameRatio: 2 } } } }), /in \[0,1\]/);
  assert.throws(() => parseTrackingWorkerResponse({ ...response, result: { ...result, quality: { ...result.quality, reasons: ["invented"] } } }), /reasons are invalid/);
  assert.throws(() => parseTrackingWorkerResponse({ ...response, result: { ...result, extraBiometricPayload: true } }), /unknown field/);
});

test("frame ownership contract is exact and requires a closeable transferable", () => {
  const frame = { close() {} };
  const request = { ...envelope, kind: "frame", requestId: 1, timestampUs: 1, imageSize: { width: 1, height: 1 }, frame, transfer: { ownership: "worker", close: "worker-finally" } };
  assert.equal(parseTrackingWorkerRequest(request).kind, "frame");
  assert.throws(() => parseTrackingWorkerRequest({ ...request, transfer: { ownership: "caller", close: "never" } }), /transfer contract/);
  assert.throws(() => parseTrackingWorkerRequest({ ...request, frame: {} }), /closeable/);
});

test("Worker closes accepted and malformed transferred frames exactly once on every path", async () => {
  for (const failure of [null, new Error("pre-ready"), new Error("stale-generation"), new Error("non-monotonic"), new Error("detect-failed")]) {
    const frame = { closes: 0, close() { this.closes += 1; } };
    const operation = withOwnedTrackingFrame(frame, async () => { if (failure) throw failure; return "ok"; });
    if (failure) await assert.rejects(operation, failure); else assert.equal(await operation, "ok");
    assert.equal(frame.closes, 1);
  }
  const malformed = { frame: { closes: 0, close() { this.closes += 1; } } };
  assert.equal(closeTransferredFrameIfPresent(malformed), true);
  assert.equal(malformed.frame.closes, 1);
  assert.equal(closeTransferredFrameIfPresent({}), false);
});
