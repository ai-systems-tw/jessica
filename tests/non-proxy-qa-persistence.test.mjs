import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, inspectNonProxyQaPersistencePlanIntegrity } from "../dist/packages/contracts/src/index.js";
import { evaluateNonProxyQaPersistencePlan } from "../dist/packages/asset-review/src/index.js";
import { setup as setupHumanQa } from "./non-proxy-human-qa-decision.test.mjs";

function emptyExistingRows() { return { reviewerAuthority: null, reviewRecord: null, assetVersion: null, binding: null, sourceRows: [] }; }

async function setup(decision = "approve") {
  const human = await setupHumanQa(decision); const candidate = human.candidate; const attestation = human.request.decisionAttestation;
  const maximumReviewAgeMs = human.context.reviewerTrust.maximumReviewAgeMs; const reviewPolicySha256 = await sha({ domain: "jessica/non-proxy-qa/review-policy/v1", maximumReviewAgeMs });
  const controlPlaneSnapshot = {
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
      output: { manifestSha256: candidate.manifestSha256, modelSha256: candidate.modelSha256, manifestByteLength: candidate.manifestByteLength, modelByteLength: candidate.modelByteLength },
    },
    sourceMappings: candidate.sourceAssetHashes.map((sourceAssetSha256, index) => ({ sourceAssetSha256, sourceAssetId: `source-persist-${index + 1}` })),
    measurementSet: { id: "measurement-set-persist-1", sha256: candidate.requirements.physical.measurementSetSha256 },
    candidateAssetVersion: { id: candidate.id, version: candidate.version },
    existingRows: emptyExistingRows(),
    reviewerAuthority: {
      authorityId: attestation.authorityId, keyId: attestation.keyId, reviewerId: attestation.reviewerId,
      scope: "non-proxy-human-qa-decision", publicKeyFingerprintSha256: attestation.publicKeyFingerprintSha256,
      publicJwk: structuredClone(human.reviewerJwk), status: "active", createdAt: "2026-08-11T02:00:00Z", revokedAt: null,
    },
    reviewPolicy: { maximumReviewAgeMs, sha256: reviewPolicySha256 },
  };
  return { human, request: { humanQaRequest: human.request }, context: { humanQaContext: human.context, controlPlaneSnapshot } };
}

const projectionHeads = (plan) => ({ reviewerAuthority: { id: plan.reviewerAuthority.id, rowSha256: plan.reviewerAuthority.rowSha256 }, reviewRecord: { id: plan.reviewRecord.id, rowSha256: plan.reviewRecord.rowSha256 }, assetVersion: plan.assetVersion && { id: plan.assetVersion.id, rowSha256: plan.assetVersion.rowSha256 }, binding: plan.binding && { id: plan.binding.id, rowSha256: plan.binding.rowSha256 }, sourceRows: plan.sourceRows.map(({ id, rowSha256 }) => ({ id, rowSha256 })) });
const sha = async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value)))).toString("hex");
async function rehashPlan(plan, rowName) {
  const row = plan[rowName]; const body = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id" && key !== "rowSha256"));
  const domains = { reviewerAuthority: ["jessica/non-proxy-qa/reviewer-authority-row/v1", "nqra"], reviewRecord: ["jessica/non-proxy-qa/human-review-row/v1", null], assetVersion: ["jessica/non-proxy-qa/asset-version-row/v1", null] }; const [domain, prefix] = domains[rowName]; row.rowSha256 = await sha(rowName === "assetVersion" ? { domain, id: row.id, body } : { domain, body }); if (prefix) row.id = `${prefix}_${row.rowSha256}`;
  if (rowName === "reviewerAuthority") plan.reviewRecord.reviewerAuthorityRowId = row.id;
  if (rowName === "reviewerAuthority") { const reviewBody = Object.fromEntries(Object.entries(plan.reviewRecord).filter(([key]) => key !== "id" && key !== "rowSha256")); plan.reviewRecord.rowSha256 = await sha({ domain: "jessica/non-proxy-qa/human-review-row/v1", body: reviewBody }); }
  const { planSha256: _digest, idempotencyKey: _key, ...planBody } = plan; plan.planSha256 = await sha({ domain: "jessica/non-proxy-qa/persistence-plan/v1", body: planBody }); plan.idempotencyKey = `nqpp_${plan.planSha256}`;
}

