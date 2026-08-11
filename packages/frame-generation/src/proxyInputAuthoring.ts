import {
  REQUIRED_MEASUREMENT_FIELDS,
  canonicalJson,
  sha256Hex,
  validateFrameCaptureDraft,
  type FrameCaptureDraft,
  type PixelRegion,
  type RequiredMeasurementField,
  type SourceAsset,
  type SourcePixelGeometry,
} from "../../contracts/src/index.js";
import { deriveDimensionTemplateProxyProfile, deriveManualTraceProxyProfile, parseProxyGeneratorInput, type ProxyGeneratorInput } from "./proxyGenerator.js";

type Point2 = readonly [number, number];
type MutablePoint2 = [number, number];

export type ProxyThicknessEvidence = {
  kind: "evidenced";
  sourceId: string;
  valueMm: number;
  method: "annotated-image" | "marking";
  verification: "unverified";
  rawLabel: string;
  regionPx?: PixelRegion;
};

export type ProxyThicknessAssumption = {
  kind: "non-physical-proxy-assumption";
  valueMm: number;
  reason: string;
  boundsMm: { min: number; max: number };
  limitations: readonly string[];
};

export type DimensionTemplateProfileAuthoring = {
  method: "dimension-template";
  templateId: string;
  templateVersion: number;
};

export type ManualImageTraceProfileAuthoring = {
  method: "manual-image-trace";
  sourceId: string;
  regionPx: PixelRegion;
  coordinateRules: {
    originPx: Point2;
    millimetresPerPixel: number;
    xAxis: "right";
    yAxis: "up";
  };
  tracePx: {
    leftLens: { outer: readonly Point2[]; inner: readonly Point2[] };
    rightLens: { outer: readonly Point2[]; inner: readonly Point2[] };
    bridgeAnchors: { left: Point2; right: Point2 };
    hingeAnchors: { left: Point2; right: Point2 };
  };
};

export type ProxyInputAuthoring = {
  schemaVersion: 1;
  candidate: {
    frameVariantId: string;
    assetId: string;
    assetVersion: number;
  };
  generator: { id: string; version: string; configSha256: string };
  thickness: ProxyThicknessEvidence | ProxyThicknessAssumption;
  profile: DimensionTemplateProfileAuthoring | ManualImageTraceProfileAuthoring;
};

export type ProxyInputProvenance = {
  schemaVersion: 1;
  measurementEvidenceSha256: string;
  thickness: "evidenced" | "non-physical-proxy-assumption";
  profile: {
    method: "dimension-template" | "manual-image-trace";
    evidenceSha256: string;
    sourceSha256: string | null;
    limitations: readonly string[];
    contourFidelity: false;
  };
  authority: {
    fixture: true;
    status: "draft";
    quality: "proxy";
    recommendedForLive: false;
    admission: "calibration-only";
    promotable: false;
  };
};

export type AuthoredProxyGeneratorInput = {
  input: ProxyGeneratorInput;
  canonicalInputSha256: string;
  provenance: ProxyInputProvenance;
};

const HASH = /^[a-f0-9]{64}$/;
const DRAFT_KEYS = ["schemaVersion", "tenantId", "frameModelId", "sources", "measurementSet", "evidence"] as const;
const SOURCE_KEYS = ["id", "tenantId", "frameModelId", "frameVariantId", "kind", "objectKey", "sha256", "mimeType", "widthPx", "heightPx", "pixelGeometry", "captureMetadata"] as const;
const PIXEL_GEOMETRY_KEYS = ["coordinateSpace", "regionConvention", "encodedWidthPx", "encodedHeightPx", "exifOrientation", "displayWidthPx", "displayHeightPx", "regionAuthoring"] as const;
const SET_KEYS = ["id", "tenantId", "frameModelId", "version", "measurements", "method", "verifiedBy"] as const;
const MEASUREMENTS_KEYS = [...REQUIRED_MEASUREMENT_FIELDS, "frameThicknessMm", "pantoscopicTiltDeg", "faceWrapDeg"] as const;
const EVIDENCE_KEYS = ["field", "valueMm", "method", "verification", "sourceSha256", "rawLabel", "regionPx"] as const;
const REGION_KEYS = ["x", "y", "width", "height"] as const;
const AUTHOR_KEYS = ["schemaVersion", "candidate", "generator", "thickness", "profile"] as const;
const CANDIDATE_KEYS = ["frameVariantId", "assetId", "assetVersion"] as const;
const GENERATOR_KEYS = ["id", "version", "configSha256"] as const;
const TEMPLATE_KEYS = ["method", "templateId", "templateVersion"] as const;
const TRACE_KEYS = ["method", "sourceId", "regionPx", "coordinateRules", "tracePx"] as const;
const TRACE_RULE_KEYS = ["originPx", "millimetresPerPixel", "xAxis", "yAxis"] as const;
const TRACE_PROFILE_KEYS = ["leftLens", "rightLens", "bridgeAnchors", "hingeAnchors"] as const;
const LENS_KEYS = ["outer", "inner"] as const;
const ANCHOR_KEYS = ["left", "right"] as const;
const EVIDENCED_THICKNESS_KEYS = ["kind", "sourceId", "valueMm", "method", "verification", "rawLabel", "regionPx"] as const;
const ASSUMED_THICKNESS_KEYS = ["kind", "valueMm", "reason", "boundsMm", "limitations"] as const;
const BOUNDS_KEYS = ["min", "max"] as const;

