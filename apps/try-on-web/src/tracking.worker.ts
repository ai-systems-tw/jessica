import {
  MediaPipeFaceLandmarkerBackend,
  type MediaPipeFaceLandmarkerFactory,
} from "../../../packages/face-tracking/src/mediapipeFaceLandmarker.js";
import {
  parseTrackingWorkerRequest,
  protocolEnvelope,
  type TrackingWorkerDiagnostics,
  type TrackingWorkerErrorCode,
  type TrackingWorkerFrameRequest,
  type TrackingWorkerInitRequest,
  type TrackingWorkerRequest,
} from "../../../packages/face-tracking/src/workerProtocol.js";
import {
  closeTransferredFrameIfPresent,
  withOwnedTrackingFrame,
} from "../../../packages/face-tracking/src/workerFrameOwnership.js";

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
  close(): void;
};

const scope = globalThis as unknown as WorkerScope;
let backend: MediaPipeFaceLandmarkerBackend | null = null;
let active: { sessionId: string; generation: number; allowedOrigin: string } | null = null;
let initializedAtMs = 0;
let framesReceived = 0;
let resultsSent = 0;
let noFaceSent = 0;
let errorsSent = 0;
let lastTimestampUs: number | null = null;
const observedResourceUrls = new Set<string>();
const MAXIMUM_MODEL_BYTES = 32 * 1024 * 1024;

class FatalWorkerError extends Error {}

