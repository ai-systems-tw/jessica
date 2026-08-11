import { SERVICE_READINESS_MAX_COMMAND_BYTES, bindServiceUsageEvent, canonicalJson, evaluateServiceReadinessContract, parseServiceReadinessCommand, sha256Hex, type ServiceReadinessCommand, type ServiceUsageEvent, type ServiceUsageUnit } from "../../contracts/src/index.js";

export const evaluateServiceReadiness = evaluateServiceReadinessContract;

export async function appendLocalUsageEvent(profileValue: unknown, ledgerValues: readonly unknown[], eventId: string, occurredAt: string, unit: ServiceUsageUnit): Promise<ServiceUsageEvent> {
  const evaluation = await evaluateServiceReadiness(profileValue, ledgerValues, occurredAt); const profile = evaluation.profile;
  const candidate = await bindServiceUsageEvent({ schemaVersion: 1, type: "service-readiness.usage-event", eventId, sequence: evaluation.usageLedger.length + 1, occurredAt, previousEventSha256: evaluation.usageSummary.headEventSha256, profileSha256: profile.profileSha256, tenantId: profile.tenantId, siteId: profile.siteId, environment: "production", parentOrigin: profile.parentOrigin, unit, quantity: 1, sourceStatus: "local-candidate-unverified" });
  const replayed = await evaluateServiceReadiness(profile, [...evaluation.usageLedger, candidate], occurredAt); return replayed.usageLedger.at(-1)!;
}

export async function buildServiceReadinessCommand(profile: unknown, usageLedger: readonly unknown[], evaluatedAt: string): Promise<ServiceReadinessCommand> {
  const evaluation = await evaluateServiceReadiness(profile, usageLedger, evaluatedAt); const zero = "0".repeat(64); let byteLength = 1;
  for (let index = 0; index < 8; index += 1) { const projected = { ...evaluation, type: "service-readiness.local-command", byteLength, commandSha256: zero, commandIdempotencyKey: `srcv1_${zero}` }; const next = new TextEncoder().encode(canonicalJson(projected)).byteLength; if (next === byteLength) break; byteLength = next; }
  if (byteLength > SERVICE_READINESS_MAX_COMMAND_BYTES) throw new TypeError("service readiness command exceeds its byte budget"); const projected = { ...evaluation, type: "service-readiness.local-command", byteLength, commandSha256: zero, commandIdempotencyKey: `srcv1_${zero}` }; const commandSha256 = await sha256Hex(canonicalJson(projected)); return parseServiceReadinessCommand(Object.freeze({ ...evaluation, type: "service-readiness.local-command", byteLength, commandSha256, commandIdempotencyKey: `srcv1_${commandSha256}` }));
}

export async function verifyServiceReadinessCommand(value: unknown): Promise<ServiceReadinessCommand> { return parseServiceReadinessCommand(value); }
