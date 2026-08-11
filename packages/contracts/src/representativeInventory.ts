import type { ValidationIssue } from "./frame.js";

export const REPRESENTATIVE_TRAITS = [
  "acetate-cell", "metal", "brow", "transparent", "sunglasses",
  "small", "large", "high-curve", "rimless",
] as const;
export type RepresentativeTrait = (typeof REPRESENTATIVE_TRAITS)[number];
export const INVENTORY_MATERIALS = ["acetate", "cellulose-acetate", "metal", "tr90", "combination", "other"] as const;
export const INVENTORY_CONSTRUCTIONS = ["full-rim", "brow", "semi-rimless", "rimless"] as const;
export const INVENTORY_CATEGORIES = ["optical", "sunglasses"] as const;

export type RepresentativeSourceReference = {
  sourceAssetId: string;
  objectKey: string;
  sha256: string;
  byteLength: number;
};

export type RepresentativeCandidate = {
  tenantId: string;
  frameModelId: string;
  modelCode: string;
  representativeVariant: { frameVariantId: string; sku: string };
  category: (typeof INVENTORY_CATEGORIES)[number];
  materials: (typeof INVENTORY_MATERIALS)[number][];
  construction: (typeof INVENTORY_CONSTRUCTIONS)[number];
  transparent: boolean;
  sizeClass: "small" | "medium" | "large";
  curvatureClass: "flat" | "standard" | "high-curve";
  selectionRationale: {
    demand: "high" | "medium" | "low" | "unknown";
    continuity: "continuing" | "seasonal" | "discontinued" | "unknown";
    shapeRepresentativeness: string;
  };
  rights: { status: "cleared" | "pending" | "restricted" | "unknown"; reference: string | null };
  readiness: { sources: "ready" | "partial" | "missing"; measurements: "ready" | "partial" | "missing" };
  immutableSources: RepresentativeSourceReference[];
};

export type RepresentativeInventory = {
  schemaVersion: 1;
  inventoryId: string;
  inventoryVersion: number;
  tenantId: string;
  synthetic: boolean;
  candidates: RepresentativeCandidate[];
};

export type RepresentativeCoverageEvaluation = {
  documentValid: boolean;
  exactTwenty: boolean;
  representativenessPass: boolean;
  presentTraits: RepresentativeTrait[];
  missingTraits: RepresentativeTrait[];
  commercialRationaleReady: boolean;
  rightsReady: boolean;
  captureReady: boolean;
  selectionReady: boolean;
  synthetic: boolean | null;
  issues: readonly ValidationIssue[];
};

const SHA256 = /^[a-f0-9]{64}$/;
const ROOT_KEYS = new Set(["schemaVersion", "inventoryId", "inventoryVersion", "tenantId", "synthetic", "candidates"]);
const CANDIDATE_KEYS = new Set(["tenantId", "frameModelId", "modelCode", "representativeVariant", "category", "materials", "construction", "transparent", "sizeClass", "curvatureClass", "selectionRationale", "rights", "readiness", "immutableSources"]);
const VARIANT_KEYS = new Set(["frameVariantId", "sku"]);
const RATIONALE_KEYS = new Set(["demand", "continuity", "shapeRepresentativeness"]);
const RIGHTS_KEYS = new Set(["status", "reference"]);
const READINESS_KEYS = new Set(["sources", "measurements"]);
const SOURCE_KEYS = new Set(["sourceAssetId", "objectKey", "sha256", "byteLength"]);

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function issue(issues: ValidationIssue[], path: string, message: string): void { issues.push({ path, message }); }
function strict(value: Record<string, unknown>, keys: ReadonlySet<string>, path: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) if (!keys.has(key)) issue(issues, path ? `${path}.${key}` : key, "is not allowed");
}
function text(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== "string" || !value.trim()) { issue(issues, path, "must be a non-blank string"); return false; }
  return true;
}
function oneOf<T extends string>(value: unknown, values: readonly T[], path: string, issues: ValidationIssue[]): value is T {
  if (typeof value !== "string" || !values.includes(value as T)) { issue(issues, path, `must be one of: ${values.join(", ")}`); return false; }
  return true;
}

