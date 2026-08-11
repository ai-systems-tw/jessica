import test from "node:test";
import assert from "node:assert/strict";
import {
  FIT_AUTHORITY_DENIALS, FIT_CANDIDATE_POLICY, FIT_DIMENSIONS, FIT_EXPLANATION_CODES, FIT_REFERENCE_GUIDANCE_TEXT,
  FIT_RELATION_CODES, FIT_UNAVAILABLE_CODES, bindFitIntelligenceInput, bindFitProductCandidate, canonicalJson,
  parseFitIntelligenceInput, sha256Hex,
} from "../dist/packages/contracts/src/index.js";
import {
  buildFitIntelligenceCommand, evaluateFitIntelligence, verifyFitIntelligenceCommand, verifyFitIntelligenceEvaluation,
} from "../dist/packages/fit-intelligence/src/index.js";

const BASE = "2026-08-11T12:00:00.000Z";
const H = (value) => (((value.charCodeAt(0) % 15) + 1).toString(16)).repeat(64);
const MM = Object.freeze({ frameWidthMm: 140, lensWidthMm: 52, bridgeWidthMm: 18, lensHeightMm: 40, templeLengthMm: 145 });
async function product(name, overrides = {}) {
  return bindFitProductCandidate({ schemaVersion: 1, type: "fit-intelligence.product-candidate", tenantId: "tenant-a", siteId: "site-a", environment: "production", sku: `SKU-${name}`, frameModelId: `model-${name}`, frameVariantId: `variant-${name}`, measurementSetSha256: H(name[0] ?? "a"), sourceSetSha256: H(name[1] ?? "b"), measurementVerification: "verified-physical-mm", measurements: MM, catalogBindingStatus: "exact-scope-candidate-unverified", ...overrides });
}
async function input(candidateValues, referenceOverrides = {}, inputOverrides = {}) {
  const reference = await product("ref", referenceOverrides); return bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference, candidates: candidateValues, ...inputOverrides });
}

test("candidate policy, relations, explanations, and top-N are fixed and runtime-frozen", () => {
  assert.equal(Object.isFrozen(FIT_CANDIDATE_POLICY), true); assert.equal(Object.isFrozen(FIT_CANDIDATE_POLICY.thresholdsMm), true); assert.equal(Object.isFrozen(FIT_CANDIDATE_POLICY.weights), true); assert.equal(FIT_CANDIDATE_POLICY.topN, 5); assert.equal(FIT_CANDIDATE_POLICY.status, "non-production-candidate-policy-external-validation-pending"); assert.equal(Object.values(FIT_CANDIDATE_POLICY.weights).reduce((a, b) => a + b, 0), 100);
  for (const list of [FIT_DIMENSIONS, FIT_RELATION_CODES, FIT_EXPLANATION_CODES, FIT_UNAVAILABLE_CODES]) { assert.equal(Object.isFrozen(list), true); assert.throws(() => list.push("invented"), TypeError); }
});

test("input binds exact product, immutable measurement/source references, and is stable under candidate order", async () => {
  const a = await product("a", { measurements: { ...MM, frameWidthMm: 139 } }); const b = await product("b", { measurements: { ...MM, frameWidthMm: 142 } }); const first = await input([a, b]); const second = await input([b, a]); assert.deepEqual(first, second); assert.equal(first.requestId, `fir_${first.inputSha256}`); assert.equal(first.idempotencyKey, `firv1_${first.inputSha256}`); assert.deepEqual(first.candidates.map((item) => item.sku), ["SKU-a", "SKU-b"]); assert.equal(first.reference.measurements.frameWidthMm, 140);
});

test("comparison uses millimetres only and returns deterministic closed relations and reference guidance", async () => {
  const smaller = await product("small", { measurements: { frameWidthMm: 136, lensWidthMm: 50, bridgeWidthMm: 17, lensHeightMm: 39, templeLengthMm: 140 } }); const same = await product("same", { measurements: MM }); const result = await evaluateFitIntelligence(await input([smaller, same]), BASE);
  assert.equal(result.status, "reference-guidance-available"); assert.equal(result.recommendations[0].sku, "SKU-same"); assert.equal(result.recommendations[0].weightedDistanceMilli, 0); assert.deepEqual(result.recommendations[0].relations, Object.fromEntries(FIT_DIMENSIONS.map((key) => [key, "comparable-to-reference"]))); assert.equal(result.guidanceText, FIT_REFERENCE_GUIDANCE_TEXT); assert.equal(result.recommendations[0].guidanceText, FIT_REFERENCE_GUIDANCE_TEXT); assert.equal(result.recommendations[0].physicalSuitabilityAssessed, false); assert.equal(result.recommendations[1].relations.frameWidthMm, "smaller-than-reference");
});

