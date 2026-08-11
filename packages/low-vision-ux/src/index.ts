export const LOW_VISION_COUNTDOWN_SECONDS = 3 as const;

export type LowVisionAudioState = "disabled" | "enabled" | "unavailable";
export type LowVisionPhase =
  | "unavailable"
  | "ready"
  | "countdown"
  | "capturing"
  | "review"
  | "failed"
  | "paused"
  | "closed"
  | "destroyed";
export type LowVisionFailureCode = "CAPTURE_FAILED" | "CAPTURE_RESULT_REJECTED";

export type LowVisionState = Readonly<{
  phase: LowVisionPhase;
  countdown: 3 | 2 | 1 | null;
  audio: LowVisionAudioState;
  reducedMotion: boolean;
  failure: LowVisionFailureCode | null;
}>;

export type LowVisionEvent =
  | { type: "availability"; available: boolean }
  | { type: "audio"; audio: LowVisionAudioState }
  | { type: "start" }
  | { type: "tick"; countdown: 2 | 1 }
  | { type: "capture" }
  | { type: "captured" }
  | { type: "fail"; failure: LowVisionFailureCode }
  | { type: "cancel" }
  | { type: "retake" }
  | { type: "hidden" }
  | { type: "close" }
  | { type: "destroy" };

export type LocalStillReview = Readonly<{
  show(target: unknown): void;
  dispose(): void;
}>;

export type LowVisionCaptureResult = Readonly<{
  captureRef: string;
  review: LocalStillReview;
}>;

export type LowVisionCapturePort = {
  capture(signal: AbortSignal): Promise<unknown>;
};

export type LowVisionAudioPort = {
  playCount(count: 3 | 2 | 1): Promise<unknown>;
};

export type LowVisionTimerPort = {
  set(delayMs: number, callback: () => void): unknown;
  clear(handle: unknown): void;
};

export type LowVisionCaptureIntegration = Readonly<{
  captureCreated(captureRef: string): void;
}>;

export type LowVisionControllerOptions = {
  timer: LowVisionTimerPort;
  capture: LowVisionCapturePort;
  audio?: LowVisionAudioPort;
  reducedMotion?: boolean;
  integration?: LowVisionCaptureIntegration;
  onState?(state: LowVisionState, review: LocalStillReview | null): void;
};

const CAPTURE_REF = /^local-capture:[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,95})$/;

function state(
  phase: LowVisionPhase,
  audio: LowVisionAudioState,
  reducedMotion: boolean,
  countdown: 3 | 2 | 1 | null = null,
  failure: LowVisionFailureCode | null = null,
): LowVisionState {
  return Object.freeze({ phase, countdown, audio, reducedMotion, failure });
}

export function initialLowVisionState(reducedMotion = false): LowVisionState {
  return state("unavailable", "disabled", reducedMotion);
}

export function reduceLowVisionState(current: LowVisionState, event: LowVisionEvent): LowVisionState {
  if (current.phase === "destroyed") return current;
  if (event.type === "destroy") return state("destroyed", current.audio, current.reducedMotion);
  if (current.phase === "closed") return current;
  if (event.type === "close") return state("closed", current.audio, current.reducedMotion);
  if (event.type === "audio") return state(current.phase, event.audio, current.reducedMotion, current.countdown, current.failure);
  if (event.type === "availability") {
    if (!event.available) return state("unavailable", current.audio, current.reducedMotion);
    if (current.phase === "unavailable" || current.phase === "paused") return state("ready", current.audio, current.reducedMotion);
    return current;
  }
  if (event.type === "hidden") return state("paused", current.audio, current.reducedMotion);
  if (event.type === "cancel") {
    if (current.phase === "countdown" || current.phase === "capturing" || current.phase === "failed") return state("ready", current.audio, current.reducedMotion);
    return current;
  }
  if (event.type === "retake") return current.phase === "review" ? state("ready", current.audio, current.reducedMotion) : current;
  if (event.type === "start") return current.phase === "ready" || current.phase === "failed" ? state("countdown", current.audio, current.reducedMotion, 3) : current;
  if (event.type === "tick" && current.phase === "countdown") {
    if ((current.countdown === 3 && event.countdown === 2) || (current.countdown === 2 && event.countdown === 1)) {
      return state("countdown", current.audio, current.reducedMotion, event.countdown);
    }
    return current;
  }
  if (event.type === "capture" && current.phase === "countdown" && current.countdown === 1) return state("capturing", current.audio, current.reducedMotion);
  if (event.type === "captured" && current.phase === "capturing") return state("review", current.audio, current.reducedMotion);
  if (event.type === "fail" && current.phase === "capturing") return state("failed", current.audio, current.reducedMotion, null, event.failure);
  return current;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} must contain enumerable data fields only`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`);
}

