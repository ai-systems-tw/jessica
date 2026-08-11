import type { RuntimeAsset } from "../../../packages/runtime/src/index.js";

export type InitializableRuntime = {
  initialize(canvas: HTMLCanvasElement, asset: RuntimeAsset): Promise<void>;
};

export async function prepareAdmittedRuntime<T extends InitializableRuntime>(options: {
  loadAsset(): Promise<RuntimeAsset>;
  createRuntime(): T;
  canvas: HTMLCanvasElement;
}): Promise<T> {
  const asset = await options.loadAsset();
  const candidate = options.createRuntime();
  await candidate.initialize(options.canvas, asset);
  return candidate;
}
