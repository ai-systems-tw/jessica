import assert from "node:assert/strict";
import test from "node:test";

import {
  bindGenerationJobEvent,
  deriveGenerationJobIdentity,
  parseGenerationJobEvent,
  parseGenerationJobRequest,
} from "../dist/packages/contracts/src/index.js";
import {
  ALLOWED_GENERATION_JOB_TRANSITIONS,
  appendGenerationJobEvent,
  createQueuedGenerationJobEvent,
  replayGenerationJobLedger as replayRaw,
} from "../dist/packages/generation-jobs/src/index.js";

const H = (digit) => digit.repeat(64);
function request(overrides = {}) {
  return {
    schemaVersion: 1, tenantId: "synthetic-tenant", frameModelId: "synthetic-model-not-j1m", method: "proxy-auto",
    generator: { id: "synthetic-proxy", version: "1.0.0-test", configSha256: H("a") },
    sourceAssetSha256s: [H("b"), H("c")], measurementSetSha256: H("d"), generatorInputSha256: H("e"),
    maxAttempts: 3, createdAt: "2026-08-11T00:00:00.000Z", ...overrides,
  };
}
const output = { manifestSha256: H("1"), modelSha256: H("2"), manifestByteLength: 123, modelByteLength: 456 };
const replay = (events, evaluatedAt = "2026-08-11T00:30:00Z") => replayRaw(events, { evaluatedAt });
async function start(input = request()) { const queued = await createQueuedGenerationJobEvent(input); return { events: [queued], state: await replay([queued]) }; }
async function add(context, eventType, occurredAt, payload) { const event = await appendGenerationJobEvent(context.state, eventType, occurredAt, payload); const events = [...context.events, event]; return { events, state: await replay(events), event }; }

test("processing identity is canonical across source ordering, submission time, and retry policy", async () => {
  const first = await deriveGenerationJobIdentity(request());
  const secondInput = request({ sourceAssetSha256s: [H("c"), H("b")], createdAt: "2026-08-12T01:02:03Z", maxAttempts: 9 });
  const second = await deriveGenerationJobIdentity(secondInput);
  assert.deepEqual(first.identity, second.identity);
  const changed = await deriveGenerationJobIdentity(request({ generatorInputSha256: H("f") }));
  assert.notEqual(changed.identity.canonicalInputSha256, first.identity.canonicalInputSha256);
});

test("request and event contracts reject malformed, unknown, noncanonical, and impossible input", async () => {
  const unknown = request(); unknown.future = true; assert.throws(() => parseGenerationJobRequest(unknown), /not allowed/);
  assert.throws(() => parseGenerationJobRequest(request({ createdAt: "2026-02-31T00:00:00Z" })), /real RFC 3339/);
  assert.throws(() => parseGenerationJobRequest(request({ method: "premium-magic" })), /unsupported/);
  const queued = await createQueuedGenerationJobEvent(request());
  assert.throws(() => parseGenerationJobEvent({ ...queued, future: true }), /not allowed/);
  assert.throws(() => parseGenerationJobEvent({ ...queued, eventType: "approved" }), /unsupported/);
});

test("happy replay derives queued, running, review, and completed state from immutable evidence", async () => {
  let context = await start();
  context = await add(context, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker-a", claimToken: "claim-a", leaseExpiresAt: "2026-08-11T00:01:00Z" });
  assert.equal(context.state.attempts, 1);
  context = await add(context, "output-recorded", "2026-08-11T00:00:10Z", { workerId: "worker-a", claimToken: "claim-a", output });
  assert.equal(context.state.status, "review");
  context = await add(context, "completed", "2026-08-11T00:00:11Z", { output });
  assert.equal(context.state.status, "completed");
  const after = await appendGenerationJobEvent(context.state, "cancelled", "2026-08-11T00:00:12Z", { workerId: null, claimToken: null, reasonCode: "late" });
  await assert.rejects(replay([...context.events, after]), /invalid from completed/);
});

test("claim ownership, lease contention, deterministic expiry recovery, and stale owners fail closed", async () => {
  let context = await start();
  context = await add(context, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker-a", claimToken: "claim-a", leaseExpiresAt: "2026-08-11T00:00:05Z" });
  const contention = await appendGenerationJobEvent(context.state, "output-recorded", "2026-08-11T00:00:02Z", { workerId: "worker-b", claimToken: "claim-b", output });
  await assert.rejects(replay([...context.events, contention]), /another worker/);
  const early = await appendGenerationJobEvent(context.state, "lease-recovered", "2026-08-11T00:00:04Z", { workerId: "worker-a", claimToken: "claim-a", expiredLeaseAt: "2026-08-11T00:00:05Z" });
  await assert.rejects(replay([...context.events, early]), /before expiry/);
  context = await add(context, "lease-recovered", "2026-08-11T00:00:05Z", { workerId: "worker-a", claimToken: "claim-a", expiredLeaseAt: "2026-08-11T00:00:05Z" });
  const stale = await appendGenerationJobEvent(context.state, "claimed", "2026-08-11T00:00:06Z", { workerId: "worker-b", claimToken: "claim-b", leaseExpiresAt: "2026-08-11T00:00:20Z" });
  context = { events: [...context.events, stale], state: await replay([...context.events, stale]) };
  const oldOwner = await appendGenerationJobEvent(context.state, "failed", "2026-08-11T00:00:07Z", { workerId: "worker-a", claimToken: "claim-a", errorCode: "old-owner", retryClassification: "retryable" });
  await assert.rejects(replay([...context.events, oldOwner]), /another worker/);
  assert.equal(context.state.attempts, 2);
});

test("only retryable failures below max attempts can retry", async () => {
  let retryable = await start();
  retryable = await add(retryable, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "claim-1", leaseExpiresAt: "2026-08-11T00:01:00Z" });
  retryable = await add(retryable, "failed", "2026-08-11T00:00:02Z", { workerId: "worker", claimToken: "claim-1", errorCode: "temporary", retryClassification: "retryable" });
  retryable = await add(retryable, "retry-queued", "2026-08-11T00:00:03Z", { failureEventSha256: retryable.event.eventSha256 });
  assert.equal(retryable.state.status, "queued");

  let terminal = await start();
  terminal = await add(terminal, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "claim-1", leaseExpiresAt: "2026-08-11T00:01:00Z" });
  terminal = await add(terminal, "failed", "2026-08-11T00:00:02Z", { workerId: "worker", claimToken: "claim-1", errorCode: "bad-input", retryClassification: "terminal" });
  const invalid = await appendGenerationJobEvent(terminal.state, "retry-queued", "2026-08-11T00:00:03Z", { failureEventSha256: terminal.event.eventSha256 });
  await assert.rejects(replay([...terminal.events, invalid]), /explicitly retryable/);

  let exhausted = await start(request({ maxAttempts: 1 }));
  exhausted = await add(exhausted, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "claim-1", leaseExpiresAt: "2026-08-11T00:01:00Z" });
  exhausted = await add(exhausted, "failed", "2026-08-11T00:00:02Z", { workerId: "worker", claimToken: "claim-1", errorCode: "temporary", retryClassification: "retryable" });
  const maxed = await appendGenerationJobEvent(exhausted.state, "retry-queued", "2026-08-11T00:00:03Z", { failureEventSha256: exhausted.event.eventSha256 });
  await assert.rejects(replay([...exhausted.events, maxed]), /maximum attempts/);
});

