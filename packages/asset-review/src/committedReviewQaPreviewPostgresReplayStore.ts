/**
 * Durable PostgreSQL replay store for JSC-0221B.
 *
 * The mutation and the authoritative decision deliberately use separate pinned
 * session calls.  An INSERT/RETURNING row, a row observed in the mutation
 * session, or an uncommitted transaction is never sufficient runtime authority.
 */
import type { CommittedReviewQaPreviewTransportReplayStore } from "./committedReviewQaPreviewTransport.js";
import type { NonProxyQaPinnedSession, NonProxyQaPinnedSessionLease, NonProxyQaPinnedSessionProvider } from "./nonProxyQaPgliteWriterDatabase.js";

export class CommittedReviewQaPreviewPostgresReplayStoreError extends Error {
  constructor() {
    super("QA-preview replay claim was unavailable");
    this.name = "CommittedReviewQaPreviewPostgresReplayStoreError";
  }
}

export type CommittedReviewQaPreviewPostgresReplayStoreDependencies = Readonly<{
  sessions: NonProxyQaPinnedSessionProvider;
  /** Test seam only. Production omits this and uses crypto.getRandomValues. */
  createClaimAttemptId?: () => string;
}>;

const HASH = /^[a-f0-9]{64}$/;
const RESULT_KEYS = new Set(["rows", "affectedRows"]);
const ROW_KEYS = ["grant_id", "claim_attempt_id", "expires_at_canonical", "unexpired"] as const;
const INSERT_ROW_KEYS = ["grant_id", "claim_attempt_id", "expires_at_canonical"] as const;
const SETUP = Object.freeze([
  "set lock_timeout = '5s'",
  "set statement_timeout = '15s'",
  "set search_path = pg_catalog",
  "set role jessica_committed_review_qa_preview_replay_claimer",
]);
const CLEANUP = Object.freeze(["reset role", "reset search_path", "reset lock_timeout", "reset statement_timeout"]);
const INSERT = `insert into private.committed_review_qa_preview_replay_claims
  (grant_id,claim_attempt_id,expires_at,expires_at_canonical)
  values ($1,$2,$3::timestamptz,$4)
  on conflict do nothing
  returning grant_id,claim_attempt_id,expires_at_canonical`;
const OBSERVE = `select grant_id,claim_attempt_id,expires_at_canonical,
  pg_catalog.clock_timestamp() < $2::timestamptz as unexpired
  from private.committed_review_qa_preview_replay_claims
  where grant_id=$1
  limit 2`;

type Observation = "same-attempt" | "different-attempt";
type PhaseFailure = Readonly<{ ambiguous: boolean; knownReplay: boolean }>;

function failure(): CommittedReviewQaPreviewPostgresReplayStoreError {
  return new CommittedReviewQaPreviewPostgresReplayStoreError();
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") throw failure();
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) throw failure();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw failure();
  return value;
}

function defaultClaimAttemptId(): string {
  const value = new Uint8Array(32);
  try { globalThis.crypto.getRandomValues(value); } catch { throw failure(); }
  let result = "";
  for (const byte of value) result += byte.toString(16).padStart(2, "0");
  return hash(result);
}

function exactRow(value: unknown): Record<(typeof ROW_KEYS)[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw failure();
  const names = Reflect.ownKeys(value);
  if (names.length !== ROW_KEYS.length || names.some((name) => typeof name !== "string" || !ROW_KEYS.includes(name as (typeof ROW_KEYS)[number]))) throw failure();
  for (const key of ROW_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw failure();
  }
  return value as Record<(typeof ROW_KEYS)[number], unknown>;
}

function exactInsertRow(value: unknown): Record<(typeof INSERT_ROW_KEYS)[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw failure();
  const names = Reflect.ownKeys(value);
  if (names.length !== INSERT_ROW_KEYS.length || names.some((name) => typeof name !== "string" || !INSERT_ROW_KEYS.includes(name as (typeof INSERT_ROW_KEYS)[number]))) throw failure();
  for (const key of INSERT_ROW_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw failure();
  }
  return value as Record<(typeof INSERT_ROW_KEYS)[number], unknown>;
}

