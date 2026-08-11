import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function validRelativeLocalPath(value) {
  const components = typeof value === "string" ? value.split(/[\\/]/).filter((item) => item !== "" && item !== ".") : [];
  return typeof value === "string" && value.length > 0 && components.length > 0 && !isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..") && !value.includes("\0");
}

export function isStrictlyContained(root, candidate) {
  const path = relative(root, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function resolveLocalRoot(rootValue) {
  try {
    const requested = resolve(rootValue);
    const requestedInfo = await lstat(requested);
    if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) throw new TypeError("root must be a real directory");
    return await realpath(requested);
  } catch {
    throw Object.assign(new TypeError("root must be an existing real directory"), { code: "EROOTINVALID" });
  }
}

export async function inspectContainedPath(root, relativePath, options = {}) {
  if (!validRelativeLocalPath(relativePath)) throw Object.assign(new TypeError("relative path is invalid"), { code: "EOUTPUTCONTAINMENT" });
  let current = root;
  let missing = false;
  for (const component of relativePath.split(/[\\/]/).filter((item) => item !== "" && item !== ".")) {
    current = resolve(current, component);
    if (!isStrictlyContained(root, current)) throw Object.assign(new TypeError("path escapes root"), { code: "EOUTPUTCONTAINMENT" });
    if (missing) continue;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (!info.isDirectory() && current !== resolve(root, relativePath))) {
        throw Object.assign(new TypeError("unsafe path component"), { code: "EOUTPUTCONTAINMENT" });
      }
      if (current === resolve(root, relativePath) && options.mustBeDirectory && !info.isDirectory()) {
        throw Object.assign(new TypeError("path is not a directory"), { code: "EOUTPUTCONTAINMENT" });
      }
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
      missing = true;
    }
  }
  return { path: current, exists: !missing };
}

export async function ensureContainedDirectory(root, relativePath) {
  await inspectContainedPath(root, relativePath);
  let current = root;
  for (const component of relativePath.split(/[\\/]/).filter((item) => item !== "" && item !== ".")) {
    current = resolve(current, component);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new TypeError("unsafe output component"), { code: "EOUTPUTCONTAINMENT" });
  }
  return current;
}

export async function ensurePrivateContainedDirectory(root, relativePath) {
  await inspectContainedPath(root, relativePath);
  let current = root;
  for (const component of relativePath.split(/[\\/]/).filter((item) => item !== "" && item !== ".")) {
    current = resolve(current, component);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) {
      throw Object.assign(new TypeError("private output component is unsafe or permissive"), { code: "EOUTPUTCONTAINMENT" });
    }
  }
  return current;
}
