import { validateGlb, type Vector3 } from "../../assets/src/index.js";
import type { SourcePixelGeometry } from "../../contracts/src/index.js";

type Point2 = readonly [number, number];
type LensProfile = { outer: readonly Point2[]; inner: readonly Point2[] };
type PixelRegion = { x: number; y: number; width: number; height: number };
export type ManualTraceProfileEvidenceBody = {
  sourceSha256: string;
  sourcePixelGeometry: SourcePixelGeometry;
  regionPx: PixelRegion;
  coordinateRules: { originPx: Point2; millimetresPerPixel: number; xAxis: "right"; yAxis: "up" };
  tracePx: {
    leftLens: { outer: readonly Point2[]; inner: readonly Point2[] };
    rightLens: { outer: readonly Point2[]; inner: readonly Point2[] };
    bridgeAnchors: { left: Point2; right: Point2 };
    hingeAnchors: { left: Point2; right: Point2 };
  };
};

export type ProxyAuthoringEvidence = {
  schemaVersion: 1;
  measurementEvidenceSha256: string;
  thickness:
    | { kind: "evidenced"; sourceSha256: string; sourcePixelGeometry?: SourcePixelGeometry; valueMm: number; method: "annotated-image" | "marking"; verification: "unverified"; rawLabel: string; regionPx?: { x: number; y: number; width: number; height: number } }
    | { kind: "non-physical-proxy-assumption"; valueMm: number; reason: string; boundsMm: { min: number; max: number }; limitations: readonly string[] };
  profile:
    | { method: "dimension-template"; evidenceSha256: string; body: { templateId: string; templateVersion: number }; limitations: readonly string[]; contourFidelity: false }
    | { method: "manual-image-trace"; evidenceSha256: string; body: ManualTraceProfileEvidenceBody; limitations: readonly string[]; contourFidelity: false };
};

export type ProxyGeneratorInput = {
  schemaVersion: 1;
  candidate: {
    tenantId: string;
    frameModelId: string;
    frameVariantId: string;
    assetId: string;
    assetVersion: number;
  };
  sourceAssetHashes: readonly string[];
  measurementSet: {
    sha256: string;
    version: number;
    dimensionsMm: {
      lensWidth: number;
      bridgeWidth: number;
      templeLength: number;
      frameWidth: number;
      lensHeight: number;
      frameThickness: number;
    };
  };
  generator: { id: string; version: string; configSha256: string };
  /** Optional on legacy v1 inputs; bridge-authored inputs always carry strict durable provenance. */
  authoringEvidence?: ProxyAuthoringEvidence;
  profile: {
    kind: "explicit-manual-2d";
    coordinateUnit: "millimetre";
    leftLens: LensProfile;
    rightLens: LensProfile;
    bridgeAnchors: { left: Point2; right: Point2 };
    hingeAnchors: { left: Point2; right: Point2 };
  };
};

export const PROXY_REQUIRED_NODES = [
  "FRAME_ROOT", "RIMS_FRONT", "BRIDGE", "TEMPLE_LEFT", "TEMPLE_RIGHT",
  "NOSE_ANCHOR", "LENS_LEFT", "LENS_RIGHT", "HINGE_LEFT", "HINGE_RIGHT",
] as const;

export const PROXY_LIMITATIONS = [
  "Visibly synthetic explicit-profile/parametric Proxy; no image contour extraction was performed.",
  "Not a product asset and not evidence of contour fidelity, physical fit, or physical approval.",
  "Calibration-only draft; human review, physical measurement, QA, approval, and publication workflows are still required.",
] as const;

/** Float32 serialization allowance: 0.051 mm in metre-space comparisons. */
export const PROXY_BOUND_TOLERANCE_METRES = 0.000051;

export type ProxyBundleManifest = {
  schemaVersion: 1;
  assetId: string;
  assetVersion: number;
  fixture: true;
  generator: { name: string; version: string };
  model: {
    url: string;
    sha256: string;
    byteLength: number;
    format: "glb";
    unit: "metre";
    boundsMetres: { min: Vector3; max: Vector3 };
    requiredNodes: readonly string[];
  };
  sourceAssetHashes: readonly string[];
  proxyGeneration: {
    schemaVersion: 1;
    candidate: ProxyGeneratorInput["candidate"];
    canonicalInputSha256: string;
    measurementDigest: string;
    sourceAssetHashes: readonly string[];
    generator: { id: string; version: string; configSha256: string };
    outputGlb: { sha256: string; byteLength: number };
    actualBoundsMetres: { min: Vector3; max: Vector3 };
    requiredNodes: readonly string[];
    limitations: readonly string[];
    authoringEvidence?: ProxyAuthoringEvidence;
    status: "draft";
    quality: "proxy";
    recommendedForLive: false;
    admission: "calibration-only";
    g1: "active-not-ready";
    g2: "preparation-only-not-active-not-pass";
  };
};

export type GeneratedProxyBundle = {
  canonicalInput: string;
  canonicalInputSha256: string;
  glbFileName: string;
  manifestFileName: string;
  glb: Uint8Array;
  manifest: ProxyBundleManifest;
  manifestJson: string;
  manifestSha256: string;
};

const HASH = /^[a-f0-9]{64}$/;
const INPUT_KEYS = new Set(["schemaVersion", "candidate", "sourceAssetHashes", "measurementSet", "generator", "authoringEvidence", "profile"]);

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
  for (const key of allowed) if (!(key in value)) throw new TypeError(`${path}.${key} is required`);
}

function requireKeys(value: Record<string, unknown>, required: readonly string[], path: string): void {
  for (const key of required) if (!(key in value)) throw new TypeError(`${path}.${key} is required`);
}

function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128 || value !== value.trim()) {
    throw new TypeError(`${path} must be a trimmed non-blank string of at most 128 characters`);
  }
}

function hash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
}

