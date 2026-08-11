import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_EXTERNAL_PREREQUISITES, SERVICE_READINESS_AUTHORITY_DENIALS,
  SERVICE_READINESS_MAX_USAGE_EVENTS, SERVICE_READINESS_MAX_URL_LENGTH, SERVICE_USAGE_UNITS, bindServiceReadinessProfile,
  bindServiceUsageEvent, canonicalJson, evaluateServiceReadinessContract,
  parseServiceReadinessProfile, sha256Hex, WIDGET_PROTOCOL, WIDGET_PROTOCOL_VERSION,
} from "../dist/packages/contracts/src/index.js";
import {
  appendLocalUsageEvent, buildServiceReadinessCommand, verifyServiceReadinessCommand,
} from "../dist/packages/service-readiness/src/index.js";

const BASE = "2026-08-11T12:00:00.000Z";
const at = (seconds) => new Date(Date.parse(BASE) + seconds * 1_000).toISOString();
const pending = () => Object.fromEntries(SERVICE_EXTERNAL_PREREQUISITES.map((key) => [key, "pending-external"]));
async function profile(overrides = {}) {
  return bindServiceReadinessProfile({ schemaVersion: 1, type: "service-readiness.profile", policyVersion: "g6-local-v1", createdAt: BASE, tenantId: "tenant-a", siteId: "site-a", environment: "production", parentOrigin: "https://shop.example", widgetOrigin: "https://widget.example", widgetPathPrefix: "/embed/v1", widgetUrl: "https://widget.example/embed/v1/widget.html", catalogOrigin: "https://api.example", assetOrigin: "https://assets.example", externalPrerequisites: pending(), profileStatus: "candidate-unverified-local-only", ...overrides });
}
async function ledger() {
  const item = await profile(); const first = await appendLocalUsageEvent(item, [], "usage-1", at(1), "widget-session-opened"); const second = await appendLocalUsageEvent(item, [first], "usage-2", at(2), "try-on-started"); const third = await appendLocalUsageEvent(item, [first, second], "usage-3", at(3), "catalog-selection-succeeded"); return { item, first, second, third, events: [first, second, third] };
}

test("profile is deterministic, tenant/site/production bound, and every external prerequisite stays pending", async () => {
  const first = await profile(); const second = await profile(); assert.deepEqual(first, second); assert.equal(first.profileId, `srp_${first.profileSha256}`); assert.equal(first.idempotencyKey, `srpv1_${first.profileSha256}`); assert.equal(first.environment, "production"); assert.equal(first.profileStatus, "candidate-unverified-local-only"); assert.deepEqual(first.externalPrerequisites, pending()); assert.equal(Object.isFrozen(first.externalPrerequisites), true);
  for (const key of SERVICE_EXTERNAL_PREREQUISITES) { const escalated = pending(); escalated[key] = "complete"; await assert.rejects(profile({ externalPrerequisites: escalated }), /cannot claim/); }
});

test("origins and hosted widget URL fail closed on wildcard, credentials, paths, suffix tricks, and cross-binding", async () => {
  const invalid = [
    { parentOrigin: "*" }, { parentOrigin: "http://shop.example" }, { parentOrigin: "https://user:pass@shop.example" }, { parentOrigin: "https://shop.example/path" }, { parentOrigin: "https://shop.example?x=1" }, { parentOrigin: "https://shop.example#x" }, { parentOrigin: "https://shop.example/" },
    { widgetOrigin: "https://shop.example" }, { widgetOrigin: "https://widget.example.evil" }, { widgetPathPrefix: "/embed/../admin" }, { widgetPathPrefix: "/embed/v1/" }, { widgetUrl: "https://widget.example/embed/v10/widget.html" }, { widgetUrl: "https://widget.example/embed/v1/widget.html?token=x" }, { widgetUrl: "https://user:pass@widget.example/embed/v1/widget.html" }, { catalogOrigin: "http://api.example" }, { catalogOrigin: "https://api.example/path" }, { catalogOrigin: "https://user:pass@api.example" }, { assetOrigin: "*" }, { assetOrigin: "https://assets.example?x=1" }, { assetOrigin: "https://assets.example/" },
  ];
  for (const override of invalid) await assert.rejects(profile(override), /HTTPS origin|cross-origin|path prefix|contained|widgetUrl/);
  await assert.rejects(profile({ widgetUrl: `https://widget.example/embed/v1/${"a".repeat(SERVICE_READINESS_MAX_URL_LENGTH)}` }), /bounded exact HTTPS URL/); await assert.rejects(profile({ parentOrigin: `https://${"a".repeat(SERVICE_READINESS_MAX_URL_LENGTH)}.example` }), /bounded exact HTTPS origin/);
});

