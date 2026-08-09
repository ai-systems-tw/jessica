export type RuntimePerformanceSummary = {
  initializationMs: number | null;
  firstDetectionMs: number | null;
  firstRenderMs: number | null;
  detectionCount: number;
  faceDetectionCount: number;
  renderCount: number;
  averageDetectionMs: number | null;
  maximumDetectionMs: number | null;
  averageRenderMs: number | null;
  maximumRenderMs: number | null;
};

export class RuntimePerformanceMonitor {
  readonly #now: () => number;
  #startMs: number | null = null;
  #initializationMs: number | null = null;
  #firstDetectionMs: number | null = null;
  #firstRenderMs: number | null = null;
  #detectionCount = 0;
  #detectionTotalMs = 0;
  #maximumDetectionMs: number | null = null;
  #renderCount = 0;
  #renderTotalMs = 0;
  #maximumRenderMs: number | null = null;
  #faceDetectionCount = 0;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  start(): void {
    this.reset();
    this.#startMs = this.#now();
  }

  markInitialized(): void {
    this.#initializationMs = this.#elapsed();
  }

  recordDetection(durationMs: number, hasFace: boolean): void {
    this.#validateDuration(durationMs);
    this.#detectionCount += 1;
    this.#detectionTotalMs += durationMs;
    this.#maximumDetectionMs = Math.max(this.#maximumDetectionMs ?? 0, durationMs);
    if (hasFace) {
      this.#faceDetectionCount += 1;
      this.#firstDetectionMs ??= this.#elapsed();
    }
  }

  recordRender(durationMs: number): void {
    this.#validateDuration(durationMs);
    this.#renderCount += 1;
    this.#renderTotalMs += durationMs;
    this.#maximumRenderMs = Math.max(this.#maximumRenderMs ?? 0, durationMs);
    this.#firstRenderMs ??= this.#elapsed();
  }

  summary(): RuntimePerformanceSummary {
    return {
      initializationMs: this.#initializationMs,
      firstDetectionMs: this.#firstDetectionMs,
      firstRenderMs: this.#firstRenderMs,
      detectionCount: this.#detectionCount,
      faceDetectionCount: this.#faceDetectionCount,
      renderCount: this.#renderCount,
      averageDetectionMs: this.#detectionCount ? this.#detectionTotalMs / this.#detectionCount : null,
      maximumDetectionMs: this.#maximumDetectionMs,
      averageRenderMs: this.#renderCount ? this.#renderTotalMs / this.#renderCount : null,
      maximumRenderMs: this.#maximumRenderMs,
    };
  }

  reset(): void {
    this.#startMs = null;
    this.#initializationMs = null;
    this.#firstDetectionMs = null;
    this.#firstRenderMs = null;
    this.#detectionCount = 0;
    this.#detectionTotalMs = 0;
    this.#maximumDetectionMs = null;
    this.#renderCount = 0;
    this.#renderTotalMs = 0;
    this.#maximumRenderMs = null;
    this.#faceDetectionCount = 0;
  }

  #elapsed(): number {
    if (this.#startMs === null) throw new Error("performance monitor must be started first");
    return this.#now() - this.#startMs;
  }

  #validateDuration(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("duration must be non-negative and finite");
    }
    if (this.#startMs === null) throw new Error("performance monitor must be started first");
  }

}
