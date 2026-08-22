import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { createPgliteCommittedReviewQaPreviewDatabase, createPgliteNonProxyQaWriterDatabase, createSinglePglitePinnedSessionProvider, createTrustedNonProxyQaPersistenceWriter, evaluateNonProxyQaPersistencePlan } from "../dist/packages/asset-review/src/index.js";
import { setup as setupHumanQa } from "./non-proxy-human-qa-decision.fixture.mjs";

const selection = Object.freeze({ tenantId: "tenant-a", assetVersionId: "asset-a", assetVersion: 7 });
const locator = Object.freeze({ generation_job_id: "job-a", reviewer_authority_id: "authority-a", reviewer_key_id: "key-a" });
const migrationUrls = ["20260811071257_control_plane_publication_v1.sql", "20260821142538_non_proxy_qa_control_plane_persistence_v2.sql", "20260821155309_trusted_non_proxy_qa_writer_v3.sql", "20260822013928_committed_review_qa_preview_reader.sql"].map((name) => new URL(`../supabase/migrations/${name}`, import.meta.url));
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const j = (value) => `${q(JSON.stringify(value))}::jsonb`;
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function committedFixture() {
  const human = await setupHumanQa("approve"); const candidate = human.candidate; const attestation = human.request.decisionAttestation; const maximumReviewAgeMs = human.context.reviewerTrust.maximumReviewAgeMs;
  const control = { schemaVersion: 1, observedAt: human.context.caliperProvenanceContext.evaluatedAt, tenantId: candidate.tenantId, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId, generationJob: { id: candidate.generation.jobId, canonicalInputSha256: candidate.generation.canonicalInputSha256, reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256, generatorInputSha256: candidate.generation.generatorInputSha256, output: { manifestSha256: candidate.manifestSha256, modelSha256: candidate.modelSha256, manifestByteLength: candidate.manifestByteLength, modelByteLength: candidate.modelByteLength } }, sourceMappings: candidate.sourceAssetHashes.map((sourceAssetSha256, index) => ({ sourceAssetSha256, sourceAssetId: `source-persist-${index + 1}` })), measurementSet: { id: "measurement-set-persist-1", sha256: candidate.requirements.physical.measurementSetSha256 }, candidateAssetVersion: { id: candidate.id, version: candidate.version }, existingRows: { reviewerAuthority: null, reviewRecord: null, assetVersion: null, binding: null, sourceRows: [] }, reviewerAuthority: { authorityId: attestation.authorityId, keyId: attestation.keyId, reviewerId: attestation.reviewerId, scope: "non-proxy-human-qa-decision", publicKeyFingerprintSha256: attestation.publicKeyFingerprintSha256, publicJwk: structuredClone(human.reviewerJwk), status: "active", createdAt: "2026-08-11T02:00:00Z", revokedAt: null }, reviewPolicy: { maximumReviewAgeMs, sha256: digest(canonicalJson({ domain: "jessica/non-proxy-qa/review-policy/v1", maximumReviewAgeMs })) } };
  const plan = await evaluateNonProxyQaPersistencePlan({ humanQaRequest: human.request }, { humanQaContext: human.context, controlPlaneSnapshot: control });
  const db = new PGlite();
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable set search_path='' as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;");
  for (const url of migrationUrls) await db.exec(await readFile(url, "utf8"));
  const ledgerArtifact = human.request.caliperProvenanceRequest.formalizationRequest.artifacts.find((artifact) => artifact.kind === "generation-ledger"); const ledger = JSON.parse(new TextDecoder().decode(ledgerArtifact.bytes)); const jobRequest = ledger[0].payload.request;
  const eventSql = ledger.map((event) => `insert into private.generation_job_events(tenant_id,generation_job_id,sequence,event_type,occurred_at,occurred_at_canonical,previous_event_sha256,event_sha256,evidence,output_manifest_sha256,output_manifest_byte_length,output_model_sha256,output_model_byte_length) values (${q(event.tenantId)},${q(event.jobId)},${event.sequence},${q(event.eventType)},${q(event.occurredAt)},${q(event.occurredAt)},${event.previousEventSha256 === null ? "null" : q(event.previousEventSha256)},${q(event.eventSha256)},${j(event.payload)},${event.eventType === "output-recorded" ? `${q(event.payload.output.manifestSha256)},${event.payload.output.manifestByteLength},${q(event.payload.output.modelSha256)},${event.payload.output.modelByteLength}` : "null,null,null,null"});`).join("\n");
  await db.exec(`
    insert into private.tenants(id,slug,display_name,status) values (${q(candidate.tenantId)},'preview-tenant','Preview Tenant','active');
    insert into private.frame_models(tenant_id,id,model_code,name,lens_width_mm,bridge_width_mm,temple_length_mm,frame_width_mm,lens_height_mm) values (${q(candidate.tenantId)},${q(candidate.frameModelId)},'PREVIEW','Preview Model',52,18,145,140,40);
    insert into private.frame_variants(tenant_id,id,frame_model_id,sku,frame_color,frame_material,lens_type) values (${q(candidate.tenantId)},${q(candidate.frameVariantId)},${q(candidate.frameModelId)},'PREVIEW-SKU','black','acetate','clear');
    ${candidate.sourceAssetHashes.map((sourceSha256, index) => `insert into private.source_assets(tenant_id,id,frame_model_id,frame_variant_id,kind,object_key,sha256,byte_length,mime_type,width_px,height_px,provenance_sha256,provenance,inspected_at,inspector_subject_id) values (${q(candidate.tenantId)},${q(`source-persist-${index + 1}`)},${q(candidate.frameModelId)},${index === 0 ? "null" : q(candidate.frameVariantId)},'other',${q(`preview-source-${index}`)},${q(sourceSha256)},100,'image/png',10,10,${q(digest(`preview-provenance-${index}`))},'{}','2026-08-11T01:00:00Z','operator');`).join("\n")}
    insert into private.measurement_sets(tenant_id,id,frame_model_id,version,method,evidence_sha256,status,verified_by_subject_id,verified_at,specimen_id) values (${q(candidate.tenantId)},'measurement-set-persist-1',${q(candidate.frameModelId)},1,'caliper',${q(candidate.requirements.physical.measurementSetSha256)},'verified','operator','2026-08-11T02:00:00Z',${q(attestation.specimenId)});
    insert into private.generation_jobs(tenant_id,id,frame_model_id,idempotency_key,canonical_input_sha256,method,generator_id,generator_version,generator_config_sha256,source_asset_sha256s,measurement_set_sha256,generator_input_sha256,max_attempts,created_at) values (${q(candidate.tenantId)},${q(candidate.generation.jobId)},${q(candidate.frameModelId)},${q(ledger[0].idempotencyKey)},${q(candidate.generation.canonicalInputSha256)},${q(jobRequest.method)},${q(jobRequest.generator.id)},${q(jobRequest.generator.version)},${q(jobRequest.generator.configSha256)},(select array_agg(value::private.sha256 order by value) from jsonb_array_elements_text(${j(jobRequest.sourceAssetSha256s)})),${q(jobRequest.measurementSetSha256)},${q(jobRequest.generatorInputSha256)},${jobRequest.maxAttempts},${q(jobRequest.createdAt)});
    ${eventSql}
    insert into private.qa_reviewer_authorities(tenant_id,id,row_sha256,authority_id,key_id,reviewer_id,scope,algorithm,public_key_fingerprint_sha256,public_jwk,status,created_at,created_at_canonical,revoked_at) values (${q(plan.reviewerAuthority.tenantId)},${q(plan.reviewerAuthority.id)},${q(plan.reviewerAuthority.rowSha256)},${q(plan.reviewerAuthority.authorityId)},${q(plan.reviewerAuthority.keyId)},${q(plan.reviewerAuthority.reviewerId)},${q(plan.reviewerAuthority.scope)},${q(plan.reviewerAuthority.algorithm)},${q(plan.reviewerAuthority.publicKeyFingerprintSha256)},${j(plan.reviewerAuthority.publicJwk)},'active',${q(plan.reviewerAuthority.createdAt)},${q(plan.reviewerAuthority.createdAt)},null);
  `);
  const sessions = createSinglePglitePinnedSessionProvider(db); const writer = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: candidate.tenantId }), humanQaContextAt: (observedAt) => { const context = structuredClone(human.context); context.caliperProvenanceContext.evaluatedAt = observedAt; return context; }, database: createPgliteNonProxyQaWriterDatabase(sessions) });
  await writer.write("opaque", human.request);
  return { db, sessions, candidate, plan };
}

