import type { FrameMeasurements, ValidationIssue } from "./frame.js";

export const SOURCE_ASSET_KINDS = [
  "front",
  "left45",
  "right45",
  "leftSide",
  "rightSide",
  "top",
  "marking",
  "annotatedOverview",
  "other",
] as const;

export type SourceAssetKind = (typeof SOURCE_ASSET_KINDS)[number];

export type SourceAsset = {
  id: string;
  tenantId: string;
  frameModelId?: string;
  frameVariantId?: string;
  kind: SourceAssetKind;
  objectKey: string;
  sha256: string;
  mimeType: string;
  widthPx?: number;
  heightPx?: number;
  pixelGeometry?: SourcePixelGeometry;
  captureMetadata: Record<string, unknown>;
};

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type SourcePixelGeometry = {
  coordinateSpace: "raw-encoded-pixels";
  regionConvention: "half-open-integer";
  encodedWidthPx: number;
  encodedHeightPx: number;
  exifOrientation: ExifOrientation;
  displayWidthPx: number;
  displayHeightPx: number;
  regionAuthoring: "allowed" | "requires-orientation-normalized-derived-source";
};

export type MeasurementMethod = "marking" | "caliper" | "derived" | "mixed";

export type MeasurementSet = {
  id: string;
  tenantId: string;
  frameModelId: string;
  version: number;
  measurements: FrameMeasurements;
  method: MeasurementMethod;
  verifiedBy?: string;
};

export const REQUIRED_MEASUREMENT_FIELDS = [
  "lensWidthMm",
  "bridgeWidthMm",
  "templeLengthMm",
  "frameWidthMm",
  "lensHeightMm",
] as const;

export type RequiredMeasurementField = (typeof REQUIRED_MEASUREMENT_FIELDS)[number];
export type MeasurementEvidenceMethod = "annotated-image" | "marking" | "caliper" | "derived";
export type MeasurementVerification = "unverified" | "verified";

export type PixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MeasurementEvidence = {
  field: RequiredMeasurementField;
  valueMm: number;
  method: MeasurementEvidenceMethod;
  verification: MeasurementVerification;
  sourceSha256: string;
  rawLabel: string;
  regionPx?: PixelRegion;
};

export type FrameCaptureDraft = {
  schemaVersion: 1;
  tenantId: string;
  frameModelId: string;
  sources: readonly SourceAsset[];
  measurementSet: MeasurementSet;
  evidence: readonly MeasurementEvidence[];
};

export type G1CaptureReadiness = {
  ready: boolean;
  issues: readonly ValidationIssue[];
};

const G1_REQUIRED_SOURCE_KINDS = [
  "front",
  "left45",
  "right45",
  "leftSide",
  "rightSide",
  "marking",
] as const satisfies readonly SourceAssetKind[];

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SOURCE_KEYS = new Set(["id", "tenantId", "frameModelId", "frameVariantId", "kind", "objectKey", "sha256", "mimeType", "widthPx", "heightPx", "pixelGeometry", "captureMetadata"]);
const PIXEL_GEOMETRY_KEYS = new Set(["coordinateSpace", "regionConvention", "encodedWidthPx", "encodedHeightPx", "exifOrientation", "displayWidthPx", "displayHeightPx", "regionAuthoring"]);
const PIXEL_REGION_KEYS = new Set(["x", "y", "width", "height"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function requireNonBlank(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, path, "must be a non-blank string");
    return false;
  }
  return true;
}

function requirePositive(value: unknown, path: string, issues: ValidationIssue[]): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    add(issues, path, "must be a positive finite number");
    return false;
  }
  return true;
}

function prefixed(prefix: string, issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, path: `${prefix}.${issue.path}` }));
}

function validatePixelDimension(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    add(issues, path, "must be a positive integer");
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) add(issues, path ? `${path}.${key}` : key, "is not allowed");
}

