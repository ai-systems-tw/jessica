import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/20260811071257_control_plane_publication_v1.sql", import.meta.url);
const H = Object.fromEntries("abcdefghijklmnopqrstuvwxyz".split("").map((letter, index) => [
  letter,
  (index + 1).toString(16).padStart(2, "0").repeat(32),
]));
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const userC = "33333333-3333-4333-8333-333333333333";

async function mustReject(db, sql, label) {
  let rejected = false;
  try {
    await db.exec(sql);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, label);
}

async function scalar(db, sql) {
  const result = await db.query(sql);
  return Object.values(result.rows[0] ?? {})[0];
}

function assetInsert({ tenant = "tenant-a", id, version, quality = "standard", status = "draft", modelHash, manifestHash }) {
  return `insert into private.asset_versions (
    tenant_id,id,frame_model_id,version,quality,generation_method,model_url,manifest_url,
    manifest_sha256,manifest_byte_length,model_sha256,model_byte_length,source_set_sha256,
    attachment_matrix,quality_envelope,status
  ) values (
    '${tenant}','${id}','model-1',${version},'${quality}','manual',
    'https://cdn.example.test/model-1/v${version}/frame.glb','https://cdn.example.test/model-1/v${version}/manifest.json',
    '${manifestHash}',100,'${modelHash}',200,'${H.c}',
    '[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]'::jsonb,
    '{"maxYawDeg":25,"maxPitchDeg":15,"recommendedForLive":true,"scaleConfidence":"medium"}'::jsonb,
    '${status}'
  )`;
}

function deploymentInsert({
  id,
  assetId,
  assetVersion,
  revision,
  generation,
  hashes,
  prior = null,
  catalogUrl = "https://cdn.example.test/catalog/v1/catalog.json",
  catalogHash = H.i,
}) {
  const priorValues = prior
    ? `'${prior.id}','${prior.sha}',${prior.revision},${prior.generation}`
    : "null,null,null,null";
  return `insert into private.deployments (
    tenant_id,id,site_id,environment,frame_model_id,frame_variant_id,sku,
    asset_version_id,asset_version,revision,generation,activated_at,authority_id,key_id,
    actor_subject_id,change_id,catalog_url,allowed_origin,catalog_sha256,manifest_sha256,
    model_sha256,prior_deployment_id,prior_deployment_sha256,prior_revision,prior_generation,
    envelope_sha256,deployment_sha256,signature_base64url,signed_envelope
  ) values (
    'tenant-a','${id}','site-1','production','model-1','variant-1','SKU-ONE',
    '${assetId}',${assetVersion},${revision},${generation},'2026-08-11T0${revision}:00:00Z',
    'authority-1','key-1','publisher-1','change-${id}',
    '${catalogUrl}','https://cdn.example.test','${catalogHash}',
    '${hashes.manifest}','${hashes.model}',${priorValues},'${hashes.envelope}',
    '${hashes.deployment}','test_signature_${revision}','{"schemaVersion":1}'::jsonb
  )`;
}

