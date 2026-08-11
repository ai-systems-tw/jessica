import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bindQaReviewDecisionEvidence,
  canonicalJson,
  parseQaReviewDecisionEvidence,
} from "../dist/packages/contracts/src/index.js";
import { generateProxyBundle } from "../dist/packages/frame-generation/src/index.js";
import {
  appendGenerationJobEvent,
  createQueuedGenerationJobEvent,
  replayGenerationJobLedger,
} from "../dist/packages/generation-jobs/src/index.js";
import {
  createProxyQaDecision,
  reviewProxyGenerationOutput,
} from "../dist/packages/asset-review/src/index.js";
import { evaluateAssetAdmission } from "../dist/packages/runtime/src/index.js";

const fixtureUrl = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);
const EVALUATED_AT = "2026-08-11T00:10:00Z";

async function setup() {
  const input = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const bundle = await generateProxyBundle(input);
  const request = {
    schemaVersion: 1, tenantId: input.candidate.tenantId, frameModelId: input.candidate.frameModelId,
    method: "proxy-auto", generator: input.generator, sourceAssetSha256s: input.sourceAssetHashes,
    measurementSetSha256: input.measurementSet.sha256, generatorInputSha256: bundle.canonicalInputSha256,
    maxAttempts: 3, createdAt: "2026-08-11T00:00:00Z",
  };
  const queued = await createQueuedGenerationJobEvent(request);
  let state = await replayGenerationJobLedger([queued], { evaluatedAt: EVALUATED_AT });
  const claimed = await appendGenerationJobEvent(state, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker-a", claimToken: "claim-a", leaseExpiresAt: "2026-08-11T00:05:00Z" });
  state = await replayGenerationJobLedger([queued, claimed], { evaluatedAt: EVALUATED_AT });
  const output = { manifestSha256: bundle.manifestSha256, modelSha256: bundle.manifest.model.sha256, manifestByteLength: new TextEncoder().encode(bundle.manifestJson).byteLength, modelByteLength: bundle.glb.byteLength };
  const recorded = await appendGenerationJobEvent(state, "output-recorded", "2026-08-11T00:00:02Z", { workerId: "worker-a", claimToken: "claim-a", output });
  const events = [queued, claimed, recorded];
  return { input, bundle, events, queuedOnly: [queued] };
}

async function decision(context, overrides = {}) {
  return createProxyQaDecision({
    jobEvents: context.events, proxyInput: context.input, evaluatedAt: EVALUATED_AT,
    reviewerId: "reviewer-pseudonym-7", decision: "approve", issueCategories: [], notes: "Accepted only as a synthetic calibration draft.",
    reviewedAt: "2026-08-11T00:00:03Z", ...overrides,
  });
}

async function rebind(value, mutate) {
  const copy = structuredClone(value); delete copy.decisionSha256; mutate(copy);
  return bindQaReviewDecisionEvidence(copy);
}

test("explicit approve derives one immutable non-promotable AssetVersion draft", async () => {
  const context = await setup(); const approved = await decision(context);
  const result = await reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [approved], evaluatedAt: EVALUATED_AT });
  assert.equal(result.outcome, "draft-derived");
  assert.deepEqual(result.assetVersion, {
    schemaVersion: 1, id: context.input.candidate.assetId, tenantId: context.input.candidate.tenantId,
    frameModelId: context.input.candidate.frameModelId, frameVariantId: context.input.candidate.frameVariantId, version: 1,
    quality: "proxy", generationMethod: "proxy-auto", modelUrl: context.bundle.manifest.model.url,
    modelSha256: context.bundle.manifest.model.sha256, modelByteLength: context.bundle.glb.byteLength,
    manifestUrl: `./${context.bundle.manifestFileName}`, manifestSha256: context.bundle.manifestSha256,
    manifestByteLength: new TextEncoder().encode(context.bundle.manifestJson).byteLength,
    sourceAssetHashes: context.input.sourceAssetHashes,
    generation: {
      jobId: approved.binding.jobId, canonicalInputSha256: approved.binding.canonicalInputSha256,
      reviewHeadEventSha256: approved.binding.reviewHeadEventSha256, generatorInputSha256: context.bundle.canonicalInputSha256,
      generator: context.input.generator, qaDecisionSha256: approved.decisionSha256,
    },
    attachmentMatrix: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    qualityEnvelope: { maxYawDeg: 0, maxPitchDeg: 0, recommendedForLive: false, scaleConfidence: "high" },
    requirements: { physicalRequirementsMet: false, physicalEvidenceSha256: null, visualFidelityRequirementsMet: false, visualFidelityEvidenceSha256: null, actualWearRequirementsMet: false, actualWearEvidenceSha256: null, rightsRequirementsMet: false, rightsEvidenceSha256: null },
    fixture: true, admission: "calibration-only", promotable: false, status: "draft",
  });
});