function validatePixelGeometry(value: unknown, path: string, issues: ValidationIssue[]): void {
  const geometry = record(value);
  if (!geometry) { add(issues, path, "must be an object"); return; }
  rejectUnknownKeys(geometry, PIXEL_GEOMETRY_KEYS, path, issues);
  for (const key of PIXEL_GEOMETRY_KEYS) if (!(key in geometry)) add(issues, `${path}.${key}`, "is required");
  if (geometry.coordinateSpace !== "raw-encoded-pixels") add(issues, `${path}.coordinateSpace`, "must identify raw immutable encoded pixels");
  if (geometry.regionConvention !== "half-open-integer") add(issues, `${path}.regionConvention`, "must identify half-open integer regions");
  for (const key of ["encodedWidthPx", "encodedHeightPx", "displayWidthPx", "displayHeightPx"] as const) validatePixelDimension(geometry[key], `${path}.${key}`, issues);
  if (!Number.isInteger(geometry.exifOrientation) || (geometry.exifOrientation as number) < 1 || (geometry.exifOrientation as number) > 8) add(issues, `${path}.exifOrientation`, "must be an integer from 1 through 8");
  if (Number.isInteger(geometry.exifOrientation)) {
    const swapsAxes = (geometry.exifOrientation as number) >= 5;
    const expectedWidth = swapsAxes ? geometry.encodedHeightPx : geometry.encodedWidthPx;
    const expectedHeight = swapsAxes ? geometry.encodedWidthPx : geometry.encodedHeightPx;
    if (geometry.displayWidthPx !== expectedWidth) add(issues, `${path}.displayWidthPx`, "must be derived from encoded dimensions and EXIF orientation");
    if (geometry.displayHeightPx !== expectedHeight) add(issues, `${path}.displayHeightPx`, "must be derived from encoded dimensions and EXIF orientation");
    const expectedAuthoring = geometry.exifOrientation === 1 ? "allowed" : "requires-orientation-normalized-derived-source";
    if (geometry.regionAuthoring !== expectedAuthoring) add(issues, `${path}.regionAuthoring`, "must fail closed according to EXIF orientation");
  }
}

export function validateSourceAsset(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const source = record(input);
  if (!source) return [{ path: "source", message: "must be an object" }];
  rejectUnknownKeys(source, SOURCE_KEYS, "", issues);

  requireNonBlank(source.id, "id", issues);
  requireNonBlank(source.tenantId, "tenantId", issues);
  if (source.frameModelId !== undefined) requireNonBlank(source.frameModelId, "frameModelId", issues);
  if (source.frameVariantId !== undefined) requireNonBlank(source.frameVariantId, "frameVariantId", issues);
  if (!SOURCE_ASSET_KINDS.includes(source.kind as SourceAssetKind)) {
    add(issues, "kind", "must be a supported source kind");
  }
  if (requireNonBlank(source.objectKey, "objectKey", issues)) {
    const segments = source.objectKey.split(/[\\/]/);
    if (source.objectKey.startsWith("/") || segments.includes("..")) {
      add(issues, "objectKey", "must be a relative traversal-free object key");
    }
  }
  if (typeof source.sha256 !== "string" || !HASH_PATTERN.test(source.sha256)) {
    add(issues, "sha256", "must be a 64-character SHA-256 hex digest");
  }
  if (typeof source.mimeType !== "string" || !MIME_PATTERN.test(source.mimeType)) {
    add(issues, "mimeType", "must be a valid MIME type");
  }
  if (source.widthPx !== undefined) validatePixelDimension(source.widthPx, "widthPx", issues);
  if (source.heightPx !== undefined) validatePixelDimension(source.heightPx, "heightPx", issues);
  if ((source.widthPx === undefined) !== (source.heightPx === undefined)) {
    add(issues, "widthPx", "widthPx and heightPx must be supplied together");
  }
  if (source.pixelGeometry !== undefined) {
    validatePixelGeometry(source.pixelGeometry, "pixelGeometry", issues);
    const geometry = record(source.pixelGeometry);
    if (source.widthPx === undefined) add(issues, "widthPx", "is required when pixelGeometry is supplied");
    else if (geometry && source.widthPx !== geometry.encodedWidthPx) add(issues, "widthPx", "must equal pixelGeometry.encodedWidthPx");
    if (source.heightPx === undefined) add(issues, "heightPx", "is required when pixelGeometry is supplied");
    else if (geometry && source.heightPx !== geometry.encodedHeightPx) add(issues, "heightPx", "must equal pixelGeometry.encodedHeightPx");
  }
  if (!record(source.captureMetadata)) {
    add(issues, "captureMetadata", "must be an object");
  }
  return issues;
}

