import type { Matrix4, TrackingQualityMetrics, TrackingQualityReason } from "../../contracts/src/index.js";

type ImageSize = { width: number; height: number };
type NormalizedLandmark = { x: number; y: number; z: number; visibility?: number };

export type { TrackingQualityMetrics, TrackingQualityReason } from "../../contracts/src/index.js";

export type TrackingQualityHistory = {
  timestampSeconds: number;
  normalizedShape: readonly number[];
  rotationColumns: readonly number[];
  translation: readonly [number, number, number];
};

export type TrackingQualityEstimate = {
  confidence: number;
  structurallyValid: boolean;
  reasons: readonly TrackingQualityReason[];
  metrics: TrackingQualityMetrics;
  history: TrackingQualityHistory | null;
};

export type TrackingQualityObservation = {
  timestampSeconds: number;
  imageSize: ImageSize;
  landmarks: readonly NormalizedLandmark[];
  facialTransform: Matrix4;
};

export type TrackingQualityConfig = {
  expectedLandmarks: number;
  minimumInFrameRatio: number;
  fullInFrameRatio: number;
  minimumPixelSpan: number;
  fullPixelSpan: number;
  fullTemporalResidual: number;
  maximumTemporalResidual: number;
  fullRotationJumpDeg: number;
  maximumRotationJumpDeg: number;
  fullTranslationJumpRatio: number;
  maximumTranslationJumpRatio: number;
  maximumComparisonGapSeconds: number;
};

export const DEFAULT_TRACKING_QUALITY: TrackingQualityConfig = {
  expectedLandmarks: 478,
  minimumInFrameRatio: 0.8,
  fullInFrameRatio: 0.98,
  minimumPixelSpan: 60,
  fullPixelSpan: 180,
  fullTemporalResidual: 0.015,
  maximumTemporalResidual: 0.12,
  fullRotationJumpDeg: 8,
  maximumRotationJumpDeg: 35,
  fullTranslationJumpRatio: 0.08,
  maximumTranslationJumpRatio: 0.35,
  maximumComparisonGapSeconds: 0.25,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const ramp = (value: number, zero: number, one: number): number => clamp01((value - zero) / (one - zero));
const inverseRamp = (value: number, one: number, zero: number): number => 1 - ramp(value, one, zero);

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
}

function normalizedColumn(matrix: Matrix4, offset: number): readonly [number, number, number] | null {
  const x = matrix[offset]!;
  const y = matrix[offset + 1]!;
  const z = matrix[offset + 2]!;
  const length = Math.hypot(x, y, z);
  return Number.isFinite(length) && length > 1e-8 ? [x / length, y / length, z / length] : null;
}

function rotationColumns(matrix: Matrix4): readonly number[] | null {
  const x = normalizedColumn(matrix, 0);
  const yRaw = normalizedColumn(matrix, 4);
  const zRaw = normalizedColumn(matrix, 8);
  if (!x || !yRaw || !zRaw) return null;
  const projection = x[0] * yRaw[0] + x[1] * yRaw[1] + x[2] * yRaw[2];
  const yCandidate: [number, number, number] = [
    yRaw[0] - projection * x[0],
    yRaw[1] - projection * x[1],
    yRaw[2] - projection * x[2],
  ];
  const yLength = Math.hypot(...yCandidate);
  if (!Number.isFinite(yLength) || yLength <= 1e-8) return null;
  const y = yCandidate.map((value) => value / yLength) as [number, number, number];
  const z: [number, number, number] = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  if (z[0] * zRaw[0] + z[1] * zRaw[1] + z[2] * zRaw[2] < 0.8) return null;
  return [...x, ...y, ...z];
}

function rotationDeltaDeg(left: readonly number[], right: readonly number[]): number {
  let trace = 0;
  for (let column = 0; column < 3; column += 1) {
    const offset = column * 3;
    trace += left[offset]! * right[offset]! + left[offset + 1]! * right[offset + 1]! + left[offset + 2]! * right[offset + 2]!;
  }
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180 / Math.PI;
}

