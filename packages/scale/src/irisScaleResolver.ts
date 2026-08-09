import type { ScaleEstimate, ScaleObservation, ScaleResolver } from "../../runtime/src/index.js";

export type IrisScaleResolverConfig = {
  assumedIrisDiameterMm?: number;
  windowSize?: number;
  maximumBilateralDifferenceRatio?: number;
  maximumOutlierRatio?: number;
  minimumDiameterPx?: number;
  highConfidenceDiameterPx?: number;
  highConfidenceSampleCount?: number;
};

type ScaleSample = {
  millimetresPerPixel: number;
  diameterPx: number;
  bilateral: boolean;
};

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) throw new Error("cannot compute median of an empty array");
  if (ordered.length % 2 === 1) return upper;
  return ((ordered[middle - 1] ?? upper) + upper) / 2;
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

export class IrisScaleResolver implements ScaleResolver {
  readonly #config: Required<IrisScaleResolverConfig>;
  readonly #samples: ScaleSample[] = [];
  #lastTimestampSeconds: number | null = null;
  #manualOverride: number | null = null;

  constructor(config: IrisScaleResolverConfig = {}) {
    this.#config = {
      assumedIrisDiameterMm: config.assumedIrisDiameterMm ?? 11.7,
      windowSize: config.windowSize ?? 9,
      maximumBilateralDifferenceRatio: config.maximumBilateralDifferenceRatio ?? 0.2,
      maximumOutlierRatio: config.maximumOutlierRatio ?? 0.25,
      minimumDiameterPx: config.minimumDiameterPx ?? 6,
      highConfidenceDiameterPx: config.highConfidenceDiameterPx ?? 14,
      highConfidenceSampleCount: config.highConfidenceSampleCount ?? 5,
    };
    positive(this.#config.assumedIrisDiameterMm, "assumedIrisDiameterMm");
    if (!Number.isInteger(this.#config.windowSize) || this.#config.windowSize < 3) {
      throw new RangeError("windowSize must be an integer of at least 3");
    }
    if (!Number.isInteger(this.#config.highConfidenceSampleCount) || this.#config.highConfidenceSampleCount < 1) {
      throw new RangeError("highConfidenceSampleCount must be a positive integer");
    }
    for (const [label, value] of [
      ["maximumBilateralDifferenceRatio", this.#config.maximumBilateralDifferenceRatio],
      ["maximumOutlierRatio", this.#config.maximumOutlierRatio],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0 || value >= 1) {
        throw new RangeError(`${label} must be between 0 and 1`);
      }
    }
    positive(this.#config.minimumDiameterPx, "minimumDiameterPx");
    positive(this.#config.highConfidenceDiameterPx, "highConfidenceDiameterPx");
  }

  update(observation: ScaleObservation): ScaleEstimate {
    if (!Number.isFinite(observation.timestampSeconds)) {
      throw new TypeError("timestampSeconds must be finite");
    }
    if (this.#lastTimestampSeconds !== null && observation.timestampSeconds <= this.#lastTimestampSeconds) {
      throw new RangeError("timestampSeconds must be strictly increasing");
    }
    this.#lastTimestampSeconds = observation.timestampSeconds;
    if (this.#manualOverride !== null) return this.#estimate("manual-override");

    const diameters = [observation.leftIrisDiameterPx, observation.rightIrisDiameterPx]
      .filter((value): value is number => value !== undefined);
    if (diameters.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new RangeError("iris diameters must be positive finite numbers");
    }
    if (diameters.length === 0) return this.#estimate("iris-unavailable");

    const bilateral = diameters.length === 2;
    if (bilateral) {
      const differenceRatio = Math.abs(diameters[0]! - diameters[1]!) / median(diameters);
      if (differenceRatio > this.#config.maximumBilateralDifferenceRatio) {
        return this.#estimate("bilateral-mismatch", "low");
      }
    }

    const diameterPx = median(diameters);
    if (diameterPx < this.#config.minimumDiameterPx) {
      return this.#estimate("iris-too-small", "low");
    }
    const millimetresPerPixel = this.#config.assumedIrisDiameterMm / diameterPx;
    if (this.#samples.length >= 3) {
      const currentMedian = median(this.#samples.map((sample) => sample.millimetresPerPixel));
      const outlierRatio = Math.abs(millimetresPerPixel - currentMedian) / currentMedian;
      if (outlierRatio > this.#config.maximumOutlierRatio) {
        return this.#estimate("outlier-rejected");
      }
    }

    this.#samples.push({ millimetresPerPixel, diameterPx, bilateral });
    if (this.#samples.length > this.#config.windowSize) this.#samples.shift();
    return this.#estimate();
  }

  setManualOverride(millimetresPerPixel: number | null): void {
    if (millimetresPerPixel !== null) positive(millimetresPerPixel, "millimetresPerPixel");
    this.#manualOverride = millimetresPerPixel;
  }

  reset(): void {
    this.#samples.length = 0;
    this.#lastTimestampSeconds = null;
    this.#manualOverride = null;
  }

  #estimate(reason?: string, maximumConfidence?: ScaleEstimate["confidence"]): ScaleEstimate {
    if (this.#manualOverride !== null) {
      return {
        millimetresPerPixel: this.#manualOverride,
        confidence: "high",
        sampleCount: this.#samples.length,
        reason: reason ?? "manual-override",
      };
    }
    if (this.#samples.length === 0) {
      return { millimetresPerPixel: null, confidence: "low", sampleCount: 0, ...(reason ? { reason } : {}) };
    }
    const value = median(this.#samples.map((sample) => sample.millimetresPerPixel));
    const recent = this.#samples[this.#samples.length - 1]!;
    let confidence: ScaleEstimate["confidence"] = "low";
    if (this.#samples.length >= 3) confidence = "medium";
    if (
      this.#samples.length >= this.#config.highConfidenceSampleCount
      && recent.bilateral
      && recent.diameterPx >= this.#config.highConfidenceDiameterPx
    ) {
      confidence = "high";
    }
    if (maximumConfidence === "low") confidence = "low";
    if (maximumConfidence === "medium" && confidence === "high") confidence = "medium";
    return {
      millimetresPerPixel: value,
      confidence,
      sampleCount: this.#samples.length,
      ...(reason ? { reason } : {}),
    };
  }
}
