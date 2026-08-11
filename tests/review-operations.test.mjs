import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_AUTHORITY_DENIALS, REVIEW_EVIDENCE_MAX_AGE_MS, REVIEW_FINDING_CATEGORIES, REVIEW_OUTCOMES,
  REVIEW_QUEUE_MAX_ITEMS, REVIEW_REASON_CODES,
  bindReviewEvidenceEvent, bindReviewWorkItem, canonicalJson, parseReviewEvidenceEvent, parseReviewQueueBuildInput,
  parseReviewQueueCommand, parseReviewQueueItem, parseReviewWorkItem, sha256Hex,
} from "../dist/packages/contracts/src/index.js";
import { buildReviewQueue, prepareReviewOperations, replayReviewEvidence } from "../dist/packages/review-operations/src/index.js";

const AS_OF = "2026-08-11T12:00:00.000Z";
const at = (delta = 0) => new Date(Date.parse(AS_OF) + delta).toISOString();
const digest = (character) => character.repeat(64);
function binding(name = "a", overrides = {}) {
  return {
    tenantId: "tenant-a", siteId: "site-a", environment: "production", sku: `sku-${name}`,
    frameModelId: `model-${name}`, frameVariantId: `variant-${name}`, jobId: `job-${name}`,
    canonicalInputSha256: digest("1"), generatorInputSha256: digest("2"), reviewHeadEventSha256: digest("3"),
    output: { manifestSha256: digest("4"), modelSha256: digest("5"), manifestByteLength: 100, modelByteLength: 200 },
    assetId: `asset-${name}`, assetVersion: 1, sourceEvidenceCandidateSha256: digest("6"), captureEvidenceCandidateSha256: digest("7"),
    demandQueueCommandCandidateSha256: digest("8"), batchCaptureLogCandidateSha256: digest("9"),
    provenanceStatus: "candidate-references-unverified", reviewPolicyVersion: "f3-local-v1", ...overrides,
  };
}
async function work(name = "a", overrides = {}) {
  return bindReviewWorkItem({ schemaVersion: 1, type: "review.work-item", workItemId: `work-${name}`, createdAt: at(-60_000), maxCorrectionAttempts: 2, binding: binding(name), ...overrides });
}
async function evidence(item, sequence, findings, options = {}) {
  return bindReviewEvidenceEvent({ schemaVersion: 1, type: "review.evidence", eventId: options.eventId ?? `event-${item.workItemId}-${sequence}`, sequence, occurredAt: options.occurredAt ?? at(-1_000 + sequence), previousEvidenceSha256: options.previousEvidenceSha256 ?? null, workItemSha256: item.workItemSha256, binding: options.binding ?? item.binding, correctionAttempt: sequence - 1, evaluatorId: "local-evaluator", evaluatorVersion: "1.0.0", evaluationAuthority: "local-candidate-unverified", findings, ...options.extra });
}
const input = (workItems, events, asOf = AS_OF) => ({ schemaVersion: 1, type: "review.queue-build", tenantId: "tenant-a", siteId: "site-a", environment: "production", asOf, workItems, evidence: events });

test("four closed outcomes are deterministic, severity ordered, immutable, and authority denying", async () => {
  const items = await Promise.all([work("auto"), work("correct"), work("manual"), work("reject")]);
  const events = await Promise.all([
    evidence(items[0], 1, []), evidence(items[1], 1, ["GEOMETRY_CORRECTION"]),
    evidence(items[2], 1, ["MATERIAL_HUMAN_JUDGMENT"]), evidence(items[3], 1, ["OUTPUT_INTEGRITY_FAILURE"]),
  ]);
  const first = await buildReviewQueue(input(items, events));
  const second = await buildReviewQueue(input([...items].reverse(), [...events].reverse()));
  assert.deepEqual(first.command, second.command);
  assert.deepEqual(first.command.items.map((item) => item.outcome), ["rejected", "manual-required", "correction-required", "auto-review-candidate"]);
  assert.deepEqual(first.command.authority, REVIEW_AUTHORITY_DENIALS); assert.equal(first.command.g5Ready, false); assert.equal(first.command.operationalStatus, "local-preparation-only");
  assert.equal(Object.isFrozen(first.command), true); assert.equal(Object.isFrozen(first.command.items[0].workItem.binding.output), true);
  const serialized = canonicalJson(first.command); for (const forbidden of ["localraw:", "userId", "sessionId", "camera", "biometric", "freeForm", "recommendedForLive\":true", "qaApproved\":true"]) assert.equal(serialized.includes(forbidden), false);
});

