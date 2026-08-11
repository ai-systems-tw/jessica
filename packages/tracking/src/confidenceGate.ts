import type { TrackingState } from "../../contracts/src/index.js";
export type { TrackingState } from "../../contracts/src/index.js";

export type ConfidenceGateConfig = {
  enterThreshold: number;
  exitThreshold: number;
  acquireHoldMs: number;
  degradeHoldMs: number;
  recoverHoldMs: number;
  falseAttachmentLimitMs: number;
};

export const DEFAULT_CONFIDENCE_GATE: ConfidenceGateConfig = {
  enterThreshold: 0.78,
  exitThreshold: 0.58,
  acquireHoldMs: 120,
  degradeHoldMs: 100,
  recoverHoldMs: 140,
  falseAttachmentLimitMs: 250,
};

export type ConfidenceGateView = {
  state: TrackingState;
  opacity: number;
  shouldRender: boolean;
  shouldPromptUser: boolean;
  belowExitSinceMs: number | null;
  falseAttachmentLimitMs: number;
};

function assertConfig(config: ConfidenceGateConfig): void {
  if (Object.values(config).some((value) => !Number.isFinite(value))) throw new TypeError("confidence gate values must be finite");
  if (!(config.exitThreshold < config.enterThreshold)) {
    throw new RangeError("thresholds must satisfy exit < enter");
  }
  if (config.exitThreshold < 0 || config.enterThreshold > 1) throw new RangeError("confidence thresholds must be between 0 and 1");
  if ([config.acquireHoldMs, config.degradeHoldMs, config.recoverHoldMs, config.falseAttachmentLimitMs].some((value) => value < 0)) {
    throw new RangeError("hold durations must be non-negative");
  }
  if (config.falseAttachmentLimitMs > 250) throw new RangeError("falseAttachmentLimitMs must not exceed 250");
}

export class ConfidenceGate {
  readonly #config: ConfidenceGateConfig;
  #state: TrackingState = "idle";
  #previousTimestampMs: number | null = null;
  #goodSinceMs: number | null = null;
  #belowExitSinceMs: number | null = null;

  constructor(config: ConfidenceGateConfig = DEFAULT_CONFIDENCE_GATE) {
    assertConfig(config);
    this.#config = { ...config };
  }

  start(): ConfidenceGateView {
    this.#state = "acquiring";
    this.#goodSinceMs = null;
    this.#belowExitSinceMs = null;
    return this.view();
  }

  reset(): ConfidenceGateView {
    this.#state = "idle";
    this.#previousTimestampMs = null;
    this.#goodSinceMs = null;
    this.#belowExitSinceMs = null;
    return this.view();
  }

  forceLost(): ConfidenceGateView {
    this.#state = "lost";
    this.#goodSinceMs = null;
    return this.view();
  }

  update(confidence: number, timestampMs: number): ConfidenceGateView {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError("confidence must be between 0 and 1");
    if (!Number.isFinite(timestampMs)) throw new TypeError("timestampMs must be finite");
    if (this.#previousTimestampMs !== null && timestampMs < this.#previousTimestampMs) throw new RangeError("timestampMs must not move backwards");
    this.#previousTimestampMs = timestampMs;
    if (this.#state === "idle") this.start();

    if (this.#state === "acquiring") {
      if (confidence >= this.#config.enterThreshold) {
        this.#goodSinceMs ??= timestampMs;
        if (timestampMs - this.#goodSinceMs >= this.#config.acquireHoldMs) {
          this.#state = "tracking";
          this.#goodSinceMs = null;
        }
      } else this.#goodSinceMs = null;
      return this.view();
    }

    if (this.#state === "tracking") {
      if (confidence < this.#config.exitThreshold) {
        this.#belowExitSinceMs ??= timestampMs;
        const elapsed = timestampMs - this.#belowExitSinceMs;
        if (elapsed >= this.#config.falseAttachmentLimitMs) this.#state = "lost";
        else if (elapsed >= this.#config.degradeHoldMs) this.#state = "degraded";
      } else {
        this.#belowExitSinceMs = null;
      }
      return this.view();
    }

    if (this.#state === "degraded") {
      if (confidence >= this.#config.exitThreshold) this.#belowExitSinceMs = null;
      if (confidence >= this.#config.enterThreshold) {
        this.#goodSinceMs ??= timestampMs;
        if (timestampMs - this.#goodSinceMs >= this.#config.recoverHoldMs) {
          this.#state = "tracking";
          this.#goodSinceMs = null;
          this.#belowExitSinceMs = null;
          return this.view();
        }
      } else this.#goodSinceMs = null;
      if (this.#belowExitSinceMs !== null && timestampMs - this.#belowExitSinceMs >= this.#config.falseAttachmentLimitMs) {
        this.#state = "lost";
        this.#goodSinceMs = null;
      }
      return this.view();
    }

    if (confidence >= this.#config.enterThreshold) {
      this.#goodSinceMs ??= timestampMs;
      if (timestampMs - this.#goodSinceMs >= this.#config.recoverHoldMs) {
        this.#state = "tracking";
        this.#goodSinceMs = null;
        this.#belowExitSinceMs = null;
      }
    } else this.#goodSinceMs = null;
    return this.view();
  }

  view(): ConfidenceGateView {
    const common = { belowExitSinceMs: this.#belowExitSinceMs, falseAttachmentLimitMs: this.#config.falseAttachmentLimitMs };
    switch (this.#state) {
      case "idle": return { state: "idle", opacity: 0, shouldRender: false, shouldPromptUser: false, ...common };
      case "acquiring": return { state: "acquiring", opacity: 0, shouldRender: false, shouldPromptUser: false, ...common };
      case "tracking": return { state: "tracking", opacity: 1, shouldRender: true, shouldPromptUser: false, ...common };
      case "degraded": return { state: "degraded", opacity: 0.45, shouldRender: true, shouldPromptUser: true, ...common };
      case "lost": return { state: "lost", opacity: 0, shouldRender: false, shouldPromptUser: true, ...common };
    }
  }
}
