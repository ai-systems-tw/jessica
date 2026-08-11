import type { FaceTrackingBackend, FaceTrackingResult, ImageSize, VideoFrameInput } from "../../runtime/src/index.js";
import {
  parseTrackingWorkerResponse,
  protocolEnvelope,
  type TrackingWorkerDiagnostics,
  type TrackingWorkerFrameSource,
  type TrackingWorkerResourcePins,
  type TrackingWorkerResponse,
} from "./workerProtocol.js";

export interface TrackingWorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
}

export type WorkerFaceTrackingBackendConfig = {
  workerUrl: string;
  resources: TrackingWorkerResourcePins;
  initializeTimeoutMs?: number;
  inferenceTimeoutMs?: number;
  disposeTimeoutMs?: number;
  workerFactory?: (url: string) => TrackingWorkerLike;
  createTransferable?: (source: VideoFrameInput["source"]) => Promise<TrackingWorkerFrameSource>;
  sessionIdFactory?: () => string;
  scheduler?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  onDiagnostics?: (diagnostics: TrackingWorkerHostDiagnostics) => void;
};

export type TrackingWorkerHostDiagnostics = {
  sessionId: string;
  generation: number;
  state: "initializing" | "ready" | "disposing" | "failed" | "disposed";
  configuredUrls: readonly string[];
  submittedFrames: number;
  transferredFrames: number;
  droppedFrames: number;
  completedFrames: number;
  inferenceTimeouts: number;
  worker?: TrackingWorkerDiagnostics;
};

export class TrackingFrameDroppedError extends Error {
  constructor() { super("tracking frame dropped by latest-frame backpressure policy"); this.name = "TrackingFrameDroppedError"; }
}

type Job = {
  requestId: number;
  timestampUs: number;
  imageSize: ImageSize;
  frame: TrackingWorkerFrameSource | null;
  resolve(result: FaceTrackingResult | null): void;
  reject(error: unknown): void;
};

const defaultScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
  return value;
}

function sourceSize(source: VideoFrameInput["source"]): ImageSize {
  if ("videoWidth" in source) return { width: source.videoWidth, height: source.videoHeight };
  if ("displayWidth" in source) return { width: source.displayWidth, height: source.displayHeight };
  return { width: source.width, height: source.height };
}

function assertResourcePolicy(workerUrl: string, pins: TrackingWorkerResourcePins): readonly string[] {
  const origin = new URL(pins.allowedOrigin).origin;
  const urls = [workerUrl, pins.visionModuleUrl, pins.wasmBaseUrl, pins.modelAssetUrl].map((value) => new URL(value, pins.allowedOrigin));
  if (pins.allowedOrigin !== origin) throw new TypeError("allowedOrigin must be a canonical origin");
  if (urls.some((url) => url.origin !== origin)) throw new Error("tracking Worker resources must use the allowed same origin");
  if (pins.tasksVisionVersion !== "1.0.1") throw new Error("tracking Worker MediaPipe version pin is unsupported");
  if (!/^[a-f0-9]{64}$/.test(pins.modelSha256)) throw new TypeError("tracking Worker model SHA-256 pin is invalid");
  if (!Number.isSafeInteger(pins.modelByteLength) || pins.modelByteLength <= 0) throw new TypeError("tracking Worker model byte-length pin is invalid");
  return urls.map((url) => url.href);
}

function defaultWorkerFactory(url: string): TrackingWorkerLike {
  if (typeof Worker === "undefined") throw new Error("Worker support is required for public-live tracking");
  return new Worker(url, { name: "jessica-face-tracking" });
}

async function defaultCreateTransferable(source: VideoFrameInput["source"]): Promise<TrackingWorkerFrameSource> {
  if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap transfer support is required for public-live tracking");
  return createImageBitmap(source);
}

let fallbackSessionSequence = 0;
function defaultSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  fallbackSessionSequence += 1;
  return `jessica-worker-session-${fallbackSessionSequence}`;
}