function harness(options = {}) {
  const log = []; const state = { discarded: 0, locatorReads: 0 };
  const query = async (sql, parameters = []) => {
    log.push({ sql, parameters });
    if (sql.startsWith("select generation_job_id")) {
      state.locatorReads += 1;
      const value = options.driftLocator && state.locatorReads === 2 ? { ...locator, generation_job_id: "job-b" } : locator;
      return { rows: [value] };
    }
    if (sql.startsWith("select pg_catalog.pg_advisory_lock")) {
      if (options.rejectLock === log.filter((item) => item.sql.startsWith("select pg_catalog.pg_advisory_lock")).length) throw options.lockError;
      return { rows: [{ pg_advisory_lock: null }] };
    }
    if (sql.startsWith("select pg_catalog.pg_advisory_unlock")) {
      if (options.rejectUnlock) throw new Error("unlock transport unknown");
      return { rows: [{ unlocked: true }] };
    }
    if (sql === "reset role" && options.rejectResetRole) throw new Error("reset role unknown");
    return { rows: [] };
  };
  const transaction = { query };
  const session = {
    query,
    async transaction(callback) {
      log.push({ sql: "<BEGIN>", parameters: [] });
      if (options.skipTransactionCallback) return "forged";
      let value;
      try { value = await callback(transaction); }
      catch (error) { log.push({ sql: "<ROLLBACK>", parameters: [] }); if (options.replaceRollbackUndefined) return Promise.reject(); if (options.replaceRollbackError) throw new Error("rollback unknown"); throw error; }
      log.push({ sql: "<COMMIT>", parameters: [] });
      if (options.rejectAfterCallback) throw new Error("commit unknown");
      return options.replaceTransactionSuccess ? Object.freeze({ forged: true }) : value;
    },
  };
  const lease = { session, discard: async () => { state.discarded += 1; if (options.rejectDiscard) throw new Error("close failed"); } };
  const sessions = { async withPinnedSession(callback) { if (options.skipProviderCallback) return Object.freeze({ forged: true }); const value = await callback(lease); if (options.doubleProviderCallback) { try { await callback(lease); } catch { /* hostile provider suppresses the second callback failure */ } } if (options.rejectCheckin) throw new Error("check-in unknown"); return options.replaceProviderSuccess ? Object.freeze({ forged: true }) : value; } };
  return { database: createPgliteCommittedReviewQaPreviewDatabase(sessions), log, state };
}