export function parseLowVisionCaptureResult(value: unknown): LowVisionCaptureResult {
  const result = dataRecord(value, "capture result");
  exact(result, ["captureRef", "review"], "capture result");
  if (typeof result.captureRef !== "string" || !CAPTURE_REF.test(result.captureRef)) throw new TypeError("capture reference must be local and bounded");
  const review = dataRecord(result.review, "capture review");
  exact(review, ["show", "dispose"], "capture review");
  if (typeof review.show !== "function" || typeof review.dispose !== "function") throw new TypeError("capture review must be a local capability");
  const show = review.show as LocalStillReview["show"];
  const dispose = review.dispose as LocalStillReview["dispose"];
  return Object.freeze({
    captureRef: result.captureRef,
    review: Object.freeze({
      show(target: unknown): void { Reflect.apply(show, review, [target]); },
      dispose(): void { Reflect.apply(dispose, review, []); },
    }),
  });
}

export function parseLowVisionState(value: unknown): LowVisionState {
  const item = dataRecord(value, "low-vision state");
  exact(item, ["phase", "countdown", "audio", "reducedMotion", "failure"], "low-vision state");
  const phases = new Set<LowVisionPhase>(["unavailable", "ready", "countdown", "capturing", "review", "failed", "paused", "closed", "destroyed"]);
  const audioStates = new Set<LowVisionAudioState>(["disabled", "enabled", "unavailable"]);
  if (!phases.has(item.phase as LowVisionPhase) || !audioStates.has(item.audio as LowVisionAudioState) || typeof item.reducedMotion !== "boolean") throw new TypeError("low-vision state values are invalid");
  const phase = item.phase as LowVisionPhase;
  const countdown = item.countdown;
  const failure = item.failure;
  if (phase === "countdown" ? countdown !== 3 && countdown !== 2 && countdown !== 1 : countdown !== null) throw new TypeError("low-vision countdown is invalid for phase");
  if (phase === "failed" ? failure !== "CAPTURE_FAILED" && failure !== "CAPTURE_RESULT_REJECTED" : failure !== null) throw new TypeError("low-vision failure is invalid for phase");
  return state(phase, item.audio as LowVisionAudioState, item.reducedMotion, countdown as 3 | 2 | 1 | null, failure as LowVisionFailureCode | null);
}

export function serializeLowVisionState(value: unknown): string {
  const parsed = parseLowVisionState(value);
  return JSON.stringify({ phase: parsed.phase, countdown: parsed.countdown, audio: parsed.audio, reducedMotion: parsed.reducedMotion, failure: parsed.failure });
}

export function createLowVisionCaptureIntegration(options: {
  emitWidgetCaptureCreated(captureRef: string): void;
  recordCommerceCaptureOccurrence(): void;
}): LowVisionCaptureIntegration {
  return Object.freeze({
    captureCreated(captureRef: string): void {
      if (!CAPTURE_REF.test(captureRef)) return;
      try { options.emitWidgetCaptureCreated(captureRef); } catch { /* E1 observer is non-authoritative. */ }
      try { options.recordCommerceCaptureOccurrence(); } catch { /* E3 observer is non-authoritative. */ }
    },
  });
}

export class LowVisionCaptureController {
  private current: LowVisionState;
  private generation = 0;
  private timerHandle: unknown = null;
  private abortController: AbortController | null = null;
  private review: LocalStillReview | null = null;

  constructor(private readonly options: LowVisionControllerOptions) {
    this.current = initialLowVisionState(options.reducedMotion ?? false);
    this.notify();
  }

  get view(): LowVisionState { return this.current; }

  setAvailable(available: boolean): void {
    if (!available) {
      this.invalidateWork();
      this.disposeReview();
    }
    this.transition({ type: "availability", available });
  }

  setAudioEnabled(enabled: boolean): void {
    if (this.current.phase === "closed" || this.current.phase === "destroyed") return;
    this.transition({ type: "audio", audio: enabled && this.options.audio ? "enabled" : "disabled" });
  }

  start(): void {
    const next = reduceLowVisionState(this.current, { type: "start" });
    if (next === this.current) return;
    this.disposeReview();
    this.generation += 1;
    this.current = next;
    const token = this.generation;
    this.notify();
    this.playCue(3, token);
    this.schedule(token, 2);
  }

