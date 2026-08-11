import test from "node:test";
import assert from "node:assert/strict";
import {
  COVERAGE_MAX_AGE_MS, DEMAND_QUEUE_MAX_ITEMS, DEMAND_WINDOW_MS, INVENTORY_MAX_AGE_MS, SALES_RANK_MAX_AGE_MS,
  adaptCatalogUnavailableDemand, adaptCommerceUnavailableDemand, buildDemandQueue, canonicalJson,
  parseDemandQueueBuildInput, parseDemandQueueCommand, parseUnavailableDemandEvidence, serializeDemandQueueCommand, sha256Hex,
} from "../dist/packages/contracts/src/index.js";
import { prepareDemandQueue } from "../dist/packages/demand-queue/src/index.js";

const AS_OF = "2026-08-11T12:00:00.000Z";
const at = (deltaMs = 0) => new Date(Date.parse(AS_OF) + deltaMs).toISOString();
const target = (sku, shape = "square", model = `model-${sku}`, variant = `variant-${sku}`) => ({ kind: "catalog-sku", sku, frameModelId: model, frameVariantId: variant, frameShape: shape });
const unresolved = (candidateId, shape = "round") => ({ kind: "unresolved-candidate", candidateId, frameShape: shape });
const evidence = (id, item, deltaMs = 0, correlationId = id) => ({ schemaVersion: 1, type: "demand.unavailable-evidence", evidenceId: id, correlationId, tenantId: "tenant-a", siteId: "site-a", environment: "production", occurredAt: at(deltaMs), target: item, reasonCode: "E2_REQUESTED_SKU_NOT_FOUND" });
const inventory = (id, item, options = {}) => ({ schemaVersion: 1, type: "demand.inventory-eligibility", snapshotId: id, tenantId: "tenant-a", siteId: "site-a", environment: "production", measuredAt: at(options.deltaMs ?? 0), target: item, continuity: options.continuity ?? "continuous", stock: options.stock ?? "in-stock" });
const rank = (id, item, value, deltaMs = 0) => ({ schemaVersion: 1, type: "demand.sales-rank", snapshotId: id, tenantId: "tenant-a", siteId: "site-a", environment: "production", measuredAt: at(deltaMs), target: item, rank: value });
const coverage = (id, shape, eligibleModelCount, targetModelCount, deltaMs = 0) => ({ schemaVersion: 1, type: "demand.frame-shape-coverage", snapshotId: id, tenantId: "tenant-a", siteId: "site-a", environment: "production", measuredAt: at(deltaMs), frameShape: shape, eligibleModelCount, targetModelCount });
const input = (values = {}) => ({ schemaVersion: 1, type: "demand.queue-build", tenantId: "tenant-a", siteId: "site-a", environment: "production", asOf: AS_OF, evidence: values.evidence ?? [], salesRanks: values.salesRanks ?? [], inventory: values.inventory ?? [], coverage: values.coverage ?? [] });

function catalogEvent(reasonCode = "REQUESTED_SKU_NOT_FOUND") {
  return { schemaVersion: 1, type: "catalog.asset-unavailable", occurredAt: "2026-08-11T12:00:00Z", requestId: "request-shared", tenantId: "tenant-a", siteId: "site-a", environment: "production", requestedSku: "sku-a", requestedFrameModelId: "model-sku-a", requestedFrameVariantId: "variant-sku-a", fallbackKind: "none", reasonCode };
}
function commerceError(code = "CATALOG_UNAVAILABLE", options = {}) {
  return { schemaVersion: 1, type: "commerce.error", occurredAt: options.occurredAt ?? AS_OF, sequence: 1, eventId: options.eventId ?? "event-a", requestId: options.requestId ?? "request-shared", tenantId: "tenant-a", siteId: "site-a", environment: options.environment ?? "production", sessionId: "session-a", product: options.product ?? null, payload: { code, class: code === "INTERNAL_FAILURE" ? "internal" : "catalog", recoverable: options.recoverable ?? true } };
}

