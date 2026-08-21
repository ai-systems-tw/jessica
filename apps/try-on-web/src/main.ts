import { WorkerFaceTrackingBackend, mediaPipeFaceTriangleIndices, type TrackingWorkerHostDiagnostics } from "../../../packages/face-tracking/src/index.js";
import { MediaPipePoseAdapter } from "../../../packages/pose/src/index.js";
import { ThreeEyewearRenderer } from "../../../packages/rendering/src/index.js";
import { IrisScaleResolver } from "../../../packages/scale/src/index.js";
import type { CameraCalibration } from "../../../packages/runtime/src/index.js";
import { CameraSession } from "./cameraSession.js";
import { SingleFrameRuntime } from "./singleFrameRuntime.js";
import { loadDeployedRuntimeAsset, loadVerifiedRuntimeAsset, type VerifiedRuntimeAsset } from "./runtimeCatalog.js";
import { LocalStorageDeploymentReceiptStore, type DeploymentTrustConfiguration } from "./runtimeDeployment.js";
import { installLowVisionCapture } from "./lowVisionCapture.js";
import { ApplicationPreflightError, RuntimeApplicationCoordinator, applicationCaptureAvailable, applicationControlPolicy } from "./applicationCoordinator.js";
import { CalibrationSelfTestSession } from "./calibrationSelfTestSession.js";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const video = requiredElement<HTMLVideoElement>("#camera");
const canvas = requiredElement<HTMLCanvasElement>("#try-on-canvas");
const startButton = requiredElement<HTMLButtonElement>("#start-camera");
const stopButton = requiredElement<HTMLButtonElement>("#stop-camera");
const status = requiredElement<HTMLElement>("#camera-status");
const cameraBadge = requiredElement<HTMLElement>("#camera-state");
const trackingBadge = requiredElement<HTMLElement>("#tracking-state");
const session = new CameraSession();
const lowVisionCapture = installLowVisionCapture({ video, overlay: canvas });
let trackingWorkerDiagnostics: TrackingWorkerHostDiagnostics | null = null;

const params = new URLSearchParams(location.search);
const selfTestMode = params.get("selfTest") === "1";

type HostDeploymentConfig = DeploymentTrustConfiguration & {
  tenantId: string;
  siteId: string;
  environment: "production";
};