function boundedText(value: unknown, path: string, maximum = 512): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${path} must be bounded trimmed text without control characters`);
  }
}

function numericTokenMatches(rawLabel: string, valueMm: number, path: string): void {
  const tokens = rawLabel.match(/(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/g) ?? [];
  if (!tokens.some((token) => Number(token) === valueMm)) throw new TypeError(`${path} must contain an ASCII numeric token equal to valueMm`);
}

function evidenceRegion(value: unknown, path: string): asserts value is PixelRegion {
  object(value, path); exactKeys(value, ["x", "y", "width", "height"], path);
  for (const key of ["x", "y"] as const) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) throw new TypeError(`${path}.${key} must be a non-negative integer`);
  for (const key of ["width", "height"] as const) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) throw new TypeError(`${path}.${key} must be a positive integer`);
  if (!Number.isSafeInteger((value.x as number) + (value.width as number)) || !Number.isSafeInteger((value.y as number) + (value.height as number))) throw new TypeError(`${path} half-open endpoints must be safe integers`);
}

function sourcePixelGeometry(value: unknown, path: string): asserts value is SourcePixelGeometry {
  object(value, path);
  exactKeys(value, ["coordinateSpace", "regionConvention", "encodedWidthPx", "encodedHeightPx", "exifOrientation", "displayWidthPx", "displayHeightPx", "regionAuthoring"], path);
  if (value.coordinateSpace !== "raw-encoded-pixels" || value.regionConvention !== "half-open-integer") throw new TypeError(`${path} must declare raw encoded half-open integer coordinates`);
  for (const key of ["encodedWidthPx", "encodedHeightPx", "displayWidthPx", "displayHeightPx"] as const) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) throw new TypeError(`${path}.${key} must be a positive integer`);
  if (!Number.isSafeInteger(value.exifOrientation) || (value.exifOrientation as number) < 1 || (value.exifOrientation as number) > 8) throw new TypeError(`${path}.exifOrientation must be an integer from 1 through 8`);
  const swapsAxes = (value.exifOrientation as number) >= 5;
  if (value.displayWidthPx !== (swapsAxes ? value.encodedHeightPx : value.encodedWidthPx) || value.displayHeightPx !== (swapsAxes ? value.encodedWidthPx : value.encodedHeightPx)) throw new TypeError(`${path} display geometry must be derived from encoded dimensions and orientation`);
  const expected = value.exifOrientation === 1 ? "allowed" : "requires-orientation-normalized-derived-source";
  if (value.regionAuthoring !== expected) throw new TypeError(`${path}.regionAuthoring must fail closed according to orientation`);
}

function regionFitsGeometry(region: PixelRegion, geometry: SourcePixelGeometry, path: string): void {
  if (geometry.regionAuthoring !== "allowed") throw new TypeError(`${path} requires an orientation-1 source or separately hashed orientation-normalized derived source`);
  if (region.x + region.width > geometry.encodedWidthPx || region.y + region.height > geometry.encodedHeightPx) throw new TypeError(`${path} exceeds source encoded dimensions`);
}

function pixelPoint(value: unknown, path: string, region?: PixelRegion): asserts value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${path} must be an [x, y] point`);
  for (const [index, coordinate] of value.entries()) if (!Number.isSafeInteger(coordinate) || coordinate < 0) throw new TypeError(`${path}.${index} must be a non-negative integer`);
  if (region && (value[0] < region.x || value[0] >= region.x + region.width || value[1] < region.y || value[1] >= region.y + region.height)) throw new TypeError(`${path} must fall inside the half-open profile region`);
}

function limitations(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) throw new TypeError(`${path} must contain 1 to 8 limitations`);
  value.forEach((item, index) => boundedText(item, `${path}.${index}`));
}

