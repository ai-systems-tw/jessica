import type { ValidationIssue } from "./frame.js";
import {
  REQUIRED_MEASUREMENT_FIELDS,
  type FrameCaptureDraft,
  type MeasurementEvidence,
  type PixelRegion,
  type RequiredMeasurementField,
  type SourceAsset,
  validateFrameCaptureDraft,
  validateSourceAsset,
} from "./sourceCapture.js";

export type MeasurementAuthorInput = {
  field: RequiredMeasurementField;
  sourceId: string;
  valueMm: number;
  rawLabel: string;
  regionPx?: PixelRegion;
};

export type FrameCaptureAuthorInput = {
  schemaVersion: 1;
  tenantId: string;
  frameModelId: string;
  measurementSetId: string;
  measurementSetVersion: number;
  measurements: readonly MeasurementAuthorInput[];
};

export type FrameCaptureAssemblyResult =
  | { ok: true; draft: FrameCaptureDraft }
  | { ok: false; issues: readonly ValidationIssue[] };

const AUTHOR_KEYS = new Set([
  "schemaVersion",
  "tenantId",
  "frameModelId",
  "measurementSetId",
  "measurementSetVersion",
  "measurements",
]);
const MEASUREMENT_KEYS = new Set(["field", "sourceId", "valueMm", "rawLabel", "regionPx"]);
const REGION_KEYS = new Set(["x", "y", "width", "height"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(issues, path ? `${path}.${key}` : key, "is not allowed");
  }
}

function requireNonBlank(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, path, "must be a non-blank string");
    return false;
  }
  return true;
}

function validateRegion(value: unknown, path: string, issues: ValidationIssue[]): void {
  const region = record(value);
  if (!region) {
    add(issues, path, "must be an object");
    return;
  }
  rejectUnknownKeys(region, REGION_KEYS, path, issues);
  for (const coordinate of ["x", "y"] as const) {
    const candidate = region[coordinate];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      add(issues, `${path}.${coordinate}`, "must be a non-negative finite number");
    }
  }
  for (const dimension of ["width", "height"] as const) {
    const candidate = region[dimension];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
      add(issues, `${path}.${dimension}`, "must be a positive finite number");
    }
  }
}

export function validateFrameCaptureAuthorInput(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const author = record(input);
  if (!author) return [{ path: "authoring", message: "must be an object" }];
  rejectUnknownKeys(author, AUTHOR_KEYS, "", issues);

  if (author.schemaVersion !== 1) add(issues, "schemaVersion", "must equal 1");
  requireNonBlank(author.tenantId, "tenantId", issues);
  requireNonBlank(author.frameModelId, "frameModelId", issues);
  requireNonBlank(author.measurementSetId, "measurementSetId", issues);
  if (!Number.isInteger(author.measurementSetVersion) || (author.measurementSetVersion as number) < 1) {
    add(issues, "measurementSetVersion", "must be a positive integer");
  }

  if (!Array.isArray(author.measurements)) {
    add(issues, "measurements", "must be an array");
    return issues;
  }
  if (author.measurements.length !== REQUIRED_MEASUREMENT_FIELDS.length) {
    add(issues, "measurements", "must contain exactly the five required measurements");
  }
  const fields = new Set<RequiredMeasurementField>();
  for (const [index, candidate] of author.measurements.entries()) {
    const path = `measurements.${index}`;
    const measurement = record(candidate);
    if (!measurement) {
      add(issues, path, "must be an object");
      continue;
    }
    rejectUnknownKeys(measurement, MEASUREMENT_KEYS, path, issues);
    if (!REQUIRED_MEASUREMENT_FIELDS.includes(measurement.field as RequiredMeasurementField)) {
      add(issues, `${path}.field`, "must identify a required frame dimension");
    } else {
      const field = measurement.field as RequiredMeasurementField;
      if (fields.has(field)) add(issues, `${path}.field`, "must not duplicate another measurement field");
      fields.add(field);
    }
    requireNonBlank(measurement.sourceId, `${path}.sourceId`, issues);
    if (typeof measurement.valueMm !== "number" || !Number.isFinite(measurement.valueMm) || measurement.valueMm <= 0) {
      add(issues, `${path}.valueMm`, "must be a positive finite number");
    }
    requireNonBlank(measurement.rawLabel, `${path}.rawLabel`, issues);
    if (measurement.regionPx !== undefined) validateRegion(measurement.regionPx, `${path}.regionPx`, issues);
  }
  for (const field of REQUIRED_MEASUREMENT_FIELDS) {
    if (!fields.has(field)) add(issues, "measurements", `missing measurement for ${field}`);
  }
  return issues;
}