test("E2 and E3 adapters accept only stable unavailable signals and share request correlation", async () => {
  const item = target("sku-a"); const e2 = adaptCatalogUnavailableDemand(catalogEvent(), "square");
  const e3 = adaptCommerceUnavailableDemand(commerceError("CATALOG_UNAVAILABLE", { occurredAt: at(1_000), eventId: "event-e3" }), unresolved("candidate-a"));
  assert.equal(e2.correlationId, "request-shared"); assert.equal(e3.correlationId, "request-shared");
  assert.equal(adaptCatalogUnavailableDemand(catalogEvent("DEPLOYMENT_REJECTED"), "square"), null);
  assert.equal(adaptCommerceUnavailableDemand(commerceError("INTERNAL_FAILURE"), unresolved("candidate-a")), null);
  assert.throws(() => adaptCommerceUnavailableDemand(commerceError("CATALOG_UNAVAILABLE", { environment: "staging" }), unresolved("candidate-a")), /production/);
  const product = { sku: item.sku, frameModelId: item.frameModelId, frameVariantId: item.frameVariantId, assetId: "asset-a", assetVersion: 1, deploymentId: "deployment-a", catalogSha256: "a".repeat(64), manifestSha256: "b".repeat(64), modelSha256: "c".repeat(64) };
  assert.throws(() => adaptCommerceUnavailableDemand(commerceError("ASSET_UNAVAILABLE", { product }), target("sku-other")), /relabels/);
  const e3Resolved = adaptCommerceUnavailableDemand(commerceError("ASSET_UNAVAILABLE", { product, eventId: "event-product", requestId: "request-product" }), item);
  assert.equal(e3Resolved.target.sku, "sku-a");

  const e3SameTarget = { ...e3Resolved, evidenceId: "e3:other", correlationId: e2.correlationId, occurredAt: at(-1_000), target: e2.target };
  const built = await buildDemandQueue(input({ evidence: [e3SameTarget, e2], inventory: [inventory("inv-a", e2.target)] }));
  assert.equal(built.command.items[0].demandCount, 1); assert.equal(built.replayCount, 1);
});

test("equal scores have stable oldest then canonical identity order under evidence reorder and replay", async () => {
  const a = target("sku-a"); const b = target("sku-b");
  const values = input({ evidence: [evidence("b1", b, -1_000), evidence("a1", a, -1_000), evidence("a1", a, -1_000)], inventory: [inventory("ib", b), inventory("ia", a)] });
  const first = await buildDemandQueue(values); const second = await buildDemandQueue({ ...values, evidence: [...values.evidence].reverse(), inventory: [...values.inventory].reverse() });
  assert.deepEqual(first.command, second.command); assert.equal(first.replayCount, 1); assert.deepEqual(first.command.items.map((item) => item.target.sku), ["sku-a", "sku-b"]);
});

test("demand is strictly dominant without a 100-count cap", async () => {
  const two = target("sku-two", "square"); const one = target("sku-one", "round");
  const result = await buildDemandQueue(input({ evidence: [evidence("t1", two), evidence("t2", two, -1), evidence("o1", one)], inventory: [inventory("it", two), inventory("io", one)], salesRanks: [rank("ro", one, 1)], coverage: [coverage("co", "round", 0, 1)] }));
  assert.deepEqual(result.command.items.map((item) => item.target.sku), ["sku-two", "sku-one"]); assert.equal(result.command.items[0].priorityScore, 2_000); assert.equal(result.command.items[1].priorityScore, 1_125);
  const hundred = target("sku-100"); const hundredOne = target("sku-101", "oval"); const manyEvidence = [];
  for (let index = 0; index < 100; index += 1) manyEvidence.push(evidence(`a${index}`, hundred, -index, `ca${index}`));
  for (let index = 0; index < 101; index += 1) manyEvidence.push(evidence(`b${index}`, hundredOne, -index, `cb${index}`));
  const many = await buildDemandQueue(input({ evidence: manyEvidence, inventory: [inventory("i100", hundred), inventory("i101", hundredOne)] }));
  assert.equal(many.command.items[0].target.sku, "sku-101"); assert.equal(many.command.items[0].priorityScore, 101_000); assert.equal(many.command.items[1].priorityScore, 100_000);
});

