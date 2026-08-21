import {
  INITIAL_RUNTIME_LIFECYCLE,
  reduceRuntimeLifecycle,
  assertProductionAdmittedCameraProjection,
  assertCameraCalibrationForProjection,
  type CameraCalibration,
  type AdmittedCameraProjection,
  type CameraProjectionEvidence,
  type VerifiedCameraProjectionProfileSet,
  type RuntimeAsset,
  type RuntimeLifecycle,
  type RuntimeLifecycleAction,
  type VideoFrameInput,
} from "../../../packages/runtime/src/index.js";
import type { CameraStatus } from "./cameraSession.js";
import type { SingleFrameRuntimeView } from "./singleFrameRuntime.js";

export const APPLICATION_ERROR_MESSAGES = Object.freeze({
  CONFIGURATION_INVALID: "起動設定を確認できませんでした。管理者にお問い合わせください。",
  ASSET_PREFLIGHT_FAILED: "商品データを確認できませんでした。しばらくしてから再試行してください。",
  CAMERA_PERMISSION_DENIED: "カメラが許可されていません。ブラウザの権限設定を確認してください。",
  CAMERA_UNSUPPORTED: "この端末ではカメラを利用できません。",
  CAMERA_START_FAILED: "カメラを開始できませんでした。",
  CAMERA_PROJECTION_UNAVAILABLE: "カメラの投影情報を確認できませんでした。管理者にお問い合わせください。",
  RUNTIME_INITIALIZATION_FAILED: "追跡機能を開始できませんでした。しばらくしてから再試行してください。",
  TRACKING_FAILED: "追跡機能を停止しました。再開してください。",
  CAMERA_ENDED: "カメラ接続が終了しました。再開してください。",
  WEBGL_CONTEXT_LOST: "描画機能を停止しました。再開してください。",
  APPLICATION_LIFECYCLE_UNAVAILABLE: "安全なページ終了処理を開始できませんでした。ページを再読み込みしてください。",
} as const);

export type ApplicationErrorCode = keyof typeof APPLICATION_ERROR_MESSAGES;
export class ApplicationPreflightError extends Error {
  readonly code: "CONFIGURATION_INVALID" | "ASSET_PREFLIGHT_FAILED";