test("approve produces a deterministic deeply frozen canonical row-projection plan", async () => {
  const input = await setup(); const first = await evaluateNonProxyQaPersistencePlan(input.request, input.context); const second = await evaluateNonProxyQaPersistencePlan(input.request, input.context);
  assert.deepEqual(first, second); assert.match(first.planSha256, /^[a-f0-9]{64}$/); assert.equal(first.idempotencyKey, `nqpp_${first.planSha256}`);
  assert.ok(first.assetVersion); assert.ok(first.binding); assert.equal(first.sourceRows.length, input.human.candidate.sourceAssetHashes.length); assert.equal(first.assetVersion.fixtureStatus, "unverified"); assert.equal(first.assetVersion.admission, "internal-review-only"); assert.equal(first.assetVersion.promotable, false); assert.equal(first.binding.decisionPayloadSha256, first.reviewRecord.decisionPayloadSha256); assert.equal(first.binding.effectiveValidUntil, first.reviewRecord.effectiveValidUntil); assert.equal(first.reviewRecord.maximumReviewAgeMs, input.human.context.reviewerTrust.maximumReviewAgeMs);
  for (const target of [first, first.reviewerAuthority, first.reviewRecord, first.reviewRecord.composition, first.assetVersion, first.binding, first.sourceRows, first.authority]) assert.equal(Object.isFrozen(target), true);
  for (const value of Object.values(first.authority)) assert.equal(value, false);
});

test("reject persists only the immutable signed terminal review record", async () => {
  const input = await setup("reject"); const plan = await evaluateNonProxyQaPersistencePlan(input.request, input.context);
  assert.equal(plan.decision, "reject"); assert.equal(plan.assetVersion, null); assert.equal(plan.binding, null); assert.deepEqual(plan.sourceRows, []); assert.equal(plan.reviewRecord.signatureBase64, input.human.request.decisionAttestation.signatureBase64); assert.deepEqual(plan.reviewRecord.composition, input.human.request.decisionAttestation.composition);
});

test("only a complete raw JSC-0215 request is accepted and cached/projected results are refused", async () => {
  for (const [key, value] of [["humanQaResult", {}], ["approvedReviewProjection", {}], ["assetVersion", {}], ["status", "approved"], ["evaluatedAt", "2026-08-11T03:00:00Z"], ["reviewerAuthority", {}]]) { const input = await setup(); input.request[key] = value; await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), /not allowed/); }
  const cached = await setup(); cached.request.humanQaRequest = { cachedResult: {} }; await assert.rejects(evaluateNonProxyQaPersistencePlan(cached.request, cached.context));
});

test("host snapshot cross-bindings reject tenant/model/variant/job/head/output and candidate relabels", async () => {
  const mutations = [
    (s) => { s.tenantId = "other-tenant"; }, (s) => { s.frameModelId = "other-model"; }, (s) => { s.frameVariantId = "other-variant"; },
    (s) => { s.generationJob.id = "other-job"; }, (s) => { s.generationJob.reviewHeadEventSha256 = "9".repeat(64); }, (s) => { s.generationJob.output.modelByteLength += 1; },
    (s) => { s.candidateAssetVersion.id = "other-asset"; }, (s) => { s.candidateAssetVersion.version += 1; },
  ];
  for (const mutate of mutations) { const input = await setup(); mutate(input.context.controlPlaneSnapshot); await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), /cannot relabel|must be exact/); }
});

test("source and MeasurementSet mapping are exact, unique, sorted and non-relabelable", async () => {
  const mutations = [
    (s) => { s.sourceMappings.pop(); }, (s) => { s.sourceMappings.push(structuredClone(s.sourceMappings[0])); },
    (s) => { s.sourceMappings[0].sourceAssetId = s.sourceMappings[1].sourceAssetId; }, (s) => { s.sourceMappings[0].sourceAssetSha256 = "9".repeat(64); },
    (s) => { s.sourceMappings.reverse(); }, (s) => { s.measurementSet.sha256 = "9".repeat(64); },
  ];
  for (const mutate of mutations) { const input = await setup(); mutate(input.context.controlPlaneSnapshot); await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), /source mapping|MeasurementSet/); }
});

