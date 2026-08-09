import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerOptions,
  type FaceLandmarkerResult,
  type ImageSource,
} from "@mediapipe/tasks-vision";

import type {
  FaceTrackingBackend,
  FaceTrackingResult,
  ImageSize,
  VideoFrameInput,
} from "../../runtime/src/index.js";
import type { Matrix4 } from "../../contracts/src/index.js";

type WasmFileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];

export type MediaPipeNetworkObservation = {
  phase: "initialize" | "detect";
  url: string;
  source: "configured" | "resource-timing";
};

export type MediaPipeFaceLandmarkerConfig = {
  wasmBaseUrl: string;
  modelAssetUrl: string;
  initializeTimeoutMs?: number;
  minFaceDetectionConfidence?: number;
  minFacePresenceConfidence?: number;
  minTrackingConfidence?: number;
  delegate?: "CPU" | "GPU";
  onNetworkObservation?: (observation: MediaPipeNetworkObservation) => void;
  confidenceNormalizer?: (result: FaceLandmarkerResult, faceIndex: number) => number;
};

export interface MediaPipeLandmarker {
  detectForVideo(source: ImageSource, timestampMs: number): FaceLandmarkerResult;
  close(): void;
}

export interface MediaPipeFaceLandmarkerFactory {
  resolveVisionFiles(wasmBaseUrl: string): Promise<WasmFileset>;
  createLandmarker(files: WasmFileset, options: FaceLandmarkerOptions): Promise<MediaPipeLandmarker>;
}

const DEFAULT_INITIALIZE_TIMEOUT_MS = 15_000;

const defaultFactory: MediaPipeFaceLandmarkerFactory = {
  resolveVisionFiles: (wasmBaseUrl) => FilesetResolver.forVisionTasks(wasmBaseUrl),
  createLandmarker: (files, options) => FaceLandmarker.createFromOptions(files, options),
};

function requireNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function requireUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
}

function requirePositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function imageSize(source: VideoFrameInput["source"]): ImageSize {
  const video = source as HTMLVideoElement;
  const width = "videoWidth" in source ? video.videoWidth : source.width;
  const height = "videoHeight" in source ? video.videoHeight : source.height;
  requirePositiveFinite(width, "frame width");
  requirePositiveFinite(height, "frame height");
  return { width, height };
}

function matrix4(result: FaceLandmarkerResult, faceIndex: number): Matrix4 {
  const matrix = result.facialTransformationMatrixes[faceIndex];
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 || matrix.data.length !== 16) {
    throw new Error("MediaPipe did not return a 4x4 facial transformation matrix");
  }
  if (matrix.data.some((value) => !Number.isFinite(value))) {
    throw new Error("MediaPipe facial transformation matrix contains a non-finite value");
  }
  return matrix.data.slice() as unknown as Matrix4;
}

function defaultConfidenceNormalizer(result: FaceLandmarkerResult, faceIndex: number): number {
  return result.faceLandmarks[faceIndex] ? 1 : 0;
}

function resourceUrls(): ReadonlySet<string> {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return new Set();
  }
  return new Set(performance.getEntriesByType("resource").map((entry) => entry.name));
}

function observeNewResources(
  before: ReadonlySet<string>,
  phase: MediaPipeNetworkObservation["phase"],
  listener: MediaPipeFaceLandmarkerConfig["onNetworkObservation"],
): void {
  if (!listener) return;
  for (const url of resourceUrls()) {
    if (!before.has(url)) {
      listener({ phase, url, source: "resource-timing" });
    }
  }
}

export class MediaPipeFaceLandmarkerBackend implements FaceTrackingBackend {
  readonly #config: Required<
    Pick<
      MediaPipeFaceLandmarkerConfig,
      | "wasmBaseUrl"
      | "modelAssetUrl"
      | "initializeTimeoutMs"
      | "minFaceDetectionConfidence"
      | "minFacePresenceConfidence"
      | "minTrackingConfidence"
      | "delegate"
      | "confidenceNormalizer"
    >
  > & Pick<MediaPipeFaceLandmarkerConfig, "onNetworkObservation">;
  readonly #factory: MediaPipeFaceLandmarkerFactory;
  #landmarker: MediaPipeLandmarker | null = null;
  #lastTimestampSeconds: number | null = null;
  #lifecycleGeneration = 0;