test("runtime allowlists are immutable and cannot admit injected findings, reasons, or outcomes", async () => {
  for (const allowlist of [REVIEW_FINDING_CATEGORIES, REVIEW_OUTCOMES, REVIEW_REASON_CODES]) {
    assert.equal(Object.isFrozen(allowlist), true); assert.throws(() => allowlist.push("INJECTED_RUNTIME_VALUE"), TypeError);
  }
  const item = await work("allowlist");
  await assert.rejects(evidence(item, 1, ["INJECTED_RUNTIME_VALUE"]), /finding is unsupported/);
  const valid = await evidence(item, 1, []); const command = (await buildReviewQueue(input([item], [valid]))).command;
  const injectedOutcome = structuredClone(command); injectedOutcome.items[0].outcome = "INJECTED_RUNTIME_VALUE"; await assert.rejects(parseReviewQueueCommand(await redigest(injectedOutcome)), /outcome is unsupported/);
  const injectedReason = structuredClone(command); injectedReason.items[0].reasons = ["INJECTED_RUNTIME_VALUE"]; await assert.rejects(parseReviewQueueCommand(await redigest(injectedReason)), /reason is unsupported/);
});

test("evaluator labels and findings remain explicitly unauthenticated local candidate evidence", async () => {
  const item = await work("evaluator-authority"); const candidate = await evidence(item, 1, [], { extra: { evaluatorId: "certified-human", evaluatorVersion: "authority-claim" } });
  assert.equal(candidate.evaluationAuthority, "local-candidate-unverified");
  await assert.rejects(evidence(item, 1, [], { extra: { evaluationAuthority: "authenticated-human-review" } }), /cannot claim evaluator authority/);
});

test("correction attempts are bounded and exhaustion routes to explicit later human authority", async () => {
  const item = await work("correction"); const first = await evidence(item, 1, ["GEOMETRY_CORRECTION"]);
  const second = await evidence(item, 2, ["ATTACHMENT_CORRECTION"], { previousEvidenceSha256: first.evidenceSha256 });
  const third = await evidence(item, 3, ["DIMENSIONS_CORRECTION"], { previousEvidenceSha256: second.evidenceSha256 });
  assert.equal((await replayReviewEvidence(item, [first], AS_OF)).outcome, "correction-required");
  const exhausted = await replayReviewEvidence(item, [first, second, third], AS_OF);
  assert.equal(exhausted.outcome, "manual-required"); assert.deepEqual(exhausted.reasons, ["CORRECTION_ATTEMPTS_EXHAUSTED", "DIMENSIONS_CORRECTION"]); assert.equal(exhausted.terminal, true);
  const fourth = await evidence({ ...item, maxCorrectionAttempts: 3 }, 4, [], { previousEvidenceSha256: third.evidenceSha256 });
  await assert.rejects(replayReviewEvidence(item, [first, second, third, fourth], AS_OF), /correction attempt|terminal|bounded/);
});

test("terminal rejection cannot continue, while a new generation and asset candidate is a distinct identity", async () => {
  const rejectedWork = await work("same"); const rejected = await evidence(rejectedWork, 1, ["IDENTITY_INTEGRITY_FAILURE"]);
  const later = await evidence(rejectedWork, 2, [], { previousEvidenceSha256: rejected.evidenceSha256 });
  await assert.rejects(replayReviewEvidence(rejectedWork, [rejected, later], AS_OF), /terminal/);
  const regeneratedWork = await work("regenerated", { binding: binding("same", { jobId: "job-new-generation", assetId: "asset-new-generation", assetVersion: 2 }) });
  const regenerated = await evidence(regeneratedWork, 1, []); const result = await buildReviewQueue(input([rejectedWork, regeneratedWork], [rejected, regenerated]));
  assert.deepEqual(result.command.items.map((item) => item.outcome), ["rejected", "auto-review-candidate"]);
});