function stableSource(source: SourceAsset): SourceAsset {
  const originalFilename = source.captureMetadata.originalFilename;
  const byteLength = source.captureMetadata.byteLength;
  return {
    id: source.id,
    tenantId: source.tenantId,
    ...(source.frameModelId === undefined ? {} : { frameModelId: source.frameModelId }),
    ...(source.frameVariantId === undefined ? {} : { frameVariantId: source.frameVariantId }),
    kind: source.kind,
    objectKey: source.objectKey,
    sha256: source.sha256,
    mimeType: source.mimeType,
    ...(source.widthPx === undefined ? {} : { widthPx: source.widthPx, heightPx: source.heightPx }),
    captureMetadata: {
      ...(typeof originalFilename === "string" ? { originalFilename } : {}),
      ...(Number.isInteger(byteLength) && (byteLength as number) >= 0 ? { byteLength } : {}),
    },
  };
}

export function assembleFrameCaptureDraft(
  inspectedSources: unknown,
  authorInput: unknown,
): FrameCaptureAssemblyResult {
  const issues = [...validateFrameCaptureAuthorInput(authorInput)];
  const author = record(authorInput);
  if (!Array.isArray(inspectedSources)) {
    add(issues, "sources", "must be an array of inspected SourceAsset records");
    return { ok: false, issues };
  }

  const sources: SourceAsset[] = [];
  const sourceById = new Map<string, SourceAsset>();
  for (const [index, candidate] of inspectedSources.entries()) {
    const sourceIssues = validateSourceAsset(candidate);
    for (const issue of sourceIssues) {
      add(issues, `sources.${index}.${issue.path}`, issue.message);
    }
    if (sourceIssues.length > 0) continue;
    const source = record(candidate);
    if (!source || typeof source.id !== "string") continue;
    if (sourceById.has(source.id)) {
      add(issues, `sources.${index}.id`, "must be unique among inspected sources");
      continue;
    }
    if (author && source.tenantId !== author.tenantId) {
      add(issues, `sources.${index}.tenantId`, "must match authoring tenantId");
    }
    if (author && source.frameModelId !== author.frameModelId) {
      add(issues, `sources.${index}.frameModelId`, "must match authoring frameModelId");
    }
    const typed = candidate as SourceAsset;
    sourceById.set(source.id, typed);
    sources.push(stableSource(typed));
  }

  const authorMeasurements = Array.isArray(author?.measurements) ? author.measurements : [];
  for (const [index, candidate] of authorMeasurements.entries()) {
    const measurement = record(candidate);
    if (!measurement || typeof measurement.sourceId !== "string") continue;
    const source = sourceById.get(measurement.sourceId);
    if (!source) {
      add(issues, `measurements.${index}.sourceId`, "must reference an inspected source id");
      continue;
    }
    const region = record(measurement.regionPx);
    if (region) {
      if (source.widthPx === undefined || source.heightPx === undefined) {
        add(issues, `measurements.${index}.regionPx`, "requires inspected pixel dimensions");
      } else if (
        typeof region.x === "number" && typeof region.y === "number"
        && typeof region.width === "number" && typeof region.height === "number"
        && (region.x + region.width > source.widthPx || region.y + region.height > source.heightPx)
      ) {
        add(issues, `measurements.${index}.regionPx`, "must fit inside the referenced source image");
      }
    }
  }
  if (issues.length > 0 || !author) return { ok: false, issues };

  const ordered = new Map(
    authorMeasurements.map((candidate) => {
      const item = candidate as MeasurementAuthorInput;
      return [item.field, item] as const;
    }),
  );
  const evidence: MeasurementEvidence[] = REQUIRED_MEASUREMENT_FIELDS.map((field) => {
    const item = ordered.get(field) as MeasurementAuthorInput;
    const source = sourceById.get(item.sourceId) as SourceAsset;
    return {
      field,
      valueMm: item.valueMm,
      method: "annotated-image",
      verification: "unverified",
      sourceSha256: source.sha256,
      rawLabel: item.rawLabel,
      ...(item.regionPx === undefined ? {} : { regionPx: { ...item.regionPx } }),
    };
  });
  const measurements = Object.fromEntries(
    REQUIRED_MEASUREMENT_FIELDS.map((field) => [field, (ordered.get(field) as MeasurementAuthorInput).valueMm]),
  ) as unknown as FrameCaptureDraft["measurementSet"]["measurements"];
  const draft: FrameCaptureDraft = {
    schemaVersion: 1,
    tenantId: author.tenantId as string,
    frameModelId: author.frameModelId as string,
    sources,
    measurementSet: {
      id: author.measurementSetId as string,
      tenantId: author.tenantId as string,
      frameModelId: author.frameModelId as string,
      version: author.measurementSetVersion as number,
      measurements,
      method: "derived",
    },
    evidence,
  };
  const draftIssues = validateFrameCaptureDraft(draft);
  return draftIssues.length === 0 ? { ok: true, draft } : { ok: false, issues: draftIssues };
}