  cancel(): void {
    this.invalidateWork();
    this.transition({ type: "cancel" });
  }

  retake(): void {
    if (this.current.phase !== "review") return;
    this.disposeReview();
    this.transition({ type: "retake" });
  }

  pageHidden(): void {
    this.invalidateWork();
    this.disposeReview();
    this.transition({ type: "hidden" });
  }

  close(): void {
    this.invalidateWork();
    this.disposeReview();
    this.transition({ type: "close" });
  }

  destroy(): void {
    if (this.current.phase === "destroyed") return;
    this.invalidateWork();
    this.disposeReview();
    this.transition({ type: "destroy" });
  }

  private schedule(token: number, nextCount: 2 | 1 | 0): void {
    let fired = false;
    let assigned = false;
    let ownHandle: unknown = null;
    const callback = (): void => {
      if (fired) return;
      fired = true;
      if (!assigned) return;
      if (assigned && this.timerHandle === ownHandle) this.timerHandle = null;
      if (token !== this.generation || this.current.phase !== "countdown") return;
      if (nextCount === 0) { this.beginCapture(token); return; }
      this.transition({ type: "tick", countdown: nextCount });
      if (this.current.phase !== "countdown" || this.current.countdown !== nextCount) return;
      this.playCue(nextCount, token);
      this.schedule(token, nextCount === 2 ? 1 : 0);
    };
    try {
      ownHandle = this.options.timer.set(1_000, callback);
      assigned = true;
      if (!fired && token === this.generation && this.current.phase === "countdown") this.timerHandle = ownHandle;
      else if (fired) {
        try { this.options.timer.clear(ownHandle); } catch { /* synchronous callback is rejected below */ }
        this.invalidateWork();
        this.transition({ type: "cancel" });
      }
    } catch {
      this.invalidateWork();
      this.transition({ type: "cancel" });
    }
  }

  private beginCapture(token: number): void {
    this.transition({ type: "capture" });
    if (this.current.phase !== "capturing") return;
    const abortController = new AbortController();
    this.abortController = abortController;
    let operation: Promise<unknown>;
    try { operation = this.options.capture.capture(abortController.signal); }
    catch { operation = Promise.reject(new Error("capture port rejected")); }
    void Promise.resolve(operation).then(
      (unknownResult) => {
        let result: LowVisionCaptureResult;
        try { result = parseLowVisionCaptureResult(unknownResult); }
        catch {
          if (token === this.generation && this.current.phase === "capturing") this.transition({ type: "fail", failure: "CAPTURE_RESULT_REJECTED" });
          return;
        }
        if (token !== this.generation || this.current.phase !== "capturing") { try { result.review.dispose(); } catch { /* stale local result is contained */ } return; }
        this.abortController = null;
        this.review = result.review;
        this.transition({ type: "captured" });
        try { this.options.integration?.captureCreated(result.captureRef); } catch { /* observer failure cannot alter capture */ }
      },
      () => {
        if (token === this.generation && this.current.phase === "capturing") {
          this.abortController = null;
          this.transition({ type: "fail", failure: "CAPTURE_FAILED" });
        }
      },
    );
  }

  private playCue(count: 3 | 2 | 1, token: number): void {
    if (this.current.audio !== "enabled" || !this.options.audio) return;
    let result: Promise<unknown>;
    try { result = this.options.audio.playCount(count); }
    catch { result = Promise.reject(new Error("audio unavailable")); }
    void Promise.resolve(result).catch(() => {
      if (token === this.generation && this.current.audio === "enabled") this.transition({ type: "audio", audio: "unavailable" });
    });
  }

  private invalidateWork(): void {
    this.generation += 1;
    if (this.timerHandle !== null) {
      try { this.options.timer.clear(this.timerHandle); } catch { /* local cancellation is best effort */ }
      this.timerHandle = null;
    }
    try { this.abortController?.abort(); } catch { /* generation remains authoritative */ }
    this.abortController = null;
  }

  private disposeReview(): void {
    const current = this.review;
    this.review = null;
    if (current) try { current.dispose(); } catch { /* disposal is terminal for this capability */ }
  }

  private transition(event: LowVisionEvent): void {
    const next = reduceLowVisionState(this.current, event);
    if (next === this.current) return;
    this.current = next;
    this.notify();
  }

  private notify(): void {
    try { this.options.onState?.(this.current, this.review); } catch { /* rendering observers cannot alter lifecycle */ }
  }
}
