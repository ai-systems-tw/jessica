import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";

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
