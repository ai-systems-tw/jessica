import { buildDemandQueue, canonicalJson, serializeDemandQueueCommand, type DemandQueueBuildInput, type DemandQueueCommand } from "../../contracts/src/index.js";

export type DemandQueueClock = { now(): unknown };
export type DemandQueueReadPort = { read(): Promise<unknown> };
export type DemandQueueWritePort = { write(command: DemandQueueCommand, canonicalBytes: Uint8Array): Promise<unknown> };
export type DemandQueueWriteResponse = Readonly<{ status: "accepted" | "idempotent" }>;
export type DemandQueuePreparationResult =
  | { ok: true; command: DemandQueueCommand }
  | { ok: false; code: "CLOCK_FAILED" | "READ_FAILED" | "BUILD_REJECTED" | "WRITE_FAILED" };

function exactDate(value: unknown): string {
  if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype || !Number.isFinite(value.getTime())) throw new TypeError("clock returned an invalid Date");
  return value.toISOString();
}
function parseWriteResponse(value: unknown): DemandQueueWriteResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("writer response must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(value); if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || descriptor.get || descriptor.set)) throw new TypeError("writer response must contain enumerable data fields");
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "status")) throw new TypeError("writer response fields are invalid");
  const status = (value as { status?: unknown }).status; if (status !== "accepted" && status !== "idempotent") throw new TypeError("writer response status is invalid");
  return Object.freeze({ status });
}

/** Local orchestration only. Ports carry contracts, canonical command bytes, and no people/media fields. */
export async function prepareDemandQueue(ports: { clock: DemandQueueClock; reader: DemandQueueReadPort; writer: DemandQueueWritePort }): Promise<DemandQueuePreparationResult> {
  let asOf: string; try { asOf = exactDate(ports.clock.now()); } catch { return { ok: false, code: "CLOCK_FAILED" }; }
  let raw: unknown; try { raw = await ports.reader.read(); } catch { return { ok: false, code: "READ_FAILED" }; }
  let command: DemandQueueCommand;
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw new TypeError("read result must be a plain object");
    if (Object.getOwnPropertySymbols(raw).length !== 0) throw new TypeError("read result must not contain symbols");
    const descriptors = Object.getOwnPropertyDescriptors(raw); if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || descriptor.get || descriptor.set)) throw new TypeError("read result must contain enumerable data fields");
    const expected = ["schemaVersion", "type", "tenantId", "siteId", "environment", "evidence", "salesRanks", "inventory", "coverage"];
    if (Object.keys(raw).length !== expected.length || expected.some((key) => !Object.hasOwn(raw, key))) throw new TypeError("read result fields are invalid");
    const input = { ...(raw as Omit<DemandQueueBuildInput, "asOf">), asOf }; command = (await buildDemandQueue(input)).command;
    await serializeDemandQueueCommand(command);
  } catch { return { ok: false, code: "BUILD_REJECTED" }; }
  try { parseWriteResponse(await ports.writer.write(command, new TextEncoder().encode(canonicalJson(command)))); } catch { return { ok: false, code: "WRITE_FAILED" }; }
  return { ok: true, command };
}