test("deterministic embed requirements exactly compose with WidgetProtocol v1 and documented CSP/camera ownership", async () => {
  const item = await profile(); const evaluation = await evaluateServiceReadinessContract(item, [], BASE); const requirements = evaluation.embedRequirements;
  assert.equal(requirements.widgetProtocol, `${WIDGET_PROTOCOL}/v${WIDGET_PROTOCOL_VERSION}`); assert.equal(requirements.iframeSandbox, "allow-scripts allow-same-origin"); assert.equal(requirements.iframeAllow, "camera https://widget.example"); assert.match(requirements.parentCsp, /frame-src https:\/\/widget\.example/); assert.equal(requirements.parentPermissionsPolicy, 'camera=(self "https://widget.example"), microphone=(), geolocation=()'); assert.match(requirements.widgetCsp, /frame-ancestors https:\/\/shop\.example$/); assert.match(requirements.widgetCsp, /connect-src https:\/\/api\.example https:\/\/assets\.example/); assert.equal(requirements.userCameraGrantRequired, true); assert.equal(requirements.productionHeaderVerificationRequired, true); assert.equal(requirements.liveCrossBrowserVerificationRequired, true);
});

test("usage taxonomy is runtime-frozen, closed, one-occurrence, privacy-safe, and bounded", async () => {
  assert.equal(Object.isFrozen(SERVICE_USAGE_UNITS), true); assert.equal(Object.isFrozen(SERVICE_EXTERNAL_PREREQUISITES), true); assert.throws(() => SERVICE_USAGE_UNITS.push("image-uploaded"), TypeError); assert.deepEqual(SERVICE_USAGE_UNITS, ["catalog-selection-succeeded", "try-on-started", "widget-session-opened"]); const { item } = await ledger();
  await assert.rejects(bindServiceUsageEvent({ schemaVersion: 1, type: "service-readiness.usage-event", eventId: "bad", sequence: 1, occurredAt: at(1), previousEventSha256: null, profileSha256: item.profileSha256, tenantId: item.tenantId, siteId: item.siteId, environment: "production", parentOrigin: item.parentOrigin, unit: "capture-bytes", quantity: 1, sourceStatus: "local-candidate-unverified" }), /closed one-occurrence/);
  await assert.rejects(bindServiceUsageEvent({ schemaVersion: 1, type: "service-readiness.usage-event", eventId: "bad", sequence: 1, occurredAt: at(1), previousEventSha256: null, profileSha256: item.profileSha256, tenantId: item.tenantId, siteId: item.siteId, environment: "production", parentOrigin: item.parentOrigin, unit: "try-on-started", quantity: 2, sourceStatus: "local-candidate-unverified" }), /closed one-occurrence/);
  assert.equal(SERVICE_READINESS_MAX_USAGE_EVENTS, 256);
});