test("ranking is input-order independent, product-tuple/digest-tiebroken, capped, and excludes out-of-policy candidates", async () => {
  const values = await Promise.all(["a", "b", "c", "d", "e", "f"].map((name) => product(`top-${name}`, { measurements: { ...MM, lensWidthMm: 53 } }))); const outside = await product("outside", { measurements: { ...MM, frameWidthMm: 147 } }); const first = await evaluateFitIntelligence(await input([...values, outside]), BASE); const second = await evaluateFitIntelligence(await input([...values].reverse().concat(outside)), BASE);
  assert.deepEqual(first.recommendations, second.recommendations); assert.equal(first.recommendations.length, FIT_CANDIDATE_POLICY.topN); assert.deepEqual(first.recommendations.map((item) => item.rank), [1, 2, 3, 4, 5]); assert.deepEqual(first.recommendations.map((item) => item.sku), [...first.recommendations.map((item) => item.sku)].sort()); assert.equal(first.excludedCandidates.find((item) => item.sku === "SKU-outside").code, "candidate-outside-local-policy");
});

test("unverified reference routes manual/unavailable and unverified candidates are explicitly excluded", async () => {
  const verified = await product("verified"); const unverified = await product("unverified", { measurementVerification: "unverified" }); const unavailable = await evaluateFitIntelligence(await input([verified], { measurementVerification: "unverified" }), BASE); assert.equal(unavailable.status, "manual-or-unavailable"); assert.equal(unavailable.unavailableCode, "reference-measurements-unverified"); assert.equal(unavailable.recommendations.length, 0); assert.equal(unavailable.excludedCandidates[0].code, "reference-measurements-unverified");
  const available = await evaluateFitIntelligence(await input([unverified]), BASE); assert.equal(available.excludedCandidates[0].code, "candidate-measurements-unverified"); assert.equal(available.recommendations.length, 0);
});

test("input parsing rejects cross-tenant/site scope and cross-reference identity relabeling", async () => {
  for (const override of [{ tenantId: "tenant-b" }, { siteId: "site-b" }]) { const crossed = await product(`cross-${Object.keys(override)[0]}`, override); await assert.rejects(input([crossed]), /crosses input scope/); }
  const crossedReference = await product("cross-ref", { tenantId: "tenant-b" }); await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference: crossedReference, candidates: [] }), /reference crosses input scope/);
  const reference = await product("ref"); const relabelledSku = await product("other", { sku: reference.sku }); await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference, candidates: [relabelledSku] }), /relabelled/);
});

test("FrameModel measurement identity is stable while variant-specific source digests remain distinct", async () => {
  const reference = await product("ref"); const sibling = await product("sibling", { frameModelId: reference.frameModelId, measurementSetSha256: reference.measurementSetSha256, measurements: reference.measurements, measurementVerification: reference.measurementVerification, sourceSetSha256: H("z") });
  const accepted = await bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference, candidates: [sibling] }); assert.equal(accepted.candidates[0].frameModelId, reference.frameModelId); assert.notEqual(accepted.candidates[0].sourceSetSha256, reference.sourceSetSha256);
  for (const override of [{ measurements: { ...reference.measurements, frameWidthMm: 141 } }, { measurementSetSha256: H("y") }, { measurementVerification: "unverified" }]) { const changed = await product(`changed-${Object.keys(override)[0]}`, { frameModelId: reference.frameModelId, ...override }); await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference, candidates: [changed] }), /model measurement identity is relabelled/); }
});

