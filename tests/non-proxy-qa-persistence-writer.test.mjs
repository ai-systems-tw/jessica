import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { createPgliteNonProxyQaWriterDatabase, createSinglePglitePinnedSessionProvider, createTrustedNonProxyQaPersistenceWriter, evaluateNonProxyQaPersistencePlan, NonProxyQaDatabasePortError, reconstructNonProxyQaAssetRow } from "../dist/packages/asset-review/src/index.js";
import { setup as setupHumanQa } from "./non-proxy-human-qa-decision.fixture.mjs";

const migrationUrls = ["20260811071257_control_plane_publication_v1.sql", "20260821142538_non_proxy_qa_control_plane_persistence_v2.sql", "20260821155309_trusted_non_proxy_qa_writer_v3.sql"].map((name) => new URL(`../supabase/migrations/${name}`, import.meta.url));
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const j = (value) => `${q(JSON.stringify(value))}::jsonb`;
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function bootstrap(db) { await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable set search_path='' as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;"); for (const url of migrationUrls) await db.exec(await readFile(url, "utf8")); }

async function fixture(decision = "approve", options = {}) {
  const { human: suppliedHuman, wrapDatabase, maximumTransactionAttempts, dataDir, sessionProviderFactory, ...adapterOptions } = options; const human = suppliedHuman ?? await setupHumanQa(decision); const candidate = human.candidate; const attestation = human.request.decisionAttestation; const maximumReviewAgeMs = human.context.reviewerTrust.maximumReviewAgeMs;
  const policySha = digest(canonicalJson({ domain: "jessica/non-proxy-qa/review-policy/v1", maximumReviewAgeMs }));
  const control = { schemaVersion: 1, observedAt: "2026-08-11T03:00:00.000Z", tenantId: candidate.tenantId, frameModelId: candidate.frameModelId, frameVariantId: candidate.frameVariantId, generationJob: { id: candidate.generation.jobId, canonicalInputSha256: candidate.generation.canonicalInputSha256, reviewHeadEventSha256: candidate.generation.reviewHeadEventSha256, generatorInputSha256: candidate.generation.generatorInputSha256, output: { manifestSha256: candidate.manifestSha256, modelSha256: candidate.modelSha256, manifestByteLength: candidate.manifestByteLength, modelByteLength: candidate.modelByteLength } }, sourceMappings: candidate.sourceAssetHashes.map((sourceAssetSha256, index) => ({ sourceAssetSha256, sourceAssetId: `source-persist-${index + 1}` })), measurementSet: { id: "measurement-set-persist-1", sha256: candidate.requirements.physical.measurementSetSha256 }, candidateAssetVersion: { id: candidate.id, version: candidate.version }, existingRows: { reviewerAuthority: null, reviewRecord: null, assetVersion: null, binding: null, sourceRows: [] }, reviewerAuthority: { authorityId: attestation.authorityId, keyId: attestation.keyId, reviewerId: attestation.reviewerId, scope: "non-proxy-human-qa-decision", publicKeyFingerprintSha256: attestation.publicKeyFingerprintSha256, publicJwk: structuredClone(human.reviewerJwk), status: "active", createdAt: "2026-08-11T02:00:00Z", revokedAt: null }, reviewPolicy: { maximumReviewAgeMs, sha256: policySha } };
  control.observedAt = human.context.caliperProvenanceContext.evaluatedAt;
  const plan = await evaluateNonProxyQaPersistencePlan({ humanQaRequest: human.request }, { humanQaContext: human.context, controlPlaneSnapshot: control });
  const db = dataDir ? new PGlite(dataDir) : new PGlite(); await bootstrap(db);
  const output = plan.reviewRecord.output; const ledgerArtifact = human.request.caliperProvenanceRequest.formalizationRequest.artifacts.find((artifact) => artifact.kind === "generation-ledger"); const ledger = JSON.parse(new TextDecoder().decode(ledgerArtifact.bytes)); const jobRequest = ledger[0].payload.request;
  const eventSql = ledger.map((event) => `insert into private.generation_job_events(tenant_id,generation_job_id,sequence,event_type,occurred_at,occurred_at_canonical,previous_event_sha256,event_sha256,evidence,output_manifest_sha256,output_manifest_byte_length,output_model_sha256,output_model_byte_length) values (${q(event.tenantId)},${q(event.jobId)},${event.sequence},${q(event.eventType)},${q(event.occurredAt)},${q(event.occurredAt)},${event.previousEventSha256 === null ? "null" : q(event.previousEventSha256)},${q(event.eventSha256)},${j(event.payload)},${event.eventType === "output-recorded" ? `${q(event.payload.output.manifestSha256)},${event.payload.output.manifestByteLength},${q(event.payload.output.modelSha256)},${event.payload.output.modelByteLength}` : "null,null,null,null"});`).join("\n");
  await db.exec(`
    insert into private.tenants(id,slug,display_name,status) values (${q(candidate.tenantId)},'writer-tenant','Writer Tenant','active');
    insert into private.frame_models(tenant_id,id,model_code,name,lens_width_mm,bridge_width_mm,temple_length_mm,frame_width_mm,lens_height_mm) values (${q(candidate.tenantId)},${q(candidate.frameModelId)},'WRITER','Writer Model',52,18,145,140,40);
    insert into private.frame_variants(tenant_id,id,frame_model_id,sku,frame_color,frame_material,lens_type) values (${q(candidate.tenantId)},${q(candidate.frameVariantId)},${q(candidate.frameModelId)},'WRITER-SKU','black','acetate','clear');
    ${candidate.sourceAssetHashes.map((sourceSha256, index) => `insert into private.source_assets(tenant_id,id,frame_model_id,frame_variant_id,kind,object_key,sha256,byte_length,mime_type,width_px,height_px,provenance_sha256,provenance,inspected_at,inspector_subject_id) values (${q(candidate.tenantId)},${q(`source-persist-${index + 1}`)},${q(candidate.frameModelId)},${index === 0 ? "null" : q(candidate.frameVariantId)},'other',${q(`writer-source-${index}`)},${q(sourceSha256)},100,'image/png',10,10,${q(digest(`source-provenance-${index}`))},'{}','2026-08-11T01:00:00Z','operator');`).join("\n")}
    insert into private.measurement_sets(tenant_id,id,frame_model_id,version,method,evidence_sha256,status,verified_by_subject_id,verified_at,specimen_id) values (${q(candidate.tenantId)},'measurement-set-persist-1',${q(candidate.frameModelId)},1,'caliper',${q(candidate.requirements.physical.measurementSetSha256)},'verified','operator','2026-08-11T02:00:00Z',${q(attestation.specimenId)});
    insert into private.generation_jobs(tenant_id,id,frame_model_id,idempotency_key,canonical_input_sha256,method,generator_id,generator_version,generator_config_sha256,source_asset_sha256s,measurement_set_sha256,generator_input_sha256,max_attempts,created_at) values (${q(candidate.tenantId)},${q(candidate.generation.jobId)},${q(candidate.frameModelId)},${q(ledger[0].idempotencyKey)},${q(candidate.generation.canonicalInputSha256)},${q(jobRequest.method)},${q(jobRequest.generator.id)},${q(jobRequest.generator.version)},${q(jobRequest.generator.configSha256)},(select array_agg(value::private.sha256 order by value) from jsonb_array_elements_text(${j(jobRequest.sourceAssetSha256s)})),${q(jobRequest.measurementSetSha256)},${q(jobRequest.generatorInputSha256)},${jobRequest.maxAttempts},${q(jobRequest.createdAt)});
    ${eventSql}
    insert into private.qa_reviewer_authorities(tenant_id,id,row_sha256,authority_id,key_id,reviewer_id,scope,algorithm,public_key_fingerprint_sha256,public_jwk,status,created_at,created_at_canonical,revoked_at) values (${q(plan.reviewerAuthority.tenantId)},${q(plan.reviewerAuthority.id)},${q(plan.reviewerAuthority.rowSha256)},${q(plan.reviewerAuthority.authorityId)},${q(plan.reviewerAuthority.keyId)},${q(plan.reviewerAuthority.reviewerId)},${q(plan.reviewerAuthority.scope)},${q(plan.reviewerAuthority.algorithm)},${q(plan.reviewerAuthority.publicKeyFingerprintSha256)},${j(plan.reviewerAuthority.publicJwk)},'active',${q(plan.reviewerAuthority.createdAt)},${q(plan.reviewerAuthority.createdAt)},null);
  `);
  const wrapped = wrapDatabase ? wrapDatabase(db) : db;
  // Every test wrapper forwards the real physical close. A no-op close would
  // make discard falsely appear to release session state.
  const closeable = wrapped === db ? db : { ...wrapped, close: db.close.bind(db) };
  const sessions = sessionProviderFactory ? sessionProviderFactory(closeable, dataDir) : createSinglePglitePinnedSessionProvider(closeable);
  const database = createPgliteNonProxyQaWriterDatabase(sessions, adapterOptions); const writer = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: candidate.tenantId }), humanQaContextAt: (observedAt) => { const context = structuredClone(human.context); context.caliperProvenanceContext.evaluatedAt = observedAt; return context; }, database, maximumTransactionAttempts });
  return { db, database, writer, human, candidate, plan };
}

