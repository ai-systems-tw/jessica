import { metres, type AssetQuality, type TrackingQualityReason } from "../../../packages/contracts/src/index.js";
import type {
  CameraCalibration,
  FaceTrackingBackend,
  HeadAngles,
  HeadPose,
  PoseAdapter,
  QualityEnvelopeReason,
  RenderFrame,
  RuntimeAsset,
  ScaleResolver,
  VideoFrameInput,
  EyewearRenderer,
} from "../../../packages/runtime/src/index.js";
import { evaluateQualityEnvelope } from "../../../packages/runtime/src/index.js";
import {
  ConfidenceGate,
  QuaternionOneEuroFilter,
  VectorOneEuroFilter,
  type ConfidenceGateView,
} from "../../../packages/tracking/src/index.js";
import { observeIrisScale } from "../../../packages/scale/src/index.js";
import { RuntimePerformanceMonitor, type RuntimePerformanceSummary } from "../../../packages/quality/src/index.js";

export type RuntimeViewReason = QualityEnvelopeReason | TrackingQualityReason | "face-missing" | "watchdog-expired";
export type RuntimeScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

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
  scheduler?: RuntimeScheduler;
  watchdogLimitMs?: number;
  sourceGuard?: () => boolean;
  onSourceInvalid?: () => void;
};

