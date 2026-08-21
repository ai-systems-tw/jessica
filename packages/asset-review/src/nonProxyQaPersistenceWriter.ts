import {
  canonicalJson,
  parseFormalizationCandidate,
  parseNonProxyHumanQaDecisionAttestation,
  sha256Hex,
  type NonProxyAssetVersionBindingRow,
  type NonProxyAssetVersionRow,
  type NonProxyAssetVersionSourceRow,
  type NonProxyHumanQaRecordRow,
  type NonProxyQaControlPlaneSnapshot,
  type NonProxyQaPersistencePlan,
} from "../../contracts/src/index.js";
import { evaluateNonProxyQaPersistencePlan, snapshotNonProxyQaPersistenceHostContext, snapshotNonProxyQaPersistenceRequest } from "./nonProxyQaPersistence.js";

export type NonProxyQaWriterErrorCode = "UNAUTHENTICATED" | "DENIED" | "CANCELLED" | "DATABASE_UNAVAILABLE" | "COMMIT_OUTCOME_UNPROVEN";

/** Public errors are deliberately diagnostic-free. */
export class NonProxyQaWriterError {
  readonly code: NonProxyQaWriterErrorCode;
  constructor(code: NonProxyQaWriterErrorCode) { this.code = code; Object.freeze(this); }
}

export class NonProxyQaDatabasePortError extends Error {
  readonly kind: "retryable" | "commit-outcome-unknown" | "database";
  constructor(kind: "retryable" | "commit-outcome-unknown" | "database") { super(kind); this.name = "NonProxyQaDatabasePortError"; this.kind = kind; }
}

export type NonProxyQaAuthenticatedActor = Readonly<{ tenantId: string }>;

export type NonProxyQaWriterSelection = Readonly<{
  tenantId: string;
  frameModelId: string;
  frameVariantId: string;
  candidateAssetVersionId: string;
  candidateVersion: number;
  generationJobId: string;
  canonicalInputSha256: string;
  reviewHeadEventSha256: string;
  sourceAssetSha256s: readonly string[];
  measurementSetSha256: string;
  specimenId: string;
  reviewerAuthorityId: string;
  reviewerKeyId: string;
}>;

export interface NonProxyQaWriterTransaction {
  transactionTimestamp(): Promise<string>;
  readControlPlaneSnapshot(selection: NonProxyQaWriterSelection, observedAt: string, reviewPolicy: Readonly<{ maximumReviewAgeMs: number; sha256: string }>): Promise<NonProxyQaControlPlaneSnapshot>;
  verifyExact(plan: NonProxyQaPersistencePlan): Promise<boolean>;
  insertReviewRecord(row: NonProxyHumanQaRecordRow): Promise<void>;
  insertAssetVersionInReview(row: NonProxyAssetVersionRow): Promise<void>;
  insertAssetVersionSource(row: NonProxyAssetVersionSourceRow): Promise<void>;
  insertBinding(row: NonProxyAssetVersionBindingRow): Promise<void>;
  approveAssetVersion(row: NonProxyAssetVersionRow): Promise<void>;
  finalRecheck(plan: NonProxyQaPersistencePlan): Promise<string>;
}

export interface NonProxyQaWriterDatabase {
  /** The selection is required before checkout so a pinned session can lock before BEGIN. */
  serializable<T>(selection: NonProxyQaWriterSelection, work: (transaction: NonProxyQaWriterTransaction) => Promise<T>, precommitCheck: (transaction: NonProxyQaWriterTransaction) => Promise<void>): Promise<T>;
  verifyCommittedExact(plan: NonProxyQaPersistencePlan): Promise<string | null>;
}

export type NonProxyQaPersistenceReceipt = Readonly<{
  schemaVersion: 1;
  disposition: "inserted" | "exact-retry" | "recovered-exact-commit";
  decision: "approve" | "reject";
  committedAt: string;
  receiptSha256: string;
  ids: Readonly<{ reviewerAuthorityId: string; reviewRecordId: string; assetVersionId: string | null; bindingId: string | null; sourceRowIds: readonly string[] }>;
  digests: Readonly<{ planSha256: string; reviewerAuthorityRowSha256: string; reviewRecordRowSha256: string; assetVersionRowSha256: string | null; bindingRowSha256: string | null; sourceRowSha256s: readonly string[] }>;
  authority: Readonly<{ qaPreview: false; runtime: false; publicLive: false; recommended: false; catalog: false; deployment: false; publication: false; G1: false; G2: false; G3: false; G4: false; G5: false; G6: false; G7: false }>;
}>;

export type TrustedNonProxyQaPersistenceWriter = Readonly<{
  write(actorRequestIdentity: unknown, rawHumanQaRequest: unknown, signal?: AbortSignal): Promise<NonProxyQaPersistenceReceipt>;
}>;

