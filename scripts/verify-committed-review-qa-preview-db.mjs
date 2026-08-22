import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationUrls = [
  new URL("../supabase/migrations/20260811071257_control_plane_publication_v1.sql", import.meta.url),
  new URL("../supabase/migrations/20260821142538_non_proxy_qa_control_plane_persistence_v2.sql", import.meta.url),
  new URL("../supabase/migrations/20260821155309_trusted_non_proxy_qa_writer_v3.sql", import.meta.url),
  new URL("../supabase/migrations/20260822013928_committed_review_qa_preview_reader.sql", import.meta.url),
];
const reader = "jessica_committed_review_qa_preview_reader";
const allowedTables = [
  "asset_version_sources",
  "asset_versions",
  "frame_variants",
  "generation_job_events",
  "generation_jobs",
  "measurement_sets",
  "non_proxy_asset_version_bindings",
  "non_proxy_human_qa_records",
  "qa_reviewer_authorities",
  "source_assets",
];

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

async function asReader(db, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${reader}`);
    return await db.query(sql);
  } finally {
    await db.exec("rollback");
  }
}

async function readerRejects(db, sql, label) {
  await db.exec("begin");
  let error = null;
  try {
    await db.exec(`set local role ${reader}`);
    await db.exec(sql);
  } catch (caught) {
    error = caught;
  }
  try { await db.exec("rollback"); } catch { /* an aborted transaction may already be closed */ }
  assert.ok(error, label);
  assert.match(String(error.message), /permission denied|must be owner/, label);
}

export async function verifyCommittedReviewQaPreviewDatabaseAuthorization() {
  const migrations = await Promise.all(migrationUrls.map((url) => readFile(url, "utf8")));
  const v4 = migrations[3];
  const db = new PGlite();
  let assertions = 0;
  try {
    await bootstrap(db);
    for (const migration of migrations) await db.exec(migration);

    const role = (await db.query(`
      select rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
             rolreplication, rolbypassrls
      from pg_catalog.pg_roles where rolname='${reader}'
    `)).rows[0];
    assert.deepEqual(role, {
      rolsuper: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolcanlogin: false,
      rolreplication: false,
      rolbypassrls: false,
    }); assertions++;
    assert.equal(await scalar(db, `select rolpassword is null from pg_catalog.pg_authid where rolname='${reader}'`), true); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_auth_members where roleid='${reader}'::regrole or member='${reader}'::regrole`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_class where relowner='${reader}'::regrole`), 0); assertions++;
    assert.equal(await scalar(db, `select has_schema_privilege('${reader}','private','USAGE') and not has_schema_privilege('${reader}','private','CREATE')`), true); assertions++;
    assert.equal(await scalar(db, `select not has_schema_privilege('${reader}','api','USAGE') and not has_schema_privilege('${reader}','api','CREATE')`), true); assertions++;

    const tablePrivileges = (await db.query(`
      select table_name, privilege_type
      from information_schema.table_privileges
      where grantee='${reader}' and table_schema='private'
      order by table_name, privilege_type
    `)).rows;
    assert.deepEqual(tablePrivileges, allowedTables.map((table_name) => ({ table_name, privilege_type: "SELECT" }))); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.column_privileges where grantee='${reader}' and table_schema='private' and privilege_type <> 'SELECT'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.routine_privileges where grantee='${reader}' and routine_schema='private'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.usage_privileges where grantee='${reader}' and object_schema='private'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_default_acl where coalesce(defaclacl::text,'') like '%${reader}%'`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('${reader}',p.oid,'EXECUTE')`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and case when c.relkind='S' then has_sequence_privilege('${reader}',c.oid,'USAGE,SELECT,UPDATE') else false end`), 0); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from information_schema.routine_privileges where routine_schema='private' and routine_name='lock_committed_review_qa_preview_candidate_status_change' and grantee in ('PUBLIC','anon','authenticated','service_role','jessica_non_proxy_qa_writer','${reader}')`), 0); assertions++;

    const lockFunction = String(await scalar(db, "select pg_get_functiondef('private.lock_committed_review_qa_preview_candidate_status_change()'::regprocedure)")).replace(/\s+/g, " ").toLowerCase();
    assert.match(lockFunction, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\( 'candidate:' \|\| pg_catalog\.length\(old\.tenant_id::text\)::text \|\| ':' \|\| old\.tenant_id::text \|\| pg_catalog\.length\(old\.id::text\)::text \|\| ':' \|\| old\.id::text \|\| ':' \|\| old\.version::text, 218 \)\)/); assertions++;
    assert.doesNotMatch(lockFunction, /current_user|session_user/); assertions++;
    const statusLockTrigger = (await db.query("select t.tgenabled,pg_get_triggerdef(t.oid,true) as definition,p.proname from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid where n.nspname='private' and c.relname='asset_versions' and t.tgname='committed_review_qa_preview_candidate_status_lock' and not t.tgisinternal")).rows;
    assert.equal(statusLockTrigger.length, 1); assertions++;
    assert.equal(statusLockTrigger[0]?.tgenabled, "O"); assert.equal(statusLockTrigger[0]?.proname, "lock_committed_review_qa_preview_candidate_status_change"); assertions++;
    assert.match(String(statusLockTrigger[0]?.definition), /BEFORE UPDATE OF status ON private\.asset_versions[\s\S]*WHEN \(old\.non_proxy_internal_review AND new\.status IS DISTINCT FROM old\.status\)/i); assertions++;

    const policies = (await db.query(`
      select tablename, cmd, roles, qual, with_check
      from pg_catalog.pg_policies
      where schemaname='private' and '${reader}'=any(roles)
      order by tablename
    `)).rows;
    assert.deepEqual(policies, allowedTables.map((tablename) => ({
      tablename,
      cmd: "SELECT",
      roles: [reader],
      qual: "true",
      with_check: null,
    }))); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_policies where schemaname='private'`), 43); assertions++;
    assert.equal(await scalar(db, `select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in (${allowedTables.map((name) => `'${name}'`).join(",")}) and c.relrowsecurity and c.relforcerowsecurity`), allowedTables.length); assertions++;

    const statements = v4.replace(/^\s*--.*$/gm, "");
    assert.equal([...statements.matchAll(/create\s+policy\s+committed_review_qa_preview_reader_/gi)].length, allowedTables.length); assertions++;
    assert.deepEqual([...statements.matchAll(/create\s+(?:or\s+replace\s+)?function\s+private\.([a-z0-9_]+)/gi)].map((match) => match[1]), ["lock_committed_review_qa_preview_candidate_status_change"]); assertions++;
    assert.doesNotMatch(statements, /create\s+(?:or\s+replace\s+)?(?:procedure|view)|security\s+definer|alter\s+default\s+privileges|grant\s+(?:insert|update|delete|truncate|references|trigger|execute|all)\b|grant\s+usage\s+on\s+(?:all\s+)?sequences?\b|grant\s+select\s+on\s+all\b|password\s+['\"]/i); assertions++;
    assert.doesNotMatch(statements, /create\s+policy[\s\S]{0,260}\bto\s+(?:public|anon|authenticated|service_role)\b/i); assertions++;
    assert.doesNotMatch(statements, /private[_ -]?key|service_role\s*=|sb_secret_|sk[-_]proj/i); assertions++;

    for (const table of allowedTables) {
      const result = await asReader(db, `select count(*)::int as count from private.${table}`);
      assert.equal(result.rows.length, 1, `reader SELECT on ${table}`); assertions++;
    }
    await readerRejects(db, "select * from private.tenants", "reader cannot read an unlisted table"); assertions++;
    await readerRejects(db, "insert into private.generation_jobs default values", "reader cannot insert"); assertions++;
    await readerRejects(db, "update private.asset_versions set status='retired'", "reader cannot update"); assertions++;
    await readerRejects(db, "delete from private.non_proxy_human_qa_records", "reader cannot delete"); assertions++;
    await readerRejects(db, "truncate private.asset_version_sources", "reader cannot truncate"); assertions++;
    await readerRejects(db, "create table private.qa_preview_escape(id integer)", "reader cannot create schema objects"); assertions++;
    await readerRejects(db, "select private.reject_mutation()", "reader cannot execute private routines"); assertions++;

    const occupiedRole = new PGlite();
    try {
      await bootstrap(occupiedRole);
      for (const migration of migrations.slice(0, 3)) await occupiedRole.exec(migration);
      await occupiedRole.exec(`create role ${reader} nologin`);
      let error = null;
      try { await occupiedRole.exec(v4); } catch (caught) { error = caught; }
      assert.ok(error); assert.match(String(error.message), /role name to be unused/); assertions++;
    } finally { await occupiedRole.close(); }

    let replayError = null;
    try { await db.exec(v4); } catch (caught) { replayError = caught; }
    assert.ok(replayError); assert.match(String(replayError.message), /role name to be unused/); assertions++;

    return {
      migration: fileURLToPath(migrationUrls[3]),
      postgresCompatibility: "17 (PGlite 0.5.4)",
      assertions,
      privateTables: 22,
      rlsPolicies: 43,
      selectedRelations: allowedTables.length,
      residual: "The credentialless NOBYPASSRLS reader is trusted-server TCB authority. Application authentication, exact tenant/object predicates, pinned-session locking, and final currentness checks remain mandatory. Future private routines must keep the repository's explicit PUBLIC-revoke convention because v4 does not alter owner-wide default privileges.",
    };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(await verifyCommittedReviewQaPreviewDatabaseAuthorization(), null, 2));
}
