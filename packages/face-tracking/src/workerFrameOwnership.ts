import type { TrackingWorkerFrameSource } from "./workerProtocol.js";

export async function withOwnedTrackingFrame<T>(frame: TrackingWorkerFrameSource, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  finally { frame.close(); }
}

export function closeTransferredFrameIfPresent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const frame = (value as { frame?: unknown }).frame;
  if (typeof frame !== "object" || frame === null || typeof (frame as { close?: unknown }).close !== "function") return false;
  (frame as { close(): void }).close();
  return true;
}