test("expired JSC-0215 decisions and caller-selected clock or authority fields fail closed", async () => {
  const stale = await setup(); stale.context.humanQaContext.caliperProvenanceContext.evaluatedAt = "2026-08-11T03:31:00Z"; stale.context.controlPlaneSnapshot.observedAt = "2026-08-11T03:31:00Z"; await assert.rejects(evaluateNonProxyQaPersistencePlan(stale.request, stale.context), /stale|expired|outside/);
  const clock = await setup(); clock.request.observedAt = clock.context.controlPlaneSnapshot.observedAt; await assert.rejects(evaluateNonProxyQaPersistencePlan(clock.request, clock.context), /not allowed/);
  const mismatch = await setup(); mismatch.context.controlPlaneSnapshot.observedAt = "2026-08-11T03:00:01Z"; await assert.rejects(evaluateNonProxyQaPersistencePlan(mismatch.request, mismatch.context), /host clock snapshot/);
});

test("exact retry snapshots reproduce the plan and same-identity different-content snapshots are denied", async () => {
  const input = await setup(); const first = await evaluateNonProxyQaPersistencePlan(input.request, input.context); input.context.controlPlaneSnapshot.existingRows = projectionHeads(first); const retry = await evaluateNonProxyQaPersistencePlan(input.request, input.context); assert.deepEqual(retry, first);
  input.context.controlPlaneSnapshot.existingRows.reviewRecord.rowSha256 = "9".repeat(64); await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), /identity collision/);
});

test("an exact existing reviewer authority is reusable while a fresh terminal group remains absent", async () => {
  const input = await setup(); const first = await evaluateNonProxyQaPersistencePlan(input.request, input.context); input.context.controlPlaneSnapshot.existingRows.reviewerAuthority = { id: first.reviewerAuthority.id, rowSha256: first.reviewerAuthority.rowSha256 };
  const next = await evaluateNonProxyQaPersistencePlan(input.request, input.context); assert.deepEqual(next, first);
  input.context.controlPlaneSnapshot.existingRows.reviewerAuthority.rowSha256 = "9".repeat(64); await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), /reviewer authority.*different canonical contents/);
});

test("a new valid ES256 signature keeps terminal semantic ID but collides against different persisted row bytes", async () => {
  const input = await setup(); const first = await evaluateNonProxyQaPersistencePlan(input.request, input.context); input.context.controlPlaneSnapshot.existingRows = projectionHeads(first); await input.human.resign();
  await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), /identity collision/);
});

