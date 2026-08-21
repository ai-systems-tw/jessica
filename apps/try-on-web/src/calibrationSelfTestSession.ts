export type CalibrationSelfTestRuntime<TAsset> = {
  initialize(canvas: HTMLCanvasElement, asset: TAsset): Promise<void>;
  dispose(): Promise<void>;
};

export type CalibrationSelfTestFrame = { close(): void };

export type CalibrationSelfTestDependencies<TAsset, TRuntime extends CalibrationSelfTestRuntime<TAsset>, TFrame extends CalibrationSelfTestFrame, TResult> = {
  canvas: HTMLCanvasElement;
  loadAsset(signal: AbortSignal): Promise<TAsset>;
  createRuntime(): TRuntime;
  loadFrame(signal: AbortSignal): Promise<TFrame>;
  execute(runtime: TRuntime, frame: TFrame, signal: AbortSignal): Promise<TResult>;
  publish(result: TResult, runtime: TRuntime, isCurrent: () => boolean): void;
  fail(): void;
};

export class CalibrationSelfTestSession<TAsset, TRuntime extends CalibrationSelfTestRuntime<TAsset>, TFrame extends CalibrationSelfTestFrame, TResult> {
  readonly #dependencies: CalibrationSelfTestDependencies<TAsset, TRuntime, TFrame, TResult>;
  #generation = 0;
  #controller: AbortController | null = null;
  #runtime: TRuntime | null = null;
  #frame: TFrame | null = null;
  #destroyed = false;

  constructor(dependencies: CalibrationSelfTestDependencies<TAsset, TRuntime, TFrame, TResult>) {
    this.#dependencies = dependencies;
  }

  async start(): Promise<void> {
    if (this.#destroyed) return;
    const generation = ++this.#generation;
    await this.#teardown();
    if (!this.#owns(generation)) return;
    const controller = new AbortController();
    this.#controller = controller;
    try {
      const asset = await this.#dependencies.loadAsset(controller.signal);
      if (!this.#owns(generation)) return;
      const runtime = this.#dependencies.createRuntime();
      this.#runtime = runtime;
      await runtime.initialize(this.#dependencies.canvas, asset);
      if (!this.#owns(generation) || this.#runtime !== runtime) return;
      const frame = await this.#dependencies.loadFrame(controller.signal);
      if (!this.#owns(generation) || this.#runtime !== runtime) {
        frame.close();
        return;
      }
      this.#frame = frame;
      const result = await this.#dependencies.execute(runtime, frame, controller.signal);
      if (!this.#owns(generation) || this.#runtime !== runtime || this.#frame !== frame) return;
      this.#dependencies.publish(result, runtime, () => this.#owns(generation) && this.#runtime === runtime);
    } catch {
      if (!this.#owns(generation)) return;
      const failureGeneration = ++this.#generation;
      await this.#teardown();
      if (failureGeneration === this.#generation) this.#dependencies.fail();
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }

  async stop(): Promise<void> {
    ++this.#generation;
    await this.#teardown();
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    ++this.#generation;
    await this.#teardown();
  }

  async #teardown(): Promise<void> {
    this.#controller?.abort();
    this.#controller = null;
    const frame = this.#frame;
    this.#frame = null;
    frame?.close();
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime) {
      try { await runtime.dispose(); } catch { /* Calibration teardown remains fail closed. */ }
    }
  }

  #owns(generation: number): boolean {
    return !this.#destroyed && generation === this.#generation;
  }
}