type WriterDependencies = Readonly<{
  authenticate(actorRequestIdentity: unknown): Promise<NonProxyQaAuthenticatedActor | null>;
  humanQaContextAt(observedAt: string): unknown;
  database: NonProxyQaWriterDatabase;
  maximumTransactionAttempts?: number;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function frozen<T>(value: T): T { if (typeof value === "object" && value !== null && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) frozen(child); Object.freeze(value); } return value; }
const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
function cancelled(signal?: AbortSignal): void {
  if (signal === undefined) return;
  if (!abortSignalAborted || typeof signal !== "object" || signal === null) throw new NonProxyQaWriterError("CANCELLED");
  let aborted: unknown;
  try { aborted = Reflect.apply(abortSignalAborted, signal, []); } catch { throw new NonProxyQaWriterError("CANCELLED"); }
  if (aborted !== false) throw new NonProxyQaWriterError("CANCELLED");
}
function exactActor(value: unknown): NonProxyQaAuthenticatedActor { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 1 || !Object.hasOwn(value, "tenantId")) throw new NonProxyQaWriterError("UNAUTHENTICATED"); const descriptor = Object.getOwnPropertyDescriptor(value, "tenantId"); if (!descriptor?.enumerable || descriptor.get || descriptor.set || typeof descriptor.value !== "string" || !ID.test(descriptor.value)) throw new NonProxyQaWriterError("UNAUTHENTICATED"); return frozen({ tenantId: descriptor.value }); }
function safePortError(error: unknown): NonProxyQaDatabasePortError | null { return error instanceof NonProxyQaDatabasePortError ? error : null; }

function selectionFrom(raw: Readonly<{ humanQaRequest: unknown }>, actor: NonProxyQaAuthenticatedActor): NonProxyQaWriterSelection {
  const request = raw.humanQaRequest as Record<string, unknown>; const caliper = request.caliperProvenanceRequest as Record<string, unknown>; const formal = caliper.formalizationRequest as Record<string, unknown>;
  const candidate = parseFormalizationCandidate(formal.candidate); const attestation = parseNonProxyHumanQaDecisionAttestation(request.decisionAttestation);
  if (candidate.tenantId !== actor.tenantId || attestation.tenantId !== actor.tenantId) throw new NonProxyQaWriterError("DENIED");
  return frozen({ tenantId: actor.tenantId, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId, candidateAssetVersionId: candidate.id, candidateVersion: candidate.version, generationJobId: candidate.generation.jobId, canonicalInputSha256: candidate.generation.canonicalInputSha256, reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256, sourceAssetSha256s: [...candidate.sourceAssetHashes], measurementSetSha256: candidate.requirements.physical.measurementSetSha256, specimenId: attestation.specimenId, reviewerAuthorityId: attestation.authorityId, reviewerKeyId: attestation.keyId });
}

