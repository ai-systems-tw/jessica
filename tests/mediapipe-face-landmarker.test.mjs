import assert from "node:assert/strict";
import test from "node:test";

import { MediaPipeFaceLandmarkerBackend } from "../dist/packages/face-tracking/src/index.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function result({ faces = 1, matrix = identity } = {}) {
  return {
    faceLandmarks: faces
      ? [[{ x: 0.25, y: 0.5, z: -0.1, visibility: 0.9 }]]
      : [],
    faceBlendshapes: [],
    facialTransformationMatrixes: faces
      ? [{ rows: 4, columns: 4, data: matrix }]
      : [],
  };
}

function harness(overrides = {}) {
  const calls = { resolve: [], create: [], detect: [], close: 0 };
  const landmarker = {
    detectForVideo(source, timestampMs) {
      calls.detect.push({ source, timestampMs });
      return overrides.detection ?? result();
    },
    close() {
      calls.close += 1;
    },
  };
  const factory = {
    async resolveVisionFiles(url) {
      calls.resolve.push(url);
      if (overrides.resolveError) throw overrides.resolveError;
      return { wasmLoaderPath: "loader", wasmBinaryPath: "binary" };
    },
    async createLandmarker(files, options) {
      calls.create.push({ files, options });
      if (overrides.createPromise) return overrides.createPromise;
      if (overrides.createError) throw overrides.createError;
      return landmarker;
    },
  };
  const backend = new MediaPipeFaceLandmarkerBackend(
    {
      wasmBaseUrl: "/runtime/mediapipe/1.0.1/wasm",
      modelAssetUrl: "/runtime/mediapipe/face_landmarker.task",
      initializeTimeoutMs: overrides.timeoutMs ?? 100,
      confidenceNormalizer: overrides.confidenceNormalizer,
      onNetworkObservation: overrides.onNetworkObservation,
    },
    factory,
  );
  return { backend, calls, landmarker };
}

test("maps one MediaPipe face into the Jessica tracking contract", async () => {
  const { backend, calls } = harness({ confidenceNormalizer: () => 0.82 });
  await backend.initialize();
  const source = { width: 1280, height: 720 };
  const mapped = await backend.detect({ source, timestampSeconds: 1.25 });

  assert.deepEqual(mapped, {
    timestampSeconds: 1.25,
    confidence: 0.82,
    landmarks: [{ x: 0.25, y: 0.5, z: -0.1, visibility: 0.9 }],
    facialTransform: identity,
    imageSize: { width: 1280, height: 720 },
  });
  assert.equal(calls.detect[0].timestampMs, 1250);
  assert.equal(calls.create[0].options.runningMode, "VIDEO");
  assert.equal(calls.create[0].options.numFaces, 1);
  assert.equal(calls.create[0].options.outputFacialTransformationMatrixes, true);
  assert.equal(calls.create[0].options.baseOptions.modelAssetPath, "/runtime/mediapipe/face_landmarker.task");
});

test("returns null when MediaPipe reports no face", async () => {
  const { backend } = harness({ detection: result({ faces: 0 }) });
  await backend.initialize();
  assert.equal(await backend.detect({ source: { width: 640, height: 480 }, timestampSeconds: 1 }), null);
});

test("rejects non-monotonic timestamps before invoking MediaPipe again", async () => {
  const { backend, calls } = harness();
  await backend.initialize();
  const source = { width: 640, height: 480 };
  await backend.detect({ source, timestampSeconds: 2 });
  await assert.rejects(
    backend.detect({ source, timestampSeconds: 2 }),
    /strictly increasing/,
  );
  assert.equal(calls.detect.length, 1);
});

test("surfaces model initialization failure and remains unusable", async () => {
  const failure = new Error("model load failed");
  const { backend } = harness({ createError: failure });
  await assert.rejects(backend.initialize(), failure);
  await assert.rejects(
    backend.detect({ source: { width: 640, height: 480 }, timestampSeconds: 1 }),
    /must be initialized/,
  );
});

test("times out initialization and closes a landmarker that resolves late", async () => {
  let resolveCreation;
  const createPromise = new Promise((resolve) => {
    resolveCreation = resolve;
  });
  const { backend, landmarker, calls } = harness({ createPromise, timeoutMs: 5 });
  await assert.rejects(backend.initialize(), /timed out/);
  resolveCreation(landmarker);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.close, 1);
});

test("dispose closes resources and reinitialization resets the frame timeline", async () => {
  const { backend, calls } = harness();
  const source = { width: 640, height: 480 };
  await backend.initialize();
  await backend.detect({ source, timestampSeconds: 10 });
  await backend.dispose();
  assert.equal(calls.close, 1);
  await backend.initialize();
  await backend.detect({ source, timestampSeconds: 0 });
  assert.equal(calls.create.length, 2);
  assert.equal(calls.detect.length, 2);
});

test("reports configured runtime resources for network auditing", async () => {
  const observations = [];
  const { backend } = harness({ onNetworkObservation: (event) => observations.push(event) });
  await backend.initialize();
  assert.deepEqual(
    observations.filter((event) => event.source === "configured"),
    [
      { phase: "initialize", url: "/runtime/mediapipe/1.0.1/wasm", source: "configured" },
      { phase: "initialize", url: "/runtime/mediapipe/face_landmarker.task", source: "configured" },
    ],
  );
});