function parseAuthoringEvidence(value: unknown, frameThickness: number, measurementSha256: string, sourceHashes: readonly string[]): ProxyAuthoringEvidence {
  object(value, "input.authoringEvidence"); exactKeys(value, ["schemaVersion", "measurementEvidenceSha256", "thickness", "profile"], "input.authoringEvidence");
  if (value.schemaVersion !== 1) throw new TypeError("input.authoringEvidence.schemaVersion must equal 1");
  hash(value.measurementEvidenceSha256, "input.authoringEvidence.measurementEvidenceSha256");
  if (value.measurementEvidenceSha256 !== measurementSha256) throw new TypeError("input.authoringEvidence measurement digest must match measurementSet.sha256");
  object(value.thickness, "input.authoringEvidence.thickness");
  if (value.thickness.kind === "evidenced") {
    const allowed = ["kind", "sourceSha256", "valueMm", "method", "verification", "rawLabel", ...(value.thickness.sourcePixelGeometry === undefined ? [] : ["sourcePixelGeometry"]), ...(value.thickness.regionPx === undefined ? [] : ["regionPx"])] as string[];
    exactKeys(value.thickness, allowed, "input.authoringEvidence.thickness");
    hash(value.thickness.sourceSha256, "input.authoringEvidence.thickness.sourceSha256");
    if (!sourceHashes.includes(value.thickness.sourceSha256 as string)) throw new TypeError("input.authoringEvidence thickness source must belong to sourceAssetHashes");
    bounded(value.thickness.valueMm, 1, 12, "input.authoringEvidence.thickness.valueMm");
    if (value.thickness.valueMm !== frameThickness) throw new TypeError("input.authoringEvidence thickness must match measurement dimensions");
    if (value.thickness.method !== "annotated-image" && value.thickness.method !== "marking") throw new TypeError("input.authoringEvidence evidenced thickness method is unsupported");
    if (value.thickness.verification !== "unverified") throw new TypeError("input.authoringEvidence evidenced thickness cannot assert verification");
    boundedText(value.thickness.rawLabel, "input.authoringEvidence.thickness.rawLabel");
    numericTokenMatches(value.thickness.rawLabel, value.thickness.valueMm, "input.authoringEvidence.thickness.rawLabel");
    if (value.thickness.sourcePixelGeometry !== undefined) sourcePixelGeometry(value.thickness.sourcePixelGeometry, "input.authoringEvidence.thickness.sourcePixelGeometry");
    if (value.thickness.regionPx !== undefined) {
      evidenceRegion(value.thickness.regionPx, "input.authoringEvidence.thickness.regionPx");
      if (value.thickness.sourcePixelGeometry === undefined) throw new TypeError("input.authoringEvidence.thickness.regionPx requires sourcePixelGeometry");
      regionFitsGeometry(value.thickness.regionPx, value.thickness.sourcePixelGeometry as SourcePixelGeometry, "input.authoringEvidence.thickness.regionPx");
    }
  } else if (value.thickness.kind === "non-physical-proxy-assumption") {
    exactKeys(value.thickness, ["kind", "valueMm", "reason", "boundsMm", "limitations"], "input.authoringEvidence.thickness");
    bounded(value.thickness.valueMm, 1, 12, "input.authoringEvidence.thickness.valueMm");
    if (value.thickness.valueMm !== frameThickness) throw new TypeError("input.authoringEvidence thickness must match measurement dimensions");
    boundedText(value.thickness.reason, "input.authoringEvidence.thickness.reason");
    object(value.thickness.boundsMm, "input.authoringEvidence.thickness.boundsMm"); exactKeys(value.thickness.boundsMm, ["min", "max"], "input.authoringEvidence.thickness.boundsMm");
    bounded(value.thickness.boundsMm.min, 1, 12, "input.authoringEvidence.thickness.boundsMm.min"); bounded(value.thickness.boundsMm.max, 1, 12, "input.authoringEvidence.thickness.boundsMm.max");
    if ((value.thickness.boundsMm.min as number) >= (value.thickness.boundsMm.max as number) || (value.thickness.valueMm as number) < (value.thickness.boundsMm.min as number) || (value.thickness.valueMm as number) > (value.thickness.boundsMm.max as number)) throw new TypeError("input.authoringEvidence assumption bounds must contain thickness");
    limitations(value.thickness.limitations, "input.authoringEvidence.thickness.limitations");
  } else throw new TypeError("input.authoringEvidence.thickness.kind is unsupported");
  object(value.profile, "input.authoringEvidence.profile"); exactKeys(value.profile, ["method", "evidenceSha256", "body", "limitations", "contourFidelity"], "input.authoringEvidence.profile");
  if (value.profile.method !== "dimension-template" && value.profile.method !== "manual-image-trace") throw new TypeError("input.authoringEvidence.profile.method is unsupported");
  hash(value.profile.evidenceSha256, "input.authoringEvidence.profile.evidenceSha256");
  object(value.profile.body, "input.authoringEvidence.profile.body");
  if (value.profile.method === "dimension-template") {
    exactKeys(value.profile.body, ["templateId", "templateVersion"], "input.authoringEvidence.profile.body");
    text(value.profile.body.templateId, "input.authoringEvidence.profile.body.templateId");
    if (!Number.isSafeInteger(value.profile.body.templateVersion) || (value.profile.body.templateVersion as number) < 1) throw new TypeError("input.authoringEvidence.profile.body.templateVersion must be a positive integer");
  } else {
    exactKeys(value.profile.body, ["sourceSha256", "sourcePixelGeometry", "regionPx", "coordinateRules", "tracePx"], "input.authoringEvidence.profile.body");
    hash(value.profile.body.sourceSha256, "input.authoringEvidence.profile.body.sourceSha256");
    if (!sourceHashes.includes(value.profile.body.sourceSha256 as string)) throw new TypeError("input.authoringEvidence profile source must belong to sourceAssetHashes");
    sourcePixelGeometry(value.profile.body.sourcePixelGeometry, "input.authoringEvidence.profile.body.sourcePixelGeometry");
    evidenceRegion(value.profile.body.regionPx, "input.authoringEvidence.profile.body.regionPx");
    regionFitsGeometry(value.profile.body.regionPx, value.profile.body.sourcePixelGeometry as SourcePixelGeometry, "input.authoringEvidence.profile.body.regionPx");
    const traceRegion = value.profile.body.regionPx;
    object(value.profile.body.coordinateRules, "input.authoringEvidence.profile.body.coordinateRules"); exactKeys(value.profile.body.coordinateRules, ["originPx", "millimetresPerPixel", "xAxis", "yAxis"], "input.authoringEvidence.profile.body.coordinateRules");
    pixelPoint(value.profile.body.coordinateRules.originPx, "input.authoringEvidence.profile.body.coordinateRules.originPx", traceRegion);
    bounded(value.profile.body.coordinateRules.millimetresPerPixel, 0.001, 10, "input.authoringEvidence.profile.body.coordinateRules.millimetresPerPixel");
    if (value.profile.body.coordinateRules.xAxis !== "right" || value.profile.body.coordinateRules.yAxis !== "up") throw new TypeError("input.authoringEvidence profile coordinate axes must be right/up");
    object(value.profile.body.tracePx, "input.authoringEvidence.profile.body.tracePx"); exactKeys(value.profile.body.tracePx, ["leftLens", "rightLens", "bridgeAnchors", "hingeAnchors"], "input.authoringEvidence.profile.body.tracePx");
    for (const lensName of ["leftLens", "rightLens"] as const) {
      const lensValue = value.profile.body.tracePx[lensName]; object(lensValue, `input.authoringEvidence.profile.body.tracePx.${lensName}`); exactKeys(lensValue, ["outer", "inner"], `input.authoringEvidence.profile.body.tracePx.${lensName}`);
      for (const polygonName of ["outer", "inner"] as const) {
        const polygonValue = lensValue[polygonName]; if (!Array.isArray(polygonValue)) throw new TypeError(`input.authoringEvidence.profile.body.tracePx.${lensName}.${polygonName} must be an array`);
        polygonValue.forEach((candidate, index) => pixelPoint(candidate, `input.authoringEvidence.profile.body.tracePx.${lensName}.${polygonName}.${index}`, traceRegion));
      }
    }
    for (const anchorName of ["bridgeAnchors", "hingeAnchors"] as const) {
      const anchors = value.profile.body.tracePx[anchorName]; object(anchors, `input.authoringEvidence.profile.body.tracePx.${anchorName}`); exactKeys(anchors, ["left", "right"], `input.authoringEvidence.profile.body.tracePx.${anchorName}`);
      for (const side of ["left", "right"] as const) pixelPoint(anchors[side], `input.authoringEvidence.profile.body.tracePx.${anchorName}.${side}`, traceRegion);
    }
  }
  limitations(value.profile.limitations, "input.authoringEvidence.profile.limitations");
  if (value.profile.contourFidelity !== false) throw new TypeError("input.authoringEvidence.profile.contourFidelity must remain false");
  return structuredClone(value) as unknown as ProxyAuthoringEvidence;
}