test("explicit reject remains distinct evidence and derives no AssetVersion", async () => {
  const context = await setup();
  const rejected = await decision(context, { decision: "reject", issueCategories: ["visual-fidelity"], notes: "Synthetic geometry is not visually representative." });
  const result = await reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [rejected], evaluatedAt: EVALUATED_AT });
  assert.equal(result.outcome, "rejected"); assert.equal(result.assetVersion, null); assert.equal(result.decision.decision, "reject");
});

test("unknown fields, unsupported decisions, unbounded notes, duplicate and unsorted issues fail closed", async () => {
  const context = await setup(); const approved = await decision(context);
  assert.throws(() => parseQaReviewDecisionEvidence({ ...approved, future: true }), /not allowed/);
  assert.throws(() => parseQaReviewDecisionEvidence({ ...approved, decision: "auto-approve" }), /unsupported/);
  assert.throws(() => parseQaReviewDecisionEvidence({ ...approved, notes: "x".repeat(2001) }), /bounded/);
  assert.throws(() => parseQaReviewDecisionEvidence({ ...approved, decision: "reject", issueCategories: ["rights", "rights"] }), /duplicates/);
  assert.throws(() => parseQaReviewDecisionEvidence({ ...approved, decision: "reject", issueCategories: ["rights", "geometry"] }), /sorted/);
});

test("QA requires the exact GenerationJob review state", async () => {
  const context = await setup();
  await assert.rejects(createProxyQaDecision({ jobEvents: context.queuedOnly, proxyInput: context.input, evaluatedAt: EVALUATED_AT, reviewerId: "reviewer", decision: "approve", issueCategories: [], notes: null, reviewedAt: "2026-08-11T00:00:03Z" }), /review state/);
});

test("tenant, model, job, input, head, and output substitution fail even with a freshly bound digest", async () => {
  const context = await setup(); const approved = await decision(context);
  const mutations = [
    (value) => { value.binding.tenantId = "other-tenant"; }, (value) => { value.binding.frameModelId = "other-model"; },
    (value) => { value.binding.jobId = `gj_${"a".repeat(64)}`; }, (value) => { value.binding.canonicalInputSha256 = "a".repeat(64); },
    (value) => { value.binding.reviewHeadEventSha256 = "a".repeat(64); }, (value) => { value.binding.generatorInputSha256 = "a".repeat(64); },
    (value) => { value.binding.output.modelSha256 = "a".repeat(64); }, (value) => { value.binding.output.modelByteLength += 1; },
    (value) => { value.binding.output.manifestSha256 = "a".repeat(64); }, (value) => { value.binding.output.manifestByteLength += 1; },
  ];
  for (const mutate of mutations) {
    const substituted = await rebind(approved, mutate);
    await assert.rejects(reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [substituted], evaluatedAt: EVALUATED_AT }), /cannot substitute/);
  }
});

