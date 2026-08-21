export type DeploymentEnvironment = "production" | "staging";

export type DeploymentAssetBinding = {
  assetId: string;
  assetVersion: number;
  catalogSha256: string;
  manifestSha256: string;
  modelSha256: string;
};

export type CameraProjectionProfileSetBinding = {
  profileSetId: string;
  profileSetVersion: number;
  url: string;
  allowedOrigin: string;
  sha256: string;
  byteLength: number;
};

export type PriorDeploymentPointer = DeploymentAssetBinding & {
  deploymentId: string;
  deploymentSha256: string;
  revision: number;
  generation: number;
  activatedAt: string;
  cameraProjectionProfileSet?: CameraProjectionProfileSetBinding;
};

export type DeploymentPointer = {
  deploymentId: string;
  status: "active" | "superseded";
  tenantId: string;
  siteId: string;
  environment: DeploymentEnvironment;
  selector: {
    sku: string;
    frameModelId: string;
    frameVariantId: string;
  };
  revision: number;
  generation: number;
  activatedAt: string;
  actor: {
    authorityId: string;
    subjectId: string;
    changeId: string;
  };
  catalogUrl: string;
  allowedOrigin: string;
  asset: DeploymentAssetBinding;
  cameraProjectionProfileSet?: CameraProjectionProfileSetBinding;
  priorPointer: PriorDeploymentPointer | null;
};

export type DeploymentDocument = {
  schemaVersion: 1;
  kind: "jessica.active-deployments";
  authorityId: string;
  issuedAt: string;
  expiresAt: string;
  pointers: readonly DeploymentPointer[];
};

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`);
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unexpected.length > 0) throw new TypeError(`${path} contains unknown field: ${unexpected[0]}`);
  if (missing.length > 0) throw new TypeError(`${path} is missing field: ${missing[0]}`);
}

function array(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must be a plain array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const unexpected = Object.keys(descriptors).find((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key));
  if (unexpected) throw new TypeError(`${path} contains an invalid array field`);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`);
  }
}

function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-blank string`);
}

function positiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${path} must be a positive safe integer`);
}

function digest(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
}

function timestamp(value: unknown, path: string): asserts value is string {
  text(value, path);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
}

function origin(value: unknown, path: string): asserts value is string {
  text(value, path);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TypeError(`${path} must be an absolute origin`); }
  if (value !== parsed.origin || !["https:", "http:"].includes(parsed.protocol)) throw new TypeError(`${path} must contain only an HTTP(S) origin`);
}

export function parseCameraProjectionProfileSetBinding(value: unknown, path = "cameraProjectionProfileSet"): CameraProjectionProfileSetBinding {
  object(value, path); exactKeys(value, ["profileSetId", "profileSetVersion", "url", "allowedOrigin", "sha256", "byteLength"], path);
  text(value.profileSetId, `${path}.profileSetId`); positiveInteger(value.profileSetVersion, `${path}.profileSetVersion`); text(value.url, `${path}.url`); origin(value.allowedOrigin, `${path}.allowedOrigin`);
  const profileUrl = new URL(value.url); if (profileUrl.origin !== value.allowedOrigin || profileUrl.username || profileUrl.password || profileUrl.protocol !== "https:") throw new TypeError(`${path} URL is not bound to its production origin`);
  digest(value.sha256, `${path}.sha256`); positiveInteger(value.byteLength, `${path}.byteLength`);
  const copy = structuredClone(value) as CameraProjectionProfileSetBinding; return Object.freeze(copy);
}

function parseAssetBinding(value: unknown, path: string, checkKeys = true): void {
  object(value, path);
  if (checkKeys) exactKeys(value, ["assetId", "assetVersion", "catalogSha256", "manifestSha256", "modelSha256"], path);
  text(value.assetId, `${path}.assetId`);
  positiveInteger(value.assetVersion, `${path}.assetVersion`);
  digest(value.catalogSha256, `${path}.catalogSha256`);
  digest(value.manifestSha256, `${path}.manifestSha256`);
  digest(value.modelSha256, `${path}.modelSha256`);
}