function diagnostics(): TrackingWorkerDiagnostics {
  return {
    workerGeneration: active?.generation ?? 1,
    initializedAtMs,
    resourceOrigins: [...observedResourceUrls].map((url) => new URL(url).origin).filter((origin, index, values) => values.indexOf(origin) === index).sort(),
    framesReceived, resultsSent, noFaceSent, errorsSent, lastTimestampUs,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown tracking Worker error";
}

function errorResponse(
  envelope: { sessionId: string; generation: number },
  phase: "handshake" | "initialize" | "detect" | "dispose",
  code: TrackingWorkerErrorCode,
  error: unknown,
  fatal: boolean,
  frame?: { requestId: number; timestampUs: number },
): void {
  errorsSent += 1;
  scope.postMessage({
    ...protocolEnvelope(envelope.sessionId, envelope.generation), kind: "error", phase, code,
    message: message(error), fatal,
    ...(frame ? { requestId: frame.requestId, timestampUs: frame.timestampUs } : {}),
    diagnostics: diagnostics(),
  });
}

function requireSameOriginUrl(value: string, allowedOrigin: string, label: string): URL {
  const url = new URL(value);
  if (url.origin !== allowedOrigin) throw new Error(`${label} escaped the allowed runtime origin`);
  return url;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function resourceEntries(): string[] {
  if (typeof performance.getEntriesByType !== "function") return [];
  return performance.getEntriesByType("resource").map((entry) => entry.name);
}

function auditObservedResources(allowedOrigin: string): void {
  for (const url of resourceEntries()) {
    observedResourceUrls.add(url);
    if (new URL(url).origin !== allowedOrigin) throw new FatalWorkerError(`Worker runtime resource escaped allowed origin: ${url}`);
  }
}

async function readExactly(response: Response, expectedBytes: number): Promise<Uint8Array> {
  if (expectedBytes > MAXIMUM_MODEL_BYTES) throw new Error("tracking model pin exceeds the maximum allowed bytes");
  const contentLength = response.headers.get("content-length");
  if (contentLength === null || Number(contentLength) !== expectedBytes) throw new Error("tracking model Content-Length does not match its runtime pin");
  if (!response.body) throw new Error("tracking model response body is unavailable");
  const output = new Uint8Array(expectedBytes);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedBytes) throw new Error("tracking model response exceeds its runtime byte-length pin");
      output.set(value, offset); offset += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (offset !== expectedBytes) throw new Error("tracking model response is shorter than its runtime byte-length pin");
  return output;
}

async function initialize(request: TrackingWorkerInitRequest): Promise<void> {
  if (backend || active) throw new Error("tracking Worker accepts one initialized session");
  active = { sessionId: request.sessionId, generation: request.generation, allowedOrigin: request.resources.allowedOrigin };
  initializedAtMs = performance.now();
  const { resources } = request;
  if (new URL(resources.allowedOrigin).origin !== resources.allowedOrigin) throw new Error("allowedOrigin must be canonical");
  const visionModuleUrl = requireSameOriginUrl(resources.visionModuleUrl, resources.allowedOrigin, "vision module");
  const wasmBaseUrl = requireSameOriginUrl(resources.wasmBaseUrl, resources.allowedOrigin, "WASM base");
  const modelAssetUrl = requireSameOriginUrl(resources.modelAssetUrl, resources.allowedOrigin, "model");
  for (const url of [visionModuleUrl, wasmBaseUrl, modelAssetUrl]) observedResourceUrls.add(url.href);

  const response = await fetch(modelAssetUrl, { cache: "no-store", credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`tracking model HTTP ${response.status}`);
  requireSameOriginUrl(response.url, resources.allowedOrigin, "model redirect");
  const modelBytes = await readExactly(response, resources.modelByteLength);
  if (await sha256(modelBytes) !== resources.modelSha256) throw new Error("tracking model SHA-256 does not match its runtime pin");

  // A variable specifier is deliberate: the concrete, allowlisted URL is supplied by
  // the host because document import maps do not resolve module-Worker dependencies.
  const moduleUrl: string = visionModuleUrl.href;
  const vision = await import(moduleUrl) as {
    FilesetResolver: { forVisionTasks(url: string): Promise<unknown> };
    FaceLandmarker: { createFromOptions(files: unknown, options: unknown): Promise<{ detectForVideo(source: unknown, timestampMs: number): unknown; close(): void }> };
  };
  if (!vision.FilesetResolver?.forVisionTasks || !vision.FaceLandmarker?.createFromOptions) throw new Error("self-hosted MediaPipe vision module exports are invalid");
  const factory: MediaPipeFaceLandmarkerFactory = {
    resolveVisionFiles: (url) => vision.FilesetResolver.forVisionTasks(url),
    createLandmarker: async (files, options) => await vision.FaceLandmarker.createFromOptions(files, options) as never,
  };
  const candidate = new MediaPipeFaceLandmarkerBackend({
    wasmBaseUrl: wasmBaseUrl.href,
    modelAssetUrl: modelAssetUrl.href,
    modelAssetBytes: modelBytes,
    delegate: resources.delegate,
    minFaceDetectionConfidence: 0.65,
    minFacePresenceConfidence: 0.65,
    minTrackingConfidence: 0.65,
    onNetworkObservation: (observation) => observedResourceUrls.add(new URL(observation.url, resources.allowedOrigin).href),
  }, factory);
  try {
    await candidate.initialize();
    auditObservedResources(resources.allowedOrigin);
    backend = candidate;
  } catch (error) {
    await candidate.dispose();
    throw error;
  }
  scope.postMessage({ ...protocolEnvelope(request.sessionId, request.generation), kind: "ready", diagnostics: diagnostics() });
}

async function detect(request: TrackingWorkerFrameRequest): Promise<void> {
  return withOwnedTrackingFrame(request.frame, async () => {
    if (!backend || !active) throw new FatalWorkerError("tracking Worker is not initialized");
    if (request.sessionId !== active.sessionId || request.generation !== active.generation) throw new FatalWorkerError("tracking Worker frame session/generation is stale");
    if (lastTimestampUs !== null && request.timestampUs <= lastTimestampUs) throw new FatalWorkerError("tracking Worker timestamps must be strictly increasing");
    framesReceived += 1;
    lastTimestampUs = request.timestampUs;
    const result = await backend.detect({ source: request.frame, timestampSeconds: request.timestampUs / 1_000_000 });
    auditObservedResources(active.allowedOrigin);
    if (result) {
      resultsSent += 1;
      scope.postMessage({ ...protocolEnvelope(request.sessionId, request.generation), kind: "result", requestId: request.requestId, timestampUs: request.timestampUs, result, diagnostics: diagnostics() });
    } else {
      noFaceSent += 1;
      scope.postMessage({ ...protocolEnvelope(request.sessionId, request.generation), kind: "no-face", requestId: request.requestId, timestampUs: request.timestampUs, diagnostics: diagnostics() });
    }
  });
}

async function dispose(request: Extract<TrackingWorkerRequest, { kind: "dispose" }>): Promise<void> {
  if (!active || request.sessionId !== active.sessionId || request.generation !== active.generation) throw new Error("tracking Worker dispose session/generation is stale");
  await backend?.dispose();
  backend = null;
  scope.postMessage({ ...protocolEnvelope(request.sessionId, request.generation), kind: "disposed", diagnostics: diagnostics() });
  scope.close();
}

scope.addEventListener("message", (event) => {
  void (async () => {
    let request: TrackingWorkerRequest;
    try {
      request = parseTrackingWorkerRequest(event.data);
    } catch (error) {
      const raw = event.data as { sessionId?: unknown; generation?: unknown };
      closeTransferredFrameIfPresent(event.data);
      errorResponse({ sessionId: typeof raw?.sessionId === "string" && raw.sessionId ? raw.sessionId : "invalid-session", generation: Number.isSafeInteger(raw?.generation) && (raw.generation as number) > 0 ? raw.generation as number : 1 }, "handshake", "protocol-error", error, true);
      scope.close();
      return;
    }
    try {
      if (request.kind === "init") await initialize(request);
      else if (request.kind === "frame") await detect(request);
      else await dispose(request);
    } catch (error) {
      const phase = request.kind === "init" ? "initialize" : request.kind === "frame" ? "detect" : "dispose";
      const fatal = request.kind !== "frame" || error instanceof FatalWorkerError;
      errorResponse(request, phase, request.kind === "init" ? "initialization-failed" : request.kind === "frame" ? "detection-failed" : "worker-crash", error, fatal, request.kind === "frame" ? request : undefined);
      if (fatal) scope.close();
      // detect() owns and closes every accepted frame in its finally block.
    }
  })();
});
