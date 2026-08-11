import { canonicalJson, sha256Hex } from "./generationJob.js";
import { WIDGET_PROTOCOL, WIDGET_PROTOCOL_VERSION } from "./widgetProtocol.js";

export const SERVICE_READINESS_POLICY_VERSION = "g6-local-v1" as const;
export const SERVICE_READINESS_MAX_USAGE_EVENTS = 256;
export const SERVICE_READINESS_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const SERVICE_READINESS_MAX_COMMAND_BYTES = 262_144;
export const SERVICE_READINESS_MAX_URL_LENGTH = 2_048;
export const SERVICE_USAGE_UNITS = Object.freeze([
  "catalog-selection-succeeded",
  "try-on-started",
  "widget-session-opened",
] as const);
export const SERVICE_EXTERNAL_PREREQUISITES = Object.freeze([
  "authenticated-tenant-authority",
  "billing-pricing-authority",
  "continuous-self-operation-evidence",
  "legal-ip-review",
  "production-delivery-headers",
  "real-usage-evidence",
  "signed-onboarding-authority",
  "support-staffing",
] as const);
export type ServiceUsageUnit = (typeof SERVICE_USAGE_UNITS)[number];
export type ServiceExternalPrerequisite = (typeof SERVICE_EXTERNAL_PREREQUISITES)[number];

export type ServiceReadinessProfile = Readonly<{
  schemaVersion: 1;
  type: "service-readiness.profile";
  profileId: string;
  idempotencyKey: string;
  policyVersion: typeof SERVICE_READINESS_POLICY_VERSION;
  createdAt: string;
  tenantId: string;
  siteId: string;
  environment: "production";
  parentOrigin: string;
  widgetOrigin: string;
  widgetPathPrefix: string;
  widgetUrl: string;
  catalogOrigin: string;
  assetOrigin: string;
  externalPrerequisites: Readonly<Record<ServiceExternalPrerequisite, "pending-external">>;
  profileStatus: "candidate-unverified-local-only";
  profileSha256: string;
}>;

export type ServiceUsageEvent = Readonly<{
  schemaVersion: 1;
  type: "service-readiness.usage-event";
  eventId: string;
  sequence: number;
  occurredAt: string;
  previousEventSha256: string | null;
  profileSha256: string;
  tenantId: string;
  siteId: string;
  environment: "production";
  parentOrigin: string;
  unit: ServiceUsageUnit;
  quantity: 1;
  sourceStatus: "local-candidate-unverified";
  eventSha256: string;
}>;

export type ServiceReadinessAuthorityDenials = Readonly<{
  tenantProvisioning: false;
  tenantActivation: false;
  originAuthorization: false;
  authenticatedTenantAuthority: false;
  billing: false;
  invoicing: false;
  pricing: false;
  publication: false;
  deployment: false;
  productionHeaders: false;
  supportSla: false;
  legalApproval: false;
  signedOnboarding: false;
  g1Evidence: false;
  g2Evidence: false;
  g5Evidence: false;
  g6Evidence: false;
}>;

export const SERVICE_READINESS_AUTHORITY_DENIALS: ServiceReadinessAuthorityDenials = Object.freeze({
  tenantProvisioning: false,
  tenantActivation: false,
  originAuthorization: false,
  authenticatedTenantAuthority: false,
  billing: false,
  invoicing: false,
  pricing: false,
  publication: false,
  deployment: false,
  productionHeaders: false,
  supportSla: false,
  legalApproval: false,
  signedOnboarding: false,
  g1Evidence: false,
  g2Evidence: false,
  g5Evidence: false,
  g6Evidence: false,
});

export type ServiceEmbedRequirements = Readonly<{
  requirementStatus: "candidate-requirements-unverified";
  exactBindingsRequired: true;
  widgetProtocol: "jessica-widget/v1";
  iframeSandbox: "allow-scripts allow-same-origin";
  iframeAllow: string;
  parentCsp: string;
  parentPermissionsPolicy: string;
  widgetCsp: string;
  widgetPermissionsPolicy: "camera=(self), microphone=(), geolocation=()";
  userCameraGrantRequired: true;
  productionHeaderVerificationRequired: true;
  liveCrossBrowserVerificationRequired: true;
}>;

