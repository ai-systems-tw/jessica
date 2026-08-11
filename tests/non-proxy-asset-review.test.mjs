import assert from "node:assert/strict";
import test from "node:test";
import {
  bindNonProxyQaDecisionEvidence,
  canonicalJson,
  parseNonProxyQaDecisionEvidence,
} from "../dist/packages/contracts/src/index.js";
import { appendGenerationJobEvent, createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../dist/packages/generation-jobs/src/index.js";
import { createNonProxyQaDecision, reviewNonProxyGenerationOutput } from "../dist/packages/asset-review/src/index.js";

const H = (seed) => seed.repeat(64).slice(0, 64);
const AT = "2026-08-11T02:00:00Z";
const output = { manifestSha256: H("a"), modelSha256: H("b"), manifestByteLength: 1024, modelByteLength: 2048 };
const candidate = { id: "candidate-standard-v1", frameVariantId: "variant-standard-black", version: 1, quality: "standard", generationMethod: "standard-auto", modelUrl: "https://assets.example/standard/v1/frame.glb", manifestUrl: "https://assets.example/standard/v1/manifest.json", attachmentMatrix: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], qualityEnvelope: { maxYawDeg: 25, maxPitchDeg: 20, scaleConfidence: "high" } };
const requirements = { physical: { evidenceSha256: H("c"), sourceAssetSha256: H("2"), measurementSetSha256: H("4") }, visualFidelity: { evidenceSha256: H("d"), sourceAssetSha256: H("2"), measurementSetSha256: H("4") }, actualWear: { evidenceSha256: H("e"), sourceAssetSha256: H("3"), measurementSetSha256: H("4") }, rights: { evidenceSha256: H("f"), sourceAssetSha256: H("3"), measurementSetSha256: H("4") } };

async function setup(method = "standard-auto") {
  const request = { schemaVersion: 1, tenantId: "tenant-1", frameModelId: "model-1", method, generator: { id: "generator-1", version: "1.0.0", configSha256: H("1") }, sourceAssetSha256s: [H("2"), H("3")], measurementSetSha256: H("4"), generatorInputSha256: H("5"), maxAttempts: 2, createdAt: "2026-08-11T01:00:00Z" };
  const queued = await createQueuedGenerationJobEvent(request); let state = await replayGenerationJobLedger([queued], { evaluatedAt: AT });
  const claimed = await appendGenerationJobEvent(state, "claimed", "2026-08-11T01:00:01Z", { workerId: "worker-1", claimToken: "claim-1", leaseExpiresAt: "2026-08-11T01:05:00Z" }); state = await replayGenerationJobLedger([queued, claimed], { evaluatedAt: AT });
  const recorded = await appendGenerationJobEvent(state, "output-recorded", "2026-08-11T01:00:02Z", { workerId: "worker-1", claimToken: "claim-1", output });
  return { events: [queued, claimed, recorded] };
}
async function approved(context, overrides = {}) { return createNonProxyQaDecision({ jobEvents: context.events, candidate, requirements, evaluatedAt: AT, reviewerId: "reviewer-1", decision: "accept-evidence-candidate", issueCategories: [], notes: "Evidence references are unverified until an authority adapter validates bytes and scope.", reviewedAt: "2026-08-11T01:00:03Z", ...overrides }); }

test("non-proxy evidence references derive only an immutable non-authoritative draft", async () => {
  const decision = await approved(await setup()); const result = await reviewNonProxyGenerationOutput({ jobEvents: (await setup()).events, decisions: [decision], evaluatedAt: AT });
  assert.equal(result.outcome, "draft-derived"); assert.equal(result.candidate.status, "draft"); assert.equal(result.candidate.promotable, false); assert.equal(result.candidate.qualityEnvelope.recommendedForLive, false); assert.equal(result.candidate.fixtureStatus, "unverified"); assert.deepEqual(result.candidate.authority, { qaApproved: false, assetVersionCreated: false, assetVersionPromoted: false, recommendedForLive: false, activeDeployment: false, publication: false, gates: false }); assert.deepEqual(result.candidate.requirements, requirements); assert.equal(result.candidate.modelSha256, output.modelSha256);
});

test("all four evidence references require digest and reviewed source/measurement bindings", async () => {
  const context = await setup();
  for (const mutate of [(v) => { v.physical.evidenceSha256 = null; }, (v) => { v.visualFidelity.sourceAssetSha256 = H("9"); }, (v) => { v.actualWear.measurementSetSha256 = H("9"); }, (v) => { delete v.rights.evidenceSha256; }]) {
    const changed = structuredClone(requirements); mutate(changed);
    await assert.rejects(approved(context, { requirements: changed }), /digest|required|cannot substitute/);
  }
});

