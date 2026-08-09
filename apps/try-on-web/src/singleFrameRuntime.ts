import { metres } from "../../../packages/contracts/src/index.js";
import type {
  CameraCalibration,
  FaceTrackingBackend,
  HeadPose,
  PoseAdapter,
  RuntimeAsset,
  ScaleResolver,
  VideoFrameInput,
  EyewearRenderer,
} from "../../../packages/runtime/src/index.js";
import {
  ConfidenceGate,
  QuaternionOneEuroFilter,
  VectorOneEuroFilter,
  type ConfidenceGateView,
} from "../../../packages/tracking/src/index.js";
import { observeIrisScale } from "../../../packages/scale/src/index.js";
import {
  RuntimePerformanceMonitor,
  type RuntimePerformanceSummary,
} from "../../../packages/quality/src/index.js";

export type SingleFrameRuntimeDependencies = {
  backend: FaceTrackingBackend;
  poseAdapter: PoseAdapter;
  scaleResolver: ScaleResolver;
  renderer: EyewearRenderer;
  confidenceGate?: ConfidenceGate;
  translationFilter?: VectorOneEuroFilter;
  rotationFilter?: QuaternionOneEuroFilter;
  performanceMonitor?: RuntimePerformanceMonitor;
  now?: () => number;
};

export type SingleFrameRuntimeView = ConfidenceGateView & {
  hasFace: boolean;
  scaleConfidence: "low" | "medium" | "high";
  pose: HeadPose | null;
  millimetresPerPixel: number | null;
  landmarkCount: number;
  performance: RuntimePerformanceSummary;
};

export class SingleFrameRuntime {
  readonly #backend: FaceTrackingBackend;
  readonly #poseAdapter: PoseAdapter;
  readonly #scaleResolver: ScaleResolver;
  readonly #renderer: EyewearRenderer;
  readonly #gate: ConfidenceGate;
  readonly #translationFilter: VectorOneEuroFilter;
  readonly #rotationFilter: QuaternionOneEuroFilter;
  readonly #performance: RuntimePerformanceMonitor;
  readonly #now: () => number;
  #lastPose: HeadPose | null = null;
  #initialized = false;
  #generation = 0;

  constructor(dependencies: SingleFrameRuntimeDependencies) {
    this.#backend = dependencies.backend;
    this.#poseAdapter = dependencies.poseAdapter;
    this.#scaleResolver = dependencies.scaleResolver;
    this.#renderer = dependencies.renderer;
    this.#gate = dependencies.confidenceGate ?? new ConfidenceGate();
    this.#translationFilter = dependencies.translationFilter ?? new VectorOneEuroFilter();
    this.#rotationFilter = dependencies.rotationFilter ?? new QuaternionOneEuroFilter();
    this.#now = dependencies.now ?? (() => performance.now());
    this.#performance = dependencies.performanceMonitor ?? new RuntimePerformanceMonitor(this.#now);
  }

  async initialize(canvas: HTMLCanvasElement, asset: RuntimeAsset): Promise<void> {
    if (this.#initialized) return;
    const generation = ++this.#generation;
    this.#performance.start();
    try {
      await Promise.all([this.#backend.initialize(), this.#renderer.initialize(canvas)]);
      if (generation !== this.#generation) throw new Error("single-frame runtime initialization cancelled");
      await this.#renderer.loadAsset(asset);
      if (generation !== this.#generation) throw new Error("single-frame runtime initialization cancelled");
      this.#gate.start();
      this.#initialized = true;
      this.#performance.markInitialized();
    } catch (error) {
      if (generation === this.#generation) await this.dispose();
      throw error;
    }
  }

  async process(frame: VideoFrameInput, camera: CameraCalibration): Promise<SingleFrameRuntimeView> {
    if (!this.#initialized) throw new Error("single-frame runtime must be initialized before process");
    const detectionStartedMs = this.#now();
    const tracking = await this.#backend.detect(frame);
    this.#performance.recordDetection(this.#now() - detectionStartedMs, tracking !== null);
    const gate = this.#gate.update(tracking?.confidence ?? 0, frame.timestampSeconds * 1_000);
    if (!tracking) {
      if (this.#lastPose) {
        this.#render({
          timestampSeconds: frame.timestampSeconds,
          pose: this.#lastPose,
          scale: { millimetresPerPixel: null, confidence: "low", sampleCount: 0, reason: "face-missing" },
          opacity: gate.opacity,
        });
      }
      return {
        ...gate,
        hasFace: false,
        scaleConfidence: "low",
        pose: this.#lastPose,
        millimetresPerPixel: null,
        landmarkCount: 0,
        performance: this.#performance.summary(),
      };
    }

    const rawPose = this.#poseAdapter.resolve(tracking, camera);
    const filteredPosition = this.#translationFilter.filter(rawPose.position, frame.timestampSeconds);
    const filteredRotation = this.#rotationFilter.filter(rawPose.rotation, frame.timestampSeconds);
    const pose: HeadPose = {
      position: {
        x: metres(filteredPosition.x),
        y: metres(filteredPosition.y),
        z: metres(filteredPosition.z),
      },
      rotation: filteredRotation,
      sourceConfidence: rawPose.sourceConfidence,
    };
    this.#lastPose = pose;
    const scale = this.#scaleResolver.update(observeIrisScale(tracking));
    this.#render({
      timestampSeconds: frame.timestampSeconds,
      pose,
      scale,
      opacity: gate.opacity,
      faceLandmarks: tracking.landmarks,
      cameraCalibration: camera,
    });
    return {
      ...gate,
      hasFace: true,
      scaleConfidence: scale.confidence,
      pose,
      millimetresPerPixel: scale.millimetresPerPixel,
      landmarkCount: tracking.landmarks.length,
      performance: this.#performance.summary(),
    };
  }

  async dispose(): Promise<void> {
    ++this.#generation;
    this.#initialized = false;
    this.#lastPose = null;
    this.#gate.reset();
    this.#translationFilter.reset();
    this.#rotationFilter.reset();
    this.#scaleResolver.reset();
    this.#performance.reset();
    await this.#backend.dispose();
    this.#renderer.dispose();
  }

  #render(frame: Parameters<EyewearRenderer["render"]>[0]): void {
    const renderStartedMs = this.#now();
    this.#renderer.render(frame);
    this.#performance.recordRender(this.#now() - renderStartedMs);
  }
}