test("replay is append-order sensitive and permits only an adjacent exact retry", async () => {
  const item = await work("replay"); const first = await evidence(item, 1, ["GEOMETRY_CORRECTION"]); const second = await evidence(item, 2, [], { previousEvidenceSha256: first.evidenceSha256 });
  const retry = await replayReviewEvidence(item, [first, first, second], AS_OF); assert.equal(retry.replayCount, 1); assert.equal(retry.outcome, "auto-review-candidate");
  await assert.rejects(replayReviewEvidence(item, [second, first], AS_OF), /sequence|chain/);
  await assert.rejects(replayReviewEvidence(item, [first, second, first], AS_OF), /adjacent/);
  const sparse = []; sparse.length = 1; await assert.rejects(replayReviewEvidence(item, sparse, AS_OF), /dense/);
});

test("freshness is inclusive and future or stale evidence fails in replay and durable commands", async () => {
  const createdAt = at(-REVIEW_EVIDENCE_MAX_AGE_MS); const item = await work("fresh", { createdAt }); const boundary = await evidence(item, 1, [], { occurredAt: createdAt });
  const built = await buildReviewQueue(input([item], [boundary])); assert.equal(built.command.items[0].freshness, "fresh");
  const staleItem = await work("stale", { createdAt: at(-REVIEW_EVIDENCE_MAX_AGE_MS - 1) }); const stale = await evidence(staleItem, 1, [], { occurredAt: staleItem.createdAt });
  await assert.rejects(buildReviewQueue(input([staleItem], [stale])), /stale/);
  const futureItem = await work("future"); const future = await evidence(futureItem, 1, [], { occurredAt: at(1) }); await assert.rejects(buildReviewQueue(input([futureItem], [future])), /future/);
  const futureCommand = structuredClone(built.command); futureCommand.asOf = at(-REVIEW_EVIDENCE_MAX_AGE_MS - 1); await assert.rejects(parseReviewQueueCommand(await redigest(futureCommand)), /future/);
  const staleCommand = structuredClone(built.command); staleCommand.asOf = at(1); await assert.rejects(parseReviewQueueCommand(await redigest(staleCommand)), /stale/);
});

async function rebindEvidence(value, mutate) { const copy = structuredClone(value); delete copy.evidenceSha256; mutate(copy); return bindReviewEvidenceEvent(copy); }
async function redigest(command) {
  const copy = structuredClone(command); const zero = "0".repeat(64); let length = copy.byteLength;
  for (let index = 0; index < 8; index += 1) { const projected = { ...copy, byteLength: length, commandSha256: zero, idempotencyKey: `rqv1_${zero}` }; const next = new TextEncoder().encode(canonicalJson(projected)).byteLength; if (next === length) break; length = next; }
  const projected = { ...copy, byteLength: length, commandSha256: zero, idempotencyKey: `rqv1_${zero}` }; const hash = await sha256Hex(canonicalJson(projected)); return { ...copy, byteLength: length, commandSha256: hash, idempotencyKey: `rqv1_${hash}` };
}

test("tenant/site/job/model/variant/asset/output and candidate-evidence relabels fail closed", async () => {
  const item = await work("identity"); const event = await evidence(item, 1, []);
  for (const mutate of [
    (value) => { value.binding.tenantId = "other"; }, (value) => { value.binding.siteId = "other"; }, (value) => { value.binding.jobId = "other"; },
    (value) => { value.binding.frameModelId = "other"; }, (value) => { value.binding.frameVariantId = "other"; }, (value) => { value.binding.assetVersion = 2; },
    (value) => { value.binding.output.modelSha256 = digest("a"); }, (value) => { value.binding.sourceEvidenceCandidateSha256 = digest("b"); },
  ]) await assert.rejects(buildReviewQueue(input([item], [await rebindEvidence(event, mutate)])), /binding is relabelled/);
  const relabelled = await work("identity-2", { binding: binding("identity", { frameModelId: "other-model", jobId: "job-other", assetId: "asset-other" }) }); const otherEvent = await evidence(relabelled, 1, []);
  await assert.rejects(buildReviewQueue(input([item, relabelled], [event, otherEvent])), /identity is relabelled/);
  assert.throws(() => parseReviewWorkItem({ ...item, binding: { ...item.binding, canonicalInputSha256: digest("0") } }), /all-zero/);
  assert.throws(() => parseReviewWorkItem({ ...item, workItemSha256: digest("0") }), /all-zero/);
  assert.throws(() => parseReviewEvidenceEvent({ ...event, evidenceSha256: digest("0") }), /all-zero/);
});