async function count(db, table) { return (await db.query(`select count(*)::int as count from private.${table}`)).rows[0].count; }
function wrappedDriver(db, transform) { return { query: db.query.bind(db), transaction: (work) => db.transaction((transaction) => work({ query: async (sql, parameters) => transform(sql, await transaction.query(sql, parameters)) })), close: db.close.bind(db) }; }

const DRIVER_INTEGER_COLUMNS = new Set(["candidate_version", "manifest_byte_length", "model_byte_length", "signed_schema_version", "maximum_review_age_ms", "version", "max_attempts", "sequence", "output_manifest_byte_length", "output_model_byte_length"]);
function stringifyDriverIntegers(_sql, result) {
  return { ...result, rows: result.rows.map((raw) => { const row = { ...raw }; for (const key of DRIVER_INTEGER_COLUMNS) if (typeof row[key] === "number" || typeof row[key] === "bigint") row[key] = String(row[key]); return row; }) };
}
function assetDriverRow(version) {
  return {
    id: "asset-a", persistence_row_sha256: "a".repeat(64), tenant_id: "tenant-a", frame_model_id: "model-a", frame_variant_id: "variant-a", version, generation_job_id: "job-a",
    quality: "standard", generation_method: "manual", model_url: "https://assets.example/model.glb", manifest_url: "https://assets.example/manifest.json", manifest_sha256: "b".repeat(64), manifest_byte_length: "1024", model_sha256: "c".repeat(64), model_byte_length: "2048", source_set_sha256: "d".repeat(64),
    attachment_matrix: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), quality_envelope: Object.freeze({ maxYawDeg: 15, maxPitchDeg: 10, recommendedForLive: false, scaleConfidence: "high" }), status: "approved", fixture_status: "unverified", review_status: "approved", admission: "internal-review-only", promotable: false, rights_scope: "internal-review-only", recommended_for_live: false, publication_eligible: false, non_proxy_internal_review: true,
  };
}

function reopeningProvider(initial, dataDir, options = {}) {
  let current = initial; let tail = Promise.resolve(); let rejectAfterCallback = options.rejectAfterCallback ?? false; let checkout = 0;
  return Object.freeze({
    async withPinnedSession(callback) {
      let release; const gate = new Promise((resolve) => { release = resolve; }); const prior = tail; tail = prior.then(() => gate); await prior;
      try {
        if (!current || current.closed) { current = new PGlite(dataDir); await current.waitReady; }
        const physical = current; const checkoutNumber = ++checkout; options.onCheckout?.(physical, checkoutNumber); const session = options.wrapSession ? options.wrapSession(physical, checkoutNumber) : physical; let discardPromise = null;
        const value = await callback(Object.freeze({ session, async discard() { if (!discardPromise) { if (current === physical) current = null; options.onDiscard?.(physical, checkoutNumber); discardPromise = physical.close(); } await discardPromise; } }));
        if (rejectAfterCallback) { rejectAfterCallback = false; current = null; throw new Error("provider check-in acknowledgement lost"); }
        return value;
      } finally { release(); }
    },
    async close() { const physical = current; current = null; await physical?.close(); },
  });
}

test("single-session provider requires and awaits a real physical close", async () => {
  assert.throws(() => createSinglePglitePinnedSessionProvider({ query: async () => ({ rows: [] }), transaction: async (work) => work({ query: async () => ({ rows: [] }) }) }), TypeError);
  let closeResolved = false; let releaseClose;
  const closeGate = new Promise((resolve) => { releaseClose = resolve; });
  const provider = createSinglePglitePinnedSessionProvider({
    query: async () => ({ rows: [] }),
    transaction: async (work) => work({ query: async () => ({ rows: [] }) }),
    close: async () => { await closeGate; closeResolved = true; },
  });
  let discardPromise;
  const using = provider.withPinnedSession(async (lease) => { discardPromise = lease.discard(); await Promise.resolve(); assert.equal(closeResolved, false); releaseClose(); await discardPromise; });
  await using; assert.equal(closeResolved, true);
  await assert.rejects(provider.withPinnedSession(async () => {}), (error) => error.kind === "database");
});

test("writer reconstruction accepts canonical positive int8 strings and rejects alternate decimal spellings", () => {
  for (const [value, expected] of [["1", 1], ["4294967296", 4_294_967_296], ["9007199254740991", Number.MAX_SAFE_INTEGER], [1n, 1], [1, 1]]) {
    assert.equal(reconstructNonProxyQaAssetRow(assetDriverRow(value)).version, expected);
  }
  for (const value of ["", "0", "00", "01", "+1", "-1", " 1", "1 ", "1e3", "1.0", "1.5", "9007199254740992", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 0n, -1n, 9_007_199_254_740_992n]) {
    assert.throws(() => reconstructNonProxyQaAssetRow(assetDriverRow(value)), (error) => error?.kind === "database", String(value));
  }
});