export function validateRepresentativeInventory(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const root = object(input);
  if (!root) return [{ path: "inventory", message: "must be an object" }];
  strict(root, ROOT_KEYS, "", issues);
  if (root.schemaVersion !== 1) issue(issues, "schemaVersion", "must equal 1");
  text(root.inventoryId, "inventoryId", issues);
  if (!Number.isInteger(root.inventoryVersion) || (root.inventoryVersion as number) < 1) issue(issues, "inventoryVersion", "must be a positive integer");
  const rootTenantValid = text(root.tenantId, "tenantId", issues);
  if (typeof root.synthetic !== "boolean") issue(issues, "synthetic", "must be boolean");
  if (!Array.isArray(root.candidates)) { issue(issues, "candidates", "must be an array"); return issues; }
  if (root.candidates.length !== 20) issue(issues, "candidates", "must contain exactly 20 distinct FrameModels");

  const identities = new Set<string>(); const modelCodes = new Set<string>(); const variantIds = new Set<string>(); const skus = new Set<string>();
  const sourceHashes = new Map<string, string>(); const sourceIds = new Map<string, string>();
  for (const [index, raw] of root.candidates.entries()) {
    const path = `candidates.${index}`; const c = object(raw);
    if (!c) { issue(issues, path, "must be an object"); continue; }
    strict(c, CANDIDATE_KEYS, path, issues);
    const tenantOk = text(c.tenantId, `${path}.tenantId`, issues); const modelOk = text(c.frameModelId, `${path}.frameModelId`, issues);
    if (tenantOk && rootTenantValid && c.tenantId !== root.tenantId) issue(issues, `${path}.tenantId`, "must match inventory tenantId");
    const codeOk = text(c.modelCode, `${path}.modelCode`, issues);
    if (tenantOk && modelOk) { const id = `${c.tenantId}\0${c.frameModelId}`; if (identities.has(id)) issue(issues, `${path}.frameModelId`, "must not duplicate or relabel another FrameModel identity"); identities.add(id); }
    if (tenantOk && codeOk) { const code = `${c.tenantId}\0${c.modelCode}`; if (modelCodes.has(code)) issue(issues, `${path}.modelCode`, "must be unique within the tenant"); modelCodes.add(code); }
    const variant = object(c.representativeVariant);
    if (!variant) issue(issues, `${path}.representativeVariant`, "must be an explicit variant object");
    else { strict(variant, VARIANT_KEYS, `${path}.representativeVariant`, issues); for (const key of ["frameVariantId", "sku"] as const) { if (text(variant[key], `${path}.representativeVariant.${key}`, issues)) { const set = key === "frameVariantId" ? variantIds : skus; const id = `${c.tenantId}\0${variant[key]}`; if (set.has(id)) issue(issues, `${path}.representativeVariant.${key}`, "must be unique and must not relabel another variant"); set.add(id); } } }
    oneOf(c.category, INVENTORY_CATEGORIES, `${path}.category`, issues);
    if (!Array.isArray(c.materials) || c.materials.length === 0) issue(issues, `${path}.materials`, "must be a non-empty array");
    else { const seen = new Set<string>(); c.materials.forEach((m, i) => { if (oneOf(m, INVENTORY_MATERIALS, `${path}.materials.${i}`, issues)) { if (seen.has(m)) issue(issues, `${path}.materials.${i}`, "must not be duplicated"); seen.add(m); } }); }
    oneOf(c.construction, INVENTORY_CONSTRUCTIONS, `${path}.construction`, issues);
    if (typeof c.transparent !== "boolean") issue(issues, `${path}.transparent`, "must be boolean");
    oneOf(c.sizeClass, ["small", "medium", "large"] as const, `${path}.sizeClass`, issues);
    oneOf(c.curvatureClass, ["flat", "standard", "high-curve"] as const, `${path}.curvatureClass`, issues);
    const rationale = object(c.selectionRationale);
    if (!rationale) issue(issues, `${path}.selectionRationale`, "must be an object"); else { strict(rationale, RATIONALE_KEYS, `${path}.selectionRationale`, issues); oneOf(rationale.demand, ["high", "medium", "low", "unknown"] as const, `${path}.selectionRationale.demand`, issues); oneOf(rationale.continuity, ["continuing", "seasonal", "discontinued", "unknown"] as const, `${path}.selectionRationale.continuity`, issues); text(rationale.shapeRepresentativeness, `${path}.selectionRationale.shapeRepresentativeness`, issues); }
    const rights = object(c.rights);
    if (!rights) issue(issues, `${path}.rights`, "must be an object"); else { strict(rights, RIGHTS_KEYS, `${path}.rights`, issues); const cleared = oneOf(rights.status, ["cleared", "pending", "restricted", "unknown"] as const, `${path}.rights.status`, issues) && rights.status === "cleared"; if (rights.reference !== null && !text(rights.reference, `${path}.rights.reference`, issues)) { /* issue added */ } if (cleared && rights.reference === null) issue(issues, `${path}.rights.reference`, "is required when rights are cleared"); }
    const readiness = object(c.readiness);
    if (!readiness) issue(issues, `${path}.readiness`, "must be an object"); else { strict(readiness, READINESS_KEYS, `${path}.readiness`, issues); oneOf(readiness.sources, ["ready", "partial", "missing"] as const, `${path}.readiness.sources`, issues); oneOf(readiness.measurements, ["ready", "partial", "missing"] as const, `${path}.readiness.measurements`, issues); }
    if (!Array.isArray(c.immutableSources)) issue(issues, `${path}.immutableSources`, "must be an array");
    else for (const [sourceIndex, rawSource] of c.immutableSources.entries()) { const sourcePath = `${path}.immutableSources.${sourceIndex}`; const source = object(rawSource); if (!source) { issue(issues, sourcePath, "must be an object"); continue; } strict(source, SOURCE_KEYS, sourcePath, issues); const idOk = text(source.sourceAssetId, `${sourcePath}.sourceAssetId`, issues); if (text(source.objectKey, `${sourcePath}.objectKey`, issues) && ((source.objectKey as string).startsWith("/") || (source.objectKey as string).split(/[\\/]/).includes(".."))) issue(issues, `${sourcePath}.objectKey`, "must be a relative traversal-free immutable key"); const hashOk = typeof source.sha256 === "string" && SHA256.test(source.sha256); if (!hashOk) issue(issues, `${sourcePath}.sha256`, "must be a lowercase SHA-256 digest"); if (!Number.isInteger(source.byteLength) || (source.byteLength as number) <= 0) issue(issues, `${sourcePath}.byteLength`, "must be a positive integer actual byte count"); if (idOk) { const prior = sourceIds.get(source.sourceAssetId as string); if (prior) issue(issues, `${sourcePath}.sourceAssetId`, `must not relabel source used by ${prior}`); else sourceIds.set(source.sourceAssetId as string, `${c.tenantId}/${c.frameModelId}`); } if (hashOk) { const prior = sourceHashes.get(source.sha256 as string); if (prior) issue(issues, `${sourcePath}.sha256`, `must not duplicate or relabel source bytes used by ${prior}`); else sourceHashes.set(source.sha256 as string, `${c.tenantId}/${c.frameModelId}`); } }
  }
  return issues;
}

