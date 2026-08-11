import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import { verifyGenerationJobEvent } from "../../dist/packages/contracts/src/index.js";

export function generationJobEventFileName(event) {
  return `${String(event.sequence).padStart(8, "0")}.job-event.json`;
}

const PENDING_FILE = /^\.pending-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
export const GENERATION_JOB_EVENT_MAXIMUM_BYTES = 256 * 1024;

async function readRegularNoFollow(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) throw new TypeError("ledger contains a non-regular event entry");
    if (before.size > GENERATION_JOB_EVENT_MAXIMUM_BYTES) throw new TypeError("ledger event exceeds the byte limit");
    const bytes = Buffer.allocUnsafe(GENERATION_JOB_EVENT_MAXIMUM_BYTES + 1);
    let byteLength = 0;
    while (byteLength < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, byteLength, bytes.byteLength - byteLength, null);
      if (bytesRead === 0) break;
      byteLength += bytesRead;
    }
    const after = await handle.stat();
    if (byteLength > GENERATION_JOB_EVENT_MAXIMUM_BYTES
        || !after.isFile()
        || before.dev !== after.dev
        || before.ino !== after.ino
        || byteLength !== after.size) {
      throw new TypeError("ledger event changed while it was read");
    }
    return bytes.subarray(0, byteLength);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ELOOP") throw new TypeError("ledger contains a symlink event entry");
    throw error;
  } finally { await handle?.close(); }
}

export async function readImmutableGenerationJobLedger(directory) {
  const names = [];
  for (const name of await readdir(directory)) {
    if (PENDING_FILE.test(name)) {
      try {
        const info = await lstat(join(directory, name));
        if (!info.isFile() || info.isSymbolicLink()) throw new TypeError("ledger contains an invalid pending entry");
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
      }
      continue;
    }
    if (!/^\d{8}\.job-event\.json$/.test(name)) throw new TypeError("ledger contains an unknown entry");
    names.push(name);
  }
  names.sort();
  const events = [];
  for (const name of names) {
    const path = join(directory, name);
    let value;
    try { value = JSON.parse((await readRegularNoFollow(path)).toString("utf8")); }
    catch { throw new TypeError("ledger event is not valid JSON"); }
    const event = await verifyGenerationJobEvent(value);
    if (name !== generationJobEventFileName(event)) throw new TypeError("ledger event filename does not bind sequence");
    events.push(event);
  }
  return events;
}

async function exactRegularFile(path, bytes) {
  try {
    return (await readRegularNoFollow(path)).equals(bytes);
  } catch (error) {
    if ((error && typeof error === "object" && error.code === "ENOENT") || error instanceof TypeError) return false;
    throw error;
  }
}

export async function writeImmutableGenerationJobEvent(directory, event, canonicalBytes, operations = {}) {
  const openFile = operations.openFile ?? open;
  const linkFile = operations.linkFile ?? link;
  const removeFile = operations.removeFile ?? unlink;
  const finalPath = join(directory, generationJobEventFileName(event));
  if (await exactRegularFile(finalPath, canonicalBytes)) return { file: basename(finalPath), existing: true };
  const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await openFile(temporaryPath, "wx", 0o600);
    await handle.writeFile(canonicalBytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    try { await linkFile(temporaryPath, finalPath); }
    catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST" && await exactRegularFile(finalPath, canonicalBytes)) return { file: basename(finalPath), existing: true };
      throw error;
    }
    return { file: basename(finalPath), existing: false };
  } finally {
    await Promise.allSettled([handle?.close(), removeFile(temporaryPath)]);
  }
}