test("ledger summary is deterministic, non-billable, and carries no media, medical, error, price, or free-form fields", async () => {
  const state = await ledger(); const result = await evaluateServiceReadinessContract(state.item, state.events, at(3)); assert.deepEqual(result.usageSummary.counts, { "catalog-selection-succeeded": 1, "try-on-started": 1, "widget-session-opened": 1 }); assert.equal(result.usageSummary.totalUnits, 3); assert.equal(result.usageSummary.billable, false); assert.equal(result.usageSummary.pricingAttached, false); assert.equal(result.usageSummary.realUsageEvidence, false); assert.equal(result.usageSummary.meterStatus, "local-candidate-unverified-non-billable");
  const text = canonicalJson(result); for (const forbidden of ["image", "video", "landmark", "pose", "geometry", "captureRef", "rawError", "medical", "prescription", "invoice", "payment", "unitPrice", "freeForm", "notes"]) assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

test("ledger rejects duplicate, relabel, replay, reorder, stale/future, and tenant/site/origin substitution", async () => {
  const state = await ledger(); await assert.rejects(evaluateServiceReadinessContract(state.item, [state.first, state.first], at(3)), /replayed|sequence/); const relabel = structuredClone(state.first); relabel.eventId = "usage-relabelled"; await assert.rejects(evaluateServiceReadinessContract(state.item, [relabel], at(1)), /digest/); await assert.rejects(evaluateServiceReadinessContract(state.item, [state.second, state.first], at(3)), /head|sparse|reordered/); await assert.rejects(evaluateServiceReadinessContract(state.item, state.events, BASE), /future/); await assert.rejects(evaluateServiceReadinessContract(state.item, [state.first], at(86_402)), /freshness/);
  for (const [key, value] of [["tenantId", "tenant-b"], ["siteId", "site-b"], ["parentOrigin", "https://other.example"]]) { const forged = structuredClone(state.first); forged[key] = value; const rebound = await redigestEvent(forged); await assert.rejects(evaluateServiceReadinessContract(state.item, [rebound], at(1)), /substitutes profile scope/); }
});

test("profile freshness applies with an empty ledger and accepts the exact 24-hour boundary", async () => {
  const item = await profile(); assert.equal((await evaluateServiceReadinessContract(item, [], at(86_400))).evaluatedAt, at(86_400)); await assert.rejects(evaluateServiceReadinessContract(item, [], at(86_401)), /profile.*freshness/); await assert.rejects(buildServiceReadinessCommand(item, [], at(86_401)), /profile.*freshness/);
});

test("append validates its new event at its own horizon with exact monotonic and freshness bounds", async () => {
  const item = await profile(); const first = await appendLocalUsageEvent(item, [], "usage-1", at(1), "widget-session-opened"); await assert.rejects(appendLocalUsageEvent(item, [first], "usage-equal", at(1), "try-on-started"), /future, stale, or reordered/); await assert.rejects(appendLocalUsageEvent(item, [first], "usage-older", BASE, "try-on-started"), /future|reordered/); const boundary = await appendLocalUsageEvent(item, [], "usage-boundary", at(86_400), "widget-session-opened"); assert.equal(boundary.occurredAt, at(86_400)); await assert.rejects(appendLocalUsageEvent(item, [], "usage-too-late", at(86_401), "widget-session-opened"), /profile.*freshness/);
});

test("canonical command is stable/idempotent and denies every G6 and adjacent authority", async () => {
  const state = await ledger(); const first = await buildServiceReadinessCommand(state.item, state.events, at(3)); const second = await buildServiceReadinessCommand(state.item, state.events, at(3)); assert.deepEqual(first, second); assert.equal(first.commandIdempotencyKey, `srcv1_${first.commandSha256}`); assert.deepEqual(first.authority, SERVICE_READINESS_AUTHORITY_DENIALS); assert.equal(first.operationalStatus, "local-preparation-only"); assert.equal(first.g6Ready, false); assert.equal(first.serviceBoundary.supportSla, null); assert.equal(first.serviceBoundary.escalationChannel, null); assert.deepEqual(await verifyServiceReadinessCommand(first), first); assert.equal(Object.isFrozen(first), true);
});

test("redigested status, readiness, service boundary, summary, and authority escalation cannot pass replay", async () => {
  const state = await ledger(); const command = await buildServiceReadinessCommand(state.item, state.events, at(3)); const mutations = [
    (x) => { x.g6Ready = true; }, (x) => { x.operationalStatus = "production-ready"; }, (x) => { x.authority.tenantActivation = true; }, (x) => { x.authority.billing = true; }, (x) => { x.authority.g6Evidence = true; }, (x) => { x.serviceBoundary.supportSla = "24x7"; }, (x) => { x.usageSummary.billable = true; }, (x) => { x.embedRequirements.productionHeaderVerificationRequired = false; },
  ];
  for (const mutate of mutations) { const forged = structuredClone(command); mutate(forged); await assert.rejects(verifyServiceReadinessCommand(await redigestCommand(forged)), /cannot claim|authority|inconsistent/); }
});

test("unknown/prototype/accessor/symbol/cycle/sparse/oversize and invalid time inputs fail closed without getter execution", async () => {
  const item = await profile(); assert.throws(() => parseServiceReadinessProfile({ ...item, unknown: true }), /fields/); const proto = Object.assign(Object.create({}), item); await assert.rejects(evaluateServiceReadinessContract(proto, [], BASE), /plain/); let touched = false; const accessor = { ...item }; Object.defineProperty(accessor, "tenantId", { enumerable: true, get() { touched = true; return "tenant-a"; } }); await assert.rejects(evaluateServiceReadinessContract(accessor, [], BASE), /data properties/); assert.equal(touched, false); const symbolic = { ...item, [Symbol("secret")]: "x" }; await assert.rejects(evaluateServiceReadinessContract(symbolic, [], BASE), /symbols/); const cycle = { ...item }; cycle.externalPrerequisites = cycle; await assert.rejects(evaluateServiceReadinessContract(cycle, [], BASE), /acyclic/); const sparse = []; sparse.length = 1; await assert.rejects(evaluateServiceReadinessContract(item, sparse, BASE), /dense/); const nested = []; const nestedEvent = {}; Object.defineProperty(nestedEvent, "payload", { enumerable: true, get() { touched = true; return {}; } }); nested.push(nestedEvent); await assert.rejects(evaluateServiceReadinessContract(item, nested, BASE), /data properties/); assert.equal(touched, false); const oversized = Array.from({ length: 257 }, () => ({})); await assert.rejects(evaluateServiceReadinessContract(item, oversized, BASE), /bounded/); await assert.rejects(evaluateServiceReadinessContract(item, [], "2026-02-31T00:00:00.000Z"), /real canonical/);
});

test("profile, event, evaluation, and command snapshot hostile input before the first digest await", async () => {
  const mutable = { schemaVersion: 1, type: "service-readiness.profile", policyVersion: "g6-local-v1", createdAt: BASE, tenantId: "tenant-original", siteId: "site-a", environment: "production", parentOrigin: "https://shop.example", widgetOrigin: "https://widget.example", widgetPathPrefix: "/embed/v1", widgetUrl: "https://widget.example/embed/v1/widget.html", catalogOrigin: "https://api.example", assetOrigin: "https://assets.example", externalPrerequisites: pending(), profileStatus: "candidate-unverified-local-only" }; const pendingProfile = bindServiceReadinessProfile(mutable); mutable.tenantId = "tenant-mutated"; const item = await pendingProfile; assert.equal(item.tenantId, "tenant-original");
  const eventValue = { schemaVersion: 1, type: "service-readiness.usage-event", eventId: "usage-original", sequence: 1, occurredAt: at(1), previousEventSha256: null, profileSha256: item.profileSha256, tenantId: item.tenantId, siteId: item.siteId, environment: "production", parentOrigin: item.parentOrigin, unit: "widget-session-opened", quantity: 1, sourceStatus: "local-candidate-unverified" }; const pendingEvent = bindServiceUsageEvent(eventValue); eventValue.eventId = "usage-mutated"; const event = await pendingEvent; assert.equal(event.eventId, "usage-original");
  const profileInput = structuredClone(item); const ledgerInput = structuredClone([event]); const pendingEvaluation = evaluateServiceReadinessContract(profileInput, ledgerInput, at(1)); profileInput.tenantId = "tenant-mutated"; ledgerInput[0].tenantId = "tenant-mutated"; assert.equal((await pendingEvaluation).profile.tenantId, "tenant-original");
  const helperProfile = structuredClone(item); const helperLedger = structuredClone([event]); const pendingAppend = appendLocalUsageEvent(helperProfile, helperLedger, "usage-2", at(2), "try-on-started"); helperProfile.tenantId = "tenant-mutated"; helperLedger[0].eventSha256 = "0".repeat(64); const appended = await pendingAppend; assert.equal(appended.sequence, 2); assert.equal(appended.previousEventSha256, event.eventSha256); const forgedHead = structuredClone(event); forgedHead.previousEventSha256 = "a".repeat(64); const redigestedForgedHead = await redigestEvent(forgedHead); await assert.rejects(appendLocalUsageEvent(item, [redigestedForgedHead], "usage-2", at(2), "try-on-started"), /substitutes its head/);
  const command = structuredClone(await buildServiceReadinessCommand(item, [event], at(1))); const pendingVerification = verifyServiceReadinessCommand(command); command.usageSummary.totalUnits = 99; command.usageLedger[0].unit = "try-on-started"; assert.equal((await pendingVerification).usageSummary.totalUnits, 1);
});

async function redigestEvent(event) { const copy = structuredClone(event); delete copy.eventSha256; return bindServiceUsageEvent(copy); }
async function redigestCommand(command) { const copy = structuredClone(command); const zero = "0".repeat(64); let length = copy.byteLength; for (let index = 0; index < 8; index += 1) { const projected = { ...copy, byteLength: length, commandSha256: zero, commandIdempotencyKey: `srcv1_${zero}` }; const next = new TextEncoder().encode(canonicalJson(projected)).byteLength; if (next === length) break; length = next; } const projected = { ...copy, byteLength: length, commandSha256: zero, commandIdempotencyKey: `srcv1_${zero}` }; const hash = await sha256Hex(canonicalJson(projected)); return { ...copy, byteLength: length, commandSha256: hash, commandIdempotencyKey: `srcv1_${hash}` }; }