function resultRows(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw failure();
  const names = Reflect.ownKeys(value);
  if (names.length < 1 || names.length > 2 || names.some((name) => typeof name !== "string" || !RESULT_KEYS.has(name))) throw failure();
  for (const name of names as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw failure();
  }
  if (Object.hasOwn(value, "affectedRows")) {
    const affectedRows = (value as { affectedRows?: unknown }).affectedRows;
    if (typeof affectedRows !== "number" || !Number.isSafeInteger(affectedRows) || affectedRows < 0 || affectedRows > 2) throw failure();
  }
  const rowsDescriptor = Object.getOwnPropertyDescriptor(value, "rows");
  if (!rowsDescriptor || !Array.isArray(rowsDescriptor.value) || Object.getPrototypeOf(rowsDescriptor.value) !== Array.prototype || rowsDescriptor.value.length > 2 || Reflect.ownKeys(rowsDescriptor.value).length !== rowsDescriptor.value.length + 1) throw failure();
  return Array.from({ length: rowsDescriptor.value.length }, (_unused, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(rowsDescriptor.value, String(index));
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw failure();
    return descriptor.value;
  });
}

async function observe(session: NonProxyQaPinnedSession, grantId: string, expiresAt: string, attemptId: string): Promise<Observation> {
  const rows = resultRows(await session.query(OBSERVE, [grantId, expiresAt]));
  if (rows.length !== 1) throw failure();
  const row = exactRow(rows[0]);
  if (hash(row.grant_id) !== grantId || canonicalTimestamp(row.expires_at_canonical) !== expiresAt || row.unexpired !== true) throw failure();
  return hash(row.claim_attempt_id) === attemptId ? "same-attempt" : "different-attempt";
}

function inserted(value: unknown, grantId: string, expiresAt: string, attemptId: string): boolean {
  const rows = resultRows(value);
  if (rows.length > 1) throw failure();
  if (rows.length === 0) return false;
  const row = exactInsertRow(rows[0]);
  if (hash(row.grant_id) !== grantId || hash(row.claim_attempt_id) !== attemptId || canonicalTimestamp(row.expires_at_canonical) !== expiresAt) throw failure();
  return true;
}

async function discard(lease: NonProxyQaPinnedSessionLease | null): Promise<void> {
  try { await lease?.discard(); } catch { /* provider contract keeps it quarantined */ }
}

/** One autocommit CAS plus same-session observation; this result is not authority. */
async function casPhase(sessions: NonProxyQaPinnedSessionProvider, grantId: string, expiresAt: string, attemptId: string, recovery: boolean): Promise<Observation> {
  let leaseRef: NonProxyQaPinnedSessionLease | null = null;
  let insertDispatched = false;
  let conflictAcknowledged = false;
  let callbackCompleted = false;
  let providerCalls = 0;
  let observation!: Observation;
  const sentinel = Object.freeze({ phase: Object.freeze({}) });
  try {
    const returned = await sessions.withPinnedSession(async (lease) => {
      providerCalls += 1;
      if (providerCalls !== 1) { await discard(leaseRef); await discard(lease); throw failure(); }
      leaseRef = lease;
      let primaryPresent = false; let primary: unknown;
      try {
        for (const sql of SETUP) await lease.session.query(sql);
        insertDispatched = true;
        const ownsInsert = inserted(await lease.session.query(INSERT, [grantId, attemptId, expiresAt, expiresAt]), grantId, expiresAt, attemptId);
        conflictAcknowledged = !ownsInsert;
        // An acknowledged zero-row INSERT on an initial public call is replay,
        // even if a broken RNG repeated the original attempt ID. Only an
        // explicitly entered same-call recovery may adopt that exact row.
        observation = !ownsInsert && !recovery ? "different-attempt" : await observe(lease.session, grantId, expiresAt, attemptId);
      } catch (error) { primaryPresent = true; primary = error; }
      let cleanupFailed = false;
      for (const sql of CLEANUP) { try { await lease.session.query(sql); } catch { cleanupFailed = true; } }
      if (primaryPresent || cleanupFailed) {
        await discard(lease);
        if (primaryPresent) throw primary;
        throw failure();
      }
      callbackCompleted = true;
      return sentinel;
    });
    if (providerCalls !== 1 || !callbackCompleted || returned !== sentinel) { await discard(leaseRef); throw failure(); }
    return observation;
  } catch {
    await discard(leaseRef);
    throw Object.freeze({ ambiguous: insertDispatched && !conflictAcknowledged, knownReplay: conflictAcknowledged && !recovery } satisfies PhaseFailure);
  }
}