test("demand window and metric freshness boundaries are inclusive and stale immediately after", async () => {
  const a = target("sku-a");
  const boundary = await buildDemandQueue(input({ evidence: [evidence("at-window", a, -DEMAND_WINDOW_MS), evidence("before-window", a, -DEMAND_WINDOW_MS - 1)], inventory: [inventory("at-inventory", a, { deltaMs: -INVENTORY_MAX_AGE_MS })], salesRanks: [rank("at-rank", a, 1, -SALES_RANK_MAX_AGE_MS)], coverage: [coverage("at-coverage", "square", 0, 1, -COVERAGE_MAX_AGE_MS)] }));
  assert.equal(boundary.command.items[0].demandCount, 1); assert.equal(boundary.command.items[0].salesRankStatus, "fresh"); assert.equal(boundary.command.items[0].coverageStatus, "underrepresented");
  const staleInventory = await buildDemandQueue(input({ evidence: [evidence("e", a)], inventory: [inventory("stale-i", a, { deltaMs: -INVENTORY_MAX_AGE_MS - 1 })] }));
  assert.equal(staleInventory.command.itemCount, 0); assert.deepEqual(staleInventory.decisions[0].eligibilityReasons, ["INVENTORY_STALE"]);
  const staleMetrics = await buildDemandQueue(input({ evidence: [evidence("e", a)], inventory: [inventory("i", a)], salesRanks: [rank("r", a, 1, -SALES_RANK_MAX_AGE_MS - 1)], coverage: [coverage("c", "square", 0, 1, -COVERAGE_MAX_AGE_MS - 1)] }));
  assert.equal(staleMetrics.command.items[0].salesRankStatus, "stale"); assert.equal(staleMetrics.command.items[0].coverageStatus, "stale"); assert.equal(staleMetrics.command.items[0].priorityScore, 1_000);
  await assert.rejects(buildDemandQueue(input({ evidence: [evidence("future", a, 1)], inventory: [] })), /future/);
});

test("inventory missing, no-stock, unknown, and discontinuous candidates fail eligibility explicitly", async () => {
  const missing = target("missing"); const out = target("out"); const unknown = target("unknown"); const discontinuous = target("disc");
  const result = await buildDemandQueue(input({ evidence: [evidence("em", missing), evidence("eo", out), evidence("eu", unknown), evidence("ed", discontinuous)], inventory: [inventory("io", out, { stock: "out-of-stock" }), inventory("iu", unknown, { stock: "unknown", continuity: "unknown" }), inventory("id", discontinuous, { continuity: "discontinuous" })] }));
  assert.equal(result.command.itemCount, 0); const reasons = Object.fromEntries(result.decisions.map((decision) => [decision.target.sku, decision.eligibilityReasons]));
  assert.deepEqual(reasons.missing, ["INVENTORY_MISSING"]); assert.deepEqual(reasons.out, ["OUT_OF_STOCK"]); assert.deepEqual(reasons.unknown, ["CONTINUITY_UNKNOWN", "STOCK_UNKNOWN"]); assert.deepEqual(reasons.disc, ["DISCONTINUOUS"]);
});

test("missing and stale rank lower score while underrepresented coverage adds only its documented bonus", async () => {
  const under = target("under", "round"); const enough = target("enough", "square");
  const result = await buildDemandQueue(input({ evidence: [evidence("u", under), evidence("e", enough)], inventory: [inventory("iu", under), inventory("ie", enough)], coverage: [coverage("cu", "round", 1, 2), coverage("ce", "square", 2, 2)] }));
  assert.equal(result.command.items[0].target.sku, "under"); assert.equal(result.command.items[0].priorityScore, 1_025); assert.deepEqual(result.command.items[0].priorityReasons, ["DEMAND_COUNT", "SALES_RANK_MISSING", "SHAPE_UNDERREPRESENTED"]);
  assert.equal(result.command.items[1].priorityScore, 1_000); assert.equal(result.command.items[1].coverageStatus, "sufficient");
});

test("scope substitution, SKU/variant/candidate relabel, and snapshot conflicts fail closed", async () => {
  const a = target("sku-a"); const relabelled = target("sku-a", "round", "other-model", "other-variant");
  await assert.rejects(buildDemandQueue(input({ evidence: [evidence("a", a), evidence("b", relabelled)] })), /identity is relabelled/);
  const variantRelabel = target("other-sku", "round", "other-model", a.frameVariantId);
  await assert.rejects(buildDemandQueue(input({ evidence: [evidence("a", a)], inventory: [inventory("i", variantRelabel)] })), /identity is relabelled/);
  const candidateA = unresolved("candidate-a", "round"); const candidateRelabel = unresolved("candidate-a", "square");
  await assert.rejects(buildDemandQueue(input({ evidence: [evidence("a", candidateA)], salesRanks: [rank("r", candidateRelabel, 1)] })), /identity is relabelled/);
  await assert.rejects(buildDemandQueue(input({ evidence: [{ ...evidence("a", a), siteId: "site-b" }] })), /scope/);
  await assert.rejects(buildDemandQueue(input({ evidence: [evidence("a", a)], salesRanks: [rank("same", a, 1), rank("same", a, 2)] })), /snapshot identity is relabelled|conflicting/);
  await assert.rejects(buildDemandQueue(input({ evidence: [evidence("same", a), { ...evidence("same", a), target: target("sku-b") }] })), /identity is relabelled/);
});