function deploymentConfig(): HostDeploymentConfig {
  const content = requiredElement<HTMLMetaElement>('meta[name="jessica-deployment-config"]').content;
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("immutable host deployment configuration is invalid JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("immutable host deployment configuration is required");
  const config = value as Partial<HostDeploymentConfig>;
  if (typeof config.tenantId !== "string" || !config.tenantId || typeof config.siteId !== "string" || !config.siteId || config.environment !== "production") {
    throw new Error("immutable host tenant/site/production selection is required");
  }
  if (!Array.isArray(config.allowedDeploymentOrigins) || !Array.isArray(config.allowedCatalogOrigins) || typeof config.trustedKeys !== "object" || config.trustedKeys === null) {
    throw new Error("immutable host deployment/catalog origins and trusted key map are required");
  }
  if (!Number.isSafeInteger(config.minimumRevision) || !Number.isSafeInteger(config.minimumGeneration)
    || !Number.isSafeInteger(config.maximumDocumentLifetimeMs) || !Number.isSafeInteger(config.maximumDocumentAgeMs)) throw new Error("immutable host deployment freshness limits are required");
  return config as HostDeploymentConfig;
}

async function liveAsset(signal: AbortSignal): Promise<VerifiedRuntimeAsset> {
  if (params.has("catalog") || params.has("sku") || params.has("keyId") || params.has("publicKey") || params.has("deploymentSha256")) {
    throw new ApplicationPreflightError("CONFIGURATION_INVALID");
  }
  const configured = params.get("deployment");
  if (!configured) throw new ApplicationPreflightError("CONFIGURATION_INVALID");
  let config: HostDeploymentConfig;
  try { config = deploymentConfig(); } catch { throw new ApplicationPreflightError("CONFIGURATION_INVALID"); }
  if (!navigator.locks) throw new ApplicationPreflightError("CONFIGURATION_INVALID");
  const receiptStore = new LocalStorageDeploymentReceiptStore(localStorage, {
    request: (name, callback) => navigator.locks.request(name, callback),
  });
  return loadDeployedRuntimeAsset({
    deploymentUrl: new URL(configured, location.href),
    selection: { tenantId: config.tenantId, siteId: config.siteId, environment: config.environment },
    trust: config,
    receiptStore,
    signal,
  });
}

function createRuntime(withOcclusion = true, onContextLost?: () => void): SingleFrameRuntime {
  const runtimeOrigin = location.origin;
  return new SingleFrameRuntime({
    backend: new WorkerFaceTrackingBackend({
      workerUrl: new URL("../tracking-worker-bootstrap.js", import.meta.url).href,
      resources: {
        tasksVisionVersion: "1.0.1",
        visionModuleUrl: new URL("./runtime/mediapipe/1.0.1/vision_bundle.mjs", location.href).href,
        wasmBaseUrl: new URL("./runtime/mediapipe/1.0.1/wasm", location.href).href,
        modelAssetUrl: new URL("./runtime/mediapipe/face_landmarker.task", location.href).href,
        modelSha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
        modelByteLength: 3_758_596,
        allowedOrigin: runtimeOrigin,
        delegate: "GPU",
      },
      onDiagnostics: (next) => {
        trackingWorkerDiagnostics = next;
        canvas.dataset.trackingWorker = JSON.stringify(next);
      },
    }),
    poseAdapter: new MediaPipePoseAdapter(),
    scaleResolver: new IrisScaleResolver(),
    renderer: new ThreeEyewearRenderer(
      withOcclusion ? {
        faceTriangleIndices: mediaPipeFaceTriangleIndices(),
        onContextLost: () => {
          onContextLost?.();
        },
      } : {},
    ),
  });
}

function cameraCalibration(): CameraCalibration {
  return {
    sourceSize: { width: video.videoWidth, height: video.videoHeight },
    viewportSize: { width: canvas.clientWidth, height: canvas.clientHeight },
    mirrored: true,
    verticalFovDeg: 50,
    objectFit: "cover",
  };
}

function showTracking(state: string, detail = ""): void {
  trackingBadge.textContent = detail ? `${state} / ${detail}` : state;
  trackingBadge.dataset.state = state;
}

const selfTestSession = new CalibrationSelfTestSession({
  canvas,
  loadAsset: (signal) => loadVerifiedRuntimeAsset({
    catalogUrl: new URL("./runtime/fixtures/self-test-catalog.json", location.href),
    mode: "calibration",
    allowedOrigins: [location.origin],
    signal,
  }),
  createRuntime: () => createRuntime(false),
  loadFrame: async (signal) => {
    const response = await fetch("./runtime/fixtures/portrait.jpg", { signal });
    signal.throwIfAborted();
    if (!response.ok) throw new Error("self-test fixture unavailable");
    const blob = await response.blob();
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    if (signal.aborted) {
      bitmap.close();
      signal.throwIfAborted();
    }
    return bitmap;
  },
  execute: async (candidate, bitmap, signal) => {
    const calibration: CameraCalibration = {
      sourceSize: { width: bitmap.width, height: bitmap.height },
      viewportSize: { width: canvas.clientWidth, height: canvas.clientHeight },
      mirrored: false,
      verticalFovDeg: 50,
      objectFit: "contain",
    };
    let view = await candidate.process({ source: bitmap, timestampSeconds: 0.001 }, calibration);
    signal.throwIfAborted();
    let nextTimestampSeconds = 0.034;
    for (let attempt = 0; attempt < 8 && view.state !== "tracking"; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      signal.throwIfAborted();
      view = await candidate.process({ source: bitmap, timestampSeconds: nextTimestampSeconds }, calibration);
      signal.throwIfAborted();
      nextTimestampSeconds += 0.033;
    }
    if (!view.hasFace || view.state !== "tracking") throw new Error("self-test tracking unavailable");
    return view;
  },
  publish: (view, candidate, isCurrent) => {
    canvas.dataset.runtimePerformance = JSON.stringify(view.performance);
    status.textContent = `SELF-TEST PASS: ${view.landmarkCount} landmarks / tracking / scale ${view.scaleConfidence}`;
    canvas.dataset.selfTestPose = JSON.stringify({
      position: view.pose?.position,
      rotation: view.pose?.rotation,
      millimetresPerPixel: view.millimetresPerPixel,
    });
    canvas.dataset.runtimeView = JSON.stringify({ reasons: view.reasons, angles: view.angles, assetQuality: view.assetQuality, opacity: view.opacity });
    const windowResources = performance.getEntriesByType("resource").map((entry) => entry.name);
    const configuredWorkerResources = trackingWorkerDiagnostics?.configuredUrls ?? [];
    const workerResourceOrigins = trackingWorkerDiagnostics?.worker?.resourceOrigins ?? [];
    const runtimeResources = [...new Set([...windowResources, ...configuredWorkerResources])];
    canvas.dataset.selfTestNetwork = JSON.stringify({
      requestCount: runtimeResources.length,
      external: runtimeResources.filter((url) => new URL(url, location.href).origin !== location.origin),
      workerExternalOrigins: workerResourceOrigins.filter((origin) => origin !== location.origin),
      configuredWorkerResources,
    });
    setTimeout(() => {
      if (!isCurrent()) return;
      const watchdogView = candidate.view();
      canvas.dataset.watchdogView = JSON.stringify(watchdogView && { state: watchdogView.state, opacity: watchdogView.opacity, reasons: watchdogView.reasons });
    }, 275);
    showTracking("tracking", `self-test / scale ${view.scaleConfidence}`);
  },
  fail: () => {
    status.textContent = "SELF-TEST FAIL: calibration runtime unavailable";
    showTracking("error");
  },
});

async function destroySelfTestRuntime(): Promise<void> {
  await selfTestSession.destroy();
}

const coordinator = new RuntimeApplicationCoordinator({
  video,
  canvas,
  preflight: (signal) => liveAsset(signal),
  camera: session,
  createRuntime: ({ onContextLost }) => createRuntime(true, onContextLost),
  raf: {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle as number),
  },
  pageLifecycle: {
    onPageHide: (callback) => {
      window.addEventListener("pagehide", callback);
      return () => window.removeEventListener("pagehide", callback);
    },
    onVisibilityChange: (callback) => {
      const listener = () => callback(document.hidden);
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  },
  calibration: cameraCalibration,
  onPageHidden: () => {
    lowVisionCapture.pageHidden();
    void destroySelfTestRuntime();
  },
  onDestroy: () => {
    lowVisionCapture.destroy();
    void destroySelfTestRuntime();
  },
});

coordinator.subscribe((next) => {
  const lifecycle = next.lifecycle.state;
  const controls = applicationControlPolicy(next, selfTestMode);
  status.textContent = next.message;
  cameraBadge.textContent = lifecycle;
  cameraBadge.dataset.state = lifecycle;
  startButton.disabled = controls.startDisabled;
  stopButton.disabled = controls.stopDisabled;
  lowVisionCapture.setAvailable(applicationCaptureAvailable(next));
  if (next.view) {
    canvas.dataset.runtimePerformance = JSON.stringify(next.view.performance);
    canvas.dataset.runtimeView = JSON.stringify({ reasons: next.view.reasons, angles: next.view.angles, assetQuality: next.view.assetQuality, opacity: next.view.opacity });
    showTracking(next.view.state, next.view.hasFace ? `scale ${next.view.scaleConfidence} / ${next.view.assetQuality}` : "顔を画面内へ");
  } else {
    showTracking(lifecycle);
  }
});

if (!selfTestMode) {
  startButton.addEventListener("click", () => {
    void coordinator.start();
  });

  stopButton.addEventListener("click", () => {
    void coordinator.stop();
  });
}

async function runStaticSelfTest(): Promise<void> {
  await coordinator.stop();
  showTracking("loading-model", "self-test");
  await selfTestSession.start();
}

if (selfTestMode) {
  void runStaticSelfTest();
}