const DRIVER_INTEGER_COLUMNS = new Set(["candidate_version", "manifest_byte_length", "model_byte_length", "signed_schema_version", "maximum_review_age_ms", "version", "head_manifest_byte_length", "head_model_byte_length"]);
function transformDriverRows(result, transform) { return { ...result, rows: result.rows.map((raw) => transform({ ...raw })) }; }
function readerDatabase(db, transform) {
  const state = { discarded: 0 };
  const query = async (target, sql, parameters) => transformDriverRows(await target.query(sql, parameters), (row) => transform(sql, row));
  const session = { query: (sql, parameters) => query(db, sql, parameters), transaction: (work) => db.transaction((transaction) => work({ query: (sql, parameters) => query(transaction, sql, parameters) })) };
  return { database: createPgliteCommittedReviewQaPreviewDatabase({ withPinnedSession: (work) => work({ session, discard: async () => { state.discarded += 1; } }) }), state };
}
function stringifyDriverIntegers(_sql, row) { for (const key of DRIVER_INTEGER_COLUMNS) if (typeof row[key] === "number" || typeof row[key] === "bigint") row[key] = String(row[key]); return row; }

test("pinned reader role, canonical session locks, repeatable-read snapshot, and reverse cleanup are exact", async () => {
  const h = harness();
  assert.equal(await h.database.readonly(selection, async () => "ok"), "ok");
  assert.equal(h.state.discarded, 0);
  assert.deepEqual(h.log.map((item) => item.sql), [
    "set lock_timeout = '5s'", "set statement_timeout = '15s'", "set role jessica_committed_review_qa_preview_reader",
    "select generation_job_id,reviewer_authority_id,reviewer_key_id from private.non_proxy_human_qa_records where tenant_id=$1 and candidate_asset_version_id=$2 and candidate_version=$3",
    "select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1,218))",
    "select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1,218))",
    "select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1,218))", "<BEGIN>",
    "set transaction isolation level repeatable read, read only", "set local search_path = pg_catalog, private", "set local statement_timeout = '15s'", "set local idle_in_transaction_session_timeout = '15s'",
    "select generation_job_id,reviewer_authority_id,reviewer_key_id from private.non_proxy_human_qa_records where tenant_id=$1 and candidate_asset_version_id=$2 and candidate_version=$3",
    "<COMMIT>",
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,218)) as unlocked",
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,218)) as unlocked",
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,218)) as unlocked",
    "reset role", "reset lock_timeout", "reset statement_timeout",
  ]);
  const lockParams = h.log.filter((item) => item.sql.includes("pg_advisory_lock(")).map((item) => item.parameters[0]);
  const unlockParams = h.log.filter((item) => item.sql.includes("pg_advisory_unlock(")).map((item) => item.parameters[0]);
  assert.deepEqual(lockParams, ["authority:8:tenant-a11:authority-a5:key-a", "candidate:8:tenant-a7:asset-a:7", "job:8:tenant-a5:job-a"]);
  assert.deepEqual(unlockParams, [...lockParams].reverse());
});

