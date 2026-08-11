import type { DeploymentDocument, DeploymentEnvironment, DeploymentPointer, PriorDeploymentPointer } from "../../contracts/src/index.js";

export type DeploymentSelection = {
  tenantId: string;
  siteId: string;
  environment: DeploymentEnvironment;
};

export type DeploymentReceipt = {
  deploymentId: string;
  revision: number;
  generation: number;
  activatedAt: string;
  assetId: string;
  assetVersion: number;
  catalogSha256: string;
  manifestSha256: string;
  modelSha256: string;
  documentSha256: string;
};

export type DeploymentTrustFloor = {
  authorityId: string;
  minimumRevision: number;
  minimumGeneration: number;
  allowedCatalogOrigins: readonly string[];
  maximumDocumentLifetimeMs: number;
  maximumDocumentAgeMs: number;
  nowEpochMs: number;
  maximumFutureSkewMs?: number;
  priorReceipt?: DeploymentReceipt;
};

export function parseDeploymentReceipt(value: unknown): DeploymentReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("deployment receipt must be an object");
  const candidate = value as Record<string, unknown>;
  const keys = ["deploymentId", "revision", "generation", "activatedAt", "assetId", "assetVersion", "catalogSha256", "manifestSha256", "modelSha256", "documentSha256"];
  if (Object.keys(candidate).length !== keys.length || keys.some((key) => !(key in candidate))) throw new TypeError("deployment receipt fields are invalid");
  for (const key of ["deploymentId", "activatedAt", "assetId"]) if (typeof candidate[key] !== "string" || candidate[key] === "") throw new TypeError(`deployment receipt ${key} is invalid`);
  for (const key of ["revision", "generation", "assetVersion"]) if (!Number.isSafeInteger(candidate[key]) || (candidate[key] as number) < 1) throw new TypeError(`deployment receipt ${key} is invalid`);
  for (const key of ["catalogSha256", "manifestSha256", "modelSha256", "documentSha256"]) if (typeof candidate[key] !== "string" || !/^[a-f0-9]{64}$/.test(candidate[key] as string)) throw new TypeError(`deployment receipt ${key} is invalid`);
  if (!Number.isFinite(Date.parse(candidate.activatedAt as string)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(candidate.activatedAt as string)) throw new TypeError("deployment receipt activatedAt is invalid");
  return value as DeploymentReceipt;
}

function samePrior(prior: PriorDeploymentPointer, receipt: DeploymentReceipt): boolean {
  return prior.deploymentId === receipt.deploymentId
    && prior.deploymentSha256 === receipt.documentSha256
    && prior.revision === receipt.revision
    && prior.generation === receipt.generation
    && prior.activatedAt === receipt.activatedAt
    && prior.assetId === receipt.assetId
    && prior.assetVersion === receipt.assetVersion
    && prior.catalogSha256 === receipt.catalogSha256
    && prior.manifestSha256 === receipt.manifestSha256
    && prior.modelSha256 === receipt.modelSha256;
}