test("proxy candidate relabel, version escalation, and changed deterministic output fail closed", async () => {
  for (const mutate of [(value) => { value.candidate.assetId = "relabelled"; }, (value) => { value.candidate.assetVersion = 99; }, (value) => { value.candidate.frameVariantId = "other-variant"; }, (value) => { value.profile.bridgeAnchors.left[1] = 1; }]) {
    const context = await setup(); const approved = await decision(context); const changed = structuredClone(context.input); mutate(changed);
    await assert.rejects(reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: changed, decisions: [approved], evaluatedAt: EVALUATED_AT }), /processing identity|reviewed output/);
  }
});

test("review timestamps and explicit evaluatedAt reject future, stale, and mismatched evidence", async () => {
  const context = await setup();
  await assert.rejects(decision(context, { reviewedAt: "2026-08-11T00:10:01Z" }), /future review/);
  const stale = await decision(context, { reviewedAt: "2026-08-11T00:00:01Z" });
  await assert.rejects(reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [stale], evaluatedAt: EVALUATED_AT }), /precede reviewed output/);
  const approved = await decision(context);
  await assert.rejects(reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [approved], evaluatedAt: "2026-08-11T00:11:00Z" }), /must equal/);
});

test("tampered, duplicate, absent, and multiple or reordered terminal decisions fail closed", async () => {
  const context = await setup(); const approved = await decision(context);
  const tampered = structuredClone(approved); tampered.notes = "Changed after review.";
  await assert.rejects(reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [tampered], evaluatedAt: EVALUATED_AT }), /does not match/);
  for (const decisions of [[], [approved, approved], [await decision(context, { decision: "reject", issueCategories: ["geometry"], notes: null }), approved]]) {
    await assert.rejects(reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions, evaluatedAt: EVALUATED_AT }), /exactly one/);
  }
});

test("concurrent repeated derivation is deterministic and has no implicit storage side effect", async () => {
  const context = await setup(); const approved = await decision(context);
  const options = { jobEvents: context.events, proxyInput: context.input, decisions: [approved], evaluatedAt: EVALUATED_AT };
  const results = await Promise.all(Array.from({ length: 8 }, () => reviewProxyGenerationOutput(options)));
  assert.equal(new Set(results.map((result) => canonicalJson(result))).size, 1);
});

test("derived proxy draft cannot be admitted to QA preview or public live", async () => {
  const context = await setup(); const approved = await decision(context);
  const result = await reviewProxyGenerationOutput({ jobEvents: context.events, proxyInput: context.input, decisions: [approved], evaluatedAt: EVALUATED_AT });
  const runtimeAsset = result.assetVersion;
  assert.equal(runtimeAsset.status, "draft"); assert.equal(runtimeAsset.qualityEnvelope.recommendedForLive, false); assert.equal(runtimeAsset.promotable, false);
  assert.equal(evaluateAssetAdmission({ mode: "public-live", asset: runtimeAsset, fixture: true }).admitted, false);
  assert.equal(evaluateAssetAdmission({ mode: "qa-preview", asset: runtimeAsset, fixture: true }).admitted, false);
  assert.equal(evaluateAssetAdmission({ mode: "calibration", asset: runtimeAsset, fixture: true }).admitted, true);
});

test("all physical, visual, actual-wear, and rights claims remain explicit false/null blockers", async () => {
  const context = await setup(); const approved = await decision(context);
  for (const mutate of [
    (value) => { value.requirements.physicalRequirementsMet = true; }, (value) => { value.requirements.visualFidelityRequirementsMet = true; },
    (value) => { value.requirements.actualWearRequirementsMet = true; }, (value) => { value.requirements.rightsRequirementsMet = true; },
    (value) => { value.requirements.rightsEvidenceSha256 = "a".repeat(64); },
  ]) {
    const changed = structuredClone(approved); mutate(changed);
    assert.throws(() => parseQaReviewDecisionEvidence(changed), /must remain/);
  }
});
