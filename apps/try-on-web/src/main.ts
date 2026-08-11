import { MediaPipeFaceLandmarkerBackend, mediaPipeFaceTriangleIndices } from "../../../packages/face-tracking/src/index.js";
import { MediaPipePoseAdapter } from "../../../packages/pose/src/index.js";
import { ThreeEyewearRenderer } from "../../../packages/rendering/src/index.js";
import { IrisScaleResolver } from "../../../packages/scale/src/index.js";
import type { CameraCalibration } from "../../../packages/runtime/src/index.js";
import { CameraSession } from "./cameraSession.js";
import { SingleFrameRuntime } from "./singleFrameRuntime.js";
import { loadVerifiedRuntimeAsset, type VerifiedRuntimeAsset } from "./runtimeCatalog.js";

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

function catalogPolicy(): { url: URL; allowedOrigins: string[] } {
  const configured = params.get("catalog");
  if (!configured) throw new Error("runtime catalog is required (?catalog=<url>)");
  const url = new URL(configured, location.href);
  const policy = requiredElement<HTMLMetaElement>('meta[name="jessica-catalog-origins"]').content
    .split(/\s+/).filter(Boolean);
  const allowedOrigins = policy.map((origin) => origin === "self" ? location.origin : new URL(origin).origin);
  const allowed = allowedOrigins.includes(url.origin);
  if (!allowed) throw new Error(`runtime catalog origin is not allowed: ${url.origin}`);
  return { url, allowedOrigins };
}

async function liveAsset(): Promise<VerifiedRuntimeAsset> {
  const sku = params.get("sku");
  const policy = catalogPolicy();
  return loadVerifiedRuntimeAsset({ catalogUrl: policy.url, allowedOrigins: policy.allowedOrigins, ...(sku ? { sku } : {}) });
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
  const candidate = createRuntime();
  runtime = candidate;
  showTracking("loading-model");
  try {
    const asset = await liveAsset();
    await candidate.initialize(canvas, asset);
  } catch (error) {
    if (runtime !== candidate) return false;
    throw error;
  }
  if (runtime !== candidate) return false;
  const generation = ++loopGeneration;

  const nextFrame = async (timestampMs: number): Promise<void> => {
    if (generation !== loopGeneration || !runtime) return;
    try {
      const view = await runtime.process(
        { source: video, timestampSeconds: timestampMs / 1_000 },
        cameraCalibration(),
      );
      canvas.dataset.runtimePerformance = JSON.stringify(view.performance);
      showTracking(view.state, view.hasFace ? `scale ${view.scaleConfidence}` : "顔を画面内へ");
      requestAnimationFrame((nextTimestamp) => void nextFrame(nextTimestamp));
    } catch (error) {
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
  runtime = createRuntime(false);
  const asset = await loadVerifiedRuntimeAsset({
    catalogUrl: new URL("./runtime/fixtures/self-test-catalog.json", location.href),
    allowFixture: true,
    allowedOrigins: [location.origin],
  });
  await runtime.initialize(canvas, asset);
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
    let view = await runtime.process({ source: bitmap, timestampSeconds: 0.001 }, calibration);
    for (const timestampSeconds of [0.05, 0.1, 0.15, 0.2]) {
      view = await runtime.process({ source: bitmap, timestampSeconds }, calibration);
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
