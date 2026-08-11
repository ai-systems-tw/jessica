export type TrackingState = "idle" | "acquiring" | "tracking" | "degraded" | "lost";

export type TrackingQualityReason =
  | "landmark-count"
  | "non-finite-landmark"
  | "invalid-image-size"
  | "invalid-transform"
  | "face-out-of-frame"
  | "face-too-small"
  | "temporal-residual"
  | "transform-jump";

export type TrackingQualityMetrics = {
  completenessRatio: number;
  finiteRatio: number;
  inFrameRatio: number;
  pixelSpan: number;
  temporalResidual: number;
  rotationJumpDeg: number;
  translationJumpRatio: number;
};

export type TrackingQualityDiagnostics = {
  reasons: readonly TrackingQualityReason[];
  metrics: TrackingQualityMetrics;
};
