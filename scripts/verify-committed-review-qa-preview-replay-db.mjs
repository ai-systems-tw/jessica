import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationUrls = [
  new URL("../supabase/migrations/20260811071257_control_plane_publication_v1.sql", import.meta.url),
  new URL("../supabase/migrations/20260821142538_non_proxy_qa_control_plane_persistence_v2.sql", import.meta.url),
  new URL("../supabase/migrations/20260821155309_trusted_non_proxy_qa_writer_v3.sql", import.meta.url),
  new URL("../supabase/migrations/20260822013928_committed_review_qa_preview_reader.sql", import.meta.url),
  new URL("../supabase/migrations/20260830235937_committed_review_qa_preview_replay_claims.sql", import.meta.url),
];
const claimer = "jessica_committed_review_qa_preview_replay_claimer";
const table = "committed_review_qa_preview_replay_claims";
const grantId = "a".repeat(64);
const attemptId = "b".repeat(64);

async function scalar(db, sql) {
  const result = await db.query(sql);
  return Object.values(result.rows[0] ?? {})[0];
}

async function bootstrap(db) {
  await db.exec(`
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
}

async function asRole(db, role, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    const result = await db.query(sql);
    await db.exec("commit");
    return result;
  } catch (error) {
    try { await db.exec("rollback"); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

async function rejectsAsRole(db, role, sql, label, pattern = /permission denied|row-level security|violates check constraint|must be owner/) {
  let error = null;
  try { await asRole(db, role, sql); } catch (caught) { error = caught; }
  assert.ok(error, label);
  assert.match(String(error.message), pattern, label);
}

export async function verifyCommittedReviewQaPreviewReplayDatabaseAuthorization() {
  const migrations = await Promise.all(migrationUrls.map((url) => readFile(url, "utf8")));
  const v5 = migrations[4];
  const db = new PGlite();
  let assertions = 0;
  try {
    await bootstrap(db);
    for (const migration of migrations) await db.exec(migration);

    const role = (await db.query(`
      select rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
             rolreplication, rolbypassrls
      from pg_catalog.pg_roles where rolname='${claimer}'
    `)).rows[0];
    assert.deepEqual(role, {
      rolsuper: false, rolinherit: false, rolcreaterole: false,
      rolcreatedb: false, rolcanlogin: false, rolreplication: false,
      rolbypassrls: false,
    }); assertions++;
    assert.equal(await scalar(db, `select rolpassword is null from pg_catalog.pg_authid where rolname='${claimer}'`), true); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_auth_members where roleid='${claimer}'::regrole or member='${claimer}'::regrole`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_class where relowner='${claimer}'::regrole`), 0); assertions++;
    assert.equal(await scalar(db, `select has_schema_privilege('${claimer}','private','USAGE') and not has_schema_privilege('${claimer}','private','CREATE')`), true); assertions++;
    assert.equal(await scalar(db, `select not has_schema_privilege('${claimer}','api','USAGE') and not has_schema_privilege('${claimer}','api','CREATE')`), true); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.table_privileges where grantee='${claimer}'`), 0); assertions++;

    const columnPrivileges = (await db.query(`
      select column_name, privilege_type
      from information_schema.column_privileges
      where grantee='${claimer}' and table_schema='private' and table_name='${table}'
      order by column_name, privilege_type
    `)).rows;
    assert.deepEqual(columnPrivileges, [
      { column_name: "claim_attempt_id", privilege_type: "INSERT" },
      { column_name: "claim_attempt_id", privilege_type: "SELECT" },
      { column_name: "expires_at", privilege_type: "INSERT" },
      { column_name: "expires_at_canonical", privilege_type: "INSERT" },
      { column_name: "expires_at_canonical", privilege_type: "SELECT" },
      { column_name: "grant_id", privilege_type: "INSERT" },
      { column_name: "grant_id", privilege_type: "SELECT" },
    ]); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.column_privileges where grantee='${claimer}' and (table_schema <> 'private' or table_name <> '${table}')`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.routine_privileges where grantee='${claimer}' and routine_schema='private'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.usage_privileges where grantee='${claimer}' and object_schema='private'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_default_acl where coalesce(defaclacl::text,'') like '%${claimer}%'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('${claimer}',p.oid,'EXECUTE')`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and case when c.relkind='S' then has_sequence_privilege('${claimer}',c.oid,'USAGE,SELECT,UPDATE') else false end`), 0); assertions++;

    const columns = (await db.query(`
      select column_name, data_type, domain_name, is_nullable, column_default
      from information_schema.columns
      where table_schema='private' and table_name='${table}'
      order by ordinal_position
    `)).rows;
    assert.deepEqual(columns.map(({ column_name, data_type, domain_name, is_nullable }) => ({ column_name, data_type, domain_name, is_nullable })), [
      { column_name: "grant_id", data_type: "text", domain_name: "sha256", is_nullable: "NO" },
      { column_name: "claim_attempt_id", data_type: "text", domain_name: "sha256", is_nullable: "NO" },
      { column_name: "expires_at", data_type: "timestamp with time zone", domain_name: null, is_nullable: "NO" },
      { column_name: "expires_at_canonical", data_type: "text", domain_name: null, is_nullable: "NO" },
      { column_name: "claimed_at", data_type: "timestamp with time zone", domain_name: null, is_nullable: "NO" },
    ]); assertions++;
    assert.match(String(columns.find((column) => column.column_name === "claimed_at")?.column_default), /clock_timestamp\(\)/); assertions++;

    const constraints = (await db.query(`
      select contype, pg_get_constraintdef(oid, true) as definition
      from pg_catalog.pg_constraint
      where conrelid='private.${table}'::regclass
      order by contype, conname
    `)).rows;
    assert.equal(constraints.filter((constraint) => constraint.contype === "p").length, 1); assertions++;
    assert.equal(constraints.filter((constraint) => constraint.contype === "u").length, 1); assertions++;
    const checks = constraints.filter((constraint) => constraint.contype === "c").map((constraint) => String(constraint.definition)).join(" ");
    assert.match(checks, /expires_at_canonical::timestamp with time zone = expires_at/); assertions++;
    assert.match(checks, /claimed_at < expires_at/); assertions++;
    assert.match(checks, /expires_at <= \(claimed_at \+ '00:02:00'::interval\)/); assertions++;

    const relation = (await db.query(`
      select relrowsecurity, relforcerowsecurity
      from pg_catalog.pg_class
      where oid='private.${table}'::regclass
    `)).rows[0];
    assert.deepEqual(relation, { relrowsecurity: true, relforcerowsecurity: true }); assertions++;
    const policies = (await db.query(`
      select policyname, cmd, roles, qual, with_check
      from pg_catalog.pg_policies
      where schemaname='private' and tablename='${table}'
      order by policyname
    `)).rows;
    assert.equal(policies.length, 2); assertions++;
    assert.deepEqual(policies.map(({ policyname, cmd, roles }) => ({ policyname, cmd, roles })), [
      { policyname: "committed_review_qa_preview_replay_claimer_insert", cmd: "INSERT", roles: [claimer] },
      { policyname: "committed_review_qa_preview_replay_claimer_select", cmd: "SELECT", roles: [claimer] },
    ]); assertions++;
    assert.match(String(policies[0].with_check), /clock_timestamp\(\) < expires_at/); assertions++;
    assert.match(String(policies[0].with_check), /expires_at <= \(clock_timestamp\(\) \+ '00:02:00'::interval\)/); assertions++;
    assert.equal(policies[1].qual, "true"); assert.equal(policies[1].with_check, null); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from pg_catalog.pg_policies where schemaname='private'"), 45); assertions++;

    const statements = v5.replace(/^\s*--.*$/gm, "");
    assert.equal([...statements.matchAll(/create\s+policy\s+committed_review_qa_preview_replay_claimer_/gi)].length, 2); assertions++;
    assert.doesNotMatch(statements, /create\s+(?:or\s+replace\s+)?(?:function|procedure|view)|security\s+definer|alter\s+default\s+privileges|grant\s+(?:update|delete|truncate|references|trigger|execute|all)\b|grant\s+usage\s+on\s+(?:all\s+)?sequences?\b|grant\s+(?:select|insert)\s+on\b|password\s+['\"]/i); assertions++;
    assert.doesNotMatch(statements, /create\s+policy[\s\S]{0,400}\bto\s+(?:public|anon|authenticated|service_role)\b/i); assertions++;
    assert.doesNotMatch(statements, /private[_ -]?key|service_role\s*=|sb_secret_|sk[-_]proj/i); assertions++;

    const inserted = await asRole(db, claimer, `
      with horizon as (
        select pg_catalog.clock_timestamp() + interval '30 seconds' as expires_at
      )
      insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical)
      select '${grantId}','${attemptId}',expires_at,
        to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      from horizon
      returning grant_id,claim_attempt_id,expires_at_canonical
    `);
    assert.equal(inserted.rows.length, 1); assertions++;
    const selected = await asRole(db, claimer, `select grant_id,claim_attempt_id,expires_at_canonical from private.${table} where grant_id='${grantId}'`);
    assert.deepEqual(selected.rows, inserted.rows); assertions++;
    await rejectsAsRole(db, claimer, `insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical) select '${grantId}','${"c".repeat(64)}',value,to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from (select clock_timestamp()+interval '30 seconds' as value) horizon`, "grant tombstone identity is unique", /duplicate key|unique constraint/); assertions++;
    await rejectsAsRole(db, claimer, `insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical) select '${"c".repeat(64)}','${attemptId}',value,to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from (select clock_timestamp()+interval '30 seconds' as value) horizon`, "claim attempt cannot be relabelled across grants", /duplicate key|unique constraint/); assertions++;

    await rejectsAsRole(db, claimer, `select claimed_at from private.${table}`, "claimer cannot read claimed_at"); assertions++;
    await rejectsAsRole(db, claimer, `insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical,claimed_at) values('${"c".repeat(64)}','${"d".repeat(64)}',clock_timestamp()+interval '30 seconds','2030-01-01T00:00:00.000Z',clock_timestamp())`, "claimer cannot supply claimed_at"); assertions++;
    await rejectsAsRole(db, claimer, `insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical) values('${"c".repeat(64)}','${"d".repeat(64)}',clock_timestamp(),to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`, "exact expiry is denied"); assertions++;
    await rejectsAsRole(db, claimer, `insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical) select '${"c".repeat(64)}','${"d".repeat(64)}',value,to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from (select clock_timestamp()+interval '121 seconds' as value) horizon`, "overlong horizon is denied"); assertions++;
    await rejectsAsRole(db, claimer, `update private.${table} set expires_at=expires_at+interval '1 second'`, "claimer cannot update"); assertions++;
    await rejectsAsRole(db, claimer, `delete from private.${table}`, "claimer cannot delete"); assertions++;
    await rejectsAsRole(db, claimer, `truncate private.${table}`, "claimer cannot truncate"); assertions++;
    await rejectsAsRole(db, claimer, `create table private.qa_preview_replay_escape(id integer)`, "claimer cannot create schema objects"); assertions++;
    await rejectsAsRole(db, claimer, "select * from private.tenants", "claimer cannot read other private relations"); assertions++;
    for (const roleName of ["anon", "authenticated", "service_role", "jessica_non_proxy_qa_writer", "jessica_committed_review_qa_preview_reader"]) {
      await rejectsAsRole(db, roleName, `select grant_id from private.${table}`, `${roleName} cannot read replay tombstones`); assertions++;
      await rejectsAsRole(db, roleName, `insert into private.${table}(grant_id,claim_attempt_id,expires_at,expires_at_canonical) values('${"e".repeat(64)}','${"f".repeat(64)}','2030-01-01T00:00:01Z','2030-01-01T00:00:01.000Z')`, `${roleName} cannot claim grants`); assertions++;
    }

    const occupiedRole = new PGlite();
    try {
      await bootstrap(occupiedRole);
      for (const migration of migrations.slice(0, 4)) await occupiedRole.exec(migration);
      await occupiedRole.exec(`create role ${claimer} nologin`);
      let error = null;
      try { await occupiedRole.exec(v5); } catch (caught) { error = caught; }
      assert.ok(error); assert.match(String(error.message), /role name to be unused/); assertions++;
      assert.equal(await scalar(occupiedRole, `select to_regclass('private.${table}') is null`), true); assertions++;
    } finally { await occupiedRole.close(); }

    let replayError = null;
    try { await db.exec(v5); } catch (caught) { replayError = caught; }
    assert.ok(replayError); assert.match(String(replayError.message), /role name to be unused/); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from private.${table}`), 1); assertions++;

    return {
      migration: fileURLToPath(migrationUrls[4]),
      postgresCompatibility: "17 (PGlite 0.5.4)",
      assertions,
      privateTables: 23,
      rlsPolicies: 45,
      replayRelations: 1,
      residual: "The credentialless claimer is trusted-server TCB authority. Tombstones are permanent and append-only; production LOGIN membership, credentials, TLS, pool sizing, observation, and capacity planning remain external.",
    };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(await verifyCommittedReviewQaPreviewReplayDatabaseAuthorization(), null, 2));
}