test("writer accepts node-postgres-style canonical strings for every reconstructed integer column", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z");
  const comparisons = [];
  const input = await fixture("approve", { wrapDatabase: (db) => wrappedDriver(db, stringifyDriverIntegers), observeReadbackComparison: (comparison) => { comparisons.push(comparison); } });
  try {
    const receipt = await input.writer.write("opaque", input.human.request); assert.equal(receipt.disposition, "inserted");
    assert.ok(comparisons.length >= 1);
    assert.ok(comparisons.every((comparison) => Object.isFrozen(comparison) && Object.values(comparison).every((matched) => matched === true)));
  }
  finally { Date.now = oldNow; await input.db.close(); }
});

test("pinned session locks job, authority, and candidate canonically before BEGIN and unlocks in reverse", async () => {
  const calls = [];
  const session = {
    async query(sql, parameters = []) { calls.push({ sql, parameters }); if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] }; return { rows: [] }; },
    async transaction(work) { calls.push({ sql: "BEGIN", parameters: [] }); return work({ query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [] }; } }); },
  };
  const database = createPgliteNonProxyQaWriterDatabase({ withPinnedSession: (work) => work({ session, discard: async () => {} }) });
  const selection = { tenantId: "tenant-a", frameModelId: "model-a", frameVariantId: "variant-a", candidateAssetVersionId: "asset-a", candidateVersion: 1, generationJobId: "job-a", canonicalInputSha256: "a".repeat(64), reviewHeadEventSha256: "b".repeat(64), sourceAssetSha256s: ["c".repeat(64)], measurementSetSha256: "d".repeat(64), specimenId: "specimen-a", reviewerAuthorityId: "authority-a", reviewerKeyId: "key-a" };
  await database.serializable(selection, async () => "ok", async () => {});
  const begin = calls.findIndex((call) => call.sql === "BEGIN"); const locks = calls.map((call, index) => ({ ...call, index })).filter((call) => call.sql.includes("pg_advisory_lock(")); const unlocks = calls.filter((call) => call.sql.includes("pg_advisory_unlock("));
  assert.equal(locks.length, 3); assert.ok(locks.every((call) => call.index < begin)); assert.deepEqual(locks.map((call) => call.parameters[0]), [...locks.map((call) => call.parameters[0])].sort()); assert.deepEqual(unlocks.map((call) => call.parameters[0]), locks.map((call) => call.parameters[0]).reverse());
});

test("undefined lock, session-callback, transaction, and work rejections never become success", async () => {
  const selection = { tenantId: "tenant-a", frameModelId: "model-a", frameVariantId: "variant-a", candidateAssetVersionId: "asset-a", candidateVersion: 1, generationJobId: "job-a", canonicalInputSha256: "a".repeat(64), reviewHeadEventSha256: "b".repeat(64), sourceAssetSha256s: ["c".repeat(64)], measurementSetSha256: "d".repeat(64), specimenId: "specimen-a", reviewerAuthorityId: "authority-a", reviewerKeyId: "key-a" };
  for (const kind of ["lock", "session-callback", "transaction", "work"]) {
    let closes = 0; let transactions = 0; let lockQueries = 0;
    const session = {
      async query(sql) { if (sql.includes("pg_advisory_lock(")) { lockQueries += 1; if (kind === "lock") return Promise.reject(); } if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] }; return { rows: [] }; },
      async transaction(callback) { transactions += 1; if (kind === "transaction") return Promise.reject(); return callback({ query: async () => ({ rows: [] }) }); },
      async close() { closes += 1; },
    };
    const database = createPgliteNonProxyQaWriterDatabase(createSinglePglitePinnedSessionProvider(session), { fault: (point) => kind === "session-callback" && point === "before-transaction" ? Promise.reject() : undefined });
    const outcome = await database.serializable(selection, async () => kind === "work" ? Promise.reject() : "ok", async () => {}).then((value) => ({ resolved: true, value }), (error) => ({ resolved: false, error }));
    assert.equal(outcome.resolved, false, kind); assert.equal(outcome.error?.kind, "database", kind);
    assert.equal(closes, kind === "lock" || kind === "transaction" ? 1 : 0, kind);
    assert.equal(transactions, kind === "lock" || kind === "session-callback" ? 0 : 1, kind);
    if (closes === 1) { const reuse = await database.serializable(selection, async () => "bad", async () => {}).then(() => true, () => false); assert.equal(reuse, false, `${kind} discarded lease cannot be reused`); }
    assert.ok(lockQueries <= 3, kind);
  }
  {
    let discarded = false; let checkouts = 0;
    const session = { query: async (sql) => sql.includes("pg_advisory_lock(") ? Promise.reject() : sql.includes("pg_advisory_unlock") ? { rows: [{ unlocked: true }] } : { rows: [] }, transaction: async (callback) => callback({ query: async () => ({ rows: [] }) }) };
    const provider = { async withPinnedSession(callback) { if (discarded) return Promise.reject(); checkouts += 1; return callback({ session, async discard() { discarded = true; return Promise.reject(); } }); } };
    const database = createPgliteNonProxyQaWriterDatabase(provider);
    const first = await database.serializable(selection, async () => "bad", async () => {}).then(() => null, (error) => error); assert.equal(first?.kind, "database"); assert.equal(discarded, true);
    assert.equal(await database.serializable(selection, async () => "bad", async () => {}).then(() => true, () => false), false); assert.equal(checkouts, 1);
  }
  {
    let discarded = false; let checkouts = 0;
    const session = { query: async (sql) => sql.includes("pg_advisory_unlock") ? { rows: [{ unlocked: true }] } : { rows: [] }, transaction: async (callback) => callback({ query: async () => ({ rows: [] }) }) };
    const provider = { async withPinnedSession(callback) { if (discarded) return Promise.reject(); checkouts += 1; const value = await callback({ session, async discard() { discarded = true; } }); void value; return Promise.reject(); } };
    const database = createPgliteNonProxyQaWriterDatabase(provider);
    const first = await database.serializable(selection, async () => "committed", async () => {}).then(() => null, (error) => error); assert.equal(first?.kind, "commit-outcome-unknown"); assert.equal(discarded, true);
    assert.equal(await database.serializable(selection, async () => "bad", async () => {}).then(() => true, () => false), false); assert.equal(checkouts, 1);
  }
});

test("real PGlite approve commits in exact order and exact retry is a frozen non-authoritative no-op", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture();
  try { const first = await input.writer.write("opaque-session", input.human.request); assert.equal(first.disposition, "inserted"); assert.equal(first.decision, "approve"); assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.authority), true); assert.deepEqual(first.authority, { qaPreview: false, runtime: false, publicLive: false, recommended: false, catalog: false, deployment: false, publication: false, G1: false, G2: false, G3: false, G4: false, G5: false, G6: false, G7: false }); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 1); assert.equal(await count(input.db, "asset_versions"), 1); assert.equal((await input.db.query("select status,recommended_for_live,publication_eligible from private.asset_versions")).rows[0].status, "approved");
    const retry = await input.writer.write("opaque-session", input.human.request); assert.equal(retry.disposition, "exact-retry"); assert.equal(retry.ids.reviewRecordId, first.ids.reviewRecordId); assert.equal(retry.committedAt, first.committedAt); assert.deepEqual(retry.authority, first.authority); const retryAgain = await input.writer.write("opaque-session", input.human.request); assert.deepEqual(retryAgain, retry); for (const forbidden of ["rawSignedPayload","publicJwk","sql","trust"]) assert.equal(forbidden in retry, false);
  } finally { Date.now = oldNow; await input.db.close(); }
});

