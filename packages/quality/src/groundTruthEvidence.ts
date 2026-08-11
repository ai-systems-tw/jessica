export const GROUND_TRUTH_SCHEMA_VERSION = 1 as const;

export const GROUND_TRUTH_PROFILES = ["technical-single-frame-slice", "canonical-validation"] as const;
export type GroundTruthProfile = (typeof GROUND_TRUTH_PROFILES)[number];
export const VIEW_ANGLES = ["front", "left", "right"] as const;
export type ViewAngle = (typeof VIEW_ANGLES)[number];
export const DEVICE_CLASSES = [
  "iphone-safari-representative",
  "iphone-se-lower-end",
  "android-chrome-mid-range",
  "windows-chrome",
  "windows-firefox",
] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];
export const VISUAL_REVIEW_RESULTS = [
  "approve",
  "approve-with-envelope-limit",
  "correction-required",
  "manual-model-required",
  "unsupported",
] as const;
export type VisualReviewResult = (typeof VISUAL_REVIEW_RESULTS)[number];
export const VISUAL_ISSUE_CATEGORIES = [
  "nose-placement", "front-width", "eye-lens-relationship", "temple-intersection", "floating",
  "pantoscopic-impression", "material-impression", "tint-misrepresentation", "size-exaggeration",
] as const;

type Point = { x: number; y: number };
type PlacementPoints = {
  bridgeCenter: Point;
  frameLeft: Point;
  frameRight: Point;
  leftLensCenter: Point;
  rightLensCenter: Point;
};

export type IntegrityVerification = {
  method: "actual-bytes-sha256";
  verifierVersion: string;
  verifiedAt: string;
  byteLength: number;
  sha256: string;
};

export type TemporalTraceSample = {
  timestampMs: number;
  targetPositionMm: Point;
  overlayPositionMm: Point | null;
  targetRotationDeg: number;
  overlayRotationDeg: number | null;
  facePresent: boolean;
  trackingVisible: boolean;
};

export type GroundTruthFixtureEvidence = {
  fixtureId: string;
  tenantId: string;
  subjectId: string;
  frameModelId: string;
  variantId: string;
  assetVersionId: string;
  assetVersion: number;
  hashes: {
    assetSha256: string;
    sourceSha256: string;
    manifestSha256: string;
    modelSha256: string;
    captureSha256: string;
    renderSha256: string;
  };
  integrity: {
    asset: IntegrityVerification;
    source: IntegrityVerification;
    manifest: IntegrityVerification;
    model: IntegrityVerification;
    capture: IntegrityVerification;
    render: IntegrityVerification;
    trace: IntegrityVerification;
  };
  runtime: { commitSha: string; configSha256: string };
  consent: {
    reference: string;
    scope: "actual-wear-ground-truth";
    retentionUntil: string;
    recordedAt: string;
  };
  image: {
    widthPx: number;
    heightPx: number;
    captureDistanceMm: number;
    lighting: string;
    expectedView: ViewAngle;
    expectedViewAngleDeg: number;
    actualViewAngleDeg: number;
  };
  environment: { deviceClass: DeviceClass; browser: string; os: string };
  actualFrameWidthMm: number;
  annotation: {
    actualCaptureSha256: string;
    overlayCaptureSha256: string;
    overlayRenderSha256: string;
    actual: PlacementPoints;
    overlay: PlacementPoints;
  };
  temporalTrace: {
    traceSha256: string;
    sourceCaptureSha256: string;
    runtimeCommitSha: string;
    samples: TemporalTraceSample[];
  };
  visualReview: {
    reviewerId: string;
    result: VisualReviewResult;
    issueCategories: (typeof VISUAL_ISSUE_CATEGORIES)[number][];
    recordedAt: string;
    assetSha256: string;
    runtimeCommitSha: string;
  };
};

export type DeviceOperationalEvidence = {
  runId: string;
  deviceClass: DeviceClass;
  browser: string;
  os: string;
  runtimeCommitSha: string;
  configSha256: string;
  captureSha256: string;
  renderSha256: string;
  traceSha256: string;
  integrity: { capture: IntegrityVerification; render: IntegrityVerification; trace: IntegrityVerification };
  checkpoints: Array<{ durationMs: 180000 | 600000; frameCount: number; detectionFps: number; renderFps: number; memoryPeakMb: number; thermal: "nominal" | "warm" | "hot" | "throttled" }>;
  durationMs: number;
  frameCount: number;
  detectionFps: number;
  renderFps: number;
  memoryPeakMb: number;
  thermal: "nominal" | "warm" | "hot" | "throttled";
  backgroundForeground: boolean;
  permissionRetry: boolean;
  networkLossAfterLoad: boolean;
  assetFailure: boolean;
  lowLight: boolean;
  rapidHeadMotion: boolean;
};

export type GroundTruthEvidence = {
  schemaVersion: 1;
  profile: GroundTruthProfile;
  evaluatedAt: string;
  runtime: { commitSha: string; configSha256: string };
  fixtures: GroundTruthFixtureEvidence[];
  deviceRuns: DeviceOperationalEvidence[];
};

