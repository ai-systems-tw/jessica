import type { FaceTrackingResult, ImageSize } from "../../runtime/src/index.js";

export const TRACKING_WORKER_PROTOCOL = "jessica.tracking-worker" as const;
export const TRACKING_WORKER_PROTOCOL_VERSION = 1 as const;
export const MEDIAPIPE_TASKS_VISION_VERSION = "1.0.1" as const;

export type TrackingWorkerResourcePins = {
  tasksVisionVersion: typeof MEDIAPIPE_TASKS_VISION_VERSION;
  visionModuleUrl: string;
  wasmBaseUrl: string;
  modelAssetUrl: string;
  modelSha256: string;
  modelByteLength: number;
  allowedOrigin: string;
  delegate: "CPU" | "GPU";
};

export type TrackingWorkerDiagnostics = {
  workerGeneration: number;
  initializedAtMs: number;
  resourceOrigins: readonly string[];
  framesReceived: number;
  resultsSent: number;
  noFaceSent: number;
  errorsSent: number;
  lastTimestampUs: number | null;
};

type Envelope = {
  protocol: typeof TRACKING_WORKER_PROTOCOL;
  version: typeof TRACKING_WORKER_PROTOCOL_VERSION;
  sessionId: string;
  generation: number;
};

export type TrackingWorkerInitRequest = Envelope & {
  kind: "init";
  resources: TrackingWorkerResourcePins;
};

export type TrackingWorkerFrameSource = ImageBitmap | VideoFrame;

export type TrackingWorkerFrameRequest = Envelope & {
  kind: "frame";
  requestId: number;
  timestampUs: number;
  imageSize: ImageSize;
  frame: TrackingWorkerFrameSource;
  transfer: { ownership: "worker"; close: "worker-finally" };
};

export type TrackingWorkerDisposeRequest = Envelope & { kind: "dispose" };
export type TrackingWorkerRequest = TrackingWorkerInitRequest | TrackingWorkerFrameRequest | TrackingWorkerDisposeRequest;

export type TrackingWorkerReadyResponse = Envelope & {
  kind: "ready";
  diagnostics: TrackingWorkerDiagnostics;
};

export type TrackingWorkerResultResponse = Envelope & {
  kind: "result";
  requestId: number;
  timestampUs: number;
  result: FaceTrackingResult;
  diagnostics: TrackingWorkerDiagnostics;
};

export type TrackingWorkerNoFaceResponse = Envelope & {
  kind: "no-face";
  requestId: number;
  timestampUs: number;
  diagnostics: TrackingWorkerDiagnostics;
};

export type TrackingWorkerErrorCode =
  | "protocol-error"
  | "initialization-failed"
  | "detection-failed"
  | "worker-crash";

export type TrackingWorkerErrorResponse = Envelope & {
  kind: "error";
  phase: "handshake" | "initialize" | "detect" | "dispose";
  code: TrackingWorkerErrorCode;
  message: string;
  fatal: boolean;
  requestId?: number;
  timestampUs?: number;
  diagnostics: TrackingWorkerDiagnostics;
};

export type TrackingWorkerDisposedResponse = Envelope & { kind: "disposed"; diagnostics: TrackingWorkerDiagnostics };
export type TrackingWorkerResponse =
  | TrackingWorkerReadyResponse
  | TrackingWorkerResultResponse
  | TrackingWorkerNoFaceResponse
  | TrackingWorkerErrorResponse
  | TrackingWorkerDisposedResponse;

const HASH = /^[a-f0-9]{64}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new TypeError(`${label} contains unknown field ${key}`);
}

function safePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(`${label} must be a positive safe integer`);
}