export function evaluateActiveDeployment(input: {
  document: DeploymentDocument;
  documentSha256: string;
  selection: DeploymentSelection;
  trust: DeploymentTrustFloor;
}): DeploymentPointer {
  const { document, selection, trust } = input;
  if (document.authorityId !== trust.authorityId) throw new Error("deployment authority does not match trusted authority");
  const issuedAt = Date.parse(document.issuedAt);
  const expiresAt = Date.parse(document.expiresAt);
  const skew = trust.maximumFutureSkewMs ?? 30_000;
  if (issuedAt > trust.nowEpochMs + skew) throw new Error("deployment document was issued in the future");
  if (expiresAt <= issuedAt || trust.nowEpochMs >= expiresAt) throw new Error("deployment document is stale or expired");
  if (!Number.isFinite(trust.maximumDocumentLifetimeMs) || trust.maximumDocumentLifetimeMs <= 0 || expiresAt - issuedAt > trust.maximumDocumentLifetimeMs) throw new Error("deployment document lifetime exceeds host policy");
  if (!Number.isFinite(trust.maximumDocumentAgeMs) || trust.maximumDocumentAgeMs <= 0 || trust.nowEpochMs - issuedAt >= trust.maximumDocumentAgeMs) throw new Error("deployment document is older than host policy allows");
  const activeSelectorKeys = document.pointers.filter((pointer) => pointer.status === "active").map((pointer) => JSON.stringify([
    pointer.tenantId, pointer.siteId, pointer.environment,
  ]));
  if (new Set(activeSelectorKeys).size !== activeSelectorKeys.length) throw new Error("deployment document contains multiple active pointers for one stream");
  const hostCatalogOrigins = new Set(trust.allowedCatalogOrigins);
  for (const pointer of document.pointers) {
    const activatedAt = Date.parse(pointer.activatedAt);
    if (activatedAt > issuedAt) throw new Error("deployment activation must not be later than document issuance");
    if (pointer.revision === 1 && pointer.priorPointer !== null) throw new Error("initial deployment must not assert a prior pointer");
    if (pointer.revision > 1 && pointer.priorPointer === null) throw new Error("non-initial deployment requires a rollback-safe prior pointer");
    if (pointer.priorPointer && (pointer.priorPointer.revision >= pointer.revision
      || pointer.priorPointer.generation >= pointer.generation
      || Date.parse(pointer.priorPointer.activatedAt) >= activatedAt)) {
      throw new Error("deployment prior pointer ordering is invalid");
    }
    if (pointer.status === "active") {
      if (pointer.actor.authorityId !== document.authorityId) throw new Error("active deployment actor authority does not match document authority");
      const catalogUrl = new URL(pointer.catalogUrl);
      if (catalogUrl.username !== "" || catalogUrl.password !== "") throw new Error("active deployment catalog URL must not contain credentials");
      const catalogOrigin = catalogUrl.origin;
      if (catalogOrigin !== pointer.allowedOrigin) throw new Error("active deployment catalog URL escapes its signed allowed origin");
      if (!pointer.catalogUrl.startsWith("https://") || !pointer.allowedOrigin.startsWith("https://")) throw new Error("active production catalog origin must use HTTPS");
      if (!hostCatalogOrigins.has(pointer.allowedOrigin)) throw new Error("active deployment catalog origin is not allowed by host policy");
    }
  }
  const matching = document.pointers.filter((pointer) => pointer.status === "active"
    && pointer.tenantId === selection.tenantId
    && pointer.siteId === selection.siteId
    && pointer.environment === selection.environment);
  if (matching.length !== 1) throw new Error(`deployment selection requires exactly one active pointer; found ${matching.length}`);
  const pointer = matching[0]!;
  if (Date.parse(pointer.activatedAt) > trust.nowEpochMs + skew) throw new Error("deployment activation time is in the future");
  if (pointer.revision < trust.minimumRevision) throw new Error("deployment revision is below the trusted floor");
  if (pointer.generation < trust.minimumGeneration) throw new Error("deployment generation is below the trusted floor");
  const receipt = trust.priorReceipt;
  if (receipt) {
    const idempotent = pointer.revision === receipt.revision
      && pointer.generation === receipt.generation
      && input.documentSha256 === receipt.documentSha256;
    const advanced = pointer.revision > receipt.revision && pointer.generation > receipt.generation;
    if (!idempotent && !advanced) throw new Error("deployment rollback, replay, or revision reuse detected");
    if (advanced && (!pointer.priorPointer || !samePrior(pointer.priorPointer, receipt))) {
      throw new Error("deployment prior pointer does not match the last accepted deployment");
    }
  }
  return pointer;
}

export function deploymentReceipt(pointer: DeploymentPointer, documentSha256: string): DeploymentReceipt {
  return {
    deploymentId: pointer.deploymentId,
    revision: pointer.revision,
    generation: pointer.generation,
    activatedAt: pointer.activatedAt,
    assetId: pointer.asset.assetId,
    assetVersion: pointer.asset.assetVersion,
    catalogSha256: pointer.asset.catalogSha256,
    manifestSha256: pointer.asset.manifestSha256,
    modelSha256: pointer.asset.modelSha256,
    documentSha256,
  };
}
