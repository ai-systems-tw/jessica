import type { QualitySample } from "./evaluate.js";

export type PixelPoint = { x: number; y: number };

export type PlacementPoints = {
  bridgeCenter: PixelPoint;
  frameLeft: PixelPoint;
  frameRight: PixelPoint;
  leftLensCenter: PixelPoint;
  rightLensCenter: PixelPoint;
};

export type PlacementAnnotation = {
  schemaVersion: 1;
  fixtureId: string;
  subjectId: string;
  frameModelId: string;
  sourceImageSha256: string;
  consentReference: string;
  actualFrameWidthMm: number;
  actual: PlacementPoints;
  rendered: PlacementPoints;
  jitterRmsMm: number;
  trackingSucceeded: boolean;
  renderFps?: number;
};

export type PlacementMetrics = {
  millimetresPerPixel: number;
  bridgeErrorMm: number;
  frameWidthErrorPct: number;
  leftLensCenterErrorMm: number;
  rightLensCenterErrorMm: number;
  rollErrorDeg: number;
};

export type PlacementReport = {
  fixtureId: string;
  frameModelId: string;
  metrics: PlacementMetrics;
  qualitySample: QualitySample;
};

function distance(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(left: PixelPoint, right: PixelPoint): number {
  return (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
}

function validatePoint(point: PixelPoint, path: string): void {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${path} must contain finite x and y coordinates`);
  }
}

function validateAnnotation(annotation: PlacementAnnotation): void {
  if (annotation.schemaVersion !== 1) throw new Error("placement schemaVersion must equal 1");
  for (const [label, value] of [
    ["fixtureId", annotation.fixtureId],
    ["subjectId", annotation.subjectId],
    ["frameModelId", annotation.frameModelId],
    ["consentReference", annotation.consentReference],
  ] as const) {
    if (!value?.trim()) throw new Error(`${label} must not be blank`);
  }
  if (!/^[a-f0-9]{64}$/i.test(annotation.sourceImageSha256)) {
    throw new Error("sourceImageSha256 must be a 64-character SHA-256 hex digest");
  }
  if (!Number.isFinite(annotation.actualFrameWidthMm) || annotation.actualFrameWidthMm <= 0) {
    throw new RangeError("actualFrameWidthMm must be positive and finite");
  }
  if (!Number.isFinite(annotation.jitterRmsMm) || annotation.jitterRmsMm < 0) {
    throw new RangeError("jitterRmsMm must be non-negative and finite");
  }
  if (annotation.renderFps !== undefined && (!Number.isFinite(annotation.renderFps) || annotation.renderFps < 0)) {
    throw new RangeError("renderFps must be non-negative and finite");
  }
  for (const side of ["actual", "rendered"] as const) {
    for (const key of ["bridgeCenter", "frameLeft", "frameRight", "leftLensCenter", "rightLensCenter"] as const) {
      validatePoint(annotation[side][key], `${side}.${key}`);
    }
  }
}

export function derivePlacementReport(annotation: PlacementAnnotation): PlacementReport {
  validateAnnotation(annotation);
  const actualWidthPx = distance(annotation.actual.frameLeft, annotation.actual.frameRight);
  const renderedWidthPx = distance(annotation.rendered.frameLeft, annotation.rendered.frameRight);
  if (actualWidthPx <= 0) throw new RangeError("actual frame annotation width must be greater than zero pixels");
  const millimetresPerPixel = annotation.actualFrameWidthMm / actualWidthPx;
  const metrics: PlacementMetrics = {
    millimetresPerPixel,
    bridgeErrorMm: distance(annotation.actual.bridgeCenter, annotation.rendered.bridgeCenter) * millimetresPerPixel,
    frameWidthErrorPct: ((renderedWidthPx - actualWidthPx) / actualWidthPx) * 100,
    leftLensCenterErrorMm: distance(annotation.actual.leftLensCenter, annotation.rendered.leftLensCenter) * millimetresPerPixel,
    rightLensCenterErrorMm: distance(annotation.actual.rightLensCenter, annotation.rendered.rightLensCenter) * millimetresPerPixel,
    rollErrorDeg: angleDeg(annotation.rendered.frameLeft, annotation.rendered.frameRight)
      - angleDeg(annotation.actual.frameLeft, annotation.actual.frameRight),
  };
  const qualitySample: QualitySample = {
    fixtureId: annotation.fixtureId,
    bridgeErrorMm: metrics.bridgeErrorMm,
    frameWidthErrorPct: metrics.frameWidthErrorPct,
    jitterRmsMm: annotation.jitterRmsMm,
    trackingSucceeded: annotation.trackingSucceeded,
    ...(annotation.renderFps !== undefined ? { renderFps: annotation.renderFps } : {}),
  };
  return { fixtureId: annotation.fixtureId, frameModelId: annotation.frameModelId, metrics, qualitySample };
}
