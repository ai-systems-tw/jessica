import {
  FIT_MAX_COMMAND_BYTES, assertFitTree, canonicalJson, sha256Hex, type FitIntelligenceCommand,
} from "../../contracts/src/index.js";
import { evaluateFitIntelligence, verifyFitIntelligenceEvaluation } from "./core.js";
export * from "./core.js";

function commandProjection(evaluation: Awaited<ReturnType<typeof evaluateFitIntelligence>>, byteLength: number, digest: string): FitIntelligenceCommand {
  const { type: _, ...body } = evaluation;
  return { ...body, type: "fit-intelligence.local-command", byteLength, commandSha256: digest, commandIdempotencyKey: `ficv1_${digest}` };
}
export async function buildFitIntelligenceCommand(inputValue: unknown, evaluatedAtValue: unknown): Promise<FitIntelligenceCommand> {
  assertFitTree(inputValue); const inputSnapshot = structuredClone(inputValue); const evaluatedAtSnapshot = structuredClone(evaluatedAtValue); const evaluation = await evaluateFitIntelligence(inputSnapshot, evaluatedAtSnapshot); const zero = "0".repeat(64); let byteLength = 1;
  for (let index = 0; index < 8; index += 1) { const next = new TextEncoder().encode(canonicalJson(commandProjection(evaluation, byteLength, zero))).byteLength; if (next === byteLength) break; byteLength = next; }
  if (byteLength > FIT_MAX_COMMAND_BYTES) throw new TypeError("fit intelligence command exceeds its byte budget"); const commandSha256 = await sha256Hex(canonicalJson(commandProjection(evaluation, byteLength, zero))); return Object.freeze(commandProjection(evaluation, byteLength, commandSha256));
}
export async function verifyFitIntelligenceCommand(value: unknown): Promise<FitIntelligenceCommand> {
  assertFitTree(value); const snapshot = structuredClone(value) as Record<string, unknown>; if (snapshot.schemaVersion !== 1 || snapshot.type !== "fit-intelligence.local-command") throw new TypeError("fit command version or type is unsupported");
  const { byteLength, commandSha256, commandIdempotencyKey, type: _, ...evaluationBody } = snapshot; const evaluation = await verifyFitIntelligenceEvaluation({ ...evaluationBody, type: "fit-intelligence.local-evaluation" });
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 1 || (byteLength as number) > FIT_MAX_COMMAND_BYTES || typeof commandSha256 !== "string" || typeof commandIdempotencyKey !== "string") throw new TypeError("fit command envelope is invalid");
  const zero = "0".repeat(64); const expectedLength = new TextEncoder().encode(canonicalJson(commandProjection(evaluation, byteLength as number, zero))).byteLength; const expectedHash = await sha256Hex(canonicalJson(commandProjection(evaluation, byteLength as number, zero)));
  if (expectedLength !== byteLength || commandSha256 !== expectedHash || commandIdempotencyKey !== `ficv1_${expectedHash}`) throw new TypeError("fit command digest, size, or idempotency is inconsistent"); return Object.freeze(commandProjection(evaluation, byteLength as number, expectedHash));
}