test("strict parsers reject unknown, overflow, prototype, symbol, accessor, and sparse inputs without executing getters", async () => {
  const a = target("sku-a"); assert.throws(() => parseUnavailableDemandEvidence({ ...evidence("e", a), userId: "person" }), /fields/);
  assert.throws(() => parseDemandQueueBuildInput({ ...input(), evidence: new Array(1) }), /dense/);
  assert.throws(() => parseDemandQueueBuildInput(Object.assign(Object.create({ polluted: true }), input())), /plain/);
  const symbolled = input(); symbolled[Symbol("secret")] = "x"; assert.throws(() => parseDemandQueueBuildInput(symbolled), /symbols/);
  let getterCalls = 0; const hostile = input(); Object.defineProperty(hostile, "evidence", { enumerable: true, get() { getterCalls += 1; return []; } });
  assert.throws(() => parseDemandQueueBuildInput(hostile), /data properties/); assert.equal(getterCalls, 0);
  assert.throws(() => parseDemandQueueBuildInput(input({ salesRanks: [{ ...rank("r", a, 1), rank: Number.MAX_SAFE_INTEGER }] })), /bounded integer/);
  assert.throws(() => parseDemandQueueBuildInput(input({ evidence: Array.from({ length: 1_001 }, (_, index) => evidence(`e${index}`, a)) })), /bounded/);
});

async function redigest(command) {
  let byteLength = command.byteLength; const zero = "0".repeat(64);
  for (let iteration = 0; iteration < 8; iteration += 1) { const projected = { ...command, byteLength, commandSha256: zero, idempotencyKey: `dqv1_${zero}` }; const next = new TextEncoder().encode(canonicalJson(projected)).byteLength; if (next === byteLength) break; byteLength = next; }
  const projected = { ...command, byteLength, commandSha256: zero, idempotencyKey: `dqv1_${zero}` }; const digest = await sha256Hex(canonicalJson(projected)); return { ...command, byteLength, commandSha256: digest, idempotencyKey: `dqv1_${digest}` };
}