test("post-lock locator drift rolls back, unlocks, resets role, and preserves the confirmed callback error", async () => {
  const h = harness({ driftLocator: true });
  await assert.rejects(h.database.readonly(selection, async () => "unreachable"));
  assert.equal(h.log.some((item) => item.sql === "<ROLLBACK>"), true);
  assert.equal(h.log.filter((item) => item.sql.includes("pg_advisory_unlock(")).length, 3);
  assert.equal(h.log.some((item) => item.sql === "reset role"), true);
  assert.equal(h.state.discarded, 0);
});

test("unknown lock acknowledgement, commit/rollback boundary, check-in, unlock, or role reset permanently discards", async () => {
  const cases = [
    { rejectLock: 2, lockError: undefined },
    { rejectAfterCallback: true },
    { driftLocator: true, replaceRollbackError: true },
    { rejectCheckin: true },
    { rejectUnlock: true },
    { rejectResetRole: true },
    { workUndefined: true, replaceRollbackUndefined: true },
    { skipTransactionCallback: true },
    { replaceTransactionSuccess: true },
    { replaceProviderSuccess: true },
    { doubleProviderCallback: true },
  ];
  for (const options of cases) {
    const h = harness(options);
    await assert.rejects(h.database.readonly(selection, async () => options.workUndefined ? Promise.reject() : "ok"));
    assert.equal(h.state.discarded >= 1, true, JSON.stringify(options));
  }
});

test("a provider that resolves without invoking its lease callback cannot forge success", async () => {
  const h = harness({ skipProviderCallback: true });
  await assert.rejects(h.database.readonly(selection, async () => "unreachable"));
  assert.equal(h.state.discarded, 0, "no lease was exposed by the invalid provider, so there is no exact physical target to discard");
});

