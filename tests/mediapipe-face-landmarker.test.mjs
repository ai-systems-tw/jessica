import assert from "node:assert/strict";
import test from "node:test";

import { MediaPipeFaceLandmarkerBackend } from "../dist/packages/face-tracking/src/index.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function landmarks(visibility = 0.9) {
  return Array.from({ length: 478 }, (_, index) => ({
    x: 0.25 + (index % 22) / 42,
    y: 0.25 + (Math.floor(index / 22) % 22) / 42,
    z: -0.1,
    visibility,
  }));
}

function result({ faces = 1, matrix = identity, visibility = 0.9 } = {}) {
  return {
    faceLandmarks: faces
      ? [landmarks(visibility)]
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
      qualityEstimator: overrides.qualityEstimator,
      onNetworkObservation: overrides.onNetworkObservation,
    },
    factory,
  );
  return { backend, calls, landmarker };
}

test("maps one MediaPipe face and derives geometric quality without visibility confidence", async () => {
  const { backend, calls } = harness();
  await backend.initialize();
  const source = { width: 1280, height: 720 };
  const mapped = await backend.detect({ source, timestampSeconds: 1.25 });

  assert.equal(mapped.timestampSeconds, 1.25);
  assert.equal(mapped.confidence, 1);
  assert.equal(mapped.landmarks.length, 478);
  assert.deepEqual(mapped.facialTransform, identity);
  assert.deepEqual(mapped.imageSize, { width: 1280, height: 720 });
  assert.deepEqual(mapped.quality.reasons, []);
  assert.equal(calls.detect[0].timestampMs, 1250);
  assert.equal(calls.create[0].options.runningMode, "VIDEO");
  assert.equal(calls.create[0].options.numFaces, 1);
  assert.equal(calls.create[0].options.outputFacialTransformationMatrixes, true);
  assert.equal(calls.create[0].options.baseOptions.modelAssetPath, "/runtime/mediapipe/face_landmarker.task");
});

test("MediaPipe landmark visibility never changes estimated confidence", async () => {
  const low = harness({ detection: result({ visibility: 0 }) }).backend;
  const high = harness({ detection: result({ visibility: 1 }) }).backend;
  await Promise.all([low.initialize(), high.initialize()]);
  const frame = { source: { width: 1280, height: 720 }, timestampSeconds: 1 };
  assert.equal((await low.detect(frame)).confidence, (await high.detect(frame)).confidence);
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