test("real PGlite reject persists only the terminal decision against pre-registered authority", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture("reject");
  try { const receipt = await input.writer.write("opaque-session", input.human.request); assert.equal(receipt.decision, "reject"); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 1); assert.equal(await count(input.db, "asset_versions"), 0); assert.equal(await count(input.db, "non_proxy_asset_version_bindings"), 0); } finally { Date.now = oldNow; await input.db.close(); }
});

test("faults after each write/readback roll the real transaction back atomically", async () => {
  for (const point of ["after-review","after-asset","after-source","after-binding","after-approve","before-readback","after-readback","before-final-recheck","before-commit"]) {
    const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture("approve", { fault: (seen) => { if (seen === point) throw Object.assign(new Error("secret SQL table signature JWK"), { code: "XX999" }); } });
    try { await assert.rejects(input.writer.write("opaque-session", input.human.request), (error) => { assert.deepEqual(Object.keys(error), ["code"]); assert.equal(error.code, "DATABASE_UNAVAILABLE"); return true; }); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 0, point); assert.equal(await count(input.db, "asset_versions"), 0, point); assert.equal(await count(input.db, "non_proxy_asset_version_bindings"), 0, point); } finally { Date.now = oldNow; await input.db.close(); }
  }
});

test("lost commit acknowledgement recovers only an independently exact committed outcome", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const dataDir = await mkdtemp(join(tmpdir(), "jessica-qa-commit-")); let lose = true; let sessions;
  const input = await fixture("approve", { dataDir, sessionProviderFactory: (initial, directory) => (sessions = reopeningProvider(initial, directory)), simulateLostCommitAcknowledgement: () => { const value = lose; lose = false; return value; } });
  try { const recovered = await input.writer.write("opaque-session", input.human.request); assert.equal(recovered.disposition, "recovered-exact-commit"); const retry = await input.writer.write("opaque-session", input.human.request); assert.equal(retry.disposition, "exact-retry"); } finally { Date.now = oldNow; await sessions.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("post-commit session cleanup failures, including undefined rejections, discard the lease and enter exact commit recovery", async () => {
  const cases = ["before-session-unlock", "unlock-false", "unlock-throw", "reset-throw", "before-session-unlock-undefined", "unlock-undefined", "reset-undefined"];
  for (const kind of cases) {
    const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let armed = true; let recoverySeen = false;
    const input = await fixture("approve", {
      fault: (point) => { if (point === "before-recovery") recoverySeen = true; if ((kind === "before-session-unlock" || kind === "before-session-unlock-undefined") && point === "before-session-unlock" && armed) { armed = false; if (kind.endsWith("undefined")) return Promise.reject(); throw new Error("secret cleanup fault"); } },
      wrapDatabase: (db) => ({
        query: async (sql, parameters) => {
          if ((kind === "unlock-throw" || kind === "unlock-undefined") && armed && sql.includes("pg_advisory_unlock")) { armed = false; if (kind.endsWith("undefined")) return Promise.reject(); throw new Error("secret unlock failure"); }
          if ((kind === "reset-throw" || kind === "reset-undefined") && armed && sql === "reset lock_timeout") { armed = false; if (kind.endsWith("undefined")) return Promise.reject(); throw new Error("secret reset failure"); }
          const result = await db.query(sql, parameters);
          if (kind === "unlock-false" && armed && sql.includes("pg_advisory_unlock")) { armed = false; return { ...result, rows: [{ unlocked: false }] }; }
          return result;
        },
        transaction: db.transaction.bind(db),
      }),
    });
    try { await assert.rejects(input.writer.write("opaque", input.human.request), (error) => { assert.equal(error.code, "COMMIT_OUTCOME_UNPROVEN", kind); return true; }); assert.equal(recoverySeen, true, kind); } finally { Date.now = oldNow; await input.db.close().catch(() => {}); }
  }
});

test("a driver rejection after its transaction callback completed is treated as ambiguous and recovered under the writer role", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const dataDir = await mkdtemp(join(tmpdir(), "jessica-qa-driver-")); let rejectCommit = true; let sessions;
  const input = await fixture("approve", { dataDir, sessionProviderFactory: (initial, directory) => (sessions = reopeningProvider(initial, directory, { wrapSession: (db) => ({ query: db.query.bind(db), transaction: async (work) => { const value = await db.transaction(work); if (rejectCommit) { rejectCommit = false; throw Object.assign(new Error("lost commit ack sqlstate secret"), { code: "08006" }); } return value; } }) })) });
  try { const receipt = await input.writer.write("opaque", input.human.request); assert.equal(receipt.disposition, "recovered-exact-commit"); } finally { Date.now = oldNow; await sessions.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("after-commit TypeError, wrapped port error, undefined rejection, and provider check-in rejection recover only through a fresh lease", async () => {
  for (const kind of ["type-error", "port-error", "undefined", "provider-reject"]) {
    const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const dataDir = await mkdtemp(join(tmpdir(), `jessica-qa-${kind}-`)); let armed = true; let sessions;
    const input = await fixture("approve", {
      dataDir,
      sessionProviderFactory: (initial, directory) => (sessions = reopeningProvider(initial, directory, { rejectAfterCallback: kind === "provider-reject" })),
      fault: (point) => { if (point === "after-commit" && armed && kind !== "provider-reject") { armed = false; if (kind === "type-error") throw new TypeError("post-commit host fault"); if (kind === "undefined") return Promise.reject(); throw new NonProxyQaDatabasePortError("database"); } },
    });
    try { const receipt = await input.writer.write("opaque", input.human.request); assert.equal(receipt.disposition, "recovered-exact-commit", kind); assert.notEqual(input.db.closed, false, `${kind} discarded the original physical session`); } finally { Date.now = oldNow; await sessions.close(); await rm(dataDir, { recursive: true, force: true }); }
  }
});

test("exact recovery transaction boundary faults discard and recover only on a fresh physical checkout", async (t) => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const dataDir = await mkdtemp(join(tmpdir(), "jessica-qa-recovery-boundary-"));
  const input = await fixture("approve", { dataDir });
  try {
    const inserted = await input.writer.write("opaque", input.human.request); await input.db.close();
    const cases = [
      {
        name: "successful readback followed by COMMIT ACK TypeError/08006",
        expectedKind: "commit-outcome-unknown",
        options: (armed) => ({ wrapSession: (db) => ({ query: db.query.bind(db), transaction: async (work) => { const value = await db.transaction(work); if (armed.take()) throw Object.assign(new TypeError("recovery commit ACK lost"), { code: "08006" }); return value; } }) }),
      },
      {
        name: "BEGIN outcome unknown",
        expectedKind: "database",
        options: (armed) => ({ wrapSession: (db) => ({ query: db.query.bind(db), transaction: async (work) => { if (armed.take()) throw Object.assign(new Error("recovery BEGIN ACK lost"), { code: "08006" }); return db.transaction(work); } }) }),
      },
      {
        name: "callback error replaced by distinct ROLLBACK/provider error",
        expectedKind: "database",
        options: (armed) => ({ wrapSession: (db) => ({ query: db.query.bind(db), transaction: async (work) => {
          if (!armed.take()) return db.transaction(work);
          const callbackFailure = new Error("readback callback failure");
          try { return await db.transaction((transaction) => work({ query: async (sql, parameters) => { if (sql.includes("from private.qa_reviewer_authorities")) throw callbackFailure; return transaction.query(sql, parameters); } })); }
          catch (error) { assert.equal(error, callbackFailure); throw Object.assign(new Error("recovery ROLLBACK ACK lost"), { code: "08006" }); }
        } }) }),
      },
      {
        name: "provider post-callback/check-in failure",
        expectedKind: "commit-outcome-unknown",
        options: () => ({ rejectAfterCallback: true }),
      },
    ];
    for (const item of cases) await t.test(item.name, async () => {
      const initial = new PGlite(dataDir); await initial.waitReady; let armedValue = true; const physicals = []; const discarded = [];
      const options = item.options({ take: () => { const value = armedValue; armedValue = false; return value; } });
      const provider = reopeningProvider(initial, dataDir, { ...options, onCheckout: (physical) => physicals.push(physical), onDiscard: (physical) => discarded.push(physical) });
      const recovery = createPgliteNonProxyQaWriterDatabase(provider);
      try {
        await assert.rejects(recovery.verifyCommittedExact(input.plan), (error) => { assert.equal(error.kind, item.expectedKind); return true; });
        assert.equal(discarded.length, 1); assert.equal(discarded[0], physicals[0]);
        assert.equal(await recovery.verifyCommittedExact(input.plan), inserted.committedAt);
        assert.equal(physicals.length, 2); assert.notEqual(physicals[0], physicals[1]);
      } finally { await provider.close(); }
    });
  } finally { Date.now = oldNow; await input.db.close().catch(() => {}); await rm(dataDir, { recursive: true, force: true }); }
});

test("unauthenticated and hostile calls open no transaction; mutation while auth is deferred cannot win", async () => {
  const human = await setupHumanQa(); let begins = 0; let resolveAuth; const auth = new Promise((resolve) => { resolveAuth = resolve; }); const database = { serializable: async () => { begins += 1; throw new Error("must not begin"); }, verifyCommittedExact: async () => null };
  const denied = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => null, humanQaContextAt: () => human.context, database }); await assert.rejects(denied.write("bad", human.request), (error) => error.code === "UNAUTHENTICATED"); assert.equal(begins, 0);
  const deferred = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => auth, humanQaContextAt: () => human.context, database }); const pending = deferred.write("opaque", human.request); human.request.decisionAttestation.decision = "reject"; resolveAuth({ tenantId: human.candidate.tenantId }); await assert.rejects(pending, (error) => error.code === "DATABASE_UNAVAILABLE"); assert.equal(begins, 1);
  let getter = false; const hostile = Object.defineProperty({}, "decisionAttestation", { enumerable: true, get() { getter = true; return {}; } }); await assert.rejects(denied.write("bad", hostile), (error) => error.code === "DENIED"); assert.equal(getter, false); assert.equal(begins, 1);
});