export function estimateTrackingQuality(
  observation: TrackingQualityObservation,
  previous: TrackingQualityHistory | null = null,
  config: TrackingQualityConfig = DEFAULT_TRACKING_QUALITY,
): TrackingQualityEstimate {
  const { landmarks, imageSize, facialTransform, timestampSeconds } = observation;
  const completenessRatio = Math.min(landmarks.length, config.expectedLandmarks) /
    Math.max(landmarks.length, config.expectedLandmarks);
  const finite = landmarks.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  const finiteRatio = finite.length / Math.max(landmarks.length, config.expectedLandmarks);
  const validImage = Number.isFinite(imageSize.width) && imageSize.width > 0 && Number.isFinite(imageSize.height) && imageSize.height > 0;
  const rotation = facialTransform.length === 16 && facialTransform.every(Number.isFinite)
    ? rotationColumns(facialTransform)
    : null;
  const translation = facialTransform.length === 16
    ? [facialTransform[12]!, facialTransform[13]!, facialTransform[14]!] as const
    : [NaN, NaN, NaN] as const;
  const validTransform = rotation !== null && translation.every(Number.isFinite);
  const structurallyValid = Number.isFinite(timestampSeconds) && validImage && validTransform &&
    landmarks.length === config.expectedLandmarks && finite.length === config.expectedLandmarks;

  const xs = finite.map((point) => point.x * (validImage ? imageSize.width : 0));
  const ys = finite.map((point) => point.y * (validImage ? imageSize.height : 0));
  const inFrameRatio = finite.length === 0 ? 0 : finite.filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).length / finite.length;
  const widthSpan = percentile(xs, 0.95) - percentile(xs, 0.05);
  const heightSpan = percentile(ys, 0.95) - percentile(ys, 0.05);
  const pixelSpan = Math.max(0, widthSpan, heightSpan);
  const centerX = (percentile(xs, 0.95) + percentile(xs, 0.05)) / 2;
  const centerY = (percentile(ys, 0.95) + percentile(ys, 0.05)) / 2;
  const shape = structurallyValid && pixelSpan > 0
    ? landmarks.flatMap((point) => [
      (point.x * imageSize.width - centerX) / pixelSpan,
      (point.y * imageSize.height - centerY) / pixelSpan,
      point.z * imageSize.width / pixelSpan,
    ])
    : [];
  const comparable = structurallyValid && previous !== null && timestampSeconds > previous.timestampSeconds &&
    timestampSeconds - previous.timestampSeconds <= config.maximumComparisonGapSeconds && previous.normalizedShape.length === shape.length;
  let temporalResidual = 0;
  let rotationJumpDeg = 0;
  let translationJumpRatio = 0;
  if (comparable) {
    let squared = 0;
    for (let index = 0; index < shape.length; index += 1) squared += (shape[index]! - previous.normalizedShape[index]!) ** 2;
    temporalResidual = Math.sqrt(squared / shape.length);
    rotationJumpDeg = rotationDeltaDeg(rotation!, previous.rotationColumns);
    const translationDelta = Math.hypot(
      translation[0] - previous.translation[0],
      translation[1] - previous.translation[1],
      translation[2] - previous.translation[2],
    );
    translationJumpRatio = translationDelta / Math.max(Math.abs(previous.translation[2]), 1e-6);
  }
  const scores = [
    completenessRatio,
    finiteRatio,
    ramp(inFrameRatio, config.minimumInFrameRatio, config.fullInFrameRatio),
    ramp(pixelSpan, config.minimumPixelSpan, config.fullPixelSpan),
    comparable ? inverseRamp(temporalResidual, config.fullTemporalResidual, config.maximumTemporalResidual) : 1,
    comparable ? inverseRamp(rotationJumpDeg, config.fullRotationJumpDeg, config.maximumRotationJumpDeg) : 1,
    comparable ? inverseRamp(translationJumpRatio, config.fullTranslationJumpRatio, config.maximumTranslationJumpRatio) : 1,
  ];
  const confidence = structurallyValid ? clamp01(Math.min(...scores)) : 0;
  const reasons: TrackingQualityReason[] = [];
  if (landmarks.length !== config.expectedLandmarks) reasons.push("landmark-count");
  if (finite.length !== landmarks.length) reasons.push("non-finite-landmark");
  if (!validImage) reasons.push("invalid-image-size");
  if (!validTransform) reasons.push("invalid-transform");
  if (scores[2]! < 1) reasons.push("face-out-of-frame");
  if (scores[3]! < 1) reasons.push("face-too-small");
  if (scores[4]! < 1) reasons.push("temporal-residual");
  if (scores[5]! < 1 || scores[6]! < 1) reasons.push("transform-jump");
  return {
    confidence,
    structurallyValid,
    reasons,
    metrics: { completenessRatio, finiteRatio, inFrameRatio, pixelSpan, temporalResidual, rotationJumpDeg, translationJumpRatio },
    history: structurallyValid ? { timestampSeconds, normalizedShape: shape, rotationColumns: rotation!, translation } : null,
  };
}
