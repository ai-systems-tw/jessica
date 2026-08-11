import { MediaPipeFaceLandmarkerBackend, mediaPipeFaceTriangleIndices } from "../../../packages/face-tracking/src/index.js";
import { MediaPipePoseAdapter } from "../../../packages/pose/src/index.js";
import { ThreeEyewearRenderer } from "../../../packages/rendering/src/index.js";
import { IrisScaleResolver } from "../../../packages/scale/src/index.js";
import type { CameraCalibration } from "../../../packages/runtime/src/index.js";
import { CameraSession } from "./cameraSession.js";
import { SingleFrameRuntime } from "./singleFrameRuntime.js";
import { loadDeployedRuntimeAsset, loadVerifiedRuntimeAsset, type VerifiedRuntimeAsset } from "./runtimeCatalog.js";
import { LocalStorageDeploymentReceiptStore, type DeploymentTrustConfiguration } from "./runtimeDeployment.js";
import { prepareAdmittedRuntime } from "./runtimeStartup.js";

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
let runtime: SingleFrameRuntime | null = null;
let loopGeneration = 0;

const params = new URLSearchParams(location.search);

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

async function liveAsset(): Promise<VerifiedRuntimeAsset> {
  if (params.has("catalog") || params.has("sku") || params.has("keyId") || params.has("publicKey") || params.has("deploymentSha256")) {
    throw new Error("public-live catalog, SKU, and trust pins cannot be selected by query parameters");
  }
  const configured = params.get("deployment");
  if (!configured) throw new Error("active deployment envelope is required (?deployment=<allowlisted-url>)");
  const config = deploymentConfig();
  if (!navigator.locks) throw new Error("public-live requires Web Locks for monotonic deployment receipt commits");
  const receiptStore = new LocalStorageDeploymentReceiptStore(localStorage, {
    request: (name, callback) => navigator.locks.request(name, callback),
  });
  return loadDeployedRuntimeAsset({
    deploymentUrl: new URL(configured, location.href),
    selection: { tenantId: config.tenantId, siteId: config.siteId, environment: config.environment },
    trust: config,
    receiptStore,
  });
}

session.subscribe((next) => {
  status.textContent = next.message;
  cameraBadge.textContent = next.state;
  cameraBadge.dataset.state = next.state;
  startButton.disabled = next.state === "requesting" || next.state === "active";
  stopButton.disabled = next.state !== "active";
});