test("bounded serialization retry reruns with a fresh transaction and never accepts a serialized plan entry", async () => {
  const human = await setupHumanQa(); let attempts = 0; const database = { serializable: async () => { attempts += 1; throw new NonProxyQaDatabasePortError("retryable"); }, verifyCommittedExact: async () => null }; const writer = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: human.candidate.tenantId }), humanQaContextAt: () => human.context, database, maximumTransactionAttempts: 3 }); await assert.rejects(writer.write("opaque", human.request), (error) => error.code === "DATABASE_UNAVAILABLE"); assert.equal(attempts, 3); await assert.rejects(writer.write("opaque", { planSha256: "a".repeat(64) }), (error) => error.code === "DENIED"); assert.equal(attempts, 3);
});

test("trusted DB ledger, authority, MeasurementSet, source, and partial-state tampering all fail closed", async () => {
  const cases = [
    ["earlier-ledger", async ({ db, candidate }) => { await db.exec("alter table private.generation_job_events disable trigger all"); await db.query("update private.generation_job_events set evidence=jsonb_set(evidence,'{request,maxAttempts}','9'::jsonb) where tenant_id=$1 and generation_job_id=$2 and sequence=1", [candidate.tenantId, candidate.generation.jobId]); await db.exec("alter table private.generation_job_events enable trigger all"); }],
    ["forged-output", async ({ db, candidate }) => { await db.exec("alter table private.generation_job_events disable trigger all"); await db.query("update private.generation_job_events set output_manifest_sha256=$3,evidence=jsonb_set(evidence,'{output,manifestSha256}',to_jsonb($4::text)) where tenant_id=$1 and generation_job_id=$2 and event_type='output-recorded'", [candidate.tenantId, candidate.generation.jobId, "f".repeat(64), "f".repeat(64)]); await db.exec("alter table private.generation_job_events enable trigger all"); }],
    ["revoked-authority", async ({ db, plan }) => { await db.query("update private.qa_reviewer_authorities set status='revoked',revoked_at='2026-08-11T02:59:00Z' where tenant_id=$1 and id=$2", [plan.reviewerAuthority.tenantId, plan.reviewerAuthority.id]); }],
    ["invalid-measurement", async ({ db, candidate }) => { await db.exec("alter table private.measurement_sets disable trigger all"); await db.query("update private.measurement_sets set status='draft',verified_by_subject_id=null,verified_at=null where tenant_id=$1 and evidence_sha256=$2", [candidate.tenantId, candidate.requirements.physical.measurementSetSha256]); await db.exec("alter table private.measurement_sets enable trigger all"); }],
    ["missing-source", async ({ db, candidate }) => { await db.exec("alter table private.source_assets disable trigger all"); await db.query("delete from private.source_assets where tenant_id=$1 and sha256=$2", [candidate.tenantId, candidate.sourceAssetHashes[0]]); await db.exec("alter table private.source_assets enable trigger all"); }],
    ["partial-asset", async ({ db, candidate }) => { await db.query("insert into private.asset_versions(tenant_id,id,frame_model_id,version,quality,generation_method,model_url,manifest_url,manifest_sha256,manifest_byte_length,model_sha256,model_byte_length,source_set_sha256,attachment_matrix,quality_envelope,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,'draft')", [candidate.tenantId,candidate.id,candidate.frameModelId,candidate.version,candidate.quality,candidate.generationMethod,candidate.modelUrl,candidate.manifestUrl,candidate.manifestSha256,candidate.manifestByteLength,candidate.modelSha256,candidate.modelByteLength,digest(canonicalJson([...candidate.sourceAssetHashes].sort())),JSON.stringify(candidate.attachmentMatrix),JSON.stringify(candidate.qualityEnvelope)]); }],
  ];
  for (const [label, mutate] of cases) {
    const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture();
    try { await mutate(input); await assert.rejects(input.writer.write("opaque-session", input.human.request), (error) => { assert.ok(["DENIED", "DATABASE_UNAVAILABLE"].includes(error.code), label); assert.deepEqual(Object.keys(error), ["code"]); return true; }); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 0, label); } finally { Date.now = oldNow; await input.db.close(); }
  }
});