test("exported integrity inspector rejects forged self-consistent hashes and grants no authority", async () => {
  const input = await setup(); const valid = await evaluateNonProxyQaPersistencePlan(input.request, input.context); assert.deepEqual(await inspectNonProxyQaPersistencePlanIntegrity(valid), valid); for (const claim of Object.values(valid.authority)) assert.equal(claim, false);
  const published = structuredClone(valid); published.assetVersion.status = "published"; published.assetVersion.promotable = true; published.assetVersion.publicationEligible = true; await rehashPlan(published, "assetVersion"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(published), /internal-review-only|non-promotable|non-live/);
  const authority = structuredClone(valid); authority.reviewerAuthority.scope = "non-proxy-qa-control-plane-persistence"; authority.reviewerAuthority.algorithm = "none"; await rehashPlan(authority, "reviewerAuthority"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(authority), /active ES256 human-QA authority/);
  const terminal = structuredClone(valid); terminal.reviewRecord.terminal = false; await rehashPlan(terminal, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(terminal), /terminal|binding mismatch/);
  const sourceSet = structuredClone(valid); sourceSet.reviewRecord.sourceSetSha256 = "9".repeat(64); await rehashPlan(sourceSet, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(sourceSet), /source-set|binding mismatch/);
  const inputHorizon = structuredClone(valid); inputHorizon.reviewRecord.inputValidUntil = "2026-08-11T03:29:59Z"; await rehashPlan(inputHorizon, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(inputHorizon), /validity|composition/);
  const effectiveHorizon = structuredClone(valid); effectiveHorizon.reviewRecord.effectiveValidUntil = "2026-08-11T03:29:59Z"; await rehashPlan(effectiveHorizon, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(effectiveHorizon), /validity times/);
  const policyAge = structuredClone(valid); policyAge.reviewRecord.maximumReviewAgeMs += 1; await rehashPlan(policyAge, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(policyAge), /policy or validity/);
  const policyDigest = structuredClone(valid); policyDigest.reviewRecord.reviewPolicySha256 = "9".repeat(64); await rehashPlan(policyDigest, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(policyDigest), /policy or validity/);
  const freshHorizon = structuredClone(valid); freshHorizon.reviewRecord.reviewFreshUntil = "2026-08-11T03:29:59Z"; await rehashPlan(freshHorizon, "reviewRecord"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(freshHorizon), /policy or validity/);
  for (const [field, value] of [["modelUrl", "https://untrusted.example.test/relabel.glb"], ["generationMethod", "external"], ["quality", "premium"], ["attachmentMatrix", [...valid.assetVersion.attachmentMatrix.slice(0, 15), 2]]]) { const forged = structuredClone(valid); forged.assetVersion[field] = value; await rehashPlan(forged, "assetVersion"); await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(forged), /projection|digest|binding|mismatch/); }
});

test("hostile prototype/accessor/symbol/sparse/cycle input and post-call mutation fail closed", async () => {
  const accessor = await setup(); let invoked = false; accessor.context.controlPlaneSnapshot.sourceMappings[0] = Object.defineProperty({}, "sourceAssetSha256", { enumerable: true, get() { invoked = true; return "a".repeat(64); } }); await assert.rejects(evaluateNonProxyQaPersistencePlan(accessor.request, accessor.context), /enumerable data properties/); assert.equal(invoked, false);
  const prototype = await setup(); prototype.context.controlPlaneSnapshot.measurementSet = Object.assign(Object.create({ inherited: true }), prototype.context.controlPlaneSnapshot.measurementSet); await assert.rejects(evaluateNonProxyQaPersistencePlan(prototype.request, prototype.context), /plain object/);
  const symbol = await setup(); symbol.context.controlPlaneSnapshot[Symbol("hidden")] = true; await assert.rejects(evaluateNonProxyQaPersistencePlan(symbol.request, symbol.context), /plain object/);
  const sparse = await setup(); sparse.context.controlPlaneSnapshot.sourceMappings.length += 1; await assert.rejects(evaluateNonProxyQaPersistencePlan(sparse.request, sparse.context), /dense plain array/);
  const cycle = await setup(); cycle.context.controlPlaneSnapshot.loop = cycle.context.controlPlaneSnapshot; await assert.rejects(evaluateNonProxyQaPersistencePlan(cycle.request, cycle.context), /cyclic|not allowed/);
  const mutation = await setup(); const pending = evaluateNonProxyQaPersistencePlan(mutation.request, mutation.context); mutation.context.controlPlaneSnapshot.tenantId = "mutated"; mutation.context.controlPlaneSnapshot.sourceMappings.reverse(); mutation.request.humanQaRequest.decisionAttestation.decision = "reject"; const result = await pending; assert.equal(result.decision, "approve");
});

test("inherited required fields and inspector structural-budget attacks fail before inherited access or semantic parsing", async () => {
  const input = await setup(); let inheritedAccessed = false;
  Object.defineProperty(Object.prototype, "humanQaRequest", { configurable: true, get() { inheritedAccessed = true; throw new Error("inherited getter invoked"); } });
  try { await assert.rejects(evaluateNonProxyQaPersistencePlan({}, input.context), /humanQaRequest is required/); assert.equal(inheritedAccessed, false); } finally { delete Object.prototype.humanQaRequest; }
  const valid = await evaluateNonProxyQaPersistencePlan(input.request, input.context);
  const wide = { overflow: Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`unknown${index}`, index])), ...structuredClone(valid) };
  await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(wide), /object-width budget/);
  const aggregate = { padding: Array.from({ length: 17 }, (_, index) => `${index}`.padEnd(999_999, "x")), ...structuredClone(valid) };
  await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(aggregate), /aggregate text budget/);
});

