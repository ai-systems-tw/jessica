import type { AssetVersion, FrameModel, ValidationIssue } from "./frame.js";
import { validateAssetVersion, validateFrameModel } from "./frame.js";

export type FrameSourceKind = "front" | "left45" | "right45" | "leftSide" | "rightSide" | "top" | "marking";

export type FrameSourceIntake = {
  id: string;
  kind: FrameSourceKind;
  relativePath: string;
  sha256: string;
};

export type SingleFrameAssetIntake = {
  schemaVersion: 1;
  model: FrameModel;
  sources: readonly FrameSourceIntake[];
  asset: AssetVersion;
};

const REQUIRED_G1_SOURCE_KINDS: readonly FrameSourceKind[] = [
  "front",
  "left45",
  "right45",
  "leftSide",
  "rightSide",
  "marking",
];

export function validateSingleFrameAssetIntake(intake: SingleFrameAssetIntake): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [
    ...validateFrameModel(intake.model).map((issue) => ({ ...issue, path: `model.${issue.path}` })),
    ...validateAssetVersion(intake.asset).map((issue) => ({ ...issue, path: `asset.${issue.path}` })),
  ];
  if (intake.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "must equal 1" });
  if (!Array.isArray(intake.sources)) {
    issues.push({ path: "sources", message: "must be an array" });
    return issues;
  }
  const kinds = new Set<FrameSourceKind>();
  const hashes = new Set<string>();
  const allowedKinds = new Set<FrameSourceKind>([...REQUIRED_G1_SOURCE_KINDS, "top"]);
  for (const [index, source] of intake.sources.entries()) {
    const path = `sources.${index}`;
    if (!source.id?.trim()) issues.push({ path: `${path}.id`, message: "must not be blank" });
    if (!source.relativePath?.trim()) issues.push({ path: `${path}.relativePath`, message: "must not be blank" });
    if (!/^[a-f0-9]{64}$/i.test(source.sha256 ?? "")) {
      issues.push({ path: `${path}.sha256`, message: "must be a 64-character SHA-256 hex digest" });
    }
    if (!allowedKinds.has(source.kind)) issues.push({ path: `${path}.kind`, message: "unsupported source kind" });
    if (kinds.has(source.kind)) issues.push({ path: `${path}.kind`, message: `duplicate source kind ${source.kind}` });
    if (hashes.has(source.sha256)) issues.push({ path: `${path}.sha256`, message: "duplicate source hash" });
    kinds.add(source.kind);
    hashes.add(source.sha256);
  }
  for (const kind of REQUIRED_G1_SOURCE_KINDS) {
    if (!kinds.has(kind)) issues.push({ path: "sources", message: `missing required ${kind} source` });
  }
  if (intake.asset.tenantId !== intake.model.tenantId) {
    issues.push({ path: "asset.tenantId", message: "must match model tenantId" });
  }
  if (intake.asset.frameModelId !== intake.model.id) {
    issues.push({ path: "asset.frameModelId", message: "must match model id" });
  }
  if (!intake.asset.modelUrl.toLowerCase().endsWith(".glb")) {
    issues.push({ path: "asset.modelUrl", message: "must reference a GLB asset" });
  }
  for (const hash of intake.asset.sourceAssetHashes) {
    if (!hashes.has(hash)) {
      issues.push({ path: "asset.sourceAssetHashes", message: `unknown source hash ${hash}` });
    }
  }
  if (hashes.size > 0 && intake.asset.sourceAssetHashes.length !== hashes.size) {
    issues.push({ path: "asset.sourceAssetHashes", message: "must include every unique source hash" });
  }
  if (intake.asset.status !== "approved" && intake.asset.status !== "published") {
    issues.push({ path: "asset.status", message: "must be approved or published for G1" });
  }
  if (!intake.asset.qualityEnvelope.recommendedForLive) {
    issues.push({ path: "asset.qualityEnvelope.recommendedForLive", message: "must be true for G1" });
  }
  return issues;
}