test("lost commit ACK with an undefined recovery rejection is closed, then exact retry recovers deterministically", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const dataDir = await mkdtemp(join(tmpdir(), "jessica-qa-unproven-")); let lose = true; let sessions;
  const input = await fixture("approve", { dataDir, sessionProviderFactory: (initial, directory) => (sessions = reopeningProvider(initial, directory)), simulateLostCommitAcknowledgement: () => { const answer = lose; lose = false; return answer; }, fault: (point) => point === "before-recovery" ? Promise.reject() : undefined });
  try { await assert.rejects(input.writer.write("opaque-session", input.human.request), (error) => { assert.deepEqual(Object.keys(error), ["code"]); assert.equal(error.code, "COMMIT_OUTCOME_UNPROVEN"); assert.equal("cause" in error, false); assert.equal("stack" in error, false); return true; });
    await sessions.close(); const fresh = new PGlite(dataDir); await fresh.waitReady; const cleanDatabase = createPgliteNonProxyQaWriterDatabase(createSinglePglitePinnedSessionProvider(fresh)); const cleanWriter = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: input.candidate.tenantId }), humanQaContextAt: (observedAt) => { const context = structuredClone(input.human.context); context.caliperProvenanceContext.evaluatedAt = observedAt; return context; }, database: cleanDatabase }); const retry = await cleanWriter.write("opaque-session", input.human.request); assert.equal(retry.disposition, "exact-retry"); await fresh.close();
  } finally { Date.now = oldNow; await sessions.close().catch(() => {}); await rm(dataDir, { recursive: true, force: true }); }
});

test("concurrent same request is inserted once and exact-retried; different terminal decisions cannot both win", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const same = await fixture();
  try { const receipts = await Promise.all([same.writer.write("actor-a", same.human.request), same.writer.write("actor-b", same.human.request)]); assert.deepEqual(receipts.map((item) => item.disposition).sort(), ["exact-retry", "inserted"]); assert.equal(await count(same.db, "non_proxy_human_qa_records"), 1); } finally { await same.db.close(); }
  const human = await setupHumanQa("approve"); const approve = structuredClone(human.request); await human.resign((value) => { value.decision = "reject"; value.issueCategories = ["visual-fidelity"]; value.notes = "Terminal concurrent rejection."; value.approvedQualityEnvelope = null; }); const different = await fixture("reject", { human });
  try { const outcomes = await Promise.allSettled([different.writer.write("actor-approve", approve), different.writer.write("actor-reject", human.request)]); assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1); assert.equal(outcomes.filter((item) => item.status === "rejected" && item.reason?.code === "DENIED").length, 1); assert.equal(await count(different.db, "non_proxy_human_qa_records"), 1); } finally { Date.now = oldNow; await different.db.close(); }
});

test("terminal candidate lookup is generation-job independent and a cross-job row is a collision", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture("reject");
  try {
    await input.writer.write("opaque", input.human.request);
    await input.db.exec("alter table private.non_proxy_human_qa_records disable trigger all");
    await input.db.query("update private.non_proxy_human_qa_records set generation_job_id='other-job' where tenant_id=$1 and candidate_asset_version_id=$2 and candidate_version=$3", [input.candidate.tenantId, input.candidate.id, input.candidate.version]);
    await input.db.exec("alter table private.non_proxy_human_qa_records enable trigger all");
    await assert.rejects(input.writer.write("opaque", input.human.request), (error) => error.code === "DENIED");
    assert.equal(await count(input.db, "non_proxy_human_qa_records"), 1);
  } finally { Date.now = oldNow; await input.db.close(); }
});

test("actor identity is a synchronously captured bounded primitive and hostile actor objects never authenticate", async () => {
  const human = await setupHumanQa(); let authenticated = 0; let began = 0; const writer = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => { authenticated += 1; return { tenantId: human.candidate.tenantId }; }, humanQaContextAt: () => human.context, database: { serializable: async () => { began += 1; throw new Error("unreachable"); }, verifyCommittedExact: async () => null } }); let invoked = false; const actor = Object.defineProperty({}, "toString", { enumerable: true, get() { invoked = true; return () => "opaque"; } }); const promise = writer.write(actor, human.request); await assert.rejects(promise, (error) => error.code === "UNAUTHENTICATED"); assert.equal(invoked, false); assert.equal(authenticated, 0); assert.equal(began, 0); await assert.rejects(writer.write("x".repeat(4097), human.request), (error) => error.code === "UNAUTHENTICATED"); assert.equal(authenticated, 0);
});

test("hostile nested driver JSON and full-field readback tampering roll back without invoking accessors", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let invoked = false;
  const hostile = await fixture("approve", { wrapDatabase: (db) => wrappedDriver(db, (sql, result) => { if (sql.includes("from private.qa_reviewer_authorities") && sql.includes("authority_id=$2")) { const row = { ...result.rows[0] }; row.public_jwk = Object.defineProperty({}, "kty", { enumerable: true, get() { invoked = true; return "EC"; } }); return { ...result, rows: [row] }; } return result; }) });
  try { await assert.rejects(hostile.writer.write("opaque", hostile.human.request), (error) => ["DENIED", "DATABASE_UNAVAILABLE"].includes(error.code)); assert.equal(invoked, false); assert.equal(await count(hostile.db, "non_proxy_human_qa_records"), 0); } finally { await hostile.db.close(); }
  const wide = await fixture("approve", { wrapDatabase: (db) => wrappedDriver(db, (sql, result) => { if (sql.includes("from private.qa_reviewer_authorities") && sql.includes("authority_id=$2")) { const row = { ...result.rows[0] }; row.public_jwk = Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`field${index}`, "x"])); return { ...result, rows: [row] }; } return result; }) });
  try { await assert.rejects(wide.writer.write("opaque", wide.human.request), (error) => ["DENIED", "DATABASE_UNAVAILABLE"].includes(error.code)); assert.equal(await count(wide.db, "non_proxy_human_qa_records"), 0); } finally { await wide.db.close(); }
  const tampered = await fixture("approve", { wrapDatabase: (db) => wrappedDriver(db, (sql, result) => { if (sql.includes("from private.non_proxy_human_qa_records") && sql.includes("to_jsonb(source_asset_sha256s)") && result.rows.length === 1) return { ...result, rows: [{ ...result.rows[0], notes: "driver-injected secret signature jwk" }] }; return result; }) });
  try { await assert.rejects(tampered.writer.write("opaque", tampered.human.request), (error) => { assert.ok(["DENIED", "DATABASE_UNAVAILABLE"].includes(error.code)); assert.deepEqual(Object.keys(error), ["code"]); return true; }); assert.equal(await count(tampered.db, "non_proxy_human_qa_records"), 0); assert.equal(await count(tampered.db, "asset_versions"), 0); } finally { Date.now = oldNow; await tampered.db.close(); }
});

test("cancellation before BEGIN opens no transaction and cancellation during a write rolls back", async () => {
  const human = await setupHumanQa(); let began = 0; const pre = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: human.candidate.tenantId }), humanQaContextAt: () => human.context, database: { serializable: async () => { began += 1; throw new Error("unreachable"); }, verifyCommittedExact: async () => null } }); const already = new AbortController(); already.abort(); await assert.rejects(pre.write("opaque", human.request, already.signal), (error) => error.code === "CANCELLED"); assert.equal(began, 0);
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const during = new AbortController(); const input = await fixture("approve", { fault: (point) => { if (point === "after-review") during.abort(); } });
  try { await assert.rejects(input.writer.write("opaque", input.human.request, during.signal), (error) => error.code === "CANCELLED"); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 0); assert.equal(await count(input.db, "asset_versions"), 0); } finally { Date.now = oldNow; await input.db.close(); }
});