export const DIMENSION_TEMPLATE_PROFILE_LIMITATIONS = Object.freeze([
  "Dimension-template profile is deterministic parametric geometry and carries no image contour-fidelity claim.",
  "Lens corners, rim inset, bridge path, hinges, and temples are proxy approximations derived from dimensions.",
  "Calibration-only fixture; physical fit, product appearance, actual wear, rights, approval, and publication remain unproven.",
]);

export const MANUAL_IMAGE_TRACE_PROFILE_LIMITATIONS = Object.freeze([
  "Manual pixel trace is bound to one captured source and explicit pixel-to-millimetre rules; it is not automated contour extraction.",
  "A manual front trace does not establish physical depth, fit, actual-wear performance, rights, approval, or publication.",
  "Calibration-only fixture; contour fidelity remains unverified.",
]);

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
  for (const key of keys) if (!(key in value)) throw new TypeError(`${path}.${key} is required`);
}

function exactOptional(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
}

function text(value: unknown, path: string, maximum = 256): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${path} must be bounded trimmed text without control characters`);
  }
}

function identifier(value: unknown, path: string): asserts value is string {
  text(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new TypeError(`${path} must be a bounded identifier`);
}

function assertNumericTokenMatches(rawLabel: unknown, valueMm: unknown, path: string): void {
  if (typeof rawLabel !== "string" || typeof valueMm !== "number" || !Number.isFinite(valueMm)) throw new TypeError(`${path} requires a finite value and text label`);
  const tokens = rawLabel.match(/(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/g) ?? [];
  if (!tokens.some((token) => Number(token) === valueMm)) throw new TypeError(`${path} must contain an ASCII numeric token equal to valueMm`);
}

function positive(value: unknown, min: number, max: number, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${path} must be a finite number between ${min} and ${max}`);
  }
}

function integer(value: unknown, min: number, max: number, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new TypeError(`${path} must be an integer between ${min} and ${max}`);
  }
}

function region(value: unknown, path: string, source?: SourceAsset): asserts value is PixelRegion {
  object(value, path); exact(value, REGION_KEYS, path);
  integer(value.x, 0, Number.MAX_SAFE_INTEGER, `${path}.x`);
  integer(value.y, 0, Number.MAX_SAFE_INTEGER, `${path}.y`);
  integer(value.width, 1, Number.MAX_SAFE_INTEGER, `${path}.width`);
  integer(value.height, 1, Number.MAX_SAFE_INTEGER, `${path}.height`);
  if (!Number.isSafeInteger(value.x + value.width) || !Number.isSafeInteger(value.y + value.height)) throw new TypeError(`${path} half-open endpoints must be safe integers`);
  if (!source?.pixelGeometry) {
    if (source) throw new TypeError(`${path} requires byte-inspected source pixelGeometry`);
  } else if (source.pixelGeometry.regionAuthoring !== "allowed") {
    throw new TypeError(`${path} requires an orientation-1 source or separately hashed orientation-normalized derived source`);
  } else if (value.x + value.width > source.pixelGeometry.encodedWidthPx || value.y + value.height > source.pixelGeometry.encodedHeightPx) {
    throw new TypeError(`${path} must fit inside the bound captured source`);
  }
}

