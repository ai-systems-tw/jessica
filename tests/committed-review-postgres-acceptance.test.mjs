import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const REQUIRED = process.env.JESSICA_POSTGRES_ACCEPTANCE_REQUIRED === "1";
const DATABASE_URL = process.env.JESSICA_POSTGRES_ACCEPTANCE_URL;
const WAIT_BUDGET_MS = 5_000;
const CONNECTION_TIMEOUT_MS = 5_000;
const REVIEW_EXPIRY_WINDOW_MS = 8_000;
const HEAD_ADVANCE_SQL = `
  insert into private.generation_job_events(
    tenant_id,generation_job_id,sequence,event_type,occurred_at,occurred_at_canonical,
    previous_event_sha256,event_sha256,evidence
  ) select $1,$2,prior.sequence+1,'failed','2030-01-01T00:00:00Z','2030-01-01T00:00:00.000Z',
      prior.event_sha256,$3,'{"reason":"jsc-0220-head-advance"}'::jsonb
    from private.generation_job_events prior
    where prior.tenant_id=$1 and prior.generation_job_id=$2
    order by prior.sequence desc limit 1
  returning sequence
`;

const digest = (value) => createHash("sha256").update(value).digest("hex");
const part = (value) => `${value.length}:${value}`;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

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
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} exceeded ${WAIT_BUDGET_MS}ms`)), WAIT_BUDGET_MS);
  });
  try { return await Promise.race([promise, deadline]); }
  finally { clearTimeout(timeout); }
}

async function bootstrap(adminPool) {
  const preflight = await adminPool.query(`
    select current_database() as database_name,
      current_setting('server_version_num')::integer as server_version_num,
      to_regnamespace('private') is null as private_schema_absent,
      not exists (
        select 1 from pg_catalog.pg_roles
        where rolname in ('anon','authenticated','service_role','qa_internal_admin',
          'jessica_non_proxy_qa_writer','jessica_committed_review_qa_preview_reader')
      ) as roles_absent,
      not exists (
        select 1 from pg_catalog.pg_namespace
        where nspname !~ '^pg_' and nspname not in ('information_schema','public')
      ) as user_schemas_absent,
      not exists (
        select 1 from pg_catalog.pg_class class
        join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace
        where namespace.nspname='public'
      ) as public_classes_absent,
      not exists (
        select 1 from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
        where namespace.nspname='public'
      ) as public_procs_absent,
      not exists (
        select 1 from pg_catalog.pg_type type
        join pg_catalog.pg_namespace namespace on namespace.oid=type.typnamespace
        where namespace.nspname='public'
      ) as public_types_absent
  `);
  assert.deepEqual(preflight.rows, [{
    database_name: "jessica_acceptance",
    server_version_num: preflight.rows[0].server_version_num,
    private_schema_absent: true,
    roles_absent: true,
    user_schemas_absent: true,
    public_classes_absent: true,
    public_procs_absent: true,
    public_types_absent: true,
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
  ]);
  for (const name of migrations) await adminPool.query(await readFile(new URL(name, migrationDirectory), "utf8"));
  return { migrations, serverVersionNum: preflight.rows[0].server_version_num };
}

export async function refreshPlanForDatabaseClock(contracts, plan, privateKey, databaseNow) {
  const reviewedAt = new Date(databaseNow.getTime() - 10 * 60 * 1000).toISOString();
  const issuedAt = new Date(databaseNow.getTime() - 9 * 60 * 1000).toISOString();
  const expiresAt = new Date(databaseNow.getTime() + REVIEW_EXPIRY_WINDOW_MS).toISOString();
  const inputValidUntil = new Date(databaseNow.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const reviewFreshUntil = new Date(Date.parse(reviewedAt) + plan.reviewRecord.maximumReviewAgeMs).toISOString();
  const effectiveValidUntil = new Date(Math.min(Date.parse(expiresAt), Date.parse(inputValidUntil), Date.parse(reviewFreshUntil))).toISOString();
  const review = structuredClone(plan.reviewRecord);
  review.composition.inputValidUntil = inputValidUntil;
  Object.assign(review, { reviewedAt, issuedAt, expiresAt, inputValidUntil, reviewFreshUntil, effectiveValidUntil });
  const signedPayload = contracts.nonProxyHumanQaSignedPayloadFromRecord(review);
  review.decisionPayloadSha256 = await contracts.sha256Hex(contracts.canonicalJson(signedPayload));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(contracts.canonicalJson(signedPayload)),
  );
  review.signatureBase64 = Buffer.from(signature).toString("base64");
  const semantic = await contracts.sha256Hex(contracts.canonicalJson({
    domain: "jessica/non-proxy-qa/terminal-review-identity/v1",
    tenantId: review.tenantId,
    candidateAssetVersionId: review.candidateAssetVersionId,
    candidateVersion: review.candidateVersion,
    generationJobId: review.generationJobId,
    decisionPayloadSha256: review.decisionPayloadSha256,
  }));
  review.id = `nqhr_${semantic}`;
  const { id: _reviewId, rowSha256: _reviewDigest, ...reviewBody } = review;
  review.rowSha256 = await contracts.sha256Hex(contracts.canonicalJson({ domain: "jessica/non-proxy-qa/human-review-row/v1", body: reviewBody }));

  const binding = structuredClone(plan.binding);
  Object.assign(binding, {
    reviewRecordId: review.id,
    decisionPayloadSha256: review.decisionPayloadSha256,
    effectiveValidUntil,
  });
  const { id: _bindingId, rowSha256: _bindingDigest, ...bindingBody } = binding;
  binding.rowSha256 = await contracts.sha256Hex(contracts.canonicalJson({ domain: "jessica/non-proxy-qa/asset-binding-row/v1", body: bindingBody }));
  binding.id = `nqab_${binding.rowSha256}`;

  const next = {
    schemaVersion: 1,
    planType: "non-proxy-qa-persistence-row-projections",
    decision: plan.decision,
    reviewerAuthority: structuredClone(plan.reviewerAuthority),
    reviewRecord: review,
    assetVersion: structuredClone(plan.assetVersion),
    binding,
    sourceRows: structuredClone(plan.sourceRows),
    authority: structuredClone(plan.authority),
  };
  const planSha256 = await contracts.sha256Hex(contracts.canonicalJson({ domain: "jessica/non-proxy-qa/persistence-plan/v1", body: next }));
  return contracts.inspectNonProxyQaPersistencePlanIntegrity({ ...next, planSha256, idempotencyKey: `nqpp_${planSha256}` });
}

export async function planFixture(assetReview, contracts, setupHumanQa, readDatabaseClock) {
  const human = await setupHumanQa("approve");
  const candidate = human.candidate;
  const attestation = human.request.decisionAttestation;
  const maximumReviewAgeMs = human.context.reviewerTrust.maximumReviewAgeMs;
  const control = {
    schemaVersion: 1,
    observedAt: human.context.caliperProvenanceContext.evaluatedAt,
    tenantId: candidate.tenantId,
    frameModelId: candidate.frameModelId,
    frameVariantId: candidate.frameVariantId,
    generationJob: {
      id: candidate.generation.jobId,
      canonicalInputSha256: candidate.generation.canonicalInputSha256,
      reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256,
      generatorInputSha256: candidate.generation.generatorInputSha256,
      output: {
        manifestSha256: candidate.manifestSha256,
        modelSha256: candidate.modelSha256,
        manifestByteLength: candidate.manifestByteLength,
        modelByteLength: candidate.modelByteLength,
      },
    },
    sourceMappings: candidate.sourceAssetHashes.map((sourceAssetSha256, index) => ({ sourceAssetSha256, sourceAssetId: `source-persist-${index + 1}` })),
    measurementSet: { id: "measurement-set-persist-1", sha256: candidate.requirements.physical.measurementSetSha256 },
    candidateAssetVersion: { id: candidate.id, version: candidate.version },
    existingRows: { reviewerAuthority: null, reviewRecord: null, assetVersion: null, binding: null, sourceRows: [] },
    reviewerAuthority: {
      authorityId: attestation.authorityId,
      keyId: attestation.keyId,
      reviewerId: attestation.reviewerId,
      scope: "non-proxy-human-qa-decision",
      publicKeyFingerprintSha256: attestation.publicKeyFingerprintSha256,
      publicJwk: structuredClone(human.reviewerJwk),
      status: "active",
      createdAt: "2026-08-11T02:00:00Z",
      revokedAt: null,
    },
    reviewPolicy: {
      maximumReviewAgeMs,
      sha256: digest(contracts.canonicalJson({ domain: "jessica/non-proxy-qa/review-policy/v1", maximumReviewAgeMs })),
    },
  };
  const stalePlan = await assetReview.evaluateNonProxyQaPersistencePlan(
    { humanQaRequest: human.request },
    { humanQaContext: human.context, controlPlaneSnapshot: control },
  );
  const databaseNow = await readDatabaseClock();
  assert.equal(databaseNow instanceof Date, true);
  const plan = await refreshPlanForDatabaseClock(contracts, stalePlan, human.reviewerKey.privateKey, databaseNow);
  return { human, candidate, attestation, plan, databaseNow };
}

async function seedPrerequisites(adminPool, fixture) {
  const { human, candidate, attestation, plan } = fixture;
  await adminPool.query("insert into private.tenants(id,slug,display_name,status) values($1,'preview-tenant','Preview Tenant','active')", [candidate.tenantId]);
  await adminPool.query("insert into private.frame_models(tenant_id,id,model_code,name,lens_width_mm,bridge_width_mm,temple_length_mm,frame_width_mm,lens_height_mm) values($1,$2,'PREVIEW','Preview Model',52,18,145,140,40)", [candidate.tenantId, candidate.frameModelId]);
  await adminPool.query("insert into private.frame_variants(tenant_id,id,frame_model_id,sku,frame_color,frame_material,lens_type) values($1,$2,$3,'PREVIEW-SKU','black','acetate','clear')", [candidate.tenantId, candidate.frameVariantId, candidate.frameModelId]);
  for (const [index, sourceSha256] of candidate.sourceAssetHashes.entries()) {
    await adminPool.query(`
      insert into private.source_assets(
        tenant_id,id,frame_model_id,frame_variant_id,kind,object_key,sha256,byte_length,
        mime_type,width_px,height_px,provenance_sha256,provenance,inspected_at,inspector_subject_id
      ) values($1,$2,$3,$4,'other',$5,$6,100,'image/png',10,10,$7,'{}'::jsonb,'2026-08-11T01:00:00Z','operator')
    `, [candidate.tenantId, `source-persist-${index + 1}`, candidate.frameModelId, index === 0 ? null : candidate.frameVariantId, `preview-source-${index}`, sourceSha256, digest(`preview-provenance-${index}`)]);
  }
  await adminPool.query(`
    insert into private.measurement_sets(
      tenant_id,id,frame_model_id,version,method,evidence_sha256,status,
      verified_by_subject_id,verified_at,specimen_id
    ) values($1,'measurement-set-persist-1',$2,1,'caliper',$3,'verified','operator','2026-08-11T02:00:00Z',$4)
  `, [candidate.tenantId, candidate.frameModelId, candidate.requirements.physical.measurementSetSha256, attestation.specimenId]);

  const ledgerArtifact = human.request.caliperProvenanceRequest.formalizationRequest.artifacts.find((artifact) => artifact.kind === "generation-ledger");
  assert.ok(ledgerArtifact);
  const ledger = JSON.parse(new TextDecoder().decode(ledgerArtifact.bytes));
  const jobRequest = ledger[0].payload.request;
  await adminPool.query(`
    insert into private.generation_jobs(
      tenant_id,id,frame_model_id,idempotency_key,canonical_input_sha256,method,
      generator_id,generator_version,generator_config_sha256,source_asset_sha256s,
      measurement_set_sha256,generator_input_sha256,max_attempts,created_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::private.sha256[],$11,$12,$13,$14)
  `, [candidate.tenantId, candidate.generation.jobId, candidate.frameModelId, ledger[0].idempotencyKey, candidate.generation.canonicalInputSha256, jobRequest.method, jobRequest.generator.id, jobRequest.generator.version, jobRequest.generator.configSha256, jobRequest.sourceAssetSha256s, jobRequest.measurementSetSha256, jobRequest.generatorInputSha256, jobRequest.maxAttempts, jobRequest.createdAt]);
  for (const event of ledger) {
    const output = event.eventType === "output-recorded" ? event.payload.output : null;
    await adminPool.query(`
      insert into private.generation_job_events(
        tenant_id,generation_job_id,sequence,event_type,occurred_at,occurred_at_canonical,
        previous_event_sha256,event_sha256,evidence,output_manifest_sha256,
        output_manifest_byte_length,output_model_sha256,output_model_byte_length
      ) values($1,$2,$3,$4,$5::timestamptz,$5::text,$6,$7,$8::jsonb,$9,$10,$11,$12)
    `, [event.tenantId, event.jobId, event.sequence, event.eventType, event.occurredAt, event.previousEventSha256, event.eventSha256, JSON.stringify(event.payload), output?.manifestSha256 ?? null, output?.manifestByteLength ?? null, output?.modelSha256 ?? null, output?.modelByteLength ?? null]);
  }
  await adminPool.query(`
    insert into private.qa_reviewer_authorities(
      tenant_id,id,row_sha256,authority_id,key_id,reviewer_id,scope,algorithm,
      public_key_fingerprint_sha256,public_jwk,status,created_at,created_at_canonical,revoked_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'active',$11::timestamptz,$11::text,null)
  `, [plan.reviewerAuthority.tenantId, plan.reviewerAuthority.id, plan.reviewerAuthority.rowSha256, plan.reviewerAuthority.authorityId, plan.reviewerAuthority.keyId, plan.reviewerAuthority.reviewerId, plan.reviewerAuthority.scope, plan.reviewerAuthority.algorithm, plan.reviewerAuthority.publicKeyFingerprintSha256, JSON.stringify(plan.reviewerAuthority.publicJwk), plan.reviewerAuthority.createdAt]);
}

function writerSelection(fixture) {
  const { candidate, plan } = fixture;
  return {
    tenantId: candidate.tenantId,
    frameModelId: candidate.frameModelId,
    frameVariantId: candidate.frameVariantId,
    candidateAssetVersionId: candidate.id,
    candidateVersion: candidate.version,
    generationJobId: candidate.generation.jobId,
    canonicalInputSha256: candidate.generation.canonicalInputSha256,
    reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256,
    sourceAssetSha256s: [...candidate.sourceAssetHashes],
    measurementSetSha256: candidate.requirements.physical.measurementSetSha256,
    specimenId: fixture.attestation.specimenId,
    reviewerAuthorityId: plan.reviewRecord.reviewerAuthorityId,
    reviewerKeyId: plan.reviewRecord.reviewerKeyId,
  };
}

async function commitFixture(assetReview, createProvider, writerPool, fixture) {
  let lastFaultPoint = "provider-checkout";
  const writerDatabase = assetReview.createPgliteNonProxyQaWriterDatabase(createProvider(writerPool), {
    fault(point) { lastFaultPoint = point; },
  });
  try {
    await writerDatabase.serializable(writerSelection(fixture), async (transaction) => {
      await transaction.transactionTimestamp();
      await transaction.insertReviewRecord(fixture.plan.reviewRecord);
      await transaction.insertAssetVersionInReview(fixture.plan.assetVersion);
      for (const source of [...fixture.plan.sourceRows].sort((left, right) => left.sourceSha256.localeCompare(right.sourceSha256))) await transaction.insertAssetVersionSource(source);
      await transaction.insertBinding(fixture.plan.binding);
      await transaction.approveAssetVersion(fixture.plan.assetVersion);
      assert.equal(await transaction.verifyExact(fixture.plan), true);
    }, async (transaction) => { assert.equal(await transaction.verifyExact(fixture.plan), true); });
  } catch (error) {
    throw new Error(`writer acceptance failed after ${lastFaultPoint}`, { cause: error });
  }
}

async function readOnce(database, selection) {
  return database.readonly(selection, async (transaction) => {
    const snapshot = await transaction.readAuthoritativeSnapshot(selection);
    const final = await transaction.finalRecheck(selection);
    return { snapshot, final };
  });
}

async function databaseClock(adminPool) {
  const observedAt = (await adminPool.query("select clock_timestamp() as observed_at")).rows[0].observed_at;
  assert.equal(observedAt instanceof Date, true);
  return observedAt;
}

async function advisoryLockState(adminPool, pid, key) {
  const result = await adminPool.query(`
    with wanted as (select pg_catalog.hashtextextended($2,218)::bigint as key)
    select lock.granted
    from pg_catalog.pg_locks lock cross join wanted
    where lock.pid=$1 and lock.locktype='advisory' and lock.objsubid=1
      and lock.classid::bigint=((wanted.key >> 32) & 4294967295)
      and lock.objid::bigint=(wanted.key & 4294967295)
  `, [pid, key]);
  return result.rows.map((row) => row.granted);
}

async function waitForAdvisoryBlock(adminPool, pid) {
  return eventually(async () => {
    const state = await adminPool.query("select state,wait_event_type,wait_event from pg_catalog.pg_stat_activity where pid=$1", [pid]);
    const row = state.rows[0];
    return row?.state === "active" && row.wait_event_type === "Lock" && row.wait_event === "advisory" ? row : null;
  }, `backend ${pid} advisory wait`);
}

async function heldRead(database, selection) {
  const entered = deferred();
  const release = deferred();
  const promise = database.readonly(selection, async (transaction) => {
    const snapshot = await transaction.readAuthoritativeSnapshot(selection);
    entered.resolve(snapshot);
    await release.promise;
    return transaction.finalRecheck(selection);
  });
  promise.catch(() => {});
  const snapshot = await within(entered.promise, "reader callback entry");
  return { snapshot, release: release.resolve, promise };
}

async function runBlockedMutation({ adminPool, database, selection, sql, parameters, acquiredPids, commit = true }) {
  const held = await heldRead(database, selection);
  const readerPid = acquiredPids.at(-1);
  assert.equal(Number.isInteger(readerPid), true);
  const mutator = await adminPool.connect();
  try {
    const mutatorPid = Number((await mutator.query("select pg_backend_pid() as pid")).rows[0].pid);
    assert.notEqual(mutatorPid, readerPid);
    await mutator.query("begin");
    const mutation = mutator.query(sql, parameters);
    mutation.catch(() => {});
    await waitForAdvisoryBlock(adminPool, mutatorPid);
    held.release();
    await within(held.promise, "held reader completion");
    const result = await within(mutation, "blocked mutation completion");
    await mutator.query(commit ? "commit" : "rollback");
    return { result, mutatorPid, readerPid };
  } catch (error) {
    held.release();
    await within(held.promise, "failed blocked-reader cleanup").catch(() => {});
    await mutator.query("rollback").catch(() => {});
    throw error;
  } finally { mutator.release(); }
}

test("PostgreSQL 17 proves pinned-session ordering, mutation races, exact expiry, timeout rollback, discard, and recovery", { skip: !REQUIRED }, async (t) => {
  assert.equal(typeof DATABASE_URL, "string", "the dedicated runner must provide JESSICA_POSTGRES_ACCEPTANCE_URL");
  const [{ Pool }, assetReview, contracts, humanQa] = await Promise.all([
    import("pg"),
    import("../dist/packages/asset-review/src/index.js"),
    import("../dist/packages/contracts/src/index.js"),
    import("./non-proxy-human-qa-decision.test.mjs"),
  ]);
  // Integration seam supplied by JSC-0220's provider task. Keeping this lookup
  // dynamic lets ordinary non-PG suites skip safely while the PG job fails if
  // the production pinned-pool export is missing.
  const createProvider = assetReview.createPgPoolPinnedSessionProvider;
  assert.equal(typeof createProvider, "function", "asset-review must export createPgPoolPinnedSessionProvider(pool)");

  const adminPool = new Pool({ connectionString: DATABASE_URL, max: 8, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0220-admin" });
  const writerPool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0220-writer" });
  const readerPool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, application_name: "jessica-jsc-0220-reader" });
  const acquiredPids = [];
  readerPool.on("acquire", (client) => { acquiredPids.push(client.processID); });

  try {
    const boot = await bootstrap(adminPool);
    assert.equal(boot.migrations.length, 4);
    const fixture = await planFixture(assetReview, contracts, humanQa.setup, () => databaseClock(adminPool));
    const { databaseNow } = fixture;
    await seedPrerequisites(adminPool, fixture);
    await commitFixture(assetReview, createProvider, writerPool, fixture);
    const selection = { tenantId: fixture.candidate.tenantId, assetVersionId: fixture.candidate.id, assetVersion: fixture.candidate.version };
    const readerProvider = createProvider(readerPool);
    const database = assetReview.createPgliteCommittedReviewQaPreviewDatabase(readerProvider);
    const baseline = await readOnce(database, selection);
    assert.equal(baseline.snapshot.asset.rowSha256, fixture.plan.assetVersion.rowSha256);
    assert.equal(baseline.final.snapshot.review.rowSha256, fixture.plan.reviewRecord.rowSha256);
    const service = assetReview.createCommittedReviewQaPreviewService({
      authenticate: async (identity) => identity === "jsc-0220-session" ? {
        tenantId: selection.tenantId,
        actorId: "jsc-0220-actor",
        reviewerId: fixture.plan.reviewRecord.reviewerId,
        sessionId: "jsc-0220-session-id",
        sessionExpiresAt: new Date(databaseNow.getTime() + 30 * 60 * 1000).toISOString(),
        scopes: ["qa-preview:read"],
      } : null,
      database,
      maximumCapabilityAgeMs: 5 * 60 * 1000,
    });
    const capability = await service.issue("jsc-0220-session", selection);
    const eligibility = await service.use("jsc-0220-session", capability);
    assert.equal(eligibility.asset.assetVersionId, selection.assetVersionId);
    assert.equal(eligibility.authority.qaPreviewEligibility, true);
    assert.equal(eligibility.authority.qaPreviewRuntime, false);
    const expiryCapability = await service.issue("jsc-0220-session", selection);
    assert.equal(expiryCapability.expiresAt, fixture.plan.reviewRecord.effectiveValidUntil);
    assert.ok((await databaseClock(adminPool)).getTime() < Date.parse(expiryCapability.expiresAt), "expiry capability must be issued before the exact database-clock horizon");

    const keys = {
      authority: `authority:${part(selection.tenantId)}${part(fixture.plan.reviewRecord.reviewerAuthorityId)}${part(fixture.plan.reviewRecord.reviewerKeyId)}`,
      candidate: `candidate:${part(selection.tenantId)}${part(selection.assetVersionId)}:${selection.assetVersion}`,
      job: `job:${part(selection.tenantId)}${part(fixture.candidate.generation.jobId)}`,
    };

    await t.test("distinct physical sessions acquire authority then candidate then job", async () => {
      const blocker = await adminPool.connect();
      const callbackEntered = deferred();
      const releaseCallback = deferred();
      let read;
      try {
        const blockerPid = Number((await blocker.query("select pg_backend_pid() as pid")).rows[0].pid);
        await blocker.query("select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1,218))", [keys.candidate]);
        const acquireCount = acquiredPids.length;
        read = database.readonly(selection, async (transaction) => {
          callbackEntered.resolve();
          await releaseCallback.promise;
          return transaction.finalRecheck(selection);
        });
        read.catch(() => {});
        const readerPid = await eventually(() => acquiredPids.length > acquireCount ? acquiredPids.at(-1) : null, "reader checkout");
        assert.notEqual(readerPid, blockerPid);
        await waitForAdvisoryBlock(adminPool, readerPid);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.authority), [true]);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.candidate), [false]);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.job), []);

        await blocker.query("select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,218))", [keys.candidate]);
        await within(callbackEntered.promise, "ordered reader callback entry");
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.authority), [true]);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.candidate), [true]);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.job), [true]);
        releaseCallback.resolve();
        await within(read, "ordered reader completion");
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.authority), []);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.candidate), []);
        assert.deepEqual(await advisoryLockState(adminPool, readerPid, keys.job), []);
      } finally {
        releaseCallback.resolve();
        await blocker.query("select pg_catalog.pg_advisory_unlock_all()").catch(() => {});
        await within(read ?? Promise.resolve(), "ordered reader cleanup").catch(() => {});
        blocker.release();
      }
    });

    await t.test("authority revocation blocks until the reader completes, then rolls back cleanly", async () => {
      const race = await runBlockedMutation({
        adminPool,
        database,
        selection,
        acquiredPids,
        sql: "update private.qa_reviewer_authorities set status='revoked',revoked_at=clock_timestamp() where tenant_id=$1 and id=$2 returning id",
        parameters: [selection.tenantId, fixture.plan.reviewerAuthority.id],
        commit: false,
      });
      assert.equal(race.result.rowCount, 1);
      assert.equal((await readOnce(database, selection)).snapshot.reviewerAuthority.status, "active");
    });

    await t.test("GenerationJob head advance blocks until the reader completes, then rolls back cleanly", async () => {
      const advancedSha256 = digest("jsc-0220-head-advance");
      const race = await runBlockedMutation({
        adminPool,
        database,
        selection,
        acquiredPids,
        sql: HEAD_ADVANCE_SQL,
        parameters: [selection.tenantId, fixture.candidate.generation.jobId, advancedSha256],
        commit: false,
      });
      assert.equal(race.result.rowCount, 1);
      assert.equal((await readOnce(database, selection)).snapshot.generationJob.currentHeadEventSha256, fixture.plan.reviewRecord.reviewHeadEventSha256);
    });

    await t.test("candidate retirement blocks until the reader completes, then rolls back cleanly", async () => {
      const race = await runBlockedMutation({
        adminPool,
        database,
        selection,
        acquiredPids,
        sql: "update private.asset_versions set status='retired' where tenant_id=$1 and id=$2 and version=$3 returning id",
        parameters: [selection.tenantId, selection.assetVersionId, selection.assetVersion],
        commit: false,
      });
      assert.equal(race.result.rowCount, 1);
      assert.equal((await readOnce(database, selection)).snapshot.asset.status, "approved");
    });

    await t.test("a confirmed callback rollback preserves the exact error and the physical session", async () => {
      const marker = new Error("jsc-0220-confirmed-callback-rollback");
      const before = acquiredPids.length;
      await assert.rejects(database.readonly(selection, async (transaction) => {
        await transaction.readAuthoritativeSnapshot(selection);
        throw marker;
      }), (error) => error === marker);
      const rollbackPid = acquiredPids[before];
      await readOnce(database, selection);
      const recoveryPid = acquiredPids[before + 1];
      assert.equal(recoveryPid, rollbackPid);
      assert.equal(readerPool.totalCount, 1, "confirmed rollback keeps the dedicated physical client");
    });

    await t.test("backend loss discards the lease and a fresh PID recovers", async () => {
      const before = acquiredPids.length;
      let terminatedPid;
      await assert.rejects(database.readonly(selection, async (transaction) => {
        await transaction.readAuthoritativeSnapshot(selection);
        terminatedPid = acquiredPids.at(-1);
        const termination = await adminPool.query("select pg_catalog.pg_terminate_backend($1) as terminated", [terminatedPid]);
        assert.equal(termination.rows[0].terminated, true);
        return transaction.finalRecheck(selection);
      }));
      assert.equal(terminatedPid, acquiredPids[before]);
      assert.equal(readerPool.totalCount, 0, "provider rejection waits for exact-client removal");
      await readOnce(database, selection);
      const freshPid = acquiredPids.at(-1);
      assert.notEqual(freshPid, terminatedPid);
      assert.equal(Number.isInteger(freshPid), true);
    });

    await t.test("real statement timeout rolls back safely and a new checkout recovers", async () => {
      const before = acquiredPids.length;
      let timeoutPid;
      await assert.rejects(readerProvider.withPinnedSession(async ({ session }) => {
        timeoutPid = Number((await session.query("select pg_backend_pid() as pid")).rows[0].pid);
        return session.transaction(async (transaction) => {
          await transaction.query("set local statement_timeout = '100ms'");
          await transaction.query("select pg_sleep(1)");
        });
      }), (error) => error?.code === "57014");
      assert.equal(timeoutPid, acquiredPids[before]);
      assert.equal(readerPool.totalCount, 1, "a confirmed rollback keeps the physical client reusable");

      let recoveryPid;
      await readerProvider.withPinnedSession(async ({ session }) => {
        recoveryPid = Number((await session.query("select pg_backend_pid() as pid")).rows[0].pid);
      });
      assert.equal(recoveryPid, timeoutPid, "a new checkout recovers on the safely rolled-back client");
    });

    await t.test("review expiry allows before and denies at the exact database-clock boundary", async () => {
      const expiresAt = Date.parse(expiryCapability.expiresAt);
      const reached = await eventually(async () => {
        const observedAt = await databaseClock(adminPool);
        return observedAt.getTime() >= expiresAt ? observedAt : null;
      }, "exact committed-review expiry boundary", REVIEW_EXPIRY_WINDOW_MS + WAIT_BUDGET_MS);
      assert.ok(reached.getTime() >= expiresAt);
      await assert.rejects(service.use("jsc-0220-session", expiryCapability), assetReview.CommittedReviewQaPreviewError);
    });

    await t.test("a committed append-only head advance invalidates every later committed-review read", async () => {
      const advancedSha256 = digest("jsc-0220-terminal-head-advance");
      const result = await adminPool.query(HEAD_ADVANCE_SQL, [selection.tenantId, fixture.candidate.generation.jobId, advancedSha256]);
      assert.equal(result.rowCount, 1);
      await assert.rejects(readOnce(database, selection), assetReview.CommittedReviewQaPreviewDatabaseAdapterError);
    });
  } finally {
    await Promise.allSettled([readerPool.end(), writerPool.end(), adminPool.end()]);
  }
});
