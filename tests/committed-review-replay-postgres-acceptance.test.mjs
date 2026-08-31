import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const REQUIRED = process.env.JESSICA_POSTGRES_ACCEPTANCE_REQUIRED === "1";
const PHASE = process.env.JESSICA_POSTGRES_REPLAY_ACCEPTANCE_PHASE;
const DATABASE_URL = process.env.JESSICA_POSTGRES_REPLAY_ACCEPTANCE_URL;
const CONNECTION_TIMEOUT_MS = 5_000;
const WAIT_BUDGET_MS = 5_000;
const TABLE = "private.committed_review_qa_preview_replay_claims";
const ROLE = "jessica_committed_review_qa_preview_replay_claimer";
const RESTART_GRANT_ID = "f".repeat(64);

const digest = (value) => createHash("sha256").update(value).digest("hex");

async function eventually(probe, label, budgetMs = WAIT_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`${label} was not observed${last ? `: ${last.message}` : ""}`);
}

async function within(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${WAIT_BUDGET_MS}ms`)), WAIT_BUDGET_MS); });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}

async function databaseClock(pool) {
  const value = (await pool.query("select clock_timestamp() as observed_at")).rows[0]?.observed_at;
  assert.equal(value instanceof Date, true);
  return value;
}

async function bootstrap(adminPool) {
  const preflight = await adminPool.query(`
    select current_database() as database_name,
      current_setting('server_version_num')::integer as server_version_num,
      to_regnamespace('private') is null as private_schema_absent,
      not exists (
        select 1 from pg_catalog.pg_roles
        where rolname in ('anon','authenticated','service_role','qa_internal_admin',
          'jessica_non_proxy_qa_writer','jessica_committed_review_qa_preview_reader','${ROLE}')
      ) as roles_absent,
      not exists (
        select 1 from pg_catalog.pg_namespace
        where nspname !~ '^pg_' and nspname not in ('information_schema','public')
      ) as user_schemas_absent,
      not exists (
        select 1 from pg_catalog.pg_class class
        join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace
        where namespace.nspname='public'
      ) as public_classes_absent
  `);
  assert.deepEqual(preflight.rows, [{
    database_name: "jessica_acceptance",
    server_version_num: preflight.rows[0].server_version_num,
    private_schema_absent: true,
    roles_absent: true,
    user_schemas_absent: true,
    public_classes_absent: true,
  }]);
  assert.ok(preflight.rows[0].server_version_num >= 170000 && preflight.rows[0].server_version_num < 180000);
  await adminPool.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role qa_internal_admin nologin superuser;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    "20260811071257_control_plane_publication_v1.sql",
    "20260821142538_non_proxy_qa_control_plane_persistence_v2.sql",
    "20260821155309_trusted_non_proxy_qa_writer_v3.sql",
    "20260822013928_committed_review_qa_preview_reader.sql",
    "20260830235937_committed_review_qa_preview_replay_claims.sql",
  ]);
  for (const name of migrations) await adminPool.query(await readFile(new URL(name, migrationDirectory), "utf8"));
}

function replayStore(assetReview, sessions, label) {
  let sequence = 0;
  return assetReview.createCommittedReviewQaPreviewPostgresReplayStore({
    sessions,
    createClaimAttemptId: () => digest(`${label}:${sequence += 1}`),
  });
}

async function claimAt(store, adminPool, grantId, expiryOffsetMs = 60_000) {
  const observedAt = await databaseClock(adminPool);
  const expiresAt = new Date(observedAt.getTime() + expiryOffsetMs).toISOString();
  return { observedAt, expiresAt, claimed: await store.claim(grantId, expiresAt, observedAt.toISOString()) };
}

async function roleRejects(adminPool, sql, parameters = []) {
  const client = await adminPool.connect();
  let error;
  try {
    await client.query("begin");
    await client.query(`set local role ${ROLE}`);
    await client.query(sql, parameters);
  } catch (caught) { error = caught; }
  finally { await client.query("rollback").catch(() => {}); client.release(); }
  assert.ok(error);
  assert.match(String(error.message), /permission denied|row-level security|check constraint/);
}

function wrappedSessions(raw, wrapLease) {
  return Object.freeze({ withPinnedSession: (callback) => raw.withPinnedSession((lease) => callback(wrapLease(lease))) });
}

test("PostgreSQL 17 durable replay claims prove CAS, expiry, recovery, session cleanup, permanent tombstones, and role isolation", { skip: !(REQUIRED && PHASE === "before-restart") }, async (t) => {
  assert.equal(typeof DATABASE_URL, "string");
  const [{ Pool }, assetReview] = await Promise.all([
    import("pg"),
    import("../dist/packages/asset-review/src/index.js"),
  ]);
  assert.equal(typeof assetReview.createPgPoolPinnedSessionProvider, "function");
  assert.equal(typeof assetReview.createCommittedReviewQaPreviewPostgresReplayStore, "function");
  const adminPool = new Pool({ connectionString: DATABASE_URL, max: 12, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-admin" });
  try {
    await bootstrap(adminPool);

    await t.test("dedicated credentialless role has only exact column grants and cannot mutate tombstones", async () => {
      const role = (await adminPool.query(`
        select role.rolsuper,role.rolinherit,role.rolcreaterole,role.rolcreatedb,
          role.rolcanlogin,role.rolreplication,role.rolbypassrls,
          authority.rolpassword is null as password_absent
        from pg_catalog.pg_roles role
        join pg_catalog.pg_authid authority on authority.oid=role.oid
        where role.rolname=$1
      `, [ROLE])).rows[0];
      assert.deepEqual(role, { rolsuper: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false, rolreplication: false, rolbypassrls: false, password_absent: true });
      const privileges = (await adminPool.query(`
        select column_name,privilege_type from information_schema.column_privileges
        where table_schema='private' and table_name='committed_review_qa_preview_replay_claims' and grantee=$1
        order by privilege_type,column_name
      `, [ROLE])).rows;
      assert.deepEqual(privileges, [
        { column_name: "claim_attempt_id", privilege_type: "INSERT" },
        { column_name: "expires_at", privilege_type: "INSERT" },
        { column_name: "expires_at_canonical", privilege_type: "INSERT" },
        { column_name: "grant_id", privilege_type: "INSERT" },
        { column_name: "claim_attempt_id", privilege_type: "SELECT" },
        { column_name: "expires_at_canonical", privilege_type: "SELECT" },
        { column_name: "grant_id", privilege_type: "SELECT" },
      ]);
      assert.equal((await adminPool.query(`select has_schema_privilege($1,'private','USAGE') and not has_schema_privilege($1,'private','CREATE') as exact`, [ROLE])).rows[0].exact, true);
      assert.equal((await adminPool.query(`select count(*)::int as count from pg_catalog.pg_auth_members where roleid=$1::regrole or member=$1::regrole`, [ROLE])).rows[0].count, 0);
      assert.equal((await adminPool.query(`select count(*)::int as count from pg_catalog.pg_class where relowner=$1::regrole`, [ROLE])).rows[0].count, 0);
      assert.equal((await adminPool.query(`select count(*)::int as count from information_schema.routine_privileges where grantee=$1 and routine_schema='private'`, [ROLE])).rows[0].count, 0);
      for (const deniedRole of ["PUBLIC", "anon", "authenticated", "service_role", "jessica_non_proxy_qa_writer", "jessica_committed_review_qa_preview_reader"]) {
        assert.equal((await adminPool.query(`
          select count(*)::int as count from information_schema.column_privileges
          where table_schema='private' and table_name='committed_review_qa_preview_replay_claims' and grantee=$1
        `, [deniedRole])).rows[0].count, 0, deniedRole);
      }
      await roleRejects(adminPool, `update ${TABLE} set expires_at=expires_at`);
      await roleRejects(adminPool, `delete from ${TABLE}`);
      await roleRejects(adminPool, `truncate ${TABLE}`);
      await roleRejects(adminPool, `select claimed_at from ${TABLE}`);
      const boundaryId = digest("exact-database-boundary-direct-insert");
      await roleRejects(adminPool, `
        with boundary as (select date_trunc('milliseconds',pg_catalog.clock_timestamp()) as value)
        insert into ${TABLE}(grant_id,claim_attempt_id,expires_at,expires_at_canonical)
        select $1,$2,value,to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from boundary
      `, [boundaryId, digest("exact-database-boundary-attempt")]);
      assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [boundaryId])).rows[0].count, 0);
    });

    await t.test("distinct backend PIDs race one grant to exactly one durable winner", async () => {
      const applicationName = "jessica-jsc-0221b-concurrency";
      const pool = new Pool({ connectionString: DATABASE_URL, max: 8, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: applicationName });
      const pids = new Set(); pool.on("acquire", (client) => pids.add(client.processID));
      const provider = assetReview.createPgPoolPinnedSessionProvider(pool);
      const store = replayStore(assetReview, provider, "concurrency");
      const grantId = digest("concurrent-grant"); const observedAt = await databaseClock(adminPool); const expiresAt = new Date(observedAt.getTime() + 60_000).toISOString();
      const blocker = await adminPool.connect();
      try {
        await blocker.query("begin"); await blocker.query(`lock table ${TABLE} in access exclusive mode`);
        const claims = Array.from({ length: 16 }, () => store.claim(grantId, expiresAt, observedAt.toISOString()));
        claims.forEach((claim) => claim.catch(() => {}));
        await eventually(async () => Number((await adminPool.query(`select count(distinct pid)::int as count from pg_catalog.pg_stat_activity where application_name=$1 and wait_event_type='Lock'`, [applicationName])).rows[0].count) >= 2, "multiple replay claim backends waiting");
        await blocker.query("commit");
        const outcomes = await within(Promise.all(claims), "concurrent replay claims");
        assert.equal(outcomes.filter(Boolean).length, 1); assert.equal(outcomes.filter((value) => !value).length, 15);
        assert.ok(pids.size >= 2);
      } finally { await blocker.query("rollback").catch(() => {}); blocker.release(); await pool.end(); }
      const rows = await adminPool.query(`select grant_id,count(*)::int as count from ${TABLE} where grant_id=$1 group by grant_id`, [grantId]);
      assert.deepEqual(rows.rows, [{ grant_id: grantId, count: 1 }]);
    });

    await t.test("a claim waiting across expiry is denied and creates no tombstone", async () => {
      const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-wait-expiry" });
      const store = replayStore(assetReview, assetReview.createPgPoolPinnedSessionProvider(pool), "wait-expiry");
      const grantId = digest("wait-across-expiry"); const observedAt = await databaseClock(adminPool); const expiresAt = new Date(observedAt.getTime() + 750).toISOString();
      const blocker = await adminPool.connect();
      try {
        await blocker.query("begin"); await blocker.query(`lock table ${TABLE} in access exclusive mode`);
        const claim = store.claim(grantId, expiresAt, observedAt.toISOString()); claim.catch(() => {});
        await eventually(async () => Number((await adminPool.query(`select count(*)::int as count from pg_catalog.pg_stat_activity where application_name='jessica-jsc-0221b-wait-expiry' and wait_event_type='Lock'`)).rows[0].count) === 1, "expiry claim lock wait");
        await eventually(async () => (await databaseClock(adminPool)).getTime() >= Date.parse(expiresAt), "replay claim expiry", 2_000);
        await blocker.query("commit");
        await assert.rejects(within(claim, "expired blocked claim"), assetReview.CommittedReviewQaPreviewPostgresReplayStoreError);
      } finally { await blocker.query("rollback").catch(() => {}); blocker.release(); await pool.end(); }
      assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [grantId])).rows[0].count, 0);
    });

    await t.test("normal CAS uses a fresh database clock and a committed conflict is false", async () => {
      const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-normal" });
      try {
        const provider = assetReview.createPgPoolPinnedSessionProvider(pool);
        const sessionState = () => provider.withPinnedSession(async ({ session }) => (await session.query("select current_user,session_user,current_setting('search_path') as search_path,current_setting('lock_timeout') as lock_timeout,current_setting('statement_timeout') as statement_timeout")).rows[0]);
        const cleanBefore = await sessionState();
        const store = replayStore(assetReview, provider, "normal");
        const grantId = digest("normal-cas"); const result = await claimAt(store, adminPool, grantId);
        assert.equal(result.claimed, true);
        const stored = (await adminPool.query(`select grant_id,expires_at,expires_at_canonical,claimed_at,claimed_at < expires_at as fresh from ${TABLE} where grant_id=$1`, [grantId])).rows[0];
        assert.equal(stored.grant_id, grantId); assert.equal(stored.expires_at.toISOString(), result.expiresAt); assert.equal(stored.expires_at_canonical, result.expiresAt); assert.equal(stored.fresh, true);
        assert.equal(await store.claim(grantId, result.expiresAt, (await databaseClock(adminPool)).toISOString()), false);
        const boundary = await databaseClock(adminPool); const boundaryGrant = digest("adapter-exact-expiry-boundary");
        await assert.rejects(store.claim(boundaryGrant, boundary.toISOString(), boundary.toISOString()), assetReview.CommittedReviewQaPreviewPostgresReplayStoreError);
        assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [boundaryGrant])).rows[0].count, 0);
        const cleanAfter = await sessionState(); assert.deepEqual(cleanAfter, cleanBefore); assert.equal(cleanAfter.current_user, cleanAfter.session_user); assert.equal(cleanAfter.lock_timeout, "0"); assert.equal(cleanAfter.statement_timeout, "0");
      } finally { await pool.end(); }
    });

    await t.test("a confirmed transaction rollback leaves no claim and a later CAS can commit", async () => {
      const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-rollback" });
      const acquired = []; pool.on("acquire", (client) => acquired.push(client.processID));
      const store = replayStore(assetReview, assetReview.createPgPoolPinnedSessionProvider(pool), "rollback"); const grantId = digest("rolled-back-claim");
      const observedAt = await databaseClock(adminPool); const expiresAt = new Date(observedAt.getTime() + 60_000).toISOString(); const rolledBackAttempt = digest("rolled-back-attempt");
      const transaction = await adminPool.connect();
      try {
        await transaction.query("begin"); await transaction.query(`set local role ${ROLE}`);
        await transaction.query(`insert into ${TABLE}(grant_id,claim_attempt_id,expires_at,expires_at_canonical) values($1,$2,$3::timestamptz,$4)`, [grantId, rolledBackAttempt, expiresAt, expiresAt]);
        await transaction.query("rollback");
        assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [grantId])).rows[0].count, 0);
        assert.equal((await claimAt(store, adminPool, grantId)).claimed, true);
        assert.equal(new Set(acquired).size, 1);
      } finally { await transaction.query("rollback").catch(() => {}); transaction.release(); await pool.end(); }
    });

    await t.test("lost COMMIT acknowledgement destroys the old PID and exact recovery succeeds on a fresh PID", async () => {
      const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-lost-ack" });
      const acquired = []; pool.on("acquire", (client) => acquired.push(client.processID));
      const raw = assetReview.createPgPoolPinnedSessionProvider(pool); let armed = true;
      const sessions = wrappedSessions(raw, (lease) => Object.freeze({ discard: lease.discard, session: Object.freeze({
        transaction: (work) => lease.session.transaction(work),
        query: async (sql, parameters = []) => {
          const value = await lease.session.query(sql, parameters);
          if (armed && String(sql).toLowerCase().startsWith("insert into private.committed_review_qa_preview_replay_claims")) { armed = false; throw Object.assign(new Error("lost COMMIT acknowledgement"), { code: "08006" }); }
          return value;
        },
      }) }));
      const store = replayStore(assetReview, sessions, "lost-ack"); const grantId = digest("lost-ack-claim");
      try {
        assert.equal((await claimAt(store, adminPool, grantId)).claimed, true);
        assert.ok(acquired.length >= 2); assert.notEqual(acquired[0], acquired.at(-1));
        assert.equal(pool.totalCount, 1); assert.equal(pool.idleCount, 1);
        assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [grantId])).rows[0].count, 1);
        const conflict = await claimAt(store, adminPool, grantId); assert.equal(conflict.claimed, false);
      } finally { await pool.end(); }
    });

    await t.test("backend termination rolls back the insert, destroys the lease, and reconnects on a fresh PID", async () => {
      const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-terminate" });
      const acquired = []; pool.on("acquire", (client) => acquired.push(client.processID));
      const store = replayStore(assetReview, assetReview.createPgPoolPinnedSessionProvider(pool), "terminate"); const rolledBackGrant = digest("backend-terminated-claim");
      const observedAt = await databaseClock(adminPool); const expiresAt = new Date(observedAt.getTime() + 60_000).toISOString(); const blocker = await adminPool.connect(); let terminatedPid;
      try {
        await blocker.query("begin"); await blocker.query(`lock table ${TABLE} in access exclusive mode`);
        const claim = store.claim(rolledBackGrant, expiresAt, observedAt.toISOString()); claim.catch(() => {});
        await eventually(async () => {
          const waiting = await adminPool.query(`select pid from pg_catalog.pg_stat_activity where application_name='jessica-jsc-0221b-terminate' and wait_event_type='Lock'`);
          if (waiting.rows.length !== 1) return false;
          terminatedPid = Number(waiting.rows[0].pid); return Number.isInteger(terminatedPid);
        }, "terminated replay insert lock wait");
        const answer = await adminPool.query("select pg_catalog.pg_terminate_backend($1) as terminated", [terminatedPid]); assert.equal(answer.rows[0].terminated, true);
        await blocker.query("commit");
        assert.equal(await within(claim, "backend termination recovery"), true);
        assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [rolledBackGrant])).rows[0].count, 1);
        assert.notEqual(acquired.at(-1), terminatedPid);
        assert.ok(new Set(acquired).size >= 2);
      } finally { await blocker.query("rollback").catch(() => {}); blocker.release(); await pool.end(); }
    });

    await t.test("restart fixture stores one permanent tombstone and the original postmaster identity", async () => {
      const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-restart-seed" });
      try {
        const store = replayStore(assetReview, assetReview.createPgPoolPinnedSessionProvider(pool), "restart-seed");
        assert.equal((await claimAt(store, adminPool, RESTART_GRANT_ID, 119_000)).claimed, true);
        await adminPool.query("create table public.jsc_0221b_restart_marker(postmaster_started_at timestamptz not null)");
        await adminPool.query("insert into public.jsc_0221b_restart_marker values(pg_catalog.pg_postmaster_start_time())");
      } finally { await pool.end(); }
    });
  } finally { await adminPool.end(); }
});

test("a PostgreSQL service restart preserves the replay tombstone and rejects it from a new pool", { skip: !(REQUIRED && PHASE === "after-restart") }, async () => {
  assert.equal(typeof DATABASE_URL, "string");
  const [{ Pool }, assetReview] = await Promise.all([import("pg"), import("../dist/packages/asset-review/src/index.js")]);
  const adminPool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-restart-verify" });
  const claimPool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0221b-restart-claim" });
  try {
    const version = Number((await adminPool.query("select current_setting('server_version_num')::integer as version")).rows[0].version);
    assert.ok(version >= 170000 && version < 180000);
    const marker = (await adminPool.query("select postmaster_started_at,pg_catalog.pg_postmaster_start_time() as current_started_at from public.jsc_0221b_restart_marker")).rows[0];
    assert.ok(marker.current_started_at.getTime() > marker.postmaster_started_at.getTime(), "the PostgreSQL postmaster really restarted");
    assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [RESTART_GRANT_ID])).rows[0].count, 1);
    const store = replayStore(assetReview, assetReview.createPgPoolPinnedSessionProvider(claimPool), "restart-verify");
    const row = (await adminPool.query(`select expires_at_canonical from ${TABLE} where grant_id=$1`, [RESTART_GRANT_ID])).rows[0];
    assert.equal(await store.claim(RESTART_GRANT_ID, row.expires_at_canonical, (await databaseClock(adminPool)).toISOString()), false);
    assert.equal((await adminPool.query(`select count(*)::int as count from ${TABLE} where grant_id=$1`, [RESTART_GRANT_ID])).rows[0].count, 1);
  } finally { await Promise.allSettled([claimPool.end(), adminPool.end()]); }
});