  constructor(
    config: MediaPipeFaceLandmarkerConfig,
    factory: MediaPipeFaceLandmarkerFactory = defaultFactory,
  ) {
    requireNonBlank(config.wasmBaseUrl, "wasmBaseUrl");
    requireNonBlank(config.modelAssetUrl, "modelAssetUrl");
    const initializeTimeoutMs = config.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
    const minFaceDetectionConfidence = config.minFaceDetectionConfidence ?? 0.5;
    const minFacePresenceConfidence = config.minFacePresenceConfidence ?? 0.5;
    const minTrackingConfidence = config.minTrackingConfidence ?? 0.5;
    requirePositiveFinite(initializeTimeoutMs, "initializeTimeoutMs");
    requireUnitInterval(minFaceDetectionConfidence, "minFaceDetectionConfidence");
    requireUnitInterval(minFacePresenceConfidence, "minFacePresenceConfidence");
    requireUnitInterval(minTrackingConfidence, "minTrackingConfidence");

    this.#config = {
      wasmBaseUrl: config.wasmBaseUrl,
      modelAssetUrl: config.modelAssetUrl,
      initializeTimeoutMs,
      minFaceDetectionConfidence,
      minFacePresenceConfidence,
      minTrackingConfidence,
      delegate: config.delegate ?? "GPU",
      confidenceNormalizer: config.confidenceNormalizer ?? defaultConfidenceNormalizer,
      ...(config.onNetworkObservation ? { onNetworkObservation: config.onNetworkObservation } : {}),
    };
    this.#factory = factory;
  }

  async initialize(): Promise<void> {
    if (this.#landmarker) return;

    const generation = ++this.#lifecycleGeneration;
    const resourcesBefore = resourceUrls();
    this.#config.onNetworkObservation?.({
      phase: "initialize",
      url: this.#config.wasmBaseUrl,
      source: "configured",
    });
    this.#config.onNetworkObservation?.({
      phase: "initialize",
      url: this.#config.modelAssetUrl,
      source: "configured",
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const creation = (async () => {
      const files = await this.#factory.resolveVisionFiles(this.#config.wasmBaseUrl);
      return this.#factory.createLandmarker(files, {
        baseOptions: {
          modelAssetPath: this.#config.modelAssetUrl,
          delegate: this.#config.delegate,
        },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: this.#config.minFaceDetectionConfidence,
        minFacePresenceConfidence: this.#config.minFacePresenceConfidence,
        minTrackingConfidence: this.#config.minTrackingConfidence,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      });
    })();

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`MediaPipe initialization timed out after ${this.#config.initializeTimeoutMs}ms`)),
        this.#config.initializeTimeoutMs,
      );
    });

    try {
      const landmarker = await Promise.race([creation, timeout]);
      if (generation !== this.#lifecycleGeneration) {
        landmarker.close();
        return;
      }
      this.#landmarker = landmarker;
      this.#lastTimestampSeconds = null;
    } catch (error) {
      ++this.#lifecycleGeneration;
      void creation.then((lateLandmarker) => lateLandmarker.close()).catch(() => undefined);
      throw error;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      observeNewResources(resourcesBefore, "initialize", this.#config.onNetworkObservation);
    }
  }

  async detect(frame: VideoFrameInput): Promise<FaceTrackingResult | null> {
    if (!this.#landmarker) {
      throw new Error("MediaPipe backend must be initialized before detect");
    }
    if (!Number.isFinite(frame.timestampSeconds)) {
      throw new TypeError("timestampSeconds must be finite");
    }
    if (this.#lastTimestampSeconds !== null && frame.timestampSeconds <= this.#lastTimestampSeconds) {
      throw new RangeError("timestampSeconds must be strictly increasing");
    }

    const size = imageSize(frame.source);
    const resourcesBefore = resourceUrls();
    const result = this.#landmarker.detectForVideo(
      frame.source as ImageSource,
      frame.timestampSeconds * 1_000,
    );
    this.#lastTimestampSeconds = frame.timestampSeconds;
    observeNewResources(resourcesBefore, "detect", this.#config.onNetworkObservation);

    const landmarks = result.faceLandmarks[0];
    if (!landmarks) return null;

    const confidence = this.#config.confidenceNormalizer(result, 0);
    requireUnitInterval(confidence, "normalized face confidence");
    return {
      timestampSeconds: frame.timestampSeconds,
      confidence,
      landmarks: landmarks.map((landmark) => ({
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
        ...(Number.isFinite(landmark.visibility) ? { visibility: landmark.visibility } : {}),
      })),
      facialTransform: matrix4(result, 0),
      imageSize: size,
    };
  }

  async dispose(): Promise<void> {
    ++this.#lifecycleGeneration;
    this.#landmarker?.close();
    this.#landmarker = null;
    this.#lastTimestampSeconds = null;
  }
}