function point(value: unknown, path: string): asserts value is MutablePoint2 {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${path} must be an [x, y] point`);
  integer(value[0], 0, Number.MAX_SAFE_INTEGER, `${path}.0`);
  integer(value[1], 0, Number.MAX_SAFE_INTEGER, `${path}.1`);
}

function pointInRegion(value: Point2, bounds: PixelRegion, path: string): void {
  if (value[0] < bounds.x || value[0] >= bounds.x + bounds.width || value[1] < bounds.y || value[1] >= bounds.y + bounds.height) {
    throw new TypeError(`${path} must fall inside profile.regionPx`);
  }
}

function assertStrictDraft(value: unknown): asserts value is FrameCaptureDraft {
  object(value, "captureDraft"); exact(value, DRAFT_KEYS, "captureDraft");
  identifier(value.tenantId, "captureDraft.tenantId"); identifier(value.frameModelId, "captureDraft.frameModelId");
  if (!Array.isArray(value.sources)) throw new TypeError("captureDraft.sources must be an array");
  for (const [index, source] of value.sources.entries()) {
    object(source, `captureDraft.sources.${index}`); exactOptional(source, SOURCE_KEYS, `captureDraft.sources.${index}`);
    if (source.pixelGeometry !== undefined) { object(source.pixelGeometry, `captureDraft.sources.${index}.pixelGeometry`); exact(source.pixelGeometry, PIXEL_GEOMETRY_KEYS, `captureDraft.sources.${index}.pixelGeometry`); }
  }
  object(value.measurementSet, "captureDraft.measurementSet"); exactOptional(value.measurementSet, SET_KEYS, "captureDraft.measurementSet");
  object(value.measurementSet.measurements, "captureDraft.measurementSet.measurements");
  exactOptional(value.measurementSet.measurements, MEASUREMENTS_KEYS, "captureDraft.measurementSet.measurements");
  if (!Array.isArray(value.evidence)) throw new TypeError("captureDraft.evidence must be an array");
  for (const [index, evidence] of value.evidence.entries()) {
    object(evidence, `captureDraft.evidence.${index}`); exactOptional(evidence, EVIDENCE_KEYS, `captureDraft.evidence.${index}`);
    if (evidence.regionPx !== undefined) region(evidence.regionPx, `captureDraft.evidence.${index}.regionPx`);
  }
  const issues = validateFrameCaptureDraft(value);
  if (issues.length > 0) throw new TypeError(`captureDraft failed validation: ${issues[0]!.path} ${issues[0]!.message}`);
  if (value.evidence.length !== REQUIRED_MEASUREMENT_FIELDS.length) throw new TypeError("captureDraft.evidence must contain exactly five required evidence records");
  const fields = new Set(value.evidence.map((item) => item.field));
  if (fields.size !== REQUIRED_MEASUREMENT_FIELDS.length) throw new TypeError("captureDraft.evidence must not contain duplicate or unknown measurement evidence");
  for (const field of REQUIRED_MEASUREMENT_FIELDS) if (!fields.has(field)) throw new TypeError(`captureDraft.evidence is missing ${field}`);
  for (const [index, evidence] of value.evidence.entries()) assertNumericTokenMatches(evidence.rawLabel, evidence.valueMm, `captureDraft.evidence.${index}.rawLabel`);
  for (const source of value.sources) {
    if (source.frameModelId !== value.frameModelId) throw new TypeError("captureDraft source frameModelId must be explicit and match the draft");
    if (!HASH.test(source.sha256)) throw new TypeError("captureDraft source hash must be lowercase SHA-256");
  }
}

function sourceById(draft: FrameCaptureDraft, sourceId: unknown, path: string): SourceAsset {
  identifier(sourceId, path);
  const source = draft.sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new TypeError(`${path} must bind a source id in captureDraft`);
  return source;
}

function assertNonJ1m(value: string, path: string): void {
  if (/(^|[^a-z0-9])j1[-_]?m([^a-z0-9]|$)/i.test(value)) throw new TypeError(`${path} must identify an explicit non-J1-M proxy fixture`);
}

function parseAuthoring(draft: FrameCaptureDraft, value: unknown): ProxyInputAuthoring {
  object(value, "authoring"); exact(value, AUTHOR_KEYS, "authoring");
  if (value.schemaVersion !== 1) throw new TypeError("authoring.schemaVersion must equal 1");
  object(value.candidate, "authoring.candidate"); exact(value.candidate, CANDIDATE_KEYS, "authoring.candidate");
  identifier(value.candidate.frameVariantId, "authoring.candidate.frameVariantId");
  identifier(value.candidate.assetId, "authoring.candidate.assetId");
  integer(value.candidate.assetVersion, 1, Number.MAX_SAFE_INTEGER, "authoring.candidate.assetVersion");
  for (const [path, candidate] of [["captureDraft.frameModelId", draft.frameModelId], ["authoring.candidate.frameVariantId", value.candidate.frameVariantId], ["authoring.candidate.assetId", value.candidate.assetId]] as const) assertNonJ1m(candidate as string, path);

  object(value.generator, "authoring.generator"); exact(value.generator, GENERATOR_KEYS, "authoring.generator");
  identifier(value.generator.id, "authoring.generator.id"); identifier(value.generator.version, "authoring.generator.version");
  if (typeof value.generator.configSha256 !== "string" || !HASH.test(value.generator.configSha256)) throw new TypeError("authoring.generator.configSha256 must be a lowercase SHA-256 digest");

  object(value.thickness, "authoring.thickness");
  const authoredThickness = draft.measurementSet.measurements.frameThicknessMm;
  if (value.thickness.kind === "evidenced") {
    exactOptional(value.thickness, EVIDENCED_THICKNESS_KEYS, "authoring.thickness");
    const source = sourceById(draft, value.thickness.sourceId, "authoring.thickness.sourceId");
    positive(value.thickness.valueMm, 1, 12, "authoring.thickness.valueMm");
    if (value.thickness.method !== "annotated-image" && value.thickness.method !== "marking") throw new TypeError("authoring.thickness.method requires an unverified image/marking method");
    if (value.thickness.verification !== "unverified") throw new TypeError("authoring.thickness cannot assert verification without a trusted verification artifact");
    text(value.thickness.rawLabel, "authoring.thickness.rawLabel");
    assertNumericTokenMatches(value.thickness.rawLabel, value.thickness.valueMm, "authoring.thickness.rawLabel");
    if (value.thickness.regionPx !== undefined) region(value.thickness.regionPx, "authoring.thickness.regionPx", source);
    if (authoredThickness !== undefined && authoredThickness !== value.thickness.valueMm) throw new TypeError("authoring.thickness.valueMm must match authored MeasurementSet frameThicknessMm");
  } else if (value.thickness.kind === "non-physical-proxy-assumption") {
    exact(value.thickness, ASSUMED_THICKNESS_KEYS, "authoring.thickness");
    if (authoredThickness !== undefined) throw new TypeError("a MeasurementSet with frameThicknessMm cannot be relabeled as a proxy assumption");
    positive(value.thickness.valueMm, 1, 12, "authoring.thickness.valueMm");
    text(value.thickness.reason, "authoring.thickness.reason", 512);
    object(value.thickness.boundsMm, "authoring.thickness.boundsMm"); exact(value.thickness.boundsMm, BOUNDS_KEYS, "authoring.thickness.boundsMm");
    positive(value.thickness.boundsMm.min, 1, 12, "authoring.thickness.boundsMm.min");
    positive(value.thickness.boundsMm.max, 1, 12, "authoring.thickness.boundsMm.max");
    if (value.thickness.boundsMm.min > value.thickness.valueMm || value.thickness.boundsMm.max < value.thickness.valueMm || value.thickness.boundsMm.min >= value.thickness.boundsMm.max) throw new TypeError("authoring.thickness bounds must strictly contain the assumed value");
    if (!Array.isArray(value.thickness.limitations) || value.thickness.limitations.length === 0 || value.thickness.limitations.length > 8) throw new TypeError("authoring.thickness.limitations must contain 1 to 8 explicit limitations");
    value.thickness.limitations.forEach((item, index) => text(item, `authoring.thickness.limitations.${index}`, 512));
  } else throw new TypeError("authoring.thickness.kind is unsupported; thickness cannot be defaulted");

  object(value.profile, "authoring.profile");
  if (value.profile.method === "dimension-template") {
    exact(value.profile, TEMPLATE_KEYS, "authoring.profile"); identifier(value.profile.templateId, "authoring.profile.templateId");
    integer(value.profile.templateVersion, 1, Number.MAX_SAFE_INTEGER, "authoring.profile.templateVersion");
  } else if (value.profile.method === "manual-image-trace") {
    exact(value.profile, TRACE_KEYS, "authoring.profile");
    const source = sourceById(draft, value.profile.sourceId, "authoring.profile.sourceId");
    region(value.profile.regionPx, "authoring.profile.regionPx", source);
    object(value.profile.coordinateRules, "authoring.profile.coordinateRules"); exact(value.profile.coordinateRules, TRACE_RULE_KEYS, "authoring.profile.coordinateRules");
    point(value.profile.coordinateRules.originPx, "authoring.profile.coordinateRules.originPx");
    pointInRegion(value.profile.coordinateRules.originPx, value.profile.regionPx, "authoring.profile.coordinateRules.originPx");
    positive(value.profile.coordinateRules.millimetresPerPixel, 0.001, 10, "authoring.profile.coordinateRules.millimetresPerPixel");
    if (value.profile.coordinateRules.xAxis !== "right" || value.profile.coordinateRules.yAxis !== "up") throw new TypeError("authoring.profile coordinate axes must be right/up");
    object(value.profile.tracePx, "authoring.profile.tracePx"); exact(value.profile.tracePx, TRACE_PROFILE_KEYS, "authoring.profile.tracePx");
    const traceRegion = value.profile.regionPx;
    for (const lensName of ["leftLens", "rightLens"] as const) {
      const lens = value.profile.tracePx[lensName]; object(lens, `authoring.profile.tracePx.${lensName}`); exact(lens, LENS_KEYS, `authoring.profile.tracePx.${lensName}`);
      for (const polygonName of ["outer", "inner"] as const) {
        const polygon = lens[polygonName]; if (!Array.isArray(polygon)) throw new TypeError(`authoring.profile.tracePx.${lensName}.${polygonName} must be an array`);
        polygon.forEach((candidate, index) => { point(candidate, `authoring.profile.tracePx.${lensName}.${polygonName}.${index}`); pointInRegion(candidate, traceRegion, `authoring.profile.tracePx.${lensName}.${polygonName}.${index}`); });
      }
    }
    for (const anchorName of ["bridgeAnchors", "hingeAnchors"] as const) {
      const anchors = value.profile.tracePx[anchorName]; object(anchors, `authoring.profile.tracePx.${anchorName}`); exact(anchors, ANCHOR_KEYS, `authoring.profile.tracePx.${anchorName}`);
      for (const side of ["left", "right"] as const) { point(anchors[side], `authoring.profile.tracePx.${anchorName}.${side}`); pointInRegion(anchors[side] as Point2, value.profile.regionPx, `authoring.profile.tracePx.${anchorName}.${side}`); }
    }
  } else throw new TypeError("authoring.profile.method is unsupported; unbound millimetre profiles are forbidden");
  return structuredClone(value) as unknown as ProxyInputAuthoring;
}

function measurementDigestBody(draft: FrameCaptureDraft, authoring: ProxyInputAuthoring): unknown {
  const orderedEvidence = REQUIRED_MEASUREMENT_FIELDS.map((field) => draft.evidence.find((candidate) => candidate.field === field)!);
  const sourcePixelGeometry = draft.sources
    .map((source) => ({ sourceSha256: source.sha256, pixelGeometry: source.pixelGeometry ?? null }))
    .sort((left, right) => left.sourceSha256.localeCompare(right.sourceSha256));
  if (authoring.thickness.kind === "evidenced") {
    const { sourceId, ...evidence } = authoring.thickness;
    const sourceSha256 = draft.sources.find((source) => source.id === sourceId)!.sha256;
    const source = draft.sources.find((candidate) => candidate.sha256 === sourceSha256)!;
    return { schemaVersion: 1, measurementSet: draft.measurementSet, evidence: orderedEvidence, sourcePixelGeometry, thickness: { ...evidence, sourceSha256, pixelGeometry: source.pixelGeometry ?? null } };
  }
  return { schemaVersion: 1, measurementSet: draft.measurementSet, evidence: orderedEvidence, sourcePixelGeometry, thickness: authoring.thickness };
}

function profileDigestBody(draft: FrameCaptureDraft, profile: ProxyInputAuthoring["profile"]): unknown {
  if (profile.method === "dimension-template") return { schemaVersion: 1, method: profile.method, body: { templateId: profile.templateId, templateVersion: profile.templateVersion } };
  const sourceSha256 = draft.sources.find((source) => source.id === profile.sourceId)!.sha256;
  const { sourceId: _ignored, method, ...evidence } = profile;
  const sourcePixelGeometry = draft.sources.find((source) => source.sha256 === sourceSha256)!.pixelGeometry as SourcePixelGeometry;
  return { schemaVersion: 1, method, body: { sourceSha256, sourcePixelGeometry, ...evidence } };
}

function dimensions(draft: FrameCaptureDraft, thickness: ProxyInputAuthoring["thickness"]): ProxyGeneratorInput["measurementSet"]["dimensionsMm"] {
  const measurements = draft.measurementSet.measurements;
  return {
    lensWidth: measurements.lensWidthMm, bridgeWidth: measurements.bridgeWidthMm,
    templeLength: measurements.templeLengthMm, frameWidth: measurements.frameWidthMm,
    lensHeight: measurements.lensHeightMm, frameThickness: thickness.valueMm,
  };
}

export async function authorProxyGeneratorInput(captureDraftValue: unknown, authoringValue: unknown): Promise<AuthoredProxyGeneratorInput> {
  assertStrictDraft(captureDraftValue);
  const draft = structuredClone(captureDraftValue) as FrameCaptureDraft;
  const authoring = parseAuthoring(draft, authoringValue);
  const measurementEvidenceSha256 = await sha256Hex(canonicalJson(measurementDigestBody(draft, authoring)));
  const profileEvidenceSha256 = await sha256Hex(canonicalJson(profileDigestBody(draft, authoring.profile)));
  const d = dimensions(draft, authoring.thickness);
  const durableProfileBody = authoring.profile.method === "dimension-template"
    ? { templateId: authoring.profile.templateId, templateVersion: authoring.profile.templateVersion }
    : (() => {
        const trace = authoring.profile as ManualImageTraceProfileAuthoring;
        return {
          sourceSha256: draft.sources.find((source) => source.id === trace.sourceId)!.sha256,
          sourcePixelGeometry: draft.sources.find((source) => source.id === trace.sourceId)!.pixelGeometry as SourcePixelGeometry,
          regionPx: trace.regionPx, coordinateRules: trace.coordinateRules, tracePx: trace.tracePx,
        };
      })();
  const profile = authoring.profile.method === "dimension-template"
    ? deriveDimensionTemplateProxyProfile(d)
    : deriveManualTraceProxyProfile(durableProfileBody as Parameters<typeof deriveManualTraceProxyProfile>[0]);
  const durableThickness = authoring.thickness.kind === "evidenced"
    ? (() => {
        const evidence = authoring.thickness as ProxyThicknessEvidence;
        const sourceSha256 = draft.sources.find((source) => source.id === evidence.sourceId)!.sha256;
        const { sourceId: _ignored, ...withoutSourceId } = evidence;
        const sourcePixelGeometry = draft.sources.find((source) => source.id === evidence.sourceId)!.pixelGeometry;
        return { ...withoutSourceId, sourceSha256, ...(sourcePixelGeometry === undefined ? {} : { sourcePixelGeometry }) };
      })()
    : authoring.thickness;
  const input = parseProxyGeneratorInput({
    schemaVersion: 1,
    candidate: { tenantId: draft.tenantId, frameModelId: draft.frameModelId, ...authoring.candidate },
    sourceAssetHashes: draft.sources.map((source) => source.sha256).sort(),
    measurementSet: { sha256: measurementEvidenceSha256, version: draft.measurementSet.version, dimensionsMm: d },
    generator: authoring.generator,
    authoringEvidence: {
      schemaVersion: 1, measurementEvidenceSha256,
      thickness: durableThickness,
      profile: {
        method: authoring.profile.method, evidenceSha256: profileEvidenceSha256,
        body: durableProfileBody,
        limitations: [...(authoring.profile.method === "dimension-template" ? DIMENSION_TEMPLATE_PROFILE_LIMITATIONS : MANUAL_IMAGE_TRACE_PROFILE_LIMITATIONS)],
        contourFidelity: false,
      },
    },
    profile,
  });
  const canonicalInputSha256 = await sha256Hex(canonicalJson(input));
  const traceSource = authoring.profile.method === "manual-image-trace" ? sourceById(draft, authoring.profile.sourceId, "authoring.profile.sourceId") : null;
  return {
    input, canonicalInputSha256,
    provenance: {
      schemaVersion: 1, measurementEvidenceSha256,
      thickness: authoring.thickness.kind,
      profile: {
        method: authoring.profile.method, evidenceSha256: profileEvidenceSha256, sourceSha256: traceSource?.sha256 ?? null,
        limitations: [...(authoring.profile.method === "dimension-template" ? DIMENSION_TEMPLATE_PROFILE_LIMITATIONS : MANUAL_IMAGE_TRACE_PROFILE_LIMITATIONS)],
        contourFidelity: false,
      },
      authority: { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false },
    },
  };
}
