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

export type SingleFrameRuntimeDependencies = {
  backend: FaceTrackingBackend;
  poseAdapter: PoseAdapter;
  scaleResolver: ScaleResolver;
  renderer: EyewearRenderer;
  confidenceGate?: ConfidenceGate;
  translationFilter?: VectorOneEuroFilter;
  rotationFilter?: QuaternionOneEuroFilter;
};

export type SingleFrameRuntimeView = ConfidenceGateView & {
  hasFace: boolean;
  scaleConfidence: "low" | "medium" | "high";
  pose: HeadPose | null;
  millimetresPerPixel: number | null;
  landmarkCount: number;
};

export class SingleFrameRuntime {
  readonly #backend: FaceTrackingBackend;
  readonly #poseAdapter: PoseAdapter;
  readonly #scaleResolver: ScaleResolver;
  readonly #renderer: EyewearRenderer;
  readonly #gate: ConfidenceGate;
  readonly #translationFilter: VectorOneEuroFilter;
  readonly #rotationFilter: QuaternionOneEuroFilter;
  #lastPose: HeadPose | null = null;
  #initialized = false;

  constructor(dependencies: SingleFrameRuntimeDependencies) {
    this.#backend = dependencies.backend;
    this.#poseAdapter = dependencies.poseAdapter;
    this.#scaleResolver = dependencies.scaleResolver;
    this.#renderer = dependencies.renderer;
    this.#gate = dependencies.confidenceGate ?? new ConfidenceGate();
    this.#translationFilter = dependencies.translationFilter ?? new VectorOneEuroFilter();
    this.#rotationFilter = dependencies.rotationFilter ?? new QuaternionOneEuroFilter();
  }

  async initialize(canvas: HTMLCanvasElement, asset: RuntimeAsset): Promise<void> {
    if (this.#initialized) return;
    try {
      await Promise.all([this.#backend.initialize(), this.#renderer.initialize(canvas)]);
      await this.#renderer.loadAsset(asset);
      this.#gate.start();
      this.#initialized = true;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async process(frame: VideoFrameInput, camera: CameraCalibration): Promise<SingleFrameRuntimeView> {
    if (!this.#initialized) throw new Error("single-frame runtime must be initialized before process");
    const tracking = await this.#backend.detect(frame);
    const gate = this.#gate.update(tracking?.confidence ?? 0, frame.timestampSeconds * 1_000);
    if (!tracking) {
      if (this.#lastPose) {
        this.#renderer.render({
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
    this.#renderer.render({
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
    };
  }

  async dispose(): Promise<void> {
    this.#initialized = false;
    this.#lastPose = null;
    this.#gate.reset();
    this.#translationFilter.reset();
    this.#rotationFilter.reset();
    this.#scaleResolver.reset();
    await this.#backend.dispose();
    this.#renderer.dispose();
  }
}