function finitePositive(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive and finite`);
}

function envelope(value: Record<string, unknown>): void {
  if (value.protocol !== TRACKING_WORKER_PROTOCOL || value.version !== TRACKING_WORKER_PROTOCOL_VERSION) {
    throw new TypeError("tracking Worker protocol/version mismatch");
  }
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0 || value.sessionId.length > 128) {
    throw new TypeError("sessionId must be non-blank and at most 128 characters");
  }
  safePositiveInteger(value.generation, "generation");
}

function diagnostics(value: unknown): asserts value is TrackingWorkerDiagnostics {
  const item = object(value, "diagnostics");
  exactKeys(item, ["workerGeneration", "initializedAtMs", "resourceOrigins", "framesReceived", "resultsSent", "noFaceSent", "errorsSent", "lastTimestampUs"], "diagnostics");
  safePositiveInteger(item.workerGeneration, "diagnostics.workerGeneration");
  if (typeof item.initializedAtMs !== "number" || !Number.isFinite(item.initializedAtMs)) throw new TypeError("diagnostics.initializedAtMs must be finite");
  if (!Array.isArray(item.resourceOrigins) || item.resourceOrigins.some((entry) => typeof entry !== "string")) throw new TypeError("diagnostics.resourceOrigins must be strings");
  for (const key of ["framesReceived", "resultsSent", "noFaceSent", "errorsSent"] as const) {
    if (!Number.isSafeInteger(item[key]) || (item[key] as number) < 0) throw new TypeError(`diagnostics.${key} must be a non-negative safe integer`);
  }
  if (item.lastTimestampUs !== null) safePositiveInteger(item.lastTimestampUs, "diagnostics.lastTimestampUs");
}

function validateResult(value: unknown, timestampUs: number): asserts value is FaceTrackingResult {
  const result = object(value, "result");
  exactKeys(result, ["timestampSeconds", "confidence", "landmarks", "facialTransform", "imageSize", "quality"], "result");
  if (result.timestampSeconds !== timestampUs / 1_000_000) throw new TypeError("result timestamp does not match response timestamp");
  if (typeof result.confidence !== "number" || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new TypeError("result confidence must be in [0,1]");
  if (!Array.isArray(result.landmarks) || result.landmarks.length !== 478) throw new TypeError("result must contain exactly 478 landmarks");
  for (const [index, raw] of result.landmarks.entries()) {
    const landmark = object(raw, `result.landmarks.${index}`);
    exactKeys(landmark, ["x", "y", "z", "visibility"], `result.landmarks.${index}`);
    for (const key of ["x", "y", "z"] as const) if (typeof landmark[key] !== "number" || !Number.isFinite(landmark[key])) throw new TypeError(`result.landmarks.${index}.${key} must be finite`);
    if (landmark.visibility !== undefined && (typeof landmark.visibility !== "number" || !Number.isFinite(landmark.visibility) || landmark.visibility < 0 || landmark.visibility > 1)) throw new TypeError(`result.landmarks.${index}.visibility must be in [0,1]`);
  }
  if (!Array.isArray(result.facialTransform) || result.facialTransform.length !== 16 || result.facialTransform.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) throw new TypeError("result transform must contain 16 finite numbers");
  const size = object(result.imageSize, "result.imageSize");
  exactKeys(size, ["width", "height"], "result.imageSize");
  finitePositive(size.width, "result.imageSize.width");
  finitePositive(size.height, "result.imageSize.height");
  if (result.quality !== undefined) {
    const quality = object(result.quality, "result.quality");
    exactKeys(quality, ["reasons", "metrics"], "result.quality");
    const allowedReasons = new Set(["landmark-count", "non-finite-landmark", "invalid-image-size", "invalid-transform", "face-out-of-frame", "face-too-small", "temporal-residual", "transform-jump"]);
    if (!Array.isArray(quality.reasons) || quality.reasons.some((reason) => typeof reason !== "string" || !allowedReasons.has(reason))) throw new TypeError("result.quality.reasons are invalid");
    const metrics = object(quality.metrics, "result.quality.metrics");
    const metricKeys = ["completenessRatio", "finiteRatio", "inFrameRatio", "pixelSpan", "temporalResidual", "rotationJumpDeg", "translationJumpRatio"] as const;
    exactKeys(metrics, metricKeys, "result.quality.metrics");
    for (const key of metricKeys) if (typeof metrics[key] !== "number" || !Number.isFinite(metrics[key]) || metrics[key] < 0) throw new TypeError(`result.quality.metrics.${key} must be non-negative and finite`);
    for (const key of ["completenessRatio", "finiteRatio", "inFrameRatio"] as const) if ((metrics[key] as number) > 1) throw new TypeError(`result.quality.metrics.${key} must be in [0,1]`);
  }
}

export function parseTrackingWorkerRequest(value: unknown): TrackingWorkerRequest {
  const item = object(value, "tracking Worker request");
  envelope(item);
  if (item.kind === "init") {
    exactKeys(item, ["protocol", "version", "sessionId", "generation", "kind", "resources"], "init request");
    const resources = object(item.resources, "resources");
    exactKeys(resources, ["tasksVisionVersion", "visionModuleUrl", "wasmBaseUrl", "modelAssetUrl", "modelSha256", "modelByteLength", "allowedOrigin", "delegate"], "resources");
    if (resources.tasksVisionVersion !== MEDIAPIPE_TASKS_VISION_VERSION) throw new TypeError("unsupported MediaPipe Tasks Vision version");
    for (const key of ["visionModuleUrl", "wasmBaseUrl", "modelAssetUrl", "allowedOrigin"] as const) if (typeof resources[key] !== "string" || resources[key].length === 0) throw new TypeError(`resources.${key} must be non-blank`);
    if (typeof resources.modelSha256 !== "string" || !HASH.test(resources.modelSha256)) throw new TypeError("resources.modelSha256 must be lowercase SHA-256");
    safePositiveInteger(resources.modelByteLength, "resources.modelByteLength");
    if (resources.delegate !== "CPU" && resources.delegate !== "GPU") throw new TypeError("resources.delegate is invalid");
    return item as TrackingWorkerInitRequest;
  }
  if (item.kind === "frame") {
    exactKeys(item, ["protocol", "version", "sessionId", "generation", "kind", "requestId", "timestampUs", "imageSize", "frame", "transfer"], "frame request");
    safePositiveInteger(item.requestId, "requestId");
    safePositiveInteger(item.timestampUs, "timestampUs");
    const size = object(item.imageSize, "imageSize");
    exactKeys(size, ["width", "height"], "imageSize");
    finitePositive(size.width, "imageSize.width"); finitePositive(size.height, "imageSize.height");
    const transfer = object(item.transfer, "transfer");
    exactKeys(transfer, ["ownership", "close"], "transfer");
    if (transfer.ownership !== "worker" || transfer.close !== "worker-finally") throw new TypeError("frame transfer contract is invalid");
    if (typeof item.frame !== "object" || item.frame === null || typeof (item.frame as { close?: unknown }).close !== "function") throw new TypeError("frame must be a closeable transferable");
    return item as TrackingWorkerFrameRequest;
  }
  if (item.kind === "dispose") {
    exactKeys(item, ["protocol", "version", "sessionId", "generation", "kind"], "dispose request");
    return item as TrackingWorkerDisposeRequest;
  }
  throw new TypeError("unknown tracking Worker request kind");
}

export function parseTrackingWorkerResponse(value: unknown): TrackingWorkerResponse {
  const item = object(value, "tracking Worker response");
  envelope(item);
  if (item.kind === "ready" || item.kind === "disposed") {
    exactKeys(item, ["protocol", "version", "sessionId", "generation", "kind", "diagnostics"], `${item.kind} response`);
    diagnostics(item.diagnostics);
    return item as TrackingWorkerReadyResponse | TrackingWorkerDisposedResponse;
  }
  if (item.kind === "result" || item.kind === "no-face") {
    exactKeys(item, ["protocol", "version", "sessionId", "generation", "kind", "requestId", "timestampUs", ...(item.kind === "result" ? ["result"] : []), "diagnostics"], `${item.kind} response`);
    safePositiveInteger(item.requestId, "requestId"); safePositiveInteger(item.timestampUs, "timestampUs"); diagnostics(item.diagnostics);
    if (item.kind === "result") validateResult(item.result, item.timestampUs);
    return item as TrackingWorkerResultResponse | TrackingWorkerNoFaceResponse;
  }
  if (item.kind === "error") {
    exactKeys(item, ["protocol", "version", "sessionId", "generation", "kind", "phase", "code", "message", "fatal", "requestId", "timestampUs", "diagnostics"], "error response");
    if (!["handshake", "initialize", "detect", "dispose"].includes(item.phase as string)) throw new TypeError("error phase is invalid");
    if (!["protocol-error", "initialization-failed", "detection-failed", "worker-crash"].includes(item.code as string)) throw new TypeError("error code is invalid");
    if (typeof item.message !== "string" || typeof item.fatal !== "boolean") throw new TypeError("error response fields are invalid");
    if (item.requestId !== undefined) safePositiveInteger(item.requestId, "requestId");
    if (item.timestampUs !== undefined) safePositiveInteger(item.timestampUs, "timestampUs");
    diagnostics(item.diagnostics);
    return item as TrackingWorkerErrorResponse;
  }
  throw new TypeError("unknown tracking Worker response kind");
}

export function protocolEnvelope(sessionId: string, generation: number): Envelope {
  return { protocol: TRACKING_WORKER_PROTOCOL, version: TRACKING_WORKER_PROTOCOL_VERSION, sessionId, generation };
}