function createRuntime(withOcclusion = true): SingleFrameRuntime {
  return new SingleFrameRuntime({
    backend: new MediaPipeFaceLandmarkerBackend({
      wasmBaseUrl: "./runtime/mediapipe/1.0.1/wasm",
      modelAssetUrl: "./runtime/mediapipe/face_landmarker.task",
      minFaceDetectionConfidence: 0.65,
      minFacePresenceConfidence: 0.65,
      minTrackingConfidence: 0.65,
    }),
    poseAdapter: new MediaPipePoseAdapter(),
    scaleResolver: new IrisScaleResolver(),
    renderer: new ThreeEyewearRenderer(
      withOcclusion ? {
        faceTriangleIndices: mediaPipeFaceTriangleIndices(),
        onContextLost: () => {
          status.textContent = "描画コンテキストが失われました。復旧まで眼鏡表示を停止します。";
          showTracking("context-lost");
        },
        onContextRestored: () => {
          status.textContent = "描画コンテキストが復旧しました。追跡を再開します。";
          showTracking("acquiring");
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

async function stopRuntime(nextTrackingState = "idle"): Promise<void> {
  ++loopGeneration;
  const current = runtime;
  runtime = null;
  if (current) await current.dispose();
  showTracking(nextTrackingState);
}

async function startRuntimeLoop(): Promise<boolean> {
  await stopRuntime();
  const startingGeneration = loopGeneration;
  showTracking("loading-model");
  let candidate: SingleFrameRuntime;
  try {
    candidate = await prepareAdmittedRuntime({ loadAsset: liveAsset, createRuntime, canvas });
  } catch (error) {
    if (startingGeneration !== loopGeneration) return false;
    throw error;
  }
  if (startingGeneration !== loopGeneration) {
    await candidate.dispose();
    return false;
  }
  runtime = candidate;
  const generation = ++loopGeneration;

  const nextFrame = async (timestampMs: number): Promise<void> => {
    if (generation !== loopGeneration || !runtime) return;
    try {
      const view = await candidate.process(
        { source: video, timestampSeconds: timestampMs / 1_000 },
        cameraCalibration(),
      );
      if (generation !== loopGeneration || runtime !== candidate) return;
      canvas.dataset.runtimePerformance = JSON.stringify(view.performance);
      canvas.dataset.runtimeView = JSON.stringify({ reasons: view.reasons, angles: view.angles, assetQuality: view.assetQuality, opacity: view.opacity });
      showTracking(view.state, view.hasFace ? `scale ${view.scaleConfidence} / ${view.assetQuality}` : "顔を画面内へ");
      requestAnimationFrame((nextTimestamp) => void nextFrame(nextTimestamp));
    } catch (error) {
      if (generation !== loopGeneration || runtime !== candidate) return;
      status.textContent = `追跡ランタイムを停止しました: ${error instanceof Error ? error.message : "unknown error"}`;
      await stopRuntime("error");
    }
  };
  requestAnimationFrame((timestamp) => void nextFrame(timestamp));
  return true;
}

startButton.addEventListener("click", () => {
  void (async () => {
    const camera = await session.start(video);
    if (camera.state !== "active") return;
    try {
      if (await startRuntimeLoop()) {
        status.textContent = "カメラとブラウザ内追跡ランタイムを開始しました。";
      }
    } catch (error) {
      status.textContent = `追跡モデルを開始できませんでした: ${error instanceof Error ? error.message : "unknown error"}`;
      await stopRuntime("error");
    }
  })();
});

stopButton.addEventListener("click", () => {
  void stopRuntime();
  session.stop(video);
});

window.addEventListener("pagehide", () => {
  void stopRuntime();
  session.stop(video);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  void stopRuntime("background-stopped");
  session.stop(video);
  status.textContent = "バックグラウンド移行のためカメラと追跡を停止しました。再開してください。";
});

async function runStaticSelfTest(): Promise<void> {
  await stopRuntime();
  showTracking("loading-model", "self-test");
  const candidate = createRuntime(false);
  runtime = candidate;
  const asset = await loadVerifiedRuntimeAsset({
    catalogUrl: new URL("./runtime/fixtures/self-test-catalog.json", location.href),
    mode: "calibration",
    allowedOrigins: [location.origin],
  });
  await candidate.initialize(canvas, asset);
  const response = await fetch("./runtime/fixtures/portrait.jpg");
  if (!response.ok) throw new Error(`self-test fixture HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const calibration: CameraCalibration = {
      sourceSize: { width: bitmap.width, height: bitmap.height },
      viewportSize: { width: canvas.clientWidth, height: canvas.clientHeight },
      mirrored: false,
      verticalFovDeg: 50,
      objectFit: "contain",
    };
    let view = await candidate.process({ source: bitmap, timestampSeconds: 0.001 }, calibration);
    let nextTimestampSeconds = 0.034;
    for (let attempt = 0; attempt < 8 && view.state !== "tracking"; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      view = await candidate.process({ source: bitmap, timestampSeconds: nextTimestampSeconds }, calibration);
      nextTimestampSeconds += 0.033;
    }
    if (!view.hasFace || view.state !== "tracking") {
      throw new Error(`unexpected result: ${view.state}, face=${view.hasFace}`);
    }
    canvas.dataset.runtimePerformance = JSON.stringify(view.performance);
    status.textContent = `SELF-TEST PASS: ${view.landmarkCount} landmarks / tracking / scale ${view.scaleConfidence}`;
    canvas.dataset.selfTestPose = JSON.stringify({
      position: view.pose?.position,
      rotation: view.pose?.rotation,
      millimetresPerPixel: view.millimetresPerPixel,
    });
    canvas.dataset.runtimeView = JSON.stringify({ reasons: view.reasons, angles: view.angles, assetQuality: view.assetQuality, opacity: view.opacity });
    const runtimeResources = performance.getEntriesByType("resource").map((entry) => entry.name);
    canvas.dataset.selfTestNetwork = JSON.stringify({
      requestCount: runtimeResources.length,
      external: runtimeResources.filter((url) => new URL(url, location.href).origin !== location.origin),
    });
    setTimeout(() => {
      if (runtime !== candidate) return;
      const watchdogView = candidate.view();
      canvas.dataset.watchdogView = JSON.stringify(watchdogView && { state: watchdogView.state, opacity: watchdogView.opacity, reasons: watchdogView.reasons });
    }, 275);
    showTracking("tracking", `self-test / scale ${view.scaleConfidence}`);
  } finally {
    bitmap.close();
  }
}

if (params.get("selfTest") === "1") {
  void runStaticSelfTest().catch(async (error) => {
    status.textContent = `SELF-TEST FAIL: ${error instanceof Error ? error.message : "unknown error"}`;
    await stopRuntime("error");
  });
}