export async function verifyControlPlane() {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  let assertions = 0;
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable set search_path = ''
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(migration);

    assert.equal(await scalar(db, "select count(*)::int from pg_tables where schemaname = 'private'"), 19); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from pg_views where schemaname = 'api'"), 2); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from pg_policies where schemaname = 'private'"), 19); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from pg_class where relnamespace = 'private'::regnamespace and relkind = 'r' and relrowsecurity and relforcerowsecurity"), 19); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from pg_class where relnamespace = 'api'::regnamespace and relkind = 'v' and reloptions @> array['security_invoker=true']"), 2); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from information_schema.table_privileges where grantee = 'anon' and table_schema in ('private','api')"), 0); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from information_schema.table_privileges where grantee = 'authenticated' and privilege_type <> 'SELECT' and table_schema in ('private','api')"), 0); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from information_schema.routine_privileges where routine_schema = 'private' and grantee = 'authenticated'"), 1); assertions++;
    assert.doesNotMatch(migration, /sb_secret_|service_role\s*=|eyJ[A-Za-z0-9_-]{20,}|sk[-_](?:proj[-_])?/); assertions++;
    assert.doesNotMatch(migration, /recommended_for_live|recommendedForLive[^']*publication_stream/i); assertions++;

    await db.exec(`
      insert into auth.users values ('${userA}'), ('${userB}'), ('${userC}');
      insert into private.tenants (id,slug,display_name,status) values
        ('tenant-a','tenant-a','Tenant A','active'), ('tenant-b','tenant-b','Tenant B','active');
      insert into private.tenant_memberships (tenant_id,user_id,membership_role,status) values
        ('tenant-a','${userA}','administrator','active'), ('tenant-b','${userB}','administrator','active');
      insert into private.sites (tenant_id,id,domain,status) values ('tenant-a','site-1','shop.example.test','active');
      insert into private.frame_models (
        tenant_id,id,model_code,name,lens_width_mm,bridge_width_mm,temple_length_mm,frame_width_mm,lens_height_mm
      ) values
        ('tenant-a','model-1','M-1','Model 1',52,18,145,140,40),
        ('tenant-b','model-1','M-1','Other model',50,17,140,135,38);
      insert into private.frame_variants (tenant_id,id,frame_model_id,sku,frame_color,frame_material,lens_type) values
        ('tenant-a','variant-1','model-1','SKU-ONE','black','acetate','clear'),
        ('tenant-b','variant-1','model-1','SKU-ONE','brown','acetate','tinted');
    `);

    await mustReject(db, "insert into private.frame_variants (tenant_id,id,frame_model_id,sku,frame_color,frame_material,lens_type) values ('tenant-a','variant-2','model-1','SKU-ONE','blue','metal','clear')", "tenant SKU must be unique"); assertions++;
    await mustReject(db, `insert into private.source_assets (tenant_id,id,frame_model_id,kind,object_key,sha256,byte_length,mime_type,width_px,height_px,provenance_sha256,provenance,inspected_at,inspector_subject_id) values ('tenant-a','bad-source','model-1','front','bad','${"A".repeat(64)}',1,'image/png',1,1,'${H.a}','{}','2026-08-11Z','operator')`, "uppercase digest must fail"); assertions++;
    await mustReject(db, "insert into private.sites (tenant_id,id,domain,status) values ('tenant-a','bad-site','UPPER.example.test','active')", "domain must be lowercase"); assertions++;
    await mustReject(db, "insert into private.frame_variants (tenant_id,id,frame_model_id,sku,frame_color,frame_material,lens_type) values ('tenant-a','cross','missing','SKU-X','black','metal','clear')", "tenant FK must fail closed"); assertions++;

    await db.exec(`insert into private.source_assets (
      tenant_id,id,frame_model_id,kind,object_key,sha256,byte_length,mime_type,width_px,height_px,
      encoded_width_px,encoded_height_px,exif_orientation,display_width_px,display_height_px,region_authoring,
      provenance_sha256,provenance,inspected_at,inspector_subject_id
    ) values ('tenant-a','source-1','model-1','front','tenant-a/model-1/source-1','${H.a}',128,'image/png',100,80,100,80,1,100,80,'allowed','${H.b}','{}','2026-08-11T00:00:00Z','operator-1');
    insert into private.measurement_sets (tenant_id,id,frame_model_id,version,method,evidence_sha256,status)
      values ('tenant-a','measure-1','model-1',1,'marking','${H.d}','draft');`);
    assert.equal(await scalar(db, "select count(*)::int from private.source_assets where tenant_id='tenant-a' and id='source-1' and encoded_width_px=100 and display_width_px=100 and exif_orientation=1 and region_authoring='allowed'"), 1); assertions++;
    await mustReject(db, `insert into private.measurement_evidence (tenant_id,measurement_set_id,sequence,dimension,value,source_asset_id,source_sha256,raw_label,method,verification_status,evidence_sha256,evidence,recorded_at,recorder_subject_id) values ('tenant-a','measure-1',1,'lensWidthMm',52,'source-1','${H.e}','52','marking','unverified','${H.f}','{}','2026-08-11T00:00:00Z','operator-1')`, "measurement source hash must match inspected bytes"); assertions++;
    await db.exec(`insert into private.measurement_evidence (tenant_id,measurement_set_id,sequence,dimension,value,source_asset_id,source_sha256,raw_label,method,verification_status,region_x,region_y,region_width,region_height,evidence_sha256,evidence,recorded_at,recorder_subject_id) values ('tenant-a','measure-1',1,'lensWidthMm',52,'source-1','${H.a}','52','marking','unverified',0,0,10,10,'${H.f}','{}','2026-08-11T00:00:00Z','operator-1')`);
    await db.exec(`
      insert into private.measurement_evidence (tenant_id,measurement_set_id,sequence,dimension,value,method,verification_status,evidence_sha256,evidence,recorded_at,recorder_subject_id) values
        ('tenant-a','measure-1',2,'pantoscopicTiltDeg',-10,'derived','not-applicable','${H.t}','{}','2026-08-11T00:01:00Z','operator-1'),
        ('tenant-a','measure-1',3,'faceWrapDeg',0,'derived','not-applicable','${H.u}','{}','2026-08-11T00:02:00Z','operator-1');
    `);
    assert.equal(await scalar(db, "select value::text from private.measurement_evidence where tenant_id='tenant-a' and measurement_set_id='measure-1' and dimension='pantoscopicTiltDeg'"), "-10"); assertions++;
    assert.equal(await scalar(db, "select value::text from private.measurement_evidence where tenant_id='tenant-a' and measurement_set_id='measure-1' and dimension='faceWrapDeg'"), "0"); assertions++;
    await mustReject(db, `insert into private.measurement_evidence (tenant_id,measurement_set_id,sequence,dimension,value,method,verification_status,evidence_sha256,evidence,recorded_at,recorder_subject_id) values ('tenant-a','measure-1',4,'pantoscopicTiltDeg',-45.01,'derived','not-applicable','${H.v}','{}','2026-08-11T00:03:00Z','operator-1')`, "pantoscopic tilt below -45 must fail"); assertions++;
    await mustReject(db, `insert into private.measurement_evidence (tenant_id,measurement_set_id,sequence,dimension,value,method,verification_status,evidence_sha256,evidence,recorded_at,recorder_subject_id) values ('tenant-a','measure-1',4,'faceWrapDeg',90.01,'derived','not-applicable','${H.w}','{}','2026-08-11T00:03:00Z','operator-1')`, "face wrap above 90 must fail"); assertions++;
    await mustReject(db, "update private.measurement_evidence set value=53 where tenant_id='tenant-a'", "measurement evidence must be append-only"); assertions++;

    await db.exec(`insert into private.generation_jobs (tenant_id,id,frame_model_id,idempotency_key,canonical_input_sha256,method,generator_id,generator_version,generator_config_sha256,measurement_set_sha256,generator_input_sha256,max_attempts,created_at) values
      ('tenant-a','job-1','model-1','job-key-1','${H.g}','manual','generator-1','v1','${H.h}','${H.d}','${H.e}',3,'2026-08-11T00:00:00Z'),
      ('tenant-b','job-2','model-1','job-key-2','${H.i}','manual','generator-1','v1','${H.h}','${H.d}','${H.e}',3,'2026-08-11T00:00:00Z');
      insert into private.generation_job_events (tenant_id,generation_job_id,sequence,event_type,occurred_at,event_sha256,evidence) values ('tenant-a','job-1',1,'queued','2026-08-11T00:00:00Z','${H.j}','{}');
      insert into private.generation_job_events (tenant_id,generation_job_id,sequence,event_type,occurred_at,previous_event_sha256,event_sha256,evidence) values ('tenant-a','job-1',2,'claimed','2026-08-11T00:01:00Z','${H.j}','${H.k}','{}');
      insert into private.generation_job_events (tenant_id,generation_job_id,sequence,event_type,occurred_at,previous_event_sha256,event_sha256,evidence) values ('tenant-a','job-1',3,'output-recorded','2026-08-11T00:02:00Z','${H.k}','${H.l}','{}');
      insert into private.generation_job_events (tenant_id,generation_job_id,sequence,event_type,occurred_at,event_sha256,evidence) values ('tenant-b','job-2',1,'queued','2026-08-11T00:00:00Z','${H.n}','{}');
      insert into private.generation_job_events (tenant_id,generation_job_id,sequence,event_type,occurred_at,previous_event_sha256,event_sha256,evidence) values ('tenant-b','job-2',2,'output-recorded','2026-08-11T00:02:00Z','${H.n}','${H.o}','{}');`);
    await mustReject(db, `insert into private.generation_job_events (tenant_id,generation_job_id,sequence,event_type,occurred_at,previous_event_sha256,event_sha256,evidence) values ('tenant-a','job-1',4,'completed','2026-08-11T00:03:00Z','${H.a}','${H.m}','{}')`, "generation chain digest must match"); assertions++;
    await mustReject(db, "delete from private.generation_job_events where tenant_id='tenant-a' and generation_job_id='job-1' and sequence=3", "generation events must be append-only"); assertions++;

    await mustReject(db, assetInsert({ id: "bad-version", version: 0, modelHash: H.m, manifestHash: H.n }), "asset version must be positive"); assertions++;
    await mustReject(db, assetInsert({ id: "bad-status", version: 3, status: "published", modelHash: H.m, manifestHash: H.n }), "asset insert must start draft"); assertions++;
    await db.exec(assetInsert({ id: "asset-1", version: 1, modelHash: H.d, manifestHash: H.e }));
    await db.exec("update private.asset_versions set status='review' where tenant_id='tenant-a' and id='asset-1'; update private.asset_versions set status='approved' where tenant_id='tenant-a' and id='asset-1'; update private.asset_versions set status='published' where tenant_id='tenant-a' and id='asset-1'");
    await mustReject(db, "update private.asset_versions set model_url='https://cdn.example.test/model-1/v1/replaced.glb' where tenant_id='tenant-a' and id='asset-1'", "published URL cannot change in place"); assertions++;
    await mustReject(db, "delete from private.asset_versions where tenant_id='tenant-a' and id='asset-1'", "asset version cannot be deleted"); assertions++;
    await db.exec(assetInsert({ id: "asset-2", version: 2, modelHash: H.f, manifestHash: H.g }));
    await db.exec("update private.asset_versions set status='review' where tenant_id='tenant-a' and id='asset-2'; update private.asset_versions set status='approved' where tenant_id='tenant-a' and id='asset-2'; update private.asset_versions set status='published' where tenant_id='tenant-a' and id='asset-2'");

    await mustReject(db, `insert into private.qa_review_decisions (tenant_id,id,frame_model_id,generation_job_id,sequence,canonical_input_sha256,review_head_event_sha256,generator_input_sha256,manifest_sha256,manifest_byte_length,model_sha256,model_byte_length,reviewer_subject_id,decision,issue_categories,decision_sha256,reviewed_at,evaluated_at,evidence) values ('tenant-a','decision-bad','model-1','job-1',1,'${H.g}','${H.k}','${H.e}','${H.e}',100,'${H.d}',200,'reviewer-1','approve','{}','${H.a}','2026-08-11T00:02:00Z','2026-08-11T00:03:00Z','{}')`, "QA decision must bind the current review head"); assertions++;
    await db.exec(`insert into private.qa_review_decisions (tenant_id,id,frame_model_id,generation_job_id,sequence,canonical_input_sha256,review_head_event_sha256,generator_input_sha256,manifest_sha256,manifest_byte_length,model_sha256,model_byte_length,reviewer_subject_id,decision,issue_categories,decision_sha256,reviewed_at,evaluated_at,evidence) values ('tenant-a','decision-1','model-1','job-1',1,'${H.g}','${H.l}','${H.e}','${H.e}',100,'${H.d}',200,'reviewer-1','approve','{}','${H.m}','2026-08-11T00:02:00Z','2026-08-11T00:03:00Z','{}')`);
    await mustReject(db, "update private.qa_review_decisions set notes='changed' where tenant_id='tenant-a' and id='decision-1'", "review decisions must be append-only"); assertions++;

    await db.exec(`
      insert into private.publication_authorities (tenant_id,authority_id,key_id,public_jwk,public_jwk_sha256,status) values ('tenant-a','authority-1','key-1','{"kty":"EC","crv":"P-256"}','${H.h}','active');
      insert into private.immutable_publication_resources (tenant_id,resource_url,resource_sha256,byte_length,resource_kind,recorded_at,recorder_subject_id) values
        ('tenant-a','https://cdn.example.test/catalog/v1/catalog.json','${H.i}',300,'catalog','2026-08-11T00:00:00Z','publisher-1'),
        ('tenant-a','https://cdn.example.test/not-catalog/v1/document.json','${H.s}',300,'deployment-document','2026-08-11T00:00:00Z','publisher-1');
    `);
    const dep1 = { id: "deployment-1", sha: H.k, revision: 1, generation: 1 };
    await mustReject(db, deploymentInsert({
      id: "deployment-wrong-resource-kind", assetId: "asset-1", assetVersion: 1, revision: 1, generation: 1,
      hashes: { manifest: H.e, model: H.d, deployment: H.t, envelope: H.u },
      catalogUrl: "https://cdn.example.test/not-catalog/v1/document.json", catalogHash: H.s,
    }), "deployment resource must be a catalog"); assertions++;
    await db.exec(deploymentInsert({ id: dep1.id, assetId: "asset-1", assetVersion: 1, revision: 1, generation: 1, hashes: { manifest: H.e, model: H.d, deployment: dep1.sha, envelope: H.n } }));
    await db.exec("insert into private.publication_streams (tenant_id,site_id,environment,active_deployment_id) values ('tenant-a','site-1','production','deployment-1')");
    await mustReject(db, "insert into private.publication_streams (tenant_id,site_id,environment,active_deployment_id) values ('tenant-a','site-1','production','deployment-1')", "only one active stream pointer is allowed"); assertions++;
    await mustReject(db, deploymentInsert({ id: "deployment-bad", assetId: "asset-2", assetVersion: 2, revision: 2, generation: 2, hashes: { manifest: H.g, model: H.f, deployment: H.l, envelope: H.z } }), "replacement must bind prior active pointer"); assertions++;
    const staleSide = { id: "deployment-stale-side", sha: H.p, revision: 2, generation: 2 };
    await db.exec(deploymentInsert({ id: staleSide.id, assetId: "asset-2", assetVersion: 2, revision: 2, generation: 2, hashes: { manifest: H.g, model: H.f, deployment: staleSide.sha, envelope: H.q }, prior: dep1 }));
    const dep2 = { id: "deployment-2", sha: H.l, revision: 3, generation: 3 };
    await db.exec(deploymentInsert({ id: dep2.id, assetId: "asset-2", assetVersion: 2, revision: 3, generation: 3, hashes: { manifest: H.g, model: H.f, deployment: dep2.sha, envelope: H.o }, prior: dep1 }));
    await db.exec("update private.publication_streams set active_deployment_id='deployment-2' where tenant_id='tenant-a' and site_id='site-1' and environment='production'");
    await mustReject(db, "update private.publication_streams set active_deployment_id='deployment-stale-side' where tenant_id='tenant-a' and site_id='site-1' and environment='production'", "pointer must reject a deployment chained from a no-longer-current target"); assertions++;
    await mustReject(db, deploymentInsert({ id: "deployment-nonmonotonic", assetId: "asset-1", assetVersion: 1, revision: 4, generation: 3, hashes: { manifest: H.e, model: H.d, deployment: H.v, envelope: H.w }, prior: dep2 }), "revision and generation must both advance"); assertions++;
    const dep3 = { id: "deployment-3", sha: H.m, revision: 4, generation: 4 };
    await db.exec(deploymentInsert({ id: dep3.id, assetId: "asset-1", assetVersion: 1, revision: 4, generation: 4, hashes: { manifest: H.e, model: H.d, deployment: dep3.sha, envelope: H.r }, prior: dep2 }));
    await db.exec("update private.publication_streams set active_deployment_id='deployment-3' where tenant_id='tenant-a' and site_id='site-1' and environment='production'");
    assert.equal(await scalar(db, "select active_deployment_id from private.publication_streams where tenant_id='tenant-a'"), "deployment-3"); assertions++;
    assert.deepEqual((await db.query("select event_type from private.publication_events where tenant_id='tenant-a' order by revision")).rows.map((row) => row.event_type), ["activated", "replaced", "rollback"]); assertions++;
    await mustReject(db, "delete from private.publication_streams where tenant_id='tenant-a' and site_id='site-1' and environment='production'", "active publication pointer cannot disappear"); assertions++;
    await mustReject(db, "update private.immutable_publication_resources set resource_sha256='" + H.a + "' where tenant_id='tenant-a'", "publication URL digest is immutable"); assertions++;
    await mustReject(db, "update private.deployments set catalog_url='https://cdn.example.test/catalog/v1/overwritten.json' where tenant_id='tenant-a' and id='deployment-3'", "signed deployment is immutable"); assertions++;

    await mustReject(db, "update private.publication_authorities set public_jwk='{}' where tenant_id='tenant-a' and authority_id='authority-1' and key_id='key-1'", "active authority identity cannot mutate"); assertions++;
    await db.exec("update private.publication_authorities set status='revoked', revoked_at=now() where tenant_id='tenant-a' and authority_id='authority-1' and key_id='key-1'");
    assert.equal(await scalar(db, "select status from private.publication_authorities where tenant_id='tenant-a' and authority_id='authority-1' and key_id='key-1'"), "revoked"); assertions++;
    await mustReject(db, "update private.publication_authorities set public_jwk='{}' where tenant_id='tenant-a' and authority_id='authority-1' and key_id='key-1'", "revoked authority identity cannot mutate"); assertions++;
    await mustReject(db, "update private.publication_authorities set status='active', revoked_at=null where tenant_id='tenant-a' and authority_id='authority-1' and key_id='key-1'", "revoked authority cannot be re-enabled"); assertions++;
    await mustReject(db, "delete from private.publication_authorities where tenant_id='tenant-a' and authority_id='authority-1' and key_id='key-1'", "publication authority cannot be deleted"); assertions++;
    await mustReject(db, deploymentInsert({ id: "deployment-after-revoke", assetId: "asset-2", assetVersion: 2, revision: 5, generation: 5, hashes: { manifest: H.g, model: H.f, deployment: H.x, envelope: H.y }, prior: dep3 }), "revoked key cannot authorize a new deployment"); assertions++;

    await db.exec(`select set_config('request.jwt.claim.sub','${userA}',false)`);
    assert.equal(await scalar(db, "select private.is_tenant_member('tenant-a')"), true); assertions++;
    assert.equal(await scalar(db, "select private.is_tenant_member('tenant-b')"), false); assertions++;

    await db.exec("set role anon");
    await mustReject(db, "select * from api.asset_review_queue", "anon cannot use the API schema"); assertions++;
    await db.exec("reset role");

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`);
    assert.equal(await scalar(db, "select count(*)::int from api.asset_review_queue"), 1); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from private.generation_jobs where tenant_id='tenant-a'"), 1); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from private.generation_jobs where tenant_id='tenant-b'"), 0); assertions++;
    await db.exec("reset role");
    await db.exec("update private.tenants set status='suspended' where id='tenant-a'");
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`);
    assert.equal(await scalar(db, "select count(*)::int from api.asset_review_queue"), 0); assertions++;
    assert.equal(await scalar(db, "select private.is_tenant_member('tenant-a')"), false); assertions++;
    await db.exec("reset role");
    await db.exec("update private.tenants set status='active' where id='tenant-a'");
    await db.exec("set role authenticated");
    await db.exec(`select set_config('request.jwt.claim.sub','${userB}',false);`);
    assert.equal(await scalar(db, "select count(*)::int from api.asset_review_queue"), 1); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from private.generation_jobs where tenant_id='tenant-a'"), 0); assertions++;
    assert.equal(await scalar(db, "select count(*)::int from private.generation_jobs where tenant_id='tenant-b'"), 1); assertions++;
    await db.exec(`select set_config('request.jwt.claim.sub','${userC}',false);`);
    assert.equal(await scalar(db, "select count(*)::int from api.asset_review_queue"), 0); assertions++;
    assert.equal(await scalar(db, "select private.is_tenant_member('tenant-a')"), false); assertions++;
    await db.exec("reset role");

    await db.exec(`update private.tenant_memberships set status='revoked' where tenant_id='tenant-a' and user_id='${userA}'`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`);
    assert.equal(await scalar(db, "select count(*)::int from api.asset_review_queue"), 0); assertions++;
    assert.equal(await scalar(db, "select private.is_tenant_member('tenant-a')"), false); assertions++;
    await db.exec("reset role");

    return {
      migration: fileURLToPath(migrationUrl),
      postgresCompatibility: "17 (PGlite 0.5.4)",
      assertions,
      privateTables: 19,
      apiViews: 2,
      rlsPolicies: 19,
      publicationEvents: 3,
      rlsEnforced: true,
      residual: null,
    };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(await verifyControlPlane(), null, 2));
}
