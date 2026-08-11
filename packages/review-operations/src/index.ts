import { canonicalJson, type ReviewQueueBuildInput, type ReviewQueueCommand } from "../../contracts/src/index.js";
import { buildReviewQueue } from "./core.js";
export * from "./core.js";

export type ReviewOperationsClock = { now(): unknown };
export type ReviewOperationsReadPort = { read(): Promise<unknown> };
export type ReviewOperationsWritePort = { write(command: ReviewQueueCommand, canonicalBytes: Uint8Array): Promise<unknown> };
export type ReviewOperationsPreparationResult = { ok: true; command: ReviewQueueCommand } | { ok: false; code: "CLOCK_FAILED" | "READ_FAILED" | "BUILD_REJECTED" | "WRITE_FAILED" };

function clock(value: unknown): string { if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype || !Number.isFinite(value.getTime())) throw new TypeError("clock is invalid"); return value.toISOString(); }
function plainRead(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("read result must be plain"); const descriptors = Object.getOwnPropertyDescriptors(value); if (Object.values(descriptors).some((item) => !item.enumerable || item.get || item.set)) throw new TypeError("read result fields are invalid"); const keys = ["schemaVersion", "type", "tenantId", "siteId", "environment", "workItems", "evidence"]; if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError("read result fields are invalid"); return value as Record<string, unknown>; }
function acknowledgement(value: unknown): void { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("write response must be plain"); const descriptors = Object.getOwnPropertyDescriptors(value); if (Object.values(descriptors).some((item) => !item.enumerable || item.get || item.set) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "status")) throw new TypeError("write response fields are invalid"); const status = (value as { status?: unknown }).status; if (status !== "accepted" && status !== "idempotent") throw new TypeError("write response is rejected"); }
export async function prepareReviewOperations(ports: { clock: ReviewOperationsClock; reader: ReviewOperationsReadPort; writer: ReviewOperationsWritePort }): Promise<ReviewOperationsPreparationResult> {
  let asOf: string; try { asOf = clock(ports.clock.now()); } catch { return { ok: false, code: "CLOCK_FAILED" }; }
  let raw: unknown; try { raw = await ports.reader.read(); } catch { return { ok: false, code: "READ_FAILED" }; }
  let command: ReviewQueueCommand; try { const value = plainRead(raw); command = (await buildReviewQueue({ ...(value as unknown as Omit<ReviewQueueBuildInput, "asOf">), asOf })).command; } catch { return { ok: false, code: "BUILD_REJECTED" }; }
  try { acknowledgement(await ports.writer.write(command, new TextEncoder().encode(canonicalJson(command)))); } catch { return { ok: false, code: "WRITE_FAILED" }; }
  return { ok: true, command };
}