export type SingleFrameRuntimeView = ConfidenceGateView & {
  hasFace: boolean;
  scaleConfidence: "low" | "medium" | "high";
  pose: HeadPose | null;
  millimetresPerPixel: number | null;
  landmarkCount: number;
  performance: RuntimePerformanceSummary;
  reasons: readonly RuntimeViewReason[];
  angles: HeadAngles | null;
  assetQuality: AssetQuality;
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
  readonly #scheduler: RuntimeScheduler;
  readonly #watchdogLimitMs: number;
  readonly #sourceGuard: () => boolean;
  readonly #onSourceInvalid: (() => void) | undefined;
  #lastPose: HeadPose | null = null;
  #lastFrame: RenderFrame | null = null;
  #asset: RuntimeAsset["asset"] | null = null;
  #initialized = false;
  #rendererInitialized = false;
  #generation = 0;
  #visibilityLease = 0;
  #watchdog: unknown = null;
  #lastView: SingleFrameRuntimeView | null = null;
  #processing = false;
  #disposed = false;
  #initializationCall: Promise<void> | null = null;
  #backendBarrier: Promise<void> = Promise.resolve();
  #backendCapability: {
    generation: number;
    activated: boolean;
    disposed: boolean;
    cancel(): void;
    cancellation: Promise<void>;
    initialization: Promise<void>;
  } | null = null;

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
    this.#scheduler = dependencies.scheduler ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.#watchdogLimitMs = dependencies.watchdogLimitMs ?? 250;
    this.#sourceGuard = dependencies.sourceGuard ?? (() => true);
    this.#onSourceInvalid = dependencies.onSourceInvalid;
    if (!Number.isFinite(this.#watchdogLimitMs) || this.#watchdogLimitMs <= 0 || this.#watchdogLimitMs > 250) {
      throw new RangeError("watchdogLimitMs must be in (0, 250]");
    }
  }

  initialize(canvas: HTMLCanvasElement, asset: RuntimeAsset): Promise<void> {
    if (this.#initialized) return Promise.resolve();
    if (this.#initializationCall && !this.#disposed) return this.#initializationCall;
    const generation = ++this.#generation;
    this.#disposed = false;
    const previous = this.#initializationCall?.catch(() => undefined) ?? Promise.resolve();
    const run = previous.then(() => this.#initializeGeneration(canvas, asset, generation));
    let tracked!: Promise<void>;
    tracked = run.finally(() => { if (this.#initializationCall === tracked) this.#initializationCall = null; });
    this.#initializationCall = tracked;
    return tracked;
  }

  async #initializeGeneration(canvas: HTMLCanvasElement, asset: RuntimeAsset, generation: number): Promise<void> {
    if (this.#initialized) return;
    if (generation !== this.#generation || this.#disposed) throw new Error("single-frame runtime initialization cancelled");
    this.#asset = asset.asset;
    this.#performance.start();
    let cancelBackend!: () => void;
    const cancellation = new Promise<void>((resolve) => { cancelBackend = resolve; });
    const capability = {
      generation,
      activated: false,
      disposed: false,
      cancel: cancelBackend,
      cancellation,
      initialization: Promise.resolve(),
    };
    const backendInitialization = this.#backendBarrier.then(async () => {
      if (capability.disposed || generation !== this.#generation) throw new Error("single-frame runtime initialization cancelled");
      capability.activated = true;
      await this.#backend.initialize();
    });
    capability.initialization = backendInitialization;
    this.#backendCapability = capability;
    try {
      await Promise.all([
        Promise.race([
          backendInitialization,
          cancellation.then(() => { throw new Error("single-frame runtime initialization cancelled"); }),
        ]),
        this.#renderer.initialize(canvas).then(() => {
          if (generation === this.#generation) this.#rendererInitialized = true;
        }),
      ]);
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
    if (!this.#initialized || !this.#asset) throw new Error("single-frame runtime must be initialized before process");
    if (this.#processing) throw new Error("single-frame runtime accepts only one in-flight frame");
    this.#processing = true;
    const generation = this.#generation;
    const lease = this.#visibilityLease;
    try {
      const detectionStartedMs = this.#now();
      const tracking = await this.#backend.detect(frame);
      if (generation !== this.#generation || !this.#initialized) throw new Error("single-frame runtime process cancelled");
      this.#assertSourceCurrent();
      if (lease !== this.#visibilityLease) return this.#hiddenView("watchdog-expired");
      this.#performance.recordDetection(this.#now() - detectionStartedMs, tracking !== null);
      const gate = this.#gate.update(tracking?.confidence ?? 0, this.#now());
      if (!tracking || tracking.confidence <= 0) {
        if (this.#lastPose) {
          this.#renderAndLease({
            timestampSeconds: frame.timestampSeconds,
            pose: this.#lastPose,
            scale: { millimetresPerPixel: null, confidence: "low", sampleCount: 0, reason: "face-missing" },
            opacity: gate.opacity,
            cameraCalibration: camera,
          }, gate.belowExitSinceMs === null);
        }
        return this.#remember({
          ...gate,
          hasFace: false,
          scaleConfidence: "low",
          pose: this.#lastPose,
          millimetresPerPixel: null,
          landmarkCount: tracking?.landmarks.length ?? 0,
          performance: this.#performance.summary(),
          reasons: tracking ? tracking.quality?.reasons ?? ["face-missing"] : ["face-missing"],
          angles: null,
          assetQuality: this.#asset.quality,
        });
      }

      const rawPose = this.#poseAdapter.resolve(tracking, camera);
      const scale = this.#scaleResolver.update(observeIrisScale(tracking, camera));
      const envelope = evaluateQualityEnvelope({
        rawPose,
        scale,
        envelope: this.#asset.qualityEnvelope,
        assetQuality: this.#asset.quality,
      });
      if (!envelope.allowed) {
        this.#renderAndLease({
          timestampSeconds: frame.timestampSeconds,
          pose: rawPose,
          scale,
          opacity: 0,
          faceLandmarks: tracking.landmarks,
          cameraCalibration: camera,
        }, false);
        const reasons = [...(tracking.quality?.reasons ?? []), ...envelope.reasons];
        return this.#remember({
          ...gate,
          opacity: 0,
          shouldRender: false,
          hasFace: true,
          scaleConfidence: scale.confidence,
          pose: rawPose,
          millimetresPerPixel: scale.millimetresPerPixel,
          landmarkCount: tracking.landmarks.length,
          performance: this.#performance.summary(),
          reasons,
          angles: envelope.angles,
          assetQuality: envelope.assetQuality,
        });
      }
      const filteredPosition = this.#translationFilter.filter(rawPose.position, frame.timestampSeconds);
      const filteredRotation = this.#rotationFilter.filter(rawPose.rotation, frame.timestampSeconds);
      const pose: HeadPose = {
        position: { x: metres(filteredPosition.x), y: metres(filteredPosition.y), z: metres(filteredPosition.z) },
        rotation: filteredRotation,
        sourceConfidence: rawPose.sourceConfidence,
      };
      this.#lastPose = pose;
      const finalOpacity = gate.opacity;
      this.#renderAndLease({
        timestampSeconds: frame.timestampSeconds,
        pose,
        scale,
        opacity: finalOpacity,
        faceLandmarks: tracking.landmarks,
        cameraCalibration: camera,
      }, gate.belowExitSinceMs === null);
      const reasons = [...(tracking.quality?.reasons ?? []), ...envelope.reasons];
      return this.#remember({
        ...gate,
        opacity: finalOpacity,
        shouldRender: finalOpacity > 0,
        hasFace: true,
        scaleConfidence: scale.confidence,
        pose,
        millimetresPerPixel: scale.millimetresPerPixel,
        landmarkCount: tracking.landmarks.length,
        performance: this.#performance.summary(),
        reasons,
        angles: envelope.angles,
        assetQuality: envelope.assetQuality,
      });
    } finally {
      this.#processing = false;
    }
  }

  view(): SingleFrameRuntimeView | null {
    return this.#lastView;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    ++this.#generation;
    this.#initialized = false;
    this.#cancelWatchdog(true);
    let rendererFailure: unknown;
    try {
      if (this.#rendererInitialized) this.#renderer.hide();
    } catch (error) { rendererFailure = error; }
    try { this.#renderer.dispose(); } catch (error) { rendererFailure ??= error; }
    this.#rendererInitialized = false;
    this.#lastPose = null;
    this.#lastFrame = null;
    this.#lastView = null;
    this.#asset = null;
    this.#gate.reset();
    this.#translationFilter.reset();
    this.#rotationFilter.reset();
    this.#scaleResolver.reset();
    this.#performance.reset();
    const capability = this.#backendCapability;
    if (!capability || capability.disposed) {
      if (rendererFailure) throw rendererFailure;
      return;
    }
    capability.disposed = true;
    capability.cancel();
    let backendDisposal: Promise<void> = Promise.resolve();
    if (capability.activated) {
      try { backendDisposal = Promise.resolve(this.#backend.dispose()); }
      catch (error) { backendDisposal = Promise.reject(error); }
    }
    this.#backendBarrier = Promise.allSettled([capability.initialization, backendDisposal]).then(() => undefined);
    await backendDisposal;
    if (rendererFailure) throw rendererFailure;
  }

  #remember(view: SingleFrameRuntimeView): SingleFrameRuntimeView {
    this.#assertSourceCurrent();
    this.#lastView = view;
    return view;
  }

  #hiddenView(reason: RuntimeViewReason): SingleFrameRuntimeView {
    const gate = this.#gate.forceLost();
    if (this.#lastView) return this.#remember({ ...this.#lastView, ...gate, opacity: 0, shouldRender: false, reasons: [reason] });
    if (!this.#asset) throw new Error("single-frame runtime process cancelled");
    return this.#remember({
      ...gate, hasFace: false, scaleConfidence: "low", pose: null, millimetresPerPixel: null,
      landmarkCount: 0, performance: this.#performance.summary(), reasons: [reason], angles: null,
      assetQuality: this.#asset.quality,
    });
  }

  #renderAndLease(frame: RenderFrame, refreshHealthyLease: boolean): void {
    this.#render(frame);
    this.#lastFrame = frame;
    if (frame.opacity <= 0) {
      this.#cancelWatchdog(true);
      return;
    }
    if (refreshHealthyLease) this.#armWatchdog();
  }

  #armWatchdog(): void {
    this.#cancelWatchdog(false);
    const generation = this.#generation;
    const lease = ++this.#visibilityLease;
    this.#watchdog = this.#scheduler.setTimeout(() => {
      if (generation !== this.#generation || lease !== this.#visibilityLease || !this.#initialized || !this.#lastFrame) return;
      if (!this.#sourceGuard()) {
        ++this.#visibilityLease;
        this.#gate.forceLost();
        try { this.#renderer.hide(); } catch { /* Teardown still owns final renderer disposal. */ }
        if (this.#lastView) this.#lastView = { ...this.#lastView, ...this.#gate.view(), opacity: 0, shouldRender: false, reasons: ["watchdog-expired"] };
        try { this.#onSourceInvalid?.(); } catch { /* Callback failure cannot preserve visibility. */ }
        return;
      }
      this.#watchdog = null;
      ++this.#visibilityLease;
      this.#gate.forceLost();
      this.#render({ ...this.#lastFrame, opacity: 0 });
      if (this.#lastView) this.#lastView = { ...this.#lastView, ...this.#gate.view(), opacity: 0, shouldRender: false, reasons: ["watchdog-expired"] };
    }, this.#watchdogLimitMs);
  }

  #cancelWatchdog(invalidate: boolean): void {
    if (this.#watchdog !== null) this.#scheduler.clearTimeout(this.#watchdog);
    this.#watchdog = null;
    if (invalidate) ++this.#visibilityLease;
  }

  #render(frame: RenderFrame): void {
    this.#assertSourceCurrent();
    const renderStartedMs = this.#now();
    this.#renderer.render(frame);
    this.#performance.recordRender(this.#now() - renderStartedMs);
  }

  #assertSourceCurrent(): void {
    if (!this.#sourceGuard()) throw new Error("camera projection source capability changed");
  }
}