test("durable commands deeply parse, normalize, freeze, and reject validly redigested malicious items", async () => {
  const a = target("sku-a"); const built = await buildDemandQueue(input({ evidence: [evidence("e", a)], inventory: [inventory("i", a)] }));
  const mutable = JSON.parse(JSON.stringify(built.command)); const pending = parseDemandQueueCommand(mutable); mutable.items[0].priorityScore = 999_999; const parsed = await pending;
  assert.equal(parsed.items[0].priorityScore, 1_000); assert.equal(Object.isFrozen(parsed), true); assert.equal(Object.isFrozen(parsed.items), true); assert.equal(Object.isFrozen(parsed.items[0].target), true); assert.equal(Object.isFrozen(mutable.items[0].priorityReasons), false);
  const malicious = JSON.parse(JSON.stringify(built.command)); malicious.items[0].priorityScore = 1_001; await assert.rejects(parseDemandQueueCommand(await redigest(malicious)), /inconsistent/);
  const badReasons = JSON.parse(JSON.stringify(built.command)); badReasons.items[0].priorityReasons = ["DEMAND_COUNT", "SALES_RANK_FRESH", "SHAPE_COVERAGE_MISSING"]; await assert.rejects(parseDemandQueueCommand(await redigest(badReasons)), /inconsistent/);
  const outside = JSON.parse(JSON.stringify(built.command)); outside.items[0].firstDemandAt = new Date(Date.parse(outside.windowStart) - 1).toISOString(); outside.items[0].lastDemandAt = outside.items[0].firstDemandAt; await assert.rejects(parseDemandQueueCommand(await redigest(outside)), /time range/);
  const duplicate = JSON.parse(JSON.stringify(built.command)); duplicate.items.push({ ...duplicate.items[0], position: 2 }); duplicate.itemCount = 2; await assert.rejects(parseDemandQueueCommand(await redigest(duplicate)), /duplicate target/);
  const relabel = JSON.parse(JSON.stringify(built.command)); relabel.items.push({ ...duplicate.items[0], position: 2, target: { ...duplicate.items[0].target, frameModelId: "other-model", frameVariantId: "other-variant", frameShape: "round" } }); relabel.itemCount = 2; await assert.rejects(parseDemandQueueCommand(await redigest(relabel)), /identity is relabelled/);
  let calls = 0; const hostile = JSON.parse(JSON.stringify(built.command)); Object.defineProperty(hostile.items[0], "target", { enumerable: true, get() { calls += 1; return a; } }); await assert.rejects(parseDemandQueueCommand(hostile), /data properties/); assert.equal(calls, 0);
  const bytes = await serializeDemandQueueCommand(built.command); const serialized = new TextDecoder().decode(bytes);
  for (const forbidden of ["userId", "sessionId", "device", "biometric", "image", "landmark", "pose", "url", "rawError"]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(parsed.g5Ready, false); assert.equal(parsed.operationalStatus, "local-preparation-only");
});

test("queue and input sizes are bounded and capacity exclusion is explicit", async () => {
  const targets = Array.from({ length: DEMAND_QUEUE_MAX_ITEMS + 1 }, (_, index) => target(`sku-${index}`));
  const result = await buildDemandQueue(input({ evidence: targets.map((item, index) => evidence(`e-${index}`, item, 0, `c-${index}`)), inventory: targets.map((item, index) => inventory(`i-${index}`, item)) }));
  assert.equal(result.command.itemCount, DEMAND_QUEUE_MAX_ITEMS); assert.equal(result.decisions.filter((decision) => decision.queueStatus === "capacity-excluded").length, 1);
});

test("local preparation contains clock, read, build, write, and hostile port failures", async () => {
  const a = target("sku-a"); const readValue = { schemaVersion: 1, type: "demand.queue-build", tenantId: "tenant-a", siteId: "site-a", environment: "production", evidence: [evidence("e", a)], salesRanks: [], inventory: [inventory("i", a)], coverage: [] };
  const run = (overrides = {}) => prepareDemandQueue({ clock: overrides.clock ?? { now: () => new Date(AS_OF) }, reader: overrides.reader ?? { read: async () => readValue }, writer: overrides.writer ?? { write: async () => ({ status: "accepted" }) } });
  assert.equal((await run()).ok, true); assert.deepEqual(await run({ clock: { now: () => { throw new Error("secret"); } } }), { ok: false, code: "CLOCK_FAILED" });
  assert.deepEqual(await run({ reader: { read: async () => { throw new Error("secret"); } } }), { ok: false, code: "READ_FAILED" });
  assert.deepEqual(await run({ reader: { read: async () => ({ ...readValue, unknown: true }) } }), { ok: false, code: "BUILD_REJECTED" });
  let getterCalls = 0; const hostile = { ...readValue }; Object.defineProperty(hostile, "evidence", { enumerable: true, get() { getterCalls += 1; return []; } }); assert.deepEqual(await run({ reader: { read: async () => hostile } }), { ok: false, code: "BUILD_REJECTED" }); assert.equal(getterCalls, 0);
  assert.deepEqual(await run({ writer: { write: async () => { throw new Error("secret"); } } }), { ok: false, code: "WRITE_FAILED" });
  assert.deepEqual(await run({ writer: { write: async () => ({ status: "rejected" }) } }), { ok: false, code: "WRITE_FAILED" });
  assert.deepEqual(await run({ writer: { write: async () => ({ status: "accepted", extra: true }) } }), { ok: false, code: "WRITE_FAILED" });
  assert.deepEqual(await run({ writer: { write: async () => Object.assign(Object.create({ status: "accepted" }), {}) } }), { ok: false, code: "WRITE_FAILED" });
  let responseGetterCalls = 0; const response = {}; Object.defineProperty(response, "status", { enumerable: true, get() { responseGetterCalls += 1; return "accepted"; } }); assert.deepEqual(await run({ writer: { write: async () => response } }), { ok: false, code: "WRITE_FAILED" }); assert.equal(responseGetterCalls, 0);
});

test("command idempotency intentionally coalesces equivalent output and is not source-evidence provenance", async () => {
  const a = target("sku-a"); const first = await buildDemandQueue(input({ evidence: [evidence("e1", a)], inventory: [inventory("i1", a)] }));
  const secondEvidence = { ...evidence("different-evidence", a), reasonCode: "E3_ASSET_UNAVAILABLE", correlationId: "different-correlation" };
  const second = await buildDemandQueue(input({ evidence: [secondEvidence], inventory: [inventory("different-inventory", a)] }));
  assert.equal(first.command.commandSha256, second.command.commandSha256); assert.equal(first.command.idempotencyKey, second.command.idempotencyKey);
});