test("freshly redigested commands cannot escalate outcomes, relabel queue identities, or grant authority", async () => {
  const item = await work("command"); const event = await evidence(item, 1, ["GEOMETRY_CORRECTION"]); const built = await buildReviewQueue(input([item], [event]));
  for (const mutate of [
    (value) => { value.items[0].outcome = "auto-review-candidate"; value.items[0].severity = 0; value.items[0].reasons = ["AUTO_CHECKS_CLEAR"]; },
    (value) => { value.items[0].reasons = ["UNSUPPORTED_CONSTRUCTION"]; },
    (value) => { value.authority.qaApproved = true; },
  ]) { const changed = structuredClone(built.command); mutate(changed); await assert.rejects(parseReviewQueueCommand(await redigest(changed)), /inconsistent|authority/); }
  const second = await work("other"); const secondEvent = await evidence(second, 1, []); const two = await buildReviewQueue(input([item, second], [event, secondEvent]));
  const relabel = structuredClone(two.command); relabel.items[1].workItem.binding.sku = item.binding.sku; relabel.items[1].workItem.binding.frameVariantId = item.binding.frameVariantId; await assert.rejects(parseReviewQueueCommand(await redigest(relabel)), /digest|relabelled/);
});

async function combineCommands(left, right) { const combined = structuredClone(left); const second = structuredClone(right.items[0]); second.position = 2; combined.items.push(second); combined.itemCount = 2; return redigest(combined); }
test("durable command parser independently rejects validly hashed SKU and variant anti-relabels", async () => {
  const skuA = await work("map-a", { binding: binding("map-a", { sku: "sku-shared" }) }); const skuB = await work("map-b", { binding: binding("map-b", { sku: "sku-shared" }) }); const eventA = await evidence(skuA, 1, []); const eventB = await evidence(skuB, 1, []);
  const commandA = (await buildReviewQueue(input([skuA], [eventA]))).command; const commandB = (await buildReviewQueue(input([skuB], [eventB]))).command;
  await assert.rejects(parseReviewQueueCommand(await combineCommands(commandA, commandB)), /identity is relabelled/);
  const variantA = await work("variant-a", { binding: binding("variant-a", { frameVariantId: "variant-shared" }) }); const variantB = await work("variant-b", { binding: binding("variant-b", { frameVariantId: "variant-shared" }) }); const variantEventA = await evidence(variantA, 1, []); const variantEventB = await evidence(variantB, 1, []);
  const variantCommandA = (await buildReviewQueue(input([variantA], [variantEventA]))).command; const variantCommandB = (await buildReviewQueue(input([variantB], [variantEventB]))).command;
  await assert.rejects(parseReviewQueueCommand(await combineCommands(variantCommandA, variantCommandB)), /identity is relabelled/);
});

test("durable items self-verify the complete chain and reject orphan, tampered, or reordered heads", async () => {
  const item = await work("durable-chain"); const first = await evidence(item, 1, ["GEOMETRY_CORRECTION"]); const second = await evidence(item, 2, ["ATTACHMENT_CORRECTION"], { previousEvidenceSha256: first.evidenceSha256 }); const third = await evidence(item, 3, ["DIMENSIONS_CORRECTION"], { previousEvidenceSha256: second.evidenceSha256 });
  const built = await buildReviewQueue(input([item], [first, second, third])); assert.equal(built.command.items[0].evidenceChain.length, 3);
  const orphan = structuredClone(built.command); orphan.items[0].evidenceChain = [orphan.items[0].evidenceChain[2]]; await assert.rejects(parseReviewQueueCommand(await redigest(orphan)), /sequence|chain/);
  const reordered = structuredClone(built.command); reordered.items[0].evidenceChain = [reordered.items[0].evidenceChain[1], reordered.items[0].evidenceChain[0], reordered.items[0].evidenceChain[2]]; await assert.rejects(parseReviewQueueCommand(await redigest(reordered)), /sequence|chain/);
  const changedSecond = await rebindEvidence(second, (value) => { value.previousEvidenceSha256 = digest("a"); }); const tampered = structuredClone(built.command); tampered.items[0].evidenceChain[1] = changedSecond; await assert.rejects(parseReviewQueueCommand(await redigest(tampered)), /chain head/);
  const withRetry = await buildReviewQueue(input([item], [first, first, second, third])); assert.equal(withRetry.command.items[0].evidenceChain.length, 4); assert.equal((await parseReviewQueueCommand(withRetry.command)).items[0].evidenceChain.length, 4);
});

