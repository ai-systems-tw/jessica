import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

export class PrivateCaptureDraftStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrivateCaptureDraftStoreError";
    this.code = code;
  }
}

function storeError(code, message) {
  return new PrivateCaptureDraftStoreError(code, message);
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

export async function writePrivateCaptureDraftArtifact(configuredRoot, relativePath, canonicalBytes, injected = {}) {
  if (!validPrivateArtifactPath(relativePath)) {
    throw storeError("OUTPUT_PATH_INVALID", "output path must be relative and traversal-free");
  }
  const operations = {
    openFile: injected.openFile ?? open,
    linkFile: injected.linkFile ?? link,
    removeFile: injected.removeFile ?? unlink,
    writeBytes: injected.writeBytes ?? ((handle, bytes) => handle.writeFile(bytes)),
  };
  const root = await resolvePrivateCaptureRoot(configuredRoot);

  const components = relativePath.split(/[\\/]/);
  const locator = components.join("/");
  const targetPath = resolve(root, ...components);
  if (!isStrictlyContained(root, targetPath)) throw storeError("OUTPUT_CONTAINMENT", "output must remain below the private root");
  let parentPath = root;
  for (const component of components.slice(0, -1)) {
    parentPath = resolve(parentPath, component);
    let info;
    try { info = await lstat(parentPath); }
    catch { throw storeError("OUTPUT_PARENT_INVALID", "every output parent must already be a real directory"); }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw storeError("OUTPUT_PARENT_INVALID", "every output parent must already be a real directory");
    }
  }
  if (!(await absent(targetPath))) throw storeError("OUTPUT_COLLISION", "private draft artifact already exists");

  const temporaryPath = resolve(parentPath, `.capture-draft-${randomUUID()}.tmp`);
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
        throw storeError("OUTPUT_COLLISION", "private draft artifact already exists");
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