export type EvidenceIssue = { code: string; path: string; message: string };
export type PlacementEvidenceMetrics = {
  centerErrorMm: number;
  frameWidthErrorPct: number;
  leftLensCenterErrorMm: number;
  rightLensCenterErrorMm: number;
  yawAttachmentErrorMm: number | null;
  rollErrorDeg: number;
};
export type TemporalEvidenceMetrics = {
  positionJitterRmsMm: number;
  rotationJitterRmsDeg: number;
  motionLagMs: number;
  reacquireJumpMm: number;
  lostLatencyMs: number;
  coverage: { observedMotion: boolean; observedLossAndHide: boolean; observedReacquisition: boolean };
};
export type FixtureMetricReport = {
  fixtureId: string;
  cell: string;
  placement: PlacementEvidenceMetrics;
  temporal: TemporalEvidenceMetrics;
  pass: boolean;
  violations: EvidenceIssue[];
};
export type CoverageReport = {
  requiredCells: string[];
  presentCells: string[];
  missingCells: string[];
  duplicateCells: string[];
  requiredDeviceClasses: readonly DeviceClass[];
  presentDeviceClasses: DeviceClass[];
  missingDeviceClasses: DeviceClass[];
  duplicateDeviceClasses: DeviceClass[];
  missingMetricViews: string[];
};
export type GroundTruthEvaluation = {
  schemaVersion: 1;
  gate: "TECHNICAL_SINGLE_FRAME_SLICE_READINESS" | "G1_CANONICAL_VALIDATION";
  profile: GroundTruthProfile | null;
  metricPass: boolean;
  gateReady: boolean;
  canonicalPromotionReady: boolean;
  issues: EvidenceIssue[];
  missingEvidence: EvidenceIssue[];
  fixtureReports: FixtureMetricReport[];
  coverage: CoverageReport;
};

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class Validator {
  readonly issues: EvidenceIssue[] = [];
  issue(code: string, path: string, message: string): void { this.issues.push({ code, path, message }); }
  object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.issue("invalid_type", path, "must be an object"); return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!keys.includes(key)) this.issue("unknown_field", `${path}.${key}`, "field is not allowed");
    return record;
  }
  array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) { this.issue("invalid_type", path, "must be an array"); return []; }
    return value;
  }
  string(value: unknown, path: string): string {
    if (typeof value !== "string" || !value.trim()) { this.issue("invalid_string", path, "must be a non-blank string"); return ""; }
    return value;
  }
  enum<T extends string>(value: unknown, path: string, values: readonly T[]): T {
    const text = this.string(value, path);
    if (!values.includes(text as T)) { this.issue("invalid_enum", path, `must be one of: ${values.join(", ")}`); return values[0]!; }
    return text as T;
  }
  number(value: unknown, path: string, minimum = 0, integer = false): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
      this.issue("invalid_number", path, `must be a finite ${integer ? "integer " : ""}>= ${minimum}`); return 0;
    }
    return value;
  }
  boolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") { this.issue("invalid_boolean", path, "must be a boolean"); return false; }
    return value;
  }
  hash(value: unknown, path: string): string {
    const text = this.string(value, path).toLowerCase();
    if (!SHA256.test(text)) this.issue("invalid_hash", path, "must be a 64-character lowercase SHA-256 digest");
    return text;
  }
  commit(value: unknown, path: string): string {
    const text = this.string(value, path).toLowerCase();
    if (!COMMIT.test(text)) this.issue("invalid_commit", path, "must be a 40-character lowercase commit SHA");
    return text;
  }
  date(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(text))) this.issue("invalid_timestamp", path, "must be an ISO-8601 UTC timestamp");
    return text;
  }
}

function point(v: Validator, value: unknown, path: string): Point {
  const o = v.object(value, path, ["x", "y"]);
  return { x: v.number(o?.x, `${path}.x`, Number.NEGATIVE_INFINITY), y: v.number(o?.y, `${path}.y`, Number.NEGATIVE_INFINITY) };
}
const PLACEMENT_KEYS = ["bridgeCenter", "frameLeft", "frameRight", "leftLensCenter", "rightLensCenter"] as const;
function points(v: Validator, value: unknown, path: string, width: number, height: number): PlacementPoints {
  const o = v.object(value, path, PLACEMENT_KEYS);
  const result = Object.fromEntries(PLACEMENT_KEYS.map((key) => [key, point(v, o?.[key], `${path}.${key}`)])) as PlacementPoints;
  for (const key of PLACEMENT_KEYS) {
    const p = result[key];
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) v.issue("point_outside_image", `${path}.${key}`, `must lie within 0 <= x < ${width} and 0 <= y < ${height}`);
  }
  return result;
}

function parseRuntime(v: Validator, value: unknown, path: string): { commitSha: string; configSha256: string } {
  const o = v.object(value, path, ["commitSha", "configSha256"]);
  return { commitSha: v.commit(o?.commitSha, `${path}.commitSha`), configSha256: v.hash(o?.configSha256, `${path}.configSha256`) };
}

function parseIntegrity(v: Validator, value: unknown, path: string): IntegrityVerification {
  const o = v.object(value, path, ["method", "verifierVersion", "verifiedAt", "byteLength", "sha256"]);
  return {
    method: v.enum(o?.method, `${path}.method`, ["actual-bytes-sha256"] as const),
    verifierVersion: v.string(o?.verifierVersion, `${path}.verifierVersion`),
    verifiedAt: v.date(o?.verifiedAt, `${path}.verifiedAt`),
    byteLength: v.number(o?.byteLength, `${path}.byteLength`, 1, true),
    sha256: v.hash(o?.sha256, `${path}.sha256`),
  };
}