test("serialization retry takes a fresh DB time and cannot outlive authority expiry", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let first = true; const input = await fixture("approve", { fault: (point) => { if (point === "before-transaction" && first) { first = false; Date.now = () => Date.parse("2026-08-11T04:00:00Z"); throw Object.assign(new Error("serialization secret"), { code: "40001" }); } } });
  try { await assert.rejects(input.writer.write("opaque", input.human.request), (error) => { assert.equal(error.code, "DENIED"); return true; }); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 0); } finally { Date.now = oldNow; await input.db.close(); }
});

test("GenerationJob storage is fully joined to the replayed request and caller selection", async () => {
  const cases = [
    ["method", "method='external'"],
    ["generator-id", "generator_id='other-generator'"],
    ["generator-version", "generator_version='v99'"],
    ["generator-config", `generator_config_sha256='${"1".repeat(64)}'`],
    ["measurement", `measurement_set_sha256='${"2".repeat(64)}'`],
    ["source-set", `source_asset_sha256s=array['${"3".repeat(64)}']::private.sha256[]`],
    ["max-attempts", "max_attempts=64"],
    ["created-at", "created_at='2026-08-11T01:59:59Z'"],
  ];
  for (const [label, assignment] of cases) {
    const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture();
    try { await input.db.exec("alter table private.generation_jobs disable trigger all"); await input.db.query(`update private.generation_jobs set ${assignment} where tenant_id=$1 and id=$2`, [input.candidate.tenantId, input.candidate.generation.jobId]); await input.db.exec("alter table private.generation_jobs enable trigger all"); let rejected = false; try { await input.writer.write("opaque", input.human.request); } catch (error) { rejected = true; assert.ok(["DENIED", "DATABASE_UNAVAILABLE"].includes(error.code), label); } assert.equal(rejected, true, label); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 0, label); } finally { Date.now = oldNow; await input.db.close(); }
  }
});

test("statement SQLSTATE serialization failures retry and exhaust through closed port errors", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let failures = 2;
  const succeeds = await fixture("approve", { maximumTransactionAttempts: 3, wrapDatabase: (db) => wrappedDriver(db, (sql, result) => { if (sql.includes("from private.generation_jobs where") && failures-- > 0) throw Object.assign(new Error("secret serialization statement"), { code: "40001" }); return result; }) });
  try { const receipt = await succeeds.writer.write("opaque", succeeds.human.request); assert.equal(receipt.disposition, "inserted"); assert.equal(failures, -1); } finally { await succeeds.db.close(); }
  let deadlocks = 3; const exhausts = await fixture("approve", { maximumTransactionAttempts: 3, wrapDatabase: (db) => wrappedDriver(db, (sql, result) => { if (sql.includes("from private.generation_jobs where") && deadlocks-- > 0) throw Object.assign(new Error("secret deadlock statement"), { code: "40P01" }); return result; }) });
  try { await assert.rejects(exhausts.writer.write("opaque", exhausts.human.request), (error) => { assert.equal(error.code, "DATABASE_UNAVAILABLE"); assert.deepEqual(Object.keys(error), ["code"]); return true; }); assert.equal(deadlocks, 0); assert.equal(await count(exhausts.db, "non_proxy_human_qa_records"), 0); } finally { Date.now = oldNow; await exhausts.db.close(); }
});

test("lost advisory-lock ACK unlocks known keys, discards the lease, and retries only on a fresh physical session", async () => {
  const calls = []; let checkout = 0; let unknownServerAcquisition = false;
  const makeSession = (name, loseAck) => ({
    async query(sql, parameters = []) {
      calls.push([name, sql, parameters[0]]);
      if (sql.includes("pg_advisory_lock(") && loseAck && calls.filter((entry) => entry[0] === name && entry[1].includes("pg_advisory_lock(")).length === 2) { unknownServerAcquisition = true; throw Object.assign(new Error("lock acquired server-side before transport ACK loss"), { code: "08006" }); }
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
      return { rows: [] };
    },
    async transaction(work) { return work({ query: async () => ({ rows: [] }) }); },
  });
  const states = [{ name: "first", session: makeSession("first", true), discarded: false }, { name: "fresh", session: makeSession("fresh", false), discarded: false }];
  const provider = { async withPinnedSession(work) { const state = states[checkout++]; assert.ok(state); return work({ session: state.session, async discard() { state.discarded = true; } }); } };
  const database = createPgliteNonProxyQaWriterDatabase(provider); const selection = { tenantId: "tenant-a", frameModelId: "model-a", frameVariantId: "variant-a", candidateAssetVersionId: "asset-a", candidateVersion: 1, generationJobId: "job-a", canonicalInputSha256: "a".repeat(64), reviewHeadEventSha256: "b".repeat(64), sourceAssetSha256s: ["c".repeat(64)], measurementSetSha256: "d".repeat(64), specimenId: "specimen-a", reviewerAuthorityId: "authority-a", reviewerKeyId: "key-a" };
  await assert.rejects(database.serializable(selection, async () => "first", async () => {}), (error) => error.kind === "database");
  assert.equal(unknownServerAcquisition, true); assert.equal(states[0].discarded, true); assert.equal(calls.filter(([name, sql]) => name === "first" && sql.includes("pg_advisory_unlock")).length, 1);
  assert.equal(await database.serializable(selection, async () => "fresh", async () => {}), "fresh"); assert.equal(checkout, 2); assert.equal(states[1].discarded, false);
});

test("session advisory-lock timeout is retryable and every retry uses a fresh lease before BEGIN", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let lockFailures = 2; let begins = 0; const successDir = await mkdtemp(join(tmpdir(), "jessica-qa-lock-success-")); let successSessions;
  const succeeds = await fixture("approve", { dataDir: successDir, maximumTransactionAttempts: 3, sessionProviderFactory: (initial, directory) => (successSessions = reopeningProvider(initial, directory, { wrapSession: (db) => ({
    query: async (sql, parameters) => { if (sql.includes("pg_advisory_lock(") && lockFailures > 0) { lockFailures -= 1; throw Object.assign(new Error("secret lock timeout"), { code: "55P03" }); } return db.query(sql, parameters); },
    transaction: (work) => { begins += 1; return db.transaction(work); },
  }) })) });
  try { const result = await succeeds.writer.write("opaque", succeeds.human.request); assert.equal(result.disposition, "inserted"); assert.equal(lockFailures, 0); assert.equal(begins, 1); } finally { await successSessions.close(); await rm(successDir, { recursive: true, force: true }); }
  let exhausted = 3; const deniedDir = await mkdtemp(join(tmpdir(), "jessica-qa-lock-denied-")); let deniedSessions;
  const denied = await fixture("approve", { dataDir: deniedDir, maximumTransactionAttempts: 3, sessionProviderFactory: (initial, directory) => (deniedSessions = reopeningProvider(initial, directory, { wrapSession: (db) => ({ query: async (sql, parameters) => { if (sql.includes("pg_advisory_lock(") && exhausted > 0) { exhausted -= 1; throw Object.assign(new Error("secret lock timeout"), { code: "55P03" }); } return db.query(sql, parameters); }, transaction: db.transaction.bind(db) }) })) });
  try { await assert.rejects(denied.writer.write("opaque", denied.human.request), (error) => error.code === "DATABASE_UNAVAILABLE"); assert.equal(exhausted, 0); } finally { Date.now = oldNow; await deniedSessions.close(); await rm(deniedDir, { recursive: true, force: true }); }
});

