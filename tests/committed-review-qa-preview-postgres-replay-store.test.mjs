import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  CommittedReviewQaPreviewPostgresReplayStoreError,
  createCommittedReviewQaPreviewPostgresReplayStore,
} from "../dist/packages/asset-review/src/index.js";

const H = (character) => character.repeat(64);
const NOW = "2030-08-22T00:00:00.000Z";
const FUTURE = "2099-08-22T00:00:00.000Z";
const EXPIRED = "2000-08-22T00:00:00.000Z";
const unavailable = (error) => error instanceof CommittedReviewQaPreviewPostgresReplayStoreError
  && error.message === "QA-preview replay claim was unavailable"
  && !JSON.stringify(error).includes("grant");

function pgliteProvider(database) {
  let calls = 0;
  return {
    get calls() { return calls; },
    provider: Object.freeze({
      async withPinnedSession(work) {
        calls += 1;
        const session = Object.freeze({
          async query(sql, parameters = []) {
            const result = await database.query(sql, parameters);
            return Object.freeze({ rows: result.rows, affectedRows: result.affectedRows ?? result.rows.length });
          },
          async transaction(callback) { return database.transaction((transaction) => callback({ query: (sql, parameters = []) => transaction.query(sql, parameters) })); },
        });
        return work(Object.freeze({ session, async discard() {} }));
      },
    }),
  };
}

async function pgliteHarness() {
  const database = new PGlite(); await database.waitReady;
  await database.exec(`
    create schema private;
    create role jessica_committed_review_qa_preview_replay_claimer nologin noinherit;
    create table private.committed_review_qa_preview_replay_claims (
      grant_id text primary key check (grant_id ~ '^[a-f0-9]{64}$'),
      claim_attempt_id text not null unique check (claim_attempt_id ~ '^[a-f0-9]{64}$'),
      expires_at timestamptz not null,
      expires_at_canonical text not null,
      claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
      check (expires_at_canonical::timestamptz = expires_at),
      check (claimed_at < expires_at and expires_at <= claimed_at + interval '2 minutes')
    );
    alter table private.committed_review_qa_preview_replay_claims enable row level security;
    alter table private.committed_review_qa_preview_replay_claims force row level security;
    create policy replay_insert on private.committed_review_qa_preview_replay_claims for insert
      to jessica_committed_review_qa_preview_replay_claimer
      with check (claimed_at <= pg_catalog.clock_timestamp() and pg_catalog.clock_timestamp() < expires_at);
    create policy replay_select on private.committed_review_qa_preview_replay_claims for select
      to jessica_committed_review_qa_preview_replay_claimer using (true);
    grant usage on schema private to jessica_committed_review_qa_preview_replay_claimer;
    grant insert (grant_id,claim_attempt_id,expires_at,expires_at_canonical)
      on private.committed_review_qa_preview_replay_claims to jessica_committed_review_qa_preview_replay_claimer;
    grant select (grant_id,claim_attempt_id,expires_at_canonical)
      on private.committed_review_qa_preview_replay_claims to jessica_committed_review_qa_preview_replay_claimer;
  `);
  const sessions = pgliteProvider(database);
  return { database, sessions, close: () => database.close() };
}

test("durable claim needs an acknowledged CAS and a later fresh-session DB-clock validation", async () => {
  const h = await pgliteHarness(); let attempts = 0;
  try {
    const liveExpiry = new Date(Date.now() + 60_000).toISOString();
    const store = createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.sessions.provider, createClaimAttemptId: () => H(String(++attempts)) });
    assert.equal(await store.claim(H("a"), liveExpiry, NOW), true);
    assert.equal(h.sessions.calls, 2, "mutation observation is not sufficient authority");
    assert.equal(await store.claim(H("a"), liveExpiry, NOW), false);
    assert.equal(h.sessions.calls, 3, "a different durable attempt is replay, not success");
    const rows = await h.database.query("select grant_id,claim_attempt_id from private.committed_review_qa_preview_replay_claims");
    assert.deepEqual(rows.rows, [{ grant_id: H("a"), claim_attempt_id: H("1") }]);

    const afterRestart = createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.sessions.provider, createClaimAttemptId: () => H("f") });
    assert.equal(await afterRestart.claim(H("a"), liveExpiry, "1999-01-01T00:00:00.000Z"), false, "host observedAt cannot reopen a durable tombstone");
    await assert.rejects(store.claim(H("b"), EXPIRED, FUTURE), unavailable);
    assert.equal((await h.database.query("select count(*)::int as count from private.committed_review_qa_preview_replay_claims where grant_id=$1", [H("b")])).rows[0].count, 0);
  } finally { await h.close(); }
});

