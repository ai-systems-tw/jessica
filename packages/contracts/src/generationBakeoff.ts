export const BAKEOFF_METHODS = ["Proxy", "Standard", "Premium", "Commercial Reference"] as const;
export type BakeoffMethod = (typeof BAKEOFF_METHODS)[number];
export const REQUIRED_BAKEOFF_METHODS = ["Proxy", "Standard"] as const;
export const BAKEOFF_MOBILE_DEVICE_CLASSES = ["iphone-safari-representative", "iphone-se-lower-end", "android-chrome-mid-range"] as const;
export type BakeoffMobileDeviceClass = (typeof BAKEOFF_MOBILE_DEVICE_CLASSES)[number];
export const BAKEOFF_ANGLES = ["front", "15", "25"] as const;
export type BakeoffAngle = (typeof BAKEOFF_ANGLES)[number];
export type BakeoffIssue = { code: string; path: string; message: string };
export type BakeoffHumanReview = { reviewerId: string; result: "approve" | "correction-required" | "manual-model-required" | "reject"; recordedAt: string };
export type GenerationBakeoffRun = {
  runId: string; tenantId: string; frameModelId: string; method: BakeoffMethod;
  sourceAssetSha256s: string[]; measurementSha256: string;
  generator: { identity: string; version: string; configSha256: string };
  inputSha256: string; outputSha256: string; artifactByteLength: number; modelSha256: string; modelByteLength: number;
  angles: Array<{ angle: BakeoffAngle; renderSha256: string; artifactByteLength: number; humanReview: BakeoffHumanReview }>;
  sizeErrorPct: number; materialReview: BakeoffHumanReview; visualReview: BakeoffHumanReview;
  performance: { deviceClass: BakeoffMobileDeviceClass; runtimeVersion: string; renderFps: number; measuredAt: string; actorId: string };
  correctionCount: number; correctionMinutes: number;
  approval: "approve" | "approve-with-correction" | "manual-model-required" | "reject";
  firstPass: boolean;
  failureClassification: "none" | "generation-failed" | "geometry" | "material" | "size" | "performance" | "manual-required" | "unsupported";
  startedAt: string; completedAt: string; actorId: string;
};
export type GenerationBakeoffEvidence = {
  schemaVersion: 1; bakeoffId: string; template: boolean; evaluatedAt: string;
  inventory: { inventoryId: string; inventoryVersion: number; inventorySha256: string; tenantId: string; modelIds: string[]; premiumBaselineModelIds: [string, string, string] };
  captureProfileSha256: string; runs: GenerationBakeoffRun[];
};