test("relations exhaustively explain every dimension and closed codes label both comparable and different values", async () => {
  const changed = await product("changed-all", { measurements: { frameWidthMm: 144, lensWidthMm: 55, bridgeWidthMm: 21, lensHeightMm: 43, templeLengthMm: 151 } }); const result = await evaluateFitIntelligence(await input([changed]), BASE); const item = result.recommendations[0]; assert.deepEqual(Object.keys(item.relations), FIT_DIMENSIONS); assert.equal(item.explanationCodes.includes("frame-width-different"), true); assert.equal(item.explanationCodes.includes("lens-width-different"), true); assert.equal(item.explanationCodes.includes("bridge-width-different"), true); assert.equal(item.explanationCodes.includes("lens-height-different"), true); assert.equal(item.explanationCodes.includes("temple-length-different"), true);
});

test("exact reference digest and freshly redigested reference product are rejected before evaluation", async () => {
  const reference = await product("ref"); await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference, candidates: [reference] }), /exclude the exact reference/);
  const redigested = await product("different", { sku: reference.sku, frameModelId: reference.frameModelId, frameVariantId: reference.frameVariantId, sourceSetSha256: H("f") }); await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference, candidates: [redigested] }), /exclude the exact reference/);
});

test("missing, invalid, and implicitly converted measurements fail closed", async () => {
  const base = { schemaVersion: 1, type: "fit-intelligence.product-candidate", tenantId: "tenant-a", siteId: "site-a", environment: "production", sku: "SKU-x", frameModelId: "model-x", frameVariantId: "variant-x", measurementSetSha256: H("a"), sourceSetSha256: H("b"), measurementVerification: "verified-physical-mm", catalogBindingStatus: "exact-scope-candidate-unverified" };
  await assert.rejects(bindFitProductCandidate({ ...base, measurements: { ...MM, frameWidthMm: "140" } }), /explicit bounded millimetres/); const missing = { ...MM }; delete missing.bridgeWidthMm; await assert.rejects(bindFitProductCandidate({ ...base, measurements: missing }), /fields/); await assert.rejects(bindFitProductCandidate({ ...base, measurements: { ...MM, lensWidthMm: NaN } }), /explicit bounded/); await assert.rejects(bindFitProductCandidate({ ...base, measurements: { ...MM, bridgeWidthMm: 18.0009 } }), /three decimals/);
});

test("face-relative guidance and outcome measurement remain explicitly deferred without causal or physical claims", async () => {
  const result = await evaluateFitIntelligence(await input([await product("a")]), BASE); assert.deepEqual(result.faceRelativeWidthGuidance, { status: "deferred-calibrated-physical-device-evidence-required", available: false }); assert.deepEqual(result.outcomeMeasurement, { status: "pending-external", causalSemanticsDefined: false, measured: false, purchaseInferredFromInteraction: false }); assert.equal(result.evidenceStatus, "measurement-source-catalog-digest-references-unverified"); assert.deepEqual(result.authority, FIT_AUTHORITY_DENIALS); assert.equal(result.g7Ready, false); assert.equal(result.operationalStatus, "local-preparation-only");
});

