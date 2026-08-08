export type TrackingState = "idle" | "acquiring" | "tracking" | "degraded" | "lost";

export type ConfidenceGateConfig = {
  enterThreshold: number;
  exitThreshold: number;
  lostThreshold: number;
  acquireHoldMs: number;
  degradeHoldMs: number;
  lostHoldMs: number;
  recoverHoldMs: number;
};

export const DEFAULT_CONFIDENCE_GATE: ConfidenceGateConfig = {
  enterThreshold: 0.78,
  exitThreshold: 0.58,
  lostThreshold: 0.25,
  acquireHoldMs: 120,
  degradeHoldMs: 100,
  lostHoldMs: 350,
  recoverHoldMs: 140,
};

export type ConfidenceGateView = {
  state: TrackingState;
  opacity: number;
  shouldRender: boolean;
  shouldPromptUser: boolean;
};

function assertConfig(config: ConfidenceGateConfig): void {
  const values = Object.values(config);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("confidence gate values must be finite");
  }
  if (!(config.lostThreshold <= config.exitThreshold && config.exitThreshold < config.enterThreshold)) {
    throw new RangeError("thresholds must satisfy lost <= exit < enter");
  }
  if (config.lostThreshold < 0 || config.enterThreshold > 1) {
    throw new RangeError("confidence thresholds must be between 0 and 1");
  }
  if ([config.acquireHoldMs, config.degradeHoldMs, config.lostHoldMs, config.recoverHoldMs].some((value) => value < 0)) {
    throw new RangeError("hold durations must be non-negative");
  }
}

export class ConfidenceGate {
  readonly #config: ConfidenceGateConfig;
  #state: TrackingState = "idle";
  #previousTimestampMs: number | null = null;
  #goodSinceMs: number | null = null;
  #lowSinceMs: number | null = null;
  #lostSinceMs: number | null = null;

  constructor(config: ConfidenceGateConfig = DEFAULT_CONFIDENCE_GATE) {
    assertConfig(config);
    this.#config = { ...config };
  }

  start(): ConfidenceGateView {
    this.#state = "acquiring";
    this.#goodSinceMs = null;
    this.#lowSinceMs = null;
    this.#lostSinceMs = null;
    return this.view();
  }

  reset(): ConfidenceGateView {
    this.#state = "idle";
    this.#previousTimestampMs = null;
    this.#goodSinceMs = null;
    this.#lowSinceMs = null;
    this.#lostSinceMs = null;
    return this.view();
  }

  update(confidence: number, timestampMs: number): ConfidenceGateView {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError("confidence must be between 0 and 1");
    }
    if (!Number.isFinite(timestampMs)) {
      throw new TypeError("timestampMs must be finite");
    }
    if (this.#previousTimestampMs !== null && timestampMs < this.#previousTimestampMs) {
      throw new RangeError("timestampMs must not move backwards");
    }
    this.#previousTimestampMs = timestampMs;

    if (this.#state === "idle") {
      this.start();
    }

    switch (this.#state) {
      case "acquiring":
        this.#updateAcquiring(confidence, timestampMs);
        break;
      case "tracking":
        this.#updateTracking(confidence, timestampMs);
        break;
      case "degraded":
        this.#updateDegraded(confidence, timestampMs);
        break;
      case "lost":
        this.#updateLost(confidence, timestampMs);
        break;
      case "idle":
        break;
    }

    return this.view();
  }

  view(): ConfidenceGateView {
    switch (this.#state) {
      case "idle":
        return { state: "idle", opacity: 0, shouldRender: false, shouldPromptUser: false };
      case "acquiring":
        return { state: "acquiring", opacity: 0, shouldRender: false, shouldPromptUser: false };
      case "tracking":
        return { state: "tracking", opacity: 1, shouldRender: true, shouldPromptUser: false };
      case "degraded":
        return { state: "degraded", opacity: 0.45, shouldRender: true, shouldPromptUser: true };
      case "lost":
        return { state: "lost", opacity: 0, shouldRender: false, shouldPromptUser: true };
    }
  }

  #updateAcquiring(confidence: number, timestampMs: number): void {
    if (confidence >= this.#config.enterThreshold) {
      this.#goodSinceMs ??= timestampMs;
      if (timestampMs - this.#goodSinceMs >= this.#config.acquireHoldMs) {
        this.#state = "tracking";
        this.#goodSinceMs = null;
      }
    } else {
      this.#goodSinceMs = null;
    }
  }

  #updateTracking(confidence: number, timestampMs: number): void {
    if (confidence < this.#config.exitThreshold) {
      this.#lowSinceMs ??= timestampMs;
      if (timestampMs - this.#lowSinceMs >= this.#config.degradeHoldMs) {
        this.#state = "degraded";
        this.#lowSinceMs = null;
        this.#lostSinceMs = confidence < this.#config.lostThreshold ? timestampMs : null;
      }
    } else {
      this.#lowSinceMs = null;
    }
  }

  #updateDegraded(confidence: number, timestampMs: number): void {
    if (confidence >= this.#config.enterThreshold) {
      this.#goodSinceMs ??= timestampMs;
      this.#lostSinceMs = null;
      if (timestampMs - this.#goodSinceMs >= this.#config.recoverHoldMs) {
        this.#state = "tracking";
        this.#goodSinceMs = null;
      }
      return;
    }

    this.#goodSinceMs = null;
    if (confidence < this.#config.lostThreshold) {
      this.#lostSinceMs ??= timestampMs;
      if (timestampMs - this.#lostSinceMs >= this.#config.lostHoldMs) {
        this.#state = "lost";
        this.#lostSinceMs = null;
      }
    } else {
      this.#lostSinceMs = null;
    }
  }

  #updateLost(confidence: number, timestampMs: number): void {
    if (confidence >= this.#config.enterThreshold) {
      this.#goodSinceMs ??= timestampMs;
      if (timestampMs - this.#goodSinceMs >= this.#config.recoverHoldMs) {
        this.#state = "acquiring";
        this.#goodSinceMs = timestampMs;
      }
    } else {
      this.#goodSinceMs = null;
    }
  }
}