function parseFixture(v: Validator, value: unknown, path: string): GroundTruthFixtureEvidence {
  const keys = ["fixtureId", "tenantId", "subjectId", "frameModelId", "variantId", "assetVersionId", "assetVersion", "hashes", "integrity", "runtime", "consent", "image", "environment", "actualFrameWidthMm", "annotation", "temporalTrace", "visualReview"];
  const o = v.object(value, path, keys);
  const hashes = v.object(o?.hashes, `${path}.hashes`, ["assetSha256", "sourceSha256", "manifestSha256", "modelSha256", "captureSha256", "renderSha256"]);
  const parsedHashes = {
    assetSha256: v.hash(hashes?.assetSha256, `${path}.hashes.assetSha256`), sourceSha256: v.hash(hashes?.sourceSha256, `${path}.hashes.sourceSha256`),
    manifestSha256: v.hash(hashes?.manifestSha256, `${path}.hashes.manifestSha256`), modelSha256: v.hash(hashes?.modelSha256, `${path}.hashes.modelSha256`),
    captureSha256: v.hash(hashes?.captureSha256, `${path}.hashes.captureSha256`), renderSha256: v.hash(hashes?.renderSha256, `${path}.hashes.renderSha256`),
  };
  const integrity = v.object(o?.integrity, `${path}.integrity`, ["asset", "source", "manifest", "model", "capture", "render", "trace"]);
  const parsedIntegrity = {
    asset: parseIntegrity(v, integrity?.asset, `${path}.integrity.asset`),
    source: parseIntegrity(v, integrity?.source, `${path}.integrity.source`),
    manifest: parseIntegrity(v, integrity?.manifest, `${path}.integrity.manifest`),
    model: parseIntegrity(v, integrity?.model, `${path}.integrity.model`),
    capture: parseIntegrity(v, integrity?.capture, `${path}.integrity.capture`),
    render: parseIntegrity(v, integrity?.render, `${path}.integrity.render`),
    trace: parseIntegrity(v, integrity?.trace, `${path}.integrity.trace`),
  };
  for (const [name, expected] of Object.entries({ asset: parsedHashes.assetSha256, source: parsedHashes.sourceSha256, manifest: parsedHashes.manifestSha256, model: parsedHashes.modelSha256, capture: parsedHashes.captureSha256, render: parsedHashes.renderSha256 })) {
    if (parsedIntegrity[name as keyof typeof parsedIntegrity].sha256 !== expected) v.issue("integrity_hash_mismatch", `${path}.integrity.${name}.sha256`, "verified actual-bytes hash must match the artifact hash");
  }
  const runtime = parseRuntime(v, o?.runtime, `${path}.runtime`);
  const consent = v.object(o?.consent, `${path}.consent`, ["reference", "scope", "retentionUntil", "recordedAt"]);
  const parsedConsent = { reference: v.string(consent?.reference, `${path}.consent.reference`), scope: v.enum(consent?.scope, `${path}.consent.scope`, ["actual-wear-ground-truth"] as const), retentionUntil: v.date(consent?.retentionUntil, `${path}.consent.retentionUntil`), recordedAt: v.date(consent?.recordedAt, `${path}.consent.recordedAt`) };
  if (parsedConsent.recordedAt && parsedConsent.retentionUntil && Date.parse(parsedConsent.retentionUntil) <= Date.parse(parsedConsent.recordedAt)) v.issue("invalid_retention", `${path}.consent.retentionUntil`, "must be later than recordedAt");
  const image = v.object(o?.image, `${path}.image`, ["widthPx", "heightPx", "captureDistanceMm", "lighting", "expectedView", "expectedViewAngleDeg", "actualViewAngleDeg"]);
  const parsedImage = { widthPx: v.number(image?.widthPx, `${path}.image.widthPx`, 1, true), heightPx: v.number(image?.heightPx, `${path}.image.heightPx`, 1, true), captureDistanceMm: v.number(image?.captureDistanceMm, `${path}.image.captureDistanceMm`, Number.MIN_VALUE), lighting: v.string(image?.lighting, `${path}.image.lighting`), expectedView: v.enum(image?.expectedView, `${path}.image.expectedView`, VIEW_ANGLES), expectedViewAngleDeg: v.number(image?.expectedViewAngleDeg, `${path}.image.expectedViewAngleDeg`, -180), actualViewAngleDeg: v.number(image?.actualViewAngleDeg, `${path}.image.actualViewAngleDeg`, -180) };
  if (parsedImage.expectedViewAngleDeg > 180) v.issue("invalid_angle", `${path}.image.expectedViewAngleDeg`, "must be <= 180");
  if (parsedImage.actualViewAngleDeg > 180) v.issue("invalid_angle", `${path}.image.actualViewAngleDeg`, "must be <= 180");
  const env = v.object(o?.environment, `${path}.environment`, ["deviceClass", "browser", "os"]);
  const environment = { deviceClass: v.enum(env?.deviceClass, `${path}.environment.deviceClass`, DEVICE_CLASSES), browser: v.string(env?.browser, `${path}.environment.browser`), os: v.string(env?.os, `${path}.environment.os`) };
  const annotation = v.object(o?.annotation, `${path}.annotation`, ["actualCaptureSha256", "overlayCaptureSha256", "overlayRenderSha256", "actual", "overlay"]);
  const parsedAnnotation = { actualCaptureSha256: v.hash(annotation?.actualCaptureSha256, `${path}.annotation.actualCaptureSha256`), overlayCaptureSha256: v.hash(annotation?.overlayCaptureSha256, `${path}.annotation.overlayCaptureSha256`), overlayRenderSha256: v.hash(annotation?.overlayRenderSha256, `${path}.annotation.overlayRenderSha256`), actual: points(v, annotation?.actual, `${path}.annotation.actual`, parsedImage.widthPx, parsedImage.heightPx), overlay: points(v, annotation?.overlay, `${path}.annotation.overlay`, parsedImage.widthPx, parsedImage.heightPx) };
  if (parsedAnnotation.actualCaptureSha256 !== parsedHashes.captureSha256 || parsedAnnotation.overlayCaptureSha256 !== parsedHashes.captureSha256 || parsedAnnotation.overlayRenderSha256 !== parsedHashes.renderSha256) v.issue("provenance_mismatch", `${path}.annotation`, "actual/overlay provenance must match fixture capture/render hashes");
  const trace = v.object(o?.temporalTrace, `${path}.temporalTrace`, ["traceSha256", "sourceCaptureSha256", "runtimeCommitSha", "samples"]);
  const samples = v.array(trace?.samples, `${path}.temporalTrace.samples`).map((entry, index) => {
    const sp = `${path}.temporalTrace.samples[${index}]`; const so = v.object(entry, sp, ["timestampMs", "targetPositionMm", "overlayPositionMm", "targetRotationDeg", "overlayRotationDeg", "facePresent", "trackingVisible"]);
    const overlayPositionMm = so?.overlayPositionMm === null ? null : point(v, so?.overlayPositionMm, `${sp}.overlayPositionMm`);
    const overlayRotationDeg = so?.overlayRotationDeg === null ? null : v.number(so?.overlayRotationDeg, `${sp}.overlayRotationDeg`, -180);
    return { timestampMs: v.number(so?.timestampMs, `${sp}.timestampMs`), targetPositionMm: point(v, so?.targetPositionMm, `${sp}.targetPositionMm`), overlayPositionMm, targetRotationDeg: v.number(so?.targetRotationDeg, `${sp}.targetRotationDeg`, -180), overlayRotationDeg, facePresent: v.boolean(so?.facePresent, `${sp}.facePresent`), trackingVisible: v.boolean(so?.trackingVisible, `${sp}.trackingVisible`) };
  });
  if (samples.length < 2) v.issue("insufficient_trace", `${path}.temporalTrace.samples`, "must contain at least two samples");
  for (let i = 1; i < samples.length; i += 1) if (samples[i]!.timestampMs <= samples[i - 1]!.timestampMs) v.issue("non_monotonic_trace", `${path}.temporalTrace.samples[${i}].timestampMs`, "timestamps must be strictly increasing");
  const parsedTrace = { traceSha256: v.hash(trace?.traceSha256, `${path}.temporalTrace.traceSha256`), sourceCaptureSha256: v.hash(trace?.sourceCaptureSha256, `${path}.temporalTrace.sourceCaptureSha256`), runtimeCommitSha: v.commit(trace?.runtimeCommitSha, `${path}.temporalTrace.runtimeCommitSha`), samples };
  if (parsedTrace.sourceCaptureSha256 !== parsedHashes.captureSha256 || parsedTrace.runtimeCommitSha !== runtime.commitSha) v.issue("provenance_mismatch", `${path}.temporalTrace`, "trace provenance must match fixture capture/runtime");
  if (parsedIntegrity.trace.sha256 !== parsedTrace.traceSha256) v.issue("integrity_hash_mismatch", `${path}.integrity.trace.sha256`, "verified actual-bytes trace hash must match temporalTrace.traceSha256");
  const review = v.object(o?.visualReview, `${path}.visualReview`, ["reviewerId", "result", "issueCategories", "recordedAt", "assetSha256", "runtimeCommitSha"]);
  const issueCategories = v.array(review?.issueCategories, `${path}.visualReview.issueCategories`).map((item, index) => v.enum(item, `${path}.visualReview.issueCategories[${index}]`, VISUAL_ISSUE_CATEGORIES));
  const visualReview = { reviewerId: v.string(review?.reviewerId, `${path}.visualReview.reviewerId`), result: v.enum(review?.result, `${path}.visualReview.result`, VISUAL_REVIEW_RESULTS), issueCategories, recordedAt: v.date(review?.recordedAt, `${path}.visualReview.recordedAt`), assetSha256: v.hash(review?.assetSha256, `${path}.visualReview.assetSha256`), runtimeCommitSha: v.commit(review?.runtimeCommitSha, `${path}.visualReview.runtimeCommitSha`) };
  if (visualReview.assetSha256 !== parsedHashes.assetSha256 || visualReview.runtimeCommitSha !== runtime.commitSha) v.issue("provenance_mismatch", `${path}.visualReview`, "visual review must match fixture asset/runtime");
  const signedViewValid = parsedImage.expectedView === "front" ? Math.abs(parsedImage.actualViewAngleDeg) <= 15 : parsedImage.expectedView === "left" ? parsedImage.actualViewAngleDeg <= -15 : parsedImage.actualViewAngleDeg >= 15;
  if (!signedViewValid || Math.abs(parsedImage.actualViewAngleDeg - parsedImage.expectedViewAngleDeg) > 10) v.issue("view_angle_mismatch", `${path}.image.actualViewAngleDeg`, "actual angle must match the signed front/left/right view within 10 degrees");
  return { fixtureId: v.string(o?.fixtureId, `${path}.fixtureId`), tenantId: v.string(o?.tenantId, `${path}.tenantId`), subjectId: v.string(o?.subjectId, `${path}.subjectId`), frameModelId: v.string(o?.frameModelId, `${path}.frameModelId`), variantId: v.string(o?.variantId, `${path}.variantId`), assetVersionId: v.string(o?.assetVersionId, `${path}.assetVersionId`), assetVersion: v.number(o?.assetVersion, `${path}.assetVersion`, 1, true), hashes: parsedHashes, integrity: parsedIntegrity, runtime, consent: parsedConsent, image: parsedImage, environment, actualFrameWidthMm: v.number(o?.actualFrameWidthMm, `${path}.actualFrameWidthMm`, Number.MIN_VALUE), annotation: parsedAnnotation, temporalTrace: parsedTrace, visualReview };
}