test("cancellation rules and immutable reviewed output are enforced", async () => {
  let queued = await start(); queued = await add(queued, "cancelled", "2026-08-11T00:00:01Z", { workerId: null, claimToken: null, reasonCode: "operator-request" }); assert.equal(queued.state.status, "cancelled");
  let running = await start(); running = await add(running, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "claim", leaseExpiresAt: "2026-08-11T00:01:00Z" });
  const unowned = await appendGenerationJobEvent(running.state, "cancelled", "2026-08-11T00:00:02Z", { workerId: null, claimToken: null, reasonCode: "unowned" });
  await assert.rejects(replay([...running.events, unowned]), /another worker/);
  running = await add(running, "output-recorded", "2026-08-11T00:00:03Z", { workerId: "worker", claimToken: "claim", output });
  const substituted = await appendGenerationJobEvent(running.state, "completed", "2026-08-11T00:00:04Z", { output: { ...output, modelSha256: H("3") } });
  await assert.rejects(replay([...running.events, substituted]), /immutable reviewed output/);
});

test("hash-chain replay rejects tamper, reorder, duplicate, relabel, cross-tenant substitution, and nonmonotonic time", async () => {
  let context = await start(); context = await add(context, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "claim", leaseExpiresAt: "2026-08-11T00:01:00Z" });
  const tampered = structuredClone(context.events); tampered[1].payload.workerId = "attacker";
  await assert.rejects(replay(tampered), /canonical event bytes/);
  await assert.rejects(replay([context.events[1], context.events[0]]), /begin with queued/);
  await assert.rejects(replay([...context.events, context.events[1]]), /duplicate/);
  const body = { ...context.events[1], tenantId: "other-tenant" }; delete body.eventSha256;
  const crossTenant = await bindGenerationJobEvent(body); await assert.rejects(replay([context.events[0], crossTenant]), /substitute job identity/);
  const relabeled = { ...context.events[1], eventType: "cancelled", payload: { workerId: null, claimToken: null, reasonCode: "relabel" } };
  await assert.rejects(replay([context.events[0], relabeled]), /canonical event bytes/);
  const staleTime = await appendGenerationJobEvent(context.state, "failed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "claim", errorCode: "same-time", retryClassification: "retryable" });
  await assert.rejects(replay([...context.events, staleTime]), /increase strictly/);
  assert.deepEqual(ALLOWED_GENERATION_JOB_TRANSITIONS.completed, []);
});

test("replay rejects future evidence and claim leases over the bounded maximum", async () => {
  const queued = await createQueuedGenerationJobEvent(request());
  await assert.rejects(replayRaw([queued], { evaluatedAt: "2026-08-10T23:59:59Z" }), /future event evidence/);
  let context = { events: [queued], state: await replay([queued]) };
  const boundary = await appendGenerationJobEvent(context.state, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "boundary", leaseExpiresAt: "2026-08-11T00:15:01Z" });
  assert.equal((await replayRaw([queued, boundary], { evaluatedAt: "2026-08-11T00:10:00Z" })).status, "running", "an observation horizon inside an active lease must preserve running state");
  const over = await appendGenerationJobEvent(context.state, "claimed", "2026-08-11T00:00:01Z", { workerId: "worker", claimToken: "over", leaseExpiresAt: "2026-08-11T00:15:01.001Z" });
  await assert.rejects(replay([queued, over]), /maximum duration/);
  await assert.rejects(replayRaw([queued, boundary], { evaluatedAt: "2026-08-11T00:00:00Z" }), /future event evidence/);
});
