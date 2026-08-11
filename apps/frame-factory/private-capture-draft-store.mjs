import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

export class PrivateArtifactStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrivateArtifactStoreError";
    this.code = code;
  }
}

// Backward-compatible name for the capture authoring adapter.
export const PrivateCaptureDraftStoreError = PrivateArtifactStoreError;

function storeError(code, message) {
  return new PrivateArtifactStoreError(code, message);
}

export function validPrivateArtifactPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || isAbsolute(value) || win32.isAbsolute(value)) return false;
  const components = value.split(/[\\/]/);
  return components.every((component) => component.length > 0 && component !== "." && component !== "..");
}

export async function resolvePrivateCaptureRoot(configuredRoot) {
  if (typeof configuredRoot !== "string" || configuredRoot.trim().length === 0) {
    throw storeError("ROOT_REQUIRED", "an explicit private source root is required");
  }
  try {
    const root = await realpath(resolve(configuredRoot));
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("invalid root");
    return root;
  } catch {
    throw storeError("ROOT_INVALID", "configured private source root must resolve to an existing directory");
  }
}

function isStrictlyContained(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return true;
    throw error;
  }
}

async function sameFile(path, expected) {
  try {
    const info = await lstat(path);
    return !info.isSymbolicLink() && info.dev === expected.dev && info.ino === expected.ino;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readRegularNoFollow(path, operations) {
  const handle = await operations.openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw storeError("OUTPUT_VERIFICATION_FAILED", "published artifact is not a regular file");
    return { bytes: await handle.readFile(), info };
  } finally {
    await handle.close();
  }
}

async function readAtMost(handle, maximumBytes) {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1);
  let byteLength = 0;
  while (byteLength < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, byteLength, buffer.byteLength - byteLength, null);
    if (bytesRead === 0) break;
    byteLength += bytesRead;
  }
  return buffer.subarray(0, byteLength);
}

async function resolveContainedArtifact(configuredRoot, relativePath, pathKind) {
  if (!validPrivateArtifactPath(relativePath)) {
    throw storeError(`${pathKind}_PATH_INVALID`, `${pathKind.toLowerCase()} path must be relative and traversal-free`);
  }
  const root = await resolvePrivateCaptureRoot(configuredRoot);
  const components = relativePath.split(/[\\/]/);
  const locator = components.join("/");
  const artifactPath = resolve(root, ...components);
  if (!isStrictlyContained(root, artifactPath)) {
    throw storeError(`${pathKind}_CONTAINMENT`, `${pathKind.toLowerCase()} must remain below the private root`);
  }
  let parentPath = root;
  for (const component of components.slice(0, -1)) {
    parentPath = resolve(parentPath, component);
    let info;
    try { info = await lstat(parentPath); }
    catch { throw storeError(`${pathKind}_PARENT_INVALID`, `every ${pathKind.toLowerCase()} parent must already be a real directory`); }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw storeError(`${pathKind}_PARENT_INVALID`, `every ${pathKind.toLowerCase()} parent must already be a real directory`);
    }
  }
  return { root, locator, artifactPath, parentPath };
}

export async function readPrivateArtifact(configuredRoot, relativePath, maximumBytes, injected = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError("maximumBytes must be a positive safe integer");
  const operations = { openFile: injected.openFile ?? open };
  const { locator, artifactPath } = await resolveContainedArtifact(configuredRoot, relativePath, "INPUT");
  let handle;
  try {
    handle = await operations.openFile(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile()) throw storeError("INPUT_NOT_REGULAR", "private input must be a regular file");
    if (before.size > maximumBytes) throw storeError("INPUT_TOO_LARGE", "private input exceeds the byte limit");
    const bytes = await readAtMost(handle, maximumBytes);
    if (bytes.byteLength > maximumBytes) throw storeError("INPUT_TOO_LARGE", "private input exceeds the byte limit");
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || bytes.byteLength !== after.size) {
      throw storeError("INPUT_CHANGED", "private input changed while it was read");
    }
    return { relativePath: locator, bytes };
  } catch (error) {
    if (error instanceof PrivateArtifactStoreError) throw error;
    if (error && typeof error === "object" && error.code === "ENOENT") throw storeError("INPUT_MISSING", "private input could not be read");
    if (error && typeof error === "object" && (error.code === "ELOOP" || error.code === "EMLINK")) throw storeError("INPUT_NOT_REGULAR", "private input must be a regular file");
    throw storeError("INPUT_UNREADABLE", "private input could not be read");
  } finally {
    if (handle) await handle.close();
  }
}

export async function writePrivateArtifact(configuredRoot, relativePath, canonicalBytes, injected = {}) {
  const operations = {
    openFile: injected.openFile ?? open,
    linkFile: injected.linkFile ?? link,
    removeFile: injected.removeFile ?? unlink,
    writeBytes: injected.writeBytes ?? ((handle, bytes) => handle.writeFile(bytes)),
  };
  const { locator, artifactPath: targetPath, parentPath } = await resolveContainedArtifact(configuredRoot, relativePath, "OUTPUT");
  if (!(await absent(targetPath))) throw storeError("OUTPUT_COLLISION", "private artifact already exists");

  const temporaryPath = resolve(parentPath, `.private-artifact-${randomUUID()}.tmp`);
  let handle;
  let temporaryInfo;
  let published = false;
  let success = false;
  try {
    handle = await operations.openFile(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    await operations.writeBytes(handle, canonicalBytes);
    await handle.sync();
    temporaryInfo = await handle.stat();
    if (!temporaryInfo.isFile()) throw storeError("OUTPUT_WRITE_FAILED", "temporary artifact is not a regular file");
    await handle.close();
    handle = undefined;
    try {
      await operations.linkFile(temporaryPath, targetPath);
      published = true;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        throw storeError("OUTPUT_COLLISION", "private artifact already exists");
      }
      throw error;
    }
    const actual = await readRegularNoFollow(targetPath, operations);
    if (actual.info.dev !== temporaryInfo.dev || actual.info.ino !== temporaryInfo.ino || !actual.bytes.equals(canonicalBytes)) {
      throw storeError("OUTPUT_VERIFICATION_FAILED", "published artifact bytes could not be verified");
    }
    if ((actual.info.mode & 0o777) !== 0o600) throw storeError("OUTPUT_VERIFICATION_FAILED", "published artifact mode could not be verified");
    const directoryHandle = await operations.openFile(parentPath, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    await operations.removeFile(temporaryPath);
    success = true;
    return {
      relativePath: locator,
      sha256: createHash("sha256").update(actual.bytes).digest("hex"),
      byteLength: actual.bytes.byteLength,
    };
  } finally {
    const cleanupFailures = [];
    if (handle) {
      try { await handle.close(); } catch (error) { cleanupFailures.push(error); }
    }
    if (!success && published && temporaryInfo) {
      try {
        if (await sameFile(targetPath, temporaryInfo)) await operations.removeFile(targetPath);
      } catch (error) { cleanupFailures.push(error); }
    }
    if (!success) {
      try { await operations.removeFile(temporaryPath); }
      catch (error) { if (!error || typeof error !== "object" || error.code !== "ENOENT") cleanupFailures.push(error); }
    }
    if (cleanupFailures.length > 0) {
      throw storeError("OUTPUT_CLEANUP_FAILED", "private draft cleanup could not be proven");
    }
  }
}

export async function writePrivateCaptureDraftArtifact(configuredRoot, relativePath, canonicalBytes, injected = {}) {
  return writePrivateArtifact(configuredRoot, relativePath, canonicalBytes, injected);
}