export type ServiceUsageSummary = Readonly<{
  meterStatus: "local-candidate-unverified-non-billable";
  eventCount: number;
  totalUnits: number;
  counts: Readonly<Record<ServiceUsageUnit, number>>;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  headEventSha256: string | null;
  maxEvents: typeof SERVICE_READINESS_MAX_USAGE_EVENTS;
  pricingAttached: false;
  billable: false;
  realUsageEvidence: false;
}>;

export type ServiceBoundary = Readonly<{
  status: "candidate-boundary-unverified";
  locallyPreparatory: readonly ["embed-requirements-review", "protocol-fixture-review", "usage-contract-replay"];
  externallyRequired: readonly ["legal-ip-decision", "production-operations", "signed-tenant-onboarding", "staffed-support", "billing-and-pricing"];
  supportSla: null;
  escalationChannel: null;
}>;

export type ServiceReadinessEvaluation = Readonly<{
  schemaVersion: 1;
  type: "service-readiness.local-evaluation";
  profile: ServiceReadinessProfile;
  embedRequirements: ServiceEmbedRequirements;
  usageLedger: readonly ServiceUsageEvent[];
  usageSummary: ServiceUsageSummary;
  serviceBoundary: ServiceBoundary;
  evaluatedAt: string;
  operationalStatus: "local-preparation-only";
  g6Ready: false;
  authority: ServiceReadinessAuthorityDenials;
}>;

export type ServiceReadinessCommand = Readonly<Omit<ServiceReadinessEvaluation, "type"> & {
  type: "service-readiness.local-command";
  byteLength: number;
  commandSha256: string;
  commandIdempotencyKey: string;
}>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ZERO = "0".repeat(64);
const MIN_TIME = Date.parse("2020-01-01T00:00:00.000Z");
const MAX_TIME = Date.parse("2100-01-01T00:00:00.000Z");

