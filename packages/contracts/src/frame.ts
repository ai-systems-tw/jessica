import type { Millimetres } from "./units.js";

export type TenantId = string;
export type FrameModelId = string;
export type FrameVariantId = string;
export type AssetVersionId = string;

export type FrameMaterial =
  | "acetate"
  | "metal"
  | "tr90"
  | "combination"
  | "other";

export type LensType = "clear" | "tinted" | "mirror";
export type AssetQuality = "proxy" | "standard" | "premium";
export type ScaleConfidence = "low" | "medium" | "high";

export type FrameMeasurements = {
  lensWidthMm: Millimetres;
  bridgeWidthMm: Millimetres;
  templeLengthMm: Millimetres;
  frameWidthMm: Millimetres;
  lensHeightMm: Millimetres;
  frameThicknessMm?: Millimetres;
  pantoscopicTiltDeg?: number;
  faceWrapDeg?: number;
};

export type FrameModel = {
  id: FrameModelId;
  tenantId: TenantId;
  modelCode: string;
  name: string;
  measurements: FrameMeasurements;
};

export type FrameVariant = {
  id: FrameVariantId;
  tenantId: TenantId;
  frameModelId: FrameModelId;
  sku: string;
  frameColor: string;
  frameMaterial: FrameMaterial;
  lensType: LensType;
  lensColor?: string;
  visibleLightTransmissionPct?: number;
  commerceProductId?: string;
};

export type QualityEnvelope = {
  maxYawDeg: number;
  maxPitchDeg: number;
  recommendedForLive: boolean;
  scaleConfidence: ScaleConfidence;
};

export type GenerationMethod =
  | "proxy-auto"
  | "standard-auto"
  | "manual"
  | "external";

export type AssetStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "retired";

export type Matrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export const IDENTITY_MATRIX_4: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export type AssetVersion = {
  id: AssetVersionId;
  tenantId: TenantId;
  frameModelId: FrameModelId;
  version: number;
  quality: AssetQuality;
  generationMethod: GenerationMethod;
  modelUrl: string;
  manifestUrl: string;
  sourceAssetHashes: readonly string[];
  attachmentMatrix: Matrix4;
  qualityEnvelope: QualityEnvelope;
  status: AssetStatus;
};

export type RuntimeCatalogEntry = {
  schemaVersion: 1;
  tenantId: TenantId;
  model: FrameModel;
  variant: FrameVariant;
  asset: AssetVersion;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

function nonBlank(value: string, path: string, issues: ValidationIssue[]): void {
  if (value.trim().length === 0) {
    issues.push({ path, message: "must not be blank" });
  }
}

function bounded(
  value: number,
  min: number,
  max: number,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    issues.push({ path, message: `must be between ${min} and ${max}` });
  }
}

export function validateFrameModel(model: FrameModel): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  nonBlank(model.id, "id", issues);
  nonBlank(model.tenantId, "tenantId", issues);
  nonBlank(model.modelCode, "modelCode", issues);
  nonBlank(model.name, "name", issues);

  for (const [name, value] of Object.entries(model.measurements)) {
    if (name.endsWith("Mm") && (!Number.isFinite(value) || value <= 0)) {
      issues.push({ path: `measurements.${name}`, message: "must be greater than zero" });
    }
  }

  return issues;
}

export function validateFrameVariant(variant: FrameVariant): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  nonBlank(variant.id, "id", issues);
  nonBlank(variant.tenantId, "tenantId", issues);
  nonBlank(variant.frameModelId, "frameModelId", issues);
  nonBlank(variant.sku, "sku", issues);
  nonBlank(variant.frameColor, "frameColor", issues);

  if (variant.visibleLightTransmissionPct !== undefined) {
    bounded(
      variant.visibleLightTransmissionPct,
      0,
      100,
      "visibleLightTransmissionPct",
      issues,
    );
  }

  return issues;
}

export function validateAssetVersion(asset: AssetVersion): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  nonBlank(asset.id, "id", issues);
  nonBlank(asset.tenantId, "tenantId", issues);
  nonBlank(asset.frameModelId, "frameModelId", issues);
  nonBlank(asset.modelUrl, "modelUrl", issues);
  nonBlank(asset.manifestUrl, "manifestUrl", issues);

  if (!Number.isInteger(asset.version) || asset.version < 1) {
    issues.push({ path: "version", message: "must be a positive integer" });
  }

  bounded(asset.qualityEnvelope.maxYawDeg, 0, 90, "qualityEnvelope.maxYawDeg", issues);
  bounded(asset.qualityEnvelope.maxPitchDeg, 0, 90, "qualityEnvelope.maxPitchDeg", issues);

  if (asset.attachmentMatrix.length !== 16 || asset.attachmentMatrix.some((n) => !Number.isFinite(n))) {
    issues.push({ path: "attachmentMatrix", message: "must contain 16 finite numbers" });
  }

  return issues;
}

export function validateRuntimeCatalogEntry(
  entry: RuntimeCatalogEntry,
): readonly ValidationIssue[] {
  const issues = [
    ...validateFrameModel(entry.model).map((issue) => ({
      ...issue,
      path: `model.${issue.path}`,
    })),
    ...validateFrameVariant(entry.variant).map((issue) => ({
      ...issue,
      path: `variant.${issue.path}`,
    })),
    ...validateAssetVersion(entry.asset).map((issue) => ({
      ...issue,
      path: `asset.${issue.path}`,
    })),
  ];

  if (entry.schemaVersion !== 1) {
    issues.push({ path: "schemaVersion", message: "unsupported schema version" });
  }
  if (entry.tenantId !== entry.model.tenantId || entry.tenantId !== entry.variant.tenantId || entry.tenantId !== entry.asset.tenantId) {
    issues.push({ path: "tenantId", message: "tenant ownership must be consistent" });
  }
  if (entry.variant.frameModelId !== entry.model.id || entry.asset.frameModelId !== entry.model.id) {
    issues.push({ path: "frameModelId", message: "variant and asset must reference the model" });
  }

  return issues;
}