/** Later pinned-session DB-clock validation. This is the only path to true. */
async function validateFresh(sessions: NonProxyQaPinnedSessionProvider, grantId: string, expiresAt: string, attemptId: string): Promise<void> {
  let leaseRef: NonProxyQaPinnedSessionLease | null = null;
  let callbackCompleted = false;
  let providerCalls = 0;
  const sentinel = Object.freeze({ validation: Object.freeze({}) });
  try {
    const returned = await sessions.withPinnedSession(async (lease) => {
      providerCalls += 1;
      if (providerCalls !== 1) { await discard(leaseRef); await discard(lease); throw failure(); }
      leaseRef = lease;
      let primaryPresent = false; let primary: unknown;
      try {
        for (const sql of SETUP) await lease.session.query(sql);
        if (await observe(lease.session, grantId, expiresAt, attemptId) !== "same-attempt") throw failure();
      } catch (error) { primaryPresent = true; primary = error; }
      let cleanupFailed = false;
      for (const sql of CLEANUP) { try { await lease.session.query(sql); } catch { cleanupFailed = true; } }
      if (primaryPresent || cleanupFailed) {
        await discard(lease);
        if (primaryPresent) throw primary;
        throw failure();
      }
      callbackCompleted = true;
      return sentinel;
    });
    if (providerCalls !== 1 || !callbackCompleted || returned !== sentinel) { await discard(leaseRef); throw failure(); }
  } catch {
    await discard(leaseRef);
    throw failure();
  }
}

export function createCommittedReviewQaPreviewPostgresReplayStore(dependencies: CommittedReviewQaPreviewPostgresReplayStoreDependencies): CommittedReviewQaPreviewTransportReplayStore {
  if (typeof dependencies !== "object" || dependencies === null || typeof dependencies.sessions?.withPinnedSession !== "function" || (dependencies.createClaimAttemptId !== undefined && typeof dependencies.createClaimAttemptId !== "function")) throw new TypeError("invalid QA-preview PostgreSQL replay-store dependencies");
  const createClaimAttemptId = dependencies.createClaimAttemptId ?? defaultClaimAttemptId;
  return Object.freeze({
    async claim(rawGrantId: string, rawExpiresAt: string, rawObservedAt: string): Promise<boolean> {
      let grantId: string; let expiresAt: string; let attemptId: string;
      try {
        grantId = hash(rawGrantId);
        expiresAt = canonicalTimestamp(rawExpiresAt);
        canonicalTimestamp(rawObservedAt); // Host time is syntax-only; PostgreSQL is authoritative.
        attemptId = hash(createClaimAttemptId());
      } catch { throw failure(); }

      let first: Observation;
      try {
        first = await casPhase(dependencies.sessions, grantId, expiresAt, attemptId, false);
      } catch (error) {
        if (typeof error === "object" && error !== null && (error as PhaseFailure).knownReplay === true) return false;
        if (typeof error !== "object" || error === null || (error as PhaseFailure).ambiguous !== true) throw failure();
        // Same-attempt recovery may insert if the first autocommit did not, or
        // observe the exact durable row if its acknowledgement was lost.
        try { first = await casPhase(dependencies.sessions, grantId, expiresAt, attemptId, true); }
        catch { throw failure(); }
      }
      if (first === "different-attempt") return false;
      await validateFresh(dependencies.sessions, grantId, expiresAt, attemptId);
      return true;
    },
  });
}
