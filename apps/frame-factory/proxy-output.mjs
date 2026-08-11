import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

async function regularBytes(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) return { exists: true, exact: false };
    return { exists: true, bytes: await handle.readFile() };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { exists: false };
    if (error && typeof error === "object" && error.code === "ELOOP") return { exists: true, exact: false };
    throw error;
  } finally { await handle?.close(); }
}

export async function writeExclusiveProxyBundle(options, operations = {}) {
  const openFile = operations.openFile ?? open;
  const removeFile = operations.removeFile ?? unlink;
  const createdPaths = [];
  let glbHandle;
  let manifestHandle;
  try {
    glbHandle = await openFile(options.glbPath, "wx"); createdPaths.push(options.glbPath);
    await glbHandle.writeFile(options.glb); await glbHandle.close(); glbHandle = undefined;
    manifestHandle = await openFile(options.manifestPath, "wx"); createdPaths.push(options.manifestPath);
    await manifestHandle.writeFile(options.manifestJson, "utf8"); await manifestHandle.close(); manifestHandle = undefined;
  } catch (error) {
    await Promise.allSettled([glbHandle?.close(), manifestHandle?.close()]);
    const cleanup = await Promise.allSettled(createdPaths.map((path) => removeFile(path)));
    if (cleanup.some((result) => result.status === "rejected")) {
      throw Object.assign(new Error("partial proxy output cleanup could not be proven"), { code: "EOUTPUTCLEANUP", cause: error });
    }
    throw error;
  }
}

export async function writeIdempotentProxyBundle(options, operations = {}) {
  const beforeGlb = await regularBytes(options.glbPath);
  const beforeManifest = await regularBytes(options.manifestPath);
  const expectedGlb = Buffer.from(options.glb);
  const expectedManifest = Buffer.from(options.manifestJson, "utf8");
  if (beforeGlb.exists || beforeManifest.exists) {
    if (beforeGlb.exists && beforeManifest.exists && beforeGlb.bytes?.equals(expectedGlb) && beforeManifest.bytes?.equals(expectedManifest)) {
      return { existing: true, createdPaths: [] };
    }
    throw Object.assign(new Error("immutable proxy output collision"), { code: "EOUTPUTCOLLISION" });
  }
  await writeExclusiveProxyBundle(options, operations);
  return { existing: false, createdPaths: [options.glbPath, options.manifestPath] };
}

async function privateRegular(path, expectedBytes, openFile) {
  let handle;
  try {
    handle = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || (before.mode & 0o777) !== 0o600 || before.size !== expectedBytes.byteLength) {
      return { exists: true, exact: false };
    }
    const bytes = Buffer.allocUnsafe(expectedBytes.byteLength + 1);
    let byteLength = 0;
    while (byteLength < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, byteLength, bytes.byteLength - byteLength, null);
      if (bytesRead === 0) break;
      byteLength += bytesRead;
    }
    const after = await handle.stat();
    const stable = after.isFile()
      && before.dev === after.dev
      && before.ino === after.ino
      && after.size === expectedBytes.byteLength
      && byteLength === expectedBytes.byteLength;
    return { exists: true, exact: stable && bytes.subarray(0, byteLength).equals(expectedBytes), info: after };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { exists: false, exact: false };
    if (error && typeof error === "object" && error.code === "ELOOP") return { exists: true, exact: false };
    throw error;
  } finally { await handle?.close(); }
}

async function removeIfSame(path, expectedInfo, operations) {
  let handle;
  try {
    handle = await operations.openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (info.dev !== expectedInfo.dev || info.ino !== expectedInfo.ino) return false;
    await operations.removeFile(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return true;
    throw error;
  } finally { await handle?.close(); }
}

/**
 * Publishes a private two-file proxy bundle. Each final name appears only after
 * its complete 0600 inode has been synced, and existing exact 0600 pairs are
 * reusable for the worker's documented recovery path. No existing entry is
 * opened for writing or replaced.
 */
export async function writeIdempotentPrivateProxyBundle(options, injected = {}) {
  const operations = {
    openFile: injected.openFile ?? open,
    linkFile: injected.linkFile ?? link,
    removeFile: injected.removeFile ?? unlink,
  };
  const expected = [
    { path: options.glbPath, bytes: Buffer.from(options.glb) },
    { path: options.manifestPath, bytes: Buffer.from(options.manifestJson, "utf8") },
  ];
  if (dirname(expected[0].path) !== dirname(expected[1].path)) {
    throw Object.assign(new Error("private proxy bundle must share one directory"), { code: "EOUTPUTCONTAINMENT" });
  }
  const before = await Promise.all(expected.map((item) => privateRegular(item.path, item.bytes, operations.openFile)));
  if (before.some((item) => item.exists)) {
    if (before.every((item) => item.exists && item.exact)) return { existing: true, createdPaths: [] };
    throw Object.assign(new Error("immutable private proxy output collision"), { code: "EOUTPUTCOLLISION" });
  }

  const directory = dirname(expected[0].path);
  const staged = [];
  const published = [];
  let success = false;
  try {
    for (const item of expected) {
      const temporaryPath = join(directory, `.private-proxy-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await operations.openFile(
          temporaryPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await handle.chmod(0o600);
        await handle.writeFile(item.bytes);
        await handle.sync();
        const info = await handle.stat();
        if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error("private proxy staging mode invalid");
        staged.push({ ...item, temporaryPath, info });
      } finally { await handle?.close(); }
    }
    for (const item of staged) {
      try { await operations.linkFile(item.temporaryPath, item.path); }
      catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") {
          throw Object.assign(new Error("immutable private proxy output collision"), { code: "EOUTPUTCOLLISION" });
        }
        throw error;
      }
      published.push(item);
    }
    for (const item of expected) {
      const verified = await privateRegular(item.path, item.bytes, operations.openFile);
      if (!verified.exists || !verified.exact) throw new Error("private proxy publication verification failed");
    }
    const directoryHandle = await operations.openFile(directory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    success = true;
    return {
      existing: false,
      createdPaths: expected.map((item) => item.path),
      cleanupCreated: async () => {
        const results = await Promise.allSettled(published.map((item) => removeIfSame(item.path, item.info, operations)));
        return results.every((result) => result.status === "fulfilled" && result.value === true);
      },
    };
  } finally {
    const cleanup = [];
    if (!success) {
      for (const item of published) cleanup.push(removeIfSame(item.path, item.info, operations));
    }
    for (const item of staged) cleanup.push(operations.removeFile(item.temporaryPath).then(() => true).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return true;
      throw error;
    }));
    const results = await Promise.allSettled(cleanup);
    if (results.some((result) => result.status === "rejected" || result.value !== true)) {
      throw Object.assign(new Error("private proxy output cleanup could not be proven"), { code: "EOUTPUTCLEANUP" });
    }
  }
}