test("proxy and mismatched method are rejected before a non-proxy decision can exist", async () => {
  await assert.rejects(approved(await setup("proxy-auto")), /proxy jobs/);
  await assert.rejects(approved(await setup("manual")), /generation method/);
});

test("decision binds exact reviewed job output and preserves the explicit candidate identity", async () => {
  const context = await setup(); const decision = await approved(context);
  for (const mutate of [(v) => { v.binding.output.modelSha256 = H("9"); }, (v) => { v.binding.candidate.quality = "proxy"; }]) {
    const copy = structuredClone(decision); delete copy.decisionSha256; mutate(copy);
    if (copy.binding.candidate.quality === "proxy") await assert.rejects(bindNonProxyQaDecisionEvidence(copy), /standard or premium/);
    else { const rebound = await bindNonProxyQaDecisionEvidence(copy); await assert.rejects(reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [rebound], evaluatedAt: AT }), /cannot substitute/); }
  }
  const rawMutation = structuredClone(decision); rawMutation.binding.candidate.id = "other";
  await assert.rejects(reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [rawMutation], evaluatedAt: AT }), /does not match/);
});

test("reject is preserved without a derived asset; no approve path can publish", async () => {
  const context = await setup(); const rejected = await approved(context, { decision: "reject", issueCategories: ["geometry"], notes: "Geometry requires correction." });
  const result = await reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [rejected], evaluatedAt: AT }); assert.deepEqual({ outcome: result.outcome, candidate: result.candidate }, { outcome: "rejected", candidate: null });
  const decision = await approved(context); const copy = structuredClone(decision); delete copy.decisionSha256; copy.publication = true; assert.throws(() => parseNonProxyQaDecisionEvidence({ ...copy, decisionSha256: H("0") }), /not allowed/); assert.equal(canonicalJson(decision.requirements), canonicalJson(requirements));
});

test("candidate locators, matrix arrays, issue categories, and timestamps fail closed", async () => {
  const context = await setup();
  for (const mutate of [
    (value) => { value.modelUrl = "javascript:alert(1)"; },
    (value) => { value.manifestUrl = "https://user:secret@assets.example/manifest.json"; },
    (value) => { value.attachmentMatrix.push(0); },
    (value) => { value.qualityEnvelope.maxYawDeg = Number.NaN; },
  ]) {
    const changed = structuredClone(candidate); mutate(changed);
    await assert.rejects(approved(context, { candidate: changed }), /locator|array|between/);
  }
  await assert.rejects(approved(context, { decision: "reject", issueCategories: ["invented"] }), /supported issue/);
  await assert.rejects(approved(context, { reviewedAt: "2026-08-11T01:00:03.0000Z" }), /RFC 3339/);
});

test("create and review snapshot caller-owned input before the first await", async () => {
  const context = await setup();
  const createOptions = { jobEvents: context.events, candidate: structuredClone(candidate), requirements: structuredClone(requirements), evaluatedAt: AT, reviewerId: "reviewer-1", decision: "accept-evidence-candidate", issueCategories: [], notes: null, reviewedAt: "2026-08-11T01:00:03Z" };
  const creating = createNonProxyQaDecision(createOptions);
  createOptions.candidate.id = "mutated-after-call";
  createOptions.requirements.physical.sourceAssetSha256 = H("9");
  const decision = await creating;
  assert.equal(decision.binding.candidate.id, candidate.id);
  assert.equal(decision.requirements.physical.sourceAssetSha256, requirements.physical.sourceAssetSha256);

  const reviewOptions = { jobEvents: context.events, decisions: [decision], evaluatedAt: AT };
  const reviewing = reviewNonProxyGenerationOutput(reviewOptions);
  reviewOptions.decisions[0].binding.candidate.id = "mutated-after-review-call";
  reviewOptions.evaluatedAt = "2026-08-11T02:00:01Z";
  const result = await reviewing;
  assert.equal(result.candidate.id, candidate.id);
});

test("tamper, duplicate decisions, stale review, and explicit horizon substitution are rejected", async () => {
  const context = await setup(); const decision = await approved(context);
  const tampered = structuredClone(decision); tampered.notes = "changed";
  await assert.rejects(reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [tampered], evaluatedAt: AT }), /does not match/);
  await assert.rejects(reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [decision, decision], evaluatedAt: AT }), /exactly one/);
  const stale = await approved(context, { reviewedAt: "2026-08-11T01:00:01Z" });
  await assert.rejects(reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [stale], evaluatedAt: AT }), /precede/);
  await assert.rejects(reviewNonProxyGenerationOutput({ jobEvents: context.events, decisions: [decision], evaluatedAt: "2026-08-11T02:00:01Z" }), /must equal/);
});
