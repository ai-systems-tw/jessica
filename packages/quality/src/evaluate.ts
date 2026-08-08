import { mean, median, percentile } from "./statistics.js";

export type QualitySample = {
  fixtureId: string;
  bridgeErrorMm: number;
  frameWidthErrorPct: number;
  jitterRmsMm: number;
  trackingSucceeded: boolean;
  renderFps?: number;
};

export type QualityThresholds = {
  medianBridgeErrorMm: number;
  absoluteFrameWidthErrorPct: number;
  medianJitterRmsMm: number;
  trackingSuccessRatePct: number;
  minimumRenderFps: number;
};

export const INITIAL_QUALITY_THRESHOLDS: QualityThresholds = {
  medianBridgeErrorMm: 3,
  absoluteFrameWidthErrorPct: 5,
  medianJitterRmsMm: 0.75,
  trackingSuccessRatePct: 90,
  minimumRenderFps: 24,
};

export type QualitySummary = {
  sampleCount: number;
  medianBridgeErrorMm: number;
  p95BridgeErrorMm: number;
  medianAbsoluteFrameWidthErrorPct: number;
  medianJitterRmsMm: number;
  trackingSuccessRatePct: number;
  minimumRenderFps: number | null;
  averageRenderFps: number | null;
};

export type QualityViolation = {
  metric: keyof QualityThresholds;
  actual: number;
  expected: string;
};

export type QualityEvaluation = {
  pass: boolean;
  summary: QualitySummary;
  violations: readonly QualityViolation[];
};

function assertSample(sample: QualitySample): void {
  const values = [sample.bridgeErrorMm, sample.frameWidthErrorPct, sample.jitterRmsMm];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`fixture ${sample.fixtureId} contains a non-finite metric`);
  }
  if (sample.renderFps !== undefined && (!Number.isFinite(sample.renderFps) || sample.renderFps < 0)) {
    throw new TypeError(`fixture ${sample.fixtureId} contains an invalid renderFps`);
  }
}

export function summarizeQuality(samples: readonly QualitySample[]): QualitySummary {
  if (samples.length === 0) {
    throw new RangeError("quality summary requires at least one sample");
  }
  samples.forEach(assertSample);

  const bridgeErrors = samples.map((sample) => Math.abs(sample.bridgeErrorMm));
  const widthErrors = samples.map((sample) => Math.abs(sample.frameWidthErrorPct));
  const jitters = samples.map((sample) => Math.abs(sample.jitterRmsMm));
  const successful = samples.filter((sample) => sample.trackingSucceeded).length;
  const fpsValues = samples
    .map((sample) => sample.renderFps)
    .filter((value): value is number => value !== undefined);

  return {
    sampleCount: samples.length,
    medianBridgeErrorMm: median(bridgeErrors),
    p95BridgeErrorMm: percentile(bridgeErrors, 95),
    medianAbsoluteFrameWidthErrorPct: median(widthErrors),
    medianJitterRmsMm: median(jitters),
    trackingSuccessRatePct: (successful / samples.length) * 100,
    minimumRenderFps: fpsValues.length > 0 ? Math.min(...fpsValues) : null,
    averageRenderFps: fpsValues.length > 0 ? mean(fpsValues) : null,
  };
}

export function evaluateQuality(
  samples: readonly QualitySample[],
  thresholds: QualityThresholds = INITIAL_QUALITY_THRESHOLDS,
): QualityEvaluation {
  const summary = summarizeQuality(samples);
  const violations: QualityViolation[] = [];

  if (summary.medianBridgeErrorMm > thresholds.medianBridgeErrorMm) {
    violations.push({
      metric: "medianBridgeErrorMm",
      actual: summary.medianBridgeErrorMm,
      expected: `<= ${thresholds.medianBridgeErrorMm}`,
    });
  }
  if (summary.medianAbsoluteFrameWidthErrorPct > thresholds.absoluteFrameWidthErrorPct) {
    violations.push({
      metric: "absoluteFrameWidthErrorPct",
      actual: summary.medianAbsoluteFrameWidthErrorPct,
      expected: `<= ${thresholds.absoluteFrameWidthErrorPct}`,
    });
  }
  if (summary.medianJitterRmsMm > thresholds.medianJitterRmsMm) {
    violations.push({
      metric: "medianJitterRmsMm",
      actual: summary.medianJitterRmsMm,
      expected: `<= ${thresholds.medianJitterRmsMm}`,
    });
  }
  if (summary.trackingSuccessRatePct < thresholds.trackingSuccessRatePct) {
    violations.push({
      metric: "trackingSuccessRatePct",
      actual: summary.trackingSuccessRatePct,
      expected: `>= ${thresholds.trackingSuccessRatePct}`,
    });
  }
  if (summary.minimumRenderFps !== null && summary.minimumRenderFps < thresholds.minimumRenderFps) {
    violations.push({
      metric: "minimumRenderFps",
      actual: summary.minimumRenderFps,
      expected: `>= ${thresholds.minimumRenderFps}`,
    });
  }

  return { pass: violations.length === 0, summary, violations };
}