function plain(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label} must contain enumerable data properties only`);
}
function dense(value: unknown, maximum: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.keys(value).length !== value.length) throw new TypeError(`${label} must be a bounded dense standard array`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} must not contain symbols`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new TypeError(`${label} must contain data properties only`);
}
function tree(value: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (value === null || typeof value !== "object") return;
  if (depth > 12 || seen.has(value)) throw new TypeError("service readiness input must be an acyclic bounded data tree");
  seen.add(value);
  if (Array.isArray(value)) dense(value, SERVICE_READINESS_MAX_USAGE_EVENTS, "service readiness array"); else plain(value, "service readiness object");
  for (const item of Object.values(value as Record<string, unknown>)) tree(item, seen, depth + 1);
  seen.delete(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError(`${label} fields are invalid`);
}
function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || /^(?:https?|file|localraw):/i.test(value)) throw new TypeError(`${label} must be a bounded non-resource identifier`);
}
function digest(value: unknown, label: string, allowZero = false): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value) || (!allowZero && value === ZERO)) throw new TypeError(`${label} must be a nonzero lowercase SHA-256 digest`);
}
function integer(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(`${label} must be a bounded integer`);
}
function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a millisecond UTC timestamp`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || epoch < MIN_TIME || epoch > MAX_TIME || new Date(epoch).toISOString() !== value) throw new TypeError(`${label} must be a real canonical UTC instant`);
}
function exactHttpsOrigin(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > SERVICE_READINESS_MAX_URL_LENGTH) throw new TypeError(`${label} must be a bounded exact HTTPS origin`);
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an exact HTTPS origin`); }
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value || url.pathname !== "/" || url.search || url.hash) throw new TypeError(`${label} must be a canonical HTTPS origin without credentials, path, query, fragment, or trailing slash`);
  return value;
}
function exactPathPrefix(value: unknown): string {
  if (typeof value !== "string" || !/^\/[A-Za-z0-9._~/-]{1,127}$/.test(value) || value.endsWith("/") || value.includes("//") || value.split("/").some((part) => part === "." || part === "..")) throw new TypeError("widgetPathPrefix must be a canonical absolute path prefix");
  return value;
}
function containedWidgetUrl(value: unknown, origin: string, prefix: string): string {
  if (typeof value !== "string" || value.length > SERVICE_READINESS_MAX_URL_LENGTH) throw new TypeError("widgetUrl must be a bounded exact HTTPS URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("widgetUrl must be an exact HTTPS URL"); }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash || url.href !== value || (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) throw new TypeError("widgetUrl must be canonical, credential-free, query-free, fragment-free, and contained by widgetPathPrefix");
  return value;
}
function prerequisites(value: unknown): Readonly<Record<ServiceExternalPrerequisite, "pending-external">> {
  plain(value, "external prerequisites"); exact(value, SERVICE_EXTERNAL_PREREQUISITES, "external prerequisites");
  for (const key of SERVICE_EXTERNAL_PREREQUISITES) if (value[key] !== "pending-external") throw new TypeError("external prerequisites cannot claim local completion");
  return Object.freeze(Object.fromEntries(SERVICE_EXTERNAL_PREREQUISITES.map((key) => [key, "pending-external"])) as Record<ServiceExternalPrerequisite, "pending-external">);
}

function parseProfileInternal(value: unknown, sentinel: boolean): ServiceReadinessProfile {
  tree(value); plain(value, "service readiness profile");
  exact(value, ["schemaVersion", "type", "profileId", "idempotencyKey", "policyVersion", "createdAt", "tenantId", "siteId", "environment", "parentOrigin", "widgetOrigin", "widgetPathPrefix", "widgetUrl", "catalogOrigin", "assetOrigin", "externalPrerequisites", "profileStatus", "profileSha256"], "service readiness profile");
  if (value.schemaVersion !== 1 || value.type !== "service-readiness.profile" || value.policyVersion !== SERVICE_READINESS_POLICY_VERSION) throw new TypeError("service readiness profile version, type, or policy is unsupported");
  identifier(value.profileId, "profileId"); identifier(value.idempotencyKey, "profile idempotencyKey"); timestamp(value.createdAt, "profile createdAt"); identifier(value.tenantId, "profile tenantId"); identifier(value.siteId, "profile siteId");
  if (value.environment !== "production") throw new TypeError("service readiness profile environment must be production");
  const parentOrigin = exactHttpsOrigin(value.parentOrigin, "parentOrigin"); const widgetOrigin = exactHttpsOrigin(value.widgetOrigin, "widgetOrigin");
  if (parentOrigin === widgetOrigin) throw new TypeError("hosted widget must remain cross-origin from its parent");
  const widgetPathPrefix = exactPathPrefix(value.widgetPathPrefix); const widgetUrl = containedWidgetUrl(value.widgetUrl, widgetOrigin, widgetPathPrefix);
  const catalogOrigin = exactHttpsOrigin(value.catalogOrigin, "catalogOrigin"); const assetOrigin = exactHttpsOrigin(value.assetOrigin, "assetOrigin");
  if (value.profileStatus !== "candidate-unverified-local-only") throw new TypeError("service readiness profile cannot claim verification"); digest(value.profileSha256, "profile digest", sentinel);
  return Object.freeze({ schemaVersion: 1, type: "service-readiness.profile", profileId: value.profileId, idempotencyKey: value.idempotencyKey, policyVersion: SERVICE_READINESS_POLICY_VERSION, createdAt: value.createdAt, tenantId: value.tenantId, siteId: value.siteId, environment: "production", parentOrigin, widgetOrigin, widgetPathPrefix, widgetUrl, catalogOrigin, assetOrigin, externalPrerequisites: prerequisites(value.externalPrerequisites), profileStatus: "candidate-unverified-local-only", profileSha256: value.profileSha256 as string });
}
export function parseServiceReadinessProfile(value: unknown): ServiceReadinessProfile { return parseProfileInternal(value, false); }
function profileBody(profile: ServiceReadinessProfile): unknown { const { profileId: _profileId, idempotencyKey: _key, profileSha256: _digest, ...body } = profile; return body; }
export async function bindServiceReadinessProfile(value: Omit<ServiceReadinessProfile, "profileId" | "idempotencyKey" | "profileSha256">): Promise<ServiceReadinessProfile> {
  tree(value); const snapshot = structuredClone(value); const parsed = parseProfileInternal({ ...snapshot, profileId: "pending", idempotencyKey: "pending", profileSha256: ZERO }, true); const profileSha256 = await sha256Hex(canonicalJson(profileBody(parsed))); return Object.freeze({ ...parsed, profileId: `srp_${profileSha256}`, idempotencyKey: `srpv1_${profileSha256}`, profileSha256 });
}
export async function verifyServiceReadinessProfile(value: unknown): Promise<ServiceReadinessProfile> {
  const parsed = parseServiceReadinessProfile(value); const profileSha256 = await sha256Hex(canonicalJson(profileBody(parsed))); if (profileSha256 !== parsed.profileSha256 || parsed.profileId !== `srp_${profileSha256}` || parsed.idempotencyKey !== `srpv1_${profileSha256}`) throw new TypeError("service readiness profile digest or identity is inconsistent"); return parsed;
}

function parseUsageEventInternal(value: unknown, sentinel: boolean): ServiceUsageEvent {
  tree(value); plain(value, "service usage event"); exact(value, ["schemaVersion", "type", "eventId", "sequence", "occurredAt", "previousEventSha256", "profileSha256", "tenantId", "siteId", "environment", "parentOrigin", "unit", "quantity", "sourceStatus", "eventSha256"], "service usage event");
  if (value.schemaVersion !== 1 || value.type !== "service-readiness.usage-event") throw new TypeError("service usage event version or type is unsupported"); identifier(value.eventId, "usage eventId"); integer(value.sequence, 1, SERVICE_READINESS_MAX_USAGE_EVENTS, "usage sequence"); timestamp(value.occurredAt, "usage occurredAt"); if (value.previousEventSha256 !== null) digest(value.previousEventSha256, "usage prior digest"); digest(value.profileSha256, "usage profile digest"); identifier(value.tenantId, "usage tenantId"); identifier(value.siteId, "usage siteId"); if (value.environment !== "production") throw new TypeError("usage environment must be production"); const parentOrigin = exactHttpsOrigin(value.parentOrigin, "usage parentOrigin"); if (!SERVICE_USAGE_UNITS.includes(value.unit as ServiceUsageUnit) || value.quantity !== 1 || value.sourceStatus !== "local-candidate-unverified") throw new TypeError("usage unit must remain a closed one-occurrence local candidate"); digest(value.eventSha256, "usage event digest", sentinel);
  return Object.freeze({ schemaVersion: 1, type: "service-readiness.usage-event", eventId: value.eventId, sequence: value.sequence, occurredAt: value.occurredAt, previousEventSha256: value.previousEventSha256 as string | null, profileSha256: value.profileSha256 as string, tenantId: value.tenantId, siteId: value.siteId, environment: "production", parentOrigin, unit: value.unit as ServiceUsageUnit, quantity: 1, sourceStatus: "local-candidate-unverified", eventSha256: value.eventSha256 as string });
}
export function parseServiceUsageEvent(value: unknown): ServiceUsageEvent { return parseUsageEventInternal(value, false); }
export async function bindServiceUsageEvent(value: Omit<ServiceUsageEvent, "eventSha256">): Promise<ServiceUsageEvent> { tree(value); const snapshot = structuredClone(value); const parsed = parseUsageEventInternal({ ...snapshot, eventSha256: ZERO }, true); const { eventSha256: _, ...body } = parsed; return Object.freeze({ ...body, eventSha256: await sha256Hex(canonicalJson(body)) }); }
export async function verifyServiceUsageEvent(value: unknown): Promise<ServiceUsageEvent> { const parsed = parseServiceUsageEvent(value); const { eventSha256, ...body } = parsed; if (await sha256Hex(canonicalJson(body)) !== eventSha256) throw new TypeError("service usage event digest is inconsistent"); return parsed; }

function embedRequirements(profile: ServiceReadinessProfile): ServiceEmbedRequirements {
  return Object.freeze({
    requirementStatus: "candidate-requirements-unverified", exactBindingsRequired: true, widgetProtocol: `${WIDGET_PROTOCOL}/v${WIDGET_PROTOCOL_VERSION}`, iframeSandbox: "allow-scripts allow-same-origin", iframeAllow: `camera ${profile.widgetOrigin}`,
    parentCsp: `default-src 'self'; frame-src ${profile.widgetOrigin}; connect-src 'self'; worker-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`,
    parentPermissionsPolicy: `camera=(self \"${profile.widgetOrigin}\"), microphone=(), geolocation=()`,
    widgetCsp: `default-src 'none'; frame-src 'none'; connect-src ${profile.catalogOrigin} ${profile.assetOrigin}; worker-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${profile.parentOrigin}`,
    widgetPermissionsPolicy: "camera=(self), microphone=(), geolocation=()", userCameraGrantRequired: true, productionHeaderVerificationRequired: true, liveCrossBrowserVerificationRequired: true,
  });
}
const SERVICE_BOUNDARY: ServiceBoundary = Object.freeze({ status: "candidate-boundary-unverified", locallyPreparatory: Object.freeze(["embed-requirements-review", "protocol-fixture-review", "usage-contract-replay"] as const), externallyRequired: Object.freeze(["legal-ip-decision", "production-operations", "signed-tenant-onboarding", "staffed-support", "billing-and-pricing"] as const), supportSla: null, escalationChannel: null });

export async function evaluateServiceReadinessContract(profileValue: unknown, eventValues: readonly unknown[], evaluatedAt: string): Promise<ServiceReadinessEvaluation> {
  tree(profileValue); tree(eventValues); dense(eventValues, SERVICE_READINESS_MAX_USAGE_EVENTS, "service usage ledger"); timestamp(evaluatedAt, "service readiness evaluatedAt"); const profileSnapshot = structuredClone(profileValue); const eventSnapshots = structuredClone(eventValues); const profile = await verifyServiceReadinessProfile(profileSnapshot); const events = await Promise.all(eventSnapshots.map(verifyServiceUsageEvent)); const horizon = Date.parse(evaluatedAt); const created = Date.parse(profile.createdAt); if (created > horizon) throw new TypeError("service readiness profile is future-dated"); if (horizon - created > SERVICE_READINESS_MAX_AGE_MS) throw new TypeError("service readiness profile is outside the local freshness bound");
  const ids = new Map<string, string>(); const digests = new Set<string>(); let prior: ServiceUsageEvent | null = null; const counts: Record<ServiceUsageUnit, number> = { "catalog-selection-succeeded": 0, "try-on-started": 0, "widget-session-opened": 0 };
  for (let index = 0; index < events.length; index += 1) { const event = events[index]!; const known = ids.get(event.eventId); if (known) throw new TypeError(known === event.eventSha256 ? "service usage event is replayed" : "service usage event identity is relabelled"); if (digests.has(event.eventSha256)) throw new TypeError("service usage event digest is duplicated"); ids.set(event.eventId, event.eventSha256); digests.add(event.eventSha256); if (event.sequence !== index + 1 || event.previousEventSha256 !== (prior?.eventSha256 ?? null)) throw new TypeError("service usage ledger is sparse, reordered, or substitutes its head"); if (event.profileSha256 !== profile.profileSha256 || event.tenantId !== profile.tenantId || event.siteId !== profile.siteId || event.environment !== profile.environment || event.parentOrigin !== profile.parentOrigin) throw new TypeError("service usage event substitutes profile scope or origin"); const time = Date.parse(event.occurredAt); if (time > horizon || (prior && time <= Date.parse(prior.occurredAt))) throw new TypeError("service usage event is future, stale, or reordered"); if (time < created || time - created > SERVICE_READINESS_MAX_AGE_MS || horizon - time > SERVICE_READINESS_MAX_AGE_MS) throw new TypeError("service usage event is outside the local freshness bound"); counts[event.unit] += 1; prior = event; }
  const frozenCounts = Object.freeze({ "catalog-selection-succeeded": counts["catalog-selection-succeeded"], "try-on-started": counts["try-on-started"], "widget-session-opened": counts["widget-session-opened"] });
  const usageSummary: ServiceUsageSummary = Object.freeze({ meterStatus: "local-candidate-unverified-non-billable", eventCount: events.length, totalUnits: events.length, counts: frozenCounts, firstOccurredAt: events[0]?.occurredAt ?? null, lastOccurredAt: prior?.occurredAt ?? null, headEventSha256: prior?.eventSha256 ?? null, maxEvents: SERVICE_READINESS_MAX_USAGE_EVENTS, pricingAttached: false, billable: false, realUsageEvidence: false });
  return Object.freeze({ schemaVersion: 1, type: "service-readiness.local-evaluation", profile, embedRequirements: embedRequirements(profile), usageLedger: Object.freeze(events), usageSummary, serviceBoundary: SERVICE_BOUNDARY, evaluatedAt, operationalStatus: "local-preparation-only", g6Ready: false, authority: SERVICE_READINESS_AUTHORITY_DENIALS });
}

function authority(value: unknown): ServiceReadinessAuthorityDenials { plain(value, "service readiness authority"); exact(value, Object.keys(SERVICE_READINESS_AUTHORITY_DENIALS), "service readiness authority"); for (const key of Object.keys(SERVICE_READINESS_AUTHORITY_DENIALS)) if (value[key] !== false) throw new TypeError("service readiness authority cannot be granted"); return SERVICE_READINESS_AUTHORITY_DENIALS; }
export async function parseServiceReadinessCommand(value: unknown): Promise<ServiceReadinessCommand> {
  tree(value); const snapshot = structuredClone(value); plain(snapshot, "service readiness command"); exact(snapshot, ["schemaVersion", "type", "profile", "embedRequirements", "usageLedger", "usageSummary", "serviceBoundary", "evaluatedAt", "operationalStatus", "g6Ready", "authority", "byteLength", "commandSha256", "commandIdempotencyKey"], "service readiness command"); if (snapshot.schemaVersion !== 1 || snapshot.type !== "service-readiness.local-command" || snapshot.operationalStatus !== "local-preparation-only" || snapshot.g6Ready !== false) throw new TypeError("service readiness command cannot claim readiness or operations"); integer(snapshot.byteLength, 1, SERVICE_READINESS_MAX_COMMAND_BYTES, "command byteLength"); digest(snapshot.commandSha256, "command digest"); if (snapshot.commandIdempotencyKey !== `srcv1_${snapshot.commandSha256}`) throw new TypeError("command idempotency is inconsistent"); authority(snapshot.authority); timestamp(snapshot.evaluatedAt, "command evaluatedAt"); dense(snapshot.usageLedger, SERVICE_READINESS_MAX_USAGE_EVENTS, "command usage ledger"); const replayed = await evaluateServiceReadinessContract(snapshot.profile, snapshot.usageLedger, snapshot.evaluatedAt); const { byteLength, commandSha256, commandIdempotencyKey, ...body } = snapshot; if (canonicalJson({ ...body, type: "service-readiness.local-evaluation" }) !== canonicalJson(replayed)) throw new TypeError("service readiness command is inconsistent with deterministic evaluation"); const projected = { ...snapshot, commandSha256: ZERO, commandIdempotencyKey: `srcv1_${ZERO}` }; if (new TextEncoder().encode(canonicalJson(projected)).byteLength !== byteLength || await sha256Hex(canonicalJson(projected)) !== commandSha256) throw new TypeError("service readiness command digest or byte length is inconsistent"); return Object.freeze({ ...replayed, type: "service-readiness.local-command", byteLength, commandSha256, commandIdempotencyKey });
}