  constructor(code: "CONFIGURATION_INVALID" | "ASSET_PREFLIGHT_FAILED") {
    super(code);
    this.name = "ApplicationPreflightError";
    this.code = code;
  }
}
export type ApplicationCoordinatorStatus = {
  readonly lifecycle: RuntimeLifecycle;
  readonly phase: "idle" | "preflight" | "starting" | "running" | "stopping" | "terminal" | "destroyed";
  readonly message: string;
  readonly errorCode?: ApplicationErrorCode;
  readonly view?: SingleFrameRuntimeView;
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function sameProjectionEvidence(left: CameraProjectionEvidence, right: CameraProjectionEvidence): boolean {
  const settingKeys = ["width", "height", "aspectRatio", "facingMode", "deviceId", "resizeMode", "zoom", "pan", "tilt"] as const;
  return settingKeys.every((key) => Object.is(left.trackSettings[key], right.trackSettings[key]))
    && Object.is(left.videoSize.width, right.videoSize.width)
    && Object.is(left.videoSize.height, right.videoSize.height);
}

function statusSnapshot(
  lifecycle: RuntimeLifecycle,
  phase: ApplicationCoordinatorStatus["phase"],
  message: string,
  errorCode?: ApplicationErrorCode,
  view?: SingleFrameRuntimeView,
): ApplicationCoordinatorStatus {
  const lifecycleSnapshot = Object.freeze({ ...lifecycle });
  const viewSnapshot = view ? deepFreeze(structuredClone(view)) : undefined;
  return Object.freeze({ lifecycle: lifecycleSnapshot, phase, message, ...(errorCode ? { errorCode } : {}), ...(viewSnapshot ? { view: viewSnapshot } : {}) });
}

export function applicationControlPolicy(status: ApplicationCoordinatorStatus, selfTestMode: boolean): { startDisabled: boolean; stopDisabled: boolean } {
  if (selfTestMode) return { startDisabled: true, stopDisabled: true };
  return {
    startDisabled: ["preflight", "starting", "running", "stopping", "destroyed"].includes(status.phase),
    stopDisabled: !["preflight", "starting", "running"].includes(status.phase),
  };
}

export function applicationCaptureAvailable(status: ApplicationCoordinatorStatus): boolean {
  return status.phase === "running" && ["acquiring", "tracking", "degraded", "lost"].includes(status.lifecycle.state);
}

export type CoordinatorCameraPort = {
  readonly status: CameraStatus;
  subscribe(listener: (status: CameraStatus) => void): () => void;
  start(video: HTMLVideoElement): Promise<CameraStatus>;
  projectionEvidence(): CameraProjectionEvidence;
  stop(video?: HTMLVideoElement): CameraStatus;
};

export type CoordinatorRuntimePort = {
  initialize(canvas: HTMLCanvasElement, asset: RuntimeAsset): Promise<void>;
  process(frame: VideoFrameInput, camera: CameraCalibration): Promise<SingleFrameRuntimeView>;
  dispose(): Promise<void>;
};

export type CoordinatorRafPort = {
  request(callback: (timestampMs: number) => void): unknown;
  cancel(handle: unknown): void;
};

export type CoordinatorPageLifecyclePort = {
  onPageHide(callback: () => void): () => void;
  onVisibilityChange(callback: (hidden: boolean) => void): () => void;
};

export type ApplicationDiagnosticsEvent = {
  type: "cleanup-failed" | "observer-failed" | "lifecycle-listener-failed";
  operation: string;
  errorCode: ApplicationErrorCode | "INTERNAL_CALLBACK_FAILURE";
};

export type ApplicationCoordinatorDependencies = {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  preflight(signal: AbortSignal): Promise<{ readonly asset: RuntimeAsset; readonly projectionProfileSet: VerifiedCameraProjectionProfileSet; readonly admissionDeadlineEpochMs: number }>;
  camera: CoordinatorCameraPort;
  createRuntime(callbacks: { onContextLost(): void; onSourceInvalid(): void; sourceGuard(): boolean; projection: AdmittedCameraProjection; calibration: CameraCalibration }): CoordinatorRuntimePort;
  raf: CoordinatorRafPort;
  pageLifecycle: CoordinatorPageLifecyclePort;
  resolveProjection(profileSet: VerifiedCameraProjectionProfileSet, evidence: CameraProjectionEvidence, signal: AbortSignal): Promise<AdmittedCameraProjection>;
  calibration(projection: AdmittedCameraProjection): CameraCalibration;
  nowEpochMs(): number;
  diagnostics?: { report(event: ApplicationDiagnosticsEvent): void };
  onPageHidden?: () => void;
  onDestroy?: () => void;
};

const IDLE_MESSAGE = "カメラは停止しています。";
const STARTED_MESSAGE = "カメラとブラウザ内追跡ランタイムを開始しました。";
const BACKGROUND_MESSAGE = "バックグラウンド移行のためカメラと追跡を停止しました。再開してください。";

export class RuntimeApplicationCoordinator {
  readonly #dependencies: ApplicationCoordinatorDependencies;
  readonly #listeners = new Set<(status: ApplicationCoordinatorStatus) => void>();
  #status: ApplicationCoordinatorStatus = statusSnapshot(INITIAL_RUNTIME_LIFECYCLE, "idle", IDLE_MESSAGE);
  #generation = 0;
  #runtime: CoordinatorRuntimePort | null = null;
  #rafHandle: unknown = null;
  #rafLease = 0;
  #preflightController: AbortController | null = null;
  #cameraOwned = false;
  #projection: AdmittedCameraProjection | null = null;
  #projectionEvidence: CameraProjectionEvidence | null = null;
  #destroyed = false;
  #operational = true;
  #teardownTail: Promise<void> = Promise.resolve();
  #removeCameraListener: (() => void) | null = null;
  #removePageHideListener: (() => void) | null = null;
  #removeVisibilityListener: (() => void) | null = null;

  constructor(dependencies: ApplicationCoordinatorDependencies) {
    this.#dependencies = dependencies;
    try {
      this.#removeCameraListener = dependencies.camera.subscribe((status) => this.#cameraChanged(status));
      this.#removePageHideListener = dependencies.pageLifecycle.onPageHide(() => {
        this.#safeCallback(dependencies.onPageHidden, "page-hidden-callback");
        void this.dispose();
      });
      this.#removeVisibilityListener = dependencies.pageLifecycle.onVisibilityChange((hidden) => {
        if (!hidden) return;
        this.#safeCallback(dependencies.onPageHidden, "visibility-hidden-callback");
        void this.stop(BACKGROUND_MESSAGE);
      });
    } catch {
      try { this.#removeCameraListener?.(); } catch { /* Registration rollback is best effort. */ }
      try { this.#removePageHideListener?.(); } catch { /* Registration rollback is best effort. */ }
      try { this.#removeVisibilityListener?.(); } catch { /* Registration rollback is best effort. */ }
      this.#removeCameraListener = null;
      this.#removePageHideListener = null;
      this.#removeVisibilityListener = null;
      this.#operational = false;
      this.#status = statusSnapshot(
        reduceRuntimeLifecycle(INITIAL_RUNTIME_LIFECYCLE, { type: "FAILED", errorCode: "APPLICATION_LIFECYCLE_UNAVAILABLE" }),
        "terminal",
        APPLICATION_ERROR_MESSAGES.APPLICATION_LIFECYCLE_UNAVAILABLE,
        "APPLICATION_LIFECYCLE_UNAVAILABLE",
      );
      this.#report({ type: "lifecycle-listener-failed", operation: "register", errorCode: "INTERNAL_CALLBACK_FAILURE" });
    }
  }

  get status(): ApplicationCoordinatorStatus {
    return this.#status;
  }

  subscribe(listener: (status: ApplicationCoordinatorStatus) => void): () => void {
    this.#listeners.add(listener);
    try { listener(this.#status); } catch { this.#report({ type: "observer-failed", operation: "subscribe", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<ApplicationCoordinatorStatus> {
    if (this.#destroyed || !this.#operational) return this.#status;
    const generation = ++this.#generation;
    this.#publish(this.#status.lifecycle, "starting", "前のセッションを安全に終了しています…。");
    await this.#queueTeardown();
    if (!this.#owns(generation)) return this.#status;

    this.#transition({ type: "RESET" }, "起動設定と商品データを確認しています…。", "preflight");
    const controller = new AbortController();
    this.#preflightController = controller;
    let preflight: { readonly asset: RuntimeAsset; readonly projectionProfileSet: VerifiedCameraProjectionProfileSet; readonly admissionDeadlineEpochMs: number };
    try {
      preflight = await this.#dependencies.preflight(controller.signal);
      if (!Number.isSafeInteger(preflight.admissionDeadlineEpochMs) || this.#dependencies.nowEpochMs() >= preflight.admissionDeadlineEpochMs) {
        throw new ApplicationPreflightError("ASSET_PREFLIGHT_FAILED");
      }
    } catch (error) {
      if (!this.#owns(generation)) return this.#status;
      return this.#terminalFailure(error instanceof ApplicationPreflightError ? error.code : "ASSET_PREFLIGHT_FAILED", generation);
    } finally {
      if (this.#preflightController === controller) this.#preflightController = null;
    }
    if (!this.#owns(generation)) return this.#status;

    this.#transition({ type: "CAMERA_REQUESTED" }, "カメラの許可を確認しています…。", "starting");
    let cameraStatus: CameraStatus;
    try {
      cameraStatus = await this.#dependencies.camera.start(this.#dependencies.video);
    } catch {
      if (!this.#owns(generation)) return this.#status;
      return this.#terminalFailure("CAMERA_START_FAILED", generation);
    }
    if (!this.#owns(generation)) return this.#status;
    if (cameraStatus.state !== "active" || this.#dependencies.camera.status.state !== "active") {
      const code = cameraStatus.state === "permission-denied"
        ? "CAMERA_PERMISSION_DENIED"
        : cameraStatus.state === "unsupported" ? "CAMERA_UNSUPPORTED"
          : cameraStatus.state === "active" ? "CAMERA_ENDED" : "CAMERA_START_FAILED";
      return this.#terminalFailure(code, generation);
    }
    this.#cameraOwned = true;
    this.#transition({ type: "CAMERA_GRANTED" }, "カメラの投影情報を確認しています…。", "starting");

    const projectionController = new AbortController();
    this.#preflightController = projectionController;
    let projection: AdmittedCameraProjection;
    let projectionEvidence: CameraProjectionEvidence;
    try {
      projectionEvidence = deepFreeze(structuredClone(this.#dependencies.camera.projectionEvidence()));
      projection = await this.#dependencies.resolveProjection(preflight.projectionProfileSet, projectionEvidence, projectionController.signal);
      assertProductionAdmittedCameraProjection(projection);
      if (!sameProjectionEvidence(projectionEvidence, this.#dependencies.camera.projectionEvidence())) {
        throw new Error("camera projection evidence changed during admission");
      }
    } catch {
      if (!this.#owns(generation)) return this.#status;
      return this.#terminalFailure("CAMERA_PROJECTION_UNAVAILABLE", generation);
    } finally {
      if (this.#preflightController === projectionController) this.#preflightController = null;
    }
    if (!this.#owns(generation) || this.#dependencies.camera.status.state !== "active") return this.#status;
    if (this.#dependencies.nowEpochMs() >= preflight.admissionDeadlineEpochMs) {
      return this.#terminalFailure("ASSET_PREFLIGHT_FAILED", generation);
    }
    let calibration: CameraCalibration;
    try { calibration = this.#dependencies.calibration(projection); assertCameraCalibrationForProjection(calibration, projection); }
    catch { return this.#terminalFailure("CAMERA_PROJECTION_UNAVAILABLE", generation); }
    this.#projection = projection;
    this.#projectionEvidence = projectionEvidence;
    this.#publish(this.#status.lifecycle, "starting", "追跡モデルを読み込んでいます…。 ");

    let candidate: CoordinatorRuntimePort;
    try {
      candidate = this.#dependencies.createRuntime({
        onContextLost: () => void this.#terminalFailure("WEBGL_CONTEXT_LOST", generation),
        onSourceInvalid: () => void this.#terminalFailure("CAMERA_PROJECTION_UNAVAILABLE", generation),
        sourceGuard: () => this.#owns(generation) && this.#projectionEvidenceIsCurrent(),
        projection,
        calibration,
      });
    } catch {
      return this.#terminalFailure("RUNTIME_INITIALIZATION_FAILED", generation);
    }
    if (!this.#owns(generation)) {
      await this.#disposeUnowned(candidate, "stale-runtime-construction");
      return this.#status;
    }
    this.#runtime = candidate;
    try {
      await candidate.initialize(this.#dependencies.canvas, preflight.asset);
    } catch {
      if (!this.#owns(generation)) return this.#status;
      return this.#terminalFailure("RUNTIME_INITIALIZATION_FAILED", generation);
    }
    if (!this.#owns(generation) || this.#runtime !== candidate) return this.#status;
    this.#transition({ type: "MODEL_READY" }, STARTED_MESSAGE, "running");
    this.#schedule(generation, candidate);
    return this.#status;
  }

  async stop(message = IDLE_MESSAGE): Promise<ApplicationCoordinatorStatus> {
    const terminalGeneration = ++this.#generation;
    this.#publish(this.#status.lifecycle, "stopping", message);
    await this.#queueTeardown();
    if (!this.#destroyed && this.#operational && terminalGeneration === this.#generation) this.#transition({ type: "RESET" }, message, "idle");
    return this.#status;
  }

  async dispose(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    ++this.#generation;
    try { this.#removeCameraListener?.(); } catch { this.#report({ type: "cleanup-failed", operation: "remove-camera-listener", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    this.#removeCameraListener = null;
    try { this.#removePageHideListener?.(); } catch { this.#report({ type: "cleanup-failed", operation: "remove-pagehide-listener", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    this.#removePageHideListener = null;
    try { this.#removeVisibilityListener?.(); } catch { this.#report({ type: "cleanup-failed", operation: "remove-visibility-listener", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    this.#removeVisibilityListener = null;
    this.#safeCallback(this.#dependencies.onDestroy, "destroy-callback");
    await this.#queueTeardown();
    this.#publish(INITIAL_RUNTIME_LIFECYCLE, "destroyed", IDLE_MESSAGE);
  }

  async #terminalFailure(code: ApplicationErrorCode, generation: number): Promise<ApplicationCoordinatorStatus> {
    if (!this.#owns(generation)) return this.#status;
    const terminalGeneration = ++this.#generation;
    this.#publish(this.#status.lifecycle, "stopping", APPLICATION_ERROR_MESSAGES[code], code);
    await this.#queueTeardown();
    if (this.#destroyed || terminalGeneration !== this.#generation) return this.#status;
    if (code === "CAMERA_PERMISSION_DENIED") {
      this.#transition({ type: "CAMERA_DENIED" }, APPLICATION_ERROR_MESSAGES[code], "terminal", code);
    } else if (code === "CAMERA_UNSUPPORTED") {
      this.#transition({ type: "UNSUPPORTED" }, APPLICATION_ERROR_MESSAGES[code], "terminal", code);
    } else {
      this.#transition({ type: "FAILED", errorCode: code }, APPLICATION_ERROR_MESSAGES[code], "terminal", code);
    }
    return this.#status;
  }

  #schedule(generation: number, runtime: CoordinatorRuntimePort): void {
    if (!this.#owns(generation) || this.#runtime !== runtime || this.#rafHandle !== null) return;
    const lease = ++this.#rafLease;
    let firedSynchronously = false;
    let handle: unknown;
    try {
      handle = this.#dependencies.raf.request((timestampMs) => {
        firedSynchronously = true;
        if (lease !== this.#rafLease) return;
        this.#rafHandle = null;
        void this.#frame(generation, runtime, timestampMs);
      });
    } catch {
      void this.#terminalFailure("TRACKING_FAILED", generation);
      return;
    }
    if (firedSynchronously || !this.#owns(generation) || this.#runtime !== runtime || lease !== this.#rafLease) {
      try { this.#dependencies.raf.cancel(handle); } catch { this.#report({ type: "cleanup-failed", operation: "cancel-reentrant-raf", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
      return;
    }
    this.#rafHandle = handle;
  }

  async #frame(generation: number, runtime: CoordinatorRuntimePort, timestampMs: number): Promise<void> {
    if (!this.#owns(generation) || this.#runtime !== runtime) return;
    if (!this.#projectionEvidenceIsCurrent()) {
      await this.#terminalFailure("CAMERA_PROJECTION_UNAVAILABLE", generation);
      return;
    }
    let view: SingleFrameRuntimeView;
    try {
      const calibration = this.#projection ? this.#dependencies.calibration(this.#projection) : (() => { throw new Error("camera projection admission was lost"); })();
      if (!this.#projection) throw new Error("camera projection admission was lost");
      assertCameraCalibrationForProjection(calibration, this.#projection);
      view = await runtime.process(
        { source: this.#dependencies.video, timestampSeconds: timestampMs / 1_000 },
        calibration,
      );
    } catch {
      if (this.#owns(generation) && this.#runtime === runtime) {
        await this.#terminalFailure(this.#projectionEvidenceIsCurrent() ? "TRACKING_FAILED" : "CAMERA_PROJECTION_UNAVAILABLE", generation);
      }
      return;
    }
    if (!this.#owns(generation) || this.#runtime !== runtime) return;
    if (!this.#projectionEvidenceIsCurrent()) {
      await this.#terminalFailure("CAMERA_PROJECTION_UNAVAILABLE", generation);
      return;
    }
    this.#transition({ type: "TRACKING_UPDATED", trackingState: view.state }, STARTED_MESSAGE, "running", undefined, view);
    this.#schedule(generation, runtime);
  }

  #cameraChanged(status: CameraStatus): void {
    if (status.state !== "stopped" || !this.#cameraOwned || this.#destroyed) return;
    const generation = this.#generation;
    void this.#terminalFailure("CAMERA_ENDED", generation);
  }

  #projectionEvidenceIsCurrent(): boolean {
    try {
      return this.#projectionEvidence !== null
        && sameProjectionEvidence(this.#projectionEvidence, this.#dependencies.camera.projectionEvidence());
    } catch {
      return false;
    }
  }

  #queueTeardown(): Promise<void> {
    const teardown = this.#teardownTail.then(() => this.#teardown(), () => this.#teardown());
    this.#teardownTail = teardown.catch(() => undefined);
    return teardown;
  }

  async #teardown(): Promise<void> {
    this.#preflightController?.abort();
    this.#preflightController = null;
    if (this.#rafHandle !== null) {
      try { this.#dependencies.raf.cancel(this.#rafHandle); } catch { this.#report({ type: "cleanup-failed", operation: "cancel-raf", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
      this.#rafHandle = null;
    }
    ++this.#rafLease;
    const runtime = this.#runtime;
    this.#runtime = null;
    this.#cameraOwned = false;
    this.#projection = null;
    this.#projectionEvidence = null;
    let runtimeDisposal: Promise<void> | null = null;
    if (runtime) {
      try { runtimeDisposal = runtime.dispose(); } catch { this.#report({ type: "cleanup-failed", operation: "dispose-runtime", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    }
    try { this.#dependencies.camera.stop(this.#dependencies.video); } catch { this.#report({ type: "cleanup-failed", operation: "stop-camera", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    try {
      this.#dependencies.video.pause();
      this.#dependencies.video.srcObject = null;
    } catch { this.#report({ type: "cleanup-failed", operation: "clear-video", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    if (runtimeDisposal) {
      try { await runtimeDisposal; } catch { this.#report({ type: "cleanup-failed", operation: "dispose-runtime", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    }
  }

  async #disposeUnowned(runtime: CoordinatorRuntimePort, operation: string): Promise<void> {
    try { await runtime.dispose(); } catch { this.#report({ type: "cleanup-failed", operation, errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
  }

  #transition(action: RuntimeLifecycleAction, message: string, phase: ApplicationCoordinatorStatus["phase"], errorCode?: ApplicationErrorCode, view?: SingleFrameRuntimeView): void {
    const lifecycle = reduceRuntimeLifecycle(this.#status.lifecycle, action);
    this.#publish(lifecycle, phase, message, errorCode, view);
  }

  #publish(lifecycle: RuntimeLifecycle, phase: ApplicationCoordinatorStatus["phase"], message: string, errorCode?: ApplicationErrorCode, view?: SingleFrameRuntimeView): void {
    this.#status = statusSnapshot(lifecycle, phase, message, errorCode, view);
    for (const listener of this.#listeners) {
      try { listener(this.#status); } catch { this.#report({ type: "observer-failed", operation: "status", errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
    }
  }

  #safeCallback(callback: (() => void) | undefined, operation: string): void {
    if (!callback) return;
    try { callback(); } catch { this.#report({ type: "observer-failed", operation, errorCode: "INTERNAL_CALLBACK_FAILURE" }); }
  }

  #report(event: ApplicationDiagnosticsEvent): void {
    try { this.#dependencies.diagnostics?.report(event); } catch { /* Diagnostics are non-authoritative. */ }
  }

  #owns(generation: number): boolean {
    return !this.#destroyed && this.#operational && generation === this.#generation;
  }
}