function parseDeviceRun(v: Validator, value: unknown, path: string): DeviceOperationalEvidence {
  const keys = ["runId", "deviceClass", "browser", "os", "runtimeCommitSha", "configSha256", "captureSha256", "renderSha256", "traceSha256", "integrity", "checkpoints", "durationMs", "frameCount", "detectionFps", "renderFps", "memoryPeakMb", "thermal", "backgroundForeground", "permissionRetry", "networkLossAfterLoad", "assetFailure", "lowLight", "rapidHeadMotion"];
  const o = v.object(value, path, keys);
  const captureSha256 = v.hash(o?.captureSha256, `${path}.captureSha256`); const renderSha256 = v.hash(o?.renderSha256, `${path}.renderSha256`); const traceSha256 = v.hash(o?.traceSha256, `${path}.traceSha256`);
  const integrityObject = v.object(o?.integrity, `${path}.integrity`, ["capture", "render", "trace"]);
  const integrity = { capture: parseIntegrity(v, integrityObject?.capture, `${path}.integrity.capture`), render: parseIntegrity(v, integrityObject?.render, `${path}.integrity.render`), trace: parseIntegrity(v, integrityObject?.trace, `${path}.integrity.trace`) };
  if (integrity.capture.sha256 !== captureSha256 || integrity.render.sha256 !== renderSha256 || integrity.trace.sha256 !== traceSha256) v.issue("integrity_hash_mismatch", `${path}.integrity`, "verified device artifact hashes must match capture/render/trace claims");
  const checkpoints = v.array(o?.checkpoints, `${path}.checkpoints`).map((entry, index) => {
    const cp = `${path}.checkpoints[${index}]`; const co = v.object(entry, cp, ["durationMs", "frameCount", "detectionFps", "renderFps", "memoryPeakMb", "thermal"]);
    const durationMs = v.number(co?.durationMs, `${cp}.durationMs`, 1, true);
    if (durationMs !== 180_000 && durationMs !== 600_000) v.issue("invalid_checkpoint", `${cp}.durationMs`, "must equal 180000 or 600000");
    return { durationMs: durationMs as 180000 | 600000, frameCount: v.number(co?.frameCount, `${cp}.frameCount`, 1, true), detectionFps: v.number(co?.detectionFps, `${cp}.detectionFps`, Number.MIN_VALUE), renderFps: v.number(co?.renderFps, `${cp}.renderFps`, Number.MIN_VALUE), memoryPeakMb: v.number(co?.memoryPeakMb, `${cp}.memoryPeakMb`, Number.MIN_VALUE), thermal: v.enum(co?.thermal, `${cp}.thermal`, ["nominal", "warm", "hot", "throttled"] as const) };
  });
  if (checkpoints.length !== 2 || !checkpoints.some((cp) => cp.durationMs === 180_000) || !checkpoints.some((cp) => cp.durationMs === 600_000)) v.issue("missing_performance_checkpoints", `${path}.checkpoints`, "must contain exactly one 3-minute and one 10-minute checkpoint");
  return { runId: v.string(o?.runId, `${path}.runId`), deviceClass: v.enum(o?.deviceClass, `${path}.deviceClass`, DEVICE_CLASSES), browser: v.string(o?.browser, `${path}.browser`), os: v.string(o?.os, `${path}.os`), runtimeCommitSha: v.commit(o?.runtimeCommitSha, `${path}.runtimeCommitSha`), configSha256: v.hash(o?.configSha256, `${path}.configSha256`), captureSha256, renderSha256, traceSha256, integrity, checkpoints, durationMs: v.number(o?.durationMs, `${path}.durationMs`, Number.MIN_VALUE), frameCount: v.number(o?.frameCount, `${path}.frameCount`, 1, true), detectionFps: v.number(o?.detectionFps, `${path}.detectionFps`, Number.MIN_VALUE), renderFps: v.number(o?.renderFps, `${path}.renderFps`, Number.MIN_VALUE), memoryPeakMb: v.number(o?.memoryPeakMb, `${path}.memoryPeakMb`, Number.MIN_VALUE), thermal: v.enum(o?.thermal, `${path}.thermal`, ["nominal", "warm", "hot", "throttled"] as const), backgroundForeground: v.boolean(o?.backgroundForeground, `${path}.backgroundForeground`), permissionRetry: v.boolean(o?.permissionRetry, `${path}.permissionRetry`), networkLossAfterLoad: v.boolean(o?.networkLossAfterLoad, `${path}.networkLossAfterLoad`), assetFailure: v.boolean(o?.assetFailure, `${path}.assetFailure`), lowLight: v.boolean(o?.lowLight, `${path}.lowLight`), rapidHeadMotion: v.boolean(o?.rapidHeadMotion, `${path}.rapidHeadMotion`) };
}