export function validateMeasurementSet(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const set = record(input);
  if (!set) return [{ path: "measurementSet", message: "must be an object" }];

  requireNonBlank(set.id, "id", issues);
  requireNonBlank(set.tenantId, "tenantId", issues);
  requireNonBlank(set.frameModelId, "frameModelId", issues);
  if (!Number.isInteger(set.version) || (set.version as number) < 1) {
    add(issues, "version", "must be a positive integer");
  }
  if (!["marking", "caliper", "derived", "mixed"].includes(set.method as MeasurementMethod)) {
    add(issues, "method", "must be a supported measurement method");
  }
  if (set.verifiedBy !== undefined) requireNonBlank(set.verifiedBy, "verifiedBy", issues);

  const measurements = record(set.measurements);
  if (!measurements) {
    add(issues, "measurements", "must be an object");
    return issues;
  }
  for (const field of REQUIRED_MEASUREMENT_FIELDS) {
    requirePositive(measurements[field], `measurements.${field}`, issues);
  }
  if (measurements.frameThicknessMm !== undefined) {
    requirePositive(measurements.frameThicknessMm, "measurements.frameThicknessMm", issues);
  }
  for (const field of ["pantoscopicTiltDeg", "faceWrapDeg"] as const) {
    const value = measurements[field];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      add(issues, `measurements.${field}`, "must be finite when supplied");
    }
  }
  return issues;
}

function validateMeasurementEvidence(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const evidence = record(input);
  if (!evidence) return [{ path: "evidence", message: "must be an object" }];

  if (!REQUIRED_MEASUREMENT_FIELDS.includes(evidence.field as RequiredMeasurementField)) {
    add(issues, "field", "must identify a required frame dimension");
  }
  requirePositive(evidence.valueMm, "valueMm", issues);
  if (!["annotated-image", "marking", "caliper", "derived"].includes(evidence.method as MeasurementEvidenceMethod)) {
    add(issues, "method", "must be a supported evidence method");
  }
  if (!["unverified", "verified"].includes(evidence.verification as MeasurementVerification)) {
    add(issues, "verification", "must be unverified or verified");
  }
  if (typeof evidence.sourceSha256 !== "string" || !HASH_PATTERN.test(evidence.sourceSha256)) {
    add(issues, "sourceSha256", "must be a 64-character SHA-256 hex digest");
  }
  requireNonBlank(evidence.rawLabel, "rawLabel", issues);

  if (evidence.regionPx !== undefined) {
    const region = record(evidence.regionPx);
    if (!region) {
      add(issues, "regionPx", "must be an object");
    } else {
      rejectUnknownKeys(region, PIXEL_REGION_KEYS, "regionPx", issues);
      for (const coordinate of ["x", "y"] as const) {
        const value = region[coordinate];
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
          add(issues, `regionPx.${coordinate}`, "must be a non-negative integer");
        }
      }
      for (const dimension of ["width", "height"] as const) {
        if (!Number.isSafeInteger(region[dimension]) || (region[dimension] as number) < 1) add(issues, `regionPx.${dimension}`, "must be a positive integer");
      }
      if (Number.isSafeInteger(region.x) && Number.isSafeInteger(region.width) && !Number.isSafeInteger((region.x as number) + (region.width as number))) add(issues, "regionPx.width", "must keep the half-open x endpoint a safe integer");
      if (Number.isSafeInteger(region.y) && Number.isSafeInteger(region.height) && !Number.isSafeInteger((region.y as number) + (region.height as number))) add(issues, "regionPx.height", "must keep the half-open y endpoint a safe integer");
    }
  }
  return issues;
}