test("contracts contain no photo, media, face geometry, person, user, session, URL, path, or free-form payload", async () => {
  const candidate = await product("privacy"); const value = await input([candidate]); const result = await evaluateFitIntelligence(value, BASE); const serialized = canonicalJson(result).toLowerCase(); for (const forbidden of ["image", "video", "landmark", "pose", "facegeometry", "userid", "sessionid", "url", "path", "freeform", "notes", "localraw:"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  for (const field of ["image", "media", "faceGeometry", "userId", "sessionId", "url", "path", "notes"]) { const forged = structuredClone(candidate); forged[field] = "forbidden"; await assert.rejects(input([forged]), /fields/); }
});

test("command is deterministic, bounded, replay-verified, and rejects redigested authority or recommendation escalation", async () => {
  const value = await input([await product("a")]); const first = await buildFitIntelligenceCommand(value, BASE); const second = await buildFitIntelligenceCommand(value, BASE); assert.deepEqual(first, second); assert.equal(first.commandIdempotencyKey, `ficv1_${first.commandSha256}`); assert.deepEqual(await verifyFitIntelligenceCommand(first), first); assert.deepEqual(await verifyFitIntelligenceEvaluation({ ...first, type: "fit-intelligence.local-evaluation", byteLength: undefined, commandSha256: undefined, commandIdempotencyKey: undefined }).catch((error) => error.name), "TypeError");
  for (const mutate of [(x) => { x.g7Ready = true; }, (x) => { x.authority.recommendationPublication = true; }, (x) => { x.recommendations[0].rank = 99; }, (x) => { x.outcomeMeasurement.measured = true; }]) { const forged = structuredClone(first); mutate(forged); await assert.rejects(verifyFitIntelligenceCommand(await redigestCommand(forged)), /inconsistent/); }
});

test("unknown/prototype/accessor/symbol/cycle/sparse/oversize and stale/future inputs fail closed", async () => {
  const value = await input([await product("a")]); assert.throws(() => parseFitIntelligenceInput({ ...value, unknown: true }), /fields/); await assert.rejects(evaluateFitIntelligence(Object.assign(Object.create({}), value), BASE), /plain/); let touched = false; const accessor = { ...value }; Object.defineProperty(accessor, "tenantId", { enumerable: true, get() { touched = true; return "tenant-a"; } }); await assert.rejects(evaluateFitIntelligence(accessor, BASE), /data properties/); assert.equal(touched, false); await assert.rejects(evaluateFitIntelligence({ ...value, [Symbol("x")]: true }, BASE), /symbols/); const cycle = { ...value }; cycle.reference = cycle; await assert.rejects(evaluateFitIntelligence(cycle, BASE), /acyclic/); const sparse = []; sparse.length = 1; await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference: value.reference, candidates: sparse }), /dense/); const oversized = Array.from({ length: 101 }, () => value.candidates[0]); await assert.rejects(bindFitIntelligenceInput({ schemaVersion: 1, type: "fit-intelligence.local-input", policyVersion: "g7-a-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", reference: value.reference, candidates: oversized }), /bounded/); await assert.rejects(evaluateFitIntelligence(value, "2026-08-11T11:59:59.999Z"), /future/); await assert.rejects(evaluateFitIntelligence(value, "2026-08-12T12:00:00.001Z"), /freshness/);
});

test("candidate, input, evaluation, and command snapshot mutable callers before digest awaits", async () => {
  const draft = { schemaVersion: 1, type: "fit-intelligence.product-candidate", tenantId: "tenant-a", siteId: "site-a", environment: "production", sku: "SKU-original", frameModelId: "model-original", frameVariantId: "variant-original", measurementSetSha256: H("a"), sourceSetSha256: H("b"), measurementVerification: "verified-physical-mm", measurements: { ...MM }, catalogBindingStatus: "exact-scope-candidate-unverified" }; const pendingCandidate = bindFitProductCandidate(draft); draft.sku = "SKU-mutated"; draft.measurements.frameWidthMm = 200; const candidate = await pendingCandidate; assert.equal(candidate.sku, "SKU-original"); assert.equal(candidate.measurements.frameWidthMm, 140);
  const value = await input([candidate]); const mutableInput = structuredClone(value); const pendingEvaluation = evaluateFitIntelligence(mutableInput, BASE); mutableInput.candidates[0].sku = "SKU-mutated"; assert.equal((await pendingEvaluation).recommendations[0].sku, "SKU-original"); const mutableCommandInput = structuredClone(value); const pendingCommand = buildFitIntelligenceCommand(mutableCommandInput, BASE); mutableCommandInput.candidates[0].candidateSha256 = H("0"); assert.equal((await pendingCommand).recommendations[0].sku, "SKU-original"); const command = structuredClone(await buildFitIntelligenceCommand(value, BASE)); const pendingVerify = verifyFitIntelligenceCommand(command); command.authority.g7Evidence = true; assert.equal((await pendingVerify).authority.g7Evidence, false);
});

async function redigestCommand(command) { const copy = structuredClone(command); const zero = "0".repeat(64); let length = copy.byteLength; for (let i = 0; i < 8; i += 1) { const projected = { ...copy, byteLength: length, commandSha256: zero, commandIdempotencyKey: `ficv1_${zero}` }; const next = new TextEncoder().encode(canonicalJson(projected)).byteLength; if (next === length) break; length = next; } const projected = { ...copy, byteLength: length, commandSha256: zero, commandIdempotencyKey: `ficv1_${zero}` }; const hash = await sha256Hex(canonicalJson(projected)); return { ...copy, byteLength: length, commandSha256: hash, commandIdempotencyKey: `ficv1_${hash}` }; }