function bounded(value: unknown, min: number, max: number, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${path} must be a finite number between ${min} and ${max}`);
  }
}

function point(value: unknown, path: string): asserts value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${path} must be an [x, y] point`);
  bounded(value[0], -300, 300, `${path}.0`);
  bounded(value[1], -300, 300, `${path}.1`);
}

function area(polygon: readonly Point2[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point2, b: Point2, p: Point2): boolean {
  return Math.abs(orientation(a, b, p)) < 1e-9 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function intersects(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c); const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a); const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function assertSimple(polygon: readonly Point2[], path: string): void {
  for (let a = 0; a < polygon.length; a += 1) {
    const aNext = (a + 1) % polygon.length;
    if (polygon[a]![0] === polygon[aNext]![0] && polygon[a]![1] === polygon[aNext]![1]) throw new TypeError(`${path} contains a degenerate edge`);
    for (let b = a + 1; b < polygon.length; b += 1) {
      const bNext = (b + 1) % polygon.length;
      if (a === b || aNext === b || bNext === a) continue;
      if (intersects(polygon[a]!, polygon[aNext]!, polygon[b]!, polygon[bNext]!)) throw new TypeError(`${path} must not self-intersect`);
    }
  }
}

function inside(pointValue: Point2, polygon: readonly Point2[]): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (onSegment(polygon[index]!, polygon[(index + 1) % polygon.length]!, pointValue)) return false;
  }
  let result = false;
  for (let first = 0, previous = polygon.length - 1; first < polygon.length; previous = first++) {
    const a = polygon[first]!; const b = polygon[previous]!;
    if ((a[1] > pointValue[1]) !== (b[1] > pointValue[1]) && pointValue[0] < (b[0] - a[0]) * (pointValue[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

function samePoint(left: Point2, right: Point2): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function correspondingInnerIndex(pointCount: number, outerIndex: number): number {
  return (pointCount - outerIndex) % pointCount;
}

function assertConnectorBoundary(
  start: Point2,
  end: Point2,
  polygonValue: readonly Point2[],
  allowedVertexIndex: number,
  path: string,
): void {
  for (let edgeIndex = 0; edgeIndex < polygonValue.length; edgeIndex += 1) {
    const edgeStart = polygonValue[edgeIndex]!;
    const edgeEnd = polygonValue[(edgeIndex + 1) % polygonValue.length]!;
    const incident = edgeIndex === allowedVertexIndex || (edgeIndex + 1) % polygonValue.length === allowedVertexIndex;
    if (!intersects(start, end, edgeStart, edgeEnd)) continue;
    if (!incident) throw new TypeError(`${path} connector crosses a lens boundary`);
    const other = samePoint(edgeStart, polygonValue[allowedVertexIndex]!) ? edgeEnd : edgeStart;
    if (onSegment(start, end, other)) throw new TypeError(`${path} connector overlaps a lens boundary`);
  }
}

function assertRimCorrespondence(lensValue: LensProfile, path: string): void {
  const connectors: Array<readonly [Point2, Point2]> = [];
  for (let outerIndex = 0; outerIndex < lensValue.outer.length; outerIndex += 1) {
    const innerIndex = correspondingInnerIndex(lensValue.inner.length, outerIndex);
    const outerPoint = lensValue.outer[outerIndex]!;
    const innerPoint = lensValue.inner[innerIndex]!;
    const midpoint: Point2 = [(outerPoint[0] + innerPoint[0]) / 2, (outerPoint[1] + innerPoint[1]) / 2];
    if (!inside(midpoint, lensValue.outer) || inside(midpoint, lensValue.inner)) {
      throw new TypeError(`${path} point ordering does not define connectors inside the rim region`);
    }
    assertConnectorBoundary(outerPoint, innerPoint, lensValue.outer, outerIndex, path);
    assertConnectorBoundary(outerPoint, innerPoint, lensValue.inner, innerIndex, path);
    connectors.push([outerPoint, innerPoint]);
  }
  for (let first = 0; first < connectors.length; first += 1) {
    for (let second = first + 1; second < connectors.length; second += 1) {
      if (intersects(connectors[first]![0], connectors[first]![1], connectors[second]![0], connectors[second]![1])) {
        throw new TypeError(`${path} point correspondence produces crossing rim connectors`);
      }
    }
  }
}

function polygon(value: unknown, path: string, winding: "ccw" | "cw"): asserts value is Point2[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 64) throw new TypeError(`${path} must contain 4 to 64 points`);
  value.forEach((candidate, index) => point(candidate, `${path}.${index}`));
  assertSimple(value as Point2[], path);
  const signedArea = area(value as Point2[]);
  if (Math.abs(signedArea) < 4) throw new TypeError(`${path} is degenerate`);
  if ((winding === "ccw" && signedArea <= 0) || (winding === "cw" && signedArea >= 0)) {
    throw new TypeError(`${path} winding must be ${winding.toUpperCase()}`);
  }
}

function assertCanonicalStart(polygonValue: readonly Point2[], path: string): void {
  const first = polygonValue[0]!;
  const canonical = [...polygonValue].sort((left, right) => left[0] - right[0] || left[1] - right[1])[0]!;
  if (!samePoint(first, canonical)) throw new TypeError(`${path} point ordering must start at the leftmost then lowest vertex`);
}

function lens(value: unknown, path: string): asserts value is LensProfile {
  object(value, path); exactKeys(value, ["outer", "inner"], path);
  polygon(value.outer, `${path}.outer`, "ccw"); polygon(value.inner, `${path}.inner`, "cw");
  assertCanonicalStart(value.outer, `${path}.outer`); assertCanonicalStart(value.inner, `${path}.inner`);
  if (value.outer.length !== value.inner.length) throw new TypeError(`${path} outer and inner polygons must have equal point counts`);
  if (!(value.inner as Point2[]).every((candidate) => inside(candidate, value.outer as Point2[]))) throw new TypeError(`${path}.inner must remain strictly inside outer`);
  for (let outerIndex = 0; outerIndex < value.outer.length; outerIndex += 1) {
    for (let innerIndex = 0; innerIndex < value.inner.length; innerIndex += 1) {
      if (intersects(value.outer[outerIndex]!, value.outer[(outerIndex + 1) % value.outer.length]!, value.inner[innerIndex]!, value.inner[(innerIndex + 1) % value.inner.length]!)) {
        throw new TypeError(`${path}.inner must not intersect outer`);
      }
    }
  }
  assertRimCorrespondence(value as unknown as LensProfile, path);
}

function extent(polygonValue: readonly Point2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = polygonValue.map(([x]) => x); const ys = polygonValue.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function near(actual: number, expected: number, path: string, tolerance = 0.05): void {
  if (Math.abs(actual - expected) > tolerance) throw new TypeError(`${path} is inconsistent with measurementSet dimensions`);
}

function templateOctagon(cx: number, width: number, height: number, inset: number): [number, number][] {
  const left = cx - width / 2; const right = cx + width / 2; const top = height / 2; const bottom = -top;
  return [[left, -height * 0.26], [left + inset, bottom], [right - inset, bottom], [right, -height * 0.26], [right, height * 0.26], [right - inset, top], [left + inset, top], [left, height * 0.26]];
}

function canonicalPolygonStart(points: [number, number][]): [number, number][] {
  let start = 0;
  for (let index = 1; index < points.length; index += 1) if (points[index]![0] < points[start]![0] || (points[index]![0] === points[start]![0] && points[index]![1] < points[start]![1])) start = index;
  return [...points.slice(start), ...points.slice(0, start)];
}

export function deriveDimensionTemplateProxyProfile(d: ProxyGeneratorInput["measurementSet"]["dimensionsMm"]): ProxyGeneratorInput["profile"] {
  const halfGap = d.bridgeWidth / 2; const center = halfGap + d.lensWidth / 2;
  const corner = Math.min(d.lensWidth * 0.18, d.lensHeight * 0.24); const rim = Math.min(4, Math.max(2, d.frameThickness));
  const templeThickness = Math.min(4, d.frameThickness);
  return {
    kind: "explicit-manual-2d", coordinateUnit: "millimetre",
    leftLens: { outer: templateOctagon(-center, d.lensWidth, d.lensHeight, corner), inner: canonicalPolygonStart(templateOctagon(-center, d.lensWidth - 2 * rim, d.lensHeight - 2 * rim, Math.max(1, corner - rim)).reverse()) },
    rightLens: { outer: templateOctagon(center, d.lensWidth, d.lensHeight, corner), inner: canonicalPolygonStart(templateOctagon(center, d.lensWidth - 2 * rim, d.lensHeight - 2 * rim, Math.max(1, corner - rim)).reverse()) },
    bridgeAnchors: { left: [-halfGap, 0], right: [halfGap, 0] },
    hingeAnchors: { left: [-d.frameWidth / 2 + templeThickness / 2, 0], right: [d.frameWidth / 2 - templeThickness / 2, 0] },
  };
}

export function deriveManualTraceProxyProfile(body: ManualTraceProfileEvidenceBody): ProxyGeneratorInput["profile"] {
  const [originX, originY] = body.coordinateRules.originPx; const scale = body.coordinateRules.millimetresPerPixel;
  const convert = ([x, y]: Point2): [number, number] => [(x - originX) * scale, (originY - y) * scale];
  return {
    kind: "explicit-manual-2d", coordinateUnit: "millimetre",
    leftLens: { outer: body.tracePx.leftLens.outer.map(convert), inner: body.tracePx.leftLens.inner.map(convert) },
    rightLens: { outer: body.tracePx.rightLens.outer.map(convert), inner: body.tracePx.rightLens.inner.map(convert) },
    bridgeAnchors: { left: convert(body.tracePx.bridgeAnchors.left), right: convert(body.tracePx.bridgeAnchors.right) },
    hingeAnchors: { left: convert(body.tracePx.hingeAnchors.left), right: convert(body.tracePx.hingeAnchors.right) },
  };
}

export function parseProxyGeneratorInput(value: unknown): ProxyGeneratorInput {
  object(value, "input");
  for (const key of Object.keys(value)) if (!INPUT_KEYS.has(key)) throw new TypeError(`input.${key} is not allowed`);
  requireKeys(value, ["schemaVersion", "candidate", "sourceAssetHashes", "measurementSet", "generator", "profile"], "input");
  if (value.schemaVersion !== 1) throw new TypeError("input.schemaVersion must equal 1");

  object(value.candidate, "input.candidate");
  exactKeys(value.candidate, ["tenantId", "frameModelId", "frameVariantId", "assetId", "assetVersion"], "input.candidate");
  for (const key of ["tenantId", "frameModelId", "frameVariantId", "assetId"] as const) text(value.candidate[key], `input.candidate.${key}`);
  if (!Number.isSafeInteger(value.candidate.assetVersion) || (value.candidate.assetVersion as number) < 1) throw new TypeError("input.candidate.assetVersion must be a positive integer");

  if (!Array.isArray(value.sourceAssetHashes) || value.sourceAssetHashes.length === 0 || value.sourceAssetHashes.length > 32) throw new TypeError("input.sourceAssetHashes must contain 1 to 32 synthetic/manual source digests");
  value.sourceAssetHashes.forEach((candidate, index) => hash(candidate, `input.sourceAssetHashes.${index}`));
  if (new Set(value.sourceAssetHashes).size !== value.sourceAssetHashes.length) throw new TypeError("input.sourceAssetHashes must not contain duplicates");

  object(value.measurementSet, "input.measurementSet"); exactKeys(value.measurementSet, ["sha256", "version", "dimensionsMm"], "input.measurementSet");
  hash(value.measurementSet.sha256, "input.measurementSet.sha256");
  if (!Number.isSafeInteger(value.measurementSet.version) || (value.measurementSet.version as number) < 1) throw new TypeError("input.measurementSet.version must be a positive integer");
  object(value.measurementSet.dimensionsMm, "input.measurementSet.dimensionsMm");
  exactKeys(value.measurementSet.dimensionsMm, ["lensWidth", "bridgeWidth", "templeLength", "frameWidth", "lensHeight", "frameThickness"], "input.measurementSet.dimensionsMm");
  const d = value.measurementSet.dimensionsMm;
  bounded(d.lensWidth, 20, 90, "input.measurementSet.dimensionsMm.lensWidth");
  bounded(d.bridgeWidth, 5, 40, "input.measurementSet.dimensionsMm.bridgeWidth");
  bounded(d.templeLength, 80, 200, "input.measurementSet.dimensionsMm.templeLength");
  bounded(d.frameWidth, 70, 220, "input.measurementSet.dimensionsMm.frameWidth");
  bounded(d.lensHeight, 15, 80, "input.measurementSet.dimensionsMm.lensHeight");
  bounded(d.frameThickness, 1, 12, "input.measurementSet.dimensionsMm.frameThickness");
  if ((d.frameWidth as number) <= 2 * (d.lensWidth as number) + (d.bridgeWidth as number)) throw new TypeError("input.measurementSet dimensions require positive endpiece width");

  object(value.generator, "input.generator"); exactKeys(value.generator, ["id", "version", "configSha256"], "input.generator");
  text(value.generator.id, "input.generator.id"); text(value.generator.version, "input.generator.version"); hash(value.generator.configSha256, "input.generator.configSha256");

  const authoringEvidence = value.authoringEvidence === undefined ? undefined : parseAuthoringEvidence(value.authoringEvidence, d.frameThickness as number, value.measurementSet.sha256 as string, value.sourceAssetHashes as string[]);

  object(value.profile, "input.profile");
  exactKeys(value.profile, ["kind", "coordinateUnit", "leftLens", "rightLens", "bridgeAnchors", "hingeAnchors"], "input.profile");
  if (value.profile.kind !== "explicit-manual-2d") throw new TypeError("input.profile.kind must be explicit-manual-2d");
  if (value.profile.coordinateUnit !== "millimetre") throw new TypeError("input.profile.coordinateUnit must be millimetre");
  lens(value.profile.leftLens, "input.profile.leftLens"); lens(value.profile.rightLens, "input.profile.rightLens");
  object(value.profile.bridgeAnchors, "input.profile.bridgeAnchors"); exactKeys(value.profile.bridgeAnchors, ["left", "right"], "input.profile.bridgeAnchors");
  point(value.profile.bridgeAnchors.left, "input.profile.bridgeAnchors.left"); point(value.profile.bridgeAnchors.right, "input.profile.bridgeAnchors.right");
  object(value.profile.hingeAnchors, "input.profile.hingeAnchors"); exactKeys(value.profile.hingeAnchors, ["left", "right"], "input.profile.hingeAnchors");
  point(value.profile.hingeAnchors.left, "input.profile.hingeAnchors.left"); point(value.profile.hingeAnchors.right, "input.profile.hingeAnchors.right");

  const left = extent(value.profile.leftLens.outer); const right = extent(value.profile.rightLens.outer);
  near(left.maxX - left.minX, d.lensWidth as number, "input.profile.leftLens width");
  near(right.maxX - right.minX, d.lensWidth as number, "input.profile.rightLens width");
  near(left.maxY - left.minY, d.lensHeight as number, "input.profile.leftLens height");
  near(right.maxY - right.minY, d.lensHeight as number, "input.profile.rightLens height");
  near((value.profile.bridgeAnchors.right as Point2)[0] - (value.profile.bridgeAnchors.left as Point2)[0], d.bridgeWidth as number, "input.profile bridge anchor span");
  near((value.profile.bridgeAnchors.left as Point2)[0], left.maxX, "input.profile.bridgeAnchors.left.x");
  near((value.profile.bridgeAnchors.right as Point2)[0], right.minX, "input.profile.bridgeAnchors.right.x");
  const templeThickness = Math.min(4, d.frameThickness as number);
  near((value.profile.hingeAnchors.left as Point2)[0], -(d.frameWidth as number) / 2 + templeThickness / 2, "input.profile.hingeAnchors.left.x");
  near((value.profile.hingeAnchors.right as Point2)[0], (d.frameWidth as number) / 2 - templeThickness / 2, "input.profile.hingeAnchors.right.x");
  if ((value.profile.hingeAnchors.left as Point2)[1] < left.minY || (value.profile.hingeAnchors.left as Point2)[1] > left.maxY ||
      (value.profile.hingeAnchors.right as Point2)[1] < right.minY || (value.profile.hingeAnchors.right as Point2)[1] > right.maxY) {
    throw new TypeError("input.profile hinge anchors must fall within the lens height range");
  }
  if (authoringEvidence) {
    const derived = authoringEvidence.profile.method === "dimension-template"
      ? deriveDimensionTemplateProxyProfile(d as ProxyGeneratorInput["measurementSet"]["dimensionsMm"])
      : deriveManualTraceProxyProfile(authoringEvidence.profile.body);
    if (canonicalize(derived) !== canonicalize(value.profile)) throw new TypeError("input.profile must exactly match the durable authoring evidence body");
  }

  const canonical = structuredClone(value) as unknown as ProxyGeneratorInput;
  (canonical as unknown as { sourceAssetHashes: string[] }).sourceAssetHashes.sort();
  return canonical;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function verifyProfileEvidenceDigest(input: ProxyGeneratorInput): Promise<void> {
  const profile = input.authoringEvidence?.profile;
  if (!profile) return;
  const actual = await sha256(canonicalize({ schemaVersion: 1, method: profile.method, body: profile.body }));
  if (actual !== profile.evidenceSha256) throw new TypeError("input.authoringEvidence.profile.evidenceSha256 does not match its canonical evidence body");
}

function metres(mm: number): number { return mm / 1_000; }

function triangle(target: number[], a: readonly number[], b: readonly number[], c: readonly number[]): void { target.push(...a, ...b, ...c); }
function quad(target: number[], a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): void {
  triangle(target, a, b, c); triangle(target, a, c, d);
}

function ring(target: number[], lensValue: LensProfile, depthMm: number): void {
  const front = metres(depthMm) / 2; const back = -front;
  for (let index = 0; index < lensValue.outer.length; index += 1) {
    const next = (index + 1) % lensValue.outer.length;
    const o0 = lensValue.outer[index]!.map(metres); const o1 = lensValue.outer[next]!.map(metres);
    // The hole has the required opposite winding; reverse its traversal so each
    // strip joins spatially corresponding outer/inner edges without crossing.
    const innerIndex = correspondingInnerIndex(lensValue.inner.length, index);
    const innerNext = correspondingInnerIndex(lensValue.inner.length, next);
    const i0 = lensValue.inner[innerIndex]!.map(metres); const i1 = lensValue.inner[innerNext]!.map(metres);
    quad(target, [o0[0]!, o0[1]!, front], [o1[0]!, o1[1]!, front], [i1[0]!, i1[1]!, front], [i0[0]!, i0[1]!, front]);
    quad(target, [o1[0]!, o1[1]!, back], [o0[0]!, o0[1]!, back], [i0[0]!, i0[1]!, back], [i1[0]!, i1[1]!, back]);
    quad(target, [o0[0]!, o0[1]!, back], [o1[0]!, o1[1]!, back], [o1[0]!, o1[1]!, front], [o0[0]!, o0[1]!, front]);
    quad(target, [i1[0]!, i1[1]!, back], [i0[0]!, i0[1]!, back], [i0[0]!, i0[1]!, front], [i1[0]!, i1[1]!, front]);
  }
}

function box(target: number[], centerMm: readonly [number, number, number], sizeMm: readonly [number, number, number]): void {
  const [cx, cy, cz] = centerMm.map(metres); const [hx, hy, hz] = sizeMm.map((value) => metres(value) / 2);
  const p = [
    [cx! - hx!, cy! - hy!, cz! - hz!], [cx! + hx!, cy! - hy!, cz! - hz!], [cx! + hx!, cy! + hy!, cz! - hz!], [cx! - hx!, cy! + hy!, cz! - hz!],
    [cx! - hx!, cy! - hy!, cz! + hz!], [cx! + hx!, cy! - hy!, cz! + hz!], [cx! + hx!, cy! + hy!, cz! + hz!], [cx! - hx!, cy! + hy!, cz! + hz!],
  ];
  const faces: readonly (readonly [number, number, number, number])[] = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[4,0,3,7]];
  for (const [a, b, c, d] of faces) quad(target, p[a]!, p[b]!, p[c]!, p[d]!);
}

function padded(bytes: Uint8Array, paddingByte: number): Uint8Array {
  const length = Math.ceil(bytes.byteLength / 4) * 4;
  if (length === bytes.byteLength) return bytes;
  const result = new Uint8Array(length); result.set(bytes); result.fill(paddingByte, bytes.byteLength); return result;
}

function u32(target: Uint8Array, offset: number, value: number): void { new DataView(target.buffer).setUint32(offset, value, true); }

function float32LittleEndian(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function createGlb(input: ProxyGeneratorInput, inputHash: string): Uint8Array {
  const d = input.measurementSet.dimensionsMm;
  const rims: number[] = []; ring(rims, input.profile.leftLens, d.frameThickness); ring(rims, input.profile.rightLens, d.frameThickness);
  const bridge: number[] = [];
  const bridgeLeft = input.profile.bridgeAnchors.left; const bridgeRight = input.profile.bridgeAnchors.right;
  box(bridge, [(bridgeLeft[0] + bridgeRight[0]) / 2, (bridgeLeft[1] + bridgeRight[1]) / 2, 0], [bridgeRight[0] - bridgeLeft[0], Math.min(4, d.frameThickness), d.frameThickness]);
  const templeThickness = Math.min(4, d.frameThickness);
  const templeHeight = Math.min(6, Math.max(2, d.frameThickness));
  const leftTemple: number[] = []; const rightTemple: number[] = [];
  box(leftTemple, [input.profile.hingeAnchors.left[0], input.profile.hingeAnchors.left[1], -d.templeLength / 2], [templeThickness, templeHeight, d.templeLength]);
  box(rightTemple, [input.profile.hingeAnchors.right[0], input.profile.hingeAnchors.right[1], -d.templeLength / 2], [templeThickness, templeHeight, d.templeLength]);
  const groups = [rims, bridge, leftTemple, rightTemple];
  const chunks = groups.map(float32LittleEndian);
  const offsets: number[] = []; let total = 0;
  for (const chunk of chunks) { offsets.push(total); total += chunk.byteLength; }
  const binary = padded(new Uint8Array(total), 0); chunks.forEach((chunk, index) => binary.set(chunk, offsets[index]));
  const accessors = groups.map((values, index) => {
    const view = new DataView(chunks[index]!.buffer, chunks[index]!.byteOffset, chunks[index]!.byteLength);
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (let cursor = 0; cursor < values.length; cursor += 3) for (let axis = 0; axis < 3; axis += 1) {
      const value = view.getFloat32((cursor + axis) * 4, true);
      min[axis] = Math.min(min[axis]!, value); max[axis] = Math.max(max[axis]!, value);
    }
    return { bufferView: index, componentType: 5126, count: values.length / 3, type: "VEC3", min, max };
  });
  const json = {
    asset: { version: "2.0", generator: `${input.generator.id}@${input.generator.version}`, extras: { unit: "metre", profile: "explicit-manual-2d-proxy", canonicalInputSha256: inputHash } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "FRAME_ROOT", children: [1,2,3,4,5,6,7,8,9,10] },
      { name: "RIMS_FRONT", mesh: 0 }, { name: "BRIDGE", mesh: 1 }, { name: "TEMPLE_LEFT", mesh: 2 }, { name: "TEMPLE_RIGHT", mesh: 3 },
      { name: "NOSE_ANCHOR", translation: [0, metres((bridgeLeft[1] + bridgeRight[1]) / 2), 0] },
      { name: "LENS_LEFT" }, { name: "LENS_RIGHT" },
      { name: "HINGE_LEFT", translation: [metres(input.profile.hingeAnchors.left[0]), metres(input.profile.hingeAnchors.left[1]), 0] },
      { name: "HINGE_RIGHT", translation: [metres(input.profile.hingeAnchors.right[0]), metres(input.profile.hingeAnchors.right[1]), 0] },
      { name: "SYNTHETIC_PROXY_NOT_PRODUCT_NOT_J1_M" },
    ],
    meshes: groups.map((_, index) => ({ name: ["Rims front", "Bridge", "Left temple", "Right temple"][index], primitives: [{ attributes: { POSITION: index }, mode: 4 }] })),
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: chunks.map((chunk, index) => ({ buffer: 0, byteOffset: offsets[index], byteLength: chunk.byteLength, target: 34962 })),
    accessors,
    extras: { unit: "metre", quality: "proxy", status: "draft", recommendedForLive: false, fixture: "visibly-synthetic" },
  };
  const jsonBytes = padded(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const output = new Uint8Array(12 + 8 + jsonBytes.byteLength + 8 + binary.byteLength);
  u32(output, 0, 0x46546c67); u32(output, 4, 2); u32(output, 8, output.byteLength);
  u32(output, 12, jsonBytes.byteLength); u32(output, 16, 0x4e4f534a); output.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.byteLength; u32(output, binHeader, binary.byteLength); u32(output, binHeader + 4, 0x004e4942); output.set(binary, binHeader + 8);
  return output;
}

export async function generateProxyBundle(value: unknown): Promise<GeneratedProxyBundle> {
  const input = parseProxyGeneratorInput(value);
  await verifyProfileEvidenceDigest(input);
  const canonicalInput = canonicalize(input);
  const canonicalInputSha256 = await sha256(canonicalInput);
  const glb = createGlb(input, canonicalInputSha256);
  const glbSha256 = await sha256(glb);
  const validation = validateGlb(glb, { requiredNodes: PROXY_REQUIRED_NODES, unit: "metre" });
  const width = validation.actualBoundsMetres.max[0] - validation.actualBoundsMetres.min[0];
  if (Math.abs(width - metres(input.measurementSet.dimensionsMm.frameWidth)) > PROXY_BOUND_TOLERANCE_METRES) throw new Error("generated GLB width is outside deterministic tolerance");
  if (Math.abs(validation.actualBoundsMetres.min[2] + metres(input.measurementSet.dimensionsMm.templeLength)) > PROXY_BOUND_TOLERANCE_METRES) throw new Error("generated GLB temple length is outside deterministic tolerance");
  const glbFileName = `${canonicalInputSha256}.proxy.glb`;
  const manifestFileName = `${canonicalInputSha256}.manifest.json`;
  const manifest: ProxyBundleManifest = {
    schemaVersion: 1,
    assetId: input.candidate.assetId,
    assetVersion: input.candidate.assetVersion,
    fixture: true,
    generator: { name: input.generator.id, version: input.generator.version },
    model: { url: `./${glbFileName}`, sha256: glbSha256, byteLength: glb.byteLength, format: "glb", unit: "metre", boundsMetres: validation.actualBoundsMetres, requiredNodes: [...PROXY_REQUIRED_NODES] },
    sourceAssetHashes: [...input.sourceAssetHashes],
    proxyGeneration: {
      schemaVersion: 1, candidate: { ...input.candidate }, canonicalInputSha256, measurementDigest: input.measurementSet.sha256, sourceAssetHashes: [...input.sourceAssetHashes],
      generator: { ...input.generator }, outputGlb: { sha256: glbSha256, byteLength: glb.byteLength }, actualBoundsMetres: validation.actualBoundsMetres,
      requiredNodes: [...PROXY_REQUIRED_NODES], limitations: [...PROXY_LIMITATIONS, ...(input.authoringEvidence?.thickness.kind === "non-physical-proxy-assumption" ? input.authoringEvidence.thickness.limitations : [])],
      ...(input.authoringEvidence === undefined ? {} : { authoringEvidence: structuredClone(input.authoringEvidence) }),
      status: "draft", quality: "proxy", recommendedForLive: false,
      admission: "calibration-only", g1: "active-not-ready", g2: "preparation-only-not-active-not-pass",
    },
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  return { canonicalInput, canonicalInputSha256, glbFileName, manifestFileName, glb, manifest, manifestJson, manifestSha256: await sha256(manifestJson) };
}