export function parseGroundTruthEvidence(input: unknown): { evidence: GroundTruthEvidence | null; issues: EvidenceIssue[] } {
  const v = new Validator();
  const o = v.object(input, "$", ["schemaVersion", "profile", "evaluatedAt", "runtime", "fixtures", "deviceRuns"]);
  if (o?.schemaVersion !== GROUND_TRUTH_SCHEMA_VERSION) v.issue("unsupported_schema", "$.schemaVersion", "must equal 1");
  const profile = v.enum(o?.profile, "$.profile", GROUND_TRUTH_PROFILES);
  const evaluatedAt = v.date(o?.evaluatedAt, "$.evaluatedAt");
  const runtime = parseRuntime(v, o?.runtime, "$.runtime");
  const fixtures = v.array(o?.fixtures, "$.fixtures").map((entry, index) => parseFixture(v, entry, `$.fixtures[${index}]`));
  const deviceRuns = v.array(o?.deviceRuns, "$.deviceRuns").map((entry, index) => parseDeviceRun(v, entry, `$.deviceRuns[${index}]`));
  const seenFixtures = new Set<string>();
  fixtures.forEach((fixture, index) => { if (seenFixtures.has(fixture.fixtureId)) v.issue("duplicate_fixture_id", `$.fixtures[${index}].fixtureId`, "fixtureId must be unique"); seenFixtures.add(fixture.fixtureId); if (fixture.runtime.commitSha !== runtime.commitSha || fixture.runtime.configSha256 !== runtime.configSha256) v.issue("runtime_mismatch", `$.fixtures[${index}].runtime`, "fixture runtime must match document runtime"); });
  fixtures.forEach((fixture, index) => {
    if (Date.parse(fixture.consent.retentionUntil) <= Date.parse(evaluatedAt)) v.issue("expired_consent", `$.fixtures[${index}].consent.retentionUntil`, "retention must extend beyond evaluatedAt");
    for (const [path, timestamp] of [["consent.recordedAt", fixture.consent.recordedAt], ["visualReview.recordedAt", fixture.visualReview.recordedAt], ...Object.entries(fixture.integrity).map(([name, verification]) => [`integrity.${name}.verifiedAt`, verification.verifiedAt])] as [string, string][]) {
      if (Date.parse(timestamp) > Date.parse(evaluatedAt)) v.issue("future_dated_evidence", `$.fixtures[${index}].${path}`, "evidence timestamp must not be later than evaluatedAt");
    }
  });
  const seenRuns = new Set<string>(); deviceRuns.forEach((run, index) => { if (seenRuns.has(run.runId)) v.issue("duplicate_run_id", `$.deviceRuns[${index}].runId`, "runId must be unique"); seenRuns.add(run.runId); if (run.runtimeCommitSha !== runtime.commitSha || run.configSha256 !== runtime.configSha256) v.issue("runtime_mismatch", `$.deviceRuns[${index}]`, "device run runtime must match document runtime"); });
  const deviceArtifactOwners = new Map<string, string>();
  deviceRuns.forEach((run, index) => {
    for (const [name, verification] of Object.entries(run.integrity)) if (Date.parse(verification.verifiedAt) > Date.parse(evaluatedAt)) v.issue("future_dated_evidence", `$.deviceRuns[${index}].integrity.${name}.verifiedAt`, "verification timestamp must not be later than evaluatedAt");
    for (const [kind, hash] of [["capture", run.captureSha256], ["render", run.renderSha256], ["trace", run.traceSha256]] as const) { const key = `${kind}:${hash}`; const owner = deviceArtifactOwners.get(key); if (owner && owner !== run.runId) v.issue("reused_device_artifact", `$.deviceRuns[${index}].${kind}Sha256`, `${kind} hash is already bound to device run ${owner}`); deviceArtifactOwners.set(key, run.runId); }
    const browser = run.browser.toLowerCase(); const os = run.os.toLowerCase();
    const familyValid = run.deviceClass.startsWith("iphone-") ? browser.includes("safari") && os.includes("ios") : run.deviceClass === "android-chrome-mid-range" ? browser.includes("chrome") && os.includes("android") : run.deviceClass === "windows-chrome" ? browser.includes("chrome") && os.includes("windows") : browser.includes("firefox") && os.includes("windows");
    if (!familyValid) v.issue("device_family_mismatch", `$.deviceRuns[${index}]`, "browser/OS family must match deviceClass");
  });
  // Return the typed projection together with every validation issue. Consumers
  // must use issues.length === 0 as the admission decision; retaining the
  // projection lets the evaluator report metricPass independently from missing
  // promotion evidence.
  return { evidence: { schemaVersion: 1, profile, evaluatedAt, runtime, fixtures, deviceRuns }, issues: v.issues };
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function angle(a: Point, b: Point): number { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
export function normalizeAngleDeg(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180; }
function rms(values: number[]): number { return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length); }

export function deriveEvidenceMetrics(fixture: GroundTruthFixtureEvidence): { placement: PlacementEvidenceMetrics; temporal: TemporalEvidenceMetrics } {
  const { actual, overlay } = fixture.annotation;
  const actualWidthPx = distance(actual.frameLeft, actual.frameRight);
  if (!(actualWidthPx > 0)) throw new RangeError("actual annotation frame width must be positive");
  const mmPerPixel = fixture.actualFrameWidthMm / actualWidthPx;
  const view = fixture.image.expectedView;
  const yawAttachmentErrorMm = view === "front" ? null : distance(view === "left" ? actual.frameLeft : actual.frameRight, view === "left" ? overlay.frameLeft : overlay.frameRight) * mmPerPixel;
  const placement = {
    centerErrorMm: distance(actual.bridgeCenter, overlay.bridgeCenter) * mmPerPixel,
    frameWidthErrorPct: ((distance(overlay.frameLeft, overlay.frameRight) - actualWidthPx) / actualWidthPx) * 100,
    leftLensCenterErrorMm: distance(actual.leftLensCenter, overlay.leftLensCenter) * mmPerPixel,
    rightLensCenterErrorMm: distance(actual.rightLensCenter, overlay.rightLensCenter) * mmPerPixel,
    yawAttachmentErrorMm,
    rollErrorDeg: normalizeAngleDeg(angle(overlay.frameLeft, overlay.frameRight) - angle(actual.frameLeft, actual.frameRight)),
  };
  const samples = fixture.temporalTrace.samples;
  const visible = samples.filter((s): s is TemporalTraceSample & { overlayPositionMm: Point; overlayRotationDeg: number } => s.trackingVisible && s.overlayPositionMm !== null && s.overlayRotationDeg !== null);
  if (!visible.length) throw new RangeError("temporal trace requires visible overlay samples");
  const positionResiduals = visible.map((s) => ({ x: s.overlayPositionMm.x - s.targetPositionMm.x, y: s.overlayPositionMm.y - s.targetPositionMm.y }));
  const meanX = positionResiduals.reduce((sum, p) => sum + p.x, 0) / positionResiduals.length;
  const meanY = positionResiduals.reduce((sum, p) => sum + p.y, 0) / positionResiduals.length;
  const positionJitter = positionResiduals.map((p) => Math.hypot(p.x - meanX, p.y - meanY));
  const rotationResiduals = visible.map((s) => normalizeAngleDeg(s.overlayRotationDeg - s.targetRotationDeg));
  const meanRotation = Math.atan2(
    rotationResiduals.reduce((sum, value) => sum + Math.sin(value * Math.PI / 180), 0),
    rotationResiduals.reduce((sum, value) => sum + Math.cos(value * Math.PI / 180), 0),
  ) * 180 / Math.PI;
  const rotationJitter = rotationResiduals.map((value) => normalizeAngleDeg(value - meanRotation));
  const base = samples[0]!;
  const targetMotion = samples.find((s) => distance(s.targetPositionMm, base.targetPositionMm) > 0.5 || Math.abs(normalizeAngleDeg(s.targetRotationDeg - base.targetRotationDeg)) > 0.5);
  const overlayBase = base.overlayPositionMm;
  const overlayMotion = targetMotion && overlayBase ? samples.find((s) => s.timestampMs >= targetMotion.timestampMs && s.overlayPositionMm !== null && distance(s.overlayPositionMm, overlayBase) > 0.5) : undefined;
  let reacquireJumpMm = 0; let lostLatencyMs = 0; let lostAt: number | null = null;
  let observedLossAndHide = false; let observedReacquisition = false;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!; const previous = i ? samples[i - 1]! : null;
    if (!sample.facePresent && lostAt === null) lostAt = sample.timestampMs;
    if (lostAt !== null && !sample.trackingVisible) { lostLatencyMs = Math.max(lostLatencyMs, sample.timestampMs - lostAt); lostAt = null; observedLossAndHide = true; }
    if (previous && !previous.trackingVisible && sample.facePresent && sample.trackingVisible && sample.overlayPositionMm) { reacquireJumpMm = Math.max(reacquireJumpMm, distance(sample.targetPositionMm, sample.overlayPositionMm)); observedReacquisition = true; }
  }
  if (lostAt !== null) lostLatencyMs = Number.POSITIVE_INFINITY;
  const temporal = {
    positionJitterRmsMm: rms(positionJitter), rotationJitterRmsDeg: rms(rotationJitter),
    motionLagMs: targetMotion ? (overlayMotion ? overlayMotion.timestampMs - targetMotion.timestampMs : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY,
    reacquireJumpMm, lostLatencyMs,
    coverage: { observedMotion: Boolean(targetMotion && overlayMotion), observedLossAndHide, observedReacquisition },
  };
  return { placement, temporal };
}

const REQUIRED_OPERATIONAL_FLAGS = ["backgroundForeground", "permissionRetry", "networkLossAfterLoad", "assetFailure", "lowLight", "rapidHeadMotion"] as const;
function emptyCoverage(): CoverageReport { return { requiredCells: [], presentCells: [], missingCells: [], duplicateCells: [], requiredDeviceClasses: DEVICE_CLASSES, presentDeviceClasses: [], missingDeviceClasses: [...DEVICE_CLASSES], duplicateDeviceClasses: [], missingMetricViews: [] }; }

export function evaluateGroundTruthEvidence(input: unknown): GroundTruthEvaluation {
  const parsed = parseGroundTruthEvidence(input); const profile = parsed.evidence?.profile ?? null;
  const gate = profile === "canonical-validation" ? "G1_CANONICAL_VALIDATION" : "TECHNICAL_SINGLE_FRAME_SLICE_READINESS";
  if (!parsed.evidence) return { schemaVersion: 1, gate, profile, metricPass: false, gateReady: false, canonicalPromotionReady: false, issues: parsed.issues, missingEvidence: parsed.issues, fixtureReports: [], coverage: emptyCoverage() };
  const evidence = parsed.evidence; const issues: EvidenceIssue[] = [...parsed.issues]; const reports: FixtureMetricReport[] = [];
  for (const fixture of evidence.fixtures) {
    const violations: EvidenceIssue[] = [];
    try {
      const metrics = deriveEvidenceMetrics(fixture); const p = metrics.placement; const t = metrics.temporal;
      const checks: [boolean, string, string][] = [
        [p.centerErrorMm <= 3, "center_error", "center error must be <= 3 mm"], [Math.abs(p.frameWidthErrorPct) <= 5, "frame_width", "absolute frame width error must be <= 5%"],
        [p.leftLensCenterErrorMm <= 3 && p.rightLensCenterErrorMm <= 3, "lens_center", "each lens center error must be <= 3 mm"], [Math.abs(p.rollErrorDeg) <= 3, "roll", "absolute roll error must be <= 3 degrees"],
        [p.yawAttachmentErrorMm === null || p.yawAttachmentErrorMm <= 3, "yaw_attachment", "yaw attachment error must be <= 3 mm"], [t.positionJitterRmsMm <= 0.75, "position_jitter", "position jitter RMS must be <= 0.75 mm"],
        [t.rotationJitterRmsDeg <= 2, "rotation_jitter", "rotation jitter RMS must be <= 2 degrees"], [t.motionLagMs <= 150, "motion_lag", "motion lag must be <= 150 ms"], [t.reacquireJumpMm <= 3, "reacquire_jump", "reacquire jump must be <= 3 mm"], [t.lostLatencyMs <= 250, "lost_latency", "lost latency must be <= 250 ms"],
        [t.coverage.observedMotion, "motion_coverage", "trace must observe target and overlay motion"], [t.coverage.observedLossAndHide, "loss_coverage", "trace must observe face loss followed by hidden tracking"], [t.coverage.observedReacquisition, "reacquire_coverage", "trace must observe reacquisition after hidden tracking"],
      ];
      for (const [ok, code, message] of checks) if (!ok) violations.push({ code: `metric_${code}`, path: `fixture:${fixture.fixtureId}`, message });
      reports.push({ fixtureId: fixture.fixtureId, cell: `${fixture.subjectId}|${fixture.frameModelId}|${fixture.image.expectedView}`, placement: metrics.placement, temporal: metrics.temporal, pass: !violations.length, violations });
    } catch (error) { violations.push({ code: "metric_derivation_failed", path: `fixture:${fixture.fixtureId}`, message: error instanceof Error ? error.message : String(error) }); reports.push({ fixtureId: fixture.fixtureId, cell: `${fixture.subjectId}|${fixture.frameModelId}|${fixture.image.expectedView}`, placement: { centerErrorMm: Infinity, frameWidthErrorPct: Infinity, leftLensCenterErrorMm: Infinity, rightLensCenterErrorMm: Infinity, yawAttachmentErrorMm: null, rollErrorDeg: Infinity }, temporal: { positionJitterRmsMm: Infinity, rotationJitterRmsDeg: Infinity, motionLagMs: Infinity, reacquireJumpMm: Infinity, lostLatencyMs: Infinity, coverage: { observedMotion: false, observedLossAndHide: false, observedReacquisition: false } }, pass: false, violations }); }
    issues.push(...violations);
    if (!["approve", "approve-with-envelope-limit"].includes(fixture.visualReview.result)) issues.push({ code: "visual_review_failed", path: `fixture:${fixture.fixtureId}.visualReview.result`, message: "visual review is not approved" });
  }
  const subjects = [...new Set(evidence.fixtures.map((f) => f.subjectId))].sort(); const frames = [...new Set(evidence.fixtures.map((f) => f.frameModelId))].sort();
  const tenants = new Set(evidence.fixtures.map((fixture) => fixture.tenantId));
  if (tenants.size > 1) issues.push({ code: "inconsistent_tenant", path: "$.fixtures", message: "all fixtures in an evidence document must use one tenantId" });
  const artifactOwners = new Map<string, string>();
  for (const fixture of evidence.fixtures) {
    const cell = `${fixture.subjectId}|${fixture.frameModelId}|${fixture.image.expectedView}`;
    for (const [kind, hash] of [["capture", fixture.hashes.captureSha256], ["render", fixture.hashes.renderSha256], ["trace", fixture.temporalTrace.traceSha256]] as const) {
      const key = `${kind}:${hash}`; const owner = artifactOwners.get(key);
      if (owner && owner !== cell) issues.push({ code: "reused_cell_artifact", path: `fixture:${fixture.fixtureId}.${kind}`, message: `${kind} hash is already bound to coverage cell ${owner}` });
      artifactOwners.set(key, cell);
    }
  }
  const frameBindings = new Map<string, string>(); const modelHashOwners = new Map<string, string>(); const assetHashOwners = new Map<string, string>(); const manifestHashOwners = new Map<string, string>();
  for (const fixture of evidence.fixtures) {
    const signature = JSON.stringify([fixture.variantId, fixture.assetVersionId, fixture.assetVersion, fixture.hashes.assetSha256, fixture.hashes.manifestSha256, fixture.hashes.modelSha256, fixture.actualFrameWidthMm]);
    const previous = frameBindings.get(fixture.frameModelId); if (previous && previous !== signature) issues.push({ code: "inconsistent_frame_binding", path: `fixture:${fixture.fixtureId}`, message: "frameModelId must map to one variant/AssetVersion/hash/width binding" }); frameBindings.set(fixture.frameModelId, signature);
    for (const [owners, hash, code] of [[modelHashOwners, fixture.hashes.modelSha256, "shared_model_hash"], [assetHashOwners, fixture.hashes.assetSha256, "shared_asset_hash"], [manifestHashOwners, fixture.hashes.manifestSha256, "shared_manifest_hash"]] as const) {
      const owner = owners.get(hash); if (owner && owner !== fixture.frameModelId) issues.push({ code, path: `fixture:${fixture.fixtureId}`, message: `artifact hash is already bound to frameModelId ${owner}` }); owners.set(hash, fixture.frameModelId);
    }
  }
  const subjectConsents = new Map<string, string>(); const consentSubjects = new Map<string, string>();
  for (const fixture of evidence.fixtures) {
    const knownConsent = subjectConsents.get(fixture.subjectId); if (knownConsent && knownConsent !== fixture.consent.reference) issues.push({ code: "inconsistent_subject_consent", path: `fixture:${fixture.fixtureId}.consent.reference`, message: "subjectId must map to one consent reference" }); subjectConsents.set(fixture.subjectId, fixture.consent.reference);
    const knownSubject = consentSubjects.get(fixture.consent.reference); if (knownSubject && knownSubject !== fixture.subjectId) issues.push({ code: "shared_consent_reference", path: `fixture:${fixture.fixtureId}.consent.reference`, message: `consent reference is already bound to subjectId ${knownSubject}` }); consentSubjects.set(fixture.consent.reference, fixture.subjectId);
  }
  const requiredCells = evidence.profile === "canonical-validation" && subjects.length === 3 && frames.length === 5 ? subjects.flatMap((subject) => frames.flatMap((frame) => VIEW_ANGLES.map((view) => `${subject}|${frame}|${view}`))) : evidence.profile === "technical-single-frame-slice" && evidence.fixtures[0] ? [`${evidence.fixtures[0].subjectId}|${evidence.fixtures[0].frameModelId}|${evidence.fixtures[0].image.expectedView}`] : [];
  if (evidence.profile === "canonical-validation" && (subjects.length !== 3 || frames.length !== 5)) issues.push({ code: "canonical_dimensions", path: "$.fixtures", message: "canonical validation requires exactly 3 subjects and 5 frame models" });
  const counts = new Map<string, number>(); reports.forEach((r) => counts.set(r.cell, (counts.get(r.cell) ?? 0) + 1));
  const presentCells = [...counts.keys()].sort(); const missingCells = requiredCells.filter((cell) => !counts.has(cell)); const duplicateCells = [...counts].filter(([, count]) => count > 1).map(([cell]) => cell).sort();
  const deviceCounts = new Map<DeviceClass, number>(); evidence.deviceRuns.forEach((run) => deviceCounts.set(run.deviceClass, (deviceCounts.get(run.deviceClass) ?? 0) + 1));
  const presentDeviceClasses = [...deviceCounts.keys()]; const missingDeviceClasses = DEVICE_CLASSES.filter((d) => !deviceCounts.has(d)); const duplicateDeviceClasses = [...deviceCounts].filter(([, count]) => count > 1).map(([device]) => device);
  const presentViews = new Set(evidence.fixtures.map((f) => f.image.expectedView)); const missingMetricViews = VIEW_ANGLES.filter((view) => !presentViews.has(view)).map((view) => `${view}:${view === "front" ? "center,width,lens-center,roll" : "center,width,lens-center,roll,yaw-attachment"}`);
  const coverage = { requiredCells, presentCells, missingCells, duplicateCells, requiredDeviceClasses: DEVICE_CLASSES, presentDeviceClasses, missingDeviceClasses, duplicateDeviceClasses, missingMetricViews };
  if (evidence.profile === "canonical-validation" && requiredCells.length !== 45) issues.push({ code: "canonical_cell_count", path: "$.fixtures", message: "canonical validation requires exactly 45 Cartesian cells" });
  if (missingCells.length) issues.push({ code: "missing_cells", path: "$.fixtures", message: `${missingCells.length} required coverage cells are missing` });
  if (duplicateCells.length) issues.push({ code: "duplicate_cells", path: "$.fixtures", message: `${duplicateCells.length} coverage cells are duplicated` });
  if (evidence.profile === "canonical-validation" && missingDeviceClasses.length) issues.push({ code: "missing_devices", path: "$.deviceRuns", message: `missing device classes: ${missingDeviceClasses.join(", ")}` });
  if (duplicateDeviceClasses.length) issues.push({ code: "duplicate_device_classes", path: "$.deviceRuns", message: `duplicate device classes: ${duplicateDeviceClasses.join(", ")}` });
  if (evidence.profile === "canonical-validation" && missingMetricViews.length) issues.push({ code: "missing_view_metrics", path: "$.fixtures", message: `missing metric views: ${missingMetricViews.join(", ")}` });
  for (const [index, run] of evidence.deviceRuns.entries()) {
    if (run.durationMs < 600_000) issues.push({ code: "insufficient_duration", path: `$.deviceRuns[${index}].durationMs`, message: "canonical sustained run must be at least 10 minutes" });
    if (run.renderFps < 24 || run.detectionFps < 15) issues.push({ code: "performance_failed", path: `$.deviceRuns[${index}]`, message: "sustained render FPS must be >= 24 and detection FPS must be >= 15" });
    const expectedFrames = run.renderFps * run.durationMs / 1000;
    if (Math.abs(run.frameCount - expectedFrames) / expectedFrames > 0.1) issues.push({ code: "impossible_frame_count", path: `$.deviceRuns[${index}].frameCount`, message: "frameCount must be within 10% of renderFps * duration" });
    if (run.thermal === "hot" || run.thermal === "throttled") issues.push({ code: "thermal_failed", path: `$.deviceRuns[${index}].thermal`, message: "thermal state must be nominal or warm" });
    for (const [checkpointIndex, checkpoint] of run.checkpoints.entries()) {
      if (checkpoint.renderFps < 24 || checkpoint.detectionFps < 15) issues.push({ code: "performance_failed", path: `$.deviceRuns[${index}].checkpoints[${checkpointIndex}]`, message: "checkpoint render FPS must be >= 24 and detection FPS >= 15" });
      const checkpointFrames = checkpoint.renderFps * checkpoint.durationMs / 1000;
      if (Math.abs(checkpoint.frameCount - checkpointFrames) / checkpointFrames > 0.1) issues.push({ code: "impossible_frame_count", path: `$.deviceRuns[${index}].checkpoints[${checkpointIndex}].frameCount`, message: "checkpoint frameCount must be within 10% of renderFps * duration" });
      if (checkpoint.thermal === "hot" || checkpoint.thermal === "throttled") issues.push({ code: "thermal_failed", path: `$.deviceRuns[${index}].checkpoints[${checkpointIndex}].thermal`, message: "checkpoint thermal state must be nominal or warm" });
    }
    for (const flag of REQUIRED_OPERATIONAL_FLAGS) if (!run[flag]) issues.push({ code: "operational_evidence_missing", path: `$.deviceRuns[${index}].${flag}`, message: "required operational scenario was not evidenced" });
  }
  const metricPass = reports.length > 0 && reports.every((report) => report.pass);
  const gateReady = metricPass && issues.length === 0 && (evidence.profile === "canonical-validation" ? requiredCells.length === 45 && evidence.deviceRuns.length === DEVICE_CLASSES.length : evidence.fixtures.length === 1);
  const missingEvidence = issues.filter((issue) => !issue.code.startsWith("metric_") && issue.code !== "visual_review_failed");
  return { schemaVersion: 1, gate, profile: evidence.profile, metricPass, gateReady, canonicalPromotionReady: evidence.profile === "canonical-validation" && gateReady, issues, missingEvidence, fixtureReports: reports, coverage };
}
