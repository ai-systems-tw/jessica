import { open, unlink } from "node:fs/promises";

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
    await Promise.allSettled(createdPaths.map((path) => removeFile(path)));
    throw error;
  }
}
