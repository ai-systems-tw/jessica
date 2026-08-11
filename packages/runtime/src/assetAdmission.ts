import type { AssetVersion } from "../../contracts/src/index.js";

export type RuntimeMode = "public-live" | "qa-preview" | "calibration";
export type AssetAdmissionReason =
  | "fixture-forbidden"
  | "fixture-required"
  | "status-not-admitted"
  | "not-recommended-for-live"
  | "calibration-must-be-draft-proxy";

export function evaluateAssetAdmission(input: {
  mode: RuntimeMode;
  asset: AssetVersion;
  fixture: boolean;
}): { admitted: boolean; reasons: readonly AssetAdmissionReason[] } {
  if (!["public-live", "qa-preview", "calibration"].includes(input.mode)) {
    throw new TypeError("runtime mode must be public-live, qa-preview, or calibration");
  }
  const reasons: AssetAdmissionReason[] = [];
  if (input.mode === "public-live") {
    if (input.fixture) reasons.push("fixture-forbidden");
    if (input.asset.status !== "published") reasons.push("status-not-admitted");
    if (!input.asset.qualityEnvelope.recommendedForLive) reasons.push("not-recommended-for-live");
  } else if (input.mode === "qa-preview") {
    if (input.fixture) reasons.push("fixture-forbidden");
    if (input.asset.status !== "approved" && input.asset.status !== "published") reasons.push("status-not-admitted");
  } else {
    if (!input.fixture) reasons.push("fixture-required");
    if (input.asset.status !== "draft" || input.asset.quality !== "proxy" || input.asset.qualityEnvelope.recommendedForLive) {
      reasons.push("calibration-must-be-draft-proxy");
    }
  }
  return { admitted: reasons.length === 0, reasons };
}

export function assertAssetAdmission(input: { mode: RuntimeMode; asset: AssetVersion; fixture: boolean }): void {
  const result = evaluateAssetAdmission(input);
  if (!result.admitted) throw new Error(`asset is not admitted for ${input.mode}: ${result.reasons.join(", ")}`);
}