function parsePointer(value: unknown, path: string): void {
  object(value, path);
  const hasProjection = Object.hasOwn(value, "cameraProjectionProfileSet");
  exactKeys(value, ["deploymentId", "status", "tenantId", "siteId", "environment", "selector", "revision", "generation", "activatedAt", "actor", "catalogUrl", "allowedOrigin", "asset", ...(hasProjection ? ["cameraProjectionProfileSet"] : []), "priorPointer"], path);
  text(value.deploymentId, `${path}.deploymentId`);
  if (value.status !== "active" && value.status !== "superseded") throw new TypeError(`${path}.status must be active or superseded`);
  text(value.tenantId, `${path}.tenantId`);
  text(value.siteId, `${path}.siteId`);
  if (value.environment !== "production" && value.environment !== "staging") throw new TypeError(`${path}.environment must be production or staging`);
  object(value.selector, `${path}.selector`);
  exactKeys(value.selector, ["sku", "frameModelId", "frameVariantId"], `${path}.selector`);
  text(value.selector.sku, `${path}.selector.sku`);
  text(value.selector.frameModelId, `${path}.selector.frameModelId`);
  text(value.selector.frameVariantId, `${path}.selector.frameVariantId`);
  positiveInteger(value.revision, `${path}.revision`);
  positiveInteger(value.generation, `${path}.generation`);
  timestamp(value.activatedAt, `${path}.activatedAt`);
  object(value.actor, `${path}.actor`);
  exactKeys(value.actor, ["authorityId", "subjectId", "changeId"], `${path}.actor`);
  text(value.actor.authorityId, `${path}.actor.authorityId`);
  text(value.actor.subjectId, `${path}.actor.subjectId`);
  text(value.actor.changeId, `${path}.actor.changeId`);
  text(value.catalogUrl, `${path}.catalogUrl`);
  try { new URL(value.catalogUrl); } catch { throw new TypeError(`${path}.catalogUrl must be absolute`); }
  origin(value.allowedOrigin, `${path}.allowedOrigin`);
  parseAssetBinding(value.asset, `${path}.asset`);
  if (hasProjection) {
    parseCameraProjectionProfileSetBinding(value.cameraProjectionProfileSet, `${path}.cameraProjectionProfileSet`);
  }
  if (value.priorPointer !== null) {
    object(value.priorPointer, `${path}.priorPointer`);
    const priorHasProjection = Object.hasOwn(value.priorPointer, "cameraProjectionProfileSet");
    exactKeys(value.priorPointer, ["deploymentId", "deploymentSha256", "revision", "generation", "activatedAt", "assetId", "assetVersion", "catalogSha256", "manifestSha256", "modelSha256", ...(priorHasProjection ? ["cameraProjectionProfileSet"] : [])], `${path}.priorPointer`);
    text(value.priorPointer.deploymentId, `${path}.priorPointer.deploymentId`);
    digest(value.priorPointer.deploymentSha256, `${path}.priorPointer.deploymentSha256`);
    positiveInteger(value.priorPointer.revision, `${path}.priorPointer.revision`);
    positiveInteger(value.priorPointer.generation, `${path}.priorPointer.generation`);
    timestamp(value.priorPointer.activatedAt, `${path}.priorPointer.activatedAt`);
    parseAssetBinding(value.priorPointer, `${path}.priorPointer`, false);
    if (priorHasProjection) {
      parseCameraProjectionProfileSetBinding(value.priorPointer.cameraProjectionProfileSet, `${path}.priorPointer.cameraProjectionProfileSet`);
    }
  }
}

export function parseDeploymentDocument(value: unknown): DeploymentDocument {
  object(value, "deployment");
  exactKeys(value, ["schemaVersion", "kind", "authorityId", "issuedAt", "expiresAt", "pointers"], "deployment");
  if (value.schemaVersion !== 1) throw new TypeError("deployment.schemaVersion must be 1");
  if (value.kind !== "jessica.active-deployments") throw new TypeError("deployment.kind is unsupported");
  text(value.authorityId, "deployment.authorityId");
  timestamp(value.issuedAt, "deployment.issuedAt");
  timestamp(value.expiresAt, "deployment.expiresAt");
  array(value.pointers, "deployment.pointers");
  if (value.pointers.length === 0) throw new TypeError("deployment.pointers must be a non-empty array");
  value.pointers.forEach((pointer, index) => parsePointer(pointer, `deployment.pointers.${index}`));
  const ids = value.pointers.map((pointer) => (pointer as DeploymentPointer).deploymentId);
  if (new Set(ids).size !== ids.length) throw new TypeError("deployment pointer IDs must be unique");
  return value as unknown as DeploymentDocument;
}