export class WorkerFaceTrackingBackend implements FaceTrackingBackend {
  readonly #config: Required<Pick<WorkerFaceTrackingBackendConfig, "workerUrl" | "resources" | "initializeTimeoutMs" | "inferenceTimeoutMs" | "disposeTimeoutMs">> & Pick<WorkerFaceTrackingBackendConfig, "onDiagnostics">;
  readonly #workerFactory: NonNullable<WorkerFaceTrackingBackendConfig["workerFactory"]>;
  readonly #createTransferable: NonNullable<WorkerFaceTrackingBackendConfig["createTransferable"]>;
  readonly #sessionIdFactory: NonNullable<WorkerFaceTrackingBackendConfig["sessionIdFactory"]>;
  readonly #scheduler: NonNullable<WorkerFaceTrackingBackendConfig["scheduler"]>;
  readonly #configuredUrls: readonly string[];
  #worker: TrackingWorkerLike | null = null;
  #sessionId = "";
  #generation = 0;
  #state: TrackingWorkerHostDiagnostics["state"] = "disposed";
  #requestSequence = 0;
  #lastSubmittedTimestampUs: number | null = null;
  #lastCompletedTimestampUs: number | null = null;
  #inFlight: Job | null = null;
  #preparing: Job | null = null;
  #queuedLatest: Job | null = null;
  #lifecyclePromise: { resolve(): void; reject(error: unknown): void } | null = null;
  #timer: unknown = null;
  #submittedFrames = 0;
  #transferredFrames = 0;
  #droppedFrames = 0;
  #completedFrames = 0;
  #inferenceTimeouts = 0;
  #workerDiagnostics: TrackingWorkerDiagnostics | undefined;