function fakeProvider(options = {}) {
  let row = options.initialRow ?? null; let calls = 0; const discarded = []; const attemptIds = [];
  const provider = Object.freeze({
    async withPinnedSession(work) {
      calls += 1; const call = calls; let discardedHere = false;
      const lease = Object.freeze({
        session: Object.freeze({
          async query(sql, parameters = []) {
            if (sql.startsWith("insert into")) {
              attemptIds.push(parameters[1]);
              const insertedNow = !row && options.insert !== false;
              if (insertedNow) row = { grant_id: parameters[0], claim_attempt_id: parameters[1], expires_at_canonical: parameters[2] };
              if (options.failInsertCall === call) throw new Error("private SQL detail");
              return { rows: insertedNow ? [{ ...row }] : [], affectedRows: insertedNow ? 1 : 0 };
            }
            if (sql.startsWith("select grant_id")) {
              if (options.failObserveCall === call) throw new Error("private row detail");
              if (!row) return { rows: [], affectedRows: 0 };
              const candidate = { ...row, unexpired: options.expiredOnCall === call ? false : true };
              if (options.mutateRowOnCall === call) options.mutateRowOnCallValue?.(candidate);
              return { rows: options.multirowOnCall === call ? [candidate, { ...candidate }] : [candidate], affectedRows: options.badAffectedRowsOnCall === call ? -1 : 1 };
            }
            return { rows: [], affectedRows: 0 };
          },
          async transaction() { throw new Error("transactions are forbidden in the replay store"); },
        }),
        async discard() { discardedHere = true; discarded.push(call); },
      });
      const value = await work(lease);
      if (options.failCheckinCall === call) throw new Error("lost acknowledgement");
      if (discardedHere) throw new Error("discarded lease");
      return value;
    },
  });
  return { provider, get calls() { return calls; }, get row() { return row; }, discarded, attemptIds };
}

test("lost acknowledgement discards, recovers with the same attempt, then validates on another session", async () => {
  const h = fakeProvider({ failCheckinCall: 1 });
  const store = createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider, createClaimAttemptId: () => H("7") });
  assert.equal(await store.claim(H("a"), FUTURE, NOW), true);
  assert.equal(h.calls, 3);
  assert.deepEqual(h.attemptIds, [H("7"), H("7")]);
  assert.equal(h.discarded.includes(1), true);
});

test("ambiguous recovery, malformed/no/multiple/expired validation, and hostile results never become true", async () => {
  for (const options of [
    { failCheckinCall: 1, failInsertCall: 2 },
    { expiredOnCall: 2 },
    { multirowOnCall: 2 },
    { badAffectedRowsOnCall: 2 },
    { mutateRowOnCall: 2, mutateRowOnCallValue: (row) => { row.expires_at_canonical = "2098-01-01T00:00:00.000Z"; } },
  ]) {
    const h = fakeProvider(options); const store = createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider, createClaimAttemptId: () => H("8") });
    await assert.rejects(store.claim(H("b"), FUTURE, NOW), unavailable, JSON.stringify(options));
  }
  const noRow = fakeProvider({ insert: false });
  assert.equal(await createCommittedReviewQaPreviewPostgresReplayStore({ sessions: noRow.provider, createClaimAttemptId: () => H("9") }).claim(H("b"), FUTURE, NOW), false);
});

test("an acknowledged repeated 256-bit attempt ID is replay on the same or a different grant", async () => {
  const h = fakeProvider(); const store = createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider, createClaimAttemptId: () => H("d") });
  assert.equal(await store.claim(H("a"), FUTURE, NOW), true);
  assert.equal(await store.claim(H("a"), FUTURE, NOW), false);
  assert.equal(await store.claim(H("b"), FUTURE, NOW), false, "global attempt-id collision cannot adopt another grant");
});

test("input, CSPRNG, SQL, cleanup, and undefined failures are redacted and never use host time as authority", async () => {
  const h = fakeProvider();
  for (const invoke of [
    () => createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider, createClaimAttemptId: () => "bad" }).claim(H("c"), FUTURE, NOW),
    () => createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider, createClaimAttemptId: () => { throw undefined; } }).claim(H("c"), FUTURE, NOW),
    () => createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider }).claim("BAD", FUTURE, NOW),
    () => createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider }).claim(H("c"), "not-time", NOW),
    () => createCommittedReviewQaPreviewPostgresReplayStore({ sessions: h.provider }).claim(H("c"), FUTURE, "not-time"),
  ]) await assert.rejects(invoke(), unavailable);
});