test("item and command parsers snapshot all caller data before asynchronous digest verification", async () => {
  const item = await work("async-snapshot"); const event = await evidence(item, 1, []); const built = await buildReviewQueue(input([item], [event]));
  const mutableItem = structuredClone(built.command.items[0]); const pendingItem = parseReviewQueueItem(mutableItem); mutableItem.outcome = "rejected"; mutableItem.severity = 3; mutableItem.reasons = ["OUTPUT_INTEGRITY_FAILURE"]; mutableItem.workItem.binding.sku = "mutated"; mutableItem.evidenceChain[0].occurredAt = at(1);
  const parsedItem = await pendingItem; assert.equal(parsedItem.outcome, "auto-review-candidate"); assert.equal(parsedItem.workItem.binding.sku, item.binding.sku); assert.equal(parsedItem.evidenceChain[0].occurredAt, event.occurredAt);
  const mutableCommand = structuredClone(built.command); const pendingCommand = parseReviewQueueCommand(mutableCommand); mutableCommand.asOf = at(1); mutableCommand.itemCount = 0; mutableCommand.byteLength = 1; mutableCommand.commandSha256 = digest("a"); mutableCommand.items[0].outcome = "rejected"; mutableCommand.items[0].workItem.binding.sku = "mutated";
  const parsedCommand = await pendingCommand; assert.equal(parsedCommand.asOf, AS_OF); assert.equal(parsedCommand.itemCount, 1); assert.equal(parsedCommand.commandSha256, built.command.commandSha256); assert.equal(parsedCommand.items[0].outcome, "auto-review-candidate");
});

test("hostile structures, budgets, TOCTOU aliases, and local port failures are contained", async () => {
  const item = await work("hostile"); const event = await evidence(item, 1, []); const value = input([item], [event]);
  assert.throws(() => parseReviewQueueBuildInput({ ...value, notes: "no" }), /fields/); assert.throws(() => parseReviewQueueBuildInput(Object.assign(Object.create({}), value)), /plain/);
  const symbolled = { ...value }; symbolled[Symbol("secret")] = true; assert.throws(() => parseReviewQueueBuildInput(symbolled), /symbols/);
  let touched = false; const accessor = { ...value }; Object.defineProperty(accessor, "evidence", { enumerable: true, get() { touched = true; return []; } }); assert.throws(() => parseReviewQueueBuildInput(accessor), /data properties/); assert.equal(touched, false);
  const sparse = { ...value, evidence: new Array(1) }; assert.throws(() => parseReviewQueueBuildInput(sparse), /dense/);
  assert.throws(() => parseReviewQueueBuildInput({ ...value, workItems: Array.from({ length: REVIEW_QUEUE_MAX_ITEMS + 1 }, () => item) }), /bounded/);
  const built = await buildReviewQueue(value); const mutable = structuredClone(built.command); const pending = parseReviewQueueCommand(mutable); mutable.items[0].workItem.binding.sku = "mutated"; assert.equal((await pending).items[0].workItem.binding.sku, item.binding.sku);
  const readValue = { schemaVersion: 1, type: "review.queue-build", tenantId: "tenant-a", siteId: "site-a", environment: "production", workItems: [item], evidence: [event] };
  const run = (overrides = {}) => prepareReviewOperations({ clock: overrides.clock ?? { now: () => new Date(AS_OF) }, reader: overrides.reader ?? { read: async () => readValue }, writer: overrides.writer ?? { write: async () => ({ status: "accepted" }) } });
  assert.equal((await run()).ok, true); assert.deepEqual(await run({ clock: { now: () => "bad" } }), { ok: false, code: "CLOCK_FAILED" }); assert.deepEqual(await run({ reader: { read: async () => { throw new Error("secret"); } } }), { ok: false, code: "READ_FAILED" }); assert.deepEqual(await run({ writer: { write: async () => ({ status: "rejected" }) } }), { ok: false, code: "WRITE_FAILED" });
});