test("reader reconstructs node-postgres-style canonical int8 strings without a global parser", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await committedFixture();
  try {
    const h = readerDatabase(input.db, stringifyDriverIntegers);
    const wanted = { tenantId: input.candidate.tenantId, assetVersionId: input.candidate.id, assetVersion: input.candidate.version };
    const snapshot = await h.database.readonly(wanted, (transaction) => transaction.readAuthoritativeSnapshot(wanted));
    assert.equal(snapshot.asset.version, input.candidate.version);
    assert.equal(snapshot.generationJob.currentOutputManifestByteLength, input.plan.reviewRecord.output.manifestByteLength);
    assert.equal(snapshot.generationJob.currentOutputModelByteLength, input.plan.reviewRecord.output.modelByteLength);
    assert.equal(h.state.discarded, 0);
  } finally { Date.now = oldNow; await input.db.close().catch(() => {}); }
});

test("reader rejects non-canonical, signed, fractional, and unsafe int8 strings", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await committedFixture();
  try {
    const wanted = { tenantId: input.candidate.tenantId, assetVersionId: input.candidate.id, assetVersion: input.candidate.version };
    for (const value of ["", "0", "00", "01", "+1", "-1", " 1", "1 ", "1e3", "1.0", "1.5", "9007199254740992"]) {
      const h = readerDatabase(input.db, (sql, row) => { if (sql.includes("join lateral") && Object.hasOwn(row, "head_manifest_byte_length")) row.head_manifest_byte_length = value; return row; });
      await assert.rejects(h.database.readonly(wanted, (transaction) => transaction.readAuthoritativeSnapshot(wanted)), undefined, String(value));
      assert.equal(h.state.discarded, 0, String(value));
    }
  } finally { Date.now = oldNow; await input.db.close().catch(() => {}); }
});

test("real PGlite v1-v4 committed approve reconstructs through the reader role and revoked authority fails closed", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await committedFixture();
  try {
    const database = createPgliteCommittedReviewQaPreviewDatabase(input.sessions);
    const wanted = { tenantId: input.candidate.tenantId, assetVersionId: input.candidate.id, assetVersion: input.candidate.version };
    const verified = await database.readonly(wanted, async (transaction) => ({ observedAt: await transaction.transactionTimestamp(), snapshot: await transaction.readAuthoritativeSnapshot(wanted), final: await transaction.finalRecheck(wanted) }));
    assert.equal(verified.snapshot.asset.id, input.candidate.id);
    assert.equal(verified.snapshot.asset.rowSha256, input.plan.assetVersion.rowSha256);
    assert.deepEqual(verified.snapshot.asset.attachmentMatrix, input.plan.assetVersion.attachmentMatrix);
    assert.deepEqual(verified.snapshot.review.approvedQualityEnvelope, input.plan.reviewRecord.approvedQualityEnvelope);
    assert.equal(verified.snapshot.generationJob.currentHeadEventSha256, input.plan.reviewRecord.reviewHeadEventSha256);
    assert.deepEqual(verified.snapshot.assetSourceSha256s, input.candidate.sourceAssetHashes);
    assert.equal(verified.final.snapshot.review.rowSha256, input.plan.reviewRecord.rowSha256);
    assert.equal(Date.parse(verified.final.clockTimestamp) >= Date.parse(verified.observedAt), true);
    await input.db.query("update private.qa_reviewer_authorities set status='revoked',revoked_at=$3 where tenant_id=$1 and id=$2", [input.plan.reviewerAuthority.tenantId, input.plan.reviewerAuthority.id, "2026-08-11T03:01:00Z"]);
    await assert.rejects(database.readonly(wanted, async (transaction) => transaction.readAuthoritativeSnapshot(wanted)));
  } finally { Date.now = oldNow; await input.db.close().catch(() => {}); }
});

test("source/read budgets and final clock ordering remain fail-closed in the implementation", async () => {
  const source = await readFile(new URL("../packages/asset-review/src/committedReviewQaPreviewPgliteDatabase.ts", import.meta.url), "utf8");
  assert.match(source, /limit 33/);
  assert.match(source, /sourceRaw\.length < 1 \|\| sourceRaw\.length > 32/);
  assert.match(source, /budget\.rows > 128/);
  assert.match(source, /async finalRecheck[\s\S]*readSnapshot\(transaction, selection\)[\s\S]*select clock_timestamp\(\)::text as clock_timestamp/);
  assert.doesNotMatch(source, /pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /attachmentMatrixSha256|qualityEnvelopeSha256/);
});