async function reviewPolicyFrom(context: unknown): Promise<Readonly<{ maximumReviewAgeMs: number; sha256: string }>> { const value = context as Record<string, unknown>; const trust = value.reviewerTrust as Record<string, unknown>; const maximumReviewAgeMs = trust.maximumReviewAgeMs; if (!Number.isSafeInteger(maximumReviewAgeMs) || (maximumReviewAgeMs as number) < 1 || (maximumReviewAgeMs as number) > 366 * 24 * 60 * 60 * 1000) throw new TypeError("invalid host review policy"); return frozen({ maximumReviewAgeMs: maximumReviewAgeMs as number, sha256: await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/review-policy/v1", maximumReviewAgeMs })) }); }

async function receipt(plan: NonProxyQaPersistencePlan, committedAt: string, disposition: "inserted" | "exact-retry" | "recovered-exact-commit"): Promise<NonProxyQaPersistenceReceipt> {
  const body = { schemaVersion: 1 as const, disposition, decision: plan.decision, committedAt, ids: { reviewerAuthorityId: plan.reviewerAuthority.id, reviewRecordId: plan.reviewRecord.id, assetVersionId: plan.assetVersion?.id ?? null, bindingId: plan.binding?.id ?? null, sourceRowIds: plan.sourceRows.map((row) => row.id) }, digests: { planSha256: plan.planSha256, reviewerAuthorityRowSha256: plan.reviewerAuthority.rowSha256, reviewRecordRowSha256: plan.reviewRecord.rowSha256, assetVersionRowSha256: plan.assetVersion?.rowSha256 ?? null, bindingRowSha256: plan.binding?.rowSha256 ?? null, sourceRowSha256s: plan.sourceRows.map((row) => row.rowSha256) }, authority: { qaPreview: false as const, runtime: false as const, publicLive: false as const, recommended: false as const, catalog: false as const, deployment: false as const, publication: false as const, G1: false as const, G2: false as const, G3: false as const, G4: false as const, G5: false as const, G6: false as const, G7: false as const } };
  return frozen({ ...body, receiptSha256: await sha256Hex(canonicalJson({ domain: "jessica/non-proxy-qa/committed-receipt/v1", body })) });
}

export function createTrustedNonProxyQaPersistenceWriter(dependencies: WriterDependencies): TrustedNonProxyQaPersistenceWriter {
  const maximumAttempts = dependencies.maximumTransactionAttempts ?? 3; if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 5) throw new TypeError("invalid transaction retry budget");
  return frozen({
    write(actorRequestIdentity: unknown, rawHumanQaRequest: unknown, signal?: AbortSignal): Promise<NonProxyQaPersistenceReceipt> {
      // This is intentionally before the first promise/await and before authentication.
      if (typeof actorRequestIdentity !== "string" || actorRequestIdentity.length < 1 || actorRequestIdentity.length > 4096 || /[\u0000-\u001f\u007f]/.test(actorRequestIdentity)) return Promise.reject(new NonProxyQaWriterError("UNAUTHENTICATED")); const actorIdentity = actorRequestIdentity;
      let raw: Readonly<{ humanQaRequest: unknown }>;
      try { raw = snapshotNonProxyQaPersistenceRequest({ humanQaRequest: rawHumanQaRequest }); } catch { return Promise.reject(new NonProxyQaWriterError("DENIED")); }
      return (async () => {
        cancelled(signal);
        let authenticated: NonProxyQaAuthenticatedActor | null;
        try { authenticated = await dependencies.authenticate(actorIdentity); } catch { throw new NonProxyQaWriterError("UNAUTHENTICATED"); }
        if (authenticated === null) throw new NonProxyQaWriterError("UNAUTHENTICATED"); const actor = exactActor(authenticated); let selection: NonProxyQaWriterSelection; try { selection = selectionFrom(raw, actor); } catch { throw new NonProxyQaWriterError("DENIED"); } cancelled(signal);
        for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
          let attemptedPlan: NonProxyQaPersistencePlan | null = null;
          try {
            return await dependencies.database.serializable(selection, async (transaction) => {
              cancelled(signal); const observedAt = await transaction.transactionTimestamp(); cancelled(signal);
              let humanQaContext: unknown;
              try { humanQaContext = snapshotNonProxyQaPersistenceHostContext(dependencies.humanQaContextAt(observedAt)); } catch { throw new NonProxyQaWriterError("DENIED"); }
              const reviewPolicy = await reviewPolicyFrom(humanQaContext);
              const controlPlaneSnapshot = await transaction.readControlPlaneSnapshot(selection, observedAt, reviewPolicy); cancelled(signal);
              const plan = await evaluateNonProxyQaPersistencePlan(raw, { humanQaContext, controlPlaneSnapshot }); attemptedPlan = plan; cancelled(signal);
              if (controlPlaneSnapshot.existingRows.reviewRecord !== null) { if (!await transaction.verifyExact(plan)) throw new NonProxyQaWriterError("DENIED"); cancelled(signal); const committedAt = await transaction.finalRecheck(plan); cancelled(signal); const exactReceipt = await receipt(plan, committedAt, "exact-retry"); cancelled(signal); return exactReceipt; }
              await transaction.insertReviewRecord(plan.reviewRecord); cancelled(signal);
              if (plan.assetVersion && plan.binding) {
                await transaction.insertAssetVersionInReview(plan.assetVersion); cancelled(signal);
                for (const source of [...plan.sourceRows].sort((left, right) => left.sourceSha256.localeCompare(right.sourceSha256))) { await transaction.insertAssetVersionSource(source); cancelled(signal); }
                await transaction.insertBinding(plan.binding); cancelled(signal); await transaction.approveAssetVersion(plan.assetVersion); cancelled(signal);
              }
              if (!await transaction.verifyExact(plan)) throw new NonProxyQaWriterError("DENIED"); cancelled(signal); const committedAt = await transaction.finalRecheck(plan); cancelled(signal); const insertedReceipt = await receipt(plan, committedAt, "inserted"); cancelled(signal);
              return insertedReceipt;
            }, async (transaction) => { cancelled(signal); if (!attemptedPlan) throw new NonProxyQaWriterError("DENIED"); await transaction.finalRecheck(attemptedPlan); cancelled(signal); });
          } catch (error) {
            if (error instanceof NonProxyQaWriterError) throw error; const portError = safePortError(error);
            if (portError?.kind === "commit-outcome-unknown") {
              if (attemptedPlan) { try { const committedAt = await dependencies.database.verifyCommittedExact(attemptedPlan); if (committedAt) return receipt(attemptedPlan, committedAt, "recovered-exact-commit"); } catch { /* closed below */ } }
              throw new NonProxyQaWriterError("COMMIT_OUTCOME_UNPROVEN");
            }
            if (portError?.kind === "retryable" && attempt < maximumAttempts) { cancelled(signal); continue; }
            if (error instanceof TypeError) throw new NonProxyQaWriterError("DENIED");
            throw new NonProxyQaWriterError("DATABASE_UNAVAILABLE");
          }
        }
        throw new NonProxyQaWriterError("DATABASE_UNAVAILABLE");
      })();
    },
  });
}
