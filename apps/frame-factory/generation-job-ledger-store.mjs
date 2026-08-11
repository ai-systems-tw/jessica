import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

export function generationJobEventFileName(event) {
  return `${String(event.sequence).padStart(8, "0")}.job-event.json`;
}

async function exactRegularFile(path, bytes) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    return (await readFile(path)).equals(bytes);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
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