  readonly #onMessage = (event: MessageEvent<unknown>): void => { this.#handleMessage(event.data); };
  readonly #onWorkerFailure = (event: Event): void => {
    const detail = "message" in event && typeof event.message === "string" && event.message.trim()
      ? `: ${event.message}`
      : "";
    this.#fail(new Error(`tracking Worker crashed or emitted an unreadable message${detail}`));
  };

  constructor(config: WorkerFaceTrackingBackendConfig) {
    if (!config.workerFactory && typeof Worker === "undefined") throw new Error("Worker support is required for public-live tracking");
    if (!config.createTransferable && typeof createImageBitmap !== "function") throw new Error("createImageBitmap transfer support is required for public-live tracking");
    this.#configuredUrls = assertResourcePolicy(config.workerUrl, config.resources);
    this.#config = {
      workerUrl: this.#configuredUrls[0]!, resources: { ...config.resources },
      initializeTimeoutMs: positive(config.initializeTimeoutMs ?? 15_000, "initializeTimeoutMs"),
      inferenceTimeoutMs: positive(config.inferenceTimeoutMs ?? 1_000, "inferenceTimeoutMs"),
      disposeTimeoutMs: positive(config.disposeTimeoutMs ?? 100, "disposeTimeoutMs"),
      ...(config.onDiagnostics ? { onDiagnostics: config.onDiagnostics } : {}),
    };
    this.#workerFactory = config.workerFactory ?? defaultWorkerFactory;
    this.#createTransferable = config.createTransferable ?? defaultCreateTransferable;
    this.#sessionIdFactory = config.sessionIdFactory ?? defaultSessionId;
    this.#scheduler = config.scheduler ?? defaultScheduler;
  }

  async initialize(): Promise<void> {
    if (this.#state === "ready") return;
    if (this.#worker) throw new Error("tracking Worker initialization is already pending");
    this.#sessionId = this.#sessionIdFactory();
    if (this.#sessionId.length === 0 || this.#sessionId.length > 128) throw new TypeError("sessionIdFactory must return 1..128 characters");
    const worker = this.#workerFactory(this.#config.workerUrl);
    this.#worker = worker;
    this.#generation += 1;
    this.#state = "initializing";
    this.#requestSequence = 0;
    this.#lastSubmittedTimestampUs = null;
    this.#lastCompletedTimestampUs = null;
    worker.addEventListener("message", this.#onMessage);
    worker.addEventListener("error", this.#onWorkerFailure);
    worker.addEventListener("messageerror", this.#onWorkerFailure);
    const promise = new Promise<void>((resolve, reject) => { this.#lifecyclePromise = { resolve, reject }; });
    this.#timer = this.#scheduler.setTimeout(() => this.#fail(new Error(`tracking Worker initialization timed out after ${this.#config.initializeTimeoutMs}ms`)), this.#config.initializeTimeoutMs);
    try {
      worker.postMessage({ ...protocolEnvelope(this.#sessionId, this.#generation), kind: "init", resources: this.#config.resources });
    } catch (error) {
      this.#fail(error);
    }
    this.#emitDiagnostics();
    return promise;
  }

  async detect(input: VideoFrameInput): Promise<FaceTrackingResult | null> {
    if (this.#state !== "ready" || !this.#worker) throw new Error("tracking Worker must be initialized before detect");
    if (!Number.isFinite(input.timestampSeconds) || input.timestampSeconds <= 0) throw new TypeError("timestampSeconds must be positive and finite");
    const timestampUs = Math.round(input.timestampSeconds * 1_000_000);
    if (!Number.isSafeInteger(timestampUs) || (this.#lastSubmittedTimestampUs !== null && timestampUs <= this.#lastSubmittedTimestampUs)) throw new RangeError("timestampSeconds must be strictly increasing at microsecond precision");
    this.#lastSubmittedTimestampUs = timestampUs;
    this.#submittedFrames += 1;
    const promise = new Promise<FaceTrackingResult | null>((resolve, reject) => {
      const job: Job = { requestId: ++this.#requestSequence, timestampUs, imageSize: { width: 0, height: 0 }, frame: null, resolve, reject };
      if (!this.#inFlight && !this.#preparing) this.#preparing = job;
      else {
        if (this.#queuedLatest) {
          this.#queuedLatest.frame?.close();
          this.#queuedLatest.reject(new TrackingFrameDroppedError());
          this.#droppedFrames += 1;
        }
        this.#queuedLatest = job;
        this.#emitDiagnostics();
      }
      void this.#prepare(job, input.source);
    });
    return promise;
  }

  async restart(): Promise<void> { await this.dispose(); await this.initialize(); }

  async dispose(): Promise<void> {
    const worker = this.#worker;
    if (!worker) { this.#state = "disposed"; this.#emitDiagnostics(); return; }
    const generation = this.#generation;
    const sessionId = this.#sessionId;
    this.#clearTimer();
    this.#lifecyclePromise?.reject(new Error("tracking Worker initialization cancelled"));
    this.#lifecyclePromise = null;
    const disposed = new Promise<void>((resolve) => {
      this.#lifecyclePromise = { resolve, reject: () => resolve() };
      this.#timer = this.#scheduler.setTimeout(resolve, this.#config.disposeTimeoutMs);
    });
    this.#state = "disposing";
    try { worker.postMessage({ ...protocolEnvelope(sessionId, generation), kind: "dispose" }); } catch { /* termination below is authoritative */ }
    await disposed;
    this.#terminate(new Error("tracking Worker disposed"), "disposed");
  }

  diagnostics(): TrackingWorkerHostDiagnostics {
    return {
      sessionId: this.#sessionId, generation: this.#generation, state: this.#state,
      configuredUrls: this.#configuredUrls, submittedFrames: this.#submittedFrames,
      transferredFrames: this.#transferredFrames, droppedFrames: this.#droppedFrames,
      completedFrames: this.#completedFrames, inferenceTimeouts: this.#inferenceTimeouts,
      ...(this.#workerDiagnostics ? { worker: this.#workerDiagnostics } : {}),
    };
  }

  #dispatch(job: Job): void {
    const worker = this.#worker;
    if (!job.frame) throw new Error("tracking Worker job dispatched before transfer preparation");
    if (!worker || this.#state !== "ready") { job.frame.close(); job.reject(new Error("tracking Worker detect cancelled")); return; }
    this.#inFlight = job;
    try {
      worker.postMessage({ ...protocolEnvelope(this.#sessionId, this.#generation), kind: "frame", requestId: job.requestId, timestampUs: job.timestampUs, imageSize: job.imageSize, frame: job.frame, transfer: { ownership: "worker", close: "worker-finally" } }, [job.frame as Transferable]);
      this.#transferredFrames += 1;
    } catch (error) {
      job.frame.close();
      this.#inFlight = null;
      job.reject(error);
      this.#fail(error);
      return;
    }
    this.#clearTimer();
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#inferenceTimeouts += 1;
      this.#fail(new Error(`tracking Worker inference timed out after ${this.#config.inferenceTimeoutMs}ms`));
    }, this.#config.inferenceTimeoutMs);
    this.#emitDiagnostics();
  }

  async #prepare(job: Job, source: VideoFrameInput["source"]): Promise<void> {
    let frame: TrackingWorkerFrameSource;
    try { frame = await this.#createTransferable(source); }
    catch (error) {
      if (this.#preparing === job) {
        this.#preparing = null; job.reject(error); this.#promoteQueued();
      } else if (this.#queuedLatest === job) { this.#queuedLatest = null; job.reject(error); }
      return;
    }
    if (this.#state !== "ready" || !this.#worker || (this.#preparing !== job && this.#queuedLatest !== job)) { frame.close(); return; }
    const size = sourceSize(frame);
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
      frame.close(); job.reject(new TypeError("transferable frame dimensions are invalid"));
      if (this.#preparing === job) { this.#preparing = null; this.#promoteQueued(); }
      else if (this.#queuedLatest === job) this.#queuedLatest = null;
      return;
    }
    job.frame = frame; job.imageSize = size;
    if (this.#preparing === job) { this.#preparing = null; this.#dispatch(job); }
  }

  #handleMessage(raw: unknown): void {
    let message: TrackingWorkerResponse;
    try { message = parseTrackingWorkerResponse(raw); } catch (error) { this.#fail(error); return; }
    if (message.sessionId !== this.#sessionId || message.generation !== this.#generation) return;
    if (message.diagnostics.workerGeneration !== message.generation || message.diagnostics.resourceOrigins.some((origin) => origin !== new URL(this.#config.resources.allowedOrigin).origin)) {
      this.#fail(new Error("tracking Worker diagnostics violated generation/origin policy")); return;
    }
    this.#workerDiagnostics = message.diagnostics;
    if (message.kind === "ready") {
      if (this.#state !== "initializing") { this.#fail(new Error("unexpected tracking Worker ready response")); return; }
      this.#clearTimer(); this.#state = "ready"; this.#lifecyclePromise?.resolve(); this.#lifecyclePromise = null; this.#emitDiagnostics(); return;
    }
    if (message.kind === "disposed") {
      if (this.#state !== "disposing") { this.#fail(new Error("unexpected tracking Worker disposed response")); return; }
      this.#clearTimer(); this.#lifecyclePromise?.resolve(); this.#lifecyclePromise = null; return;
    }
    if (message.kind === "error") {
      if (message.phase === "initialize" && this.#state !== "initializing") { this.#fail(new Error("unexpected tracking Worker initialization error")); return; }
      if (message.phase === "detect" && (this.#state !== "ready" || !this.#inFlight)) { this.#fail(new Error("unexpected tracking Worker detection error")); return; }
      if (message.phase === "dispose" && this.#state !== "disposing") { this.#fail(new Error("unexpected tracking Worker disposal error")); return; }
      if (message.fatal || message.phase !== "detect") { this.#fail(new Error(`tracking Worker ${message.code}: ${message.message}`)); return; }
      this.#complete(message, new Error(`tracking Worker detection-failed: ${message.message}`)); return;
    }
    if (this.#state !== "ready" || !this.#inFlight) { this.#fail(new Error("unexpected tracking Worker result response")); return; }
    this.#complete(message, null);
  }

  #complete(message: Extract<TrackingWorkerResponse, { kind: "result" | "no-face" | "error" }>, error: Error | null): void {
    const job = this.#inFlight;
    if (!job || message.requestId !== job.requestId || message.timestampUs !== job.timestampUs) { this.#fail(new Error("tracking Worker result ordering mismatch")); return; }
    if (this.#lastCompletedTimestampUs !== null && message.timestampUs <= this.#lastCompletedTimestampUs) { this.#fail(new Error("tracking Worker result timestamp is out of order")); return; }
    this.#lastCompletedTimestampUs = message.timestampUs;
    this.#clearTimer(); this.#inFlight = null; this.#completedFrames += 1;
    if (error) job.reject(error); else job.resolve(message.kind === "result" ? message.result : null);
    this.#promoteQueued();
    this.#emitDiagnostics();
  }

  #fail(error: unknown): void {
    const failure = error instanceof Error ? error : new Error("tracking Worker failed");
    this.#lifecyclePromise?.reject(failure); this.#lifecyclePromise = null;
    this.#terminate(failure, "failed");
  }

  #terminate(error: Error, state: "failed" | "disposed"): void {
    this.#clearTimer();
    const worker = this.#worker; this.#worker = null;
    if (worker) {
      worker.removeEventListener("message", this.#onMessage); worker.removeEventListener("error", this.#onWorkerFailure); worker.removeEventListener("messageerror", this.#onWorkerFailure); worker.terminate();
    }
    this.#inFlight?.reject(error); this.#inFlight = null;
    if (this.#preparing) { this.#preparing.frame?.close(); this.#preparing.reject(error); this.#preparing = null; }
    if (this.#queuedLatest) { this.#queuedLatest.frame?.close(); this.#queuedLatest.reject(error); this.#queuedLatest = null; }
    this.#state = state; this.#emitDiagnostics();
  }

  #clearTimer(): void { if (this.#timer !== null) this.#scheduler.clearTimeout(this.#timer); this.#timer = null; }
  #promoteQueued(): void {
    const next = this.#queuedLatest; this.#queuedLatest = null;
    if (!next) return;
    if (next.frame) this.#dispatch(next);
    else this.#preparing = next;
  }
  #emitDiagnostics(): void { this.#config.onDiagnostics?.(this.diagnostics()); }
}