test("raw evaluator snapshot preserves __proto__ as an unknown own field and never invokes polluted setters", async () => {
  const protoInput = await setup(); Object.defineProperty(protoInput.context.controlPlaneSnapshot, "__proto__", { value: null, writable: true, configurable: true, enumerable: true });
  await assert.rejects(evaluateNonProxyQaPersistencePlan(protoInput.request, protoInput.context), /__proto__ is not allowed/);

  const input = await setup(); const baseline = await evaluateNonProxyQaPersistencePlan(input.request, input.context); const probe = "__jsc0218RawCloneProbe__"; let invoked = false; const previous = Object.getOwnPropertyDescriptor(Object.prototype, probe);
  Object.defineProperty(input.context.controlPlaneSnapshot, probe, { value: "own-data", writable: true, configurable: true, enumerable: true });
  Object.defineProperty(Object.prototype, probe, { configurable: true, set() { invoked = true; throw new Error("polluted setter invoked"); } });
  try { await assert.rejects(evaluateNonProxyQaPersistencePlan(input.request, input.context), new RegExp(`${probe} is not allowed`)); assert.equal(invoked, false); } finally { if (previous) Object.defineProperty(Object.prototype, probe, previous); else delete Object.prototype[probe]; }
  delete input.context.controlPlaneSnapshot[probe]; const unchanged = await evaluateNonProxyQaPersistencePlan(input.request, input.context); assert.deepEqual(unchanged, baseline); assert.equal(Object.isFrozen(unchanged), true);
});

test("raw evaluator enforces object width and aggregate UTF-8 key budgets before exact parsing", async () => {
  const wide = await setup(); wide.context.controlPlaneSnapshot.budgetProbe = Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`field${index}`, null]));
  await assert.rejects(evaluateNonProxyQaPersistencePlan(wide.request, wide.context), /object-width budget/);

  const aggregate = await setup(); aggregate.context.controlPlaneSnapshot.budgetProbe = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field${index}`.padEnd(34_000, "k"), index % 2 === 0 ? null : index]));
  await assert.rejects(evaluateNonProxyQaPersistencePlan(aggregate.request, aggregate.context), /aggregate text budget/);

  const normal = await setup(); const plan = await evaluateNonProxyQaPersistencePlan(normal.request, normal.context); assert.equal(Object.isFrozen(plan), true); assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
});

test("integrity inspector clone preserves __proto__ as an unknown own field and never invokes polluted setters", async () => {
  const input = await setup(); const valid = await evaluateNonProxyQaPersistencePlan(input.request, input.context);
  const protoPlan = structuredClone(valid); Object.defineProperty(protoPlan, "__proto__", { value: null, writable: true, configurable: true, enumerable: true });
  await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(protoPlan), /persistence plan must contain exact fields|__proto__ is not allowed/);

  const setterPlan = structuredClone(valid); const probe = "__jsc0218InspectorCloneProbe__"; let invoked = false; const previous = Object.getOwnPropertyDescriptor(Object.prototype, probe);
  Object.defineProperty(setterPlan, probe, { value: "own-data", writable: true, configurable: true, enumerable: true });
  Object.defineProperty(Object.prototype, probe, { configurable: true, set() { invoked = true; throw new Error("polluted setter invoked"); } });
  try { await assert.rejects(inspectNonProxyQaPersistencePlanIntegrity(setterPlan), /persistence plan must contain exact fields/); assert.equal(invoked, false); } finally { if (previous) Object.defineProperty(Object.prototype, probe, previous); else delete Object.prototype[probe]; }
  const unchanged = await inspectNonProxyQaPersistencePlanIntegrity(valid); assert.deepEqual(unchanged, valid); assert.equal(Object.isFrozen(unchanged), true); assert.equal(unchanged.planSha256, valid.planSha256);
});