test("host trust context is synchronously snapshotted and frozen before policy hashing awaits", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const input = await fixture(); let mutated = false;
  const context = structuredClone(input.human.context);
  const writer = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: input.candidate.tenantId }), humanQaContextAt: (observedAt) => { context.caliperProvenanceContext.evaluatedAt = observedAt; queueMicrotask(() => { context.reviewerTrust.maximumReviewAgeMs = 1; context.reviewerTrust.trustedKeys = {}; mutated = true; }); return context; }, database: input.database });
  try { const result = await writer.write("opaque", input.human.request); assert.equal(mutated, true); assert.equal(result.disposition, "inserted"); } finally { Date.now = oldNow; await input.db.close(); }
});

test("driver results are detached before later mutation and enforce ledger/string/array budgets", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let mutated = false;
  const detached = await fixture("approve", { wrapDatabase: (db) => wrappedDriver(db, (sql, result) => { if (sql.includes("to_jsonb(source_asset_sha256s)")) setTimeout(() => { result.rows[0].method = "external"; mutated = true; }, 0); return result; }), fault: async (point) => { if (point === "after-snapshot") await new Promise((resolve) => setTimeout(resolve, 10)); } });
  try { const receipt = await detached.writer.write("opaque", detached.human.request); assert.equal(receipt.disposition, "inserted"); assert.equal(mutated, true); } finally { await detached.db.close(); }
  const duringQuery = await fixture("approve", { wrapDatabase: (db) => ({ query: db.query.bind(db), transaction: (work) => db.transaction((transaction) => work({ query: async (sql, parameters) => { const result = await transaction.query(sql, parameters); if (sql.includes("to_jsonb(source_asset_sha256s)")) { await Promise.resolve(); result.rows[0].method = "external"; } return result; } })) }) });
  try { await assert.rejects(duringQuery.writer.write("opaque", duringQuery.human.request), (error) => error.code === "DATABASE_UNAVAILABLE"); assert.equal(await count(duringQuery.db, "non_proxy_human_qa_records"), 0); } finally { await duringQuery.db.close(); }
  const cases = [
    ["string", (sql, result) => sql.includes("to_jsonb(source_asset_sha256s)") ? { ...result, rows: [{ ...result.rows[0], method: "x".repeat(1_000_001) }] } : result],
    ["ledger-count", (sql, result) => sql.includes("from private.generation_job_events") && sql.includes("order by sequence") && !sql.includes("desc") ? { ...result, rows: Array.from({ length: 300 }, () => structuredClone(result.rows[0])) } : result],
    ["nested-array", (sql, result) => { if (!sql.includes("from private.generation_job_events") || !sql.includes("order by sequence") || sql.includes("desc")) return result; const rows = structuredClone(result.rows); rows[0].evidence.request.sourceAssetSha256s = Array.from({ length: 1_025 }, () => "a".repeat(64)); return { ...result, rows }; }],
  ];
  for (const [label, transform] of cases) { const input = await fixture("approve", { wrapDatabase: (db) => wrappedDriver(db, transform) }); try { await assert.rejects(input.writer.write("opaque", input.human.request), (error) => { assert.equal(error.code, "DATABASE_UNAVAILABLE", label); return true; }); assert.equal(await count(input.db, "non_proxy_human_qa_records"), 0, label); } finally { await input.db.close(); } }
  Date.now = oldNow;
});

test("the last awaited precommit boundary rechecks expiry and preserves cancellation", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); let crossed = false;
  const expired = await fixture("approve", { fault: (point) => { if (point === "before-commit" && !crossed) { crossed = true; Date.now = () => Date.parse("2026-08-11T04:00:00Z"); } } });
  try { await assert.rejects(expired.writer.write("opaque", expired.human.request), (error) => ["DENIED", "DATABASE_UNAVAILABLE"].includes(error.code)); assert.equal(await count(expired.db, "non_proxy_human_qa_records"), 0); assert.equal(await count(expired.db, "asset_versions"), 0); } finally { await expired.db.close(); }
  Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const controller = new AbortController(); const cancelled = await fixture("approve", { fault: (point) => { if (point === "before-commit") controller.abort(); } });
  try { await assert.rejects(cancelled.writer.write("opaque", cancelled.human.request, controller.signal), (error) => error.code === "CANCELLED"); assert.equal(await count(cancelled.db, "non_proxy_human_qa_records"), 0); } finally { Date.now = oldNow; await cancelled.db.close(); }
});

test("exact retry checks cancellation after final recheck and hostile AbortSignal accessors stay sanitized", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const initial = await fixture();
  try { await initial.writer.write("opaque", initial.human.request); const controller = new AbortController(); let armed = true; const database = createPgliteNonProxyQaWriterDatabase(createSinglePglitePinnedSessionProvider(initial.db), { fault: (point) => { if (point === "before-final-recheck" && armed) { armed = false; controller.abort(); } } }); const writer = createTrustedNonProxyQaPersistenceWriter({ authenticate: async () => ({ tenantId: initial.candidate.tenantId }), humanQaContextAt: (observedAt) => { const context = structuredClone(initial.human.context); context.caliperProvenanceContext.evaluatedAt = observedAt; return context; }, database }); await assert.rejects(writer.write("opaque", initial.human.request, controller.signal), (error) => error.code === "CANCELLED"); assert.equal(await count(initial.db, "non_proxy_human_qa_records"), 1);
    let invoked = false; const hostile = Object.defineProperty({}, "aborted", { get() { invoked = true; throw new Error("secret signal"); } }); await assert.rejects(writer.write("opaque", initial.human.request, hostile), (error) => { assert.equal(error.code, "CANCELLED"); assert.deepEqual(Object.keys(error), ["code"]); return true; }); assert.equal(invoked, false);
  } finally { Date.now = oldNow; await initial.db.close(); }
});

test("transaction-local role, search path, and timeout guards precede every domain query", async () => {
  const oldNow = Date.now; Date.now = () => Date.parse("2026-08-11T03:00:00Z"); const statements = [];
  const input = await fixture("approve", { wrapDatabase: (db) => ({ query: db.query.bind(db), transaction: (work) => db.transaction((transaction) => work({ query: async (sql, parameters) => { statements.push(sql); return transaction.query(sql, parameters); } })) }) });
  try { await input.writer.write("opaque", input.human.request); assert.deepEqual(statements.slice(0, 7), ["set transaction isolation level serializable", "set local role jessica_non_proxy_qa_writer", "set local search_path = pg_catalog", "set local lock_timeout = '5s'", "set local statement_timeout = '15s'", "set local idle_in_transaction_session_timeout = '15s'", "select transaction_timestamp()::text as observed_at"]); } finally { Date.now = oldNow; await input.db.close(); }
});