export function validateFrameCaptureDraft(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const draft = record(input);
  if (!draft) return [{ path: "draft", message: "must be an object" }];

  if (draft.schemaVersion !== 1) add(issues, "schemaVersion", "must equal 1");
  const tenantValid = requireNonBlank(draft.tenantId, "tenantId", issues);
  const modelValid = requireNonBlank(draft.frameModelId, "frameModelId", issues);

  const sources = Array.isArray(draft.sources) ? draft.sources : null;
  if (!sources) {
    add(issues, "sources", "must be an array");
  } else if (sources.length === 0) {
    add(issues, "sources", "must contain at least one source asset");
  }

  const sourceHashes = new Set<string>();
  const sourceByHash = new Map<string, Record<string, unknown>>();
  const sourceIds = new Set<string>();
  for (const [index, candidate] of (sources ?? []).entries()) {
    issues.push(...prefixed(`sources.${index}`, validateSourceAsset(candidate)));
    const source = record(candidate);
    if (!source) continue;
    if (typeof source.id === "string") {
      if (sourceIds.has(source.id)) add(issues, `sources.${index}.id`, "must be unique within the draft");
      sourceIds.add(source.id);
    }
    if (typeof source.sha256 === "string" && HASH_PATTERN.test(source.sha256)) {
      if (sourceHashes.has(source.sha256)) {
        add(issues, `sources.${index}.sha256`, "must not duplicate another source asset");
      }
      sourceHashes.add(source.sha256);
      sourceByHash.set(source.sha256, source);
    }
    if (tenantValid && source.tenantId !== draft.tenantId) {
      add(issues, `sources.${index}.tenantId`, "must match draft tenantId");
    }
    if (modelValid && source.frameModelId !== undefined && source.frameModelId !== draft.frameModelId) {
      add(issues, `sources.${index}.frameModelId`, "must match draft frameModelId");
    }
  }

  issues.push(...prefixed("measurementSet", validateMeasurementSet(draft.measurementSet)));
  const measurementSet = record(draft.measurementSet);
  if (measurementSet) {
    if (tenantValid && measurementSet.tenantId !== draft.tenantId) {
      add(issues, "measurementSet.tenantId", "must match draft tenantId");
    }
    if (modelValid && measurementSet.frameModelId !== draft.frameModelId) {
      add(issues, "measurementSet.frameModelId", "must match draft frameModelId");
    }
  }

  const evidenceItems = Array.isArray(draft.evidence) ? draft.evidence : null;
  if (!evidenceItems) add(issues, "evidence", "must be an array");
  const evidencedFields = new Set<RequiredMeasurementField>();
  const measurements = record(measurementSet?.measurements);
  for (const [index, candidate] of (evidenceItems ?? []).entries()) {
    issues.push(...prefixed(`evidence.${index}`, validateMeasurementEvidence(candidate)));
    const evidence = record(candidate);
    if (!evidence) continue;
    const field = evidence.field as RequiredMeasurementField;
    if (REQUIRED_MEASUREMENT_FIELDS.includes(field)) {
      evidencedFields.add(field);
      const expected = measurements?.[field];
      if (typeof expected === "number" && Number.isFinite(expected) && evidence.valueMm !== expected) {
        add(issues, `evidence.${index}.valueMm`, `must match measurementSet.measurements.${field}`);
      }
    }
    if (typeof evidence.sourceSha256 === "string" && !sourceHashes.has(evidence.sourceSha256)) {
      add(issues, `evidence.${index}.sourceSha256`, "must reference a source asset in this draft");
    }
    const source = typeof evidence.sourceSha256 === "string"
      ? sourceByHash.get(evidence.sourceSha256)
      : undefined;
    const region = record(evidence.regionPx);
    const geometry = record(source?.pixelGeometry);
    if (source && region && !geometry) {
      add(issues, `evidence.${index}.regionPx`, "requires byte-inspected pixelGeometry; legacy dimensions do not prove coordinate semantics");
    } else if (source && region && geometry?.regionAuthoring !== "allowed") {
      add(issues, `evidence.${index}.regionPx`, "requires an orientation-1 source or separately hashed orientation-normalized derived source");
    }
    if (
      source
      && region
      && geometry
      && typeof geometry.encodedWidthPx === "number"
      && typeof geometry.encodedHeightPx === "number"
      && typeof region.x === "number"
      && typeof region.y === "number"
      && typeof region.width === "number"
      && typeof region.height === "number"
      && (region.x + region.width > geometry.encodedWidthPx || region.y + region.height > geometry.encodedHeightPx)
    ) {
      add(issues, `evidence.${index}.regionPx`, "must fit inside the referenced source image");
    }
  }
  for (const field of REQUIRED_MEASUREMENT_FIELDS) {
    if (!evidencedFields.has(field)) {
      add(issues, "evidence", `missing evidence for ${field}`);
    }
  }
  return issues;
}

export function evaluateG1CaptureReadiness(input: unknown): G1CaptureReadiness {
  const issues = [...validateFrameCaptureDraft(input)];
  const draft = record(input);
  const sources = Array.isArray(draft?.sources) ? draft.sources : [];
  const kinds = new Set(
    sources
      .map((source) => record(source)?.kind)
      .filter((kind): kind is SourceAssetKind => SOURCE_ASSET_KINDS.includes(kind as SourceAssetKind)),
  );
  for (const kind of G1_REQUIRED_SOURCE_KINDS) {
    if (!kinds.has(kind)) add(issues, "sources", `missing required G1 ${kind} source`);
  }

  const evidenceItems = Array.isArray(draft?.evidence) ? draft.evidence : [];
  for (const field of REQUIRED_MEASUREMENT_FIELDS) {
    const verified = evidenceItems.some((candidate) => {
      const evidence = record(candidate);
      return evidence?.field === field && evidence.verification === "verified";
    });
    if (!verified) add(issues, "evidence", `missing verified evidence for ${field}`);
  }
  return { ready: issues.length === 0, issues };
}