function traits(candidate: Record<string, unknown>): RepresentativeTrait[] {
  const result: RepresentativeTrait[] = [];
  const materials = Array.isArray(candidate.materials) ? candidate.materials : [];
  if (materials.includes("acetate") || materials.includes("cellulose-acetate")) result.push("acetate-cell");
  if (materials.includes("metal")) result.push("metal");
  if (candidate.construction === "brow") result.push("brow");
  if (candidate.transparent === true) result.push("transparent");
  if (candidate.category === "sunglasses") result.push("sunglasses");
  if (candidate.sizeClass === "small") result.push("small");
  if (candidate.sizeClass === "large") result.push("large");
  if (candidate.curvatureClass === "high-curve") result.push("high-curve");
  if (candidate.construction === "rimless") result.push("rimless");
  return result;
}

export function evaluateRepresentativeCoverage(input: unknown): RepresentativeCoverageEvaluation {
  const issues = validateRepresentativeInventory(input); const root = object(input); const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const present = new Set<RepresentativeTrait>(); for (const candidate of candidates) { const c = object(candidate); if (c) for (const trait of traits(c)) present.add(trait); }
  const missingTraits = REPRESENTATIVE_TRAITS.filter((trait) => !present.has(trait));
  const rightsReady = candidates.length === 20 && candidates.every((raw) => { const c = object(raw); const rights = object(c?.rights); return rights?.status === "cleared" && typeof rights.reference === "string" && rights.reference.trim().length > 0; });
  const commercialRationaleReady = candidates.length === 20 && candidates.every((raw) => { const c = object(raw); const rationale = object(c?.selectionRationale); return rationale?.demand !== "unknown" && ["continuing", "seasonal"].includes(rationale?.continuity as string) && typeof rationale?.shapeRepresentativeness === "string" && rationale.shapeRepresentativeness.trim().length > 0; });
  const captureReady = candidates.length === 20 && candidates.every((raw) => { const c = object(raw); const readiness = object(c?.readiness); return readiness?.sources === "ready" && readiness.measurements === "ready" && Array.isArray(c?.immutableSources) && c.immutableSources.length > 0; });
  const documentValid = issues.length === 0; const exactTwenty = candidates.length === 20; const representativenessPass = documentValid && exactTwenty && missingTraits.length === 0;
  const synthetic = typeof root?.synthetic === "boolean" ? root.synthetic : null;
  return { documentValid, exactTwenty, representativenessPass, presentTraits: REPRESENTATIVE_TRAITS.filter((trait) => present.has(trait)), missingTraits, commercialRationaleReady, rightsReady, captureReady, selectionReady: representativenessPass && commercialRationaleReady && rightsReady && captureReady && synthetic === false, synthetic, issues };
}
